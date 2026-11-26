// 로컬 테스트: 서버 함수 단위 테스트 + (playwright가 있으면) 화면 동작 테스트
// 실제 API는 호출하지 않고 가짜 응답으로 검사합니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as g2b from '../functions/api/g2b.js';
import * as law from '../functions/api/law.js';
import * as health from '../functions/api/health.js';
import * as stats from '../functions/api/stats.js';
import * as mw from '../functions/api/_middleware.js';

globalThis.FAKE_LIMIT = 31;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'TEST+KEY/abc==';
const OC = 'myoc123';
const ENV = { G2B_SERVICE_KEY: KEY, LAW_OC: OC, ADMIN_TOKEN: 'admin-secret-1' };
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };

// ---------- 가짜 외부 API ----------
const calls = [];
function fixture(urlStr) {
  const u = new URL(urlStr);
  calls.push(u);
  // 연결 지연(522) 흉내: '지연1'은 처음 한 번만, '지연항상'은 계속
  const nm = u.searchParams.get('bidNtceNm') || '';
  if (nm === '지연항상' || (nm === '지연1' && !globalThis.__delayed1)) { globalThis.__delayed1 = true; return 'error code: 522'; }
  if (u.hostname === 'www.law.go.kr') {
    if (u.pathname.endsWith('lawSearch.do')) return JSON.stringify({ PpsCgmExpcSearch: { totalCnt: '2', page: '1', ppsCgmExpc: [
      { id: '1', 법령해석일련번호: '431416', 안건명: '협상에 의한 계약 평가 관련 질의', 안건번호: '조달청-25-0001', 해석일자: '20250930', 해석기관명: '조달청', 질의기관명: '충청남도교육청', 법령해석상세링크: `/DRF/lawService.do?OC=${OC}&target=ppsCgmExpc&ID=431416` },
      { id: '2', 법령해석일련번호: '431417', 안건명: '수의계약 금액 산정 관련 질의', 안건번호: '조달청-25-0002', 해석일자: '20250814', 해석기관명: '조달청', 질의기관명: '○○시' },
    ] } });
    if (u.searchParams.get('type') === 'HTML') return `<html><head><title>x</title></head><body>원문 ${OC}</body></html>`;
    return JSON.stringify({ PpsCgmExpcService: { 법령해석일련번호: u.searchParams.get('ID'), 안건명: '협상에 의한 계약 평가 관련 질의', 안건번호: '조달청-25-0001', 해석일자: '20250930', 해석기관명: '조달청', 질의기관명: '충청남도교육청', 질의요지: '질의 내용 본문', 회답: '회답 본문', 이유: '이유 본문\n둘째 줄', 관련법령: '「국가를 당사자로 하는 계약에 관한 법률 시행령」 제43조' } });
  }
  const op = u.pathname.split('/').pop();
  // 검색(PPSSrch)의 한 번 조회 가능 기간 (운영계정 가정 31일, 아래에서 7일 상황도 시험)
  if (/PPSSrch$/.test(op)) {
    const b = u.searchParams.get('inqryBgnDate') || (u.searchParams.get('inqryBgnDt') || '').slice(0, 8);
    const e = u.searchParams.get('inqryEndDate') || (u.searchParams.get('inqryEndDt') || '').slice(0, 8);
    const d = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`);
    if (b && e && (d(e) - d(b)) / 864e5 + 1 > globalThis.FAKE_LIMIT) return JSON.stringify({ 'nkoneps.com.response.ResponseError': { header: { resultCode: '07', resultMsg: '입력범위값 초과 에러' } } });
  }
  const wrap = (items, extra = {}) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: '정상' }, body: Object.assign({ items, numOfRows: 20, pageNo: 1, totalCount: items.length }, extra) } });
  if (op.startsWith('getCntrctInfoList') && op.endsWith('ChgHstry')) return wrap([{ chgDt: '2026-10-24 10:00:00', totCntrctAmt: '950000000', thtmCntrctAmt: '300000000', cntrctPrd: '2026-09-15~2027-09-14', ttalScmpltDate: '2027-09-14' }]);
  if (op === 'getCntrctInfoListCnstwkPPSSrch') return wrap([
    { untyCntrctNo: 'C2026110000001', cnstwkNm: '○○초 교사동 외부 도장 공사', corpList: '[1^대표^단독^우승기업(주)^김대표^대한민국^100^^^1112223334]', totCntrctAmt: '2145000', cntrctCnclsDate: '2026-11-05', cntrctCnclsMthdNm: '수의계약', cbgnDate: '2026-11-06', ttalCcmpltDate: '2026-12-20' },
  ]);
  if (op.startsWith('getCntrctInfoList')) return wrap([
    { untyCntrctNo: '2026090000001', cntrctNm: '정보시스템 통합유지관리 용역', corpList: '[1^대표^단독^가나다정보통신(주)^홍길동^대한민국^100^가나다정보통신(주)^김담당^1234567890]', totCntrctAmt: '912000000', thtmCntrctAmt: '300000000', cntrctCnclsDate: '2026-09-15', cntrctCnclsMthdNm: '협상에의한계약', ntceNo: 'R26BK00000101000', cntrctInsttNm: '충청남도교육청', cntrctDtlInfoUrl: 'https://www.g2b.go.kr/x', chgDt: '2026-10-24 10:00:00', cntrctPrd: '2026-09-15~2027-09-14' },
    { untyCntrctNo: '2026100000002', cntrctNm: '학교 급식기구 구매', corpList: '[1^대표^공동^라마바(주)^이대표^대한민국^60^^^2223334445],[2^구성원^공동^사아자(주)^박대표^대한민국^40^^^5556667778]', totCntrctAmt: '48500000', cntrctCnclsDate: '2026-10-02', cntrctCnclsMthdNm: '수의계약', ntceNo: '' },
  ]);
  if (/PPSSrch$/.test(op) && op.startsWith('getBidPblancListInfo')) return wrap([
    { bidNtceNo: 'R26BK00000211', bidNtceOrd: '000', bidNtceNm: '정보시스템 통합유지관리 용역', ntceInsttNm: '충청남도교육청', dminsttNm: '충청남도교육청', bidNtceDt: '2026-10-10 10:00:00', bidClseDt: '2099-11-12 10:00:00', opengDt: '2099-11-12 11:00:00', cntrctCnclsMthdNm: '협상에의한계약', presmptPrce: '820000000', asignBdgtAmt: '902000000', ntceKindNm: '등록공고', ntceSpecFileNm1: '제안요청서.hwpx', ntceSpecDocUrl1: 'https://www.g2b.go.kr/d1', ntceSpecFileNm2: '과업지시서.hwp', ntceSpecDocUrl2: 'https://www.g2b.go.kr/d2', stdNtceDocUrl: 'https://www.g2b.go.kr/std', bidNtceDtlUrl: 'https://www.g2b.go.kr/n', techAbltEvlRt: '80', bidPrceEvlRt: '20' },
    { bidNtceNo: 'R26BK00000198', bidNtceOrd: '001', bidNtceNm: '청사 방수공사', ntceInsttNm: '충청남도교육청', bidNtceDt: '2026-10-01 09:00:00', bidClseDt: '2026-10-05 10:00:00', presmptPrce: '150000000', ntceKindNm: '변경공고', ntceSpecFileNm1: '시방서.pdf', ntceSpecDocUrl1: 'https://www.g2b.go.kr/d3' },
  ]);
  if (op.startsWith('getBidPblancListInfo') && /^(getBidPblancListInfo)(Thng|Cnstwk|Servc|Frgcpt)$/.test(op)) return wrap([{ bidNtceNo: 'R26BK00000101', bidNtceOrd: '000', bidNtceNm: '정보시스템 통합유지관리 용역', bidNtceDt: '2026-07-20 10:00:00', bidClseDt: '2026-08-10 10:00:00', opengDt: '2026-08-11 11:00:00', presmptPrce: '830000000', asignBdgtAmt: '913000000', bidNtceDtlUrl: 'https://www.g2b.go.kr/n' }]);
  if (op === 'getShoppingMallPrdctInfoList') return wrap([
    { prdctImgUrl: 'https://shop.g2b.go.kr/x.jpg', cntrctCorpNm: '우영테크', cntrctCorpBizno: '3052852824', entrprsDivNm: '중소기업', cntrctMthdNm: '제3자단가계약', exclncPrcrmntPrdctYn: 'N', masYn: 'Y', cntrctPrceAmt: '33000', prdctUnit: 'm', prdctMakrNm: '우영테크', prdctSplyRgnNm: '전지역', dlvrTmlmtDaynum: '30', prdctClsfcNo: '30161908', prdctClsfcNoNm: '계단부품', dtilPrdctClsfcNo: '3016190801', dtilPrdctClsfcNoNm: '논슬립', prdctIdntNo: '26052231', prdctSpecNm: '논슬립, 우영테크, HS-100CAP', shopngCntrctNo: 'R26TA0155571200', shopngCntrctSno: '15', cntrctBgnDate: '20260301', cntrctEndDate: '20270131', prodctCertList: '소상공인', rgstDt: '20260301' },
    { cntrctCorpNm: '가나다정보통신(주)', cntrctCorpBizno: '1234567890', entrprsDivNm: '중소기업', cntrctMthdNm: '다수공급자계약', exclncPrcrmntPrdctYn: 'Y', cntrctPrceAmt: '29000', prdctUnit: 'm', prdctClsfcNoNm: '계단부품', dtilPrdctClsfcNoNm: '논슬립', prdctIdntNo: '26052299', prdctSpecNm: '논슬립, 가나다, GN-1', shopngCntrctNo: 'R26TA0100000100', shopngCntrctSno: '1', rgstDt: '20260601' },
  ]);
  if (op === 'getSpcifyPrdlstPrcureInfoList') return wrap([{ cntrctDlvrReqDate: '20261010', dminsttNm: '충청남도교육청 ○○초', prdctIdntNoNm: '논슬립, 우영테크', bizno: '3052852824', corpNm: '우영테크', prdctUprc: '33000', prdctQty: '120', prdctUnit: 'm', fnlCntrctDlvrReqChgOrdYn: 'Y' }]);
  if (op === 'getDlvrReqInfoList') return wrap([
    { dlvrReqNo: 'R26TB00000001', dlvrReqChgOrd: '00', dlvrReqRcptDate: '2026-11-02', dlvrReqNm: '○○초 교실 책상 구매', dlvrReqAmt: '12000000', dminsttNm: '충청남도교육청', corpNm: '가나다정보통신(주)', corpBizno: '1234567890', corpEntrprsDivNmNm: '중소기업', rprsntPrdctClsfcNoNm: '책상', rprsntDtilPrdctClsfcNoNm: '학생용책상', maxDlvrTmlmtDate: '2026-12-10', cntrctCnclsStleNm: '제3자단가', masYn: 'Y' },
    { dlvrReqNo: 'R26TB00000002', dlvrReqChgOrd: '01', dlvrReqRcptDate: '2026-10-20', dlvrReqNm: '급식실 냉장고 구매', dlvrReqAmt: '5000000', dminsttNm: '충청남도교육청', corpNm: '라마바(주)', corpBizno: '2223334445', rprsntPrdctClsfcNoNm: '냉장고', maxDlvrTmlmtDate: '2026-11-30', cntrctCnclsStleNm: '일반단가' },
  ]);
  if (op === 'getDlvrReqDtlInfoList') return wrap([{ prdctIdntNoNm: '학생용책상, 가나다, DK-1', prdctIdntNo: '24459422', prdctQty: '40', prdctUnit: '개', prdctUprc: '300000', prdctAmt: '12000000', dlvrPlceNm: '○○초등학교', dlvrTmlmtDate: '20261210' }]);
  if (op === 'getThngPrdnmLocplcAccotListInfoInfoPrdnmSearch02') return wrap([{ prdctClsfcNo: '56101703', prdctClsfcNoNm: '책상', prdctClsfcNoEngNm: 'Desks', dtilPrdctClsfcNo: '5610170301', dtilPrdctClsfcNoNm: '책상' }, { prdctClsfcNo: '56101703', prdctClsfcNoNm: '책상', dtilPrdctClsfcNo: '5610170302', dtilPrdctClsfcNoNm: '학생용책상' }]);
  if (op === 'getThngPrdnmLocplcAccotListInfoInfoLocplcSearch02') return wrap([{ prdctIdntNo: '24459422', krnPrdctNm: '책상, 가나다, DK-1', mnfctCorpNm: '가나다정보통신(주)', rgnNm: '충청남도 아산시', useYn: 'Y' }, { prdctIdntNo: '24459999', krnPrdctNm: '책상, 서울가구, S-1', mnfctCorpNm: '서울가구', rgnNm: '서울특별시 강남구', useYn: 'Y' }]);
  if (op === 'getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02') return wrap([{ prdctIdntNo: '24459422', krnPrdctNm: '책상, 가나다, DK-1' }, { prdctIdntNo: '24459999', krnPrdctNm: '책상, 서울가구, S-1' }]);
  if (op === 'getPrdctIndvAtrbInfoList02') return wrap([{ attrNm: '가로', attrVal: '1200', attrUnit: 'mm' }, { attrNm: '재질', attrVal: '스틸', attrUnit: '' }]);
  if (op.startsWith('getCntrctProcssIntgOpen')) return wrap([{ orderPlanNo: '5-1-2026-8340103-000004-00', orderPlanUntyNo: '5-1-2026-8340103-000004', orderBizNm: '정보시스템 통합유지관리', orderInsttNm: '충청남도교육청', orderYm: '2026-07', prcrmntMethdNm: '자체조달', cntrctCnclsMthdNm: '협상', bfSpecRgstNo: 'R26BD00011111', bfSpecBizNm: '정보시스템 통합유지관리 용역', opninRgstClseDt: '2026-07-10 10:00', bidNtceNo: 'R26BK00000211', bidwinrInfoList: '[1^가나다정보통신(주)^1234567890^홍길동^800000000^88.041^5^2026-08-11 11:00]', cntrctInfoList: '[1^2026090000001^정보시스템 통합유지관리 용역^충청남도교육청^충청남도교육청^협상에의한계약^912000000^2026-09-15]' }]);
  if (op.startsWith('getPublicPrcureThngInfo')) return wrap([{ bsnsDivNm: '일반용역', refNo: '정보-123', prdctClsfcNoNm: '정보시스템 통합유지관리 용역', orderInsttNm: '충청남도교육청', rlDminsttNm: '충청남도교육청', asignBdgtAmt: '902000000', rcptDt: '2026-07-01 09:00:00', opninRgstClseDt: '2026-07-10 10:00:00', swBizObjYn: 'Y', bfSpecRgstNo: 'R26BD00011111', specDocFileUrl1: 'https://www.g2b.go.kr/s1', prdctDtlList: '[1^8111159901^정보시스템유지관리서비스]', bidNtceNoList: 'R26BK00000211' }]);
  if (op.startsWith('getPublicPrcureThngOpinionInfo')) return wrap([{ opninNo: '1', rplyNo: '0', opninTitl: '과업 범위 문의', mkngCorpNm: '라마바(주)', mkrNm: '김비공개', mkrTel: '01000000000', mkrEmail: 'secret@x.kr', inptDt: '2026-07-05 10:00:00', opninCntnts: '과업 범위를 확인 부탁드립니다.' }, { opninNo: '1', rplyNo: '1', opninTitl: '관련 답변', mkngCorpNm: '충청남도교육청', inptDt: '2026-07-06 10:00:00', opninCntnts: '답변 드립니다.' }]);
  if (/^getScsbidListSttus/.test(op)) {
    const w1 = { bidNtceNo: 'R26BK00000211', bidNtceNm: '정보시스템 통합유지관리 용역', dminsttNm: '충청남도교육청', bidNtceOrd: '000', bidClsfcNo: '0', rbidNo: '000', prtcptCnum: '5', bidwinnrNm: '가나다정보통신(주)', bidwinnrBizno: '1234567890', bidwinnrCeoNm: '홍길동', bidwinnrAdrs: '충청남도 아산시 수장로 67', sucsfbidAmt: '800000000', sucsfbidRate: '88.041', rlOpengDt: '2026-08-11 11:00:00', fnlSucsfDate: '2026-08-20' };
    const w2 = { bidNtceNo: 'R26BK00000198', bidNtceNm: '청사 방수공사', dminsttNm: '서울시', bidNtceOrd: '001', bidClsfcNo: '0', rbidNo: '000', prtcptCnum: '9', bidwinnrNm: '라마바(주)', bidwinnrBizno: '2223334445', bidwinnrAdrs: '서울특별시 강남구 언주로 609', sucsfbidAmt: '140000000', sucsfbidRate: '90.1', rlOpengDt: '2026-10-06 11:00:00' };
    if (u.searchParams.get('inqryDiv') === '4') return wrap(u.searchParams.get('bidNtceNo') === 'R26BK00000198' ? [w2] : [w1]);
    return wrap([w1, w2]);
  }
  if (op === 'getOpengResultListInfoOpengCompt') return wrap([{ opengRank: '2', prcbdrBizno: '2223334445', prcbdrNm: '라마바(주)', bidprcAmt: '810000000', bidprcrt: '89.1', rmrk: '' }, { opengRank: '1', prcbdrBizno: '1234567890', prcbdrNm: '가나다정보통신(주)', bidprcAmt: '800000000', bidprcrt: '88.041', rmrk: '낙찰', techEvlVal: '81.5', bidPrceEvlVal: '9.5', totalEvlAmtVal: '91.0' }]);
  if (/PreparPcDetail$/.test(op)) return wrap([{ compnoRsrvtnPrceSno: '1', bsisPlnprc: '905000000', drwtYn: 'Y', drwtNum: '2', plnprc: '908000000', bssamt: '910000000', totRsrvtnPrceNum: '15', bidwinrSlctnAplBssCntnts: '조달청' }]);
  if (op === 'getBidPblancListInfoEorderAtchFileInfo') return wrap([{ eorderDocDivNm: '제안요청서', eorderAtchFileNm: '제안요청서_최종.hwpx', eorderAtchFileUrl: 'https://www.g2b.go.kr/e1' }]);
  if (op === 'getBidPblancListInfoLicenseLimit') return wrap({ item: [{ lcnsLmtNm: '토목공사업/0001', permsnIndstrytyList: '' }] });
  if (op === 'getBidPblancListInfoPrtcptPsblRgn') return wrap([{ prtcptPsblRgnNm: '충청남도' }]);
  if (/BsisAmount$/.test(op)) return wrap([{ bssamt: '890000000', bssamtOpenDt: '2026-10-20 10:00', rsrvtnPrceRngBgnRate: '-2', rsrvtnPrceRngEndRate: '+2' }]);
  if (/ChgHstry/.test(op)) return wrap([{ chgDt: '2026-10-16 09:00', chgItemNm: '입찰마감일시', bfchgVal: '2026-11-05', afchgVal: '2026-11-12' }]);
  if (op === 'getPrcrmntCorpBasicInfo02' && u.searchParams.get('bizno') === '3052852824') return wrap([{ bizno: '3052852824', corpNm: '우영테크', rgnNm: '경기도 화성시' }]);
  if (op === 'getPrcrmntCorpBasicInfo02' && u.searchParams.get('bizno') === '2223334445') return wrap([{ bizno: '2223334445', corpNm: '라마바(주)', rgnNm: '서울특별시 강남구' }]);
  if (op === 'getPrcrmntCorpBasicInfo02') return wrap([{ bizno: '1234567890', corpNm: '가나다정보통신(주)', ceoNm: '홍길동', adrs: '충청남도 홍성군', telNo: '041-000-0000', corpBsnsDivNm: '물품,용역', opbizDt: '2001-01-01 00:00:00' }]);
  if (op === 'getPrcrmntCorpIndstrytyInfo02') return wrap([{ indstrytyNm: '소프트웨어사업자', indstrytyCd: '1468', rprsntIndstrytyYn: 'Y', indstrytyStatsNm: '정상', vldPrdExprtDt: '2027-01-01' }]);
  if (op === 'getPrcrmntCorpSplyPrdctInfo02') return wrap([{ dtilPrdctClsfcNoNm: '정보시스템유지관리서비스', dtilPrdctClsfcNo: '8111229901', rprsntPrdctClsfcNoNmYn: 'Y', mnfctYn: 'N' }]);
  if (op === 'getUnptRsttCorpInfo02') return u.searchParams.get('bizno') === '9999999999'
    ? wrap([{ bizno: '9999999999', corpNm: '하나둘건설(주)', rsttBgnDate: '2026-08-01', rsttEndDate: '2099-01-31', insttNm: '○○교육청', lawordNm: '지방계약법', lawordArtclClause: '법31조', enfcPrvNm: '계약 미이행', rsttProgrsNm: '제재' }])
    : JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } });
  if (op === 'getDminsttInfo02') return wrap([{ dminsttNm: '충청남도교육청' }]);
  if (op === 'getIndstrytyBaseLawrgltInfoList') return wrap([
    { indstrytyClsfcCd: '03', indstrytyClsfcNm: '법무', indstrytyCd: '1461', indstrytyNm: '법무사업(사무소)', baseLawordNm: '법무사법', baseLawordArtclClauseNm: '제14조', baseLawordUrl: 'https://www.g2b.go.kr/law', rltnRgltCntnts: '법무사법 제7조', inclsnLcns: '', indstrytyUseYn: 'Y', indstrytyRgstDt: '2006-01-12 18:43' },
    { indstrytyClsfcCd: '41', indstrytyClsfcNm: '국토개발', indstrytyCd: '0001', indstrytyNm: '토목공사업', baseLawordNm: '건설산업기본법', baseLawordArtclClauseNm: '제9조', inclsnLcns: '[1^0001^토목공사업^0003^토목건축공사업],', indstrytyUseYn: 'Y', indstrytyRgstDt: '2006-01-12 18:43' },
    { indstrytyClsfcCd: '41', indstrytyClsfcNm: '국토개발', indstrytyCd: '0003', indstrytyNm: '토목건축공사업', baseLawordNm: '건설산업기본법', baseLawordArtclClauseNm: '제9조', indstrytyUseYn: 'Y', indstrytyRgstDt: '2006-01-12 18:43' },
    { indstrytyClsfcCd: '20', indstrytyClsfcNm: '정보통신', indstrytyCd: '1468', indstrytyNm: '소프트웨어사업자', baseLawordNm: '소프트웨어 진흥법', baseLawordArtclClauseNm: '제58조', indstrytyUseYn: 'Y', indstrytyRgstDt: '2010-01-01 00:00' },
  ]);
  return wrap([]);
}
globalThis.fetch = async (url) => new Response(fixture(String(url)), { headers: { 'content-type': 'application/json' } });

const call = async (mod, url, env = ENV) => {
  const res = await mod.onRequestGet({ request: new Request(url), env, waitUntil() {} });
  return { status: res.status, text: await res.text(), headers: res.headers };
};

// ---------- 1. 서버 함수 ----------
console.log('서버 함수');
{
  const r = await call(g2b, 'http://x/api/g2b?svc=cntrct&op=getCntrctInfoListServcPPSSrch&inqryDiv=1&insttNm=충청남도교육청');
  const j = JSON.parse(r.text);
  ok(j.ok && j.items.length === 2 && j.totalCount === 2, '계약 조회 정상 응답 정리');
  ok(!r.text.includes(KEY) && !r.text.includes(encodeURIComponent(KEY)), '응답에 인증키 없음');
  const last = calls[calls.length - 1];
  ok(last.searchParams.get('ServiceKey') === KEY, '인증키가 올바르게 인코딩되어 전달됨');
  ok(last.searchParams.get('type') === 'json', 'type=json 강제');
  ok(last.searchParams.get('insttNm') === '충청남도교육청', '한글 파라미터 전달');
}
{
  const r = await call(g2b, 'http://x/api/g2b?svc=cntrct&op=evilOp');
  ok(r.status === 400, '허용되지 않은 오퍼레이션 차단');
  const r2 = await call(g2b, 'http://x/api/g2b?svc=usr&op=getUnptRsttCorpInfo02&ServiceKey=hack&inqryDiv=1&bizno=1', ENV);
  ok(calls[calls.length - 1].searchParams.getAll('ServiceKey').length === 1 && calls[calls.length - 1].searchParams.get('ServiceKey') === KEY, '사용자가 넣은 ServiceKey 무시');
  { const j2 = JSON.parse(r2.text); ok(j2.ok && j2.items.length === 0, '결과없음(03)은 빈 정상 결과로(캐시 가능)'); }
  const r3 = await call(g2b, 'http://x/api/g2b?svc=bid&op=getBidPblancListInfoServc', {});
  ok(r3.status === 500 && JSON.parse(r3.text).code === 'NOKEY', '키 미설정 시 안내');
}
{
  { const j = g2b.normalize(JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } })); ok(!j.ok && j.code === '30', 'JSON 형식 인증키 오류도 오류로 처리'); }
  const n = g2b.normalize('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>');
  ok(!n.ok && n.code === '30' && /인증키/.test(n.msg), 'XML 인증키 오류 → 한글 안내');
  const n2 = g2b.normalize(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: { a: 1 } }, totalCount: 1 } } }));
  ok(n2.ok && Array.isArray(n2.items) && n2.items.length === 1, 'items.item 단건 객체 → 배열');
  const n3 = g2b.normalize(JSON.stringify({ 'nkoneps.com.response.ResponseError': { header: { resultCode: '07', resultMsg: '입력범위값 초과 에러' } } }));
  ok(!n3.ok && n3.code === '07', '나라장터 오류 형식 인식');
}
{
  const r = await call(law, 'http://x/api/law?mode=list&query=계약');
  const j = JSON.parse(r.text);
  ok(j.ok && !r.text.includes(OC), '법령해석 목록 정상 · OC 숨김');
  ok(calls[calls.length - 1].searchParams.get('target') === 'ppsCgmExpc', 'target=ppsCgmExpc');
  const h = await call(law, 'http://x/api/law?mode=html&ID=431416');
  ok(h.text.includes('<base href="https://www.law.go.kr/">') && !h.text.includes(OC), '원문 HTML · base 태그 · OC 숨김');
  const d = await call(law, 'http://x/api/law?mode=detail');
  ok(d.status === 400, 'ID 없는 본문 요청 차단');
}
{
  const r = await call(health, 'http://x/api/health');
  ok(r.text === '{"g2b":true,"law":true}', 'health는 설정 여부만 반환');
}

{
  // 서버 캐시: 오래된 결과는 바로 돌려주고 뒤에서 새로 받음
  const store = new Map();
  globalThis.caches = { default: { match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { store.set(req.url, res); } } };
  const waits = [];
  const ctx = (u) => ({ request: new Request(u), env: ENV, waitUntil: (p) => waits.push(p) });
  const U = 'http://x/api/g2b?svc=cntrct&op=getCntrctInfoListServcPPSSrch&inqryDiv=1&insttNm=A';
  const before = calls.length;
  const r1 = await g2b.onRequestGet(ctx(U));
  ok(r1.headers.get('x-cache') === 'miss' && calls.length === before + 1, '서버 캐시: 처음엔 나라장터 호출');
  const r2 = await g2b.onRequestGet(ctx(U));
  ok(r2.headers.get('x-cache') === 'fresh' && calls.length === before + 1, '서버 캐시: 10분 안에는 호출 없이 바로 응답');
  // 11분 지난 것으로 만들기
  const KU = U + '&_cv=2'; const old = store.get(KU); const body = await old.clone().text(); const h = new Headers(old.headers); h.set('x-fetched-at', String(Date.now() - 11 * 60e3));
  store.set(KU, new Response(body, { headers: h }));
  const r3 = await g2b.onRequestGet(ctx(U));
  ok(r3.headers.get('x-cache') === 'stale' && JSON.parse(await r3.text()).items.length === 2, '서버 캐시: 오래된 결과를 기다림 없이 바로 응답');
  await Promise.all(waits);
  ok(calls.length === before + 2 && Number(store.get(KU).headers.get('x-fetched-at')) > Date.now() - 5000, '서버 캐시: 뒤에서 새로 받아 저장');
  delete globalThis.caches;
}

{
  // GitHub 주소 화면에서의 조회 허용(CORS)
  const gh = 'https://jdh8429-svg.github.io';
  const pre = await mw.onRequest({ request: new Request('http://x/api/g2b', { method: 'OPTIONS', headers: { Origin: gh } }), next: async () => new Response('x') });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === gh, 'CORS: GitHub 주소 사전 확인 허용');
  const r = await mw.onRequest({ request: new Request('http://x/api/g2b', { headers: { Origin: gh } }), next: async () => new Response('{}', { headers: { 'x-cache': 'fresh' } }) });
  ok(r.headers.get('access-control-allow-origin') === gh && r.headers.get('access-control-expose-headers').includes('x-fresh'), 'CORS: GitHub 주소 응답 허용');
  const evil = await mw.onRequest({ request: new Request('http://x/api/g2b', { headers: { Origin: 'https://evil.example' } }), next: async () => new Response('{}') });
  ok(!evil.headers.get('access-control-allow-origin'), 'CORS: 다른 사이트는 허용 안 함');
}
{
  // 나라장터 연결 지연(522)
  const r1 = JSON.parse((await call(g2b, 'http://x/api/g2b?svc=bid&op=getBidPblancListInfoServcPPSSrch&inqryDiv=1&bidNtceNm=지연1')).text);
  ok(r1.ok, '522가 한 번 나면 서버가 다시 시도해 정상 응답');
  const r2 = JSON.parse((await call(g2b, 'http://x/api/g2b?svc=bid&op=getBidPblancListInfoServcPPSSrch&inqryDiv=1&bidNtceNm=지연항상')).text);
  ok(!r2.ok && r2.code === 'UPSTREAM' && r2.msg.includes('지연'), `계속 522면 알기 쉬운 안내 (${r2.msg})`);
}
{
  // 지난 기간은 오래 보관 (호출 최소화)
  const kst = (d) => new Date(Date.now() + 9 * 3600e3 - d * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const F = (svc, q) => g2b.freshSeconds(svc, 'x', new URLSearchParams(q));
  ok(F('cntrct', `inqryEndDate=${kst(0)}`) === 600, '보관: 오늘 포함 기간은 10분');
  ok(F('cntrct', `inqryEndDate=${kst(3)}`) === 86400 && F('bid', `inqryEndDt=${kst(3)}2359`) === 86400, '보관: 1주 이내 지난 기간은 1일');
  ok(F('bid', `inqryEndDt=${kst(30)}2359`) === 7 * 86400, '보관: 그 이전 기간은 7일');
  ok(F('scsbid', `inqryDiv=1&inqryEndDt=${kst(30)}2359`) === 6 * 3600 && F('scsbid', `inqryDiv=1&inqryEndDt=${kst(90)}2359`) === 7 * 86400, '보관: 공고일 기준 낙찰 결과는 60일까지 6시간');
  ok(F('usr', 'bizno=1') === 259200 && F('intg', 'bidNtceNo=1') === 3600, '보관: 업체정보 3일 · 공고번호 조회 1시간');
}
{
  // 관리자 전용 호출 통계
  const store = new Map();
  globalThis.caches = { default: { match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { store.set(req.url, res); } } };
  const waits = [];
  const ctx = (u, h) => ({ request: new Request(u, { headers: h || {} }), env: ENV, waitUntil: (p) => waits.push(p) });
  const U = 'http://x/api/g2b?svc=bid&op=getBidPblancListInfoServcPPSSrch&inqryDiv=1&bidNtceNm=통계';
  await g2b.onRequestGet(ctx(U)); await g2b.onRequestGet(ctx(U)); await g2b.onRequestGet(ctx(U));
  await Promise.all(waits);
  const no = await stats.onRequestGet(ctx('http://x/api/stats'));
  const bad = await stats.onRequestGet(ctx('http://x/api/stats', { 'x-admin-token': 'wrong' }));
  ok(JSON.parse(await no.text()).ok === false && JSON.parse(await bad.text()).code === 'DENIED', '통계: 토큰 없거나 틀리면 차단');
  const good = await stats.onRequestGet(ctx('http://x/api/stats?days=1', { 'x-admin-token': 'admin-secret-1' }));
  const j = JSON.parse(await good.text());
  const row = j.days[0].rows['bid|getBidPblancListInfoServcPPSSrch'] || {};
  ok(j.ok && row.up >= 1 && row.hit === 2, `통계: 실제 호출 · 저장본 응답 2회 집계 (${JSON.stringify(row)})`);
  const none = await stats.onRequestGet({ request: new Request('http://x/api/stats', { headers: { 'x-admin-token': 'a' } }), env: {} });
  ok(JSON.parse(await none.text()).code === 'NOTOKEN', '통계: 토큰이 설정되지 않으면 열리지 않음');
  delete globalThis.caches;
}

// ---------- 2. 화면 ----------
let chromium;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch (e) { console.log('\n(playwright 없음 – 화면 테스트 생략)'); }
if (chromium) {
  console.log('\n화면');
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const mod = { '/api/g2b': g2b, '/api/law': law, '/api/health': health, '/api/stats': stats }[u.pathname];
    if (mod) {
      const r = await mod.onRequestGet({ request: new Request(u.href, { headers: req.headers['x-admin-token'] ? { 'x-admin-token': req.headers['x-admin-token'] } : {} }), env: ENV, waitUntil() {} });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
      return;
    }
    const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const shots = path.join(root, 'test', 'screens');
  fs.mkdirSync(shots, { recursive: true });
  for (const vp of [{ name: 'pc', width: 1366, height: 900 }, { name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 820, height: 1180 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/(shop|img)\.g2b\.go\.kr/, (r) => r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }));
    const shot = (n) => page.screenshot({ path: path.join(shots, `${vp.name}-${n}.png`), fullPage: true });

    calls.length = 0;
    await page.goto(base + '/');
    await page.waitForSelector('#clist table');
    await page.waitForSelector('#crecent table');
    {
      const n = (op) => calls.filter((u) => u.pathname.endsWith(op)).length;
      const now = new Date(); const from = new Date(now); from.setMonth(from.getMonth() - 1); from.setDate(from.getDate() + 1);
      ok(n('getCntrctInfoListServcPPSSrch') === 1, `[${vp.name}] 첫 화면: 용역 1개월을 한 번에, 최근 1개월은 재사용 (${n('getCntrctInfoListServcPPSSrch')}회)`);
      ok(calls.length === 3, `[${vp.name}] 첫 화면 전체 API 호출 ${calls.length}회 (용역 1 + 물품·공사 최근 1개월 각 1)`);
      ok(!(await page.locator('#clist .err').count()), `[${vp.name}] 기간 제한에 걸리지 않음`);
      calls.length = 0;
      await page.click('#nav a[href="#corp"]');
      await page.click('#nav a[href="#contract"]');
      await page.waitForSelector('#clist table');
      ok(calls.length === 0, `[${vp.name}] 메뉴를 오가도 다시 호출하지 않음 (${calls.length}회)`);
    }
    ok(await page.locator('#nav a').count() === 8, `[${vp.name}] 메뉴 8개`);
    ok((await page.textContent('.brand')).includes('충청남도교육청 계약 업무 도우미'), `[${vp.name}] 제목`);
    await page.waitForSelector('#crecent table');
    ok(await page.locator('#crecent tbody tr').count() > 0, `[${vp.name}] 우리 기관 최근 계약 표시`);
    ok((await page.textContent('#clist a.linkbtn >> nth=0')).includes('급식기구'), `[${vp.name}] 계약 목록 최근순 정렬`);
    await page.click('#clist a.linkbtn >> nth=1');
    await page.waitForSelector('#cdetail:not([hidden])');
    ok(/c=2026090000001/.test(page.url()), `[${vp.name}] 계약 상세가 주소에 기록됨`);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#cdetail').hidden);
    ok(/#contract/.test(page.url()) && (await page.textContent('#ptitle')) === '계약 관리', `[${vp.name}] 뒤로 가기 → 상세 닫히고 계약 관리 유지`);
    await page.goForward();
    await page.waitForSelector('#cdetail:not([hidden])');
    ok(true, `[${vp.name}] 앞으로 가기 → 상세 다시 열림`);
    await page.click('#dflow');
    await page.waitForSelector('#dsub .timeline');
    ok(await page.locator('#dsub .timeline li').count() >= 4, `[${vp.name}] 공고→계약 흐름`);
    await page.click('#dhist');
    await page.waitForSelector('#dsub table');
    ok(true, `[${vp.name}] 계약 변경이력`);
    await shot('1-contract');
    await page.click('.tab[data-biz="공사"]');
    await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]').textContent === '공사');
    await page.waitForSelector('#clist a.linkbtn');
    ok((await page.textContent('#clist a.linkbtn >> nth=0')).includes('외부 도장 공사'), `[${vp.name}] 공사 계약명(공사명) 표시`);
    calls.length = 0;
    await page.fill('#cform input[name="q"]', '도장');
    await page.click('#cform button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#clist .loading'));
    ok(calls.some((u) => u.pathname.endsWith('CnstwkPPSSrch') && u.searchParams.get('cnstwkNm') === '도장' && !u.searchParams.get('cntrctNm')), `[${vp.name}] 공사 검색은 공사명(cnstwkNm)으로 요청`);
    await page.click('.tab[data-biz="용역"]');
    await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]').textContent === '용역');
    await page.waitForSelector('#clist a.linkbtn');
    // 저장된 목록이 바로 보이는지 (새로 고침 후)
    await page.reload();
    ok(await page.locator('#clist a.linkbtn').count() > 0, `[${vp.name}] 새로 열어도 저장된 목록이 바로 표시`);
    await page.waitForFunction(() => !document.querySelector('#clist .loading'));
    await page.click('#clist a.linkbtn >> nth=1');
    await page.waitForSelector('#cdetail:not([hidden])');

    await page.click('#cdetail a[href^="#corp/"]');
    await page.waitForSelector('#kresult .banner');
    ok(await page.locator('.banner.ok').count() === 1, `[${vp.name}] 업체 확인 – 제재 없음`);
    await page.waitForSelector('#kresult .indref a');
    ok((await page.textContent('#kresult .indref')).includes('소프트웨어 진흥법'), `[${vp.name}] 업체 등록업종에 근거법규 표시`);
    await page.goBack();
    await page.waitForSelector('#cdetail:not([hidden])');
    ok((await page.textContent('#ptitle')) === '계약 관리', `[${vp.name}] 업체 확인에서 뒤로 가기 → 계약 상세로 복귀`);
    await page.goForward();
    await page.waitForSelector('#kresult .banner');
    await shot('2-corp-ok');
    await page.goto(base + '/#corp/9999999999');
    await page.waitForSelector('.banner.bad');
    ok(true, `[${vp.name}] 업체 확인 – 제재 업체 경고`);
    await shot('2-corp-bad');

    await page.fill('#gq', '통합유지관리');
    await page.click('.gbtn');
    await page.waitForSelector('#slist .result');
    ok(await page.locator('#slist .result').count() === 2, `[${vp.name}] 유사사업 검색 (월별 분할 결과 중복 제거)`);
    ok(await page.locator('#slist .doc').count() >= 3, `[${vp.name}] 공고문서 칩`);
    await page.click('#slist button[data-act="eorder"]');
    await page.waitForSelector('#ssub-0 .doc');
    await page.click('#slist button[data-act="flow"]');
    await page.waitForSelector('#ssub-0 .steps button[aria-selected="true"]');
    ok((await page.getAttribute('#ssub-0 button[data-step="win"]', 'aria-selected')) === 'true', `[${vp.name}] 계약과정: 낙찰 단계가 먼저 열림`);
    await page.waitForSelector('#ssub-0 .stepbody h4');
    ok((await page.textContent('#ssub-0 .stepbody')).includes('88.041%') && await page.locator('#ssub-0 .stepbody a[href="#corp/1234567890"]').count() > 0, `[${vp.name}] 낙찰: 낙찰률·개찰순위·업체 확인 링크`);
    ok(decodeURIComponent(page.url()).includes('flow=R26BK00000211'), `[${vp.name}] 주소에 공고 기록`);
    await page.click('#ssub-0 button[data-step="spec"]');
    await page.waitForSelector('#ssub-0 .opinions');
    { const tx = await page.textContent('#ssub-0 .stepbody'); ok(tx.includes('902,000,000원') && tx.includes('과업 범위 문의') && !tx.includes('secret@x.kr') && !tx.includes('김비공개'), `[${vp.name}] 사전규격: 예산·의견 표시, 작성자 개인정보 숨김`); }
    ok(page.url().includes('step=spec'), `[${vp.name}] 단계가 주소에 기록됨 (로컬 링크)`);
    await page.locator('#ssub-0').screenshot({ path: path.join(shots, `${vp.name}-3b-flow-spec.png`) });
    await page.click('#ssub-0 button[data-step="win"]');
    await page.waitForSelector('#ssub-0 .stepbody h4');
    await page.locator('#ssub-0').screenshot({ path: path.join(shots, `${vp.name}-3c-flow-win.png`) });
    await page.click('#ssub-0 button[data-step="plan"]');
    ok((await page.textContent('#ssub-0 .stepbody')).includes('5-1-2026-8340103-000004-00'), `[${vp.name}] 발주계획 단계`);
    await page.click('#ssub-0 button[data-step="bid"]');
    ok(await page.locator('#ssub-0 .stepbody .flowlinks a').count() > 0, `[${vp.name}] 입찰공고 단계 + 조달청 링크`);
    await page.click('#ssub-0 button[data-step="win"]');
    await page.waitForSelector('#ssub-0 .ranktbl .rgn .badge');
    await page.waitForFunction(() => !document.querySelector('#ssub-0 .ranktbl .rgn .muted'));
    ok((await page.textContent('#ssub-0 .ranktbl')).includes('충남 홍성군') && (await page.textContent('#ssub-0 .ranktbl')).includes('서울 강남구'), `[${vp.name}] 개찰 순위에 업체 소재지 표시`);
    await page.check('#ssub-0 .cnonly');
    ok(await page.locator('#ssub-0 .ranktbl tbody tr:visible').count() === 1, `[${vp.name}] 개찰 순위 '충남 업체만'`);
    ok((await page.textContent('#ssub-0 .stepbody')).includes('충청남도 아산시'), `[${vp.name}] 최종낙찰업체 소재지 표시`);
    await page.click('#ssub-0 button[data-step="cntrct"]');
    await page.waitForSelector('#ssub-0 .stepbody table >> visible=true');
    ok((await page.textContent('#ssub-0 .stepbody')).includes('계약 상세'), `[${vp.name}] 계약 단계`);
    { const h = page.url().slice(page.url().indexOf('#')); await page.goto(base + '/' + h.replace('step=cntrct', 'step=spec')); await page.reload(); await page.waitForSelector('#ssub-0 .opinions'); ok(true, `[${vp.name}] 링크로 다시 열면 같은 공고·단계가 펼쳐짐`); }
    ok(true, `[${vp.name}] e발주 문서 · 계약 결과`);
    await page.selectOption('#sform select[name="preset"]', '3');
    const f3 = await page.inputValue('#sform input[name="from"]');
    { const d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(d.getDate() + 1); ok(f3 === d.toISOString().slice(0, 10) || Math.abs(new Date(f3) - d) < 2 * 864e5, `[${vp.name}] 기간 빠른 선택(3개월) → 시작일 ${f3}`); }
    await page.fill('#sform input[name="from"]', '2024-01-01');
    await page.fill('#sform input[name="to"]', '2025-12-31');
    await page.click('#sform button[type="submit"]');
    await page.waitForSelector('#slist .err');
    ok((await page.textContent('#slist .err')).includes('최대 1년'), `[${vp.name}] 1년 넘는 기간은 안내 후 조회 안 함`);
    await page.fill('#sform input[name="from"]', '2025-03-01');
    await page.fill('#sform input[name="to"]', '2025-03-20');
    await page.click('#sform button[type="submit"]');
    await page.waitForSelector('#slist .result');
    ok(await page.locator('#slist .result').count() === 2, `[${vp.name}] 과거 기간(2025년 3월) 직접 입력 조회`);
    await page.selectOption('#sform select[name="doc"]', '과업지시서');
    ok(await page.locator('#slist .result').count() === 1, `[${vp.name}] 문서 종류 필터`);
    await shot('3-similar');

    await page.click('#nav a[href="#notice"]');
    await page.waitForSelector('#nlist table');
    await page.click('#nlist a.linkbtn >> nth=0');
    await page.waitForSelector('#nlist tr.detailrow #ndetail h2');
    ok(await page.evaluate(() => { const d = document.querySelector('#nlist tr.detailrow'); return d && d.previousElementSibling.classList.contains('sel'); }), `[${vp.name}] 공고 상세가 누른 공고 바로 아래에 펼쳐짐`);
    await page.waitForSelector('#ndetail #nflow .steps');
    ok(true, `[${vp.name}] 공고 상세에 계약과정 한눈에 표시`);
    await page.click('#ndetail button[data-x="lic"]');
    await page.waitForSelector('#nsub .indref a');
    ok((await page.textContent('#nsub .indref')).includes('건설산업기본법'), `[${vp.name}] 면허제한에 근거법규 표시`);
    for (const x of ['rgn', 'bss', 'chg']) { await page.click(`#ndetail button[data-x="${x}"]`); await page.waitForSelector('#nsub .sub h3'); }
    ok(true, `[${vp.name}] 공고 상세 – 면허·지역·기초금액·정정이력`);
    await page.click('#ndetail button[data-x="save"]');
    await shot('4-notice');

    await page.click('#nav a[href="#law"]');
    await page.waitForSelector('.lawitem');
    await page.click('.lawitem >> nth=0');
    await page.waitForSelector('#ldetail .lawbody');
    ok((await page.textContent('#ldetail')).includes('회답 본문'), `[${vp.name}] 법령해석 본문`);
    ok(await page.locator('#ldetail a[href*="law.go.kr/"]').count() >= 1, `[${vp.name}] 관련법령 링크`);
    await page.click('#lsave');
    await shot('5-law');
    await page.click('a.tab[href="#law?tab=ind"]');
    await page.waitForSelector('#ilist table');
    ok(await page.locator('#ilist tbody tr').count() === 4, `[${vp.name}] 업종 목록`);
    await page.fill('#iform input[name="q"]', '토목');
    await page.waitForFunction(() => document.querySelectorAll('#ilist tbody tr').length === 2);
    ok(true, `[${vp.name}] 업종 실시간 필터`);
    await page.click('#ilist a.linkbtn >> nth=0');
    await page.waitForSelector('#idetail dl');
    ok((await page.textContent('#idetail')).includes('토목건축공사업'), `[${vp.name}] 업종 상세 · 포함면허`);
    await page.click('#isave');
    await shot('5-industry');
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#idetail dl'));
    ok((await page.textContent('#ptitle')) === '법령 · 해석 찾기', `[${vp.name}] 업종 상세에서 뒤로 가기`);

    await page.click('#nav a[href="#saved"]');
    await page.waitForFunction(() => document.querySelector('#ptitle').textContent === '내 보관함');
    await page.waitForSelector('#view table');
    { const savedTxt = await page.locator('#view tbody td:nth-child(2)').allTextContents(); ok(savedTxt.length === 3, `[${vp.name}] 보관함 저장 항목 ${savedTxt.length === 3 ? '' : JSON.stringify(savedTxt)}`); }
    await shot('6-saved');

    await page.click('#nav a[href="#settings"]');
    await page.waitForSelector('#setform');
    ok(await page.locator('#health').count() === 0, `[${vp.name}] 설정 화면에 연결 상태 숨김`);
    await page.goto(base + '/#settings/check');
    await page.waitForSelector('#health .badge');
    await page.click('#htest');
    await page.waitForFunction(() => document.querySelectorAll('#htestres .badge').length === 8);
    ok(await page.locator('#htestres .badge.grn').count() === 8, `[${vp.name}] 연결 테스트 8개 정상`);
    await shot('7-settings');
    {
      // 휴대폰처럼 기존 주소 뒤에 덧붙여 입력해도 관리자 화면이 열림
      await page.goto(base + '/#contract#settings/check');
      await page.reload();
      await page.waitForSelector('#stform');
      ok(true, `[${vp.name}] '#contract#settings/check'처럼 덧붙여 입력해도 관리자 화면`);
      await page.goto(base + '/#check');
      await page.waitForSelector('#stform');
      ok(true, `[${vp.name}] 짧은 주소 #check`);
      // 관리자 전용 호출 통계 화면
      await page.goto(base + '/#settings/check');
      await page.reload();
      await page.fill('#stform [name=tok]', 'wrong');
      await page.click('#stform button[type=submit]');
      await page.waitForSelector('#stres .err');
      ok((await page.textContent('#stres')).includes('맞지 않습니다'), `[${vp.name}] 통계: 틀린 토큰 차단`);
      await page.fill('#stform [name=tok]', 'admin-secret-1');
      await page.click('#stform button[type=submit]');
      await page.waitForSelector('#stres .stats');
      ok((await page.textContent('#stres')).includes('호출 절약 비율'), `[${vp.name}] 통계: 관리자 토큰으로 열림`);
      ok(!String(await page.evaluate(() => localStorage.getItem('cne.admintok') || '')).includes('admin'), `[${vp.name}] 통계: '기억' 안 하면 토큰 저장 안 함`);
      // 지난 기간 결과는 브라우저(IndexedDB)에 보관 → 새로고침 후 같은 조회는 서버에 묻지 않음
      const url = base + '/#similar/' + encodeURIComponent('과거보관');
      await page.goto(url);
      await page.fill('#sform input[name="from"]', '2025-03-01');
      await page.fill('#sform input[name="to"]', '2025-03-20');
      await page.click('#sform button[type="submit"]');
      await page.waitForSelector('#slist .result, #slist .empty');
      await page.waitForTimeout(400);
      await page.reload();
      await page.fill('#sform input[name="from"]', '2025-03-01');
      await page.fill('#sform input[name="to"]', '2025-03-20');
      const before = calls.length;
      await page.click('#sform button[type="submit"]');
      await page.waitForSelector('#slist .result, #slist .empty');
      const bidCalls = calls.slice(before).filter((u) => /BidPblancListInfo.*PPSSrch/.test(u.pathname)).length;
      ok(bidCalls === 0, `[${vp.name}] 지난 기간 조회는 새로고침 후에도 서버 호출 없음 (${bidCalls}회)`);
    }
    {
      // 물품 · 나라장터 쇼핑몰
      ok((await page.locator('#nav a').nth(5).textContent()).includes('물품 · 나라장터 쇼핑몰') && (await page.locator('#nav a').nth(6).textContent()).includes('내 보관함'), `[${vp.name}] 새 메뉴가 내 보관함 위에`);
      await page.goto(base + '/#goods?q=' + encodeURIComponent('논슬립'));
      await page.reload();
      await page.waitForSelector('#shlist .result.prd');
      ok((await page.locator('#shlist .result.prd h3').first().textContent()).includes('가나다'), `[${vp.name}] 쇼핑몰 상품: 낮은 가격순 정렬`);
      await page.waitForSelector('#shbuy table');
      ok((await page.textContent('#shbuy')).includes('충청남도교육청'), `[${vp.name}] 다른 기관 구매 실적`);
      await page.check('#shcn');
      await page.waitForFunction(() => document.querySelectorAll('#shlist .result.prd').length === 1);
      ok((await page.textContent('#shlist')).includes('가나다'), `[${vp.name}] 쇼핑몰 상품: 충남 업체만`);
      await page.uncheck('#shcn');
      await page.click('#shlist button[data-attr]');
      await page.waitForSelector('#shsub-0 table');
      ok((await page.textContent('#shsub-0')).includes('스틸'), `[${vp.name}] 규격 · 속성 보기`);
      await page.click('#view .tabs a:nth-child(2)');
      await page.waitForSelector('#dlres table');
      ok((await page.textContent('#dlres')).includes('○○초 교실 책상 구매') && (await page.textContent('#dlres .stats')).includes('17,000,000원'), `[${vp.name}] 납품요구 실적 목록 · 합계`);
      await page.click('#dlres button[data-dl]');
      await page.waitForSelector('#dldtl table');
      ok((await page.textContent('#dldtl')).includes('학생용책상'), `[${vp.name}] 납품요구 품목 상세`);
      await page.click('#view .tabs a:nth-child(3)');
      await page.fill('#clform [name=q]', '책상');
      await page.click('#clform button[type=submit]');
      await page.waitForSelector('#clprd table');
      ok(await page.locator('#clprd tbody tr:not([hidden])').count() === 2, `[${vp.name}] 물품분류: 품목 · 제조업체`);
      await page.check('#clcn');
      ok(await page.locator('#clprd tbody tr:not([hidden])').count() === 1, `[${vp.name}] 물품분류: 충남 제조업체만`);
      await shot('9-goods');
      // 사이트 이름 누르면 입력 내용 초기화 + 첫 화면
      await page.click('.brand');
      await page.waitForSelector('#clist');
      ok(!page.url().includes('#goods') && !String(await page.evaluate(() => sessionStorage.getItem('cne.last'))).includes('goods'), `[${vp.name}] 사이트 이름 → 초기화 후 첫 화면`);
      await page.click('#nav a[href="#goods"]');
      await page.waitForSelector('#shform');
      ok((await page.inputValue('#shform [name=q]')) === '', `[${vp.name}] 초기화 후 이전 검색어 없음`);
    }
    {
      // 낙찰업체 지역 필터 (유사사업 찾기)
      await page.goto(base + '/#similar/' + encodeURIComponent('유지관리'));
      await page.reload();
      await page.waitForSelector('#slist .result');
      const all = await page.locator('#slist .result').count();
      await page.selectOption('#sform [name=rgn]', '충남');
      await page.waitForSelector('#slist .winline');
      ok(await page.locator('#slist .result').count() === 1 && all > 1 && (await page.textContent('#slist .winline')).includes('충남 아산시'), `[${vp.name}] 유사사업: 충남 업체 낙찰 공고만 (${all}건 → 1건)`);
      ok(decodeURIComponent(page.url()).includes('rgn=충남') && (await page.textContent('#ssum')).includes('그중 충남 업체'), `[${vp.name}] 지역 필터가 주소에 남고 요약 표시`);
      await page.selectOption('#sform [name=rgn]', '');
      // 충남 업체 낙찰 실적 (업체 확인)
      await page.goto(base + '/#corp');
      await page.click('#cnform button[type=submit]');
      await page.waitForSelector('#cnlist table');
      { const tx = await page.textContent('#cnlist'); ok(tx.includes('가나다정보통신') && !tx.includes('라마바'), `[${vp.name}] 업체 확인: 충남 업체 낙찰 실적만 집계`); }
      await page.click('#cnlist button[data-cn]');
      ok(await page.locator('#cnlist a[href*="flow=R26BK00000211"]').count() > 0, `[${vp.name}] 건별 보기 → 계약과정 한눈에 링크`);
      await shot('8-cnwin');
    }
    {
      // 다른 메뉴에 갔다가 왼쪽 메뉴로 돌아와도 보던 내용이 그대로
      await page.goto(base + '/#similar/' + encodeURIComponent('유지관리'));
      await page.waitForSelector('#slist .result');
      await page.click('#slist button[data-act="flow"]');
      await page.waitForSelector('#ssub-0 .steps');
      await page.click('#ssub-0 button[data-step="plan"]');
      await page.click('#nav a[href="#contract"]');
      await page.waitForSelector('#clist table');
      await page.click('#view .tabs[aria-label="업무 구분"] button:nth-child(2)');
      await page.waitForTimeout(300);
      const cHash = await page.evaluate(() => location.hash);
      await page.click('#nav a[href="#law"]');
      await page.waitForSelector('#view h2, #view .card');
      const before = calls.length;
      await page.click('#nav a[href="#similar"]');
      await page.waitForSelector('#ssub-0 .steps');
      ok((await page.getAttribute('#ssub-0 button[data-step="plan"]', 'aria-selected')) === 'true' && (await page.inputValue('#sform [name=q]')) === '유지관리', `[${vp.name}] 메뉴 이동 후 돌아와도 검색 결과·열어 둔 단계 유지`);
      await page.click('#nav a[href="#contract"]');
      await page.waitForSelector('#clist table');
      ok((await page.evaluate(() => location.hash)) === cHash, `[${vp.name}] 계약 관리도 보던 화면으로 복귀 (${decodeURIComponent(cHash)})`);
      ok(calls.length - before <= 2, `[${vp.name}] 돌아올 때 다시 조회하지 않음 (추가 호출 ${calls.length - before}회)`);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!overflow, `[${vp.name}] 가로 넘침 없음`);
    ok(errors.length === 0, `[${vp.name}] 스크립트 오류 없음 ${errors.length ? JSON.stringify(errors) : ''}`);
    await ctx.close();
  }
  {
    // 운영계정에서도 7일 제한이 남아 있는 경우: 31일이 거절되면 7일씩 나눠 다시 조회하고 기억함
    globalThis.FAKE_LIMIT = 7;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    calls.length = 0;
    await page.goto(base + '/');
    await page.waitForSelector('#clist table');
    await page.waitForSelector('#crecent table');
    ok(!(await page.locator('#clist .err, #crecent .err').count()), '[7일 제한] 31일 거절 → 7일씩 나눠 정상 조회');
    const learned = await page.evaluate(() => JSON.parse(localStorage.getItem('cne.chunk.cntrct') || 'null'));
    ok(learned && learned.d === 7, '[7일 제한] 7일 단위를 기억함');
    const before = calls.length;
    await page.goto(base + '/#similar?q=' + encodeURIComponent('유지관리'));
    await page.click('#nav a[href="#notice"]');
    await page.waitForSelector('#nlist table, #nlist .result, #nlist .empty');
    ok(!(await page.locator('#nlist .err').count()), `[7일 제한] 공고 화면도 정상 (추가 호출 ${calls.length - before}회)`);
    await ctx.close();
    globalThis.FAKE_LIMIT = 31;
  }
  await browser.close();
  server.close();
}

console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);

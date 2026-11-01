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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'TEST+KEY/abc==';
const OC = 'myoc123';
const ENV = { G2B_SERVICE_KEY: KEY, LAW_OC: OC };
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };

// ---------- 가짜 외부 API ----------
const calls = [];
function fixture(urlStr) {
  const u = new URL(urlStr);
  calls.push(u);
  if (u.hostname === 'www.law.go.kr') {
    if (u.pathname.endsWith('lawSearch.do')) return JSON.stringify({ PpsCgmExpcSearch: { totalCnt: '2', page: '1', ppsCgmExpc: [
      { id: '1', 법령해석일련번호: '431416', 안건명: '협상에 의한 계약 평가 관련 질의', 안건번호: '조달청-25-0001', 해석일자: '20250930', 해석기관명: '조달청', 질의기관명: '충청남도교육청', 법령해석상세링크: `/DRF/lawService.do?OC=${OC}&target=ppsCgmExpc&ID=431416` },
      { id: '2', 법령해석일련번호: '431417', 안건명: '수의계약 금액 산정 관련 질의', 안건번호: '조달청-25-0002', 해석일자: '20250814', 해석기관명: '조달청', 질의기관명: '○○시' },
    ] } });
    if (u.searchParams.get('type') === 'HTML') return `<html><head><title>x</title></head><body>원문 ${OC}</body></html>`;
    return JSON.stringify({ PpsCgmExpcService: { 법령해석일련번호: u.searchParams.get('ID'), 안건명: '협상에 의한 계약 평가 관련 질의', 안건번호: '조달청-25-0001', 해석일자: '20250930', 해석기관명: '조달청', 질의기관명: '충청남도교육청', 질의요지: '질의 내용 본문', 회답: '회답 본문', 이유: '이유 본문\n둘째 줄', 관련법령: '「국가를 당사자로 하는 계약에 관한 법률 시행령」 제43조' } });
  }
  const op = u.pathname.split('/').pop();
  const wrap = (items, extra = {}) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: '정상' }, body: Object.assign({ items, numOfRows: 20, pageNo: 1, totalCount: items.length }, extra) } });
  if (op.startsWith('getCntrctInfoList') && op.endsWith('ChgHstry')) return wrap([{ chgDt: '2026-10-24 10:00:00', totCntrctAmt: '950000000', thtmCntrctAmt: '300000000', cntrctPrd: '2026-09-15~2027-09-14', ttalScmpltDate: '2027-09-14' }]);
  if (op.startsWith('getCntrctInfoList')) return wrap([
    { untyCntrctNo: '2026090000001', cntrctNm: '정보시스템 통합유지관리 용역', corpList: '[1^대표^단독^가나다정보통신(주)^홍길동^대한민국^100^가나다정보통신(주)^김담당^1234567890]', totCntrctAmt: '912000000', thtmCntrctAmt: '300000000', cntrctCnclsDate: '2026-09-15', cntrctCnclsMthdNm: '협상에의한계약', ntceNo: 'R26BK00000101000', cntrctInsttNm: '충청남도교육청', cntrctDtlInfoUrl: 'https://www.g2b.go.kr/x', chgDt: '2026-10-24 10:00:00', cntrctPrd: '2026-09-15~2027-09-14' },
    { untyCntrctNo: '2026100000002', cntrctNm: '학교 급식기구 구매', corpList: '[1^대표^공동^라마바(주)^이대표^대한민국^60^^^2223334445],[2^구성원^공동^사아자(주)^박대표^대한민국^40^^^5556667778]', totCntrctAmt: '48500000', cntrctCnclsDate: '2026-10-02', cntrctCnclsMthdNm: '수의계약', ntceNo: '' },
  ]);
  if (/PPSSrch$/.test(op) && op.startsWith('getBidPblancListInfo')) return wrap([
    { bidNtceNo: 'R26BK00000211', bidNtceOrd: '000', bidNtceNm: '정보시스템 통합유지관리 용역', ntceInsttNm: '충청남도교육청', dminsttNm: '충청남도교육청', bidNtceDt: '2026-10-10 10:00:00', bidClseDt: '2099-11-12 10:00:00', opengDt: '2099-11-12 11:00:00', cntrctCnclsMthdNm: '협상에의한계약', presmptPrce: '820000000', asignBdgtAmt: '902000000', ntceKindNm: '등록공고', ntceSpecFileNm1: '제안요청서.hwpx', ntceSpecDocUrl1: 'https://www.g2b.go.kr/d1', ntceSpecFileNm2: '과업지시서.hwp', ntceSpecDocUrl2: 'https://www.g2b.go.kr/d2', stdNtceDocUrl: 'https://www.g2b.go.kr/std', bidNtceDtlUrl: 'https://www.g2b.go.kr/n', techAbltEvlRt: '80', bidPrceEvlRt: '20' },
    { bidNtceNo: 'R26BK00000198', bidNtceOrd: '001', bidNtceNm: '청사 방수공사', ntceInsttNm: '충청남도교육청', bidNtceDt: '2026-10-01 09:00:00', bidClseDt: '2026-10-05 10:00:00', presmptPrce: '150000000', ntceKindNm: '변경공고', ntceSpecFileNm1: '시방서.pdf', ntceSpecDocUrl1: 'https://www.g2b.go.kr/d3' },
  ]);
  if (op.startsWith('getBidPblancListInfo') && /^(getBidPblancListInfo)(Thng|Cnstwk|Servc|Frgcpt)$/.test(op)) return wrap([{ bidNtceNo: 'R26BK00000101', bidNtceOrd: '000', bidNtceNm: '정보시스템 통합유지관리 용역', bidNtceDt: '2026-07-20 10:00:00', bidClseDt: '2026-08-10 10:00:00', opengDt: '2026-08-11 11:00:00', presmptPrce: '830000000', asignBdgtAmt: '913000000', bidNtceDtlUrl: 'https://www.g2b.go.kr/n' }]);
  if (op === 'getBidPblancListInfoEorderAtchFileInfo') return wrap([{ eorderDocDivNm: '제안요청서', eorderAtchFileNm: '제안요청서_최종.hwpx', eorderAtchFileUrl: 'https://www.g2b.go.kr/e1' }]);
  if (op === 'getBidPblancListInfoLicenseLimit') return wrap({ item: [{ lcnsLmtNm: '소프트웨어사업자(컴퓨터관련서비스사업)', permsnIndstrytyList: '' }] });
  if (op === 'getBidPblancListInfoPrtcptPsblRgn') return wrap([{ prtcptPsblRgnNm: '충청남도' }]);
  if (/BsisAmount$/.test(op)) return wrap([{ bssamt: '890000000', bssamtOpenDt: '2026-10-20 10:00', rsrvtnPrceRngBgnRate: '-2', rsrvtnPrceRngEndRate: '+2' }]);
  if (/ChgHstry/.test(op)) return wrap([{ chgDt: '2026-10-16 09:00', chgItemNm: '입찰마감일시', bfchgVal: '2026-11-05', afchgVal: '2026-11-12' }]);
  if (op === 'getPrcrmntCorpBasicInfo02') return wrap([{ bizno: '1234567890', corpNm: '가나다정보통신(주)', ceoNm: '홍길동', adrs: '충청남도 홍성군', telNo: '041-000-0000', corpBsnsDivNm: '물품,용역', opbizDt: '2001-01-01 00:00:00' }]);
  if (op === 'getPrcrmntCorpIndstrytyInfo02') return wrap([{ indstrytyNm: '소프트웨어사업자', rprsntIndstrytyYn: 'Y', indstrytyStatsNm: '정상', vldPrdExprtDt: '2027-01-01' }]);
  if (op === 'getPrcrmntCorpSplyPrdctInfo02') return wrap([{ dtilPrdctClsfcNoNm: '정보시스템유지관리서비스', dtilPrdctClsfcNo: '8111229901', rprsntPrdctClsfcNoNmYn: 'Y', mnfctYn: 'N' }]);
  if (op === 'getUnptRsttCorpInfo02') return u.searchParams.get('bizno') === '9999999999'
    ? wrap([{ bizno: '9999999999', corpNm: '하나둘건설(주)', rsttBgnDate: '2026-08-01', rsttEndDate: '2099-01-31', insttNm: '○○교육청', lawordNm: '지방계약법', lawordArtclClause: '법31조', enfcPrvNm: '계약 미이행', rsttProgrsNm: '제재' }])
    : JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } });
  if (op === 'getDminsttInfo02') return wrap([{ dminsttNm: '충청남도교육청' }]);
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
  ok(JSON.parse(r2.text).code === '03', '결과없음(03) 코드 전달');
  const r3 = await call(g2b, 'http://x/api/g2b?svc=bid&op=getBidPblancListInfoServc', {});
  ok(r3.status === 500 && JSON.parse(r3.text).code === 'NOKEY', '키 미설정 시 안내');
}
{
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

// ---------- 2. 화면 ----------
let chromium;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch (e) { console.log('\n(playwright 없음 – 화면 테스트 생략)'); }
if (chromium) {
  console.log('\n화면');
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const mod = { '/api/g2b': g2b, '/api/law': law, '/api/health': health }[u.pathname];
    if (mod) {
      const r = await mod.onRequestGet({ request: new Request(u.href), env: ENV, waitUntil() {} });
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
  for (const vp of [{ name: 'pc', width: 1366, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const shot = (n) => page.screenshot({ path: path.join(shots, `${vp.name}-${n}.png`), fullPage: true });

    await page.goto(base + '/');
    await page.waitForSelector('#clist table');
    ok(await page.locator('#nav a').count() === 7, `[${vp.name}] 메뉴 7개`);
    ok((await page.textContent('.brand')).includes('충청남도교육청 계약 업무 도우미'), `[${vp.name}] 제목`);
    await page.waitForSelector('#crecent table');
    ok(await page.locator('#crecent tbody tr').count() > 0, `[${vp.name}] 우리 기관 최근 계약 표시`);
    ok((await page.textContent('#clist button[data-i="0"]')).includes('급식기구'), `[${vp.name}] 계약 목록 최근순 정렬`);
    await page.click('#clist button[data-i="1"]');
    await page.click('#dflow');
    await page.waitForSelector('#dsub .timeline');
    ok(await page.locator('#dsub .timeline li').count() >= 4, `[${vp.name}] 공고→계약 흐름`);
    await page.click('#dhist');
    await page.waitForSelector('#dsub table');
    ok(true, `[${vp.name}] 계약 변경이력`);
    await shot('1-contract');

    await page.click('#cdetail a[href^="#corp/"]');
    await page.waitForSelector('#kresult .banner');
    ok(await page.locator('.banner.ok').count() === 1, `[${vp.name}] 업체 확인 – 제재 없음`);
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
    await page.click('#slist button[data-act="cntrct"]');
    await page.waitForSelector('#ssub-0 table');
    ok(true, `[${vp.name}] e발주 문서 · 계약 결과`);
    await page.selectOption('#sform select[name="doc"]', '과업지시서');
    ok(await page.locator('#slist .result').count() === 1, `[${vp.name}] 문서 종류 필터`);
    await shot('3-similar');

    await page.click('#nav a[href="#notice"]');
    await page.waitForSelector('#nlist table');
    await page.click('#nlist button[data-i="0"]');
    for (const x of ['lic', 'rgn', 'bss', 'chg']) { await page.click(`#ndetail button[data-x="${x}"]`); await page.waitForSelector('#nsub .sub h3'); }
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

    await page.click('#nav a[href="#saved"]');
    await page.waitForSelector('#view table');
    ok(await page.locator('#view tbody tr').count() === 2, `[${vp.name}] 보관함 저장 항목`);
    await shot('6-saved');

    await page.click('#nav a[href="#settings"]');
    await page.waitForSelector('#setform');
    ok(await page.locator('#health').count() === 0, `[${vp.name}] 설정 화면에 연결 상태 숨김`);
    await page.goto(base + '/#settings/check');
    await page.waitForSelector('#health .badge');
    await page.click('#htest');
    await page.waitForFunction(() => document.querySelectorAll('#htestres .badge').length === 4);
    ok(await page.locator('#htestres .badge.grn').count() === 4, `[${vp.name}] 연결 테스트 4개 정상`);
    await shot('7-settings');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!overflow, `[${vp.name}] 가로 넘침 없음`);
    ok(errors.length === 0, `[${vp.name}] 스크립트 오류 없음 ${errors.length ? JSON.stringify(errors) : ''}`);
    await page.close();
  }
  await browser.close();
  server.close();
}

console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);

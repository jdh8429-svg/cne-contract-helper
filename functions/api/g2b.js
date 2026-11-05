// 나라장터(조달청) OpenAPI 프록시
// - 인증키는 Cloudflare 환경변수 G2B_SERVICE_KEY 에만 둡니다 (브라우저에 노출되지 않음).
// - 허용된 서비스/오퍼레이션만 호출합니다.
// - 같은 조회는 10분간 캐시해 일일 호출 한도를 아낍니다.

const BASES = {
  bid: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService',
  cntrct: 'https://apis.data.go.kr/1230000/ao/CntrctInfoService',
  usr: 'https://apis.data.go.kr/1230000/ao/UsrInfoService02',
  ind: 'https://apis.data.go.kr/1230000/ao/IndstrytyBaseLawrgltInfoService',
};

const OPS = {
  bid: [
    'getBidPblancListInfoCnstwk', 'getBidPblancListInfoServc', 'getBidPblancListInfoFrgcpt', 'getBidPblancListInfoThng',
    'getBidPblancListInfoThngBsisAmount', 'getBidPblancListInfoCnstwkBsisAmount', 'getBidPblancListInfoServcBsisAmount',
    'getBidPblancListInfoChgHstryThng', 'getBidPblancListInfoChgHstryCnstwk', 'getBidPblancListInfoChgHstryServc',
    'getBidPblancListInfoCnstwkPPSSrch', 'getBidPblancListInfoServcPPSSrch', 'getBidPblancListInfoFrgcptPPSSrch', 'getBidPblancListInfoThngPPSSrch',
    'getBidPblancListInfoLicenseLimit', 'getBidPblancListInfoPrtcptPsblRgn',
    'getBidPblancListInfoThngPurchsObjPrdct', 'getBidPblancListInfoServcPurchsObjPrdct', 'getBidPblancListInfoFrgcptPurchsObjPrdct',
    'getBidPblancListInfoEorderAtchFileInfo', 'getBidPblancListInfoEtc', 'getBidPblancListInfoEtcPPSSrch',
    'getBidPblancListPPIFnlRfpIssAtchFileInfo', 'getBidPblancListBidPrceCalclAInfo', 'getBidPblancListEvaluationIndstrytyMfrcInfo',
  ],
  cntrct: [
    'getCntrctInfoListThng', 'getCntrctInfoListThngDetail', 'getCntrctInfoListThngPPSSrch', 'getCntrctInfoListThngChgHstry', 'getCntrctInfoListThngDltHstry',
    'getCntrctInfoListCnstwk', 'getCntrctInfoListCnstwkServcInfo', 'getCntrctInfoListCnstwkPPSSrch', 'getCntrctInfoListCnstwkChgHstry', 'getCntrctInfoListCnstwkDltHstry',
    'getCntrctInfoListServc', 'getCntrctInfoListGnrlServcServcInfo', 'getCntrctInfoListTechServcServcInfo', 'getCntrctInfoListServcPPSSrch', 'getCntrctInfoListServcChgHstry', 'getCntrctInfoListServcDltHstry',
    'getCntrctInfoListFrgcpt', 'getCntrctInfoListFrgcptDetail', 'getCntrctInfoListFrgcptPPSSrch', 'getCntrctInfoListFrgcptChgHstry', 'getCntrctInfoListFrgcptDltHstry',
  ],
  usr: ['getDminsttInfo02', 'getPrcrmntCorpBasicInfo02', 'getPrcrmntCorpIndstrytyInfo02', 'getPrcrmntCorpSplyPrdctInfo02', 'getUnptRsttCorpInfo02'],
  ind: ['getIndstrytyBaseLawrgltInfoList'],
};

// 업종 목록처럼 자주 바뀌지 않는 데이터는 더 오래 캐시
const CACHE_SECONDS = { ind: 21600 };

const CODE_HINTS = {
  '03': '조회 결과가 없습니다.',
  '06': '날짜 형식이 올바르지 않습니다.',
  '07': '조회 기간 등 입력값 범위를 초과했습니다. 기간을 줄여 보세요.',
  '08': '필수 입력값이 빠졌습니다.',
  '11': '필수 입력값이 빠졌습니다.',
  '12': '해당 API 서비스가 없거나 주소가 바뀌었습니다.',
  '20': '이 API의 활용신청이 승인되지 않았습니다. 공공데이터포털에서 활용신청 상태를 확인하세요.',
  '22': '오늘 호출 한도를 초과했습니다. 내일 다시 시도하거나 운영계정을 신청하세요.',
  '30': '등록되지 않은 인증키입니다. 키 값 또는 승인 후 반영 대기(1~2시간)를 확인하세요.',
  '31': '인증키 사용기간이 만료되었습니다. 활용 연장신청이 필요합니다.',
  '32': '등록되지 않은 도메인/IP에서 호출했습니다.',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

function findHeader(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  if ('resultCode' in o) return { code: String(o.resultCode), msg: o.resultMsg || '' };
  for (const k of Object.keys(o)) {
    const h = findHeader(o[k], depth + 1);
    if (h) return h;
  }
  return null;
}

export function normalize(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (/<html/i.test(text)) {
      const title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
      const body = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { ok: false, code: 'HTML', msg: `공공데이터포털이 오류 페이지를 보냈습니다: ${(title + ' ' + body).trim().slice(0, 300)}` };
    }
    // XML 오류 응답 (인증키 오류 등은 type=json 이어도 XML로 올 수 있음)
    const pick = (tag) => (text.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')) || [])[1];
    const code = pick('returnReasonCode') || pick('resultCode') || '';
    const msg = pick('returnAuthMsg') || pick('resultMsg') || pick('errMsg') || text.slice(0, 200);
    return { ok: false, code, msg: CODE_HINTS[code] || msg, raw: msg };
  }
  const resp = data.response || data;
  const header = (resp && resp.header) || findHeader(data) || {};
  const code = String(header.resultCode ?? header.code ?? '00');
  // '03'(결과 없음)은 정상 결과로 취급 → 캐시되어 같은 조회를 반복 호출하지 않음 (예: 제재 이력 없는 업체)
  if (code === '03') return { ok: true, totalCount: 0, pageNo: 1, numOfRows: 0, items: [] };
  if (code !== '00') {
    return { ok: false, code, msg: CODE_HINTS[code] || header.resultMsg || header.msg || '오류가 발생했습니다.', raw: header.resultMsg || header.msg };
  }
  const body = (resp && resp.body) || {};
  let items = body.items;
  if (items && !Array.isArray(items)) items = items.item ?? [];
  if (items && !Array.isArray(items)) items = [items];
  if (!items || items === '') items = [];
  return {
    ok: true,
    totalCount: Number(body.totalCount || 0),
    pageNo: Number(body.pageNo || 1),
    numOfRows: Number(body.numOfRows || items.length),
    items,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const svc = url.searchParams.get('svc');
  const op = url.searchParams.get('op');

  if (!BASES[svc] || !OPS[svc].includes(op)) return json({ ok: false, msg: '허용되지 않은 요청입니다.' }, 400);
  const key = (env.G2B_SERVICE_KEY || '').trim();
  if (!key) return json({ ok: false, code: 'NOKEY', msg: 'G2B_SERVICE_KEY 환경변수가 설정되지 않았습니다. Cloudflare Pages 설정에서 인증키를 넣어 주세요.' }, 500);

  const qs = [];
  for (const [k, v] of url.searchParams) {
    if (k === 'svc' || k === 'op' || /^(serviceKey|ServiceKey|type)$/i.test(k)) continue;
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) || v.length > 300) continue;
    qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  if (!qs.some((p) => p.startsWith('numOfRows='))) qs.push('numOfRows=20');
  if (!qs.some((p) => p.startsWith('pageNo='))) qs.push('pageNo=1');
  qs.push('type=json');
  // 공공데이터포털 키: Decoding 키(원문)면 인코딩, Encoding 키(이미 % 포함)면 그대로 사용
  const encKey = key.includes('%') ? key : encodeURIComponent(key);
  const target = `${BASES[svc]}/${op}?ServiceKey=${encKey}&${qs.join('&')}`;

  // 캐시 (키를 제외한 우리 요청 주소 기준)
  // 나라장터 검색 API는 한 번에 7~20초가 걸리므로, 받아 둔 결과를 하루 동안 보관하고
  // 10분(업종 6시간)이 지난 결과는 일단 바로 돌려준 뒤 뒤에서 새로 받아 둠 (stale-while-revalidate)
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const fresh = CACHE_SECONDS[svc] || 600;
  const KEEP = 86400;

  const get = async (u) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const r = await fetch(u, { signal: ctrl.signal, headers: { accept: 'application/json, application/xml, */*', 'user-agent': 'Mozilla/5.0 (compatible; cne-contract-helper)' } });
      return { status: r.status, text: await r.text() };
    } finally { clearTimeout(timer); }
  };
  // 나라장터에서 새로 받아 정리하고, 정상이면 캐시에 저장
  const refresh = async () => {
    let resp;
    try {
      resp = await get(target);
      // https에서 HTML 오류 페이지가 오면 문서에 적힌 http 주소로 한 번 더 시도
      if (/<html/i.test(resp.text)) {
        const alt = await get(target.replace(/^https:/, 'http:')).catch(() => null);
        if (alt && !/<html/i.test(alt.text)) resp = alt;
      }
    } catch (e) {
      return { ok: false, code: 'NETWORK', msg: '나라장터 API 서버가 응답하지 않습니다. 잠시 후 다시 시도하세요.' };
    }
    const result = normalize(resp.text);
    if (!result.ok && result.code === 'HTML') result.msg += ` (HTTP ${resp.status})`;
    if (result.ok && cache) {
      const stored = json(result, 200, { 'cache-control': `public, max-age=${KEEP}`, 'x-fetched-at': String(Date.now()) });
      await cache.put(cacheKey, stored);
    }
    return result;
  };

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const age = (Date.now() - Number(hit.headers.get('x-fetched-at') || 0)) / 1000;
      const body = await hit.text();
      if (age < fresh) {
        return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-cache': 'fresh' } });
      }
      // 오래된 결과: 바로 돌려주고 뒤에서 새로 받아 둠 → 화면은 기다리지 않음
      context.waitUntil?.(refresh().catch(() => {}));
      return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-cache': 'stale', 'x-age': String(Math.round(age)) } });
    }
  }

  const result = await refresh();
  if (result.ok) return json(result, 200, { 'cache-control': 'private, max-age=60', 'x-cache': 'miss' });
  return json(result, result.code === 'NETWORK' ? 502 : 200);
}

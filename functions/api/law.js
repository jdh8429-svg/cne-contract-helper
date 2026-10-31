// 법제처 국가법령정보 공동활용 - 조달청 법령해석(ppsCgmExpc) 프록시
// - OC 값은 Cloudflare 환경변수 LAW_OC 에만 둡니다.
// - mode=list   : 목록 조회 (lawSearch.do)
// - mode=detail : 본문 조회 (lawService.do, JSON)
// - mode=html   : 본문 원문 화면 (lawService.do, HTML)

const LIST_PARAMS = ['query', 'search', 'display', 'page', 'inq', 'rpl', 'gana', 'itmno', 'explYd', 'sort'];
const DETAIL_PARAMS = ['ID', 'LM'];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const AUTH_HINT =
  '법제처 API 인증에 실패했습니다. ① OC 값이 맞는지 ② 법제처 OPEN API 신청이 승인됐는지 ③ 신청서에 등록한 도메인/IP가 이 사이트 주소와 맞는지 확인하세요.';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'list';
  const oc = (env.LAW_OC || '').trim();
  if (!oc) return json({ ok: false, code: 'NOKEY', msg: 'LAW_OC 환경변수가 설정되지 않았습니다. Cloudflare Pages 설정에서 법제처 OC 값을 넣어 주세요.' }, 500);
  if (!['list', 'detail', 'html'].includes(mode)) return json({ ok: false, msg: '허용되지 않은 요청입니다.' }, 400);

  const endpoint = mode === 'list' ? 'lawSearch.do' : 'lawService.do';
  const allowed = mode === 'list' ? LIST_PARAMS : DETAIL_PARAMS;
  const qs = new URLSearchParams({ OC: oc, target: 'ppsCgmExpc', type: mode === 'html' ? 'HTML' : 'JSON' });
  for (const k of allowed) {
    const v = url.searchParams.get(k);
    if (v != null && v !== '' && v.length <= 200) qs.set(k, v);
  }
  if (mode !== 'list' && !qs.get('ID')) return json({ ok: false, msg: '법령해석일련번호(ID)가 필요합니다.' }, 400);
  const target = `https://www.law.go.kr/DRF/${endpoint}?${qs.toString()}`;

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let text;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(target, { signal: ctrl.signal });
    clearTimeout(timer);
    text = await r.text();
  } catch (e) {
    return json({ ok: false, code: 'NETWORK', msg: '법제처 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.' }, 502);
  }
  // 응답 안의 링크 등에 OC 값이 들어 있으면 지워서 브라우저에 노출되지 않게 함
  text = text.split(oc).join('');

  if (mode === 'html') {
    if (/검증에 실패|사용자 정보|미신청|권한/.test(text) && text.length < 2000) {
      return new Response(`<p style="font-family:sans-serif;padding:24px">${AUTH_HINT}</p>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const html = text.replace(/<head([^>]*)>/i, '<head$1><base href="https://www.law.go.kr/">');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return json({ ok: false, code: 'BADRESP', msg: /검증|실패|신청|IP|도메인/.test(plain) ? AUTH_HINT : '법제처 응답을 읽지 못했습니다: ' + plain });
  }
  if (data && typeof data.result === 'string' && /실패|오류|없습니다/.test(data.result) && Object.keys(data).length <= 3) {
    return json({ ok: false, code: 'AUTH', msg: /검증|사용자/.test(data.result) ? AUTH_HINT : data.result });
  }
  const res = json({ ok: true, data }, 200, { 'cache-control': 'public, max-age=1800' });
  if (cache) context.waitUntil?.(cache.put(cacheKey, res.clone()));
  return res;
}

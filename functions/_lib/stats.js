// API 호출 통계 (관리자 전용 화면용)
// - 나라장터 · 법제처에 실제로 요청한 횟수(up)와 저장본으로 바로 응답한 횟수(hit)를 날짜(한국시간)별로 셈
// - Cloudflare 캐시에 날짜별 JSON으로 보관 (40일). 같은 데이터센터 기준이며, 동시에 많은 요청이 몰리면 몇 건 빠질 수 있는 대략값
const KEEP_SEC = 40 * 86400;
const pend = {};
let chain = Promise.resolve();

export const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const statKey = (d) => new Request('https://cne-stats.internal/day/' + d);

export function count(svc, op, kind) {
  const d = kstDate();
  const day = (pend[d] = pend[d] || {});
  const c = (day[svc + '|' + op] = day[svc + '|' + op] || { up: 0, hit: 0 });
  c[kind] = (c[kind] || 0) + 1;
}

// 쌓인 숫자를 응답이 끝난 뒤 캐시에 더해 둠 (같은 작업 공간 안에서는 차례로 처리)
export function flush(context) {
  if (typeof caches === 'undefined') return;
  chain = chain.then(async () => {
    for (const d of Object.keys(pend)) {
      const add = pend[d];
      delete pend[d];
      const old = await caches.default.match(statKey(d));
      const cur = old ? await old.json().catch(() => ({})) : {};
      for (const [k, v] of Object.entries(add)) {
        const c = (cur[k] = cur[k] || { up: 0, hit: 0 });
        c.up += v.up || 0; c.hit += v.hit || 0;
      }
      await caches.default.put(statKey(d), new Response(JSON.stringify(cur), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_SEC}` } }));
    }
  }).catch(() => {});
  if (context && context.waitUntil) context.waitUntil(chain);
}

export async function readDays(n) {
  const out = [];
  if (typeof caches === 'undefined') return out;
  for (let i = 0; i < n; i++) {
    const d = kstDate(Date.now() - i * 86400e3);
    const r = await caches.default.match(statKey(d));
    out.push({ date: d, rows: r ? await r.json().catch(() => ({})) : {} });
  }
  return out;
}

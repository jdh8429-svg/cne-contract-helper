// GitHub 주소(https://jdh8429-svg.github.io)의 화면에서도 이 서버의 조회 기능을 쓸 수 있게 허용 (CORS)
// 허용한 주소 외의 다른 사이트에서는 브라우저가 응답을 읽지 못함
const ALLOWED = ['https://jdh8429-svg.github.io'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'x-admin-token',
    'Access-Control-Expose-Headers': 'x-cache, x-fresh, x-age',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function onRequest(context) {
  const origin = context.request.headers.get('Origin') || '';
  const ok = ALLOWED.includes(origin);
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: ok ? 204 : 403, headers: ok ? corsHeaders(origin) : {} });
  }
  const res = await context.next();
  if (!ok) return res;
  // 캐시에서 꺼낸 응답은 머리글을 못 바꾸므로 새로 감싸서 붙임
  const out = new Response(res.body, res);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

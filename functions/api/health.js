// 인증키가 설정됐는지만 알려줍니다 (키 값 자체는 절대 내보내지 않음).
export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({ g2b: !!(env.G2B_SERVICE_KEY || '').trim(), law: !!(env.LAW_OC || '').trim() }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

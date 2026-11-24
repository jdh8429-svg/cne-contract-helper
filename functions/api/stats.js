// 관리자 전용: API 호출 통계
// Cloudflare 환경변수 ADMIN_TOKEN 과 같은 값을 x-admin-token 머리글로 보내야만 열림
import { readDays } from '../_lib/stats.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// 길이가 같아도 글자마다 비교 시간을 같게 (추측 방지)
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestGet({ request, env }) {
  const admin = (env.ADMIN_TOKEN || '').trim();
  if (!admin) return json({ ok: false, code: 'NOTOKEN', msg: '관리자 토큰(ADMIN_TOKEN)이 아직 설정되지 않았습니다. Cloudflare Pages → 설정 → 환경변수에 ADMIN_TOKEN을 추가한 뒤 다시 배포하세요.' });
  const given = (request.headers.get('x-admin-token') || '').trim();
  if (!same(given, admin)) {
    await new Promise((r) => setTimeout(r, 600)); // 반복 추측을 느리게
    return json({ ok: false, code: 'DENIED', msg: '관리자 토큰이 맞지 않습니다.' });
  }
  const n = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 7, 1), 31);
  return json({ ok: true, days: await readDays(n) });
}

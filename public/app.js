'use strict';
/* 충청남도교육청 계약 업무 도우미 - 화면 스크립트
 * 모든 외부 API 호출은 /api/g2b, /api/law (Cloudflare Pages Functions) 를 거칩니다.
 * 인증키는 서버 환경변수에만 있고 이 파일에는 없습니다.
 * 화면 상태(메뉴·탭·선택한 상세)는 주소(#...)에 기록되어 브라우저 뒤로 가기로 돌아갈 수 있습니다. */
(function () {
  // ---------- 공통 도구 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const DEFAULTS = { insttNm: '충청남도교육청', insttDivCd: '1', bizs: ['용역', '물품', '공사'] };
  let settings = Object.assign({}, DEFAULTS, store.get('cne.settings', {}));
  const BIZ = { '물품': 'Thng', '공사': 'Cnstwk', '용역': 'Servc', '외자': 'Frgcpt' };
  const BIZ_HAS_EXTRA = ['물품', '공사', '용역']; // 기초금액·변경이력 API가 있는 업무

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => new Date();
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (isoStr) => String(isoStr || '').replace(/-/g, '');
  const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
  const dt = (v) => (v ? String(v).slice(0, 16) : '');
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; };
  const won = (v) => { const n = num(v); return n ? n.toLocaleString('ko-KR') + '원' : '-'; };
  const pct = (a, b) => (num(a) && num(b) ? (num(a) / num(b) * 100).toFixed(1) + '%' : '-');
  const clean = (o) => { const r = {}; for (const k in o) if (o[k] !== '' && o[k] != null) r[k] = o[k]; return r; };
  const byDateDesc = (...keys) => (a, b) => {
    for (const k of keys) { const c = String(b[k] || '').localeCompare(String(a[k] || '')); if (c) return c; }
    return 0;
  };

  const addMonths = (d, n) => {
    const x = new Date(d);
    const day = x.getDate();
    x.setDate(1);
    x.setMonth(x.getMonth() + n);
    x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
    return x;
  };
  // 오늘 기준 최근 n개월 시작일 (예: 11/2 → 10/3) — 1개월 조회가 한 번의 호출로 끝나도록
  const monthsAgo = (n) => iso(addDays(addMonths(today(), -n), 1));

  // 나라장터 계약·입찰공고 검색 API의 한 번 조회 가능 기간.
  // 개발계정에서는 7일까지만 허용됐음(2026.11). 운영계정은 먼저 31일 단위로 시도하고,
  // 거절(07)되면 그 브라우저에서 하루 동안 7일 단위로 바꿔 조회함.
  const CHUNK_TRY = 31, CHUNK_SAFE = 7, CONC = 6;
  // 나라장터 쇼핑몰 품목 목록은 31일 한 번보다 7일씩 나눈 쪽이 훨씬 빠름(실측 31일 12초 / 7일 0.7초)
  const CHUNK_FIXED = { shop: 7 };
  const chunkDays = (svc) => { if (CHUNK_FIXED[svc]) return CHUNK_FIXED[svc]; const v = store.get('cne.chunk.' + svc, null); return v && Date.now() - v.t < 86400e3 ? v.d : CHUNK_TRY; };
  const setChunk = (svc, d) => store.set('cne.chunk.' + svc, { t: Date.now(), d });
  const CHUNK_DAYS = CHUNK_SAFE;
  // 화면별 최대 조회 기간 (운영계정 하루 호출량이 넉넉해 1년까지)
  const MAX_DAYS = { contract: 366, notice: 366, similar: 366 };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5) + 1;
  function checkRange(from, to, maxDays) {
    if (!from || !to) return '조회 기간을 입력하세요.';
    if (from > to) return '시작일이 끝일보다 늦습니다.';
    if (to > iso(today())) return '끝일은 오늘 이후로 정할 수 없습니다.';
    const d = daysBetween(from, to);
    if (d > maxDays) return `한 번에 최대 ${maxDays >= 365 ? '1년' : Math.round(maxDays / 30.5) + '개월'}(${maxDays}일)까지 조회할 수 있습니다. 지금 ${d}일입니다.`;
    return null;
  }
  // 끝 날짜부터 거꾸로 n일씩 나눔 → 가장 최근 구간이 화면끼리 겹쳐 다시 호출하지 않음
  function rangeChunks(fromIso, toIso, days) {
    const n = days || CHUNK_DAYS;
    const out = [];
    const start = new Date(fromIso + 'T00:00:00');
    let e = new Date(toIso + 'T00:00:00');
    while (e >= start) {
      let s = addDays(e, -(n - 1));
      if (s < start) s = start;
      out.push({ from: iso(s), to: iso(e) });
      e = addDays(s, -1);
    }
    return out;
  }
  // 동시에 너무 많이 보내지 않도록 최대 n개씩 실행
  async function pool(tasks, n) {
    const res = new Array(tasks.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (i < tasks.length) {
        const k = i++;
        try { res[k] = { status: 'fulfilled', value: await tasks[k]() }; } catch (e) { res[k] = { status: 'rejected', reason: e }; }
      }
    }));
    return res;
  }

  // ---------- API ----------
  // 같은 조회는 브라우저에서도 잠시 기억해 다시 호출하지 않음 (동시에 같은 조회가 나가면 하나로 합침)
  const memo = new Map();
  const MEMO_MS = { ind: 6 * 3600e3, law: 30 * 60e3, default: 10 * 60e3 };
  function remember(key, ttl, fn) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = fn().catch((e) => { memo.delete(key); throw e; });
    memo.set(key, { t: Date.now(), p });
    if (memo.size > 400) memo.delete(memo.keys().next().value);
    return p;
  }
  async function getJson(url) {
    let r;
    try { r = await fetch(url); } catch (e) { throw new Error('네트워크 연결을 확인하세요.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다. (' + r.status + ')'); }
    // 서버가 보관해 둔 '오래된' 결과를 먼저 준 경우 표시 (뒤에서 새로 받는 중)
    if (j && typeof j === 'object') j._stale = r.headers.get('x-cache') === 'stale';
    return j;
  }
  // 공사 계약은 이름·날짜 필드명이 달라서(cnstwkNm, cbgnDate, ttalCcmpltDate…) 다른 업무와 같은 이름으로 맞춤
  function normalizeCntrct(x) {
    if (!x || typeof x !== 'object') return x;
    if (!x.cntrctNm && x.cnstwkNm) x.cntrctNm = x.cnstwkNm;
    if (!x.wbgnDate && x.cbgnDate) x.wbgnDate = x.cbgnDate;
    if (!x.ttalScmpltDate && x.ttalCcmpltDate) x.ttalScmpltDate = x.ttalCcmpltDate;
    if (!x.thtmScmpltDate && x.thtmCcmpltDate) x.thtmScmpltDate = x.thtmCcmpltDate;
    return x;
  }
  function g2b(svc, op, params) {
    const qs = new URLSearchParams(Object.assign({ svc, op }, clean(params || {}))).toString();
    const key = 'g2b?' + qs;
    const ttl = MEMO_MS[svc] || MEMO_MS.default;
    return remember(key, ttl, async () => {
      const j = await getJson('/api/g2b?' + qs);
      if (!j.ok) {
        if (j.code === '03') return { ok: true, items: [], totalCount: 0 };
        const err = new Error(j.msg || '조회 중 오류가 발생했습니다.');
        err.code = j.code;
        throw err;
      }
      if (svc === 'cntrct' && Array.isArray(j.items)) j.items.forEach(normalizeCntrct);
      // 오래된 결과였다면 브라우저에는 20초만 기억 → 다음 조회 때 서버가 새로 받아 둔 결과를 가져옴
      if (j._stale) setTimeout(() => { const h = memo.get(key); if (h) h.t = 0; }, 20000);
      return j;
    });
  }

  // 마지막으로 본 목록을 브라우저에 하루 동안 보관 → 다음에 열 때 기다리지 않고 바로 보여 줌
  const SNAP_FIELDS = ['untyCntrctNo', 'cntrctNm', 'corpList', 'totCntrctAmt', 'thtmCntrctAmt', 'cntrctCnclsDate', 'cntrctDate', 'rgstDt', 'chgDt',
    'cntrctCnclsMthdNm', 'cntrctDtlInfoUrl', 'cntrctInfoUrl', 'ntceNo', 'cntrctInsttNm', 'cntrctInsttChrgDeptNm', 'cntrctPrd', 'wbgnDate',
    'ttalScmpltDate', 'thtmScmpltDate', 'baseLawNm', 'cmmnCntrctYn', 'lngtrmCtnuDivNm', '_biz'];
  const slim = (x) => { const o = {}; SNAP_FIELDS.forEach((k) => { if (x[k] != null && x[k] !== '') o[k] = x[k]; }); return o; };
  const snap = {
    get(k) { const v = store.get('cne.snap.' + k, null); return v && Date.now() - v.t < 86400e3 ? v : null; },
    set(k, v) {
      const idx = store.get('cne.snap.idx', []).filter((x) => x !== k);
      idx.push(k);
      while (idx.length > 8) { try { localStorage.removeItem('cne.snap.' + idx.shift()); } catch (e) { /* 무시 */ } }
      if (!store.set('cne.snap.' + k, Object.assign({ t: Date.now() }, v))) {
        // 저장 공간이 부족하면 오래된 것부터 지우고 한 번 더 시도
        while (idx.length > 1) { try { localStorage.removeItem('cne.snap.' + idx.shift()); } catch (e) { /* 무시 */ } }
        store.set('cne.snap.' + k, Object.assign({ t: Date.now() }, v));
      }
      store.set('cne.snap.idx', idx);
    },
  };
  const agoText = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금 전' : m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`; };
  // 여러 페이지를 모두 받아오기 (정렬을 위해). 한 번에 최대한 많이(999건) 받아 호출 수를 줄임.
  async function g2bAll(svc, op, params, opts) {
    const sizes = [(opts && opts.per) || 999, 500, 100].filter((v, i, a) => a.indexOf(v) === i && v <= ((opts && opts.per) || 999));
    const max = (opts && opts.max) || 2000;
    let si = 0;
    const items = [];
    let total = 0;
    let stale = false;
    for (let page = 1; page <= 30; page++) {
      let r;
      try {
        r = await g2b(svc, op, Object.assign({}, params, { numOfRows: sizes[si], pageNo: page }));
      } catch (e) {
        // 한 번에 받을 수 있는 건수를 넘었다면 더 작은 단위로 다시 시도
        // (기간이 7일보다 길면 07은 기간 초과로 보고 바로 넘김 → 아래 g2bByRange가 7일씩 다시 나눔)
        if (e.code === '07' && page === 1 && si < sizes.length - 1 && !((opts && opts.rangeDays) > CHUNK_SAFE)) { si++; page = 0; continue; }
        throw e;
      }
      total = r.totalCount || total;
      stale = stale || !!r._stale;
      items.push(...r.items);
      if (!r.items.length || items.length >= total || items.length >= max) break;
    }
    return { items: items.slice(0, max), totalCount: total, truncated: total > max, stale };
  }
  // 기간을 31일(거절되면 7일)씩 나눠 6개씩 동시에 조회해 합침. 7일도 길다고 거절되면 그 구간만 반으로 나눠 다시 조회.
  // dateStyle 'date' = 계약(inqryBgnDate, YYYYMMDD), 'dt' = 입찰공고(inqryBgnDt, YYYYMMDDHHMM)
  async function g2bByRange(svc, op, params, fromIso, toIso, opts) {
    const o = opts || {};
    const mk = (f, t) => (o.dateStyle === 'date' ? { inqryBgnDate: ymd(f), inqryEndDate: ymd(t) } : { inqryBgnDt: ymd(f) + '0000', inqryEndDt: ymd(t) + '2359' });
    let done = 0, total = 0;
    const tick = () => { done++; if (o.progress) o.progress(done, total); };
    const merge = (list) => ({ items: [].concat(...list.map((x) => x.items)), totalCount: list.reduce((a, x) => a + x.totalCount, 0), truncated: list.some((x) => x.truncated), stale: list.some((x) => x.stale) });
    const run = async (f, t) => {
      const d = daysBetween(f, t);
      try {
        return await g2bAll(svc, op, Object.assign({}, params, mk(f, t)), Object.assign({}, o, { rangeDays: d }));
      } catch (e) {
        if (e.code !== '07' || d < 2) throw e;
        if (d > CHUNK_SAFE) {
          // 31일이 거절됨 → 이 브라우저는 하루 동안 7일 단위로 조회
          setChunk(svc, CHUNK_SAFE);
          const parts = rangeChunks(f, t, CHUNK_SAFE);
          total += parts.length - 1;
          const rs = await pool(parts.map((ch) => async () => { const r = await run(ch.from, ch.to); return r; }), CONC);
          const bad = rs.find((r) => r.status === 'rejected');
          if (bad) throw bad.reason;
          rs.slice(0, -1).forEach(tick);
          return merge(rs.map((r) => r.value));
        }
        const mid = iso(addDays(new Date(f + 'T00:00:00'), Math.floor(d / 2) - 1));
        const [x, y] = await Promise.all([run(f, mid), run(iso(addDays(new Date(mid + 'T00:00:00'), 1)), t)]);
        return merge([x, y]);
      }
    };
    const chunks = rangeChunks(fromIso, toIso, chunkDays(svc));
    total = chunks.length;
    const res = await pool(chunks.map((ch) => async () => { try { return await run(ch.from, ch.to); } finally { tick(); } }), CONC);
    const out = { items: [], totalCount: 0, truncated: false, stale: false, failed: 0 };
    let firstErr = null;
    res.forEach((r) => {
      if (r.status === 'fulfilled') {
        out.items.push(...r.value.items);
        out.totalCount += r.value.totalCount;
        out.truncated = out.truncated || r.value.truncated;
        out.stale = out.stale || r.value.stale;
      } else { out.failed++; firstErr = firstErr || r.reason; }
    });
    if (!out.items.length && firstErr) throw firstErr;
    return out;
  }
  function lawApi(mode, params) {
    const qs = new URLSearchParams(Object.assign({ mode }, clean(params || {}))).toString();
    return remember('law?' + qs, MEMO_MS.law, async () => {
      const j = await getJson('/api/law?' + qs);
      if (!j.ok) throw new Error(j.msg || '조회 중 오류가 발생했습니다.');
      return j.data;
    });
  }

  // ---------- 화면 조각 ----------
  const loading = (t) => `<div class="loading">${esc(t || '불러오는 중…')}</div>`;
  // 여러 구간으로 나눠 조회할 때 진행 상황 표시
  const progressIn = (box, label) => (d, t) => { const l = box && box.querySelector('.loading'); if (l && t > 1) l.textContent = `${label} (${Math.min(d, t)}/${t} 구간 완료)`; };
  const chunkNote = (svc, from, to) => { const n = rangeChunks(from, to, chunkDays(svc)).length; return n > 1 ? `${n}개 구간으로 나눠 조회` : '한 번에 조회'; };
  const errBox = (m) => `<div class="err">${esc(m)}</div>`;
  const empty = (m) => `<div class="empty">${esc(m || '조회 결과가 없습니다.')}</div>`;
  const ext = (href, label) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label || '나라장터')} ↗</a>` : '');
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- 주소(#) 기반 이동 ----------
  // 형식: #메뉴/검색어?키=값  예) #contract?biz=용역&c=2026..., #law/수의계약?id=123, #law?tab=ind&ind=0001
  function hashOf(id, arg, params) {
    let h = '#' + id + (arg ? '/' + encodeURIComponent(arg) : '');
    const q = new URLSearchParams(clean(params || {})).toString();
    return q ? h + '?' + q : h;
  }
  function parseHash() {
    const raw = location.hash.replace(/^#/, '');
    const qi = raw.indexOf('?');
    const path = qi >= 0 ? raw.slice(0, qi) : raw;
    const query = qi >= 0 ? raw.slice(qi + 1) : '';
    const [id, ...rest] = path.split('/');
    let arg = '';
    try { arg = decodeURIComponent(rest.join('/')); } catch (e) { arg = rest.join('/'); }
    const params = {};
    new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    return { id, arg, params };
  }
  // 새 기록을 남기며 이동 (뒤로 가기로 돌아올 수 있음)
  function go(id, arg, params) {
    const h = hashOf(id, arg, params);
    if (location.hash === h) route(); else location.hash = h;
  }
  // 기록을 남기지 않고 주소만 바꿈 (검색 조건 변경 등)
  function replaceHash(id, arg, params) {
    const h = hashOf(id, arg, params);
    if (location.hash !== h) { history.replaceState(history.state, '', h); current.hash = h; }
    rememberHash(id, h);
  }
  // 메뉴별 마지막 화면 주소 → 다른 메뉴에 갔다가 돌아와도 보던 화면(검색 결과·열어 둔 상세)이 그대로
  const lastHash = (() => { try { return JSON.parse(sessionStorage.getItem('cne.last') || '{}'); } catch (e) { return {}; } })();
  function rememberHash(id, h) {
    if (!id || !h) return;
    lastHash[id] = h;
    try { sessionStorage.setItem('cne.last', JSON.stringify(lastHash)); } catch (e) { /* 저장 불가 시 무시 */ }
  }
  const scrollPos = {};
  let current = { id: null, arg: null, hash: null };
  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => { scrollPos[location.hash] = window.scrollY; scrollTick = false; });
  }, { passive: true });
  const savedScroll = () => scrollPos[location.hash];
  function revealIfNew(el) { if (el && savedScroll() == null) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  // 업체목록 "[순번^업체구분^공동도급방식^업체명^대표자^국적^지분율^채권자^담당자^사업자번호],[...]"
  function parseCorpList(s) {
    return (String(s || '').match(/\[[^\]]*\]/g) || []).map((x) => {
      const p = x.slice(1, -1).split('^');
      return { kind: p[1] || '', way: p[2] || '', name: p[3] || '', ceo: p[4] || '', share: p[6] || '', bizno: (p[9] || '').replace(/\D/g, '') };
    });
  }
  // 계약의 공고번호 → 입찰공고번호
  function bidNoOf(ntceNo) {
    const s = String(ntceNo || '').trim();
    const m = s.match(/^[A-Z]\d{2}[A-Z]{2}\d{8}/);
    if (m) return m[0];
    if (/^\d{13}$/.test(s)) return s.slice(0, 11);
    return s;
  }
  function docKind(name) {
    const n = String(name || '');
    if (/제안요청/.test(n)) return '제안요청서';
    if (/과업/.test(n)) return '과업지시서';
    if (/규격|시방|명세|사양/.test(n)) return '규격서';
    if (/내역|설계/.test(n)) return '내역서';
    if (/공고/.test(n)) return '공고문';
    return '기타';
  }
  const KIND_CLASS = { '제안요청서': 'blue', '과업지시서': 'org' };
  function noticeDocs(n) {
    const out = [];
    for (let i = 1; i <= 10; i++) {
      const u = n['ntceSpecDocUrl' + i], f = n['ntceSpecFileNm' + i];
      if (u && f) out.push({ kind: docKind(f), file: f, url: u });
    }
    if (n.stdNtceDocUrl) out.push({ kind: '표준공고서', file: '표준공고서', url: n.stdNtceDocUrl });
    for (let i = 1; i <= 5; i++) if (n['sptDscrptDocUrl' + i]) out.push({ kind: '현장설명서', file: '현장설명서 ' + i, url: n['sptDscrptDocUrl' + i] });
    return out;
  }
  const docChips = (docs) =>
    docs.length
      ? `<div class="docs">${docs.map((d) => `<span class="doc"><span class="badge ${KIND_CLASS[d.kind] || ''}">${esc(d.kind)}</span><span class="fn" title="${esc(d.file)}">${esc(d.file)}</span><a href="${esc(d.url)}" target="_blank" rel="noopener">받기</a></span>`).join('')}</div>`
      : '<div class="small muted" style="margin-top:10px">첨부된 공고문서가 없습니다.</div>';
  const lawUrl = (name) => 'https://www.law.go.kr/법령/' + encodeURIComponent(String(name || '').replace(/\s+/g, ''));

  // ---------- 보관함 ----------
  const getSaved = () => store.get('cne.saved', []);
  function saveItem(item) {
    const list = getSaved();
    if (list.some((x) => x.kind === item.kind && x.key === item.key)) { toast('이미 보관함에 있습니다.'); return; }
    list.unshift(Object.assign({ memo: '', date: iso(today()) }, item));
    store.set('cne.saved', list.slice(0, 500));
    toast('보관함에 저장했습니다.');
  }

  // ---------- 업종 · 근거법규 (공통 데이터) ----------
  // 업종 목록은 자주 바뀌지 않으므로 한 번 받아 브라우저에 하루 동안 보관 → 호출 수 절약
  const I = { all: null, err: null, promise: null, q: '', cls: '', want: null };
  const IND_CACHE = 'cne.ind.v1';
  function compactInd(x) {
    return {
      cd: String(x.indstrytyCd || ''), nm: x.indstrytyNm || '', cc: String(x.indstrytyClsfcCd || ''), cn: x.indstrytyClsfcNm || '',
      law: x.baseLawordNm || '', art: x.baseLawordArtclClauseNm || '', url: x.baseLawordUrl || '', rule: x.rltnRgltCntnts || '',
      incl: x.inclsnLcns || '', rg: x.indstrytyRgstDt || '', ch: x.indstrytyChgDt || '',
    };
  }
  function ensureInd() {
    if (I.all) return Promise.resolve(I.all);
    if (I.promise) return I.promise;
    const cached = store.get(IND_CACHE, null);
    if (cached && cached.t && Date.now() - cached.t < 86400000 && Array.isArray(cached.items) && cached.items.length) {
      I.all = cached.items;
      return Promise.resolve(I.all);
    }
    I.promise = g2bAll('ind', 'getIndstrytyBaseLawrgltInfoList', { indstrytyUseYn: 'Y' }, { max: 6000 })
      .then((r) => {
        I.all = r.items.map(compactInd).sort((a, b) => a.cd.localeCompare(b.cd));
        I.err = null;
        store.set(IND_CACHE, { t: Date.now(), items: I.all });
        return I.all;
      })
      .catch((e) => { I.err = e.message; I.promise = null; throw e; });
    return I.promise;
  }
  const indByCode = (cd) => (I.all || []).find((x) => x.cd === String(cd));
  function indForName(name) {
    const s = String(name || '');
    const m = s.match(/(?:^|\D)(\d{4})(?:\D|$)/);
    if (m && indByCode(m[1])) return indByCode(m[1]);
    const nm = s.replace(/\(.*?\)|\d{4}|[\/,]/g, '').trim();
    return (I.all || []).find((x) => x.nm === s) || (nm && (I.all || []).find((x) => x.nm.replace(/\(.*?\)/g, '').trim() === nm)) || null;
  }
  // "[1^0001^토목공사업^0003^토목건축공사업],[...]"
  function parseIncl(s) {
    return (String(s || '').match(/\[[^\]]*\]/g) || []).map((x) => {
      const p = x.slice(1, -1).split('^');
      return { aCd: p[1] || '', aNm: p[2] || '', bCd: p[3] || '', bNm: p[4] || '' };
    }).filter((x) => x.aNm || x.bNm);
  }
  const indLink = (it) => `<a href="${esc(hashOf('law', '', { tab: 'ind', ind: it.cd }))}">${esc(it.law ? `${it.law} ${it.art}`.trim() : '근거법규 보기')}</a>`;

  // 업체 소재지: 충남 여부와 짧은 표기 (예: '충청남도 공주시 반포면 …' → '충남 공주시')
  const isCN = (addr) => /^\s*(충청남도|충남)/.test(String(addr || ''));
  const SIDO = { 충청남도: '충남', 충청북도: '충북', 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원', 강원도: '강원', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
  const rgnShort = (addr) => { const t = String(addr || '').trim().split(/\s+/); if (!t[0]) return ''; return [SIDO[t[0]] || t[0], t[1] && /[시군구]$/.test(t[1]) ? t[1] : ''].filter(Boolean).join(' '); };
  const rgnBadge = (addr) => (addr ? `<span class="badge ${isCN(addr) ? 'grn' : ''}">${esc(rgnShort(addr))}</span>` : '');
  // 사업자번호 → 업체 소재지 (사용자정보서비스, 메모리 캐시)
  const corpRgnMemo = new Map();
  function corpRegion(bizno) {
    const b = String(bizno || '').replace(/\D/g, '');
    if (b.length !== 10) return Promise.resolve('');
    if (!corpRgnMemo.has(b)) corpRgnMemo.set(b, g2b('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: 3, bizno: b, numOfRows: 1 }).then((r) => { const it = r.items[0] || {}; return it.rgnNm || it.adrs || ''; }, () => ''));
    return corpRgnMemo.get(b);
  }

  // =====================================================================
  // 1. 계약 관리
  // =====================================================================
  const C = { biz: '용역', from: monthsAgo(1), to: iso(today()), mthd: '', q: '', page: 1, data: null, err: null, sel: null, want: null, recent: null, recentErr: null, seq: 0, rseq: 0 };

  function renderContract(view, arg, params) {
    if (params.biz && BIZ[params.biz] && params.biz !== C.biz) { C.biz = params.biz; C.data = null; C.err = null; C.page = 1; }
    C.want = params.c || null;
    view.innerHTML = `
      <section class="card">
        <div class="tabs" role="tablist" aria-label="업무 구분">
          ${Object.keys(BIZ).map((b) => `<button type="button" class="tab" role="tab" data-biz="${b}" aria-selected="${b === C.biz}">${b}</button>`).join('')}
        </div>
        <form class="form" id="cform">
          <label>계약일 시작<input type="date" name="from" value="${esc(C.from)}" max="${iso(today())}" required></label>
          <label>계약일 끝<input type="date" name="to" value="${esc(C.to)}" max="${iso(today())}" required></label>
          <label>계약방법<select name="mthd">
            ${[['', '전체'], ['1', '일반경쟁'], ['2', '제한경쟁'], ['3', '지명경쟁'], ['4', '수의계약']].map(([v, t]) => `<option value="${v}" ${C.mthd === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
          <label class="grow">계약명<input type="text" name="q" value="${esc(C.q)}" placeholder="계약명 일부 입력 (비우면 전체)"></label>
          <button class="btn primary" type="submit">조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">${esc(settings.insttDivCd === '2' ? '수요기관' : '계약기관')}: ${esc(settings.insttNm)} · 기관은 설정에서 바꿀 수 있습니다. · 한 번에 최대 1년까지 조회 (기간이 길수록 오래 걸립니다)</p>
        <div id="clist" style="margin-top:12px"></div>
      </section>
      <section class="card" id="cdetail" hidden></section>
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
          <h2>우리 기관 최근 계약 <span class="small muted" style="font-weight:400" id="crlabel">${recentLabel()}</span></h2>
          <button type="button" class="btn sm" id="crefresh">새로 불러오기</button>
        </div>
        <div id="crecent"></div>
      </section>`;
    $$('.tab', view).forEach((b) => b.addEventListener('click', () => go('contract', '', { biz: b.dataset.biz })));
    $('#cform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const bad = checkRange(f.from.value, f.to.value, MAX_DAYS.contract);
      if (bad) { $('#clist').innerHTML = errBox(bad); return; }
      C.from = f.from.value; C.to = f.to.value; C.mthd = f.mthd.value; C.q = f.q.value.trim(); C.page = 1; C.want = null;
      replaceHash('contract', '', { biz: C.biz });
      searchContracts();
    });
    $('#crefresh').addEventListener('click', () => { C.recent = null; loadRecent(); });
    if (C.data || C.err) applyContractSel(false); else searchContracts();
    if (C.recent) drawRecent(); else loadRecent();
  }
  function updateContract(params) {
    if (params.biz && params.biz !== C.biz) return false; // 업무 탭이 바뀌면 새로 그림
    C.want = params.c || null;
    applyContractSel(true);
    return true;
  }

  // 우리 기관 계약 조회 (기간을 나눠 조회). 목록·최근 계약이 같은 모양으로 요청해 같은 구간은 한 번만 호출됨
  function contractQuery(biz, from, to, mthd, q, progress) {
    return g2bByRange('cntrct', `getCntrctInfoList${BIZ[biz]}PPSSrch`, {
      inqryDiv: 1, insttDivCd: settings.insttDivCd, insttNm: settings.insttNm, cntrctMthdCd: mthd || '',
      // 공사는 검색 항목 이름이 '공사명(cnstwkNm)'
      [biz === '공사' ? 'cnstwkNm' : 'cntrctNm']: q || '',
    }, from, to, { dateStyle: 'date', max: 3000, progress }).then((r) => {
      // 구간 경계에서 같은 계약이 두 번 오는 경우 대비
      const seen = new Set();
      r.items = r.items.filter((x) => { const k = x.untyCntrctNo || JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
      return r;
    });
  }

  async function searchContracts(opts) {
    const silent = opts && opts.silent;
    const box = $('#clist');
    if (!box) return;
    const key = ['list', C.biz, C.from, C.to, C.mthd, C.q, settings.insttDivCd, settings.insttNm].join('|');
    const my = ++C.seq;
    if (!silent) {
      C.err = null;
      C.snapErr = null;
      const s = snap.get(key);
      if (s) { C.data = { items: s.items, totalCount: s.total, truncated: s.trunc }; C.snapAt = s.t; applyContractSel(false); }
      else { C.data = null; C.snapAt = null; box.innerHTML = loading(`나라장터에서 계약 목록을 받는 중… (${chunkNote('cntrct', C.from, C.to)} · 처음엔 10~30초 걸릴 수 있습니다)`); }
    }
    try {
      const r = await contractQuery(C.biz, C.from, C.to, C.mthd, C.q, progressIn(box, '나라장터에서 계약 목록을 받는 중…'));
      if (my !== C.seq) return; // 더 최근 조회가 있으면 무시
      r.items.sort(byDateDesc('cntrctCnclsDate', 'cntrctDate', 'rgstDt'));
      C.data = r;
      C.snapAt = null;
      C.snapErr = null;
      C.err = null;
      snap.set(key, { items: r.items.map(slim), total: r.totalCount, trunc: r.truncated });
      // 서버가 오래된 결과를 먼저 줬다면, 잠시 뒤 새 결과로 조용히 바꿔 줌
      if (r.stale && !silent) setTimeout(() => { if (my === C.seq && current.id === 'contract') searchContracts({ silent: true }); }, 21000);
    } catch (e) {
      if (my !== C.seq) return;
      if (C.data && C.snapAt) { C.snapErr = e.message; } else { C.data = null; C.err = e.message; }
    }
    applyContractSel(false);
  }

  function applyContractSel(reveal) {
    const items = C.data ? C.data.items : [];
    const sel = C.want ? items.find((x) => x.untyCntrctNo === C.want) : null;
    C.sel = sel || null;
    if (sel) C.page = Math.floor(items.indexOf(sel) / 20) + 1;
    drawContracts();
    const box = $('#cdetail');
    if (!box) return;
    if (sel) { drawDetail(sel); if (reveal) revealIfNew(box); } else { box.hidden = true; box.innerHTML = ''; }
  }

  function drawContracts() {
    const box = $('#clist');
    if (!box) return;
    if (C.err) { box.innerHTML = errBox(C.err); return; }
    if (!C.data) { box.innerHTML = loading(); return; }
    const all = C.data.items;
    if (!all.length) { box.innerHTML = empty('조건에 맞는 계약이 없습니다. 기간이나 기관명을 바꿔 보세요.'); return; }
    const pages = Math.max(1, Math.ceil(all.length / 20));
    if (C.page > pages) C.page = pages;
    const items = all.slice((C.page - 1) * 20, C.page * 20);
    box.innerHTML = `
      <div class="small muted" style="margin-bottom:6px">총 ${C.data.totalCount.toLocaleString()}건 · 계약일 최근순${C.data.truncated ? ` (일부만 표시 — 기간을 줄이면 전체를 볼 수 있습니다)` : ''}${C.data.failed ? ` · <span style="color:var(--red)">일부 기간(${C.data.failed}구간)은 나라장터 응답이 없어 빠졌습니다</span>` : ''}${C.snapAt ? ` · <span class="badge org">${esc(agoText(C.snapAt))} 저장된 목록 · ${C.snapErr ? '최신 정보를 받지 못했습니다' : '최신 정보 확인 중…'}</span>` : ''}</div>
      <div class="tablewrap"><table>
        <thead><tr><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약일</th><th>계약방법</th><th>바로가기</th></tr></thead>
        <tbody>${items.map((c) => {
          const corps = parseCorpList(c.corpList);
          const corp = corps[0] ? corps[0].name + (corps.length > 1 ? ` 외 ${corps.length - 1}` : '') : '-';
          return `<tr class="${C.sel === c ? 'sel' : ''}">
            <td><a class="linkbtn" href="${esc(hashOf('contract', '', { biz: C.biz, c: c.untyCntrctNo }))}">${esc(c.cntrctNm)}</a></td>
            <td><span class="corpname" style="display:inline-block">${esc(corp)}</span></td><td class="num">${won(c.totCntrctAmt || c.thtmCntrctAmt)}</td>
            <td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td>${esc(c.cntrctCnclsMthdNm || '-')}</td>
            <td class="nw">${ext(c.cntrctDtlInfoUrl || c.cntrctInfoUrl)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <div class="pager">
        <button type="button" class="btn sm" id="cprev" ${C.page <= 1 ? 'disabled' : ''}>이전</button>
        <span class="small muted">${C.page} / ${pages}</span>
        <button type="button" class="btn sm" id="cnext" ${C.page >= pages ? 'disabled' : ''}>다음</button>
      </div>`;
    $('#cprev').addEventListener('click', () => { C.page--; drawContracts(); $('#clist').scrollIntoView({ block: 'start' }); });
    $('#cnext').addEventListener('click', () => { C.page++; drawContracts(); $('#clist').scrollIntoView({ block: 'start' }); });
  }

  function lawKeywordFor(method) {
    const m = String(method || '');
    if (/수의/.test(m)) return '수의계약';
    if (/협상/.test(m)) return '협상에 의한 계약';
    if (/적격/.test(m)) return '적격심사';
    if (/제한/.test(m)) return '제한경쟁';
    if (/지명/.test(m)) return '지명경쟁';
    return '계약';
  }

  function drawDetail(c) {
    const box = $('#cdetail');
    box.hidden = false;
    const corps = parseCorpList(c.corpList);
    const kw = lawKeywordFor(c.cntrctCnclsMthdNm);
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
        <h2>${esc(c.cntrctNm)}</h2>
        <span class="small muted">통합계약번호 ${esc(c.untyCntrctNo || '-')} · 공고번호 ${esc(c.ntceNo || '-')}</span>
      </div>
      <dl class="kv">
        <dt>계약기관</dt><dd>${esc(c.cntrctInsttNm || '-')} ${c.cntrctInsttChrgDeptNm ? '· ' + esc(c.cntrctInsttChrgDeptNm) : ''}</dd>
        <dt>총계약금액</dt><dd>${won(c.totCntrctAmt)} <span class="small muted">(금차 ${won(c.thtmCntrctAmt)})</span></dd>
        <dt>계약방법</dt><dd>${esc(c.cntrctCnclsMthdNm || '-')}${c.lngtrmCtnuDivNm ? ' · ' + esc(c.lngtrmCtnuDivNm) : ''}</dd>
        <dt>계약기간</dt><dd>${esc(c.cntrctPrd || '-')}</dd>
        <dt>착수 · 완수</dt><dd>${esc(dateOnly(c.wbgnDate) || '-')} ~ ${esc(dateOnly(c.ttalScmpltDate || c.thtmScmpltDate) || '-')}</dd>
        <dt>근거법률</dt><dd>${esc(c.baseLawNm || '-')}</dd>
        <dt>공동계약</dt><dd>${esc(c.cmmnCntrctYn || '-')}</dd>
      </dl>
      <h3 style="margin-top:16px">계약 업체</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>업체명</th><th>구분</th><th>지분율</th><th>사업자번호</th><th></th></tr></thead>
        <tbody>${corps.length ? corps.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.kind)} ${esc(p.way)}</td><td class="nw">${esc(p.share ? p.share + '%' : '-')}</td><td class="nw">${esc(p.bizno)}</td>
          <td class="nw">${p.bizno ? `<a class="btn sm" href="#corp/${esc(p.bizno)}">업체 확인 · 제재 여부</a>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">업체 정보가 없습니다.</td></tr>'}</tbody>
      </table></div>
      <div class="btns" style="margin-top:14px">
        <button type="button" class="btn" id="dflow">공고 → 계약 흐름 보기</button>
        <button type="button" class="btn" id="dhist">계약 변경이력</button>
        <a class="btn" href="${esc(hashOf('law', kw))}">'${esc(kw)}' 관련 법령해석</a>
        <button type="button" class="btn" id="dsave">보관함에 저장</button>
        ${c.cntrctDtlInfoUrl ? `<a class="btn" href="${esc(c.cntrctDtlInfoUrl)}" target="_blank" rel="noopener">나라장터 계약상세 ↗</a>` : ''}
      </div>
      <div id="dsub"></div>`;
    $('#dsave').addEventListener('click', () => saveItem({ kind: '계약', key: c.untyCntrctNo, name: c.cntrctNm, link: c.cntrctDtlInfoUrl || '' }));
    $('#dflow').addEventListener('click', () => loadFlow(c));
    $('#dhist').addEventListener('click', () => loadContractHistory(c));
  }

  async function loadFlow(c) {
    const sub = $('#dsub');
    sub.innerHTML = `<div class="sub">${loading('공고 정보를 찾는 중…')}</div>`;
    const steps = [];
    let note = '';
    const bidNo = bidNoOf(c.ntceNo);
    if (bidNo) {
      try {
        const r = await g2b('bid', `getBidPblancListInfo${BIZ[C.biz]}`, { inqryDiv: 2, bidNtceNo: bidNo, numOfRows: 10 });
        const n = r.items.sort((a, b) => String(b.bidNtceOrd).localeCompare(String(a.bidNtceOrd)))[0];
        if (n) {
          steps.push({ d: dt(n.bidNtceDt), t: '입찰공고', s: n.bidNtceNm || '', link: n.bidNtceDtlUrl || n.bidNtceUrl });
          if (n.bidClseDt) steps.push({ d: dt(n.bidClseDt), t: '입찰마감', s: n.cntrctCnclsMthdNm || '' });
          if (n.opengDt) steps.push({ d: dt(n.opengDt), t: '개찰', s: n.sucsfbidMthdNm || '' });
          if (num(n.presmptPrce)) note = `추정가격 ${won(n.presmptPrce)} · 배정예산 ${won(n.asignBdgtAmt)} · 계약금액/배정예산 ${pct(c.totCntrctAmt, n.asignBdgtAmt)}`;
        } else note = '연결된 입찰공고를 찾지 못했습니다. (수의계약 등 공고 없이 체결된 계약일 수 있습니다)';
      } catch (e) { note = '공고 조회 실패: ' + e.message; }
    } else note = '공고번호가 없는 계약입니다. (수의계약 등)';
    const corps = parseCorpList(c.corpList);
    steps.push({ d: dateOnly(c.cntrctCnclsDate), t: '계약 체결', s: `${corps[0] ? corps[0].name : ''} · ${won(c.totCntrctAmt)}` });
    if (c.chgDt && dateOnly(c.chgDt) > dateOnly(c.cntrctCnclsDate)) steps.push({ d: dt(c.chgDt), t: '계약 정보 변경', s: '변경이력 버튼으로 내용 확인' });
    sub.innerHTML = `<div class="sub"><h3>공고 → 계약 흐름</h3>
      <ol class="timeline">${steps.map((s) => `<li><div class="small muted">${esc(s.d || '-')}</div><div class="t">${esc(s.t)}</div><div class="small">${esc(s.s)}</div>${s.link ? `<div class="small" style="margin-top:4px">${ext(s.link, '공고 보기')}</div>` : ''}</li>`).join('')}</ol>
      ${note ? `<p class="small muted" style="margin:10px 0 0">${esc(note)}</p>` : ''}</div>`;
  }

  async function loadContractHistory(c) {
    const sub = $('#dsub');
    sub.innerHTML = `<div class="sub">${loading('변경이력을 불러오는 중…')}</div>`;
    try {
      const r = await g2b('cntrct', `getCntrctInfoList${BIZ[C.biz]}ChgHstry`, { inqryDiv: 2, untyCntrctNo: c.untyCntrctNo, numOfRows: 50 });
      const rows = r.items.sort((a, b) => String(a.chgDt || a.rgstDt).localeCompare(String(b.chgDt || b.rgstDt)));
      sub.innerHTML = `<div class="sub"><h3>계약 변경이력</h3>${rows.length ? `<div class="tablewrap"><table>
        <thead><tr><th>변경일시</th><th>총계약금액</th><th>금차계약금액</th><th>계약기간</th><th>총완수일</th></tr></thead>
        <tbody>${rows.map((h) => `<tr><td class="nw">${esc(dt(h.chgDt || h.rgstDt))}</td><td class="num">${won(h.totCntrctAmt)}</td><td class="num">${won(h.thtmCntrctAmt)}</td><td>${esc(h.cntrctPrd || '-')}</td><td class="nw">${esc(dateOnly(h.ttalScmpltDate) || '-')}</td></tr>`).join('')}</tbody>
      </table></div>` : empty('변경이력이 없습니다.')}</div>`;
    } catch (e) { sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  // 최근 계약 기간 = 한 번에 조회되는 기간(31일 또는 7일) → 목록의 가장 최근 구간과 같아 다시 호출하지 않음
  const recentDays = () => Math.min(chunkDays('cntrct'), 31);
  const recentLabel = () => (recentDays() >= 28 ? '최근 1개월' : `최근 ${recentDays()}일`);
  async function loadRecent(opts) {
    const silent = opts && opts.silent;
    const box = $('#crecent');
    if (!box) return;
    const bizs = (settings.bizs && settings.bizs.length ? settings.bizs : DEFAULTS.bizs).slice(0, 4);
    const from = recentDays() >= 28 ? monthsAgo(1) : iso(addDays(today(), -(recentDays() - 1))), to = iso(today());
    const key = ['recent', bizs.join(','), from, to, settings.insttDivCd, settings.insttNm].join('|');
    const my = ++C.rseq;
    if (!silent) {
      C.recentErr = null;
      const s = snap.get(key);
      if (s) { C.recent = s.items; C.recentAt = s.t; drawRecent(); } else { C.recentAt = null; box.innerHTML = loading(); }
    }
    const res = await Promise.allSettled(bizs.map((b) => contractQuery(b, from, to)
      .then((r) => ({ stale: r.stale, items: r.items.map((x) => Object.assign({ _biz: b }, x)) }))));
    if (my !== C.rseq) return;
    const items = [];
    const errs = [];
    let stale = false;
    res.forEach((r) => (r.status === 'fulfilled' ? (items.push(...r.value.items), stale = stale || r.value.stale) : errs.push(r.reason.message)));
    if (!items.length && errs.length && C.recentAt) { drawRecent(); return; } // 저장된 목록은 그대로 둠
    items.sort(byDateDesc('cntrctCnclsDate', 'cntrctDate', 'rgstDt'));
    C.recent = items.slice(0, 10);
    C.recentAt = null;
    C.recentErr = errs.length && !items.length ? errs[0] : null;
    if (!C.recentErr) snap.set(key, { items: C.recent.map(slim) });
    drawRecent();
    if (stale && !silent) setTimeout(() => { if (my === C.rseq && current.id === 'contract') loadRecent({ silent: true }); }, 21000);
  }
  function drawRecent() {
    const box = $('#crecent');
    if (!box) return;
    if (C.recentErr) { box.innerHTML = errBox(C.recentErr); return; }
    if (!C.recent.length) { box.innerHTML = empty(`${recentLabel()} 계약이 없습니다.`); return; }
    box.innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>업무</th><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약일</th><th>바로가기</th></tr></thead>
      <tbody>${C.recent.map((c) => { const p = parseCorpList(c.corpList)[0]; return `<tr><td class="nw">${esc(c._biz)}</td><td>${esc(c.cntrctNm)}</td><td><span class="corpname" style="display:inline-block">${esc(p ? p.name : '-')}</span></td><td class="num">${won(c.totCntrctAmt || c.thtmCntrctAmt)}</td><td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td class="nw">${ext(c.cntrctDtlInfoUrl || c.cntrctInfoUrl)}</td></tr>`; }).join('')}</tbody>
    </table></div><p class="small muted" style="margin:8px 0 0">${recentLabel()} · ${esc(settings.bizs.join(', '))} 업무 기준${C.recentAt ? ` · ${esc(agoText(C.recentAt))} 저장된 목록 (최신 정보 확인 중…)` : ''}</p>`;
  }

  // =====================================================================
  // 2. 업체 확인
  // =====================================================================
  const K = { bizno: '', data: null, err: null, seq: 0 };

  // 충남 업체 낙찰 실적 (낙찰정보서비스의 최종낙찰업체 주소로 거름)
  const KR = { biz: '용역', from: monthsAgo(1), to: iso(today()), q: '', items: null, total: 0, err: null, seq: 0, open: '', sido: '' };
  async function searchCnWin() {
    const box = $('#cnlist');
    box.innerHTML = loading(`낙찰 결과를 받는 중… (${chunkNote('scsbid', KR.from, KR.to)})`);
    const my = ++KR.seq;
    try {
      const r = await g2bByRange('scsbid', `getScsbidListSttus${BIZ[KR.biz]}`, { inqryDiv: 3 }, KR.from, KR.to, { max: 6000, progress: progressIn(box, '낙찰 결과를 받는 중…') });
      if (my !== KR.seq) return;
      const m = new Map();
      r.items.forEach((w) => { const k = w.bidNtceNo + '|' + w.bidClsfcNo; const p = m.get(k); if (!p || String(w.bidNtceOrd) + w.rbidNo > String(p.bidNtceOrd) + p.rbidNo) m.set(k, w); });
      const all = Array.from(m.values());
      KR.total = all.length; KR.items = all.filter((w) => isCN(w.bidwinnrAdrs)); KR.err = null; KR.truncated = r.truncated;
    } catch (e) { if (my === KR.seq) { KR.err = e.message; KR.items = null; } }
    if (my === KR.seq) drawCnWin();
  }
  function drawCnWin() {
    const box = $('#cnlist');
    if (!box) return;
    if (KR.err) { box.innerHTML = errBox(KR.err); return; }
    if (!KR.items) { box.innerHTML = ''; return; }
    const q = KR.q;
    const items = KR.items.filter((w) => !q || [w.dminsttNm, w.bidNtceNm].some((v) => String(v || '').includes(q)));
    const sigs = Array.from(new Set(KR.items.map((w) => rgnShort(w.bidwinnrAdrs)))).sort();
    const list = KR.sido ? items.filter((w) => rgnShort(w.bidwinnrAdrs) === KR.sido) : items;
    const by = new Map();
    list.forEach((w) => {
      const b = String(w.bidwinnrBizno || '').replace(/\D/g, '') || w.bidwinnrNm;
      const g = by.get(b) || { bizno: b, nm: w.bidwinnrNm, adrs: w.bidwinnrAdrs, cnt: 0, sum: 0, rates: [], last: '', list: [] };
      g.cnt++; g.sum += num(w.sucsfbidAmt); if (num(w.sucsfbidRate)) g.rates.push(num(w.sucsfbidRate));
      const d = String(w.rlOpengDt || ''); if (d > g.last) g.last = d; g.list.push(w); by.set(b, g);
    });
    const groups = Array.from(by.values()).sort((a, b) => b.cnt - a.cnt || b.sum - a.sum);
    const total = list.reduce((a, w) => a + num(w.sucsfbidAmt), 0);
    box.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin-bottom:10px">
        <p class="small" style="margin:0">${esc(KR.from)} ~ ${esc(KR.to)} ${esc(KR.biz)} 낙찰 <strong>${KR.total.toLocaleString()}건</strong> 중 충남 업체 <strong>${KR.items.length.toLocaleString()}건</strong>${q ? ` → '${esc(q)}' ${items.length}건` : ''} · 업체 ${groups.length}곳 · 낙찰금액 합계 ${won(total)}</p>
        <label class="small" style="display:inline-flex;gap:6px;align-items:center">시·군<select id="cnsido"><option value="">충남 전체</option>${sigs.map((v) => `<option ${v === KR.sido ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      </div>
      ${KR.truncated ? '<p class="small" style="color:var(--red)">결과가 많아 일부 구간이 잘렸습니다. 기간을 줄여 보세요.</p>' : ''}
      ${groups.length ? `<div class="tablewrap"><table>
        <thead><tr><th>업체</th><th class="nw">소재지</th><th class="num">낙찰 건수</th><th class="num">낙찰금액 합계</th><th class="num">평균 낙찰률</th><th class="nw">최근 개찰</th><th></th></tr></thead>
        <tbody>${groups.slice(0, 200).map((g) => `<tr><td>${corpLink(g.bizno, g.nm)}</td><td class="nw">${rgnBadge(g.adrs)}</td><td class="num">${g.cnt}</td><td class="num">${won(g.sum)}</td><td class="num">${g.rates.length ? (g.rates.reduce((a, b) => a + b, 0) / g.rates.length).toFixed(3) + '%' : '-'}</td><td class="nw">${esc(dateOnly(g.last))}</td><td class="nw"><button type="button" class="linkbtn small" data-cn="${esc(g.bizno)}" aria-expanded="${KR.open === g.bizno}">건별 보기</button></td></tr>
          ${KR.open === g.bizno ? `<tr><td colspan="7" style="background:var(--soft)"><div class="tablewrap"><table><thead><tr><th>공고명</th><th>수요기관</th><th class="num">낙찰금액</th><th class="num">낙찰률</th><th class="nw">개찰일</th></tr></thead><tbody>${g.list.sort((a, b) => String(b.rlOpengDt).localeCompare(String(a.rlOpengDt))).map((w) => `<tr><td><a href="${esc(hashOf('similar', '', { biz: KR.biz, flow: w.bidNtceNo, step: 'win' }))}">${esc(w.bidNtceNm)}</a></td><td>${esc(w.dminsttNm || '')}</td><td class="num">${won(w.sucsfbidAmt)}</td><td class="num">${w.sucsfbidRate ? esc(w.sucsfbidRate) + '%' : '-'}</td><td class="nw">${esc(dateOnly(w.rlOpengDt))}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin:6px 0 0">공고명을 누르면 '계약과정 한눈에'의 낙찰 단계로 이동합니다.</p></td></tr>` : ''}`).join('')}</tbody>
      </table></div>${groups.length > 200 ? '<p class="small muted">상위 200개 업체만 표시</p>' : ''}
      <button type="button" class="btn" id="cncsv" style="margin-top:12px">충남 업체 낙찰 CSV 내보내기</button>` : empty('조건에 맞는 충남 업체 낙찰이 없습니다.')}`;
    const sel = $('#cnsido'); if (sel) sel.addEventListener('change', () => { KR.sido = sel.value; drawCnWin(); });
    $$('button[data-cn]', box).forEach((b) => b.addEventListener('click', () => { KR.open = KR.open === b.dataset.cn ? '' : b.dataset.cn; drawCnWin(); }));
    const csv = $('#cncsv');
    if (csv) csv.addEventListener('click', () => downloadCsv(`충남업체_낙찰_${KR.biz}_${KR.from}_${KR.to}.csv`, [['낙찰업체', '사업자번호', '소재지', '공고명', '수요기관', '낙찰금액', '낙찰률', '참가업체수', '개찰일시', '공고번호']].concat(list.map((w) => [w.bidwinnrNm, w.bidwinnrBizno, w.bidwinnrAdrs, w.bidNtceNm, w.dminsttNm, num(w.sucsfbidAmt), w.sucsfbidRate, w.prtcptCnum, w.rlOpengDt, w.bidNtceNo]))));
  }

  function renderCorp(view, arg) {
    if (arg && /^\d{10}$/.test(arg) && arg !== K.bizno) { K.bizno = arg; K.data = null; }
    view.innerHTML = `
      <section class="card">
        <form class="form" id="kform">
          <label class="grow">사업자등록번호 (10자리)<input type="text" name="bizno" inputmode="numeric" value="${esc(K.bizno)}" placeholder="예: 1234567890 (하이픈 없이 또는 있어도 됨)" required></label>
          <button class="btn primary" type="submit">업체 조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">계약 관리 화면의 '업체 확인' 버튼을 누르면 자동으로 조회됩니다.</p>
      </section>
      <div id="kresult" style="display:flex;flex-direction:column;gap:16px"></div>
      <section class="card" id="cnwin">
        <h2>충남 업체 낙찰 실적</h2>
        <form class="form" id="cnform">
          <label>업무<select name="biz">${Object.keys(BIZ).map((b) => `<option ${b === KR.biz ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>개찰일 시작<input type="date" name="from" value="${esc(KR.from)}" max="${iso(today())}" required></label>
          <label>개찰일 끝<input type="date" name="to" value="${esc(KR.to)}" max="${iso(today())}" required></label>
          <label class="grow">수요기관 · 공고명 (선택)<input type="search" name="q" value="${esc(KR.q)}" placeholder="예: 교육청, 학교, 급식"></label>
          <button class="btn primary" type="submit">충남 업체 낙찰 조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">전국 낙찰 결과 중 낙찰업체 주소가 충청남도인 것만 모아 업체별로 보여 줍니다. 한 번에 최대 3개월.</p>
        <div id="cnlist" style="margin-top:12px"></div>
      </section>`;
    $('#cnform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const bad = checkRange(f.from.value, f.to.value, 92);
      if (bad) { $('#cnlist').innerHTML = errBox(bad); return; }
      const changed = f.biz.value !== KR.biz || f.from.value !== KR.from || f.to.value !== KR.to;
      KR.biz = f.biz.value; KR.from = f.from.value; KR.to = f.to.value; KR.q = f.q.value.trim();
      if (changed || !KR.items) searchCnWin(); else drawCnWin();
    });
    if (KR.items || KR.err) drawCnWin();
    $('#kform').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.bizno.value.replace(/\D/g, '');
      if (v.length !== 10) { $('#kresult').innerHTML = errBox('사업자등록번호 10자리를 입력하세요.'); return; }
      if (v === K.bizno) { K.data = null; searchCorp(); } else go('corp', v);
    });
    if (K.bizno && !K.data) searchCorp(); else drawCorp();
  }

  async function searchCorp() {
    const box = $('#kresult');
    box.innerHTML = loading('업체 정보와 제재 이력을 확인하는 중…');
    const b = K.bizno;
    const my = ++K.seq;
    const [basic, ind, prd, unpt] = await Promise.allSettled([
      g2b('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: 3, bizno: b, numOfRows: 5 }),
      g2b('usr', 'getPrcrmntCorpIndstrytyInfo02', { inqryDiv: 1, bizno: b, numOfRows: 100 }),
      g2b('usr', 'getPrcrmntCorpSplyPrdctInfo02', { inqryDiv: 1, bizno: b, numOfRows: 100 }),
      g2b('usr', 'getUnptRsttCorpInfo02', { inqryDiv: 1, bizno: b, numOfRows: 100 }),
    ]);
    if (my !== K.seq) return;
    const pick = (r) => (r.status === 'fulfilled' ? { items: r.value.items } : { err: r.reason.message });
    K.data = { basic: pick(basic), ind: pick(ind), prd: pick(prd), unpt: pick(unpt) };
    drawCorp();
  }

  function drawCorp() {
    const box = $('#kresult');
    if (!box) return;
    if (!K.bizno) { box.innerHTML = ''; return; }
    if (!K.data) { box.innerHTML = loading(); return; }
    const d = K.data;
    const info = (d.basic.items || [])[0];
    const td = iso(today());
    const sanctions = d.unpt.items || [];
    const active = sanctions.filter((s) => (!s.rsttEndDate || dateOnly(s.rsttEndDate) >= td) && (!s.rsttProgrsNm || /제재/.test(s.rsttProgrsNm)));
    let banner;
    if (d.unpt.err) banner = `<div class="banner warn"><strong>제재 이력을 확인하지 못했습니다</strong><span>${esc(d.unpt.err)}</span></div>`;
    else if (active.length) { const s = active[0]; banner = `<div class="banner bad"><strong>부정당제재 기간 중인 업체입니다</strong><span>제재기간 ${esc(dateOnly(s.rsttBgnDate))} ~ ${esc(dateOnly(s.rsttEndDate))} · 제재기관 ${esc(s.insttNm || '-')} · 근거 ${esc(s.lawordNm || '')} ${esc(s.lawordArtclClause || '')}</span></div>`; }
    else if (sanctions.length) banner = `<div class="banner warn"><strong>현재 제재 중은 아니지만 과거 제재 이력이 있습니다</strong><span>아래 제재 이력을 확인하세요.</span></div>`;
    else banner = `<div class="banner ok"><strong>부정당제재 이력 없음</strong><span>조회일(${esc(td)}) 기준 나라장터에 등록된 제재 이력이 없습니다. (나라장터 미등록업체·개인 제재는 제공되지 않음)</span></div>`;

    const name = info ? info.corpNm : (sanctions[0] && sanctions[0].corpNm) || '';
    const inds = d.ind.items || [];
    box.innerHTML = `${banner}
      <div class="row">
        <section class="card">
          <h2>기본정보</h2>
          ${d.basic.err ? errBox(d.basic.err) : info ? `<dl class="kv">
            <dt>업체명</dt><dd>${esc(info.corpNm)}</dd>
            <dt>사업자번호</dt><dd>${esc(info.bizno)}</dd>
            <dt>대표자</dt><dd>${esc(info.ceoNm || '-')}</dd>
            <dt>주소</dt><dd>${esc([info.adrs, info.dtlAdrs].filter(Boolean).join(' ') || '-')}</dd>
            <dt>전화</dt><dd>${esc(info.telNo || '-')}</dd>
            <dt>업무구분</dt><dd>${esc(info.corpBsnsDivNm || '-')}${info.mnfctDivNm ? ' · ' + esc(info.mnfctDivNm) : ''}</dd>
            <dt>개업일</dt><dd>${esc(dateOnly(info.opbizDt) || '-')}</dd>
            <dt>종업원수</dt><dd>${esc(info.emplyeNum || '-')}</dd>
          </dl>` : empty('나라장터에 등록된 업체 정보가 없습니다.')}
          <div class="btns" style="margin-top:14px"><button type="button" class="btn" id="ksave" ${name ? '' : 'disabled'}>보관함에 저장</button></div>
        </section>
        <section class="card wide">
          <h2>부정당제재 이력</h2>
          ${d.unpt.err ? errBox(d.unpt.err) : sanctions.length ? `<div class="tablewrap"><table>
            <thead><tr><th>제재기간</th><th>제재기관</th><th>근거</th><th>사유</th><th>상태</th></tr></thead>
            <tbody>${sanctions.map((s) => `<tr><td class="nw">${esc(dateOnly(s.rsttBgnDate))} ~ ${esc(dateOnly(s.rsttEndDate))}</td><td>${esc(s.insttNm || '-')}</td><td>${esc(s.lawordNm || '')} ${esc(s.lawordArtclClause || '')}</td><td>${esc(s.enfcPrvNm || s.lawordArtclClauseCdNm || '-')}</td><td class="nw">${esc(s.rsttProgrsNm || '-')}</td></tr>`).join('')}</tbody>
          </table></div>` : empty('제재 이력이 없습니다.')}
        </section>
      </div>
      <div class="row">
        <section class="card">
          <h2>등록업종</h2>
          ${d.ind.err ? errBox(d.ind.err) : inds.length ? `<div class="tablewrap"><table>
            <thead><tr><th>업종명</th><th>대표</th><th>상태</th><th>유효기간</th><th>근거법규</th></tr></thead>
            <tbody>${inds.map((x) => `<tr><td>${esc(x.indstrytyNm)}</td><td class="nw">${x.rprsntIndstrytyYn === 'Y' ? '<span class="badge blue">대표</span>' : ''}</td><td>${esc(x.indstrytyStatsNm || '-')}</td><td class="nw">${esc(dateOnly(x.vldPrdExprtDt) || '-')}</td><td class="indref" data-cd="${esc(x.indstrytyCd || '')}" data-nm="${esc(x.indstrytyNm || '')}"><span class="small muted">…</span></td></tr>`).join('')}</tbody>
          </table></div>` : empty('등록업종이 없습니다.')}
        </section>
        <section class="card">
          <h2>공급물품</h2>
          ${d.prd.err ? errBox(d.prd.err) : (d.prd.items || []).length ? `<div class="tablewrap"><table>
            <thead><tr><th>세부품명</th><th>품명번호</th><th>대표</th><th>제조</th></tr></thead>
            <tbody>${d.prd.items.map((x) => `<tr><td>${esc(x.dtilPrdctClsfcNoNm)}</td><td class="nw">${esc(x.dtilPrdctClsfcNo)}</td><td>${x.rprsntPrdctClsfcNoNmYn === 'Y' ? '<span class="badge blue">대표</span>' : ''}</td><td>${esc(x.mnfctYn || '-')}</td></tr>`).join('')}</tbody>
          </table></div>` : empty('등록된 공급물품이 없습니다.')}
        </section>
      </div>`;
    const sv = $('#ksave');
    if (sv) sv.addEventListener('click', () => saveItem({ kind: '업체', key: K.bizno, name: `${name} (${K.bizno})`, link: '#corp/' + K.bizno }));
    fillIndRefs(box);
  }

  // 표 안의 업종 칸(.indref)에 근거법규 링크 채우기
  function fillIndRefs(scope) {
    const cells = $$('.indref', scope);
    if (!cells.length) return;
    ensureInd().then(() => {
      cells.forEach((td) => {
        const it = (td.dataset.cd && indByCode(td.dataset.cd)) || indForName(td.dataset.nm);
        td.innerHTML = it ? indLink(it) : '<span class="small muted">-</span>';
      });
    }).catch(() => cells.forEach((td) => { td.innerHTML = '<span class="small muted">조회 실패</span>'; }));
  }

  // =====================================================================
  // 3. 유사사업 찾기
  // =====================================================================
  const S = { rgn: '', win: null, winKey: '', winErr: null, flow: '', step: '', q: '', ind: '', biz: '용역', from: monthsAgo(1), to: iso(today()), doc: '전체', items: null, err: null, seq: 0, key: '', failed: 0 };
  const PRESETS = [['1', '최근 1개월'], ['3', '최근 3개월'], ['6', '최근 6개월'], ['12', '최근 1년']];
  const presetOf = (from, to) => { if (to !== iso(today())) return ''; const p = PRESETS.find(([m]) => monthsAgo(Number(m)) === from); return p ? p[0] : ''; };

  function renderSimilar(view, arg, params) {
    const ind = params.ind || '';
    S.flow = params.flow || ''; S.step = params.step || '';
    S.rgn = params.rgn === '충남' ? '충남' : '';
    if (params.biz && BIZ[params.biz]) S.biz = params.biz;
    const key = arg + '|' + ind;
    if (key !== S.key) { S.q = arg; S.ind = ind; S.key = key; S.items = null; S.err = null; }
    const indIt = S.ind ? indByCode(S.ind) : null;
    view.innerHTML = `
      <section class="card">
        <form class="form" id="sform">
          <label class="grow">사업명 키워드<input type="search" name="q" value="${esc(S.q)}" placeholder="예: 통합유지관리, 급식, 방수공사" ${S.ind ? '' : 'required'}></label>
          <label>업무<select name="biz">${Object.keys(BIZ).map((b) => `<option ${b === S.biz ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>기간<select name="preset">${PRESETS.map(([v, t]) => `<option value="${v}" ${presetOf(S.from, S.to) === v ? 'selected' : ''}>${t}</option>`).join('')}<option value="" ${presetOf(S.from, S.to) ? '' : 'selected'}>직접 입력</option></select></label>
          <label>공고일 시작<input type="date" name="from" value="${esc(S.from)}" max="${iso(today())}" required></label>
          <label>공고일 끝<input type="date" name="to" value="${esc(S.to)}" max="${iso(today())}" required></label>
          <label>낙찰업체 지역<select name="rgn"><option value="" ${S.rgn ? '' : 'selected'}>전체</option><option value="충남" ${S.rgn ? 'selected' : ''}>충남 업체만</option></select></label>
          <label>문서 종류<select name="doc">${['전체', '제안요청서', '과업지시서', '규격서', '내역서'].map((v) => `<option ${S.doc === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit">유사사업 검색</button>
        </form>
        ${S.ind ? `<p class="small" style="margin:10px 0 0">업종 조건: <span class="badge blue">${esc(S.ind)} ${esc(indIt ? indIt.nm : '')}</span> <a href="${esc(hashOf('similar', S.q))}">업종 조건 빼기</a></p>` : ''}
        <p class="small muted" style="margin:10px 0 0">전국 모든 기관의 입찰공고에서 찾습니다. 한 번에 최대 1년까지 조회할 수 있고, 기간이 길수록 오래 걸립니다 (과거 기간도 조회 가능).</p>
        <p class="small" style="margin:6px 0 0;color:var(--navy-2)">결과의 <strong>'계약과정 한눈에'</strong>를 누르면 그 공고의 발주계획 · 사전규격 · 입찰공고 · 낙찰 · 계약 정보를 단계별로 볼 수 있습니다.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <div id="slist" style="flex:3 1 480px;min-width:0;display:flex;flex-direction:column;gap:12px"></div>
        <aside class="card" id="ssum" style="flex:1 1 240px"></aside>
      </div>`;
    const f = $('#sform');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = f.q.value.trim();
      const bad = checkRange(f.from.value, f.to.value, MAX_DAYS.similar);
      if (bad) { $('#slist').innerHTML = errBox(bad); return; }
      S.biz = f.biz.value; S.from = f.from.value; S.to = f.to.value; S.doc = f.doc.value; S.flow = ''; S.step = '';
      if (!q && !S.ind) return;
      if (q !== S.q) { S.q = q; S.key = q + '|' + S.ind; S.items = null; go('similar', q, { ind: S.ind, rgn: S.rgn }); } else searchSimilar();
    });
    f.doc.addEventListener('change', (e) => { S.doc = e.target.value; drawSimilar(); });
    f.rgn.addEventListener('change', (e) => { S.rgn = e.target.value; replaceHash('similar', S.q, { ind: S.ind, biz: S.biz, rgn: S.rgn }); drawSimilar(); });
    // 기간 빠른 선택 → 날짜 칸 채움, 날짜를 직접 바꾸면 '직접 입력'으로
    f.preset.addEventListener('change', () => { if (f.preset.value) { f.from.value = monthsAgo(Number(f.preset.value)); f.to.value = iso(today()); } });
    [f.from, f.to].forEach((el) => el.addEventListener('change', () => { f.preset.value = presetOf(f.from.value, f.to.value); }));
    if ((S.q || S.ind) && !S.items && !S.err) searchSimilar(); else drawSimilar();
  }

  async function searchSimilar() {
    $('#slist').innerHTML = loading(`유사사업을 찾는 중… (${S.from} ~ ${S.to}, ${chunkNote('bid', S.from, S.to)})`);
    $('#ssum').innerHTML = '';
    S.err = null;
    const my = ++S.seq;
    let found = [];
    try {
      // 공고명으로 서버에서 걸러 받으므로 결과가 적음 → 구간당 보통 1번 호출
      const r = await g2bByRange('bid', `getBidPblancListInfo${BIZ[S.biz]}PPSSrch`, { inqryDiv: 1, bidNtceNm: S.q, indstrytyCd: S.ind }, S.from, S.to, { max: 999, progress: progressIn($('#slist'), '유사사업을 찾는 중…') });
      found = r.items;
      S.failed = r.failed;
      S.err = null;
    } catch (e) { S.err = e.message; }
    if (my !== S.seq) return;
    const map = new Map();
    found.forEach((n) => {
      const prev = map.get(n.bidNtceNo);
      if (!prev || String(n.bidNtceOrd) > String(prev.bidNtceOrd)) map.set(n.bidNtceNo, n);
    });
    S.items = Array.from(map.values()).sort(byDateDesc('bidNtceDt'));
    if (S.items.length) S.err = null;
    drawSimilar();
  }

  // 같은 검색 조건의 낙찰 결과(낙찰업체 주소 포함)를 받아 공고번호별로 정리
  async function loadWinners() {
    const key = [S.q, S.ind, S.biz, S.from, S.to].join('|');
    if (S.winKey === key && (S.win || S.winErr)) return;
    S.winKey = key; S.win = null; S.winErr = null;
    try {
      const r = await g2bByRange('scsbid', `getScsbidListSttus${BIZ[S.biz]}PPSSrch`, { inqryDiv: 1, bidNtceNm: S.q, indstrytyCd: S.ind }, S.from, S.to, { max: 999, progress: progressIn($('#slist'), '낙찰업체 소재지를 확인하는 중…') });
      if (S.winKey !== key) return;
      const m = new Map();
      r.items.forEach((w) => { const p = m.get(w.bidNtceNo); if (!p || String(w.bidNtceOrd) + w.rbidNo > String(p.bidNtceOrd) + p.rbidNo) m.set(w.bidNtceNo, w); });
      S.win = m;
    } catch (e) { if (S.winKey === key) S.winErr = e.message; }
  }

  function drawSimilar() {
    const list = $('#slist'), sum = $('#ssum');
    if (!list) return;
    if (S.err) { list.innerHTML = errBox(S.err); sum.innerHTML = ''; return; }
    if (!S.items && S.flow) S.items = [];
    if (!S.items) { list.innerHTML = `<div class="card">${empty('사업명 키워드를 입력하고 검색하세요.')}</div>`; sum.innerHTML = '<h2>금액 참고</h2><p class="small muted">검색하면 추정가격 통계가 표시됩니다.</p>'; return; }
    // 낙찰업체 지역 필터: 낙찰 결과를 먼저 받아 온 뒤 다시 그림
    if (S.rgn && S.items.length && S.winKey !== [S.q, S.ind, S.biz, S.from, S.to].join('|')) {
      list.innerHTML = loading('낙찰업체 소재지를 확인하는 중…');
      loadWinners().then(drawSimilar);
      return;
    }
    if (S.rgn && S.winErr) { list.innerHTML = errBox('낙찰정보를 받지 못해 지역 필터를 적용할 수 없습니다: ' + S.winErr); return; }
    const winOf = (n) => (S.win ? S.win.get(n.bidNtceNo) : null);
    const shown = S.items.filter((n) => (S.doc === '전체' || noticeDocs(n).some((d) => d.kind === S.doc)) && (!S.rgn || isCN((winOf(n) || {}).bidwinnrAdrs)));
    if (!shown.length) list.innerHTML = `<div class="card">${empty(S.rgn ? `이 조건에서 충남 업체가 낙찰받은 공고가 없습니다. (낙찰 ${S.win ? S.win.size : 0}건 확인)` : S.doc === '전체' ? '검색 결과가 없습니다.' : `'${S.doc}'가 첨부된 공고가 없습니다.`)}</div>`;
    else list.innerHTML = shown.slice(0, 60).map((n, i) => `
      <article class="result">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px">
          <h3>${esc(n.bidNtceNm)}</h3>${ext(n.bidNtceDtlUrl || n.bidNtceUrl, '나라장터 공고')}
        </div>
        <div class="meta">${esc(n.dminsttNm || n.ntceInsttNm)} · 공고 ${esc(dateOnly(n.bidNtceDt))} · ${esc(n.cntrctCnclsMthdNm || '')} · ${esc(n.bidNtceNo)}</div>
        <div class="amts"><span>추정가격 <strong>${won(n.presmptPrce)}</strong></span><span>배정예산 <strong>${won(n.asignBdgtAmt)}</strong></span>${n.sucsfbidLwltRate ? `<span>낙찰하한율 <strong>${esc(n.sucsfbidLwltRate)}%</strong></span>` : ''}</div>
        ${winOf(n) ? (() => { const w = winOf(n); return `<div class="winline">낙찰 <strong>${corpLink(w.bidwinnrBizno, w.bidwinnrNm)}</strong> ${rgnBadge(w.bidwinnrAdrs)} · ${won(w.sucsfbidAmt)}${w.sucsfbidRate ? ` · 낙찰률 ${esc(w.sucsfbidRate)}%` : ''}${w.prtcptCnum ? ` · ${esc(w.prtcptCnum)}개사 참가` : ''}</div>`; })() : ''}
        ${docChips(noticeDocs(n))}
        <div class="btns" style="margin-top:12px">
          <button type="button" class="btn sm" data-act="eorder" data-i="${i}">e발주 문서(제안요청서 등)</button>
          <button type="button" class="btn sm" data-act="flow" data-i="${i}" aria-expanded="false" title="발주계획 · 사전규격 · 입찰공고 · 낙찰 · 계약 정보 보기">계약과정 한눈에</button>
          <button type="button" class="btn sm" data-act="save" data-i="${i}">보관함에 저장</button>
        </div>
        <div id="ssub-${i}"></div>
      </article>`).join('') + (shown.length > 60 ? `<p class="small muted">상위 60건만 표시합니다. 키워드를 더 구체적으로 입력해 보세요.</p>` : '');
    $$('button[data-act]', list).forEach((b) => b.addEventListener('click', () => {
      const n = shown[Number(b.dataset.i)];
      const sub = $('#ssub-' + b.dataset.i);
      if (b.dataset.act === 'save') saveItem({ kind: '공고', key: n.bidNtceNo, name: `${n.bidNtceNm} (${n.dminsttNm || n.ntceInsttNm})`, link: n.bidNtceDtlUrl || n.bidNtceUrl || '' });
      if (b.dataset.act === 'eorder') loadEorder(n, sub);
      if (b.dataset.act === 'cntrct') loadBidContract(n, sub, S.biz);
      if (b.dataset.act === 'flow') {
        // 같은 버튼을 다시 누르면 닫힘
        if (sub._flow && sub._flow.n === n) { sub._flow = null; sub.innerHTML = ''; b.setAttribute('aria-expanded', 'false'); S.flow = ''; replaceHash('similar', S.q, { ind: S.ind, biz: S.biz, rgn: S.rgn }); return; }
        $$('button[data-act="flow"]', list).forEach((x) => x.setAttribute('aria-expanded', 'false'));
        b.setAttribute('aria-expanded', 'true');
        openFlow(n, sub, S.biz, n.bidNtceNo === S.flow ? S.step : '');
        S.flow = n.bidNtceNo; S.step = '';
        replaceHash('similar', S.q, { ind: S.ind, biz: S.biz, rgn: S.rgn, flow: S.flow });
      }
    }));
    // 주소에 열어 둔 공고(flow)·단계(step)가 있으면 그대로 펼침
    if (S.flow) {
      const k = shown.slice(0, 60).findIndex((n) => n.bidNtceNo === S.flow);
      if (k >= 0) {
        const b = $(`button[data-act="flow"][data-i="${k}"]`, list), sub = $('#ssub-' + k);
        b.setAttribute('aria-expanded', 'true');
        openFlow(shown[k], sub, S.biz, S.step);
        revealIfNew(sub.closest('.result'));
      } else if (S.flowTried !== S.flow) {
        // 주소로 받은 공고가 지금 검색 결과에 없으면 공고번호로 직접 불러와 맨 위에 보여 줌
        S.flowTried = S.flow;
        const want = S.flow;
        g2b('bid', `getBidPblancListInfo${BIZ[S.biz]}`, { inqryDiv: 2, bidNtceNo: want, numOfRows: 10 }).then((r) => {
          const it = r.items.sort((a, b) => String(b.bidNtceOrd).localeCompare(String(a.bidNtceOrd)))[0];
          if (it && S.flow === want && S.items && !S.items.some((x) => x.bidNtceNo === want)) { S.items.unshift(it); drawSimilar(); }
        }).catch(() => { /* 무시: 검색 결과만 표시 */ });
      }
    }
    const amts = shown.map((n) => num(n.presmptPrce)).filter((v) => v > 0);
    const avg = amts.length ? Math.round(amts.reduce((a, b) => a + b, 0) / amts.length) : 0;
    sum.innerHTML = `<h2>금액 참고</h2>
      ${S.failed ? `<p class="small" style="margin:0 0 8px;color:var(--red)">일부 기간(${S.failed}구간)은 나라장터 응답이 없어 빠졌습니다. 다시 검색해 보세요.</p>` : ''}
      <p class="small muted" style="margin:0 0 12px">검색된 공고 ${shown.length}건 중 추정가격이 있는 ${amts.length}건 기준 (부가세 제외 금액)</p>
      <dl class="kv" style="grid-template-columns:1fr auto">
        <dt>추정가격 최소</dt><dd><strong>${won(amts.length ? Math.min(...amts) : 0)}</strong></dd>
        <dt>추정가격 평균</dt><dd><strong>${won(avg)}</strong></dd>
        <dt>추정가격 최대</dt><dd><strong>${won(amts.length ? Math.max(...amts) : 0)}</strong></dd>
      </dl>
      ${S.rgn && S.win ? (() => { const ws = Array.from(S.win.values()), cn = ws.filter((w) => isCN(w.bidwinnrAdrs)), rates = cn.map((w) => num(w.sucsfbidRate)).filter((v) => v > 0);
        return `<h2 style="margin-top:18px">충남 업체 낙찰</h2><dl class="kv" style="grid-template-columns:1fr auto"><dt>낙찰 결과</dt><dd>${ws.length}건</dd><dt>그중 충남 업체</dt><dd><strong>${cn.length}건</strong> (${ws.length ? Math.round((cn.length / ws.length) * 100) : 0}%)</dd>${rates.length ? `<dt>충남 업체 평균 낙찰률</dt><dd>${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(3)}%</dd>` : ''}</dl><p class="small muted" style="margin:6px 0 0">나라장터에 등록된 낙찰업체 주소 기준. 개찰 전 공고는 빠집니다.</p>`; })() : ''}
      <button type="button" class="btn" id="scsv" style="width:100%;margin-top:16px;justify-content:center">검색 결과 CSV 내보내기</button>`;
    $('#scsv').addEventListener('click', () => downloadCsv(`유사사업_${S.q || S.ind}_${iso(today())}.csv`,
      [['공고명', '기관', '공고일', '계약방법', '추정가격', '배정예산', '공고번호', '나라장터', '낙찰업체', '낙찰업체 소재지', '낙찰금액', '낙찰률']].concat(shown.map((n) => { const w = winOf(n) || {}; return [n.bidNtceNm, n.dminsttNm || n.ntceInsttNm, dateOnly(n.bidNtceDt), n.cntrctCnclsMthdNm, num(n.presmptPrce), num(n.asignBdgtAmt), n.bidNtceNo, n.bidNtceDtlUrl || '', w.bidwinnrNm || '', w.bidwinnrAdrs || '', num(w.sucsfbidAmt) || '', w.sucsfbidRate || '']; }))));
  }

  async function loadEorder(n, sub) {
    sub.innerHTML = `<div class="sub">${loading()}</div>`;
    try {
      const r = await g2b('bid', 'getBidPblancListInfoEorderAtchFileInfo', { inqryDiv: 2, bidNtceNo: n.bidNtceNo, numOfRows: 50 });
      const docs = r.items.map((x) => ({ kind: x.eorderDocDivNm || docKind(x.eorderAtchFileNm), file: x.eorderAtchFileNm, url: x.eorderAtchFileUrl }));
      sub.innerHTML = `<div class="sub"><h3>e발주 첨부문서</h3>${docs.length ? docChips(docs) : '<div class="small muted">e발주 첨부문서가 없습니다.</div>'}</div>`;
    } catch (e) { sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  async function loadBidContract(n, sub, biz) {
    sub.innerHTML = `<div class="sub">${loading('계약 결과를 찾는 중…')}</div>`;
    try {
      const op = `getCntrctInfoList${BIZ[biz]}PPSSrch`;
      let r = await g2b('cntrct', op, { inqryDiv: 4, ntceNo: n.bidNtceNo, numOfRows: 20 });
      if (!r.items.length && n.bidNtceOrd) r = await g2b('cntrct', op, { inqryDiv: 4, ntceNo: n.bidNtceNo + n.bidNtceOrd, numOfRows: 20 });
      sub.innerHTML = `<div class="sub"><h3>계약 결과</h3>${r.items.length ? `<div class="tablewrap"><table>
        <thead><tr><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약/배정예산</th><th>계약일</th><th></th></tr></thead>
        <tbody>${r.items.map((c) => { const p = parseCorpList(c.corpList)[0]; return `<tr><td>${esc(c.cntrctNm)}</td><td>${esc(p ? p.name : '-')}</td><td class="num">${won(c.totCntrctAmt)}</td><td class="nw">${pct(c.totCntrctAmt, n.asignBdgtAmt)}</td><td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td class="nw">${ext(c.cntrctDtlInfoUrl)}</td></tr>`; }).join('')}</tbody>
      </table></div>` : '<div class="small muted">아직 계약 정보가 없습니다. (개찰 전이거나 계약 진행 중일 수 있습니다)</div>'}</div>`;
    } catch (e) { sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  // ---------- 계약과정 한눈에 (발주계획 → 사전규격 → 입찰공고 → 낙찰 → 계약) ----------
  // 계약과정통합공개서비스로 공고번호 하나에 연결된 번호들을 받고, 단계를 누르면 그 단계의 상세를 따로 조회
  const FLOW_STEPS = [['plan', '발주계획'], ['spec', '사전규격'], ['bid', '입찰공고'], ['win', '낙찰'], ['cntrct', '계약']];
  const G2B_HOME = 'https://www.g2b.go.kr';
  // "[a^b^c],[...]" 목록 → 배열의 배열
  const caretList = (s) => (String(s || '').match(/\[[^\]]*\]/g) || []).map((x) => x.slice(1, -1).split('^').map((v) => v.trim()));
  const corpLink = (bizno, name) => { const b = String(bizno || '').replace(/\D/g, ''); return b.length === 10 ? `<a href="${esc(hashOf('corp', b))}">${esc(name || b)}</a>` : esc(name || '-'); };
  const copyBtn = (v) => (v ? ` <button type="button" class="linkbtn small" data-copy="${esc(v)}">번호 복사</button>` : '');
  const kvRows = (rows) => `<dl class="kv">${rows.filter((r) => r[1] != null && r[1] !== '' && r[1] !== '-').map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>`;
  const linkRow = (links) => { const l = links.filter((x) => x && x[1]); return l.length ? `<div class="flowlinks"><span class="small muted">조달청 연결</span>${l.map(([t, u]) => ext(u, t)).join('')}</div>` : ''; };

  // 개찰일시가 지났는지
  const openedPast = (n) => { const d = n.opengDt || n.bidClseDt; return !!d && new Date(String(d).replace(' ', 'T')) < new Date(); };
  function openFlow(n, sub, biz, step) {
    const st = { n, biz, step: step || '', intg: null, err: null, cache: {} };
    sub.innerHTML = `<div class="sub flow">${loading('계약과정을 불러오는 중…')}</div>`;
    sub._flow = st;
    g2b('intg', `getCntrctProcssIntgOpen${BIZ[biz]}`, { inqryDiv: 1, bidNtceNo: n.bidNtceNo, numOfRows: 10 })
      .then((r) => { st.intg = r.items[0] || {}; }, (e) => { st.intg = {}; st.err = e.message; })
      .then(() => {
        if (!st.step) st.step = caretList(st.intg.bidwinrInfoList).length || openedPast(n) ? 'win' : 'bid';
        drawFlow(sub);
      });
  }

  function flowStatus(st, key) {
    const g = st.intg || {}, n = st.n;
    if (key === 'plan') return g.orderPlanNo ? (g.orderYm || '있음') : '정보 없음';
    if (key === 'spec') return g.bfSpecRgstNo ? (dateOnly(g.opninRgstClseDt) ? '의견마감 ' + dateOnly(g.opninRgstClseDt) : g.bfSpecRgstNo) : '정보 없음';
    if (key === 'bid') return dateOnly(n.bidNtceDt) || '-';
    const opened = openedPast(n);
    if (key === 'win') { const w = caretList(g.bidwinrInfoList)[0]; return w ? (w[5] ? `낙찰률 ${w[5]}%` : w[1]) : (opened ? '눌러서 확인' : '개찰 전'); }
    if (key === 'cntrct') { const c = caretList(g.cntrctInfoList)[0]; return c ? (c[7] || '체결') : (opened ? '눌러서 확인' : '개찰 전'); }
    return '';
  }

  function drawFlow(sub) {
    const st = sub._flow;
    sub.innerHTML = `<div class="sub flow">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;align-items:baseline"><h3 style="margin:0">계약과정 한눈에</h3><span class="small muted">단계를 누르면 아래에 상세가 나옵니다</span></div>
      ${st.err ? `<p class="small" style="color:var(--red);margin:6px 0 0">계약과정 통합정보를 받지 못했습니다: ${esc(st.err)} (입찰공고·낙찰·계약 단계는 각각 따로 조회합니다)</p>` : ''}
      <ol class="steps" role="tablist" aria-label="계약 단계">${FLOW_STEPS.map(([k, t], i) => `<li><button type="button" role="tab" aria-selected="${st.step === k}" data-step="${k}"><span class="no">${i + 1}</span><span class="t">${t}</span><span class="s">${esc(flowStatus(st, k))}</span></button></li>`).join('')}</ol>
      <div class="stepbody" role="tabpanel"></div>
    </div>`;
    $$('button[data-step]', sub).forEach((b) => b.addEventListener('click', () => { st.step = b.dataset.step; drawFlow(sub); syncFlowHash(st); }));
    drawStep(sub);
  }

  // 지금 연 공고·단계를 주소에 남김 → 그대로 복사해 다른 사람에게 보내거나 새로고침해도 같은 화면
  function syncFlowHash(st) {
    S.flow = st.n.bidNtceNo; S.step = st.step;
    replaceHash('similar', S.q, { ind: S.ind, biz: S.biz, rgn: S.rgn, flow: S.flow, step: S.step });
  }

  async function drawStep(sub) {
    const st = sub._flow, box = $('.stepbody', sub), g = st.intg || {}, n = st.n, B = BIZ[st.biz];
    const step = st.step;
    const ntceUrl = n.bidNtceDtlUrl || n.bidNtceUrl || '';
    const put = (html) => { if (sub._flow === st && st.step === step) { box.innerHTML = html; bindCopy(box); } };
    if (step === 'plan') {
      if (!g.orderPlanNo) { put(`${empty('연결된 발주계획 정보가 없습니다. (발주계획 없이 공고된 건일 수 있습니다)')}${linkRow([['나라장터', G2B_HOME]])}`); return; }
      put(`${kvRows([
        ['발주계획번호', esc(g.orderPlanNo) + copyBtn(g.orderPlanNo), true], ['발주계획통합번호', g.orderPlanUntyNo], ['발주사업명', g.orderBizNm], ['발주기관', g.orderInsttNm],
        ['발주년월', g.orderYm], ['조달방식', g.prcrmntMethdNm], ['계약체결방법', g.cntrctCnclsMthdNm], ['조달요청번호', g.prcrmntReqNo],
      ])}${linkRow([['나라장터에서 발주계획 보기 (번호로 검색)', G2B_HOME]])}`);
      return;
    }
    if (step === 'spec') {
      if (!g.bfSpecRgstNo) { put(`${empty('연결된 사전규격이 없습니다. (사전규격 공개 없이 공고된 건일 수 있습니다)')}`); return; }
      put(loading('사전규격 상세와 규격서 의견을 불러오는 중…'));
      const [r1, r2] = await Promise.allSettled([
        st.cache.spec || (st.cache.spec = g2b('pre', `getPublicPrcureThngInfo${B}PPSSrch`, { inqryDiv: 2, bfSpecRgstNo: g.bfSpecRgstNo, numOfRows: 5 })),
        st.cache.op || (st.cache.op = g2bAll('pre', `getPublicPrcureThngOpinionInfo${B}`, { inqryDiv: 2, bfSpecRgstNo: g.bfSpecRgstNo }, { per: 100, max: 300 })),
      ]);
      const p = r1.status === 'fulfilled' ? (r1.value.items[0] || null) : null;
      const docs = p ? [1, 2, 3, 4, 5].map((i) => p['specDocFileUrl' + i]).filter(Boolean).map((u, i) => ({ kind: '규격서', file: '규격문서 ' + (i + 1), url: u })) : [];
      const items = p ? caretList(p.prdctDtlList) : [];
      const ops = r2.status === 'fulfilled' ? r2.value.items : [];
      const closeDt = (p && p.opninRgstClseDt) || g.opninRgstClseDt;
      const open = closeDt && new Date(String(closeDt).replace(' ', 'T')) > new Date();
      put(`${r1.status === 'rejected' ? errBox('사전규격 상세 조회 실패: ' + r1.reason.message) : ''}
        ${kvRows([
          ['사전규격등록번호', esc(g.bfSpecRgstNo) + copyBtn(g.bfSpecRgstNo) + (open ? ' <span class="badge grn">의견 접수 중</span>' : ''), true],
          ['사업명(품명)', (p && p.prdctClsfcNoNm) || g.bfSpecBizNm], ['업무구분', p && p.bsnsDivNm], ['참조번호', p && p.refNo],
          ['발주기관', (p && p.orderInsttNm) || g.bfSpecNtceInsttNm], ['실수요기관', (p && p.rlDminsttNm) || g.bfSpecDminsttNm],
          ['배정예산', p && p.asignBdgtAmt ? `<strong>${won(p.asignBdgtAmt)}</strong>` : '', true],
          ['접수일시', p && dt(p.rcptDt)], ['의견등록마감', dt(closeDt)], ['납품기한', p && (dateOnly(p.dlvrTmlmtDt) || (p.dlvrDaynum ? p.dlvrDaynum + '일' : ''))],
          ['SW사업대상', p && (p.swBizObjYn === 'Y' ? '예' : p.swBizObjYn === 'N' ? '아니오' : '')],
          ['담당', p && [p.ofclNm, p.ofclTelNo].filter(Boolean).join(' · ')],
          ['세부품명', items.length ? items.map((x) => `${esc(x[2] || '')} <span class="muted small">${esc(x[1] || '')}</span>`).join('<br>') : '', true],
          ['연결 입찰공고', p && p.bidNtceNoList],
          ['등록 · 변경', p && [dt(p.rgstDt), dt(p.chgDt)].filter(Boolean).join(' · ')],
        ])}
        <h4>규격 문서</h4>${docs.length ? docChips(docs) : '<div class="small muted">첨부된 규격 문서가 없습니다.</div>'}
        <h4>규격서 의견 · 답변 ${ops.length ? `(${ops.length}건)` : ''}</h4>
        ${r2.status === 'rejected' ? errBox('의견 조회 실패: ' + r2.reason.message) : ops.length ? `<div class="opinions">${ops.map((o) => {
          const files = [1, 2, 3, 4, 5].map((i) => o['specDocOpninFileUrl' + i]).filter(Boolean);
          const reply = String(o.rplyNo || '0') !== '0' && o.rplyNo != null && o.rplyNo !== '';
          return `<div class="op ${reply ? 'reply' : ''}"><div class="oph"><strong>${reply ? '답변' : '의견'} · ${esc(o.opninTitl || '')}</strong><span class="small muted">${esc(o.mkngCorpNm || '')} · ${esc(dt(o.inptDt))}</span></div>
            <p>${esc(o.opninCntnts || '')}</p>${files.length ? `<div class="small">${files.map((u, i) => ext(u, '첨부 ' + (i + 1))).join(' · ')}</div>` : ''}</div>`;
        }).join('')}</div><p class="small muted" style="margin:6px 0 0">의견 작성자 이름·전화번호·이메일은 표시하지 않습니다.</p>` : '<div class="small muted">등록된 의견이 없습니다.</div>'}
        ${linkRow([['나라장터에서 사전규격 보기 (번호로 검색)', G2B_HOME]])}`);
      return;
    }
    if (step === 'bid') {
      put(`${kvRows([
        ['입찰공고번호', esc(n.bidNtceNo + (n.bidNtceOrd ? '-' + n.bidNtceOrd : '')) + copyBtn(n.bidNtceNo), true], ['공고명', n.bidNtceNm], ['공고 종류', n.ntceKindNm],
        ['공고기관', n.ntceInsttNm], ['수요기관', n.dminsttNm], ['공고일시', dt(n.bidNtceDt)], ['입찰마감', dt(n.bidClseDt)], ['개찰일시', dt(n.opengDt)],
        ['계약방법', n.cntrctCnclsMthdNm], ['낙찰방법', n.sucsfbidMthdNm], ['추정가격', won(n.presmptPrce)], ['배정예산', won(n.asignBdgtAmt)],
        ['낙찰하한율', n.sucsfbidLwltRate ? n.sucsfbidLwltRate + '%' : ''], ['평가 비율', n.techAbltEvlRt ? `기술 ${n.techAbltEvlRt} : 가격 ${n.bidPrceEvlRt}` : ''],
        ['담당', [n.ntceInsttOfclNm, n.ntceInsttOfclTelNo].filter(Boolean).join(' · ')],
      ])}
        <h4>공고 문서</h4>${docChips(noticeDocs(n)) || '<div class="small muted">첨부 문서가 없습니다.</div>'}
        <div class="btns" style="margin-top:10px"><button type="button" class="btn sm" data-eorder>e발주 문서(제안요청서 등) 보기</button></div><div class="eorderbox"></div>
        ${linkRow([['나라장터 공고 상세', ntceUrl], ['표준공고서', n.stdNtceDocUrl]])}`);
      const eb = $('[data-eorder]', box);
      if (eb) eb.addEventListener('click', () => loadEorder(n, $('.eorderbox', box)));
      return;
    }
    if (step === 'win') {
      put(loading('낙찰 · 개찰 결과를 불러오는 중…'));
      let fin = null, finErr = null;
      try {
        const r = await (st.cache.win || (st.cache.win = g2b('scsbid', `getScsbidListSttus${B}`, { inqryDiv: 4, bidNtceNo: n.bidNtceNo, numOfRows: 20 })));
        fin = r.items.sort((a, b) => String(b.bidNtceOrd).localeCompare(String(a.bidNtceOrd)) || String(b.rbidNo).localeCompare(String(a.rbidNo)))[0] || null;
      } catch (e) { finErr = e.message; }
      const iw = caretList(g.bidwinrInfoList)[0];
      const key = fin || {};
      const ord = key.bidNtceOrd || n.bidNtceOrd || '000';
      const [rk, pp] = await Promise.allSettled([
        st.cache.rank || (st.cache.rank = g2bAll('scsbid', 'getOpengResultListInfoOpengCompt', { bidNtceNo: n.bidNtceNo, bidNtceOrd: ord, bidClsfcNo: key.bidClsfcNo || '0', rbidNo: key.rbidNo || '000' }, { per: 100, max: 500 })),
        st.cache.pre || (st.cache.pre = g2b('scsbid', `getOpengResultListInfo${B}PreparPcDetail`, { inqryDiv: 2, bidNtceNo: n.bidNtceNo, bidNtceOrd: ord, numOfRows: 20 })),
      ]);
      const ranks = rk.status === 'fulfilled' ? rk.value.items.slice().sort((a, b) => (num(a.opengRank) || 1e9) - (num(b.opengRank) || 1e9)) : [];
      const preps = pp.status === 'fulfilled' ? pp.value.items.slice().sort((a, b) => num(a.compnoRsrvtnPrceSno) - num(b.compnoRsrvtnPrceSno)) : [];
      const p0 = preps[0] || {};
      const nego = ranks.some((r) => r.totalEvlAmtVal || r.techEvlVal);
      if (!fin && !iw && !ranks.length) {
        put(`${finErr ? errBox('낙찰정보 조회 실패: ' + finErr) : ''}${empty('아직 낙찰 정보가 없습니다. (개찰 전이거나 유찰·재입찰일 수 있습니다)')}${linkRow([['나라장터 공고 상세(개찰결과)', ntceUrl]])}`);
        return;
      }
      put(`${finErr ? `<p class="small" style="color:var(--red)">낙찰정보서비스 조회 실패(${esc(finErr)}) → 계약과정 통합정보로 표시합니다.</p>` : ''}
        ${kvRows(fin ? [
          ['최종낙찰업체', `<strong>${corpLink(fin.bidwinnrBizno, fin.bidwinnrNm)}</strong>${fin.bidwinnrBizno ? ` <span class="small muted">${esc(fin.bidwinnrBizno)} · 업체 확인으로 이동</span>` : ''}`, true],
          ['소재지', fin.bidwinnrAdrs ? `${rgnBadge(fin.bidwinnrAdrs)} ${esc(fin.bidwinnrAdrs)}` : '', true],
          ['대표자', fin.bidwinnrCeoNm], ['최종낙찰금액', `<strong>${won(fin.sucsfbidAmt)}</strong>`, true], ['최종낙찰률', fin.sucsfbidRate ? fin.sucsfbidRate + '%' : ''],
          ['참가업체 수', fin.prtcptCnum ? fin.prtcptCnum + '개사' : ''], ['실개찰일시', dt(fin.rlOpengDt)], ['최종낙찰일자', dateOnly(fin.fnlSucsfDate)],
          ['차수', [fin.bidNtceOrd, fin.rbidNo && fin.rbidNo !== '000' ? '재입찰 ' + fin.rbidNo : ''].filter(Boolean).join(' · ')],
        ] : [
          ['낙찰업체', `<strong>${corpLink(iw[2], iw[1])}</strong>`, true], ['대표자', iw[3]], ['낙찰금액', `<strong>${won(iw[4])}</strong>`, true],
          ['낙찰률', iw[5] ? iw[5] + '%' : ''], ['참가업체 수', iw[6] ? iw[6] + '개사' : ''], ['개찰일시', iw[7]],
        ])}
        ${preps.length ? `<h4>예정가격 · 기초금액</h4>${kvRows([['기초금액', won(p0.bssamt)], ['예정가격', `<strong>${won(p0.plnprc)}</strong>`, true], ['예정가격/기초금액', pct(p0.plnprc, p0.bssamt)], ['예비가격', p0.totRsrvtnPrceNum ? `${p0.totRsrvtnPrceNum}개 중 추첨` : ''], ['낙찰자 선정기준', p0.bidwinrSlctnAplBssCntnts]])}
          <details><summary class="small">복수예비가격 ${preps.length}개 보기</summary><div class="tablewrap"><table><thead><tr><th>순번</th><th class="num">기초예정가격</th><th>추첨</th><th class="num">추첨 횟수</th></tr></thead><tbody>${preps.map((x) => `<tr${x.drwtYn === 'Y' ? ' class="hl"' : ''}><td>${esc(x.compnoRsrvtnPrceSno)}</td><td class="num">${won(x.bsisPlnprc)}</td><td>${x.drwtYn === 'Y' ? '<span class="badge blue">추첨</span>' : ''}</td><td class="num">${esc(x.drwtNum || '')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        <h4 style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;align-items:center">개찰 순위 ${ranks.length ? `(${ranks.length}개사)` : ''}${ranks.length ? '<label class="small" style="font-weight:400;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="cnonly">충남 업체만</label>' : ''}</h4>
        ${rk.status === 'rejected' ? errBox('개찰순위 조회 실패: ' + rk.reason.message) : ranks.length ? `<div class="tablewrap"><table class="ranktbl"><thead><tr><th>순위</th><th>업체</th><th class="nw">소재지</th><th class="num">투찰금액</th><th class="num">투찰률</th>${nego ? '<th class="num">기술</th><th class="num">가격</th><th class="num">종합</th>' : ''}<th>비고</th></tr></thead><tbody>
          ${ranks.slice(0, 30).map((r) => `<tr data-bizno="${esc(String(r.prcbdrBizno || '').replace(/\D/g, ''))}"${/낙찰/.test(r.rmrk || '') ? ' class="hl"' : ''}><td>${esc(r.opengRank)}</td><td>${corpLink(r.prcbdrBizno, r.prcbdrNm)}</td><td class="nw rgn"><span class="small muted">확인 중</span></td><td class="num">${won(r.bidprcAmt)}</td><td class="num">${r.bidprcrt ? esc(r.bidprcrt) + '%' : '-'}</td>${nego ? `<td class="num">${esc(r.techEvlVal || '')}</td><td class="num">${esc(r.bidPrceEvlVal || '')}</td><td class="num">${esc(r.totalEvlAmtVal || '')}</td>` : ''}<td>${esc(r.rmrk || '')}</td></tr>`).join('')}
        </tbody></table></div>${ranks.length > 30 ? `<p class="small muted">상위 30개사만 표시 (전체 ${ranks.length}개사는 나라장터에서 확인)</p>` : ''}` : '<div class="small muted">개찰 순위 정보가 없습니다.</div>'}
        ${linkRow([['나라장터 공고 상세(개찰결과)', ntceUrl]])}`);
      fillRankRegions(box, st);
      return;
    }
    if (step === 'cntrct') {
      put(loading('계약 정보를 불러오는 중…'));
      const list = caretList(g.cntrctInfoList);
      let items = [], cErr = null;
      try {
        const op = `getCntrctInfoList${B}PPSSrch`;
        let r = await (st.cache.c1 || (st.cache.c1 = g2b('cntrct', op, { inqryDiv: 4, ntceNo: n.bidNtceNo, numOfRows: 20 })));
        if (!r.items.length && n.bidNtceOrd) r = await (st.cache.c2 || (st.cache.c2 = g2b('cntrct', op, { inqryDiv: 4, ntceNo: n.bidNtceNo + n.bidNtceOrd, numOfRows: 20 })));
        items = r.items;
      } catch (e) { cErr = e.message; }
      if (!items.length && !list.length) { put(`${cErr ? errBox(cErr) : ''}${empty('아직 계약 정보가 없습니다. (개찰 전이거나 계약 진행 중일 수 있습니다)')}`); return; }
      put(items.length ? `<div class="tablewrap"><table>
          <thead><tr><th>계약명</th><th>업체</th><th class="num">총계약금액</th><th class="nw">계약/배정예산</th><th class="nw">계약일</th><th class="nw">계약기간</th><th></th></tr></thead>
          <tbody>${items.map((c) => { const p = parseCorpList(c.corpList)[0]; return `<tr><td>${esc(c.cntrctNm)}<div class="small muted">${esc(c.untyCntrctNo || '')} · ${esc(c.cntrctCnclsMthdNm || '')}</div></td><td>${p ? corpLink(p.bizno, p.name) : '-'}</td><td class="num">${won(c.totCntrctAmt)}</td><td class="nw">${pct(c.totCntrctAmt, n.asignBdgtAmt)}</td><td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td class="nw small">${esc(c.cntrctPrd || [dateOnly(c.wbgnDate), dateOnly(c.ttalScmpltDate)].filter(Boolean).join(' ~ '))}</td><td class="nw">${ext(c.cntrctDtlInfoUrl, '계약 상세')}</td></tr>`; }).join('')}</tbody>
        </table></div>${linkRow(items.slice(0, 3).map((c) => ['나라장터 계약 상세 · ' + (c.untyCntrctNo || ''), c.cntrctDtlInfoUrl || c.cntrctInfoUrl]))}`
        : `<div class="tablewrap"><table><thead><tr><th>계약번호</th><th>계약명</th><th>계약기관</th><th>체결방법</th><th class="num">계약금액</th><th>계약일자</th></tr></thead><tbody>
          ${list.map((c) => `<tr><td>${esc(c[1])}</td><td>${esc(c[2])}</td><td>${esc(c[3])}</td><td>${esc(c[5])}</td><td class="num">${won(c[6])}</td><td>${esc(c[7])}</td></tr>`).join('')}</tbody></table></div>${linkRow([['나라장터', G2B_HOME]])}`);
    }
  }

  // 개찰 순위 업체마다 소재지를 사용자정보서비스로 확인 (6개씩 동시, 같은 업체는 재사용)
  async function fillRankRegions(box, st) {
    const tbl = $('.ranktbl', box), cb = $('.cnonly', box);
    if (!tbl) return;
    const apply = () => $$('tbody tr', tbl).forEach((tr) => { tr.hidden = !!(cb && cb.checked) && tr.dataset.cn !== '1'; });
    if (cb) { cb.checked = !!st.cnOnly; cb.addEventListener('change', () => { st.cnOnly = cb.checked; apply(); }); }
    const rows = $$('tbody tr', tbl);
    await pool(rows.map((tr) => async () => {
      const rg = await corpRegion(tr.dataset.bizno);
      tr.dataset.cn = isCN(rg) ? '1' : '0';
      $('.rgn', tr).innerHTML = rg ? rgnBadge(rg) : '<span class="small muted">-</span>';
    }), 6);
    apply();
  }

  function bindCopy(root) {
    $$('button[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '복사됨'; } catch (e) { b.textContent = b.dataset.copy; }
      setTimeout(() => { b.textContent = '번호 복사'; }, 1500);
    }));
  }

  // =====================================================================
  // 4. 공고 준비 · 확인
  // =====================================================================
  const N = { from: monthsAgo(1), to: iso(today()), q: '', items: null, err: null, sel: null, want: null, seq: 0 };

  function renderNotice(view, arg, params) {
    N.want = params.n || null;
    view.innerHTML = `
      <section class="card">
        <h2>우리 기관 공고 현황</h2>
        <form class="form" id="nform">
          <label>공고일 시작<input type="date" name="from" value="${esc(N.from)}" max="${iso(today())}" required></label>
          <label>공고일 끝<input type="date" name="to" value="${esc(N.to)}" max="${iso(today())}" required></label>
          <label class="grow">공고명<input type="text" name="q" value="${esc(N.q)}" placeholder="공고명 일부 (비우면 전체)"></label>
          <button class="btn primary" type="submit">조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">${esc(settings.insttDivCd === '2' ? '수요기관' : '공고기관')}: ${esc(settings.insttNm)} · 업무: ${esc(settings.bizs.join(', '))}</p>
        <div id="nlist" style="margin-top:12px"></div>
      </section>
      <section class="card" id="ndetail" hidden></section>`;
    $('#nform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const bad = checkRange(f.from.value, f.to.value, MAX_DAYS.notice);
      if (bad) { $('#nlist').innerHTML = errBox(bad); return; }
      N.from = f.from.value; N.to = f.to.value; N.q = f.q.value.trim(); N.want = null;
      replaceHash('notice', '', {});
      searchNotices();
    });
    if (N.items || N.err) applyNoticeSel(false); else searchNotices();
  }
  function updateNotice(params) { N.want = params.n || null; applyNoticeSel(true); return true; }

  async function searchNotices() {
    const box = $('#nlist');
    box.innerHTML = loading();
    N.err = null;
    const my = ++N.seq;
    const instKey = settings.insttDivCd === '2' ? 'dminsttNm' : 'ntceInsttNm';
    const res = await Promise.allSettled(settings.bizs.map((b) =>
      g2bByRange('bid', `getBidPblancListInfo${BIZ[b]}PPSSrch`, { inqryDiv: 1, [instKey]: settings.insttNm, bidNtceNm: N.q }, N.from, N.to, { max: 1000, progress: b === settings.bizs[0] ? progressIn(box, '공고를 불러오는 중…') : null })
        .then((r) => r.items.map((x) => Object.assign({ _biz: b }, x)))));
    if (my !== N.seq) return;
    const map = new Map();
    const errs = [];
    res.forEach((r) => {
      if (r.status !== 'fulfilled') { errs.push(r.reason.message); return; }
      r.value.forEach((n) => { const p = map.get(n.bidNtceNo); if (!p || String(n.bidNtceOrd) > String(p.bidNtceOrd)) map.set(n.bidNtceNo, n); });
    });
    N.items = Array.from(map.values()).sort(byDateDesc('bidNtceDt'));
    N.err = !N.items.length && errs.length ? errs[0] : null;
    applyNoticeSel(false);
  }

  function applyNoticeSel(reveal) {
    const sel = N.want && N.items ? N.items.find((x) => x.bidNtceNo === N.want) : null;
    N.sel = sel || null;
    drawNotices();
    const box = $('#ndetail');
    if (!box) return;
    if (sel) { drawNoticeDetail(sel); if (reveal) revealIfNew(box); } else { box.hidden = true; box.innerHTML = ''; }
  }

  function noticeStatus(n) {
    const kind = String(n.ntceKindNm || '');
    if (/취소/.test(kind)) return ['취소공고', 'red'];
    const closed = n.bidClseDt && new Date(String(n.bidClseDt).replace(' ', 'T')) < new Date();
    if (/변경|정정/.test(kind)) return [closed ? '정정 · 마감' : '정정공고', 'org'];
    return closed ? ['마감', ''] : ['공고중', 'blue'];
  }

  function drawNotices() {
    const box = $('#nlist');
    if (!box) return;
    if (N.err) { box.innerHTML = errBox(N.err); return; }
    if (!N.items) { box.innerHTML = loading(); return; }
    if (!N.items.length) { box.innerHTML = empty('기간 내 공고가 없습니다. 설정의 기관명이나 기간을 확인하세요.'); return; }
    box.innerHTML = `<div class="small muted" style="margin-bottom:6px">총 ${N.items.length}건 · 공고일 최근순</div><div class="tablewrap"><table>
      <thead><tr><th>공고명</th><th>업무</th><th>공고일</th><th>입찰마감</th><th>상태</th><th>문서</th><th>바로가기</th></tr></thead>
      <tbody>${N.items.map((n) => { const [st, cls] = noticeStatus(n); return `<tr class="${N.sel === n ? 'sel' : ''}">
        <td><a class="linkbtn" href="${esc(hashOf('notice', '', { n: n.bidNtceNo }))}">${esc(n.bidNtceNm)}</a><div class="small muted">${esc(n.bidNtceNo)}-${esc(n.bidNtceOrd)}</div></td>
        <td class="nw">${esc(n._biz)}</td><td class="nw">${esc(dateOnly(n.bidNtceDt))}</td><td class="nw">${esc(dt(n.bidClseDt) || '-')}</td>
        <td><span class="badge ${cls}">${esc(st)}</span></td><td class="nw">${noticeDocs(n).length}개</td><td class="nw">${ext(n.bidNtceDtlUrl || n.bidNtceUrl)}</td></tr>`; }).join('')}</tbody>
    </table></div>`;
  }

  function drawNoticeDetail(n) {
    const box = $('#ndetail');
    box.hidden = false;
    const extra = BIZ_HAS_EXTRA.includes(n._biz);
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
        <h2>${esc(n.bidNtceNm)}</h2><span class="small muted">${esc(n.bidNtceNo)}-${esc(n.bidNtceOrd)}</span>
      </div>
      <dl class="kv">
        <dt>계약방법</dt><dd>${esc(n.cntrctCnclsMthdNm || '-')}${n.bidMethdNm ? ' · ' + esc(n.bidMethdNm) : ''}</dd>
        <dt>낙찰방법</dt><dd>${esc(n.sucsfbidMthdNm || '-')}${n.sucsfbidLwltRate ? ` · 낙찰하한율 ${esc(n.sucsfbidLwltRate)}%` : ''}</dd>
        <dt>추정가격</dt><dd>${won(n.presmptPrce)} <span class="small muted">· 배정예산 ${won(n.asignBdgtAmt)}</span></dd>
        ${n.techAbltEvlRt || n.bidPrceEvlRt ? `<dt>평가 비율</dt><dd>기술 ${esc(n.techAbltEvlRt || '-')} : 가격 ${esc(n.bidPrceEvlRt || '-')}</dd>` : ''}
        <dt>공동수급</dt><dd>${esc(n.cmmnSpldmdMethdNm || '-')}${n.rgnDutyJntcontrctRt ? ` · 지역의무 ${esc(n.rgnDutyJntcontrctRt)}%` : ''}</dd>
        <dt>입찰 일정</dt><dd>개시 ${esc(dt(n.bidBeginDt) || '-')} · 마감 ${esc(dt(n.bidClseDt) || '-')} · 개찰 ${esc(dt(n.opengDt) || '-')}</dd>
        <dt>담당자</dt><dd>${esc(n.ntceInsttOfclNm || '-')} ${esc(n.ntceInsttOfclTelNo || '')}</dd>
        ${n.chgNtceRsn ? `<dt>변경 사유</dt><dd>${esc(n.chgNtceRsn)}</dd>` : ''}
      </dl>
      <h3 style="margin-top:16px">공고문서</h3>
      ${docChips(noticeDocs(n))}
      <div class="btns" style="margin-top:14px">
        <button type="button" class="btn sm" data-x="lic">면허제한 · 근거법규</button>
        <button type="button" class="btn sm" data-x="rgn">참가가능지역</button>
        ${extra ? '<button type="button" class="btn sm" data-x="bss">기초금액</button><button type="button" class="btn sm" data-x="chg">정정(변경) 이력</button>' : ''}
        <button type="button" class="btn sm" data-x="eo">e발주 문서</button>
        <button type="button" class="btn sm" data-x="save">보관함에 저장</button>
        ${ext(n.bidNtceDtlUrl || n.bidNtceUrl, '나라장터 공고')}
      </div>
      <div id="nsub"></div>`;
    $$('button[data-x]', box).forEach((b) => b.addEventListener('click', () => noticeExtra(n, b.dataset.x)));
  }

  async function noticeExtra(n, x) {
    const sub = $('#nsub');
    if (x === 'save') { saveItem({ kind: '공고', key: n.bidNtceNo, name: n.bidNtceNm, link: n.bidNtceDtlUrl || n.bidNtceUrl || '' }); return; }
    if (x === 'eo') { loadEorder(n, sub); return; }
    sub.innerHTML = `<div class="sub">${loading()}</div>`;
    const B = BIZ[n._biz];
    try {
      let html = '';
      if (x === 'lic') {
        const r = await g2b('bid', 'getBidPblancListInfoLicenseLimit', { inqryDiv: 2, bidNtceNo: n.bidNtceNo, bidNtceOrd: n.bidNtceOrd, numOfRows: 50 });
        html = `<h3>면허제한</h3>${r.items.length ? `<div class="tablewrap"><table><thead><tr><th>면허제한명</th><th>허용업종</th><th>주력분야</th><th>근거법규</th></tr></thead><tbody>${r.items.map((l) => `<tr><td>${esc(l.lcnsLmtNm)}</td><td>${esc(l.permsnIndstrytyList || '-')}</td><td>${esc(l.indstrytyMfrcFldList || '-')}</td><td class="indref" data-nm="${esc(l.lcnsLmtNm)}"><span class="small muted">…</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">면허제한이 없습니다.</div>'}`;
      } else if (x === 'rgn') {
        const r = await g2b('bid', 'getBidPblancListInfoPrtcptPsblRgn', { inqryDiv: 2, bidNtceNo: n.bidNtceNo, bidNtceOrd: n.bidNtceOrd, numOfRows: 50 });
        html = `<h3>참가가능지역</h3>${r.items.length ? `<div class="docs">${r.items.map((g) => `<span class="badge blue">${esc(g.prtcptPsblRgnNm)}</span>`).join('')}</div>` : '<div class="small muted">지역 제한이 없습니다.</div>'}`;
      } else if (x === 'bss') {
        const r = await g2b('bid', `getBidPblancListInfo${B}BsisAmount`, { inqryDiv: 2, bidNtceNo: n.bidNtceNo, numOfRows: 10 });
        const a = r.items[0];
        html = `<h3>기초금액</h3>${a ? `<dl class="kv"><dt>기초금액</dt><dd><strong>${won(a.bssamt)}</strong></dd><dt>공개일시</dt><dd>${esc(dt(a.bssamtOpenDt) || '-')}</dd><dt>예비가격 범위</dt><dd>${esc(a.rsrvtnPrceRngBgnRate || '-')}% ~ ${esc(a.rsrvtnPrceRngEndRate || '-')}%</dd>${a.evlBssAmt ? `<dt>평가기준금액</dt><dd>${won(a.evlBssAmt)}</dd>` : ''}</dl>` : '<div class="small muted">기초금액이 아직 공개되지 않았습니다.</div>'}`;
      } else if (x === 'chg') {
        const r = await g2b('bid', `getBidPblancListInfoChgHstry${B}`, { inqryDiv: 2, bidNtceNo: n.bidNtceNo, numOfRows: 100 });
        html = `<h3>정정(변경) 이력</h3>${r.items.length ? `<div class="tablewrap"><table><thead><tr><th>변경일시</th><th>항목</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>${r.items.map((h) => `<tr><td class="nw">${esc(dt(h.chgDt))}</td><td>${esc(h.chgItemNm)}</td><td>${esc(h.bfchgVal || '-')}</td><td>${esc(h.afchgVal || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">변경이력이 없습니다.</div>'}`;
      }
      sub.innerHTML = `<div class="sub">${html}</div>`;
      fillIndRefs(sub);
    } catch (e) { sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  // =====================================================================
  // 5. 법령 · 해석 찾기 (탭: 조달청 법령해석 / 업종 · 근거법규)
  // =====================================================================
  const L = { tab: 'expc', q: '', search: '1', from: '', to: '', sort: 'ddes', page: 1, list: null, total: 0, err: null, selId: null, want: null, detail: null, detailErr: null, seq: 0, dseq: 0 };

  function renderLaw(view, arg, params) {
    L.tab = params.tab === 'ind' ? 'ind' : 'expc';
    view.innerHTML = `
      <div class="tabs" role="tablist" aria-label="법령 메뉴 구분" style="margin:0">
        <a class="tab" role="tab" href="${esc(hashOf('law', L.q))}" aria-selected="${L.tab === 'expc'}">조달청 법령해석</a>
        <a class="tab" role="tab" href="#law?tab=ind" aria-selected="${L.tab === 'ind'}">업종 · 근거법규</a>
      </div>
      <div id="lawpane" style="display:flex;flex-direction:column;gap:16px"></div>`;
    if (L.tab === 'ind') renderInd($('#lawpane'), params); else renderExpc($('#lawpane'), arg, params);
  }
  function updateLaw(params) {
    const tab = params.tab === 'ind' ? 'ind' : 'expc';
    if (tab !== L.tab) return false;
    if (tab === 'ind') { I.want = params.ind || null; applyIndSel(true); } else { L.want = params.id || null; applyLawSel(true); }
    return true;
  }

  // ----- 조달청 법령해석 -----
  function findArray(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 5) return null;
    if (Array.isArray(o)) return o.length && typeof o[0] === 'object' ? o : null;
    for (const k of Object.keys(o)) { const a = findArray(o[k], depth + 1); if (a) return a; }
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && ('안건명' in o[k] || '법령해석일련번호' in o[k])) return [o[k]];
    return null;
  }
  function findVal(o, names, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 5) return undefined;
    for (const n of names) if (o[n] != null && typeof o[n] !== 'object') return o[n];
    for (const k of Object.keys(o)) { const v = findVal(o[k], names, depth + 1); if (v !== undefined) return v; }
    return undefined;
  }
  const F = (o, names) => { const v = findVal(o, names); return v == null ? '' : String(v); };
  const lawId = (o) => F(o, ['법령해석일련번호', 'ppsCgmExpcSeq', 'id', 'ID']);
  const fmtLawDate = (v) => { const s = String(v || ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s; };

  function renderExpc(pane, arg, params) {
    if (arg !== L.q) Object.assign(L, { q: arg, page: 1, list: null, err: null, selId: null, detail: null });
    L.want = params.id || null;
    pane.innerHTML = `
      <section class="card">
        <form class="form" id="lform">
          <label class="grow">키워드<input type="search" name="q" value="${esc(L.q)}" placeholder="예: 협상에 의한 계약, 수의계약"></label>
          <label>검색범위<select name="search"><option value="1" ${L.search === '1' ? 'selected' : ''}>안건명</option><option value="2" ${L.search === '2' ? 'selected' : ''}>본문</option></select></label>
          <label>해석일 시작<input type="date" name="from" value="${esc(L.from)}"></label>
          <label>해석일 끝<input type="date" name="to" value="${esc(L.to)}"></label>
          <label>정렬<select name="sort">${[['ddes', '해석일자 최신순'], ['dasc', '해석일자 오래된순'], ['lasc', '안건명 순'], ['ndes', '안건번호 내림차순']].map(([v, t]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit">해석 검색</button>
        </form>
      </section>
      <div class="row" style="align-items:flex-start">
        <section class="card" style="flex:1 1 300px;padding:8px" id="llist"></section>
        <article class="card wide" style="flex:2 1 420px" id="ldetail"></article>
      </div>`;
    $('#lform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const q = f.q.value.trim();
      Object.assign(L, { search: f.search.value, from: f.from.value, to: f.to.value, sort: f.sort.value, page: 1 });
      if (q !== L.q) { L.q = q; L.list = null; L.selId = null; L.detail = null; go('law', q); }
      else { L.want = null; L.selId = null; L.detail = null; replaceHash('law', L.q, {}); searchLaw(); }
    });
    if (!L.list && !L.err) searchLaw(); else { drawLawList(); applyLawSel(false); }
  }

  async function searchLaw() {
    const box = $('#llist');
    if (!box) return;
    box.innerHTML = loading();
    L.err = null;
    const my = ++L.seq;
    try {
      const data = await lawApi('list', { query: L.q, search: L.search, display: 20, page: L.page, sort: L.sort, explYd: L.from && L.to ? `${ymd(L.from)}~${ymd(L.to)}` : '' });
      if (my !== L.seq) return;
      L.list = findArray(data) || [];
      L.total = num(findVal(data, ['totalCnt', 'totalCount'])) || L.list.length;
    } catch (e) { if (my !== L.seq) return; L.list = null; L.err = e.message; }
    drawLawList();
    applyLawSel(false);
  }

  function drawLawList() {
    const box = $('#llist');
    if (!box) return;
    if (L.err) { box.innerHTML = `<div style="padding:10px">${errBox(L.err)}</div>`; return; }
    if (!L.list) { box.innerHTML = loading(); return; }
    if (!L.list.length) { box.innerHTML = empty('검색 결과가 없습니다.'); return; }
    const pages = Math.max(1, Math.ceil(L.total / 20));
    box.innerHTML = `<div class="small muted" style="padding:6px 12px">총 ${L.total.toLocaleString()}건</div><div class="lawlist">${L.list.map((x) => `
      <a class="lawitem" href="${esc(hashOf('law', L.q, { id: lawId(x) }))}" aria-current="${lawId(x) === (L.want || L.selId)}">
        <span style="display:block;font-weight:500">${esc(F(x, ['안건명']))}</span>
        <span class="small muted" style="display:block;margin-top:4px">${esc(F(x, ['안건번호']))} · ${esc(fmtLawDate(F(x, ['해석일자'])))} · ${esc(F(x, ['해석기관명']))}</span>
      </a>`).join('')}</div>
      <div class="pager" style="padding:0 12px 8px">
        <button type="button" class="btn sm" id="lprev" ${L.page <= 1 ? 'disabled' : ''}>이전</button>
        <span class="small muted">${L.page} / ${pages}</span>
        <button type="button" class="btn sm" id="lnext" ${L.page >= pages ? 'disabled' : ''}>다음</button>
      </div>`;
    $('#lprev').addEventListener('click', () => { L.page--; searchLaw(); });
    $('#lnext').addEventListener('click', () => { L.page++; searchLaw(); });
  }

  function applyLawSel(reveal) {
    if (!$('#ldetail')) return;
    if (!L.want) { L.selId = null; L.detail = null; drawLawList(); drawLawDetail(); return; }
    if (L.want === L.selId && (L.detail || L.detailErr)) { drawLawDetail(); return; }
    openLaw(L.want, reveal);
  }

  async function openLaw(id, reveal) {
    L.selId = id;
    L.detail = null; L.detailErr = null;
    if (L.list) drawLawList();
    const box = $('#ldetail');
    box.innerHTML = loading();
    if (reveal && window.matchMedia('(max-width: 900px)').matches) revealIfNew(box);
    const my = ++L.dseq;
    try { const d = await lawApi('detail', { ID: id }); if (my !== L.dseq) return; L.detail = d; } catch (e) { if (my !== L.dseq) return; L.detailErr = e.message; }
    drawLawDetail();
  }

  function drawLawDetail() {
    const box = $('#ldetail');
    if (!box) return;
    if (!L.selId) { box.innerHTML = empty('왼쪽 목록에서 해석을 선택하세요.'); return; }
    if (L.detailErr) { box.innerHTML = errBox(L.detailErr); return; }
    if (!L.detail) { box.innerHTML = loading(); return; }
    const d = L.detail;
    const item = (L.list || []).find((x) => lawId(x) === L.selId);
    const title = F(d, ['안건명']) || (item ? F(item, ['안건명']) : '');
    const refs = F(d, ['관련법령']).split(/\n|,(?=\s*「)|<br\s*\/?>|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const refLink = (r) => lawUrl((r.match(/「([^」]+)」/) || [])[1] || r.replace(/\s*제\s*\d+.*$/, ''));
    const sec = (h, v) => `<h3>${h}</h3><p class="lawbody">${esc(v || '-')}</p>`;
    box.innerHTML = `
      <div class="small muted">안건번호 ${esc(F(d, ['안건번호']))} · 해석일자 ${esc(fmtLawDate(F(d, ['해석일자'])))} · 해석기관 ${esc(F(d, ['해석기관명']))} · 질의기관 ${esc(F(d, ['질의기관명']))}</div>
      <h2 style="margin:6px 0 16px;font-size:18px">${esc(title)}</h2>
      ${sec('질의요지', F(d, ['질의요지']))}${sec('회답', F(d, ['회답']))}${sec('이유', F(d, ['이유']))}
      <h3>관련법령</h3>
      <div class="docs" style="margin:0 0 18px">${refs.length ? refs.map((r) => `<a class="doc" href="${esc(refLink(r))}" target="_blank" rel="noopener">${esc(r)} ↗</a>`).join('') : '<span class="small muted">-</span>'}</div>
      <div class="btns">
        <a class="btn primary" href="/api/law?mode=html&ID=${encodeURIComponent(L.selId)}" target="_blank" rel="noopener">법제처 원문 보기 ↗</a>
        <button type="button" class="btn" id="lsave">보관함에 저장</button>
      </div>`;
    $('#lsave').addEventListener('click', () => saveItem({ kind: '법령해석', key: L.selId, name: title, link: '/api/law?mode=html&ID=' + encodeURIComponent(L.selId) }));
  }

  // ----- 업종 · 근거법규 -----
  function renderInd(pane, params) {
    I.want = params.ind || null;
    pane.innerHTML = `
      <section class="card">
        <form class="form" id="iform">
          <label class="grow">업종명 또는 업종코드<input type="search" name="q" value="${esc(I.q)}" placeholder="예: 정보통신공사업, 소프트웨어, 0001" autocomplete="off"></label>
          <label>법 분야(업종분류)<select name="cls" id="icls"><option value="">전체</option></select></label>
          <button class="btn primary" type="submit">업종 검색</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">나라장터 입찰참가자격 업종별 근거법령 · 관련규정 · 포함면허 (현재 사용 중인 업종 기준). 입력하는 대로 바로 걸러집니다.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <section class="card" style="flex:1 1 320px" id="ilist"></section>
        <article class="card wide" style="flex:1.3 1 420px" id="idetail"></article>
      </div>`;
    const f = $('#iform');
    let t;
    f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { I.q = f.q.value.trim(); drawIndList(); }, 200); });
    f.cls.addEventListener('change', () => { I.cls = f.cls.value; drawIndList(); });
    f.addEventListener('submit', (e) => { e.preventDefault(); I.q = f.q.value.trim(); I.cls = f.cls.value; drawIndList(); });
    $('#ilist').innerHTML = loading('업종 목록을 불러오는 중…');
    ensureInd().then(() => {
      const sel = $('#icls');
      if (!sel) return;
      const cls = new Map();
      I.all.forEach((x) => { if (x.cc && !cls.has(x.cc)) cls.set(x.cc, x.cn || x.cc); });
      sel.innerHTML = '<option value="">전체</option>' + Array.from(cls.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([c, n]) => `<option value="${esc(c)}" ${I.cls === c ? 'selected' : ''}>${esc(n)}</option>`).join('');
      drawIndList();
      applyIndSel(false);
    }).catch((e) => { const b = $('#ilist'); if (b) b.innerHTML = errBox(e.message); drawIndDetail(); });
    drawIndDetail();
  }

  function indFiltered() {
    const q = I.q.toLowerCase();
    return (I.all || []).filter((x) => (!I.cls || x.cc === I.cls) && (!q || x.nm.toLowerCase().includes(q) || x.cd.includes(q) || x.law.toLowerCase().includes(q)));
  }
  function drawIndList() {
    const box = $('#ilist');
    if (!box || !I.all) return;
    const rows = indFiltered();
    const shown = rows.slice(0, 200);
    box.innerHTML = `<div class="small muted" style="margin-bottom:6px">${rows.length.toLocaleString()}개 업종${rows.length > 200 ? ' · 상위 200개 표시 (검색어를 더 입력하세요)' : ''}</div>
      ${shown.length ? `<div class="tablewrap"><table style="min-width:420px">
        <thead><tr><th>코드</th><th>업종명</th><th>근거법령</th></tr></thead>
        <tbody>${shown.map((x) => `<tr class="${x.cd === I.want ? 'sel' : ''}"><td class="nw">${esc(x.cd)}</td><td><a class="linkbtn" href="${esc(hashOf('law', '', { tab: 'ind', ind: x.cd }))}">${esc(x.nm)}</a></td><td class="small">${esc(x.law || '-')}</td></tr>`).join('')}</tbody>
      </table></div>` : empty('조건에 맞는 업종이 없습니다.')}`;
  }
  function applyIndSel(reveal) {
    drawIndList();
    drawIndDetail();
    if (reveal && I.want && window.matchMedia('(max-width: 900px)').matches) revealIfNew($('#idetail'));
  }
  function drawIndDetail() {
    const box = $('#idetail');
    if (!box) return;
    if (!I.want) { box.innerHTML = empty('왼쪽 목록에서 업종을 선택하세요.'); return; }
    if (!I.all) { box.innerHTML = I.err ? errBox(I.err) : loading(); return; }
    const it = indByCode(I.want);
    if (!it) { box.innerHTML = empty(`업종코드 ${I.want}를 찾지 못했습니다. (폐지되었거나 사용하지 않는 업종일 수 있습니다)`); return; }
    const incl = parseIncl(it.incl);
    const codeLink = (cd, nm) => (cd && indByCode(cd) ? `<a href="${esc(hashOf('law', '', { tab: 'ind', ind: cd }))}">${esc(nm || cd)}</a>` : esc(nm || cd));
    box.innerHTML = `
      <div class="small muted">업종코드 ${esc(it.cd)} · 분류 ${esc(it.cn || it.cc || '-')}</div>
      <h2 style="margin:6px 0 16px;font-size:19px">${esc(it.nm)}</h2>
      <dl class="kv">
        <dt>근거법령</dt><dd><strong>${esc([it.law, it.art].filter(Boolean).join(' ') || '-')}</strong>
          ${it.law ? `<a href="${esc(lawUrl(it.law))}" target="_blank" rel="noopener" style="margin-left:6px" class="small">국가법령정보센터 ↗</a>` : ''}
          ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener" style="margin-left:6px" class="small">나라장터 근거법령 ↗</a>` : ''}</dd>
        <dt>관련규정</dt><dd style="line-height:1.7">${esc(it.rule || '-')}</dd>
        <dt>포함면허</dt><dd>${incl.length ? `<div style="display:flex;flex-direction:column;gap:6px">${incl.map((x) => `<span>${codeLink(x.aCd, x.aNm)} <span class="muted">→</span> ${codeLink(x.bCd, x.bNm)}</span>`).join('')}</div>` : '<span class="muted">-</span>'}</dd>
        <dt>등록 · 변경</dt><dd>${esc(dt(it.rg) || '-')}${it.ch ? ' · 변경 ' + esc(dt(it.ch)) : ''}</dd>
      </dl>
      <div class="btns" style="margin-top:18px">
        <a class="btn sm" href="${esc(hashOf('law', it.nm.replace(/\(.*?\)/g, '').trim()))}">이 업종 관련 법령해석</a>
        <a class="btn sm" href="${esc(hashOf('similar', '', { ind: it.cd }))}">이 업종 제한 공고 찾기</a>
        <button type="button" class="btn sm" id="isave">보관함에 저장</button>
      </div>`;
    $('#isave').addEventListener('click', () => saveItem({ kind: '업종', key: it.cd, name: `${it.nm} (${it.cd})`, link: hashOf('law', '', { tab: 'ind', ind: it.cd }) }));
  }

  // =====================================================================
  // 6. 물품 · 나라장터 쇼핑몰
  // =====================================================================
  // 나라장터 쇼핑몰 품목정보(상품 · 납품요구 · 특정품목 조달내역) + 조달청 물품목록정보(품명 · 품목 · 속성)
  // 쇼핑몰 데이터는 전날까지 제공 → 조회 끝 날짜 기본값은 어제
  const yday = () => iso(addDays(today(), -1));
  const ymdDash = (s) => { const v = String(s || '').replace(/\D/g, ''); return v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : (s || ''); };
  const SHOP_URL = 'https://shop.g2b.go.kr';
  const GD = {
    tab: 'shop',
    // 나라장터 쇼핑몰 상품
    q: '', field: 'prdctClsfcNoNm', mthd: '', excl: false, cert: false, cn: false, sort: 'price', months: '3',
    items: null, err: null, seq: 0, key: '', open: '', buy: null, buyErr: null, buyKey: '',
    // 납품요구 실적
    dInst: '', dFrom: '', dTo: '', dQ: '', dItems: null, dErr: null, dSeq: 0, dOpen: '', dDtl: {},
    // 물품분류 · 규격
    cQ: '', cItems: null, cErr: null, cSeq: 0, cSel: '', cPrd: null, cPrdErr: null, cAttr: {}, cCn: false,
  };
  const GD_TABS = [['shop', '나라장터 쇼핑몰 상품 찾기'], ['dlvr', '납품요구 실적'], ['cls', '물품분류 · 규격 찾기']];
  const SHOP_FIELDS = [['prdctClsfcNoNm', '품명'], ['dtilPrdctClsfcNoNm', '세부품명'], ['prdctIdntNoNm', '규격명(식별명)']];
  const yn = (v) => String(v || '').toUpperCase() === 'Y';

  function renderGoods(view, arg, params) {
    GD.tab = GD_TABS.some(([k]) => k === params.tab) ? params.tab : 'shop';
    if (!GD.dInst) GD.dInst = settings.insttNm || '충청남도교육청';
    if (!GD.dFrom) { GD.dFrom = iso(addDays(today(), -30)); GD.dTo = yday(); }
    view.innerHTML = `
      <div class="tabs" role="tablist" aria-label="물품 메뉴 구분" style="margin:0">
        ${GD_TABS.map(([k, t]) => `<a class="tab" role="tab" href="${esc(hashOf('goods', '', { tab: k === 'shop' ? '' : k }))}" aria-selected="${GD.tab === k}">${t}</a>`).join('')}
      </div>
      <div id="gdpane" style="display:flex;flex-direction:column;gap:16px"></div>`;
    const pane = $('#gdpane');
    if (GD.tab === 'dlvr') renderDlvr(pane); else if (GD.tab === 'cls') renderCls(pane, params); else renderShop(pane, params);
  }

  // ---------- 나라장터 쇼핑몰 상품 찾기 ----------
  function renderShop(pane, params) {
    if (params.q && params.q !== GD.q) { GD.q = params.q; GD.field = params.f && SHOP_FIELDS.some(([k]) => k === params.f) ? params.f : 'prdctClsfcNoNm'; GD.items = null; }
    pane.innerHTML = `
      <section class="card">
        <form class="form" id="shform">
          <label class="grow">검색어<input type="search" name="q" value="${esc(GD.q)}" placeholder="예: 책상, 논슬립, 의자" required></label>
          <label>검색 대상<select name="field">${SHOP_FIELDS.map(([k, t]) => `<option value="${k}" ${GD.field === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>등록 기간<select name="months">${[['1', '최근 1개월'], ['3', '최근 3개월'], ['6', '최근 6개월'], ['12', '최근 1년']].map(([v, t]) => `<option value="${v}" ${GD.months === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit">상품 검색</button>
        </form>
        <div class="form" style="margin-top:10px;align-items:center">
          <label>계약방법<select id="shmthd"><option value="">전체</option>${['다수공급자계약', '일반단가계약', '제3자단가계약'].map((v) => `<option ${GD.mthd === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>정렬<select id="shsort"><option value="price" ${GD.sort === 'price' ? 'selected' : ''}>낮은 가격순</option><option value="recent" ${GD.sort === 'recent' ? 'selected' : ''}>최근 등록순</option></select></label>
          <label class="chk"><input type="checkbox" id="shexcl" ${GD.excl ? 'checked' : ''}>우수제품</label>
          <label class="chk"><input type="checkbox" id="shcert" ${GD.cert ? 'checked' : ''}>인증제품</label>
          <label class="chk"><input type="checkbox" id="shcn" ${GD.cn ? 'checked' : ''}>충남 업체만</label>
        </div>
        <p class="small muted" style="margin:10px 0 0">나라장터 쇼핑몰에 등록된 단가계약 상품(전날까지 등록분)에서 찾습니다. 업체 이름을 누르면 '업체 확인'으로 이동합니다.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <div id="shlist" style="flex:3 1 480px;min-width:0;display:flex;flex-direction:column;gap:12px"></div>
        <aside style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:16px"><section class="card" id="shsum"></section><section class="card" id="shbuy"></section></aside>
      </div>`;
    const f = $('#shform');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      GD.q = f.q.value.trim(); GD.field = f.field.value; GD.months = f.months.value;
      if (!GD.q) return;
      GD.items = null;
      replaceHash('goods', '', { q: GD.q, f: GD.field === 'prdctClsfcNoNm' ? '' : GD.field });
      searchShop();
    });
    $('#shmthd').addEventListener('change', (e) => { GD.mthd = e.target.value; drawShop(); });
    $('#shsort').addEventListener('change', (e) => { GD.sort = e.target.value; drawShop(); });
    $('#shexcl').addEventListener('change', (e) => { GD.excl = e.target.checked; drawShop(); });
    $('#shcert').addEventListener('change', (e) => { GD.cert = e.target.checked; drawShop(); });
    $('#shcn').addEventListener('change', (e) => { GD.cn = e.target.checked; drawShop(); });
    if (GD.q && !GD.items && !GD.err) searchShop(); else drawShop();
  }

  async function searchShop() {
    const box = $('#shlist');
    const from = monthsAgo(Number(GD.months)), to = yday();
    box.innerHTML = loading(`나라장터 쇼핑몰 상품을 찾는 중… (${chunkNote('shop', from, to)})`);
    $('#shsum').innerHTML = ''; $('#shbuy').innerHTML = '';
    const my = ++GD.seq;
    try {
      const r = await g2bByRange('shop', 'getShoppingMallPrdctInfoList', { inqryDiv: 1, [GD.field]: GD.q }, from, to, { dateStyle: 'date', max: 999, progress: progressIn(box, '나라장터 쇼핑몰 상품을 찾는 중…') });
      if (my !== GD.seq) return;
      // 같은 상품(쇼핑계약번호+순번)은 하나만
      const m = new Map();
      r.items.forEach((p) => { const k = (p.shopngCntrctNo || '') + '|' + (p.shopngCntrctSno || '') + '|' + (p.prdctIdntNo || ''); if (!m.has(k)) m.set(k, p); });
      GD.items = Array.from(m.values()); GD.err = null; GD.failed = r.failed;
    } catch (e) { if (my === GD.seq) { GD.err = e.message; GD.items = null; } }
    if (my === GD.seq) { drawShop(); loadBuy(); }
  }

  function drawShop() {
    const box = $('#shlist'), sum = $('#shsum');
    if (!box) return;
    if (GD.err) { box.innerHTML = errBox(GD.err); sum.innerHTML = ''; return; }
    if (!GD.items) { box.innerHTML = `<div class="card">${empty('품명이나 규격명을 입력하고 검색하세요.')}</div>`; sum.innerHTML = '<h2>단가 참고</h2><p class="small muted">검색하면 계약단가 통계가 표시됩니다.</p>'; return; }
    // 충남 업체만: 계약업체 사업자번호로 소재지 확인 (상위 60개 업체, 저장해 두고 재사용)
    if (GD.cn) {
      const need = Array.from(new Set(GD.items.map((p) => String(p.cntrctCorpBizno || '').replace(/\D/g, '')).filter((b) => b.length === 10))).slice(0, 60);
      const pending = need.filter((b) => !(GD.rgn || {})[b] && GD.rgn?.[b] !== '');
      if (pending.length) {
        box.innerHTML = loading(`업체 소재지를 확인하는 중… (${pending.length}곳)`);
        GD.rgn = GD.rgn || {};
        pool(pending.map((b) => async () => { GD.rgn[b] = await corpRegion(b); }), 6).then(drawShop);
        return;
      }
    }
    let list = GD.items.filter((p) => (!GD.mthd || String(p.cntrctMthdNm || '').replace(/\s/g, '').includes(GD.mthd.replace(/\s/g, '')))
      && (!GD.excl || yn(p.exclncPrcrmntPrdctYn)) && (!GD.cert || (p.prodctCertList && p.prodctCertList !== '-'))
      && (!GD.cn || isCN((GD.rgn || {})[String(p.cntrctCorpBizno || '').replace(/\D/g, '')])));
    list = list.slice().sort(GD.sort === 'price' ? (a, b) => (num(a.cntrctPrceAmt) || 9e15) - (num(b.cntrctPrceAmt) || 9e15) : (a, b) => String(b.rgstDt || '').localeCompare(String(a.rgstDt || '')));
    const shown = list.slice(0, 60);
    box.innerHTML = list.length ? shown.map((p, i) => {
      const badges = [
        p.cntrctMthdNm ? `<span class="badge blue">${esc(p.cntrctMthdNm)}</span>` : '',
        yn(p.exclncPrcrmntPrdctYn) ? '<span class="badge grn">우수조달</span>' : '',
        yn(p.smetprCmptProdctYn) ? '<span class="badge">중소기업자간 경쟁</span>' : '',
        p.prodctCertList && p.prodctCertList !== '-' ? `<span class="badge grn">${esc(p.prodctCertList)}</span>` : '',
        GD.cn ? rgnBadge((GD.rgn || {})[String(p.cntrctCorpBizno || '').replace(/\D/g, '')]) : '',
      ].join(' ');
      const img = /^https:\/\//.test(p.prdctImgUrl || '') ? `<img src="${esc(p.prdctImgUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="noimg">이미지 없음</span>';
      return `<article class="result prd">
        <div class="pimg">${img}</div>
        <div style="flex:1;min-width:0">
          <div class="badges">${badges}</div>
          <h3>${esc(p.prdctSpecNm || p.dtilPrdctClsfcNoNm || p.prdctClsfcNoNm)}</h3>
          <div class="meta">${esc(p.prdctClsfcNoNm || '')} › ${esc(p.dtilPrdctClsfcNoNm || '')} · 물품식별번호 ${esc(p.prdctIdntNo || '-')}</div>
          <div class="small" style="margin-top:6px">${corpLink(p.cntrctCorpBizno, p.cntrctCorpNm)} <span class="muted">· ${esc([p.entrprsDivNm, p.prdctMakrNm && p.prdctMakrNm !== p.cntrctCorpNm ? '제조 ' + p.prdctMakrNm : ''].filter(Boolean).join(' · '))}</span></div>
          <div class="small muted" style="margin-top:4px">${esc([p.prdctUnit ? '단위 ' + p.prdctUnit : '', p.dlvrTmlmtDaynum ? '납품기한 ' + p.dlvrTmlmtDaynum + '일' : '', p.prdctSplyRgnNm, p.prdctDlvryCndtnNm, p.cntrctBgnDate ? `계약기간 ${ymdDash(p.cntrctBgnDate)} ~ ${ymdDash(p.cntrctEndDate)}` : ''].filter(Boolean).join(' · '))}</div>
          <div class="btns" style="margin-top:10px">
            <button type="button" class="btn sm" data-attr="${i}">규격 · 속성 보기</button>
            <button type="button" class="btn sm" data-save="${i}">보관함에 저장</button>
          </div>
          <div id="shsub-${i}"></div>
        </div>
        <div class="pprice"><div class="small muted">계약단가</div><strong>${won(p.cntrctPrceAmt)}</strong>${p.prdctUnit ? `<span class="small muted">/${esc(p.prdctUnit)}</span>` : ''}${ext(SHOP_URL, '나라장터 쇼핑몰')}</div>
      </article>`;
    }).join('') + (list.length > 60 ? `<p class="small muted">상위 60건만 표시합니다 (전체 ${list.length}건). 검색어를 더 구체적으로 입력해 보세요.</p>` : '')
      : `<div class="card">${empty(GD.items.length ? '선택한 조건에 맞는 상품이 없습니다.' : '검색 결과가 없습니다. 등록 기간을 늘리거나 검색 대상을 바꿔 보세요.')}</div>`;
    $$('.pimg img', box).forEach((im) => im.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'noimg'; s.textContent = '이미지 없음'; im.replaceWith(s); }));
    $$('button[data-attr]', box).forEach((b) => b.addEventListener('click', () => { const p = shown[Number(b.dataset.attr)]; const sub = $('#shsub-' + b.dataset.attr); if (sub.innerHTML) { sub.innerHTML = ''; return; } loadAttrs(p.prdctIdntNo, sub); }));
    $$('button[data-save]', box).forEach((b) => b.addEventListener('click', () => { const p = shown[Number(b.dataset.save)]; saveItem({ kind: '물품', key: p.prdctIdntNo + '|' + p.shopngCntrctNo, name: `${p.prdctSpecNm || p.prdctClsfcNoNm} (${p.cntrctCorpNm}, ${won(p.cntrctPrceAmt)})`, link: SHOP_URL }); }));
    // 단가 참고: 가장 많은 단위끼리
    const units = {};
    list.forEach((p) => { const u = p.prdctUnit || '-'; (units[u] = units[u] || []).push(num(p.cntrctPrceAmt)); });
    const top = Object.entries(units).sort((a, b) => b[1].length - a[1].length)[0];
    const vals = top ? top[1].filter((v) => v > 0) : [];
    sum.innerHTML = `<h2>단가 참고</h2>
      ${GD.failed ? `<p class="small" style="color:var(--red);margin:0 0 8px">일부 기간(${GD.failed}구간)은 응답이 없어 빠졌습니다.</p>` : ''}
      <p class="small muted" style="margin:0 0 10px">조건에 맞는 상품 ${list.length}건 중 단위 '${esc(top ? top[0] : '-')}' ${vals.length}건 기준</p>
      <dl class="kv" style="grid-template-columns:1fr auto">
        <dt>최저 단가</dt><dd><strong>${won(vals.length ? Math.min(...vals) : 0)}</strong></dd>
        <dt>평균 단가</dt><dd>${won(vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0)}</dd>
        <dt>최고 단가</dt><dd>${won(vals.length ? Math.max(...vals) : 0)}</dd>
      </dl>
      <button type="button" class="btn" id="shcsv" style="width:100%;margin-top:14px;justify-content:center">검색 결과 CSV 내보내기</button>`;
    $('#shcsv').addEventListener('click', () => downloadCsv(`나라장터쇼핑몰_${GD.q}_${iso(today())}.csv`, [['물품규격명', '품명', '세부품명', '물품식별번호', '계약업체', '사업자번호', '기업구분', '계약방법', '계약단가', '단위', '납품기한(일)', '공급지역', '우수조달', '인증', '계약시작', '계약종료', '쇼핑계약번호']].concat(list.map((p) => [p.prdctSpecNm, p.prdctClsfcNoNm, p.dtilPrdctClsfcNoNm, p.prdctIdntNo, p.cntrctCorpNm, p.cntrctCorpBizno, p.entrprsDivNm, p.cntrctMthdNm, num(p.cntrctPrceAmt), p.prdctUnit, p.dlvrTmlmtDaynum, p.prdctSplyRgnNm, p.exclncPrcrmntPrdctYn, p.prodctCertList, ymdDash(p.cntrctBgnDate), ymdDash(p.cntrctEndDate), p.shopngCntrctNo]))));
    drawBuy();
  }

  // 품목(물품식별번호) 개별 속성 → 규격서 작성 참고
  async function loadAttrs(idnt, sub) {
    if (!idnt) { sub.innerHTML = `<div class="sub">${empty('물품식별번호가 없습니다.')}</div>`; return; }
    sub.innerHTML = `<div class="sub">${loading('품목 속성을 불러오는 중…')}</div>`;
    try {
      const r = GD.cAttr[idnt] || (GD.cAttr[idnt] = await g2bAll('thng', 'getPrdctIndvAtrbInfoList02', { prdctIdntNo: idnt }, { per: 100, max: 300 }));
      sub.innerHTML = `<div class="sub"><h3>품목 속성 <span class="small muted">물품식별번호 ${esc(idnt)}</span></h3>${r.items.length ? `<div class="tablewrap"><table><thead><tr><th>속성명</th><th>속성값</th><th>단위</th></tr></thead><tbody>${r.items.map((a) => `<tr><td>${esc(a.attrNm)}</td><td>${esc(a.attrVal)}</td><td>${esc(a.attrUnit || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">등록된 속성이 없습니다.</p>'}</div>`;
    } catch (e) { GD.cAttr[idnt] = null; sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  // 다른 기관 구매 실적: 같은 품명을 쇼핑몰 · 총액계약으로 산 내역 (최근 3개월)
  async function loadBuy() {
    const nm = GD.field === 'prdctClsfcNoNm' ? GD.q : ((GD.items || [])[0] || {}).prdctClsfcNoNm;
    const key = nm || '';
    if (!nm) { GD.buy = []; GD.buyKey = key; drawBuy(); return; }
    if (GD.buyKey === key && (GD.buy || GD.buyErr)) { drawBuy(); return; }
    GD.buyKey = key; GD.buy = null; GD.buyErr = null; drawBuy();
    try {
      const r = await g2bByRange('shop', 'getSpcifyPrdlstPrcureInfoList', { inqryDiv: 1, inqryPrdctDiv: 1, prdctClsfcNoNm: nm }, iso(addDays(today(), -91)), yday(), { dateStyle: 'date', max: 999 });
      if (GD.buyKey !== key) return;
      GD.buy = r.items.filter((x) => x.fnlCntrctDlvrReqChgOrdYn !== 'N');
    } catch (e) { if (GD.buyKey === key) GD.buyErr = e.message; }
    drawBuy();
  }
  function drawBuy() {
    const box = $('#shbuy');
    if (!box) return;
    const nm = GD.buyKey;
    if (!GD.items) { box.innerHTML = '<h2>다른 기관 구매 실적</h2><p class="small muted">검색하면 같은 품명을 다른 기관이 산 단가가 표시됩니다.</p>'; return; }
    if (GD.buyErr) { box.innerHTML = `<h2>다른 기관 구매 실적</h2>${errBox(GD.buyErr)}`; return; }
    if (!GD.buy) { box.innerHTML = `<h2>다른 기관 구매 실적</h2>${loading(`'${nm}' 구매 실적을 불러오는 중…`)}`; return; }
    const mine = GD.buy.filter((x) => String(x.dminsttNm || '').includes((settings.insttNm || '').slice(0, 4)));
    const rows = GD.buy.slice().sort((a, b) => String(b.cntrctDlvrReqDate).localeCompare(String(a.cntrctDlvrReqDate)));
    const ups = rows.map((x) => num(x.prdctUprc)).filter((v) => v > 0);
    box.innerHTML = `<h2>다른 기관 구매 실적</h2>
      <p class="small muted" style="margin:0 0 10px">'${esc(nm)}' 최근 3개월 ${rows.length}건${mine.length ? ` · 우리 기관 ${mine.length}건` : ''}${ups.length ? ` · 평균 단가 ${won(Math.round(ups.reduce((a, b) => a + b, 0) / ups.length))}` : ''}</p>
      ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>수요기관 · 품목</th><th class="num">단가</th></tr></thead><tbody>${rows.slice(0, 15).map((x) => `<tr><td>${esc(x.dminsttNm)}<div class="small muted">${esc(x.prdctIdntNoNm || x.dtilPrdctClsfcNoNm || '')} · ${corpLink(x.bizno, x.corpNm)} · ${esc(ymdDash(x.cntrctDlvrReqDate))}</div></td><td class="num nw">${won(x.prdctUprc)}${x.prdctQty ? `<div class="small muted">${esc(x.prdctQty)}${esc(x.prdctUnit || '')}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>${rows.length > 15 ? '<p class="small muted">최근 15건만 표시</p>' : ''}` : '<p class="small muted">최근 3개월 구매 실적이 없습니다.</p>'}`;
  }

  // ---------- 납품요구 실적 ----------
  function renderDlvr(pane) {
    pane.innerHTML = `
      <section class="card">
        <form class="form" id="dlform">
          <label>수요기관<input type="search" name="inst" value="${esc(GD.dInst)}" placeholder="비우면 전국"></label>
          <label>접수일 시작<input type="date" name="from" value="${esc(GD.dFrom)}" max="${yday()}" required></label>
          <label>접수일 끝<input type="date" name="to" value="${esc(GD.dTo)}" max="${yday()}" required></label>
          <label class="grow">건명 · 업체 · 품명 (선택)<input type="search" name="q" value="${esc(GD.dQ)}" placeholder="예: 책상, 급식기구"></label>
          <button class="btn primary" type="submit">납품요구 조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">단가계약(일반단가 · 제3자단가 · 다수공급자) 물품을 나라장터 쇼핑몰에서 납품요구한 내역입니다. 전날 접수분까지, 한 번에 최대 3개월.</p>
      </section>
      <div id="dlres" style="display:flex;flex-direction:column;gap:16px"></div>`;
    const f = $('#dlform');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const bad = checkRange(f.from.value, f.to.value, 92);
      if (bad) { $('#dlres').innerHTML = errBox(bad); return; }
      const changed = f.inst.value.trim() !== GD.dInst || f.from.value !== GD.dFrom || f.to.value !== GD.dTo;
      GD.dInst = f.inst.value.trim(); GD.dFrom = f.from.value; GD.dTo = f.to.value; GD.dQ = f.q.value.trim();
      if (changed || !GD.dItems) searchDlvr(); else drawDlvr();
    });
    if (GD.dItems || GD.dErr) drawDlvr(); else searchDlvr();
  }
  async function searchDlvr() {
    const box = $('#dlres');
    box.innerHTML = loading(`납품요구 내역을 받는 중… (${chunkNote('shop', GD.dFrom, GD.dTo)})`);
    const my = ++GD.dSeq;
    try {
      const r = await g2bByRange('shop', 'getDlvrReqInfoList', { inqryDiv: 1, dminsttNm: GD.dInst }, GD.dFrom, GD.dTo, { dateStyle: 'date', max: 5000, progress: progressIn(box, '납품요구 내역을 받는 중…') });
      if (my !== GD.dSeq) return;
      // 같은 납품요구번호는 최종 변경차수만
      const m = new Map();
      r.items.forEach((d) => { const p = m.get(d.dlvrReqNo); if (!p || String(d.dlvrReqChgOrd) > String(p.dlvrReqChgOrd)) m.set(d.dlvrReqNo, d); });
      GD.dItems = Array.from(m.values()).sort((a, b) => String(b.dlvrReqRcptDate).localeCompare(String(a.dlvrReqRcptDate)));
      GD.dErr = null; GD.dTrunc = r.truncated;
    } catch (e) { if (my === GD.dSeq) { GD.dErr = e.message; GD.dItems = null; } }
    if (my === GD.dSeq) drawDlvr();
  }
  function drawDlvr() {
    const box = $('#dlres');
    if (!box) return;
    if (GD.dErr) { box.innerHTML = errBox(GD.dErr); return; }
    if (!GD.dItems) { box.innerHTML = ''; return; }
    const q = GD.dQ;
    const list = GD.dItems.filter((d) => !q || [d.dlvrReqNm, d.corpNm, d.rprsntPrdctClsfcNoNm, d.rprsntDtilPrdctClsfcNoNm].some((v) => String(v || '').includes(q)));
    const total = list.reduce((a, d) => a + num(d.dlvrReqAmt), 0);
    const corps = new Set(list.map((d) => d.corpBizno || d.corpNm));
    const rg = GD.dRgn || {};
    const cnCnt = list.filter((d) => isCN(rg[String(d.corpBizno || '').replace(/\D/g, '')])).length;
    const checked = list.filter((d) => rg[String(d.corpBizno || '').replace(/\D/g, '')] != null).length;
    box.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="small muted">납품요구 건수</div><strong>${list.length.toLocaleString()}건</strong></div>
        <div class="card stat"><div class="small muted">납품요구 금액</div><strong>${won(total)}</strong></div>
        <div class="card stat"><div class="small muted">업체 수</div><strong>${corps.size.toLocaleString()}곳</strong></div>
        <div class="card stat"><div class="small muted">충남 업체 비율</div><strong>${checked ? Math.round((cnCnt / checked) * 100) + '%' : '-'}</strong>${checked < list.length ? `<button type="button" class="linkbtn small" id="dlrgn">${checked ? '나머지 확인' : '업체 소재지 확인'}</button>` : ''}</div>
      </div>
      <section class="card">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:10px">
          <h2 style="margin:0">납품요구 목록</h2>
          <span class="small muted">${esc(GD.dInst || '전국')} · ${esc(GD.dFrom)} ~ ${esc(GD.dTo)}${q ? ` · '${esc(q)}'` : ''}</span>
        </div>
        ${GD.dTrunc ? '<p class="small" style="color:var(--red)">결과가 많아 일부 구간이 잘렸습니다. 기간을 줄이거나 수요기관을 지정해 보세요.</p>' : ''}
        ${list.length ? `<div class="tablewrap"><table>
          <thead><tr><th class="nw">접수일</th><th>납품요구건명</th><th>업체</th><th>대표품명</th><th class="nw">계약형태</th><th class="num">금액</th><th class="nw">납기</th></tr></thead>
          <tbody>${list.slice(0, 300).map((d, i) => `<tr>
            <td class="nw">${esc(ymdDash(d.dlvrReqRcptDate))}</td>
            <td><button type="button" class="linkbtn" data-dl="${i}" aria-expanded="${GD.dOpen === d.dlvrReqNo}">${esc(d.dlvrReqNm)}</button><div class="small muted">${esc(d.dlvrReqNo)}${d.dlvrReqChgOrd && d.dlvrReqChgOrd !== '00' ? ` · 변경 ${esc(d.dlvrReqChgOrd)}차` : ''}${GD.dInst ? '' : ` · ${esc(d.dminsttNm || '')}`}</div></td>
            <td>${corpLink(d.corpBizno, d.corpNm)} ${rgnBadge(rg[String(d.corpBizno || '').replace(/\D/g, '')])}<div class="small muted">${esc(d.corpEntrprsDivNmNm || '')}</div></td>
            <td>${esc(d.rprsntPrdctClsfcNoNm || '')}<div class="small muted">${esc(d.rprsntDtilPrdctClsfcNoNm || '')}</div></td>
            <td class="nw">${esc(d.cntrctCnclsStleNm || '')}${yn(d.masYn) ? '<div class="small muted">다수공급자</div>' : ''}${yn(d.exclcProdctYn) ? '<div class="small muted">우수제품</div>' : ''}</td>
            <td class="num nw">${won(d.dlvrReqAmt)}</td>
            <td class="nw">${esc(ymdDash(d.maxDlvrTmlmtDate))}</td></tr>
            ${GD.dOpen === d.dlvrReqNo ? `<tr><td colspan="7" style="background:var(--soft)" id="dldtl">${loading('품목 상세를 불러오는 중…')}</td></tr>` : ''}`).join('')}</tbody>
        </table></div>${list.length > 300 ? '<p class="small muted">최근 300건만 표시 (CSV에는 전체)</p>' : ''}
        <button type="button" class="btn" id="dlcsv" style="margin-top:12px">납품요구 CSV 내보내기</button>` : empty('조건에 맞는 납품요구가 없습니다.')}
      </section>`;
    $$('button[data-dl]', box).forEach((b) => b.addEventListener('click', () => { const d = list[Number(b.dataset.dl)]; GD.dOpen = GD.dOpen === d.dlvrReqNo ? '' : d.dlvrReqNo; drawDlvr(); }));
    const rb = $('#dlrgn');
    if (rb) rb.addEventListener('click', async () => {
      rb.disabled = true; rb.textContent = '확인 중…';
      GD.dRgn = GD.dRgn || {};
      const bz = Array.from(new Set(list.map((d) => String(d.corpBizno || '').replace(/\D/g, '')).filter((b) => b.length === 10 && GD.dRgn[b] == null))).slice(0, 80);
      await pool(bz.map((b) => async () => { GD.dRgn[b] = await corpRegion(b); }), 6);
      drawDlvr();
    });
    const csv = $('#dlcsv');
    if (csv) csv.addEventListener('click', () => downloadCsv(`납품요구_${GD.dInst || '전국'}_${GD.dFrom}_${GD.dTo}.csv`, [['접수일', '납품요구번호', '변경차수', '건명', '수요기관', '업체', '사업자번호', '기업구분', '대표품명', '대표세부품명', '계약형태', '다수공급자', '우수제품', '금액', '최대납기']].concat(list.map((d) => [ymdDash(d.dlvrReqRcptDate), d.dlvrReqNo, d.dlvrReqChgOrd, d.dlvrReqNm, d.dminsttNm, d.corpNm, d.corpBizno, d.corpEntrprsDivNmNm, d.rprsntPrdctClsfcNoNm, d.rprsntDtilPrdctClsfcNoNm, d.cntrctCnclsStleNm, d.masYn, d.exclcProdctYn, num(d.dlvrReqAmt), ymdDash(d.maxDlvrTmlmtDate)]))));
    if (GD.dOpen) loadDlvrDtl(GD.dOpen);
  }
  async function loadDlvrDtl(no) {
    const cell = () => $('#dldtl');
    try {
      const r = GD.dDtl[no] || (GD.dDtl[no] = await g2bAll('shop', 'getDlvrReqDtlInfoList', { inqryDiv: 2, dlvrReqNo: no }, { per: 100, max: 500 }));
      const items = r.items;
      if (!cell() || GD.dOpen !== no) return;
      const pick = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return ''; };
      cell().innerHTML = items.length ? `<div class="tablewrap"><table><thead><tr><th>품목</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th><th>납품장소 · 기한</th></tr></thead><tbody>${items.map((x) => `<tr><td>${esc(pick(x, 'prdctIdntNoNm', 'dtilPrdctClsfcNoNm', 'prdctClsfcNoNm'))}<div class="small muted">${esc(pick(x, 'prdctIdntNo'))}</div></td><td class="num">${esc(pick(x, 'prdctQty', 'dlvrReqQty'))}${esc(pick(x, 'prdctUnit'))}</td><td class="num">${won(pick(x, 'prdctUprc', 'cntrctUprc'))}</td><td class="num">${won(pick(x, 'prdctAmt', 'dlvrReqAmt'))}</td><td class="small">${esc([pick(x, 'dlvrPlceNm'), ymdDash(pick(x, 'dlvrTmlmtDate'))].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">품목 상세가 없습니다.</p>';
    } catch (e) { GD.dDtl[no] = null; if (cell()) cell().innerHTML = errBox(e.message); }
  }

  // ---------- 물품분류 · 규격 찾기 ----------
  function renderCls(pane, params) {
    if (params.q && params.q !== GD.cQ) { GD.cQ = params.q; GD.cItems = null; GD.cSel = ''; }
    pane.innerHTML = `
      <section class="card">
        <form class="form" id="clform">
          <label class="grow">품명 또는 물품분류번호(8자리) · 세부품명번호(10자리)<input type="search" name="q" value="${esc(GD.cQ)}" placeholder="예: 책상, 태양광발전장치, 56101703" required></label>
          <button class="btn primary" type="submit">분류 찾기</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">조달청 물품목록에서 품명 · 세부품명을 찾고, 품목(물품식별번호)별 제조업체 · 속성을 확인합니다. 규격서 작성이나 품명 확인에 참고하세요.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <section class="card" id="clres" style="flex:1 1 360px;min-width:0"></section>
        <section class="card" id="clprd" style="flex:1.4 1 420px;min-width:0"></section>
      </div>`;
    $('#clform').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (!q) return;
      GD.cQ = q; GD.cItems = null; GD.cSel = ''; GD.cPrd = null;
      replaceHash('goods', '', { tab: 'cls', q });
      searchCls();
    });
    if (GD.cQ && !GD.cItems && !GD.cErr) searchCls(); else { drawCls(); drawClsPrd(); }
  }
  async function searchCls() {
    const box = $('#clres');
    box.innerHTML = loading('품명을 찾는 중…'); $('#clprd').innerHTML = '';
    const my = ++GD.cSeq;
    const q = GD.cQ.replace(/\s/g, '');
    const p = /^\d{10}$/.test(q) ? { dtilPrdctClsfcNo: q } : /^\d{8}$/.test(q) ? { prdctClsfcNo: q } : { prdctClsfcNoNm: GD.cQ };
    try {
      const r = await g2bAll('thng', 'getThngPrdnmLocplcAccotListInfoInfoPrdnmSearch02', p, { per: 100, max: 300 });
      if (my !== GD.cSeq) return;
      // 검색어와 똑같은 품명 · 세부품명을 맨 위로
      const qq = GD.cQ.trim(), rank = (c) => (c.dtilPrdctClsfcNoNm === qq ? 0 : c.prdctClsfcNoNm === qq ? 1 : String(c.dtilPrdctClsfcNoNm || '').startsWith(qq) ? 2 : String(c.prdctClsfcNoNm || '').includes(qq) ? 3 : 4);
      GD.cItems = r.items.slice().sort((x, y) => rank(x) - rank(y)); GD.cErr = null;
      if (!GD.cSel && GD.cItems[0]) GD.cSel = GD.cItems[0].dtilPrdctClsfcNo || GD.cItems[0].prdctClsfcNo;
    } catch (e) { if (my === GD.cSeq) { GD.cErr = e.message; GD.cItems = null; } }
    if (my === GD.cSeq) { drawCls(); if (GD.cSel) loadClsPrd(); else drawClsPrd(); }
  }
  function drawCls() {
    const box = $('#clres');
    if (!box) return;
    if (GD.cErr) { box.innerHTML = `<h2>품명 · 세부품명</h2>${errBox(GD.cErr)}`; return; }
    if (!GD.cItems) { box.innerHTML = `<h2>품명 · 세부품명</h2>${empty('품명이나 분류번호를 입력하세요.')}`; return; }
    box.innerHTML = `<h2>품명 · 세부품명 <span class="small muted">${GD.cItems.length}건</span></h2>
      ${GD.cItems.length ? `<div class="tablewrap"><table><thead><tr><th class="nw">물품분류번호</th><th>품명 · 세부품명</th><th class="nw">세부품명번호</th></tr></thead><tbody>
        ${GD.cItems.slice(0, 200).map((c, i) => { const k = c.dtilPrdctClsfcNo || c.prdctClsfcNo; return `<tr${GD.cSel === k ? ' class="hl"' : ''}><td class="nw">${esc(c.prdctClsfcNo)}</td><td><button type="button" class="linkbtn" data-cl="${i}">${esc(c.dtilPrdctClsfcNoNm || c.prdctClsfcNoNm)}</button><div class="small muted">${esc(c.prdctClsfcNoNm)}${c.prdctClsfcNoEngNm ? ' · ' + esc(c.prdctClsfcNoEngNm) : ''}</div></td><td class="nw">${esc(c.dtilPrdctClsfcNo || '')}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty('일치하는 품명이 없습니다.')}`;
    $$('button[data-cl]', box).forEach((b) => b.addEventListener('click', () => { const c = GD.cItems[Number(b.dataset.cl)]; GD.cSel = c.dtilPrdctClsfcNo || c.prdctClsfcNo; GD.cPrd = null; drawCls(); loadClsPrd(); }));
  }
  async function loadClsPrd() {
    const sel = GD.cSel;
    $('#clprd').innerHTML = loading('품목을 불러오는 중…');
    const c = (GD.cItems || []).find((x) => (x.dtilPrdctClsfcNo || x.prdctClsfcNo) === sel) || {};
    try {
      const p = /^\d{10}$/.test(sel) ? { dtilPrdctClsfcNo: sel } : { prdctClsfcNoNm: c.prdctClsfcNoNm || GD.cQ };
      const [a, b] = await Promise.allSettled([
        g2bAll('thng', 'getThngPrdnmLocplcAccotListInfoInfoLocplcSearch02', p, { per: 100, max: 300 }),
        g2bAll('thng', 'getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02', p, { per: 100, max: 300 }),
      ]);
      if (GD.cSel !== sel) return;
      const loc = a.status === 'fulfilled' ? a.value.items : [];
      const prd = b.status === 'fulfilled' ? b.value.items : [];
      // 품목 목록에 소재지(제조업체 · 지역)를 합침
      const byId = new Map(loc.map((x) => [x.prdctIdntNo, x]));
      const merged = (prd.length ? prd : loc).map((x) => Object.assign({}, x, byId.get(x.prdctIdntNo) || {}, { prdctImgLrge: x.prdctImgLrge }));
      GD.cPrd = merged; GD.cPrdErr = merged.length ? null : (a.status === 'rejected' ? a.reason.message : b.status === 'rejected' ? b.reason.message : null);
    } catch (e) { GD.cPrd = []; GD.cPrdErr = e.message; }
    drawClsPrd();
  }
  function drawClsPrd() {
    const box = $('#clprd');
    if (!box) return;
    if (!GD.cSel) { box.innerHTML = '<h2>품목 · 속성</h2><p class="small muted">왼쪽에서 품명을 고르면 품목(물품식별번호)과 속성이 표시됩니다.</p>'; return; }
    if (!GD.cPrd) { box.innerHTML = loading('품목을 불러오는 중…'); return; }
    const list = GD.cPrd.filter((x) => !GD.cCn || isCN(x.rgnNm));
    box.innerHTML = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;align-items:baseline"><h2 style="margin:0">품목 · 속성 <span class="small muted">${esc(GD.cSel)} · ${list.length}건</span></h2>
        <label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="clcn" ${GD.cCn ? 'checked' : ''}>충남 제조업체만</label></div>
      <div class="btns" style="margin:10px 0"><a class="btn sm" href="${esc(hashOf('goods', '', { q: ((GD.cItems || []).find((x) => (x.dtilPrdctClsfcNo || x.prdctClsfcNo) === GD.cSel) || {}).prdctClsfcNoNm || GD.cQ }))}">이 품명으로 나라장터 쇼핑몰 상품 찾기</a></div>
      ${GD.cPrdErr ? errBox(GD.cPrdErr) : ''}
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th class="nw">물품식별번호</th><th>품목명</th><th>제조업체 · 지역</th><th></th></tr></thead><tbody>
        ${list.slice(0, 100).map((x, i) => `<tr><td class="nw">${esc(x.prdctIdntNo)}</td><td>${esc(x.krnPrdctNm || '')}${x.useYn === 'N' ? ' <span class="badge">미사용</span>' : ''}</td><td>${esc(x.mnfctCorpNm || '-')} ${rgnBadge(x.rgnNm)}</td><td class="nw"><button type="button" class="linkbtn small" data-at="${i}">속성</button></td></tr><tr hidden id="clat-${i}"><td colspan="4" style="background:var(--soft)"></td></tr>`).join('')}
      </tbody></table></div>${list.length > 100 ? '<p class="small muted">100건만 표시</p>' : ''}` : (GD.cPrdErr ? '' : empty('품목이 없습니다.'))}`;
    $('#clcn').addEventListener('change', (e) => { GD.cCn = e.target.checked; drawClsPrd(); });
    $$('button[data-at]', box).forEach((b) => b.addEventListener('click', () => {
      const tr = $('#clat-' + b.dataset.at);
      tr.hidden = !tr.hidden;
      if (!tr.hidden) loadAttrs(list[Number(b.dataset.at)].prdctIdntNo, tr.firstElementChild);
    }));
  }

  // =====================================================================
  // 7. 내 보관함
  // =====================================================================
  let savedTab = '전체';
  function renderSaved(view) {
    const all = getSaved();
    const list = all.filter((s) => savedTab === '전체' || s.kind === savedTab);
    view.innerHTML = `
      <section class="card">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-bottom:4px">
          <div class="tabs" role="tablist" aria-label="보관함 구분" style="margin:0">
            ${['전체', '계약', '공고', '업체', '물품', '법령해석', '업종'].map((t) => `<button type="button" class="tab" role="tab" data-t="${t}" aria-selected="${t === savedTab}">${t}</button>`).join('')}
          </div>
          <button type="button" class="btn" id="svcsv" ${list.length ? '' : 'disabled'}>CSV 내보내기</button>
        </div>
        <p class="small muted" style="margin:6px 0 12px">보관함은 이 브라우저에만 저장됩니다. 다른 PC에서는 보이지 않습니다.</p>
        ${list.length ? `<div class="tablewrap"><table>
          <thead><tr><th>구분</th><th>항목</th><th>메모</th><th>저장일</th><th></th></tr></thead>
          <tbody>${list.map((s) => { const idx = all.indexOf(s); return `<tr>
            <td class="nw"><span class="badge">${esc(s.kind)}</span></td>
            <td>${s.link ? `<a href="${esc(s.link)}" ${s.link.startsWith('#') ? '' : 'target="_blank" rel="noopener"'}>${esc(s.name)}</a>` : esc(s.name)}</td>
            <td><label class="sr" for="memo-${idx}">메모</label><input class="memo" id="memo-${idx}" data-idx="${idx}" value="${esc(s.memo)}" placeholder="메모 입력"></td>
            <td class="nw">${esc(s.date)}</td>
            <td class="nw"><button type="button" class="btn sm" data-del="${idx}">삭제</button></td></tr>`; }).join('')}</tbody>
        </table></div>` : empty('저장한 항목이 없습니다. 각 화면의 \'보관함에 저장\' 버튼으로 추가하세요.')}
      </section>`;
    $$('.tab', view).forEach((b) => b.addEventListener('click', () => { savedTab = b.dataset.t; renderSaved(view); }));
    $$('.memo', view).forEach((inp) => inp.addEventListener('change', () => { const a = getSaved(); if (a[inp.dataset.idx]) { a[inp.dataset.idx].memo = inp.value; store.set('cne.saved', a); toast('메모를 저장했습니다.'); } }));
    $$('button[data-del]', view).forEach((b) => b.addEventListener('click', () => { const a = getSaved(); a.splice(Number(b.dataset.del), 1); store.set('cne.saved', a); renderSaved(view); }));
    const csv = $('#svcsv');
    if (csv) csv.addEventListener('click', () => downloadCsv(`보관함_${iso(today())}.csv`, [['구분', '항목', '메모', '저장일', '링크']].concat(list.map((s) => [s.kind, s.name, s.memo, s.date, s.link ? new URL(s.link, location.href).href : '']))));
  }

  function downloadCsv(filename, rows) {
    const text = rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // =====================================================================
  // 7. 설정
  // =====================================================================
  function renderSettings(view, arg) {
    const admin = arg === 'check'; // 관리자 점검용: 주소 끝에 #settings/check 를 붙이면 연결 상태가 보임
    view.innerHTML = `
      <div class="row">
        <section class="card">
          <h2>우리 기관</h2>
          <form id="setform" style="display:flex;flex-direction:column;gap:14px" class="form">
            <label style="width:100%">기관명 (나라장터에 등록된 이름의 일부)<input type="text" name="insttNm" value="${esc(settings.insttNm)}" required></label>
            <label style="width:100%">기관 기준<select name="insttDivCd">
              <option value="1" ${settings.insttDivCd === '1' ? 'selected' : ''}>계약기관 · 공고기관 기준 (교육청이 직접 계약·공고한 건)</option>
              <option value="2" ${settings.insttDivCd === '2' ? 'selected' : ''}>수요기관 기준 (교육청 소속 기관이 요청한 건 포함)</option>
            </select></label>
            <fieldset style="border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:0;align-self:stretch">
              <legend class="small" style="color:var(--sub);padding:0 4px">주로 보는 업무 (최근 계약 · 공고 현황에 사용)</legend>
              <div style="display:flex;flex-wrap:wrap;gap:14px">${Object.keys(BIZ).map((b) => `<label style="flex-direction:row;align-items:center;gap:6px;font-size:14px;color:var(--ink);min-height:32px"><input type="checkbox" name="bizs" value="${b}" ${settings.bizs.includes(b) ? 'checked' : ''}>${b}</label>`).join('')}</div>
            </fieldset>
            <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" id="setreset">기본값으로</button></div>
          </form>
        </section>
        ${admin ? `<section class="card">
          <h2>데이터 연결 상태</h2>
          <div id="health">${loading()}</div>
          <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="htest">실제 조회로 연결 테스트</button></div>
          <div id="htestres" style="margin-top:10px"></div>
          <p class="small muted" style="margin:12px 0 0">인증키는 이 화면이나 브라우저에 저장되지 않고, Cloudflare 환경변수에만 있습니다.</p>
        </section>` : ''}
      </div>`;
    const resetData = () => { C.data = null; C.recent = null; N.items = null; };
    $('#setform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const bizs = $$('input[name=bizs]:checked', f).map((x) => x.value);
      settings = { insttNm: f.insttNm.value.trim() || DEFAULTS.insttNm, insttDivCd: f.insttDivCd.value, bizs: bizs.length ? bizs : DEFAULTS.bizs.slice() };
      store.set('cne.settings', settings);
      resetData();
      toast('설정을 저장했습니다.');
    });
    $('#setreset').addEventListener('click', () => { settings = Object.assign({}, DEFAULTS, { bizs: DEFAULTS.bizs.slice() }); store.set('cne.settings', settings); resetData(); renderSettings(view, arg); toast('기본값으로 되돌렸습니다.'); });
    if (!admin) return;
    fetch('/api/health').then((r) => r.json()).then((h) => {
      const row = (name, src, ok) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;background:var(--soft);border-radius:8px;margin-bottom:8px"><div><div>${name}</div><div class="small muted">${src}</div></div><span class="badge ${ok ? 'grn' : 'red'}">${ok ? '키 설정됨' : '키 없음'}</span></div>`;
      $('#health').innerHTML = row('나라장터 입찰공고 · 계약 · 사용자정보 · 업종', '공공데이터포털 인증키 (G2B_SERVICE_KEY)', h.g2b) + row('조달청 법령해석 목록 · 본문', '법제처 OC (LAW_OC)', h.law);
    }).catch(() => { $('#health').innerHTML = errBox('상태를 확인하지 못했습니다.'); });
    $('#htest').addEventListener('click', async () => {
      const out = $('#htestres');
      out.innerHTML = loading('각 API를 1건씩 조회하는 중…');
      const d = ymd(iso(addDays(today(), -1)));
      const tests = [
        ['입찰공고정보서비스', () => g2b('bid', 'getBidPblancListInfoServcPPSSrch', { inqryDiv: 1, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['계약정보서비스', () => g2b('cntrct', 'getCntrctInfoListServcPPSSrch', { inqryDiv: 1, inqryBgnDate: d, inqryEndDate: d, numOfRows: 1 })],
        ['사용자정보서비스', () => g2b('usr', 'getDminsttInfo02', { inqryDiv: 1, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['업종 및 근거법규서비스', () => g2b('ind', 'getIndstrytyBaseLawrgltInfoList', { numOfRows: 1 })],
        ['사전규격정보서비스', () => g2b('pre', 'getPublicPrcureThngInfoServcPPSSrch', { inqryDiv: 1, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['계약과정통합공개서비스', () => g2b('intg', 'getCntrctProcssIntgOpenServc', { inqryDiv: 1, bidNtceNo: 'R25BK00947937', numOfRows: 1 })],
        ['낙찰정보서비스', () => g2b('scsbid', 'getScsbidListSttusServc', { inqryDiv: 2, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['법제처 법령해석', () => lawApi('list', { query: '계약', display: 1 })],
      ];
      const res = await Promise.allSettled(tests.map((t) => t[1]()));
      out.innerHTML = res.map((r, i) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)"><span>${tests[i][0]}</span>${r.status === 'fulfilled' ? '<span class="badge grn">정상</span>' : `<span class="badge red" title="${esc(r.reason.message)}">실패</span>`}</div>${r.status === 'rejected' ? `<div class="small" style="color:var(--red);padding:4px 0 8px">${esc(r.reason.message)}</div>` : ''}`).join('');
    });
  }

  // =====================================================================
  // 라우팅
  // =====================================================================
  const ROUTES = [
    { id: 'contract', label: '계약 관리', sub: '계약 목록 · 변경이력 · 공고→계약 추적', render: renderContract, update: updateContract },
    { id: 'corp', label: '업체 확인', sub: '업체 정보 · 업종 · 공급물품 · 부정당제재 확인', render: renderCorp },
    { id: 'similar', label: '유사사업 찾기', sub: '다른 기관의 비슷한 사업 · 문서 · 금액 참고', render: renderSimilar },
    { id: 'notice', label: '공고 준비 · 확인', sub: '우리 기관 공고 · 입찰조건 · 정정이력', render: renderNotice, update: updateNotice },
    { id: 'law', label: '법령 · 해석 찾기', sub: '조달청 법령해석 · 업종별 근거법규', render: renderLaw, update: updateLaw },
    { id: 'goods', label: '물품 · 나라장터 쇼핑몰', sub: '나라장터 쇼핑몰 상품 · 납품요구 실적 · 물품분류 · 규격', render: renderGoods },
    { id: 'saved', label: '내 보관함', sub: '저장한 계약 · 공고 · 업체 · 해석 · 업종과 메모', render: renderSaved },
    { id: 'settings', label: '설정', sub: '우리 기관 · 주요 업무', render: renderSettings },
  ];

  function route() {
    const { id, arg, params } = parseHash();
    const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
    const view = $('#view');
    // 같은 메뉴·같은 검색어 안에서 상세만 바뀐 경우 → 화면을 다시 그리지 않고 상세만 갱신
    const sameScreen = current.id === r.id && current.arg === arg && r.update;
    current = { id: r.id, arg, hash: location.hash };
    if (id === r.id) rememberHash(r.id, location.hash);
    if (!(sameScreen && r.update(params))) {
      $('#nav').innerHTML = ROUTES.map((x) => `<a href="#${x.id}" ${x.id === r.id ? 'aria-current="page"' : ''}><span class="dot" aria-hidden="true"></span><span>${x.label}</span></a>`).join('');
      $('#ptitle').textContent = r.label;
      $('#psub').textContent = r.sub;
      document.title = `${r.label} · 충청남도교육청 계약 업무 도우미`;
      r.render(view, arg, params);
      const pos = savedScroll();
      if (pos != null) requestAnimationFrame(() => window.scrollTo(0, pos)); else window.scrollTo(0, 0);
    } else {
      const pos = savedScroll();
      if (pos != null) requestAnimationFrame(() => window.scrollTo(0, pos));
    }
  }

  function globalSearch() {
    const q = $('#gq').value.trim();
    if (!q) return;
    const digits = q.replace(/[-\s]/g, '');
    $('#gq').value = '';
    $('#gq').blur();
    if (/^\d{10}$/.test(digits)) go('corp', digits); else go('similar', q);
  }
  // 휴대폰에서 표를 카드처럼 보이게: 각 칸에 머리글 이름(data-label)을 붙여 둠 (CSS가 좁은 화면에서만 사용)
  function labelTables(root) {
    $$('table', root).forEach((t) => {
      if (t.dataset.lab === '1') return;
      const hr = t.tHead && t.tHead.rows[0];
      if (!hr) return;
      const heads = Array.from(hr.cells).map((c) => c.textContent.trim());
      if (heads.length < 2 || heads.length > 9) return;
      Array.from(t.tBodies).forEach((tb) => Array.from(tb.rows).forEach((tr) => {
        if (tr.cells.length === 1 && tr.cells[0].colSpan > 1) { tr.classList.add('fullrow'); return; }
        Array.from(tr.cells).forEach((td, i) => { if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]); });
      }));
      t.dataset.lab = '1';
      t.classList.add('cardify');
    });
  }
  let labTimer = 0;
  new MutationObserver(() => { clearTimeout(labTimer); labTimer = setTimeout(() => labelTables($('#view')), 30); }).observe($('#view'), { childList: true, subtree: true });

  // 왼쪽 위 사이트 이름: 입력·검색 내용과 메뉴별 마지막 화면 기억을 지우고 첫 화면으로 새로고침
  // (설정의 기관 정보와 내 보관함은 그대로 둠)
  const brand = $('.brand');
  if (brand) brand.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    try { sessionStorage.clear(); } catch (err) { /* 무시 */ }
    try { Object.keys(localStorage).filter((k) => k.startsWith('cne.snap.')).forEach((k) => localStorage.removeItem(k)); } catch (err) { /* 무시 */ }
    location.replace(location.pathname);
  });
  // 왼쪽 메뉴를 누르면 그 메뉴에서 마지막으로 보던 화면으로 이동 (지금 메뉴를 다시 누르면 첫 화면)
  $('#nav').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const id = a.getAttribute('href').slice(1);
    const h = lastHash[id];
    if (id !== current.id && h && h !== '#' + id) { e.preventDefault(); location.hash = h; }
  });
  $('#gsearch').addEventListener('submit', (e) => { e.preventDefault(); globalSearch(); });
  // 모바일 한글 입력 중 엔터가 submit으로 이어지지 않는 브라우저 대비
  $('#gq').addEventListener('keyup', (e) => { if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) { e.preventDefault(); globalSearch(); } });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#contract');
  route();
})();

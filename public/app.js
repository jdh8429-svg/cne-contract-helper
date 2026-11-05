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

  // 조회기간을 1개월(달력 기준) 단위로 나눔 (나라장터 일부 API 제한: 최대 1개월)
  function monthChunks(fromIso, toIso) {
    const out = [];
    let s = new Date(fromIso + 'T00:00:00');
    const end = new Date(toIso + 'T00:00:00');
    while (s <= end) {
      let e = addDays(addMonths(s, 1), -1);
      if (e > end) e = end;
      out.push({ bgn: ymd(iso(s)) + '0000', end: ymd(iso(e)) + '2359' });
      s = addDays(e, 1);
    }
    return out;
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
        if (e.code === '07' && page === 1 && si < sizes.length - 1) { si++; page = 0; continue; }
        throw e;
      }
      total = r.totalCount || total;
      stale = stale || !!r._stale;
      items.push(...r.items);
      if (!r.items.length || items.length >= total || items.length >= max) break;
    }
    return { items: items.slice(0, max), totalCount: total, truncated: total > max, stale };
  }
  // 기간을 1개월씩 나눠 조회. 혹시 1개월도 넘는다고 거절되면 그 구간만 반으로 나눠 다시 조회.
  async function g2bByMonth(svc, op, params, fromIso, toIso, opts) {
    const run = async (bgn, end) => {
      try {
        return (await g2bAll(svc, op, Object.assign({}, params, { inqryBgnDt: bgn, inqryEndDt: end }), opts)).items;
      } catch (e) {
        const a = new Date(`${bgn.slice(0, 4)}-${bgn.slice(4, 6)}-${bgn.slice(6, 8)}T00:00:00`);
        const b = new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00`);
        if (e.code !== '07' || b - a < 2 * 864e5) throw e;
        const mid = addDays(a, Math.floor((b - a) / 864e5 / 2));
        const [x, y] = await Promise.all([run(bgn, ymd(iso(mid)) + '2359'), run(ymd(iso(addDays(mid, 1))) + '0000', end)]);
        return x.concat(y);
      }
    };
    const res = await Promise.allSettled(monthChunks(fromIso, toIso).map((ch) => run(ch.bgn, ch.end)));
    const items = [];
    const errs = [];
    res.forEach((r) => (r.status === 'fulfilled' ? items.push(...r.value) : errs.push(r.reason.message)));
    if (!items.length && errs.length) throw new Error(errs[0]);
    return items;
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
          <label>계약일 시작<input type="date" name="from" value="${esc(C.from)}" required></label>
          <label>계약일 끝<input type="date" name="to" value="${esc(C.to)}" required></label>
          <label>계약방법<select name="mthd">
            ${[['', '전체'], ['1', '일반경쟁'], ['2', '제한경쟁'], ['3', '지명경쟁'], ['4', '수의계약']].map(([v, t]) => `<option value="${v}" ${C.mthd === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
          <label class="grow">계약명<input type="text" name="q" value="${esc(C.q)}" placeholder="계약명 일부 입력 (비우면 전체)"></label>
          <button class="btn primary" type="submit">조회</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">${esc(settings.insttDivCd === '2' ? '수요기관' : '계약기관')}: ${esc(settings.insttNm)} · 기관은 설정에서 바꿀 수 있습니다.</p>
        <div id="clist" style="margin-top:12px"></div>
      </section>
      <section class="card" id="cdetail" hidden></section>
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
          <h2>우리 기관 최근 계약</h2>
          <button type="button" class="btn sm" id="crefresh">새로 불러오기</button>
        </div>
        <div id="crecent"></div>
      </section>`;
    $$('.tab', view).forEach((b) => b.addEventListener('click', () => go('contract', '', { biz: b.dataset.biz })));
    $('#cform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
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
      else { C.data = null; C.snapAt = null; box.innerHTML = loading('나라장터에서 계약 목록을 받는 중… (나라장터 응답이 느려 처음엔 10~20초 걸릴 수 있습니다)'); }
    }
    try {
      const r = await g2bAll('cntrct', `getCntrctInfoList${BIZ[C.biz]}PPSSrch`, {
        inqryDiv: 1, inqryBgnDate: ymd(C.from), inqryEndDate: ymd(C.to),
        insttDivCd: settings.insttDivCd, insttNm: settings.insttNm, cntrctMthdCd: C.mthd,
        // 공사는 검색 항목 이름이 '공사명(cnstwkNm)'
        [C.biz === '공사' ? 'cnstwkNm' : 'cntrctNm']: C.q,
      });
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
      <div class="small muted" style="margin-bottom:6px">총 ${C.data.totalCount.toLocaleString()}건 · 계약일 최근순${C.data.truncated ? ` (최근 ${all.length.toLocaleString()}건까지 표시 — 기간을 줄이면 전체를 볼 수 있습니다)` : ''}${C.snapAt ? ` · <span class="badge org">${esc(agoText(C.snapAt))} 저장된 목록 · ${C.snapErr ? '최신 정보를 받지 못했습니다' : '최신 정보 확인 중…'}</span>` : ''}</div>
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

  async function loadRecent(opts) {
    const silent = opts && opts.silent;
    const box = $('#crecent');
    if (!box) return;
    const bizs = (settings.bizs && settings.bizs.length ? settings.bizs : DEFAULTS.bizs).slice(0, 4);
    const from = monthsAgo(1), to = iso(today());
    const key = ['recent', bizs.join(','), from, to, settings.insttDivCd, settings.insttNm].join('|');
    const my = ++C.rseq;
    if (!silent) {
      C.recentErr = null;
      const s = snap.get(key);
      if (s) { C.recent = s.items; C.recentAt = s.t; drawRecent(); } else { C.recentAt = null; box.innerHTML = loading(); }
    }
    const res = await Promise.allSettled(bizs.map((b) => g2bAll('cntrct', `getCntrctInfoList${BIZ[b]}PPSSrch`, {
      inqryDiv: 1, inqryBgnDate: ymd(from), inqryEndDate: ymd(to), insttDivCd: settings.insttDivCd, insttNm: settings.insttNm,
    }).then((r) => ({ stale: r.stale, items: r.items.map((x) => Object.assign({ _biz: b }, x)) }))));
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
    if (!C.recent.length) { box.innerHTML = empty('최근 1개월 계약이 없습니다.'); return; }
    box.innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>업무</th><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약일</th><th>바로가기</th></tr></thead>
      <tbody>${C.recent.map((c) => { const p = parseCorpList(c.corpList)[0]; return `<tr><td class="nw">${esc(c._biz)}</td><td>${esc(c.cntrctNm)}</td><td><span class="corpname" style="display:inline-block">${esc(p ? p.name : '-')}</span></td><td class="num">${won(c.totCntrctAmt || c.thtmCntrctAmt)}</td><td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td class="nw">${ext(c.cntrctDtlInfoUrl || c.cntrctInfoUrl)}</td></tr>`; }).join('')}</tbody>
    </table></div><p class="small muted" style="margin:8px 0 0">최근 1개월 · ${esc(settings.bizs.join(', '))} 업무 기준${C.recentAt ? ` · ${esc(agoText(C.recentAt))} 저장된 목록 (최신 정보 확인 중…)` : ''}</p>`;
  }

  // =====================================================================
  // 2. 업체 확인
  // =====================================================================
  const K = { bizno: '', data: null, err: null, seq: 0 };

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
      <div id="kresult" style="display:flex;flex-direction:column;gap:16px"></div>`;
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
  const S = { q: '', ind: '', biz: '용역', months: '3', doc: '전체', items: null, err: null, seq: 0, key: '' };

  function renderSimilar(view, arg, params) {
    const ind = params.ind || '';
    const key = arg + '|' + ind;
    if (key !== S.key) { S.q = arg; S.ind = ind; S.key = key; S.items = null; S.err = null; }
    const indIt = S.ind ? indByCode(S.ind) : null;
    view.innerHTML = `
      <section class="card">
        <form class="form" id="sform">
          <label class="grow">사업명 키워드<input type="search" name="q" value="${esc(S.q)}" placeholder="예: 통합유지관리, 급식, 방수공사" ${S.ind ? '' : 'required'}></label>
          <label>업무<select name="biz">${Object.keys(BIZ).map((b) => `<option ${b === S.biz ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>기간<select name="months">${[['1', '최근 1개월'], ['3', '최근 3개월'], ['6', '최근 6개월'], ['12', '최근 1년']].map(([v, t]) => `<option value="${v}" ${S.months === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>문서 종류<select name="doc">${['전체', '제안요청서', '과업지시서', '규격서', '내역서'].map((v) => `<option ${S.doc === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit">유사사업 검색</button>
        </form>
        ${S.ind ? `<p class="small" style="margin:10px 0 0">업종 조건: <span class="badge blue">${esc(S.ind)} ${esc(indIt ? indIt.nm : '')}</span> <a href="${esc(hashOf('similar', S.q))}">업종 조건 빼기</a></p>` : ''}
        <p class="small muted" style="margin:10px 0 0">전국 모든 기관의 입찰공고에서 찾습니다. 기간이 길수록 조회가 오래 걸립니다.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <div id="slist" style="flex:3 1 480px;min-width:0;display:flex;flex-direction:column;gap:12px"></div>
        <aside class="card" id="ssum" style="flex:1 1 240px"></aside>
      </div>`;
    const f = $('#sform');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = f.q.value.trim();
      S.biz = f.biz.value; S.months = f.months.value; S.doc = f.doc.value;
      if (!q && !S.ind) return;
      if (q !== S.q) { S.q = q; S.key = q + '|' + S.ind; S.items = null; go('similar', q, { ind: S.ind }); } else searchSimilar();
    });
    f.doc.addEventListener('change', (e) => { S.doc = e.target.value; drawSimilar(); });
    if ((S.q || S.ind) && !S.items && !S.err) searchSimilar(); else drawSimilar();
  }

  async function searchSimilar() {
    $('#slist').innerHTML = loading('유사사업을 찾는 중…');
    $('#ssum').innerHTML = '';
    S.err = null;
    const my = ++S.seq;
    let found = [];
    try {
      // 공고명으로 서버에서 걸러 받으므로 결과가 적음 → 1개월당 보통 1번 호출
      found = await g2bByMonth('bid', `getBidPblancListInfo${BIZ[S.biz]}PPSSrch`, { inqryDiv: 1, bidNtceNm: S.q, indstrytyCd: S.ind }, monthsAgo(Number(S.months)), iso(today()), { max: 500 });
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

  function drawSimilar() {
    const list = $('#slist'), sum = $('#ssum');
    if (!list) return;
    if (S.err) { list.innerHTML = errBox(S.err); sum.innerHTML = ''; return; }
    if (!S.items) { list.innerHTML = `<div class="card">${empty('사업명 키워드를 입력하고 검색하세요.')}</div>`; sum.innerHTML = '<h2>금액 참고</h2><p class="small muted">검색하면 추정가격 통계가 표시됩니다.</p>'; return; }
    const shown = S.items.filter((n) => S.doc === '전체' || noticeDocs(n).some((d) => d.kind === S.doc));
    if (!shown.length) list.innerHTML = `<div class="card">${empty(S.doc === '전체' ? '검색 결과가 없습니다.' : `'${S.doc}'가 첨부된 공고가 없습니다.`)}</div>`;
    else list.innerHTML = shown.slice(0, 60).map((n, i) => `
      <article class="result">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px">
          <h3>${esc(n.bidNtceNm)}</h3>${ext(n.bidNtceDtlUrl || n.bidNtceUrl, '나라장터 공고')}
        </div>
        <div class="meta">${esc(n.dminsttNm || n.ntceInsttNm)} · 공고 ${esc(dateOnly(n.bidNtceDt))} · ${esc(n.cntrctCnclsMthdNm || '')} · ${esc(n.bidNtceNo)}</div>
        <div class="amts"><span>추정가격 <strong>${won(n.presmptPrce)}</strong></span><span>배정예산 <strong>${won(n.asignBdgtAmt)}</strong></span>${n.sucsfbidLwltRate ? `<span>낙찰하한율 <strong>${esc(n.sucsfbidLwltRate)}%</strong></span>` : ''}</div>
        ${docChips(noticeDocs(n))}
        <div class="btns" style="margin-top:12px">
          <button type="button" class="btn sm" data-act="eorder" data-i="${i}">e발주 문서(제안요청서 등)</button>
          <button type="button" class="btn sm" data-act="cntrct" data-i="${i}">계약 결과 보기</button>
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
    }));
    const amts = shown.map((n) => num(n.presmptPrce)).filter((v) => v > 0);
    const avg = amts.length ? Math.round(amts.reduce((a, b) => a + b, 0) / amts.length) : 0;
    sum.innerHTML = `<h2>금액 참고</h2>
      <p class="small muted" style="margin:0 0 12px">검색된 공고 ${shown.length}건 중 추정가격이 있는 ${amts.length}건 기준 (부가세 제외 금액)</p>
      <dl class="kv" style="grid-template-columns:1fr auto">
        <dt>추정가격 최소</dt><dd><strong>${won(amts.length ? Math.min(...amts) : 0)}</strong></dd>
        <dt>추정가격 평균</dt><dd><strong>${won(avg)}</strong></dd>
        <dt>추정가격 최대</dt><dd><strong>${won(amts.length ? Math.max(...amts) : 0)}</strong></dd>
      </dl>
      <button type="button" class="btn" id="scsv" style="width:100%;margin-top:16px;justify-content:center">검색 결과 CSV 내보내기</button>`;
    $('#scsv').addEventListener('click', () => downloadCsv(`유사사업_${S.q || S.ind}_${iso(today())}.csv`,
      [['공고명', '기관', '공고일', '계약방법', '추정가격', '배정예산', '공고번호', '나라장터']].concat(shown.map((n) => [n.bidNtceNm, n.dminsttNm || n.ntceInsttNm, dateOnly(n.bidNtceDt), n.cntrctCnclsMthdNm, num(n.presmptPrce), num(n.asignBdgtAmt), n.bidNtceNo, n.bidNtceDtlUrl || '']))));
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
          <label>공고일 시작<input type="date" name="from" value="${esc(N.from)}" required></label>
          <label>공고일 끝<input type="date" name="to" value="${esc(N.to)}" required></label>
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
      g2bByMonth('bid', `getBidPblancListInfo${BIZ[b]}PPSSrch`, { inqryDiv: 1, [instKey]: settings.insttNm, bidNtceNm: N.q }, N.from, N.to, { max: 1000 })
        .then((items) => items.map((x) => Object.assign({ _biz: b }, x)))));
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
  // 6. 내 보관함
  // =====================================================================
  let savedTab = '전체';
  function renderSaved(view) {
    const all = getSaved();
    const list = all.filter((s) => savedTab === '전체' || s.kind === savedTab);
    view.innerHTML = `
      <section class="card">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-bottom:4px">
          <div class="tabs" role="tablist" aria-label="보관함 구분" style="margin:0">
            ${['전체', '계약', '공고', '업체', '법령해석', '업종'].map((t) => `<button type="button" class="tab" role="tab" data-t="${t}" aria-selected="${t === savedTab}">${t}</button>`).join('')}
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
  $('#gsearch').addEventListener('submit', (e) => { e.preventDefault(); globalSearch(); });
  // 모바일 한글 입력 중 엔터가 submit으로 이어지지 않는 브라우저 대비
  $('#gq').addEventListener('keyup', (e) => { if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) { e.preventDefault(); globalSearch(); } });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);
  if (!location.hash) history.replaceState(null, '', '#contract');
  route();
})();

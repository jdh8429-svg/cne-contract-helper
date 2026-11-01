'use strict';
/* 충청남도교육청 계약 업무 도우미 - 화면 스크립트
 * 모든 외부 API 호출은 /api/g2b, /api/law (Cloudflare Pages Functions) 를 거칩니다.
 * 인증키는 서버 환경변수에만 있고 이 파일에는 없습니다. */
(function () {
  // ---------- 공통 도구 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
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

  // 조회기간을 최대 1개월 단위로 나눔 (나라장터 일부 API 제한)
  function monthChunks(fromIso, toIso) {
    const out = [];
    let s = new Date(fromIso + 'T00:00:00');
    const end = new Date(toIso + 'T00:00:00');
    while (s <= end) {
      let e = addDays(s, 29);
      if (e > end) e = end;
      out.push({ bgn: ymd(iso(s)) + '0000', end: ymd(iso(e)) + '2359' });
      s = addDays(e, 1);
    }
    return out;
  }

  // ---------- API ----------
  async function g2b(svc, op, params) {
    const qs = new URLSearchParams(Object.assign({ svc, op }, clean(params || {})));
    let r;
    try { r = await fetch('/api/g2b?' + qs.toString()); } catch (e) { throw new Error('네트워크 연결을 확인하세요.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다. (' + r.status + ')'); }
    if (!j.ok) {
      if (j.code === '03') return { ok: true, items: [], totalCount: 0 };
      throw new Error(j.msg || '조회 중 오류가 발생했습니다.');
    }
    return j;
  }
  async function lawApi(mode, params) {
    const qs = new URLSearchParams(Object.assign({ mode }, clean(params || {})));
    let r;
    try { r = await fetch('/api/law?' + qs.toString()); } catch (e) { throw new Error('네트워크 연결을 확인하세요.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다. (' + r.status + ')'); }
    if (!j.ok) throw new Error(j.msg || '조회 중 오류가 발생했습니다.');
    return j.data;
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
  const KIND_CLASS = { '제안요청서': 'blue', '과업지시서': 'org', '규격서': '', '내역서': '', '공고문': '', '기타': '', '표준공고서': '', '현장설명서': '' };
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

  // ---------- 보관함 ----------
  const getSaved = () => store.get('cne.saved', []);
  function saveItem(item) {
    const list = getSaved();
    if (list.some((x) => x.kind === item.kind && x.key === item.key)) { toast('이미 보관함에 있습니다.'); return; }
    list.unshift(Object.assign({ memo: '', date: iso(today()) }, item));
    store.set('cne.saved', list.slice(0, 500));
    toast('보관함에 저장했습니다.');
  }

  // ---------- 1. 계약 관리 ----------
  const C = { biz: '용역', from: iso(addDays(today(), -30)), to: iso(today()), mthd: '', q: '', page: 1, data: null, err: null, sel: null, recent: null, recentErr: null };

  function renderContract(view) {
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
    $$('.tab', view).forEach((b) => b.addEventListener('click', () => { C.biz = b.dataset.biz; C.page = 1; C.sel = null; renderContract(view); searchContracts(); }));
    $('#cform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      C.from = f.from.value; C.to = f.to.value; C.mthd = f.mthd.value; C.q = f.q.value.trim(); C.page = 1; C.sel = null;
      searchContracts();
    });
    $('#crefresh').addEventListener('click', () => { C.recent = null; loadRecent(); });
    drawContracts();
    if (C.sel) drawDetail(C.sel);
    if (!C.data && !C.err) searchContracts();
    if (C.recent) drawRecent(); else loadRecent();
  }

  async function searchContracts() {
    const box = $('#clist');
    if (!box) return;
    box.innerHTML = loading();
    C.err = null;
    try {
      C.data = await g2b('cntrct', `getCntrctInfoList${BIZ[C.biz]}PPSSrch`, {
        inqryDiv: 1, inqryBgnDate: ymd(C.from), inqryEndDate: ymd(C.to),
        insttDivCd: settings.insttDivCd, insttNm: settings.insttNm, cntrctNm: C.q, cntrctMthdCd: C.mthd,
        numOfRows: 20, pageNo: C.page,
      });
    } catch (e) { C.data = null; C.err = e.message; }
    drawContracts();
  }

  function drawContracts() {
    const box = $('#clist');
    if (!box) return;
    if (C.err) { box.innerHTML = errBox(C.err); return; }
    if (!C.data) { box.innerHTML = loading(); return; }
    const items = C.data.items;
    if (!items.length) { box.innerHTML = empty('조건에 맞는 계약이 없습니다. 기간이나 기관명을 바꿔 보세요.'); return; }
    const pages = Math.max(1, Math.ceil(C.data.totalCount / 20));
    box.innerHTML = `
      <div class="small muted" style="margin-bottom:6px">총 ${C.data.totalCount.toLocaleString()}건</div>
      <div class="tablewrap"><table>
        <thead><tr><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약일</th><th>계약방법</th><th>바로가기</th></tr></thead>
        <tbody>${items.map((c, i) => {
          const corps = parseCorpList(c.corpList);
          const corp = corps[0] ? corps[0].name + (corps.length > 1 ? ` 외 ${corps.length - 1}` : '') : '-';
          return `<tr class="${C.sel && C.sel.untyCntrctNo === c.untyCntrctNo ? 'sel' : ''}">
            <td><button type="button" class="linkbtn" data-i="${i}">${esc(c.cntrctNm)}</button></td>
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
    $$('button[data-i]', box).forEach((b) => b.addEventListener('click', () => { C.sel = items[Number(b.dataset.i)]; drawContracts(); drawDetail(C.sel); $('#cdetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $('#cprev').addEventListener('click', () => { C.page--; searchContracts(); });
    $('#cnext').addEventListener('click', () => { C.page++; searchContracts(); });
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
    if (!box) return;
    box.hidden = false;
    const corps = parseCorpList(c.corpList);
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
        <a class="btn" href="#law/${encodeURIComponent(lawKeywordFor(c.cntrctCnclsMthdNm))}">'${esc(lawKeywordFor(c.cntrctCnclsMthdNm))}' 관련 법령해석</a>
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
          steps.push({ d: dt(n.bidNtceDt), t: '입찰공고', s: `${n.bidNtceNm || ''}` , link: n.bidNtceDtlUrl || n.bidNtceUrl });
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

  async function loadRecent() {
    const box = $('#crecent');
    if (!box) return;
    box.innerHTML = loading();
    C.recentErr = null;
    const bizs = (settings.bizs && settings.bizs.length ? settings.bizs : ['용역', '물품', '공사']).slice(0, 4);
    const from = iso(addDays(today(), -30)), to = iso(today());
    const res = await Promise.allSettled(bizs.map((b) => g2b('cntrct', `getCntrctInfoList${BIZ[b]}PPSSrch`, {
      inqryDiv: 1, inqryBgnDate: ymd(from), inqryEndDate: ymd(to), insttDivCd: settings.insttDivCd, insttNm: settings.insttNm, numOfRows: 10, pageNo: 1,
    }).then((r) => r.items.map((x) => Object.assign({ _biz: b }, x)))));
    const items = [];
    const errs = [];
    res.forEach((r) => (r.status === 'fulfilled' ? items.push(...r.value) : errs.push(r.reason.message)));
    items.sort((a, b) => String(b.cntrctCnclsDate).localeCompare(String(a.cntrctCnclsDate)));
    C.recent = items.slice(0, 10);
    C.recentErr = errs.length && !items.length ? errs[0] : null;
    drawRecent();
  }
  function drawRecent() {
    const box = $('#crecent');
    if (!box) return;
    if (C.recentErr) { box.innerHTML = errBox(C.recentErr); return; }
    if (!C.recent.length) { box.innerHTML = empty('최근 30일 계약이 없습니다.'); return; }
    box.innerHTML = `<div class="tablewrap"><table>
      <thead><tr><th>업무</th><th>계약명</th><th>업체</th><th class="nw">총계약금액</th><th>계약일</th><th>바로가기</th></tr></thead>
      <tbody>${C.recent.map((c) => { const p = parseCorpList(c.corpList)[0]; return `<tr><td class="nw">${esc(c._biz)}</td><td>${esc(c.cntrctNm)}</td><td>${esc(p ? p.name : '-')}</td><td class="num">${won(c.totCntrctAmt || c.thtmCntrctAmt)}</td><td class="nw">${esc(dateOnly(c.cntrctCnclsDate))}</td><td class="nw">${ext(c.cntrctDtlInfoUrl || c.cntrctInfoUrl)}</td></tr>`; }).join('')}</tbody>
    </table></div><p class="small muted" style="margin:8px 0 0">최근 30일 · ${esc(settings.bizs.join(', '))} 업무 기준</p>`;
  }

  // ---------- 2. 업체 확인 ----------
  const K = { bizno: '', data: null, err: null };

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
      location.hash = '#corp/' + v;
    });
    if (K.bizno && !K.data && !K.err) searchCorp(); else drawCorp();
  }

  async function searchCorp() {
    const box = $('#kresult');
    box.innerHTML = loading('업체 정보와 제재 이력을 확인하는 중…');
    K.err = null;
    const b = K.bizno;
    const [basic, ind, prd, unpt] = await Promise.allSettled([
      g2b('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: 3, bizno: b, numOfRows: 5 }),
      g2b('usr', 'getPrcrmntCorpIndstrytyInfo02', { inqryDiv: 1, bizno: b, numOfRows: 50 }),
      g2b('usr', 'getPrcrmntCorpSplyPrdctInfo02', { inqryDiv: 1, bizno: b, numOfRows: 50 }),
      g2b('usr', 'getUnptRsttCorpInfo02', { inqryDiv: 1, bizno: b, numOfRows: 50 }),
    ]);
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
          ${d.ind.err ? errBox(d.ind.err) : (d.ind.items || []).length ? `<div class="tablewrap"><table>
            <thead><tr><th>업종명</th><th>대표</th><th>상태</th><th>유효기간</th></tr></thead>
            <tbody>${d.ind.items.map((x) => `<tr><td>${esc(x.indstrytyNm)}</td><td class="nw">${x.rprsntIndstrytyYn === 'Y' ? '<span class="badge blue">대표</span>' : ''}</td><td>${esc(x.indstrytyStatsNm || '-')}</td><td class="nw">${esc(dateOnly(x.vldPrdExprtDt) || '-')}</td></tr>`).join('')}</tbody>
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
  }

  // ---------- 3. 유사사업 찾기 ----------
  const S = { q: '', biz: '용역', months: '3', doc: '전체', items: null, err: null };

  function renderSimilar(view, arg) {
    if (arg && arg !== S.q) { S.q = arg; S.items = null; S.err = null; }
    view.innerHTML = `
      <section class="card">
        <form class="form" id="sform">
          <label class="grow">사업명 키워드<input type="search" name="q" value="${esc(S.q)}" placeholder="예: 통합유지관리, 급식, 방수공사" required></label>
          <label>업무<select name="biz">${Object.keys(BIZ).map((b) => `<option ${b === S.biz ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
          <label>기간<select name="months">${[['1', '최근 1개월'], ['3', '최근 3개월'], ['6', '최근 6개월'], ['12', '최근 1년']].map(([v, t]) => `<option value="${v}" ${S.months === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>문서 종류<select name="doc">${['전체', '제안요청서', '과업지시서', '규격서', '내역서'].map((v) => `<option ${S.doc === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit">유사사업 검색</button>
        </form>
        <p class="small muted" style="margin:10px 0 0">전국 모든 기관의 입찰공고에서 공고명으로 찾습니다. 기간이 길수록 조회가 오래 걸립니다.</p>
      </section>
      <div class="row" style="align-items:flex-start">
        <div id="slist" style="flex:3 1 480px;min-width:0;display:flex;flex-direction:column;gap:12px"></div>
        <aside class="card" id="ssum" style="flex:1 1 240px"></aside>
      </div>`;
    $('#sform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      S.q = f.q.value.trim(); S.biz = f.biz.value; S.months = f.months.value; S.doc = f.doc.value;
      if (!S.q) return;
      searchSimilar();
    });
    $('#sform').doc.addEventListener('change', (e) => { S.doc = e.target.value; drawSimilar(); });
    if (S.q && !S.items && !S.err) searchSimilar(); else drawSimilar();
  }

  async function searchSimilar() {
    $('#slist').innerHTML = loading('유사사업을 찾는 중…');
    $('#ssum').innerHTML = '';
    S.err = null;
    const to = iso(today());
    const from = iso(addDays(today(), -Math.round(Number(S.months) * 30.4)));
    const chunks = monthChunks(from, to);
    const res = await Promise.allSettled(chunks.map((ch) => g2b('bid', `getBidPblancListInfo${BIZ[S.biz]}PPSSrch`, {
      inqryDiv: 1, inqryBgnDt: ch.bgn, inqryEndDt: ch.end, bidNtceNm: S.q, numOfRows: 100, pageNo: 1,
    })));
    const map = new Map();
    const errs = [];
    res.forEach((r) => {
      if (r.status !== 'fulfilled') { errs.push(r.reason.message); return; }
      r.value.items.forEach((n) => {
        const prev = map.get(n.bidNtceNo);
        if (!prev || String(n.bidNtceOrd) > String(prev.bidNtceOrd)) map.set(n.bidNtceNo, n);
      });
    });
    S.items = Array.from(map.values()).sort((a, b) => String(b.bidNtceDt).localeCompare(String(a.bidNtceDt)));
    S.err = !S.items.length && errs.length ? errs[0] : null;
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
    $('#scsv').addEventListener('click', () => downloadCsv(`유사사업_${S.q}_${iso(today())}.csv`,
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

  // ---------- 4. 공고 준비 · 확인 ----------
  const N = { from: iso(addDays(today(), -30)), to: iso(today()), q: '', items: null, err: null, sel: null };

  function renderNotice(view) {
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
      N.from = f.from.value; N.to = f.to.value; N.q = f.q.value.trim(); N.sel = null;
      searchNotices();
    });
    if (!N.items && !N.err) searchNotices(); else { drawNotices(); if (N.sel) drawNoticeDetail(N.sel); }
  }

  async function searchNotices() {
    const box = $('#nlist');
    box.innerHTML = loading();
    N.err = null;
    const chunks = monthChunks(N.from, N.to);
    const instKey = settings.insttDivCd === '2' ? 'dminsttNm' : 'ntceInsttNm';
    const jobs = [];
    settings.bizs.forEach((b) => chunks.forEach((ch) => jobs.push(
      g2b('bid', `getBidPblancListInfo${BIZ[b]}PPSSrch`, { inqryDiv: 1, inqryBgnDt: ch.bgn, inqryEndDt: ch.end, [instKey]: settings.insttNm, bidNtceNm: N.q, numOfRows: 100 })
        .then((r) => r.items.map((x) => Object.assign({ _biz: b }, x))))));
    const res = await Promise.allSettled(jobs);
    const map = new Map();
    const errs = [];
    res.forEach((r) => {
      if (r.status !== 'fulfilled') { errs.push(r.reason.message); return; }
      r.value.forEach((n) => { const p = map.get(n.bidNtceNo); if (!p || String(n.bidNtceOrd) > String(p.bidNtceOrd)) map.set(n.bidNtceNo, n); });
    });
    N.items = Array.from(map.values()).sort((a, b) => String(b.bidNtceDt).localeCompare(String(a.bidNtceDt)));
    N.err = !N.items.length && errs.length ? errs[0] : null;
    drawNotices();
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
    box.innerHTML = `<div class="small muted" style="margin-bottom:6px">총 ${N.items.length}건</div><div class="tablewrap"><table>
      <thead><tr><th>공고명</th><th>업무</th><th>공고일</th><th>입찰마감</th><th>상태</th><th>문서</th><th>바로가기</th></tr></thead>
      <tbody>${N.items.map((n, i) => { const [st, cls] = noticeStatus(n); return `<tr class="${N.sel && N.sel.bidNtceNo === n.bidNtceNo ? 'sel' : ''}">
        <td><button type="button" class="linkbtn" data-i="${i}">${esc(n.bidNtceNm)}</button><div class="small muted">${esc(n.bidNtceNo)}-${esc(n.bidNtceOrd)}</div></td>
        <td class="nw">${esc(n._biz)}</td><td class="nw">${esc(dateOnly(n.bidNtceDt))}</td><td class="nw">${esc(dt(n.bidClseDt) || '-')}</td>
        <td><span class="badge ${cls}">${esc(st)}</span></td><td class="nw">${noticeDocs(n).length}개</td><td class="nw">${ext(n.bidNtceDtlUrl || n.bidNtceUrl)}</td></tr>`; }).join('')}</tbody>
    </table></div>`;
    $$('button[data-i]', box).forEach((b) => b.addEventListener('click', () => { N.sel = N.items[Number(b.dataset.i)]; drawNotices(); drawNoticeDetail(N.sel); $('#ndetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
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
        <dt>계약방법</dt><dd>${esc(n.cntrctCnclsMthdNm || '-')} · ${esc(n.bidMethdNm || '')}</dd>
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
        <button type="button" class="btn sm" data-x="lic">면허제한</button>
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
        html = `<h3>면허제한</h3>${r.items.length ? `<div class="tablewrap"><table><thead><tr><th>면허제한명</th><th>허용업종</th><th>주력분야</th></tr></thead><tbody>${r.items.map((l) => `<tr><td>${esc(l.lcnsLmtNm)}</td><td>${esc(l.permsnIndstrytyList || '-')}</td><td>${esc(l.indstrytyMfrcFldList || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">면허제한이 없습니다.</div>'}`;
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
    } catch (e) { sub.innerHTML = `<div class="sub">${errBox(e.message)}</div>`; }
  }

  // ---------- 5. 법령 · 해석 찾기 ----------
  const L = { q: '', search: '1', from: '', to: '', sort: 'ddes', page: 1, list: null, total: 0, err: null, selId: null, detail: null, detailErr: null };

  // 법제처 응답 키 이름이 바뀌어도 동작하도록 느슨하게 찾음
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

  function renderLaw(view, arg) {
    if (arg && arg !== L.q) { Object.assign(L, { q: arg, page: 1, list: null, err: null, selId: null, detail: null }); }
    view.innerHTML = `
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
      Object.assign(L, { q: f.q.value.trim(), search: f.search.value, from: f.from.value, to: f.to.value, sort: f.sort.value, page: 1, selId: null, detail: null });
      searchLaw();
    });
    if (!L.list && !L.err) searchLaw(); else { drawLawList(); drawLawDetail(); }
  }

  async function searchLaw() {
    $('#llist').innerHTML = loading();
    L.err = null;
    try {
      const data = await lawApi('list', { query: L.q, search: L.search, display: 20, page: L.page, sort: L.sort, explYd: L.from && L.to ? `${ymd(L.from)}~${ymd(L.to)}` : '' });
      L.list = findArray(data) || [];
      L.total = num(findVal(data, ['totalCnt', 'totalCount'])) || L.list.length;
    } catch (e) { L.list = null; L.err = e.message; }
    drawLawList();
    drawLawDetail();
  }

  function drawLawList() {
    const box = $('#llist');
    if (!box) return;
    if (L.err) { box.innerHTML = `<div style="padding:10px">${errBox(L.err)}</div>`; return; }
    if (!L.list) { box.innerHTML = loading(); return; }
    if (!L.list.length) { box.innerHTML = empty('검색 결과가 없습니다.'); return; }
    const pages = Math.max(1, Math.ceil(L.total / 20));
    box.innerHTML = `<div class="small muted" style="padding:6px 12px">총 ${L.total.toLocaleString()}건</div><div class="lawlist">${L.list.map((x, i) => `
      <button type="button" class="lawitem" data-i="${i}" aria-current="${lawId(x) === L.selId}">
        <span style="display:block;font-weight:500">${esc(F(x, ['안건명']))}</span>
        <span class="small muted" style="display:block;margin-top:4px">${esc(F(x, ['안건번호']))} · ${esc(fmtLawDate(F(x, ['해석일자'])))} · ${esc(F(x, ['해석기관명']))}</span>
      </button>`).join('')}</div>
      <div class="pager" style="padding:0 12px 8px">
        <button type="button" class="btn sm" id="lprev" ${L.page <= 1 ? 'disabled' : ''}>이전</button>
        <span class="small muted">${L.page} / ${pages}</span>
        <button type="button" class="btn sm" id="lnext" ${L.page >= pages ? 'disabled' : ''}>다음</button>
      </div>`;
    $$('.lawitem', box).forEach((b) => b.addEventListener('click', () => openLaw(L.list[Number(b.dataset.i)])));
    $('#lprev').addEventListener('click', () => { L.page--; searchLaw(); });
    $('#lnext').addEventListener('click', () => { L.page++; searchLaw(); });
  }

  async function openLaw(item) {
    L.selId = lawId(item);
    L.detail = null; L.detailErr = null;
    drawLawList();
    const box = $('#ldetail');
    box.innerHTML = loading();
    if (window.matchMedia('(max-width: 900px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { L.detail = await lawApi('detail', { ID: L.selId }); } catch (e) { L.detailErr = e.message; }
    drawLawDetail(item);
  }

  function drawLawDetail(item) {
    const box = $('#ldetail');
    if (!box) return;
    if (!L.selId) { box.innerHTML = empty('왼쪽 목록에서 해석을 선택하세요.'); return; }
    if (L.detailErr) { box.innerHTML = errBox(L.detailErr); return; }
    if (!L.detail) { box.innerHTML = loading(); return; }
    const d = L.detail;
    const title = F(d, ['안건명']) || (item ? F(item, ['안건명']) : '');
    const refs = F(d, ['관련법령']).split(/\n|,(?=\s*「)|<br\s*\/?>|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const lawLink = (r) => { const nm = (r.match(/「([^」]+)」/) || [])[1] || r.replace(/\s*제\s*\d+.*$/, ''); return 'https://www.law.go.kr/법령/' + encodeURIComponent(nm.replace(/\s+/g, '')); };
    const sec = (h, v) => `<h3>${h}</h3><p class="lawbody">${esc(v || '-')}</p>`;
    box.innerHTML = `
      <div class="small muted">안건번호 ${esc(F(d, ['안건번호']))} · 해석일자 ${esc(fmtLawDate(F(d, ['해석일자'])))} · 해석기관 ${esc(F(d, ['해석기관명']))} · 질의기관 ${esc(F(d, ['질의기관명']))}</div>
      <h2 style="margin:6px 0 16px;font-size:18px">${esc(title)}</h2>
      ${sec('질의요지', F(d, ['질의요지']))}${sec('회답', F(d, ['회답']))}${sec('이유', F(d, ['이유']))}
      <h3>관련법령</h3>
      <div class="docs" style="margin:0 0 18px">${refs.length ? refs.map((r) => `<a class="doc" href="${esc(lawLink(r))}" target="_blank" rel="noopener">${esc(r)} ↗</a>`).join('') : '<span class="small muted">-</span>'}</div>
      <div class="btns">
        <a class="btn primary" href="/api/law?mode=html&ID=${encodeURIComponent(L.selId)}" target="_blank" rel="noopener">법제처 원문 보기 ↗</a>
        <button type="button" class="btn" id="lsave">보관함에 저장</button>
      </div>`;
    $('#lsave').addEventListener('click', () => saveItem({ kind: '법령해석', key: L.selId, name: title, link: '/api/law?mode=html&ID=' + encodeURIComponent(L.selId) }));
  }

  // ---------- 6. 내 보관함 ----------
  let savedTab = '전체';
  function renderSaved(view) {
    const all = getSaved();
    const list = all.filter((s) => savedTab === '전체' || s.kind === savedTab);
    view.innerHTML = `
      <section class="card">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-bottom:4px">
          <div class="tabs" role="tablist" aria-label="보관함 구분" style="margin:0">
            ${['전체', '계약', '공고', '업체', '법령해석'].map((t) => `<button type="button" class="tab" role="tab" data-t="${t}" aria-selected="${t === savedTab}">${t}</button>`).join('')}
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
    if (csv) csv.addEventListener('click', () => downloadCsv(`보관함_${iso(today())}.csv`, [['구분', '항목', '메모', '저장일', '링크']].concat(list.map((s) => [s.kind, s.name, s.memo, s.date, s.link && !s.link.startsWith('#') ? new URL(s.link, location.href).href : '']))));
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

  // ---------- 7. 설정 ----------
  function renderSettings(view) {
    view.innerHTML = `
      <div class="row">
        <section class="card">
          <h2>우리 기관</h2>
          <form id="setform" style="display:flex;flex-direction:column;gap:14px" class="form">
            <label class="grow" style="width:100%">기관명 (나라장터에 등록된 이름의 일부)<input type="text" name="insttNm" value="${esc(settings.insttNm)}" required></label>
            <label style="width:100%">기관 기준<select name="insttDivCd">
              <option value="1" ${settings.insttDivCd === '1' ? 'selected' : ''}>계약기관 · 공고기관 기준 (교육청이 직접 계약·공고한 건)</option>
              <option value="2" ${settings.insttDivCd === '2' ? 'selected' : ''}>수요기관 기준 (교육청 소속 기관이 요청한 건 포함)</option>
            </select></label>
            <fieldset style="border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:0">
              <legend class="small" style="color:var(--sub);padding:0 4px">주로 보는 업무 (최근 계약 · 공고 현황에 사용)</legend>
              <div style="display:flex;flex-wrap:wrap;gap:14px">${Object.keys(BIZ).map((b) => `<label style="flex-direction:row;align-items:center;gap:6px;font-size:14px;color:var(--ink);min-height:32px"><input type="checkbox" name="bizs" value="${b}" ${settings.bizs.includes(b) ? 'checked' : ''}>${b}</label>`).join('')}</div>
            </fieldset>
            <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" id="setreset">기본값으로</button></div>
          </form>
        </section>
        <section class="card">
          <h2>데이터 연결 상태</h2>
          <div id="health">${loading()}</div>
          <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="htest">실제 조회로 연결 테스트</button></div>
          <div id="htestres" style="margin-top:10px"></div>
          <p class="small muted" style="margin:12px 0 0">인증키는 이 화면이나 브라우저에 저장되지 않고, Cloudflare 환경변수에만 있습니다.</p>
        </section>
      </div>`;
    $('#setform').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const bizs = $$('input[name=bizs]:checked', f).map((x) => x.value);
      settings = { insttNm: f.insttNm.value.trim() || DEFAULTS.insttNm, insttDivCd: f.insttDivCd.value, bizs: bizs.length ? bizs : DEFAULTS.bizs.slice() };
      store.set('cne.settings', settings);
      C.data = null; C.recent = null; N.items = null;
      toast('설정을 저장했습니다.');
    });
    $('#setreset').addEventListener('click', () => { settings = Object.assign({}, DEFAULTS, { bizs: DEFAULTS.bizs.slice() }); store.set('cne.settings', settings); C.data = null; C.recent = null; N.items = null; renderSettings(view); toast('기본값으로 되돌렸습니다.'); });
    fetch('/api/health').then((r) => r.json()).then((h) => {
      const row = (name, src, ok) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;background:var(--soft);border-radius:8px;margin-bottom:8px"><div><div>${name}</div><div class="small muted">${src}</div></div><span class="badge ${ok ? 'grn' : 'red'}">${ok ? '키 설정됨' : '키 없음'}</span></div>`;
      $('#health').innerHTML = row('나라장터 입찰공고 · 계약 · 사용자정보', '공공데이터포털 인증키 (G2B_SERVICE_KEY)', h.g2b) + row('조달청 법령해석 목록 · 본문', '법제처 OC (LAW_OC)', h.law);
    }).catch(() => { $('#health').innerHTML = errBox('상태를 확인하지 못했습니다.'); });
    $('#htest').addEventListener('click', async () => {
      const out = $('#htestres');
      out.innerHTML = loading('각 API를 1건씩 조회하는 중…');
      const d = ymd(iso(addDays(today(), -1)));
      const tests = [
        ['입찰공고정보서비스', () => g2b('bid', 'getBidPblancListInfoServcPPSSrch', { inqryDiv: 1, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['계약정보서비스', () => g2b('cntrct', 'getCntrctInfoListServcPPSSrch', { inqryDiv: 1, inqryBgnDate: d, inqryEndDate: d, numOfRows: 1 })],
        ['사용자정보서비스', () => g2b('usr', 'getDminsttInfo02', { inqryDiv: 1, inqryBgnDt: d + '0000', inqryEndDt: d + '2359', numOfRows: 1 })],
        ['법제처 법령해석', () => lawApi('list', { query: '계약', display: 1 })],
      ];
      const res = await Promise.allSettled(tests.map((t) => t[1]()));
      out.innerHTML = res.map((r, i) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)"><span>${tests[i][0]}</span>${r.status === 'fulfilled' ? '<span class="badge grn">정상</span>' : `<span class="badge red" title="${esc(r.reason.message)}">실패</span>`}</div>${r.status === 'rejected' ? `<div class="small" style="color:var(--red);padding:4px 0 8px">${esc(r.reason.message)}</div>` : ''}`).join('');
    });
  }

  // ---------- 라우팅 ----------
  const ROUTES = [
    { id: 'contract', label: '계약 관리', sub: '계약 목록 · 변경이력 · 공고→계약 추적', render: renderContract },
    { id: 'corp', label: '업체 확인', sub: '업체 정보 · 업종 · 공급물품 · 부정당제재 확인', render: renderCorp },
    { id: 'similar', label: '유사사업 찾기', sub: '다른 기관의 비슷한 사업 · 문서 · 금액 참고', render: renderSimilar },
    { id: 'notice', label: '공고 준비 · 확인', sub: '우리 기관 공고 · 입찰조건 · 정정이력', render: renderNotice },
    { id: 'law', label: '법령 · 해석 찾기', sub: '조달청 법령해석 검색과 본문 보기', render: renderLaw },
    { id: 'saved', label: '내 보관함', sub: '저장한 계약 · 공고 · 업체 · 해석과 메모', render: renderSaved },
    { id: 'settings', label: '설정', sub: '우리 기관 · 주요 업무 · 데이터 연결 상태', render: renderSettings },
  ];

  function route() {
    const raw = location.hash.replace(/^#/, '');
    const [id, ...rest] = raw.split('/');
    const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
    let arg = '';
    try { arg = decodeURIComponent(rest.join('/')); } catch (e) { arg = rest.join('/'); }
    $('#nav').innerHTML = ROUTES.map((x) => `<a href="#${x.id}" ${x.id === r.id ? 'aria-current="page"' : ''}><span class="dot" aria-hidden="true"></span><span>${x.label}</span></a>`).join('');
    $('#ptitle').textContent = r.label;
    $('#psub').textContent = r.sub;
    document.title = `${r.label} · 충청남도교육청 계약 업무 도우미`;
    r.render($('#view'), arg);
    window.scrollTo(0, 0);
  }

  function globalSearch() {
    const q = $('#gq').value.trim();
    if (!q) return;
    const digits = q.replace(/[-\s]/g, '');
    location.hash = /^\d{10}$/.test(digits) ? '#corp/' + digits : '#similar/' + encodeURIComponent(q);
    $('#gq').value = '';
    $('#gq').blur();
  }
  $('#gsearch').addEventListener('submit', (e) => { e.preventDefault(); globalSearch(); });
  // 모바일 한글 입력 중 엔터가 submit으로 이어지지 않는 브라우저 대비
  $('#gq').addEventListener('keyup', (e) => { if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) { e.preventDefault(); globalSearch(); } });
  window.addEventListener('hashchange', route);
  route();
})();

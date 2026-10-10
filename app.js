(() => {
'use strict';
const CFG = window.CPL_CONFIG || {};
const configured = !!CFG.SUPABASE_URL && !/YOUR/i.test(CFG.SUPABASE_URL) && !!CFG.SUPABASE_ANON_KEY && !/YOUR/i.test(CFG.SUPABASE_ANON_KEY);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtShort = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const SPORT = { cricket: 'Cricket (Men)', badminton: 'Badminton (Women)' };
const statusLabel = (sport, st) => ({
  nominated: 'Nominated', playing: sport === 'badminton' ? 'Selected pair' : 'Playing XI',
  reserve: 'Reserve', not_selected: 'Not selected', withdrawn: 'Withdrawn'
}[st] || st);
const chip = (sport, st) => `<span class="chip ${esc(st)}">${esc(statusLabel(sport, st))}</span>`;
const lim = sport => sport === 'cricket' ? { playing: CFG.CRICKET_PLAYING, reserve: CFG.CRICKET_RESERVE } : { playing: CFG.BADMINTON_TEAM, reserve: 0 };

/* ---------------- IndexedDB (cache + offline queue) ---------------- */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('cpl4', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('cache', { keyPath: 'k' }); d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const rq = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const r = fn(d.transaction(store, mode).objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  };
  return {
    get: k => rq('cache', 'readonly', s => s.get(k)).then(r => (r ? r.v : null)).catch(() => null),
    set: (k, v) => rq('cache', 'readwrite', s => s.put({ k, v })).catch(() => null),
    qAdd: item => rq('queue', 'readwrite', s => s.add(item)),
    qAll: () => rq('queue', 'readonly', s => s.getAll()).catch(() => []),
    qDel: id => rq('queue', 'readwrite', s => s.delete(id)),
    qPut: item => rq('queue', 'readwrite', s => s.put(item))
  };
})();

/* ---------------- Supabase REST ---------------- */
const sb = {
  session: (() => { try { return JSON.parse(localStorage.getItem('cpl_session')); } catch { return null; } })(),
  save(s) { this.session = s; if (s) localStorage.setItem('cpl_session', JSON.stringify(s)); else localStorage.removeItem('cpl_session'); },
  pack(j) { return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || (this.session && this.session.email) }; },
  async login(email, password) {
    const r = await fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.msg || 'Login failed');
    this.save(this.pack(j));
  },
  async refresh() {
    if (!this.session || !this.session.refresh_token) throw new Error('No session');
    const r = await fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
    const j = await r.json();
    if (!r.ok) { this.save(null); throw new Error('Session expired'); }
    this.save(this.pack(j));
  },
  async signUp(email, password) {   // creates an Auth user WITHOUT touching the current admin session
    const r = await fetch(CFG.SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const m = String(j.msg || j.error_description || j.message || ''); const e = new Error(/registered|exists/i.test(m) ? 'EXISTS' : (m || 'Sign-up failed')); e.code = /registered|exists/i.test(m) ? 'exists' : 'fail'; throw e; }
    return { confirmed: !!j.access_token };
  },
  async changePassword(password) {
    if (this.session && this.session.expires_at - Date.now() < 30000) { try { await this.refresh(); } catch (e) { /* ignore */ } }
    const r = await fetch(CFG.SUPABASE_URL + '/auth/v1/user', { method: 'PUT', headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (this.session && this.session.access_token), 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || 'Could not change password');
  },
  logout() { this.save(null); },
  async req(path, { method = 'GET', body, prefer, anon = false } = {}) {
    if (!anon && this.session && this.session.expires_at - Date.now() < 30000) { try { await this.refresh(); } catch (e) { /* offline/expired */ } }
    const go = () => fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, {
      method,
      headers: Object.assign({ apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + ((!anon && this.session && this.session.access_token) || CFG.SUPABASE_ANON_KEY) }, prefer ? { Prefer: prefer } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let r = await go();
    if (r.status === 401 && !anon && this.session) { try { await this.refresh(); r = await go(); } catch (e) { /* fallthrough */ } }
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { /* ignore */ } const err = new Error(j.message || ('HTTP ' + r.status)); err.status = r.status; err.code = j.code; throw err; }
    if (r.status === 204) return null;
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
};

/* ---------------- state ---------------- */
const D = { pub: { circles: [], teams: [], participants: [], branches: [], fixtures: [], notices: [] }, fromCache: false, lastSync: null, loaded: false, setupError: false, pending: 0, sport: 'cricket', q: '', teamF: '', circle: '' };
async function loadPublic() {
  if (!configured) { D.loaded = true; return; }
  try {
    const g = p => sb.req(p, { anon: true });
    const [circles, teams, participants, branches, fixtures, notices] = await Promise.all([
      g('cpl_circles?select=*&order=sort_order.asc'), g('cpl_teams?select=*&order=sort_order.asc,name.asc'),
      g('cpl_public_participants?select=*&order=created_at.asc'), g('cpl_public_branches?select=*&order=branch_name.asc'),
      g('cpl_fixtures?select=*&order=match_no.asc'), g('cpl_notices?select=*&published=eq.true&order=pinned.desc,created_at.desc')
    ]);
    D.pub = { circles, teams, participants, branches, fixtures, notices };
    D.fromCache = false; D.setupError = false; D.lastSync = Date.now();
    await idb.set('pub2', Object.assign({ t: D.lastSync }, D.pub));
  } catch (e) {
    D.setupError = e.status === 404;
    const c = await idb.get('pub2');
    if (c) { D.pub = { circles: c.circles, teams: c.teams, participants: c.participants, branches: c.branches, fixtures: c.fixtures, notices: c.notices }; D.lastSync = c.t; D.fromCache = true; }
  }
  if (!D.circle && D.pub.circles[0]) D.circle = D.pub.circles[0].id;
  D.loaded = true;
}

/* ---------------- selectors ---------------- */
const teamsList = () => D.pub.teams.filter(t => !D.circle || t.circle_id === D.circle);
const T = id => D.pub.teams.find(t => t.id === id);
const tname = id => (T(id) || {}).name || id || '';
const branchesOf = id => D.pub.branches.filter(b => b.team_id === id);
function capFirst(a, b) { return (b.is_captain ? 1 : 0) - (a.is_captain ? 1 : 0) || String(a.created_at).localeCompare(String(b.created_at)); }
function squadOf(list, sport, teamId) {
  const l = list.filter(x => x.sport === sport && (!teamId || x.team_id === teamId));
  return { pool: l.filter(x => x.status !== 'withdrawn'), playing: l.filter(x => x.status === 'playing').sort(capFirst), reserve: l.filter(x => x.status === 'reserve').sort(capFirst) };
}
function resolvedFx(sport) {
  const list = D.pub.fixtures.filter(f => f.sport === sport && (!D.circle || f.circle_id === D.circle)).map(f => Object.assign({}, f)).sort((a, b) => a.match_no - b.match_no);
  const by = {}; list.forEach(f => { by[f.match_no] = f; });
  const side = (f, s) => { const t = f['team_' + s], src = f['src_' + s]; if (t) return t; const m = by[src]; return m && m.winner ? m.winner : null; };
  list.forEach(f => { f.a = side(f, 'a'); f.b = side(f, 'b'); });
  const memo = {};
  const depth = f => { if (memo[f.match_no]) return memo[f.match_no]; const d = [f.src_a, f.src_b].filter(Boolean).map(n => (by[n] ? depth(by[n]) : 0)); return (memo[f.match_no] = 1 + (d.length ? Math.max(...d) : 0)); };
  list.forEach(f => { f.round = depth(f); });
  return list;
}
const champion = sport => { const l = resolvedFx(sport); const fin = l.length ? l.reduce((m, f) => (f.round >= m.round ? f : m)) : null; return fin && fin.winner ? fin.winner : null; };
function nextDate() { const now = new Date(); now.setHours(0, 0, 0, 0); return (CFG.DATES || []).find(x => new Date(x.d) >= now); }
const daysTo = d => Math.round((new Date(d) - new Date(new Date().toDateString())) / 86400000);

/* ---------------- UI helpers ---------------- */
function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; t.setAttribute('role', 'status'); document.body.appendChild(t); setTimeout(() => t.remove(), 3600); }
function openModal(html, wide) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="mb"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  $('.mb', root).addEventListener('mousedown', e => { if (e.target.classList.contains('mb')) closeModal(); });
  return $('.modal', root);
}
function closeModal() { $('#modalRoot').innerHTML = ''; document.body.classList.remove('printing'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------------- offline queue ---------------- */
async function updatePending() { D.pending = (await idb.qAll()).length; const p = $('#pendPill'); if (p) { p.classList.toggle('hide', !D.pending); p.textContent = '↻ ' + D.pending + ' pending'; } }
function updateNet() { const el = $('#netPill'); if (!el) return; el.textContent = navigator.onLine ? 'Online' : 'Offline'; el.classList.toggle('off', !navigator.onLine); }
async function flushQueue(manual) {
  if (!configured || !navigator.onLine) { if (manual) toast('Internet not available', true); return { sent: 0 }; }
  const items = await idb.qAll(); let sent = 0, dup = 0, failed = 0;
  for (const it of items) {
    try { await sb.req('cpl_participants', { method: 'POST', body: it.rec, prefer: 'return=minimal', anon: true }); await idb.qDel(it.id); sent++; }
    catch (e) {
      if (!e.status) break;
      if (e.status === 409 || e.code === '23505') { await idb.qDel(it.id); dup++; } else { it.failed = e.message; await idb.qPut(it); failed++; }
    }
  }
  await updatePending();
  if (sent || dup || (manual && items.length)) toast(`Synced: ${sent} sent` + (dup ? `, ${dup} already registered` : '') + (failed ? `, ${failed} failed` : ''), failed > 0);
  if (sent) { await loadPublic(); route(true); }
  return { sent, dup, failed };
}
async function submitEntry(rec, viaAdmin) {
  try { await sb.req('cpl_participants', { method: 'POST', body: rec, prefer: 'return=minimal', anon: !viaAdmin || !sb.session }); return 'sent'; }
  catch (e) {
    if (e.status === 409 || e.code === '23505') return 'duplicate';
    if (!e.status) { await idb.qAdd({ rec, t: Date.now() }); await updatePending(); return 'queued'; }
    throw e;
  }
}

/* ---------------- shared entry form ---------------- */
const ROLES = ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'];
function entryFields(r, o) {
  r = r || {}; o = o || {};
  const sport = r.sport || 'cricket', team = o.lockTeam || r.team_id || o.defaultTeam || '';
  return `
  <div class="field full"><label>Sport</label>
    <div class="opt">
      <label><input type="radio" name="sport" value="cricket" ${sport === 'cricket' ? 'checked' : ''}><span>Cricket<small>Men staff</small></span></label>
      <label><input type="radio" name="sport" value="badminton" ${sport === 'badminton' ? 'checked' : ''}><span>Badminton<small>Women staff · doubles</small></span></label>
    </div></div>
  <div class="field full"><label for="f_team">RO / Office you work in</label><select id="f_team" name="team_id" ${o.lockTeam ? 'disabled' : ''}><option value="">Select RO / office</option>${teamsList().map(t => `<option value="${esc(t.id)}" ${t.id === team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
  <div class="field"><label for="f_name">Full name</label><input id="f_name" name="full_name" type="text" maxlength="80" autocomplete="name" value="${esc(r.full_name)}" required></div>
  <div class="field"><label for="f_staff">Staff number</label><input id="f_staff" name="staff_no" type="tel" inputmode="numeric" maxlength="8" value="${esc(r.staff_no)}" required><span class="hint">Digits only, e.g. 894257</span></div>
  <div class="field"><label for="f_desig">Cadre / designation</label><input id="f_desig" name="designation" type="text" maxlength="60" value="${esc(r.designation)}" placeholder="e.g. Clerk, Officer, Sub-staff" list="cadreList" required><datalist id="cadreList"><option>Officer</option><option>Clerk</option><option>Sub-staff</option><option>Manager</option><option>Senior Manager</option></datalist></div>
  <div class="field"><label for="f_contact">WhatsApp / mobile number</label><input id="f_contact" name="contact" type="tel" inputmode="numeric" maxlength="10" value="${esc(r.contact)}" required><span class="hint">10 digits. Used only by your RO admin; never shown publicly.</span></div>
  <div class="field" id="brWrap"><label for="f_branch">Branch / unit</label><select id="f_branch" name="branch_sel"></select></div>
  <div class="field" id="otherWrap"><label for="f_other" id="otherLbl">Unit name</label><input id="f_other" name="branch_other" type="text" maxlength="100" placeholder="e.g. Zonal Inspectorate"></div>
  <div class="field" id="roleWrap"><label for="f_role">Playing role (optional)</label><select id="f_role" name="playing_role"><option value="">Not specified</option>${ROLES.map(x => `<option ${r.playing_role === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
  <div class="field" id="partnerWrap"><label for="f_partner">Preferred partner (optional)</label><input id="f_partner" name="partner_pref" type="text" maxlength="80" value="${esc(r.partner_pref)}" placeholder="Name of colleague"><span class="hint">Final pair is decided after trials.</span></div>`;
}
function bindEntryForm(form, r) {
  r = r || {};
  const sel = $('#f_branch', form), other = $('#f_other', form), teamEl = form.elements.team_id;
  const syncOther = () => {
    const bl = branchesOf(teamEl.value), need = !bl.length || sel.value === 'other';
    $('#otherWrap', form).style.display = need ? '' : 'none';
    $('#otherLbl', form).textContent = bl.length ? 'Unit name' : 'Branch / unit name';
  };
  const fill = (first) => {
    const bl = branchesOf(teamEl.value), known = first && r.dp_code && bl.some(b => b.dp_code === r.dp_code);
    sel.innerHTML = '<option value="">Select branch / unit</option>' + bl.map(b => `<option value="${b.dp_code}">${esc(b.branch_name)} (${b.dp_code})</option>`).join('') + '<option value="other">Other unit (type below)</option>';
    if (known) sel.value = r.dp_code; else if (first && r.branch_name && !known) { sel.value = 'other'; other.value = r.branch_name; }
    $('#brWrap', form).style.display = bl.length ? '' : 'none';
    if (first && !bl.length && r.branch_name) other.value = r.branch_name;
    syncOther();
  };
  const sync = () => {
    const sp = form.querySelector('input[name=sport]:checked').value, tn = teamEl.value ? tname(teamEl.value) : 'your RO / office';
    $('#roleWrap', form).style.display = sp === 'cricket' ? '' : 'none';
    $('#partnerWrap', form).style.display = sp === 'badminton' ? '' : 'none';
    const m = $('#declText', form);
    if (m) m.textContent = sp === 'cricket' ? `I am a male staff member working under ${tn} and wish to be considered for the Cricket squad.` : `I am a female staff member working under ${tn} and wish to be considered for the Badminton doubles team.`;
  };
  form.querySelectorAll('input[name=sport]').forEach(i => i.addEventListener('change', sync));
  teamEl.addEventListener('change', () => { fill(false); sync(); });
  sel.addEventListener('change', syncOther);
  fill(true); sync();
}
function readEntry(form) {
  const g = n => (form.elements[n] ? form.elements[n].value : '').trim().replace(/\s+/g, ' ');
  const sport = form.querySelector('input[name=sport]:checked').value, tid = g('team_id'), bl = branchesOf(tid), sel = g('branch_sel');
  let dp = null, bn = '';
  if (bl.length && sel && sel !== 'other') { const b = bl.find(x => String(x.dp_code) === sel); dp = b ? b.dp_code : null; bn = b ? b.branch_name : ''; } else bn = g('branch_other');
  const r = { team_id: tid, sport, full_name: g('full_name'), staff_no: g('staff_no'), contact: g('contact'), designation: g('designation') || null, dp_code: dp, branch_name: bn,
    playing_role: sport === 'cricket' ? (g('playing_role') || null) : null, partner_pref: sport === 'badminton' ? (g('partner_pref') || null) : null };
  const miss = [];
  if (!r.team_id) miss.push('RO / office');
  if (r.full_name.length < 2) miss.push('Full name');
  if (!/^\d{3,8}$/.test(r.staff_no)) miss.push('Staff number (3-8 digits)');
  if (!/^\d{10}$/.test(r.contact)) miss.push('WhatsApp number (10 digits)');
  if (!r.designation) miss.push('Cadre / designation');
  if (r.branch_name.length < 2) miss.push('Branch / unit');
  return { r, miss };
}

/* ---------------- view pieces ---------------- */
const digits = (n, min = 2) => `<span class="dg" data-n="${n}" data-min="${min}">${String(n).padStart(min, '0').split('').map(c => `<i>${c}</i>`).join('')}</span>`;
function animateCounts(root) {
  const els = $$('.dg[data-n]', root); if (!els.length || window.__cplCounted) return;
  window.__cplCounted = 1;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const paint = (e, n) => { e.innerHTML = String(n).padStart(+e.dataset.min, '0').split('').map(c => `<i>${c}</i>`).join(''); };
  els.forEach(e => paint(e, 0));
  const t0 = performance.now(), dur = 1300;
  (function tick(t) { const p = Math.min(1, ((t || performance.now()) - t0) / dur), k = 1 - Math.pow(1 - p, 3); els.forEach(e => paint(e, Math.round(+e.dataset.n * k))); if (p < 1) requestAnimationFrame(tick); })(t0);
}
const crowd = n => { let h = ''; for (let i = 0; i < n; i++) h += `<circle class="fl" cx="${(12 + i * (376 / (n - 1))).toFixed(1)}" cy="${226 + (i % 3) * 4}" r="1.9" style="animation-delay:${(Math.random() * 7).toFixed(2)}s"/>`; return h; };
const ghost = (cls, inner, lag, o) => `<g class="${cls}" style="animation-delay:${lag}s;opacity:${o}">${inner}</g>`;
function cricketScene() {
  const ballG = (lag, o) => `<g class="cbx" style="animation-delay:${lag}s;opacity:${o}"><g class="cby" style="animation-delay:${lag}s"><g class="cbo" style="animation-delay:${lag}s"><circle class="ball" r="6.5"/><path class="seam" d="M-4.5 -2.5 Q0 -6 4.5 -2.5 M-4.5 2.5 Q0 6 4.5 2.5"/></g></g></g>`;
  return `<svg class="scene cricket" viewBox="0 0 400 240" aria-hidden="true" focusable="false">
  <rect class="grass" x="0" y="204" width="400" height="36"/><rect class="pitch" x="30" y="204" width="340" height="9" rx="2"/>
  <path class="crease" d="M262 204v9M338 204v9M52 204v9"/>
  <g class="stump"><path d="M322 142v62M331 142v62M340 142v62"/><path class="bail" d="M322 140h9M331 140h9"/></g>
  <g class="stump far"><path d="M44 176v28M50 176v28M56 176v28"/></g>
  <g class="bat" style="transform-origin:292px 148px"><rect x="287.5" y="148" width="10" height="50" rx="3.5" class="blade"/><rect x="290" y="128" width="5" height="22" rx="2" class="grip"/></g>
  ${ballG(0.1, .22)}${ballG(0.05, .5)}${ballG(0, 1)}
  <g class="spark" style="transform-origin:284px 172px"><circle cx="284" cy="172" r="13"/><path d="M284 148v-10M284 196v10M260 172h-10M308 172h10M267 155l-7-7M301 155l7-7M267 189l-7 7M301 189l7 7"/></g>
  <text class="six" x="190" y="70" text-anchor="middle">SIX!</text>
  ${crowd(26)}</svg>`;
}
function badmintonScene() {
  const shu = (lag, o) => `<g class="bx" style="animation-delay:${lag}s;opacity:${o}"><g class="by" style="animation-delay:${lag}s"><g class="bf" style="animation-delay:${lag}s"><g class="bt" style="animation-delay:${lag}s"><path class="skirt" d="M0 0L-15 -6.5L-15 6.5Z"/><path class="ribs" d="M-3 0L-15 -3M-3 0L-15 3M-3 0L-15 0"/><circle class="cork" r="3.8"/></g></g></g></g>`;
  const rk = (x, cls, del) => `<g class="rk ${cls}" style="transform-origin:${x}px 174px;animation-delay:${del}s"><path class="shaft" d="M${x} 174V146"/><ellipse class="head" cx="${x}" cy="125" rx="11.5" ry="18"/><path class="str" d="M${x - 8} 118h16M${x - 9} 126h18M${x - 8} 134h16M${x - 4} 108v34M${x + 4} 108v34"/></g>`;
  return `<svg class="scene badminton" viewBox="0 0 400 240" aria-hidden="true" focusable="false">
  <rect class="floor" x="0" y="206" width="400" height="34"/><path class="cline" d="M20 206H380M60 206l-24 34M340 206l24 34M200 206v34"/>
  <g class="net"><path class="post" d="M200 112V206"/><path class="mesh" d="M200 118H200"/><rect x="186" y="116" width="28" height="0.1"/><path class="tape" d="M184 112H216"/><path class="grid" d="M186 122h28M186 132h28M186 142h28M186 152h28M186 162h28M186 172h28M186 182h28M186 192h28M192 112v94M200 112v94M208 112v94"/></g>
  ${rk(92, 'l', 0)}${rk(308, 'r', -2)}
  <circle class="hit" cx="106" cy="120" r="9" style="transform-origin:106px 120px;animation-delay:0s"/><circle class="hit" cx="294" cy="120" r="9" style="transform-origin:294px 120px;animation-delay:-2s"/>
  ${shu(0.08, .2)}${shu(0.04, .5)}${shu(0, 1)}
  ${crowd(26)}</svg>`;
}
const particles = n => { let h = ''; for (let i = 0; i < n; i++) h += `<i class="pt" style="left:${(Math.random() * 100).toFixed(1)}%;--s:${(2 + Math.random() * 4).toFixed(1)}px;animation-duration:${(9 + Math.random() * 12).toFixed(1)}s;animation-delay:${(-Math.random() * 18).toFixed(1)}s"></i>`; return h; };
const isToday = d => new Date(d).toDateString() === new Date().toDateString();
function arenaHTML(teams, P) {
  const mk = (sp, title, sub, scene, done, what) => {
    const l = P.filter(x => x.sport === sp), today = l.filter(x => isToday(x.created_at)).length;
    return `<article class="sport-card ${sp}"><div class="stage">${scene}</div><div class="si"><h3>${title}</h3><p>${sub}</p>
      <div class="kp"><span><b>${l.length}</b>nominated</span><span><b>${done}<small>/${teams.length}</small></b>${what} complete</span></div>
      <span class="today ${today ? '' : 'calm'}"><i></i>${today ? '+' + today + ' today' : 'Open for nominations'}</span>
      <div class="row" style="margin-top:12px"><a class="btn gold sm" href="#/teams" data-pick="${sp}">See squads</a><a class="btn light sm" href="#/nominate">Nominate</a></div></div></article>`;
  };
  const cd = teams.filter(t => squadOf(P, 'cricket', t.id).playing.length >= CFG.CRICKET_PLAYING).length, bd = teams.filter(t => squadOf(P, 'badminton', t.id).playing.length >= CFG.BADMINTON_TEAM).length;
  return `<section class="arena"><div class="sec-h"><div><h2>Two games, one league</h2><p>Pick a game to see every RO's squad.</p></div></div><div class="duo">
    ${mk('cricket', 'Cricket · Men', "Men's squads, one for every RO.", cricketScene(), cd, 'squads')}${mk('badminton', 'Badminton · Women', "Women's doubles, one pair for every RO.", badmintonScene(), bd, 'pairs')}</div></section>`;
}
function reveal(root) {
  const els = $$('.tile, .sport-card, .follow .card, .guide, .tw, article.card, .sec-h', root); if (!els.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); setTimeout(() => e.target.classList.remove('rv', 'in'), 1100); } }), { threshold: .08 });
  els.forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--rd', ((i % 6) * 0.06).toFixed(2) + 's'); io.observe(el); });
}
function tickerHTML() {
  const P = D.pub.participants.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 14);
  const res = D.pub.fixtures.filter(f => f.winner && (!D.circle || f.circle_id === D.circle)).sort((a, b) => b.match_no - a.match_no).slice(0, 4);
  const items = res.map(f => `<span class="it"><b>${esc(tname(f.winner))}</b> won match ${f.match_no}${f.result_note ? ', ' + esc(f.result_note) : ''}</span>`)
    .concat(P.map(x => `<span class="it"><b>${esc(x.full_name)}</b> ${x.designation ? esc(x.designation) + ', ' : ''}${esc(x.branch_name)}, ${esc(tname(x.team_id))} for ${x.sport === 'cricket' ? 'Cricket' : 'Badminton'}</span>`));
  if (!items.length) items.push('<span class="it"><b>Nominations are open.</b> Choose your RO and nominate in two minutes.</span>');
  const row = items.join('');
  return `<div class="ticker" aria-label="Latest nominations and results"><span class="live"><i></i>Live</span><div class="tk">${row}${row}</div></div>`;
}
const sportToggle = () => `<div class="seg" role="tablist" aria-label="Sport">${['cricket', 'badminton'].map(s => `<button data-sport="${s}" class="${D.sport === s ? 'on' : ''}" role="tab" aria-selected="${D.sport === s}">${s === 'cricket' ? 'Cricket · Men' : 'Badminton · Women'}</button>`).join('')}</div>`;
function bindSport(root) { $$('[data-sport]', root).forEach(b => b.addEventListener('click', () => { D.sport = b.dataset.sport; route(true); })); }
function pips(sport, sq) {
  const L = lim(sport); let h = '';
  for (let i = 0; i < L.playing; i++) h += `<i class="${i < sq.playing.length ? 'on' : ''}"></i>`;
  if (L.reserve) { h += '<u></u>'; for (let i = 0; i < L.reserve; i++) h += `<i class="r ${i < sq.reserve.length ? 'on' : ''}"></i>`; }
  return `<span class="pips" aria-hidden="true">${h}</span>`;
}
function squadBoard(sport) {
  const L = lim(sport), P = D.pub.participants, C = 2 * Math.PI * 26;
  const tiles = teamsList().map(t => {
    const sq = squadOf(P, sport, t.id), n = sq.playing.length, full = n >= L.playing, pct = Math.min(1, n / L.playing);
    const meta = L.reserve ? `${sq.reserve.length}/${L.reserve} reserves` : (full ? 'Pair confirmed' : 'Pair to be named');
    return `<a class="tile ${full ? 'full' : ''}" href="#/team/${esc(t.id)}"><span class="ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26" style="--c:${(pct * C).toFixed(1)}" stroke-dasharray="${(pct * C).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${n}<small>/${L.playing}</small></b></span><span class="tn"><b>${esc(t.name)}</b><small>${t.kind === 'CO' ? 'Circle Office' : 'Regional Office'}</small></span><span class="tm2"><span>${sq.pool.length} nominated, ${meta}</span>${full ? '<i class="done">Squad complete</i>' : ''}</span></a>`;
  });
  return tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '<p class="muted">No teams found. Run schema_v2.sql in Supabase.</p>';
}
function matchCard(f, mine) {
  const slot = (id, src) => {
    if (!id) return `<div class="tm ph">${src ? 'Winner of M' + src : 'To be decided'}</div>`;
    const cls = f.winner ? (f.winner === id ? 'win' : 'lose') : '';
    return `<div class="tm ${cls} ${mine && mine === id ? 'mine' : ''}"><span>${esc(tname(id))}</span>${f.winner === id ? '<span class="ck">✓</span>' : ''}</div>`;
  };
  const when = [f.match_date ? fmtShort(f.match_date) : '', f.match_time || ''].filter(Boolean).join(' · ') || 'Date to be announced';
  const foot = [f.venue, f.result_note].filter(Boolean).join(' · ');
  return `<div class="mt"><div class="mt-h"><b>M${f.match_no}</b><span>${esc(when)}</span></div>${slot(f.a, f.src_a)}${slot(f.b, f.src_b)}${foot ? `<div class="mt-f">${esc(foot)}</div>` : ''}</div>`;
}
function bracketHTML(sport, mine) {
  const list = resolvedFx(sport);
  if (!list.length) return '<p class="muted">Fixtures have not been loaded yet.</p>';
  const maxR = Math.max(...list.map(f => f.round));
  const rname = r => (r === maxR ? 'Final' : r === maxR - 1 && maxR > 2 ? 'Semi-final' : 'Round ' + r);
  let h = '';
  for (let r = 1; r <= maxR; r++) { const ms = list.filter(f => f.round === r); if (ms.length) h += `<div class="rnd"><h4>${rname(r)}</h4><div class="rnd-in">${ms.map(f => matchCard(f, mine)).join('')}</div></div>`; }
  const ch = champion(sport);
  return (ch ? `<p><span class="champ">🏆 ${esc(tname(ch))} · represents ${esc((D.pub.circles.find(c => c.id === D.circle) || {}).name || 'the Circle')}</span></p>` : '') + `<div class="bracket">${h}</div>`;
}
function slotList(sport, sq) {
  const rows = [], L = lim(sport);
  const mk = (n, p) => p ? `<li class="slot"><span class="no">${n}</span><span class="nm">${esc(p.full_name)}${p.is_captain ? '<i>(C)</i>' : ''}</span><span class="br">${esc(p.branch_name)}</span></li>` : `<li class="slot open"><span class="no">${n}</span><span class="nm">Open</span><span class="br"></span></li>`;
  for (let i = 0; i < L.playing; i++) rows.push(mk(i + 1, sq.playing[i]));
  if (L.reserve) { rows.push('<li class="slot-sep">Reserves</li>'); for (let i = 0; i < L.reserve; i++) rows.push(mk(L.playing + i + 1, sq.reserve[i])); }
  return rows.join('');
}
function sheetCard(sport, teamId) {
  const sq = squadOf(D.pub.participants, sport, teamId), L = lim(sport), filled = sq.playing.length + sq.reserve.length;
  return `<div class="sheet"><header><b>${sport === 'cricket' ? 'Cricket · Men' : 'Badminton · Women’s doubles'}</b><span>${filled} of ${L.playing + L.reserve} named</span></header><ol>${slotList(sport, sq)}</ol></div>`;
}
function datesHTML() {
  const nd = nextDate();
  return `<div class="dts">${(CFG.DATES || []).map(x => { const dd = daysTo(x.d), cls = nd && nd.d === x.d ? 'next' : (dd < 0 ? 'past' : ''), d = new Date(x.d);
    return `<div class="dt ${cls}"><div class="d"><b>${String(d.getDate()).padStart(2, '0')}</b><span>${d.toLocaleDateString('en-IN', { month: 'short' })}</span></div><p>${esc(x.t)}${cls === 'next' ? `<br><span class="chip gold">${dd === 0 ? 'today' : dd + ' days left'}</span>` : ''}</p></div>`; }).join('')}</div>`;
}
function noticeCard(n) { return `<article class="card"><h3>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3><p class="muted small">${fmtDate(n.created_at)}${n.team_id ? ' · ' + esc(tname(n.team_id)) : ' · Bengaluru Circle'}</p><p style="white-space:pre-wrap">${esc(n.body)}</p></article>`; }
function circleXV() {
  const l = D.pub.participants.filter(x => x.circle_pick && x.sport === 'cricket').sort(capFirst);
  if (!l.length) return '';
  return `<section><div class="sec-h"><div><h2>Circle XV</h2><p>Top 15 picked from Inter-RO matches to represent the Circle</p></div><span class="chip gold">${l.length} of 15</span></div>
  <div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>RO / office</th><th>Branch</th></tr></thead><tbody>${l.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.full_name)}${x.is_captain ? ' <b style="color:var(--gold)">(C)</b>' : ''}</td><td>${esc(tname(x.team_id))}</td><td>${esc(x.branch_name)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
/* While trials are pending an RO shows every nomination; once its squad is named it shows only the final list (per sport). */
function finalised(list, sport, teamId) { return list.some(x => x.sport === sport && x.team_id === teamId && (x.status === 'playing' || x.status === 'reserve')); }
function visibleNoms(list) {
  const done = {}; list.forEach(x => { if (x.status === 'playing' || x.status === 'reserve') done[x.team_id + '|' + x.sport] = 1; });
  return list.filter(x => !done[x.team_id + '|' + x.sport] || x.status === 'playing' || x.status === 'reserve');
}
function listNote(list, sport, teamId) {
  const ts = teamId ? [T(teamId)].filter(Boolean) : teamsList();
  const fin = ts.filter(t => finalised(list, sport, t.id)).length;
  return fin ? `<p class="small muted" style="margin:0 0 8px">${teamId ? 'Final squad announced after trials.' : fin + ' of ' + ts.length + ' ROs have announced their final squad (shown below). The rest show all nominations until trials are over.'}</p>` : `<p class="small muted" style="margin:0 0 8px">All nominations received so far are listed. The final list appears here after trials.</p>`;
}
const coName = id => { const t = T(id), c = t && D.pub.circles.find(c => c.id === t.circle_id); return c ? c.name : ''; };
function nomTable(list) {
  return list.length ? `<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Cadre</th><th>Branch / unit</th><th>RO / office</th><th>CO</th><th>Sport</th><th>Status</th></tr></thead><tbody>${list.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.full_name)}${x.is_captain ? ' <b style="color:var(--gold)">(C)</b>' : ''}</td><td>${esc(x.designation || '')}</td><td>${esc(x.branch_name)}</td><td>${esc(tname(x.team_id))}</td><td>${esc(coName(x.team_id))}</td><td>${x.sport === 'cricket' ? 'Cricket' : 'Badminton'}</td><td>${chip(x.sport, x.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No entries to show.</p>';
}
const statusBanners = () => (!configured ? '<div class="banner warn">App is not configured yet. Add your Supabase URL and anon key in <b>config.js</b>.</div>' : '') +
  (D.setupError ? '<div class="banner bad">Database tables for v2 were not found. Run <b>schema_v2.sql</b> in the Supabase SQL Editor.</div>' : '') +
  (D.fromCache && D.lastSync ? `<div class="banner info">Showing saved data from ${new Date(D.lastSync).toLocaleString('en-IN')}. It refreshes when you are online.</div>` : '');

/* ---------------- share links ---------------- */
function baseUrl() {
  const c = String(CFG.APP_URL || '');
  if (c && !/YOUR-USERNAME/i.test(c)) return c.replace(/#.*$/, '').replace(/\/?$/, '/');
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}
const linkHome = id => baseUrl() + '#/' + (id ? 'team/' + id : '');
const linkNominate = id => baseUrl() + '#/nominate' + (id ? '/' + id : '');
const myRO = () => { try { return localStorage.getItem('cpl_myro') || ''; } catch { return ''; } };
function followCard(teams, P) {
  const id = myRO(), t = id && T(id);
  const pick = `<select id="roPick" aria-label="Select your RO"><option value="">Select your RO / office</option>${teams.map(x => `<option value="${esc(x.id)}" ${id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  let mid = '<p class="small muted" style="margin:6px 0 0">Choose once. This phone remembers it, and the home page then opens straight to your RO.</p>';
  if (t) {
    const c = squadOf(P, 'cricket', t.id), b = squadOf(P, 'badminton', t.id), cn = P.filter(x => x.team_id === t.id && x.sport === 'cricket').length, bn = P.filter(x => x.team_id === t.id && x.sport === 'badminton').length;
    mid = `<div class="row" style="margin-top:10px"><span class="chip">Cricket: ${cn} nominated · ${c.playing.length}/${CFG.CRICKET_PLAYING} named</span><span class="chip">Badminton: ${bn} nominated · ${b.playing.length}/${CFG.BADMINTON_TEAM} named</span></div>
    <div class="row" style="margin-top:12px"><a class="btn gold" href="#/nominate/${esc(t.id)}">Nominate for ${esc(t.name)}</a><a class="btn ghost" href="#/team/${esc(t.id)}">View ${esc(t.name)} team</a></div>`;
  }
  return `<section class="follow"><div class="card"><div class="sec-h" style="margin-bottom:8px"><div><h2 style="margin:0">Follow your RO</h2><p>Register and get updates for your own RO / office.</p></div>${pick}</div>${mid}</div></section>`;
}
function guideCard() {
  return `<section><div class="card guide"><h3>How access works</h3><div class="steps">
    <div><b>1 · Staff</b><span>Open the link, choose your RO, nominate. No login needed.</span></div>
    <div><b>2 · RO admin</b><span>Signs in to select the RO team, record trials, post notices and message branches.</span></div>
    <div><b>3 · Sub CO admin</b><span>Circle Office login. <u>Creates the RO admin profile</u> for each RO of the circle and oversees all of them.</span></div></div></div></section>`;
}

/* ---------------- pages ---------------- */
function pageHome() {
  const P = D.pub.participants, teams = teamsList();
  const ready = teams.filter(t => squadOf(P, 'cricket', t.id).playing.length >= CFG.CRICKET_PLAYING).length;
  const fx = D.pub.fixtures.filter(f => !D.circle || f.circle_id === D.circle);
  const played = fx.filter(f => f.winner).length, nd = nextDate();
  const circleName = (D.pub.circles.find(c => c.id === D.circle) || {}).name || 'Bengaluru Circle';
  return `
  <div class="hero"><div class="beams" aria-hidden="true"><i></i><i></i></div><div class="parts" aria-hidden="true">${particles(22)}</div><div class="hscene" aria-hidden="true"><div class="hs a">${cricketScene()}</div><div class="hs b">${badmintonScene()}</div></div><div class="wrap">
    <h1>Canara Premier League 4.0</h1>
    <p class="lead">Cricket for men, badminton for women. ${teams.length} teams from ${esc(circleName)} play for one trophy.</p>
    <div class="row"><a class="btn gold" href="#/nominate">Nominate now</a><a class="btn light" href="#/fixtures">See the bracket</a><button class="btn light" type="button" data-share>Share</button></div>
    <div class="board">
      <div class="cell">${digits(ready)}<span>Cricket squads complete of ${teams.length}</span></div>
      <div class="cell">${digits(P.filter(x => x.sport === 'cricket').length, 3)}<span>Cricket nominations</span></div>
      <div class="cell">${digits(P.filter(x => x.sport === 'badminton').length, 3)}<span>Badminton nominations</span></div>
      <div class="cell">${digits(played)}<span>Matches played of ${fx.length}</span></div>
    </div>
  </div></div>
  ${tickerHTML()}
  <div class="wrap">
  ${statusBanners()}
  ${arenaHTML(teams, P)}
  ${followCard(teams, P)}
  <section><div class="sec-h"><div><h2>Squad board</h2><p>Every RO fields its own team. The ring fills as players are named and turns gold when the squad is complete.</p></div>${sportToggle()}</div>${squadBoard(D.sport)}</section>
  <section><div class="sec-h"><div><h2>Knock-out bracket</h2><p>Winners move ahead automatically.</p></div>${sportToggle()}</div>${bracketHTML(D.sport)}</section>
  ${circleXV()}
  ${D.pub.notices.length ? `<section><div class="sec-h"><h2>Notices</h2><a href="#/notices">All notices</a></div><div class="grid g2">${D.pub.notices.slice(0, 4).map(noticeCard).join('')}</div></section>` : ''}
  <section><div class="sec-h"><div><h2>Who has nominated</h2><p>Staff number and mobile number are never shown.</p></div>
    <div class="row">${sportToggle()}<select id="tf" style="max-width:220px"><option value="">All ROs</option>${teams.map(t => `<option value="${esc(t.id)}" ${D.teamF === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <input type="search" id="pq" placeholder="Search name or branch" style="max-width:240px" value="${esc(D.q)}"></div></div><div id="pboard"></div><p style="margin-top:12px"><button class="btn ghost sm" data-req="">Nominated but not listed, or something wrong? Tell your RO admin</button></p></section>
  ${guideCard()}
  </div>`;
}
function renderBoard() {
  const el = $('#pboard'); if (!el) return;
  const q = D.q.toLowerCase();
  const base = D.pub.participants.filter(x => x.sport === D.sport && (!D.teamF || x.team_id === D.teamF));
  el.innerHTML = listNote(D.pub.participants.filter(x => x.sport === D.sport), D.sport, D.teamF) + nomTable(visibleNoms(base).filter(x => !q || (x.full_name + ' ' + x.branch_name).toLowerCase().includes(q)));
}
function pageTeams() {
  return `<div class="wrap" style="padding-top:26px">${statusBanners()}<div class="sec-h"><div><h1 style="font-size:clamp(2rem,5vw,3rem)">Teams</h1><p>Open an RO to see its team sheet, nominations and fixtures.</p></div>${sportToggle()}</div>${squadBoard(D.sport)}<div style="height:30px"></div>${circleXV()}</div>`;
}
function pageTeam(id) {
  const t = T(id);
  if (!t) return `<div class="wrap" style="padding-top:26px"><p class="muted">Team not found.</p><a href="#/teams">Back to teams</a></div>`;
  const P = D.pub.participants.filter(x => x.team_id === id), bl = branchesOf(id);
  const mineFx = ['cricket', 'badminton'].map(s => ({ s, l: resolvedFx(s).filter(f => f.a === id || f.b === id || f.team_a === id || f.team_b === id) }));
  const bcount = bl.map(b => ({ b, c: P.filter(x => x.dp_code === b.dp_code).length })).filter(x => x.c);
  return `<div class="hero" style="margin-bottom:26px"><div class="wrap" style="padding-top:28px;padding-bottom:26px"><a href="#/teams" style="color:#B9C7DD;font-size:.9rem">‹ All teams</a><h1 style="font-size:clamp(2.2rem,6vw,3.4rem);margin:6px 0">${esc(t.name)}</h1><p class="lead" style="margin-bottom:14px">${t.kind === 'CO' ? 'Circle Office' : 'Regional Office'} team · ${P.filter(x => x.sport === 'cricket').length} cricket and ${P.filter(x => x.sport === 'badminton').length} badminton nominations</p><a class="btn gold" href="#/nominate/${esc(id)}">Nominate for ${esc(t.name)}</a></div></div>
  <div class="wrap">${statusBanners()}
  <div class="sec-h"><h2>Team sheet</h2>${sportToggle()}</div>
  <div class="split"><div>${sheetCard(D.sport, id)}<h3 style="margin-top:20px">${finalised(P, D.sport, id) ? 'Final squad' : 'Nominations'}</h3>${listNote(P, D.sport, id)}${nomTable(visibleNoms(P.filter(x => x.sport === D.sport)))}<p style="margin-top:10px"><button class="btn ghost sm" data-req="${esc(id)}">Not listed or something wrong? Tell your RO admin</button></p></div>
  <div><h3>Fixtures</h3>${mineFx.map(({ s, l }) => `<div class="card" style="margin-bottom:12px"><h4>${s === 'cricket' ? 'Cricket' : 'Badminton'}</h4>${l.length ? l.map(f => { const opp = f.a === id || f.team_a === id ? (f.b || null) : (f.a || null); const oppSrc = (f.team_a === id || f.a === id) ? f.src_b : f.src_a; return `<p class="small" style="margin-bottom:6px"><b>M${f.match_no}</b> vs ${opp ? esc(tname(opp)) : (oppSrc ? 'Winner of M' + oppSrc : 'TBD')}${f.winner ? ` · <span class="chip ${f.winner === id ? 'playing' : ''}">${f.winner === id ? 'Won' : 'Lost'}</span>` : ''}<br><span class="muted">${esc([f.match_date && fmtShort(f.match_date), f.match_time, f.venue].filter(Boolean).join(' · ') || 'Date to be announced')}</span></p>`; }).join('') : '<p class="muted small">No fixture listed.</p>'}</div>`).join('')}
  <h3>Branches nominated</h3>${bl.length ? (bcount.length ? `<div class="tw"><table class="tbl"><tbody>${bcount.map(x => `<tr><td>${esc(x.b.branch_name)}</td><td class="num">${x.c}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin-top:6px">${bl.length - bcount.length} of ${bl.length} branches yet to nominate.</p>` : `<p class="muted small">None of the ${bl.length} branches has nominated yet.</p>`) : '<p class="muted small">Branch list for this RO has not been added yet.</p>'}
  ${D.pub.notices.filter(n => n.team_id === id).map(noticeCard).join('')}</div></div></div>`;
}
function pageFixtures() {
  const l = resolvedFx(D.sport);
  return `<div class="wrap" style="padding-top:26px">${statusBanners()}<div class="sec-h"><div><h1 style="font-size:clamp(2rem,5vw,3rem)">Fixtures</h1><p>Knock-out format. Winner of each match moves to the next.</p></div>${sportToggle()}</div>
  ${D.pub.circles.length > 1 ? `<div class="scope"><select id="circSel">${D.pub.circles.map(c => `<option value="${esc(c.id)}" ${c.id === D.circle ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
  ${bracketHTML(D.sport)}
  <h2 style="margin-top:28px">All matches</h2>
  <div class="tw"><table class="tbl"><thead><tr><th>Match</th><th>Team A</th><th>Team B</th><th>When</th><th>Venue</th><th>Result</th></tr></thead><tbody>${l.map(f => `<tr><td><b>M${f.match_no}</b></td><td>${f.a ? esc(tname(f.a)) : '<span class="muted">Winner of M' + f.src_a + '</span>'}</td><td>${f.b ? esc(tname(f.b)) : '<span class="muted">Winner of M' + f.src_b + '</span>'}</td><td>${esc([f.match_date && fmtShort(f.match_date), f.match_time].filter(Boolean).join(' · ') || 'TBA')}</td><td>${esc(f.venue || '')}</td><td>${f.winner ? `<b>${esc(tname(f.winner))}</b>${f.result_note ? ' · ' + esc(f.result_note) : ''}` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function pageNominate(pre) {
  const t = T(pre || myRO());
  return `<div class="wrap" style="padding-top:26px">${statusBanners()}<div class="split">
  <div><h1 style="font-size:clamp(2rem,5vw,3rem)">Nominate for CPL 4.0</h1><p class="muted">Pick your RO, then your branch.</p>
  <div id="doneBox"></div>
  <form id="nomForm" class="card" novalidate><div class="form">${entryFields(null, { defaultTeam: t ? t.id : '' })}
    <div class="field full"><label class="chk"><input type="checkbox" id="decl"><span id="declText"></span></label></div></div>
    <div class="row" style="margin-top:16px"><button class="btn gold" type="submit" id="subBtn">Submit nomination</button><span class="hint">Works offline too. It is sent automatically when internet returns.</span></div></form></div>
  <aside class="card"><h3>What happens next</h3>
    <p class="small"><b>1.</b> Your nomination reaches your RO admin.</p>
    <p class="small"><b>2.</b> The RO holds trials if needed and names its team.</p>
    <p class="small"><b>3.</b> The final list appears on the home page. Only your name, cadre, branch and RO are shown. Staff number and mobile stay private.</p>
    <p class="small">Not listed after nominating, or a detail is wrong? Use <b>Tell your RO admin</b> on the home page.</p></aside></div></div>`;
}
function bindNominate() {
  const form = $('#nomForm'); if (!form) return;
  bindEntryForm(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const { r, miss } = readEntry(form);
    if (miss.length) { toast('Please check: ' + miss.join(', '), true); return; }
    if (!$('#decl').checked) { toast('Please tick the declaration', true); return; }
    $('#subBtn').disabled = true;
    try {
      const res = await submitEntry(r, false), box = $('#doneBox'), tn = tname(r.team_id);
      if (res === 'sent') { box.innerHTML = `<div class="banner ok"><b>Nomination received.</b> ${esc(r.full_name)} is registered for ${SPORT[r.sport]} under ${esc(tn)}. Selection will follow after trials.</div>`; form.reset(); bindEntryForm(form); loadPublic(); }
      else if (res === 'queued') { box.innerHTML = `<div class="banner info"><b>Saved on this phone.</b> You are offline, so it will be submitted automatically when internet is back. Keep this app installed.</div>`; form.reset(); bindEntryForm(form); }
      else box.innerHTML = `<div class="banner warn"><b>Already registered.</b> Staff number ${esc(r.staff_no)} is already nominated for ${SPORT[r.sport]}.</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { toast('Could not submit: ' + err.message, true); }
    $('#subBtn').disabled = false;
  });
}
function pageNotices() { const n = D.pub.notices; return `<div class="wrap" style="padding-top:26px">${statusBanners()}<h1 style="font-size:clamp(2rem,5vw,3rem)">Notices</h1>${n.length ? `<div class="grid">${n.map(noticeCard).join('')}</div>` : '<p class="muted">No notices yet.</p>'}</div>`; }

/* ---------------- share sheet (own dialog; never depends on the browser share API) ---------------- */
function openShare() {
  const url = baseUrl(), msg = `CPL 4.0 - Canara Premier League, Bengaluru Circle.\nNominate and follow squads, fixtures and results here:\n${url}`;
  const m = openModal(`<h2>Share CPL 4.0</h2><p class="small muted">Send this link to colleagues. They can nominate and follow progress from it.</p>
    <div class="linkrow"><input readonly id="shU" value="${esc(url)}"><button class="btn ghost sm" id="shC" type="button">Copy</button></div>
    <div class="row" style="margin-top:14px"><a class="btn gold" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>${navigator.share ? '<button class="btn ghost" id="shM" type="button">More apps</button>' : ''}<button class="btn ghost" id="shX" type="button">Close</button></div>`);
  $('#shX', m).onclick = closeModal;
  $('#shC', m).onclick = async () => { const i = $('#shU', m); try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { i.focus(); i.select(); try { document.execCommand('copy'); toast('Link copied'); } catch (e2) { toast('Press and hold the link to copy', true); } } };
  const more = $('#shM', m); if (more) more.onclick = async () => { try { await navigator.share({ title: 'CPL 4.0', text: msg, url }); } catch (e) { /* cancelled or unsupported */ } };
}

/* ---------------- correction / missing-name request ---------------- */
function openRequest(teamId) {
  const m = openModal(`<h2>Tell your RO admin</h2><p class="small muted">Use this if you nominated but your name is not in the list, or a detail needs correcting, or you want to withdraw. Your RO admin, Sub CO admin and the organisers will see it.</p>
  <form id="rqf" class="form" style="grid-template-columns:1fr" novalidate>
    <div class="field"><label>Issue</label><select name="kind"><option value="missing">I nominated but I am not listed</option><option value="correction">Correct my details</option><option value="withdraw">Withdraw my nomination</option></select></div>
    <div class="field"><label>RO / office</label><select name="team_id"><option value="">Select</option>${teamsList().map(t => `<option value="${esc(t.id)}" ${t.id === (teamId || myRO()) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Sport</label><select name="sport"><option value="cricket">Cricket</option><option value="badminton">Badminton</option></select></div>
    <div class="field"><label>Your name</label><input name="full_name" type="text" maxlength="80" required></div>
    <div class="field"><label>Staff number</label><input name="staff_no" type="tel" inputmode="numeric" maxlength="8"></div>
    <div class="field"><label>WhatsApp number</label><input name="contact" type="tel" inputmode="numeric" maxlength="10"></div>
    <div class="field"><label>What should be corrected?</label><textarea name="message" maxlength="500" style="min-height:80px"></textarea></div>
    <div class="row"><button class="btn gold" type="submit">Send</button><button class="btn ghost" type="button" id="rqx">Cancel</button></div></form>`);
  $('#rqx', m).onclick = closeModal;
  $('#rqf', m).onsubmit = async e => {
    e.preventDefault(); const f = e.target.elements, v = n => f[n].value.trim();
    if (!v('team_id') || v('full_name').length < 2) return toast('RO and your name are required', true);
    if (v('staff_no') && !/^\d{3,8}$/.test(v('staff_no'))) return toast('Staff number must be 3-8 digits', true);
    if (v('contact') && !/^\d{10}$/.test(v('contact'))) return toast('Number must be 10 digits', true);
    if (!navigator.onLine) return toast('Internet is needed to send this request', true);
    try { await sb.req('cpl_requests', { method: 'POST', body: { team_id: v('team_id'), sport: v('sport'), kind: v('kind'), full_name: v('full_name'), staff_no: v('staff_no') || null, contact: v('contact') || null, message: v('message') || null }, prefer: 'return=minimal', anon: true }); closeModal(); toast('Sent. Your RO admin will look into it.'); }
    catch (err) { toast('Could not send: ' + err.message, true); }
  };
}
document.addEventListener('click', async e => {
  const pk = e.target.closest && e.target.closest('[data-pick]'); if (pk) D.sport = pk.dataset.pick;
  const b = e.target.closest && e.target.closest('[data-req]'); if (b) return openRequest(b.dataset.req);
  const sh = e.target.closest && e.target.closest('[data-share]'); if (sh) { try { openShare(); } catch (err) { toast('Could not open share. Copy the link from the address bar.', true); } }
});
document.addEventListener('pointermove', e => {
  const c = e.target.closest && e.target.closest('.sport-card');
  document.querySelectorAll('.sport-card.tilt').forEach(x => { if (x !== c) { x.classList.remove('tilt'); x.style.removeProperty('--rx'); x.style.removeProperty('--ry'); } });
  if (c && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { const r = c.getBoundingClientRect(); c.classList.add('tilt'); c.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 7).toFixed(2) + 'deg'); c.style.setProperty('--rx', ((.5 - (e.clientY - r.top) / r.height) * 5).toFixed(2) + 'deg'); } const t = e.target.closest && e.target.closest('.tile, article.card'); if (!t) return; const r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); });

/* ---------------- router ---------------- */
const CPL = { CFG, configured, $, $$, esc, fmtDate, fmtShort, SPORT, statusLabel, chip, idb, sb, D, toast, openModal, closeModal, loadPublic, flushQueue, updatePending, entryFields, bindEntryForm, readEntry, submitEntry,
  squadOf, capFirst, baseUrl, linkHome, linkNominate, nextDate, daysTo, lim, pips, teamsList, T, tname, branchesOf, resolvedFx, bracketHTML, champion, pages: {}, route: keep => route(keep) };
window.CPL = CPL;
document.documentElement.classList.add('js');
async function route(keep) {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, sub] = h.split('/');
  const app = $('#app');
  $$('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + (page || '')));
  const y = window.scrollY;
  if (page === 'admin') {
    if (CPL.pages.admin) await CPL.pages.admin(sub || 'dashboard', app); else app.innerHTML = '<div class="wrap"><p>Loading…</p></div>';
    if (!keep) window.scrollTo(0, 0); return;
  }
  if (!D.loaded) { app.innerHTML = '<div class="wrap" style="padding-top:30px"><p class="muted">Loading…</p></div>'; await loadPublic(); }
  if (page === 'nominate') { app.innerHTML = pageNominate(sub); bindNominate(); }
  else if (page === 'notices') app.innerHTML = pageNotices();
  else if (page === 'teams') app.innerHTML = pageTeams();
  else if (page === 'team') app.innerHTML = pageTeam(sub);
  else if (page === 'fixtures') { app.innerHTML = pageFixtures(); const cs = $('#circSel'); if (cs) cs.onchange = () => { D.circle = cs.value; route(true); }; }
  else {
    app.innerHTML = pageHome(); renderBoard(); animateCounts(app); reveal(app);
    const q = $('#pq'); if (q) q.addEventListener('input', () => { D.q = q.value; renderBoard(); });
    const rp = $('#roPick'); if (rp) rp.addEventListener('change', () => { try { localStorage.setItem('cpl_myro', rp.value); } catch { } route(true); });
    const tf = $('#tf'); if (tf) tf.addEventListener('change', () => { D.teamF = tf.value; renderBoard(); });
  }
  bindSport(app);
  window.scrollTo(0, keep ? y : 0);
}
window.addEventListener('hashchange', () => route());
window.addEventListener('online', async () => { updateNet(); await flushQueue(); await loadPublic(); if (!location.hash.startsWith('#/admin')) route(true); });
window.addEventListener('offline', updateNet);
document.addEventListener('DOMContentLoaded', async () => {
  (function themeBtn() {
    const bar = $('.top .wrap'), net = $('#netPill'); if (!bar) return;
    const cur = () => (document.documentElement.getAttribute('data-theme') === 'emerald' ? 'emerald' : 'canara');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'themebtn'; b.id = 'themeBtn';
    const paint = () => { b.innerHTML = '<i></i>' + (cur() === 'canara' ? 'Canara' : 'Emerald'); b.title = 'Switch colour theme'; b.setAttribute('aria-label', 'Switch colour theme, now ' + cur()); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', cur() === 'canara' ? '#04193A' : '#0B3B2E'); };
    b.onclick = () => { const next = cur() === 'canara' ? 'emerald' : 'canara'; if (next === 'emerald') document.documentElement.setAttribute('data-theme', 'emerald'); else document.documentElement.removeAttribute('data-theme'); try { localStorage.setItem('cpl_theme', next); } catch { } paint(); };
    bar.insertBefore(b, net || null); paint();
  })();
  $('#pendPill').addEventListener('click', () => flushQueue(true));
  updateNet(); await updatePending(); await loadPublic(); route(); flushQueue();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
});
})();

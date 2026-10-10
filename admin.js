(() => {
'use strict';
const { CFG, configured, $, $$, esc, fmtDate, fmtShort, SPORT, statusLabel, idb, sb, D, toast, openModal, closeModal, flushQueue, updatePending, entryFields, bindEntryForm, readEntry, submitEntry, squadOf, lim, pips, teamsList: allTeams, baseUrl, linkHome, linkNominate, T, tname, resolvedFx, loadPublic, nextDate, daysTo } = window.CPL;

let A = null, curSub = 'dashboard', curTeam = localStorage.getItem('cpl_scope') || '', FS = 'cricket';
const F = { sport: '', status: '', q: '' };
const STATUSES = ['nominated', 'playing', 'reserve', 'not_selected', 'withdrawn'];
const CHECKLIST = [
  ['sel', 'Nominations shortlisted (trials held if more than 15 for cricket / 2 for badminton)'],
  ['data', 'Entry forms / squad data shared with Circle Office SPOC in prescribed format'],
  ['ground', 'Ground / courts booked for Inter-RO matches'],
  ['ump', 'Neutral umpires and independent scorer engaged'],
  ['brand_req', 'Branding material requested from HO Publicity Material Desk (Cannet)'],
  ['brand_up', 'Canara branding displayed (boundaries, scoreboard, audience area / arena)'],
  ['wear', 'Bank-issued sportswear arranged for players'],
  ['food', 'Refreshments arranged for players and customers'],
  ['cust', 'Special invitation extended to customers'],
  ['troph', 'Trophy procured from local vendor'],
  ['exp', 'Expenditure sanctioned within delegated powers'],
  ['cult', 'Cultural activity coordinated with HRM Section']
];

/* ---------- data + roles ---------- */
const db = {
  patch: (t, f, b) => sb.req(`${t}?${f}`, { method: 'PATCH', body: b, prefer: 'return=minimal' }),
  insert: (t, b) => sb.req(t, { method: 'POST', body: b, prefer: 'return=minimal' }),
  upsert: (t, b, on) => sb.req(t + (on ? '?on_conflict=' + on : ''), { method: 'POST', body: b, prefer: 'resolution=merge-duplicates,return=minimal' }),
  del: (t, f) => sb.req(`${t}?${f}`, { method: 'DELETE', prefer: 'return=minimal' })
};
const online = () => { if (!navigator.onLine) { toast('Internet is required for this action', true); return false; } return true; };
const isSuper = () => !!(A && A.me && A.me.role === 'super');
const isCircle = () => !!(A && A.me && A.me.role === 'circle');
const wide = () => isSuper() || isCircle();               // sees more than one RO
const myCircleId = () => { const t = A && A.me && A.me.team_id && T(A.me.team_id); return t ? t.circle_id : ''; };
const teamsList = () => (isCircle() ? allTeams().filter(t => t.circle_id === myCircleId()) : allTeams());   // teams this admin may handle
const roleLabel = r => ({ super: 'Super admin', circle: 'Sub CO admin', coordinator: 'RO admin' }[r] || r);
const scopeTeam = () => (wide() ? curTeam : (A.me && A.me.team_id) || '');
const scopeTeams = () => (scopeTeam() ? [T(scopeTeam())].filter(Boolean) : teamsList());
const inScope = x => !scopeTeam() || x.team_id === scopeTeam();
const myParts = () => A.participants.filter(inScope);

async function loadAdmin() {
  try {
    const [adm, p, b, n, s, rq] = await Promise.all([
      sb.req('cpl_admins?select=*'), sb.req('cpl_participants?select=*&order=created_at.asc'),
      sb.req('cpl_branches?select=*&order=sort_order.asc,branch_name.asc'), sb.req('cpl_notices?select=*&order=pinned.desc,created_at.desc'), sb.req('cpl_settings?select=*'),
      sb.req('cpl_requests?select=*&order=created_at.desc').catch(() => [])
    ]);
    const me = adm.find(r => r.email.toLowerCase() === String(sb.session.email || '').toLowerCase()) || null;
    A = { admins: adm, me, requests: rq || [], participants: p, branches: b, notices: n, settings: Object.fromEntries((s || []).map(x => [x.key, x.value])), fromCache: false };
    await idb.set('adm2', A); await loadPublic();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { sb.logout(); A = null; try { await idb.set('adm2', null); } catch (e2) { /* ignore */ } return 'auth'; }
    const c = await idb.get('adm2');
    A = c ? Object.assign(c, { fromCache: true }) : { admins: [], me: null, participants: [], branches: [], notices: [], settings: {}, requests: [], fromCache: true };
  }
}
async function reload(msg) { if (!online()) return; await loadAdmin(); if (!A) return renderAdmin(curSub, $('#app')); if (curSub === 'requests') renderAdmin(curSub, $('#app')); else drawTab(); if (msg) toast(msg); }

/* ---------- shell ---------- */
async function renderAdmin(sub, app) {
  curSub = sub;
  if (!configured) { app.innerHTML = '<div class="wrap" style="padding-top:26px"><div class="banner warn">Add your Supabase URL and anon key in <b>config.js</b> first.</div></div>'; return; }
  if (!sb.session) return renderLogin(app);
  if (!A) { app.innerHTML = '<div class="wrap" style="padding-top:26px"><p class="muted">Loading admin data…</p></div>'; if ((await loadAdmin()) === 'auth') return renderLogin(app, 'Session expired. Please sign in again.'); }
  if (!A.me) { app.innerHTML = `<div class="wrap" style="padding-top:26px"><div class="banner bad"><b>No access.</b> ${esc(sb.session.email || '')} is signed in but no admin profile exists for it yet. Ask your Sub CO admin (Circle Office) to create it.</div><button class="btn ghost" id="outBtn">Sign out</button></div>`; $('#outBtn').onclick = async () => { sb.logout(); A = null; try { await idb.set('adm2', null); } catch (e) { /* ignore */ } window.CPL.route(); }; return; }
  if (!wide() && curSub === 'setup') curSub = 'dashboard';
  const tabs = [['dashboard', 'Dashboard'], ['participants', 'Participants'], ['requests', 'Requests' + ((A.requests || []).filter(r => r.status === 'open').length ? ' (' + A.requests.filter(r => r.status === 'open').length + ')' : '')], ['fixtures', 'Fixtures'], ['notices', 'Notices'], ['communicate', 'Communicate'], ['reports', 'Reports'], ['branches', 'Branches']].concat(wide() ? [['setup', isSuper() ? 'Teams & admins' : 'RO admins']] : []);
  const myTeam = A.me.team_id ? tname(A.me.team_id) : '';
  app.innerHTML = `<div class="wrap" style="padding-top:22px">
  <div class="row" style="justify-content:space-between;margin-bottom:14px"><div><h1 style="font-size:2.2rem;margin:0">Admin</h1><span class="small muted">${esc(A.me.name || sb.session.email)} · ${roleLabel(A.me.role)}${isSuper() ? '' : ', ' + esc(myTeam)}</span></div>
    <div class="row"><button class="btn ghost sm" id="refBtn">Refresh data</button><button class="btn ghost sm" id="pwBtn">Change password</button><button class="btn ghost sm" id="outBtn">Sign out</button></div></div>
  ${A.fromCache ? '<div class="banner warn">Offline or unreachable: showing last saved admin data. Changes need internet.</div>' : ''}
  <div class="tabs">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${k === curSub ? 'on' : ''}">${l}</a>`).join('')}</div>
  ${wide() && curSub !== 'setup' ? `<div class="scope"><span class="small muted">Viewing</span><select id="scopeSel"><option value="">${isCircle() ? 'All ROs of my circle' : 'All ROs / offices'}</option>${teamsList().map(t => `<option value="${esc(t.id)}" ${curTeam === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
  <div id="tab"></div></div>`;
  $('#refBtn').onclick = () => reload('Data refreshed');
  $('#pwBtn').onclick = changePw;
  $('#outBtn').onclick = async () => { sb.logout(); A = null; try { await idb.set('adm2', null); } catch (e) { /* ignore */ } location.hash = '#/admin'; window.CPL.route(); };
  const ss = $('#scopeSel'); if (ss) ss.onchange = () => { curTeam = ss.value; localStorage.setItem('cpl_scope', curTeam); drawTab(); };
  drawTab();
}
function drawTab() { const t = $('#tab'); if (!t) return; ({ dashboard, participants, requests, fixtures, notices, communicate, reports, branches, setup }[curSub] || dashboard)(t); }
function renderLogin(app, msg) {
  app.innerHTML = `<div class="wrap"><div class="card" style="max-width:420px;margin:40px auto"><h2>Admin sign in</h2><p class="muted small">Sub CO admin and RO admin login.</p>
    ${msg ? `<div class="banner warn">${esc(msg)}</div>` : ''}
    <form id="loginForm" class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn" type="submit">Sign in</button></form>
    <p class="hint" style="margin-top:10px">Sign-in needs internet. After that, data stays readable offline.</p></div>
    <div class="card guide" style="max-width:420px;margin:0 auto 40px"><h3>How logins work</h3><div class="steps one">
      <div><b>Sub CO admin</b><span>creates the <u>RO admin</u> profile for every RO of the circle (Admin &rarr; RO admins &rarr; Add RO admin).</span></div>
      <div><b>RO admin</b><span>manages only their own RO: team, trials, notices, branch messages.</span></div></div></div></div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!online()) return;
    try { await sb.login($('#em').value.trim(), $('#pw').value); A = null; window.CPL.route(); } catch (err) { toast(err.message, true); }
  });
}

function changePw() {
  const m = openModal(`<h2>Change password</h2><form id="pwf" class="form" style="grid-template-columns:1fr"><div class="field"><label>New password (min 8 characters)</label><input name="pw" type="text" minlength="8" autocomplete="new-password" required></div>
    <div class="row"><button class="btn gold" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  $('#cx', m).onclick = closeModal;
  $('#pwf', m).onsubmit = async e => { e.preventDefault(); if (!online()) return; const v = e.target.elements.pw.value; if (v.length < 8) return toast('Minimum 8 characters', true); try { await sb.changePassword(v); closeModal(); toast('Password changed'); } catch (err) { toast(err.message, true); } };
}

/* ---------- requests (corrections raised by staff on the public page) ---------- */
const RQ_KIND = { missing: 'Nominated but not listed', correction: 'Correct my details', withdraw: 'Withdraw nomination' };
function requests(t) {
  const l = (A.requests || []).filter(r => !scopeTeam() || r.team_id === scopeTeam()), open = l.filter(r => r.status === 'open');
  t.innerHTML = `<div class="sec-h"><div><h2>Requests from staff</h2><p>Raised from the public page. Fix the entry in Participants, then mark done.</p></div><span class="chip ${open.length ? 'gold' : ''}">${open.length} open</span></div>
  ${l.length ? l.map(r => `<article class="card" style="margin-bottom:10px;${r.status === 'done' ? 'opacity:.6' : ''}"><div class="row" style="justify-content:space-between"><b>${esc(r.full_name)}</b><span class="chip ${r.status === 'open' ? 'gold' : ''}">${r.status === 'open' ? esc(RQ_KIND[r.kind] || r.kind) : 'Done'}</span></div>
    <p class="small muted" style="margin:4px 0">${esc(tname(r.team_id))} · ${r.sport ? SPORT[r.sport] : ''} · ${fmtDate(r.created_at)}${r.staff_no ? ' · Staff no. ' + esc(r.staff_no) : ''}${r.contact ? ' · ' + esc(r.contact) : ''}</p>
    ${r.message ? `<p style="white-space:pre-wrap;margin:6px 0">${esc(r.message)}</p>` : ''}
    <div class="row" data-id="${esc(r.id)}">${r.contact ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/91${esc(r.contact)}">WhatsApp</a>` : ''}<button class="btn ghost sm" data-find="${esc(r.staff_no || r.full_name)}">Find in Participants</button>${r.status === 'open' ? '<button class="btn sm" data-done>Mark done</button>' : '<button class="btn ghost sm" data-reopen>Reopen</button>'}<button class="btn ghost sm" data-rdel>Delete</button></div></article>`).join('') : '<p class="muted">No requests.</p>'}`;
  $$('[data-find]', t).forEach(b => b.onclick = () => { F.q = b.dataset.find; F.sport = ''; F.status = ''; location.hash = '#/admin/participants'; });
  const setS = (b, st) => async () => { if (!online()) return; try { await db.patch('cpl_requests', 'id=eq.' + b.closest('[data-id]').dataset.id, { status: st }); await reload(); } catch (e) { toast(e.message, true); } };
  $$('[data-done]', t).forEach(b => b.onclick = setS(b, 'done')); $$('[data-reopen]', t).forEach(b => b.onclick = setS(b, 'open'));
  $$('[data-rdel]', t).forEach(b => b.onclick = async () => { if (!online() || !confirm('Delete this request?')) return; try { await db.del('cpl_requests', 'id=eq.' + b.closest('[data-id]').dataset.id); await reload(); } catch (e) { toast(e.message, true); } });
}

/* ---------- dashboard ---------- */
async function dashboard(t) {
  const P = myParts(), teams = scopeTeams(), q = await idb.qAll(), nd = nextDate();
  const ready = teams.filter(x => squadOf(A.participants, 'cricket', x.id).playing.length >= CFG.CRICKET_PLAYING).length;
  const ckOf = id => A.settings['checklist:' + id] || {};
  const st = scopeTeam(), ck = st ? ckOf(st) : {}, done = CHECKLIST.filter(([k]) => ck[k]).length;
  const row = x => {
    const c = squadOf(A.participants, 'cricket', x.id), b = squadOf(A.participants, 'badminton', x.id), d = CHECKLIST.filter(([k]) => ckOf(x.id)[k]).length;
    return `<tr><td><b>${wide() ? `<a href="#" data-team="${esc(x.id)}">${esc(x.name)}</a>` : esc(x.name)}</b></td>
      <td>${pips('cricket', c)}<br><span class="small muted">${c.playing.length}/${CFG.CRICKET_PLAYING} + ${c.reserve.length}/${CFG.CRICKET_RESERVE} · ${c.pool.length} nominated</span></td>
      <td>${pips('badminton', b)}<br><span class="small muted">${b.playing.length}/${CFG.BADMINTON_TEAM} · ${b.pool.length} nominated</span></td><td class="num">${d}/${CHECKLIST.length}</td></tr>`;
  };
  t.innerHTML = `
  <div class="grid g3">
    <div class="card"><h3>Cricket nominations</h3><b style="font:700 2.4rem var(--fh);color:var(--navy)">${P.filter(x => x.sport === 'cricket' && x.status !== 'withdrawn').length}</b></div>
    <div class="card"><h3>Badminton nominations</h3><b style="font:700 2.4rem var(--fh);color:var(--navy)">${P.filter(x => x.sport === 'badminton' && x.status !== 'withdrawn').length}</b></div>
    <div class="card"><h3>Cricket squads complete</h3><b style="font:700 2.4rem var(--fh);color:var(--navy)">${ready}<small style="font-size:1.2rem;color:var(--muted)"> / ${teams.length}</small></b></div>
    ${nd ? `<div class="card"><h3>Next deadline</h3><p style="margin:0"><b>${fmtDate(nd.d)}</b> · ${daysTo(nd.d)} days<br><span class="small muted">${esc(nd.t)}</span></p></div>` : ''}
  </div>
  <section style="margin-top:22px"><h2>${wide() && !st ? 'All teams' : 'Squad status'}</h2><div class="tw"><table class="tbl"><thead><tr><th>Team</th><th>Cricket</th><th>Badminton</th><th class="num">GA checklist</th></tr></thead><tbody>${teams.map(row).join('')}</tbody></table></div></section>
  ${q.length ? `<section><h2>Waiting to sync (${q.length})</h2><div class="card">${q.map(it => `<div class="wa-row"><span>${esc(it.rec.full_name)} · ${SPORT[it.rec.sport]} · ${esc(tname(it.rec.team_id))}${it.failed ? ` <span class="chip" style="background:var(--badbg);color:var(--bad)">${esc(it.failed)}</span>` : ''}</span><button class="btn ghost sm" data-discard="${it.id}">Discard</button></div>`).join('')}<div class="row" style="margin-top:10px"><button class="btn sm" id="syncNow">Sync now</button></div></div></section>` : ''}
  <section><h2>GA checklist${st ? ` · ${esc(tname(st))} <span class="chip">${done}/${CHECKLIST.length}</span>` : ''}</h2>
  ${st ? `<div class="card"><ul class="cl">${CHECKLIST.map(([k, l]) => `<li class="${ck[k] ? 'done' : ''}"><input type="checkbox" id="ck_${k}" data-ck="${k}" ${ck[k] ? 'checked' : ''}><label for="ck_${k}"><span>${esc(l)}</span></label></li>`).join('')}</ul><p class="hint" style="margin-top:8px">From circular ICOM/352/2026: branding, customer invitation, trophies, expenditure, umpires, refreshments.</p></div>` : '<p class="muted">Pick a team in the selector above to see or update its checklist.</p>'}</section>`;
  const sn = $('#syncNow'); if (sn) sn.onclick = async () => { await flushQueue(true); await reload(); };
  $$('[data-discard]', t).forEach(btn => btn.onclick = async () => { await idb.qDel(Number(btn.dataset.discard)); await updatePending(); drawTab(); });
  $$('[data-team]', t).forEach(a => a.onclick = e => { e.preventDefault(); curTeam = a.dataset.team; localStorage.setItem('cpl_scope', curTeam); renderAdmin(curSub, $('#app')); });
  $$('[data-ck]', t).forEach(inp => inp.onchange = async () => {
    if (!online()) { inp.checked = !inp.checked; return; }
    const next = Object.assign({}, ck, { [inp.dataset.ck]: inp.checked }), key = 'checklist:' + st;
    try { await db.upsert('cpl_settings', { key, value: next }); A.settings[key] = next; await idb.set('adm2', A); drawTab(); } catch (e) { toast(e.message, true); inp.checked = !inp.checked; }
  });
}

/* ---------- participants ---------- */
function participants(t) {
  t.innerHTML = `<div class="row" style="margin-bottom:12px">
    <select id="fs" style="max-width:150px"><option value="">All sports</option><option value="cricket">Cricket</option><option value="badminton">Badminton</option></select>
    <select id="ft" style="max-width:160px"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}">${statusLabel('cricket', s)}</option>`).join('')}</select>
    <input type="search" id="fq" placeholder="Search name, staff no, branch" style="max-width:260px">
    <span style="flex:1"></span><button class="btn gold" id="addBtn">+ Add entry</button></div><div id="plist"></div>`;
  $('#fs').value = F.sport; $('#ft').value = F.status; $('#fq').value = F.q;
  $('#fs').onchange = e => { F.sport = e.target.value; drawList(); };
  $('#ft').onchange = e => { F.status = e.target.value; drawList(); };
  $('#fq').oninput = e => { F.q = e.target.value; drawList(); };
  $('#addBtn').onclick = addEntry; drawList();
}
function drawList() {
  const q = F.q.toLowerCase(), showTeam = !scopeTeam();
  const l = myParts().filter(x => (!F.sport || x.sport === F.sport) && (!F.status || x.status === F.status) && (!q || (x.full_name + ' ' + x.staff_no + ' ' + x.branch_name).toLowerCase().includes(q)))
    .sort((a, b) => a.team_id.localeCompare(b.team_id) || a.sport.localeCompare(b.sport) || String(a.created_at).localeCompare(String(b.created_at)));
  $('#plist').innerHTML = l.length ? `<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Staff no.</th>${showTeam ? '<th>RO / office</th>' : ''}<th>Branch / unit</th><th>Mobile</th><th>Sport</th><th>Status</th><th></th></tr></thead><tbody>
    ${l.map((x, i) => `<tr data-id="${x.id}"><td>${i + 1}</td>
      <td><b>${esc(x.full_name)}</b>${x.is_captain ? ' <span title="Captain" style="color:var(--gold)">★</span>' : ''}${x.circle_pick ? ' <span class="chip gold">Circle XV</span>' : ''}<br><span class="small muted">${esc([x.designation, x.playing_role, x.partner_pref && ('partner: ' + x.partner_pref)].filter(Boolean).join(' · '))}${x.source === 'admin' ? ' · admin entry' : ''}</span></td>
      <td>${esc(x.staff_no)}</td>${showTeam ? `<td>${esc(tname(x.team_id))}</td>` : ''}<td>${esc(x.branch_name)}</td><td><a href="tel:${esc(x.contact)}">${esc(x.contact)}</a></td><td>${x.sport === 'cricket' ? 'Cricket' : 'Badminton'}</td>
      <td><select data-st style="min-width:130px">${STATUSES.map(s => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${statusLabel(x.sport, s)}</option>`).join('')}</select></td>
      <td class="right" style="white-space:nowrap">${x.sport === 'cricket' ? '<button class="btn ghost sm" data-cap title="Make captain">★</button> ' : ''}${wide() && x.sport === 'cricket' ? `<button class="btn ghost sm" data-xv title="Toggle Circle XV">XV</button> ` : ''}<button class="btn ghost sm" data-edit>Edit</button> <button class="btn ghost sm" data-del>Delete</button></td></tr>`).join('')}
    </tbody></table></div><p class="hint" style="margin-top:6px">${l.length} entries shown.</p>` : '<p class="muted">No entries match.</p>';
  $$('#plist tbody tr').forEach(tr => {
    const id = tr.dataset.id;
    $('[data-st]', tr).onchange = e => setStatus(id, e.target.value);
    const cb = $('[data-cap]', tr); if (cb) cb.onclick = () => setCaptain(id);
    const xv = $('[data-xv]', tr); if (xv) xv.onclick = () => toggleXV(id);
    $('[data-edit]', tr).onclick = () => editEntry(id);
    $('[data-del]', tr).onclick = () => delEntry(id);
  });
}
async function setStatus(id, st) {
  if (!online()) return drawList();
  const x = A.participants.find(p => p.id === id), sq = squadOf(A.participants, x.sport, x.team_id), L = lim(x.sport);
  if (st === 'playing' && x.status !== 'playing' && sq.playing.length >= L.playing && !confirm(`${tname(x.team_id)} already has ${sq.playing.length} selected for ${SPORT[x.sport]} (limit ${L.playing}). Add anyway?`)) return drawList();
  if (st === 'reserve' && x.status !== 'reserve' && sq.reserve.length >= L.reserve && !confirm(`${tname(x.team_id)} already has ${sq.reserve.length} reserves (limit ${L.reserve}). Add anyway?`)) return drawList();
  const body = { status: st };
  if (x.is_captain && !['playing', 'reserve'].includes(st)) body.is_captain = false;
  try { await db.patch('cpl_participants', 'id=eq.' + id, body); await reload(); } catch (e) { toast(e.message, true); drawList(); }
}
async function setCaptain(id) {
  if (!online()) return;
  const x = A.participants.find(p => p.id === id);
  if (!['playing', 'reserve'].includes(x.status)) return toast('Select the player as Playing XI first', true);
  try {
    await db.patch('cpl_participants', `team_id=eq.${x.team_id}&sport=eq.${x.sport}&is_captain=eq.true`, { is_captain: false });
    await db.patch('cpl_participants', 'id=eq.' + id, { is_captain: !x.is_captain });
    await reload(x.is_captain ? 'Captain removed' : x.full_name + ' is captain');
  } catch (e) { toast(e.message, true); }
}
async function toggleXV(id) {
  if (!online()) return;
  const x = A.participants.find(p => p.id === id), n = A.participants.filter(p => p.circle_pick).length;
  if (!x.circle_pick && n >= 15 && !confirm('Circle XV already has 15 players. Add anyway?')) return;
  try { await db.patch('cpl_participants', 'id=eq.' + id, { circle_pick: !x.circle_pick }); await reload(); } catch (e) { toast(e.message, true); }
}
async function delEntry(id) {
  if (!online()) return;
  const x = A.participants.find(p => p.id === id);
  if (!confirm(`Delete ${x.full_name} (${SPORT[x.sport]}) permanently?`)) return;
  try { await db.del('cpl_participants', 'id=eq.' + id); await reload('Deleted'); } catch (e) { toast(e.message, true); }
}
const lockTeam = () => (wide() ? '' : (A.me.team_id || ''));
function addEntry() {
  const m = openModal(`<h2>Add entry</h2><form id="addForm" novalidate><div class="form">${entryFields(null, { lockTeam: lockTeam(), defaultTeam: curTeam })}</div>
    <div class="row" style="margin-top:14px"><button class="btn gold" type="submit">Save entry</button><button class="btn ghost" type="button" id="cx">Cancel</button><span class="hint">Works offline: saved on this device and synced later.</span></div></form>`, true);
  const form = $('#addForm', m); bindEntryForm(form); $('#cx', m).onclick = closeModal;
  form.onsubmit = async e => {
    e.preventDefault();
    const { r, miss } = readEntry(form);
    if (miss.length) return toast('Please check: ' + miss.join(', '), true);
    r.source = 'admin';
    try {
      const res = await submitEntry(r, true);
      if (res === 'duplicate') return toast('Staff number already registered for this sport', true);
      closeModal(); if (res === 'sent') await reload('Entry added'); else toast('Offline: saved, will sync automatically');
    } catch (err) { toast(err.message, true); }
  };
}
function editEntry(id) {
  const x = A.participants.find(p => p.id === id);
  const m = openModal(`<h2>Edit entry</h2><form id="edForm" novalidate><div class="form">${entryFields(x, { lockTeam: lockTeam() })}
    <div class="field"><label for="e_st">Status</label><select id="e_st" name="status">${STATUSES.map(s => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${statusLabel(x.sport, s)}</option>`).join('')}</select></div>
    <div class="field"><label class="chk" style="margin-top:26px"><input type="checkbox" name="is_captain" ${x.is_captain ? 'checked' : ''}> Captain (cricket)</label></div>
    <div class="field full"><label for="e_rm">Remarks (admin only)</label><input id="e_rm" name="remarks" type="text" maxlength="300" value="${esc(x.remarks)}"></div></div>
    <div class="row" style="margin-top:14px"><button class="btn gold" type="submit">Save changes</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`, true);
  const form = $('#edForm', m); bindEntryForm(form, x); $('#cx', m).onclick = closeModal;
  form.onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const { r, miss } = readEntry(form);
    if (miss.length) return toast('Please check: ' + miss.join(', '), true);
    const body = Object.assign(r, { status: form.elements.status.value, is_captain: form.elements.is_captain.checked, remarks: form.elements.remarks.value.trim() || null });
    if (r.sport !== 'cricket' || !['playing', 'reserve'].includes(body.status)) body.is_captain = false;
    try {
      if (body.is_captain) await db.patch('cpl_participants', `team_id=eq.${r.team_id}&sport=eq.${r.sport}&is_captain=eq.true`, { is_captain: false });
      await db.patch('cpl_participants', 'id=eq.' + id, body); closeModal(); await reload('Saved');
    } catch (err) { toast(err.status === 409 ? 'That staff number is already registered for this sport' : err.message, true); }
  };
}

/* ---------- fixtures ---------- */
function simulateBad(sport, id, winner) {
  const saved = D.pub.fixtures;
  D.pub.fixtures = saved.map(f => (f.id === id ? Object.assign({}, f, { winner }) : f));
  const bad = resolvedFx(sport).filter(f => f.winner && f.winner !== f.a && f.winner !== f.b);
  D.pub.fixtures = saved; return bad;
}
function fixtures(t) {
  const l = resolvedFx(FS);
  t.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg">${['cricket', 'badminton'].map(s => `<button data-s="${s}" class="${FS === s ? 'on' : ''}">${s === 'cricket' ? 'Cricket' : 'Badminton'}</button>`).join('')}</div><span class="hint">Enter date, venue and the winner. The winner moves to the next match automatically.</span></div>
  ${l.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Match</th><th>Team A</th><th>Team B</th><th>When</th><th>Venue</th><th>Winner</th><th></th></tr></thead><tbody>${l.map(f => `<tr><td><b>M${f.match_no}</b></td><td>${f.a ? esc(tname(f.a)) : '<span class="muted">Winner of M' + f.src_a + '</span>'}</td><td>${f.b ? esc(tname(f.b)) : '<span class="muted">Winner of M' + f.src_b + '</span>'}</td><td>${esc([f.match_date && fmtShort(f.match_date), f.match_time].filter(Boolean).join(' · '))}</td><td>${esc(f.venue || '')}</td><td>${f.winner ? `<span class="chip playing">${esc(tname(f.winner))}</span>` : ''}</td><td class="right"><button class="btn ghost sm" data-f="${f.id}">${f.winner ? 'Edit' : 'Result'}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No fixtures found. Run schema_v2.sql or import fixtures under Teams &amp; users.</p>'}`;
  $$('[data-s]', t).forEach(b => b.onclick = () => { FS = b.dataset.s; drawTab(); });
  $$('[data-f]', t).forEach(b => b.onclick = () => fixtureForm(l.find(f => f.id === b.dataset.f)));
}
function fixtureForm(f) {
  const opts = [f.a, f.b].filter(Boolean);
  const m = openModal(`<h2>M${f.match_no} · ${esc(f.a ? tname(f.a) : 'TBD')} vs ${esc(f.b ? tname(f.b) : 'TBD')}</h2><form id="ff" class="form">
    <div class="field"><label>Date</label><input name="date" type="date" value="${esc(f.match_date || '')}"></div>
    <div class="field"><label>Time</label><input name="time" type="text" value="${esc(f.match_time || '')}" placeholder="e.g. 9:00 AM"></div>
    <div class="field full"><label>Venue</label><input name="venue" type="text" value="${esc(f.venue || '')}"></div>
    <div class="field full"><label>Winner</label><select name="winner"><option value="">No result yet</option>${opts.map(id => `<option value="${esc(id)}" ${f.winner === id ? 'selected' : ''}>${esc(tname(id))}</option>`).join('')}</select>${opts.length < 2 ? '<span class="hint">Both teams must be known before a result can be set.</span>' : ''}</div>
    <div class="field full"><label>Result note</label><input name="note" type="text" maxlength="120" value="${esc(f.result_note || '')}" placeholder="e.g. Won by 12 runs"></div>
    <div class="row full"><button class="btn gold" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  $('#cx', m).onclick = closeModal;
  $('#ff', m).onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const el = e.target.elements, w = el.winner.value || null;
    const bad = w !== f.winner ? simulateBad(f.sport, f.id, w) : [];
    if (bad.length && !confirm(`This changes later matches. Results of ${bad.map(b => 'M' + b.match_no).join(', ')} will be cleared. Continue?`)) return;
    try {
      await db.patch('cpl_fixtures', 'id=eq.' + f.id, { match_date: el.date.value || null, match_time: el.time.value.trim() || null, venue: el.venue.value.trim() || null, winner: w, result_note: el.note.value.trim() || null });
      for (const b of bad) await db.patch('cpl_fixtures', 'id=eq.' + b.id, { winner: null, result_note: null });
      closeModal(); await loadPublic(); toast('Saved'); drawTab();
      if (bad.length) { for (let i = 0; i < 5; i++) { const more = resolvedFx(f.sport).filter(x => x.winner && x.winner !== x.a && x.winner !== x.b); if (!more.length) break; for (const b of more) await db.patch('cpl_fixtures', 'id=eq.' + b.id, { winner: null, result_note: null }); await loadPublic(); } drawTab(); }
    } catch (err) { toast(err.message, true); }
  };
}

/* ---------- notices ---------- */
function notices(t) {
  const l = A.notices.filter(n => !scopeTeam() || !n.team_id || n.team_id === scopeTeam());
  t.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn gold" id="newN">+ New notice</button><span class="hint">Published notices appear on the public home page${wide() ? '' : ' and your RO page'}.</span></div>
  ${l.length ? l.map(n => `<article class="card" style="margin-bottom:12px" data-id="${n.id}"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${n.pinned ? '📌 ' : ''}${esc(n.title)}</h3><span class="chip" style="${n.published ? '' : 'background:#EEE;color:#666'}">${n.published ? 'Published' : 'Draft'}</span></div>
    <p class="muted small">${fmtDate(n.created_at)} · ${esc(n.category)} · ${n.team_id ? esc(tname(n.team_id)) : 'Whole circle'}</p><p style="white-space:pre-wrap">${esc(n.body)}</p>
    <div class="row">${wide() || n.team_id ? '<button class="btn ghost sm" data-e>Edit</button>' : ''}<button class="btn ghost sm" data-use>Use in Communicate</button>${wide() || n.team_id ? '<button class="btn ghost sm" data-d>Delete</button>' : ''}</div></article>`).join('') : '<p class="muted">No notices yet.</p>'}`;
  $('#newN').onclick = () => noticeForm();
  $$('article[data-id]', t).forEach(a => {
    const n = A.notices.find(x => x.id === a.dataset.id);
    const e = $('[data-e]', a); if (e) e.onclick = () => noticeForm(n);
    $('[data-use]', a).onclick = () => { CM.subject = n.title; CM.body = n.body; CM.tpl = 'custom'; location.hash = '#/admin/communicate'; };
    const d = $('[data-d]', a); if (d) d.onclick = async () => { if (!online() || !confirm('Delete this notice?')) return; try { await db.del('cpl_notices', 'id=eq.' + n.id); await reload('Deleted'); } catch (er) { toast(er.message, true); } };
  });
}
function noticeForm(n) {
  n = n || { title: '', body: '', category: 'general', pinned: false, published: true, team_id: wide() ? (curTeam || null) : A.me.team_id };
  const m = openModal(`<h2>${n.id ? 'Edit' : 'New'} notice</h2><form id="nf" class="form" style="grid-template-columns:1fr">
    <div class="field"><label>Title</label><input name="title" type="text" maxlength="200" value="${esc(n.title)}" required></div>
    <div class="field"><label>Message</label><textarea name="body" style="min-height:160px" required>${esc(n.body)}</textarea></div>
    ${wide() ? `<div class="field"><label>Applies to</label><select name="team"><option value="">Whole circle</option>${teamsList().map(t => `<option value="${esc(t.id)}" ${n.team_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Category</label><select name="category">${['general', 'nomination', 'schedule', 'result'].map(c => `<option ${n.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <label class="chk"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}> Pin to top</label>
    <label class="chk"><input type="checkbox" name="published" ${n.published ? 'checked' : ''}> Publish on public page</label>
    <div class="row"><button class="btn gold" type="submit">Save notice</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  $('#cx', m).onclick = closeModal;
  $('#nf', m).onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const f = e.target.elements;
    const body = { title: f.title.value.trim(), body: f.body.value.trim(), category: f.category.value, pinned: f.pinned.checked, published: f.published.checked, team_id: wide() ? (f.team.value || null) : A.me.team_id };
    if (body.title.length < 3 || !body.body) return toast('Title and message are required', true);
    try { if (n.id) await db.patch('cpl_notices', 'id=eq.' + n.id, body); else await db.insert('cpl_notices', body); closeModal(); await reload('Notice saved'); } catch (err) { toast(err.message, true); }
  };
}

/* ---------- communicate ---------- */
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
const CM = { tpl: 'share', subject: '', body: '', ref: 'RON/GA/CPL/2026/', date: today(), to: '', lastDate: '', matchNo: '', matchDate: '', matchTime: '', venue: '', sigName: CFG.SIGNATORY_NAME, sigDesig: CFG.SIGNATORY_DESIG, audience: 'branches', custom: '' };
const TPLS = { share: 'Share links (nominate + progress)', call: 'Call for nominations', reminder: 'Reminder', squad: 'Squad announcement', fixture: 'Match intimation', custom: 'Custom message' };
function tplBuild(id) {
  const one = scopeTeam() ? T(scopeTeam()) : null, teams = scopeTeams();
  const P = myParts().filter(x => x.status !== 'withdrawn'), cN = P.filter(x => x.sport === 'cricket').length, bN = P.filter(x => x.sport === 'badminton').length;
  const last = CM.lastDate || '__.__.2026';
  const intro = 'The 4th edition of the Canara Premier League (CPL 4.0) - Cricket (Men) and Badminton (Women) - is being organised across ROs, COs and HO. Inter-RO and Inter-Circle matches will be held during September to November 2026, with the Semi-Finals and Final at Bengaluru on 12th and 13th December 2026.';
  const rules = 'Players should report 30 minutes before the start of play, in bank-issued sportswear. Late arrival may lead to disqualification. Practice sessions must be held only after office hours or on bank holidays.';
  const who = one ? one.name : 'Each RO / office';
  if (id === 'share') return shareMsg(scopeTeam());
  if (id === 'call') return { subject: 'Nominations invited - Canara Premier League (CPL 4.0) - Cricket (Men) & Badminton (Women)', body: `${intro}\n\n${who} will field a Cricket squad of ${CFG.CRICKET_PLAYING + CFG.CRICKET_RESERVE} players (${CFG.CRICKET_PLAYING} playing + ${CFG.CRICKET_RESERVE} reserves) and a Women's Doubles Badminton team of ${CFG.BADMINTON_TEAM} players. Trials will be conducted if nominations exceed the squad size.\n\nInterested staff may submit their nomination at: ${linkNominate(scopeTeam())}\nFollow progress: ${linkHome(scopeTeam())}\nLast date for nomination: ${last}\n\nPractice sessions must be held only after office hours or on bank holidays. All Branch Incharges are requested to circulate this message widely and encourage participation.` };
  if (id === 'reminder') return { subject: 'Reminder - Nominations for Canara Premier League (CPL 4.0)', body: `This is a reminder regarding nominations for CPL 4.0 - Cricket (Men) and Badminton (Women).\n\nNominations received so far${one ? ' for ' + one.name : ''}: Cricket ${cN}, Badminton ${bN}.\n\nStaff who wish to participate are requested to register at: ${linkNominate(scopeTeam())}\nFollow progress: ${linkHome(scopeTeam())}\nLast date for nomination: ${last}` };
  if (id === 'squad') {
    const blocks = teams.map(tm => {
      const c = squadOf(A.participants, 'cricket', tm.id), b = squadOf(A.participants, 'badminton', tm.id);
      const ln = (p, i) => `${i}. ${p.full_name}${p.is_captain ? ' (Captain)' : ''} - ${p.branch_name}`;
      return `${tm.name.toUpperCase()}\nCricket - Playing XI:\n${c.playing.map((p, i) => ln(p, i + 1)).join('\n') || '(to be announced)'}\nReserves:\n${c.reserve.map((p, i) => ln(p, CFG.CRICKET_PLAYING + i + 1)).join('\n') || '(to be announced)'}\nBadminton - Women's Doubles:\n${b.playing.map((p, i) => ln(p, i + 1)).join('\n') || '(to be announced)'}`;
    }).join('\n\n');
    return { subject: `Squads announced - ${one ? one.name + ' - ' : ''}Canara Premier League (CPL 4.0)`, body: `The following staff have been selected to represent their ROs in CPL 4.0.\n\n${blocks}\n\n${rules} For badminton, players must bring their own rackets and wear non-marking shoes.\n\nBest wishes to all the players.` };
  }
  if (id === 'fixture') {
    const fx = resolvedFx('cricket').find(f => String(f.match_no) === String(CM.matchNo));
    const line = fx ? `M${fx.match_no}: ${fx.a ? tname(fx.a) : 'Winner of M' + fx.src_a} vs ${fx.b ? tname(fx.b) : 'Winner of M' + fx.src_b}` : '(select a match)';
    const d = fx && fx.match_date ? fmtDate(fx.match_date) : (CM.matchDate || '__.__.2026'), tm = (fx && fx.match_time) || CM.matchTime || '__:__', vn = (fx && fx.venue) || CM.venue || '(to be intimated)';
    return { subject: 'Match intimation - CPL 4.0 Inter-RO match', body: `Fixture: ${line}\nDate: ${d}\nTime: ${tm}\nVenue: ${vn}\n\nCricket: 10 overs per side, hard tennis ball, maximum 2 overs per bowler, knock-out format.\nBadminton: women's doubles, best of three sets, 21 points per game (2-point lead, maximum 30).\n\n${rules}` };
  }
  return { subject: CM.subject || '', body: CM.body || '' };
}
function shareMsg(teamId) {
  const tm = teamId && T(teamId), who = tm ? tm.name : CFG.CIRCLE_NAME;
  return { subject: `CPL 4.0 - Nominate and follow progress - ${who}`, body: `Canara Premier League (CPL 4.0) - Cricket (Men) and Badminton (Women) - ${who}.\n\n1) Nominate here:\n${linkNominate(teamId)}\n\n2) Follow squads, fixtures and results here:\n${linkHome(teamId)}\n\nTip: open the link on your phone and choose "Add to Home screen" to install the app. It also works offline.\n\nAll Branch Incharges are requested to circulate this message to every staff member.` };
}
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const sentStore = () => { try { return JSON.parse(localStorage.getItem('cpl_wa_sent') || '{}'); } catch { return {}; } };
function normNum(n) { const d = String(n || '').replace(/\D/g, ''); if (d.length === 10) return '91' + d; if (d.length === 12 && d.startsWith('91')) return d; if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1); return ''; }
function recipients() {
  const P = myParts().filter(x => x.status !== 'withdrawn'), mk = x => ({ name: x.full_name, label: `${x.full_name} · ${tname(x.team_id)}`, num: normNum(x.contact) });
  if (CM.audience === 'branches') return A.branches.filter(inScope).map(b => ({ name: b.incharge_name || 'Sir/Madam', label: `${b.branch_name}${scopeTeam() ? '' : ' · ' + tname(b.team_id)}`, num: normNum(b.whatsapp) }));
  if (CM.audience === 'nominees') return P.map(mk);
  if (CM.audience === 'cricket') return P.filter(x => x.sport === 'cricket' && ['playing', 'reserve'].includes(x.status)).map(mk);
  if (CM.audience === 'badminton') return P.filter(x => x.sport === 'badminton' && x.status === 'playing').map(mk);
  return CM.custom.split(/[\s,;]+/).filter(Boolean).map(n => ({ name: 'Sir/Madam', label: n, num: normNum(n) }));
}
const waText = name => `*${CM.subject}*\n\nDear ${name},\n\n${CM.body}\n\n- ${CM.sigName}\n${CM.sigDesig}`;
function communicate(t) {
  const one = scopeTeam() ? T(scopeTeam()) : null;
  if (!CM.to) CM.to = 'All Branch Incharges, ' + (one ? one.name : CFG.CIRCLE_NAME);
  if (!CM.subject && !CM.body) Object.assign(CM, tplBuild(CM.tpl));
  const inp = (k, l, ph) => `<div class="field"><label>${l}</label><input type="text" data-k="${k}" value="${esc(CM[k])}" placeholder="${esc(ph || '')}"></div>`;
  const fxs = resolvedFx('cricket');
  t.innerHTML = `${shareCard()}<div class="grid g2" style="align-items:start">
  <div class="card"><h3>Compose</h3><div class="form" style="grid-template-columns:1fr 1fr">
    <div class="field" style="grid-column:1/-1"><label>Template</label><select id="tpl">${Object.entries(TPLS).map(([k, v]) => `<option value="${k}" ${CM.tpl === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${CM.tpl === 'call' || CM.tpl === 'reminder' ? inp('lastDate', 'Last date to nominate', 'dd.mm.yyyy') : ''}
    ${CM.tpl === 'fixture' ? `<div class="field"><label>Match</label><select id="mno"><option value="">Select</option>${fxs.map(f => `<option value="${f.match_no}" ${String(CM.matchNo) === String(f.match_no) ? 'selected' : ''}>M${f.match_no}: ${esc(f.a ? tname(f.a) : 'W' + f.src_a)} vs ${esc(f.b ? tname(f.b) : 'W' + f.src_b)}</option>`).join('')}</select></div>${inp('matchDate', 'Date (if not set in Fixtures)', 'dd.mm.yyyy')}${inp('matchTime', 'Time', 'e.g. 9:00 AM')}${inp('venue', 'Venue', '')}` : ''}
    <div class="field" style="grid-column:1/-1"><label>Subject</label><input type="text" data-k="subject" value="${esc(CM.subject)}"></div>
    <div class="field" style="grid-column:1/-1"><label>Message</label><textarea data-k="body" style="min-height:260px">${esc(CM.body)}</textarea></div>
    <div class="field" style="grid-column:1/-1"><button class="btn ghost sm" id="rebuild" style="align-self:flex-start">Rebuild text from template</button></div></div></div>
  <div class="card"><h3>Send</h3>
    <div class="row" style="margin-bottom:12px"><button class="btn gold" id="toLetter">Print official letter (PDF)</button><button class="btn" id="toNotice">Post to notice board</button><button class="btn ghost" id="copyMsg">Copy message</button></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><h3>WhatsApp${one ? ' · ' + esc(one.name) : ''}</h3>
    <div class="field"><label>Send to</label><select id="aud">${[['branches', 'Branch incharges'], ['nominees', 'All nominees'], ['cricket', 'Cricket squad (XI + reserves)'], ['badminton', 'Badminton pair'], ['custom', 'Custom numbers']].map(([k, v]) => `<option value="${k}" ${CM.audience === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field ${CM.audience === 'custom' ? '' : 'hide'}" id="customWrap"><label>Numbers (comma or new line)</label><textarea data-k="custom" style="min-height:70px">${esc(CM.custom)}</textarea></div>
    <div id="rcpts" style="margin-top:10px"></div></div></div>`;
  bindShare(t);
  $$('[data-k]', t).forEach(el => el.addEventListener('input', () => { CM[el.dataset.k] = el.value; if (el.dataset.k === 'custom') drawRcpts(); }));
  $('#tpl').onchange = e => { CM.tpl = e.target.value; Object.assign(CM, tplBuild(CM.tpl)); communicate(t); };
  const mn = $('#mno'); if (mn) mn.onchange = () => { CM.matchNo = mn.value; Object.assign(CM, tplBuild('fixture')); communicate(t); };
  $('#rebuild').onclick = () => { Object.assign(CM, tplBuild(CM.tpl)); communicate(t); };
  $('#aud').onchange = e => { CM.audience = e.target.value; $('#customWrap').classList.toggle('hide', CM.audience !== 'custom'); drawRcpts(); };
  $('#copyMsg').onclick = async () => { try { await navigator.clipboard.writeText(waText('Sir/Madam')); toast('Message copied'); } catch { toast('Copy not allowed on this browser', true); } };
  $('#toNotice').onclick = async () => {
    if (!online()) return;
    if (!CM.subject.trim() || !CM.body.trim()) return toast('Subject and message are required', true);
    try { await db.insert('cpl_notices', { title: CM.subject.trim(), body: CM.body.trim(), category: CM.tpl === 'squad' ? 'result' : CM.tpl === 'fixture' ? 'schedule' : 'nomination', pinned: false, published: true, team_id: scopeTeam() || null }); await loadAdmin(); await loadPublic(); toast('Posted to notice board'); } catch (e) { toast(e.message, true); }
  };
  $('#toLetter').onclick = showLetter; drawRcpts();
}
let SHARE_RO = null;
function shareCard() {
  const ro = SHARE_RO === null ? scopeTeam() : SHARE_RO, m = shareMsg(ro);
  return `<div class="card sharecard" style="margin-bottom:16px"><div class="sec-h" style="margin-bottom:8px"><div><h3 style="margin:0">Share links on WhatsApp</h3><p class="small muted" style="margin:0">Two links: staff nominate with the first and follow progress with the second.</p></div>
    <select id="shRo" aria-label="Links for"><option value="">Whole ${esc(CFG.CIRCLE_NAME)}</option>${teamsList().map(x => `<option value="${esc(x.id)}" ${ro === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="linkrow"><span class="lk">1 · Nominate</span><input readonly id="lkN" value="${esc(linkNominate(ro))}"><button class="btn ghost sm" data-cp="lkN">Copy</button><a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(linkNominate(ro))}">Open</a></div>
    <div class="linkrow"><span class="lk">2 · Progress</span><input readonly id="lkH" value="${esc(linkHome(ro))}"><button class="btn ghost sm" data-cp="lkH">Copy</button><a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(linkHome(ro))}">Open</a></div>
    <div class="field" style="margin-top:10px"><label>WhatsApp message</label><textarea id="shMsg" style="min-height:190px">*${esc(m.subject)}*\n\n${esc(m.body)}</textarea></div>
    <div class="row"><a class="btn gold" id="shWa" target="_blank" rel="noopener" href="#">Send on WhatsApp</a><button class="btn ghost" id="shCp">Copy message</button><span class="hint">WhatsApp opens with the message ready; pick any contact or group.</span></div></div>`;
}
function bindShare(t) {
  const ta = $('#shMsg', t); if (!ta) return;
  const upd = () => { $('#shWa', t).href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); }; ta.addEventListener('input', upd); upd();
  const copy = async txt => { try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch { toast('Copy not allowed on this browser', true); } };
  $('#shCp', t).onclick = () => copy(ta.value);
  $$('[data-cp]', t).forEach(b => b.onclick = () => copy($('#' + b.dataset.cp, t).value));
  $('#shRo', t).onchange = e => { SHARE_RO = e.target.value; communicate(t); };
}
function drawRcpts() {
  const el = $('#rcpts'); if (!el) return;
  const list = recipients(), sent = sentStore(), h = hash(CM.subject + CM.body), ok = list.filter(r => r.num), miss = list.length - ok.length;
  el.innerHTML = `<p class="small muted">${ok.length} recipients${miss ? ` · <b>${miss} without a valid number</b> ${CM.audience === 'branches' ? '(add numbers in the Branches tab)' : ''}` : ''}</p>` +
    (ok.length ? ok.map((r, i) => { const done = sent[h + '|' + r.num]; return `<div class="wa-row ${done ? 'sent' : ''}"><span>${esc(r.label)}${done ? ' <span class="chip playing">sent</span>' : ''}</span><a class="btn sm" data-i="${i}" target="_blank" rel="noopener" href="https://wa.me/${r.num}?text=${encodeURIComponent(waText(r.name))}">WhatsApp</a></div>`; }).join('') : '<p class="muted">No recipients with numbers.</p>');
  $$('a[data-i]', el).forEach(a => a.addEventListener('click', () => { const r = ok[Number(a.dataset.i)], s = sentStore(); s[h + '|' + r.num] = Date.now(); localStorage.setItem('cpl_wa_sent', JSON.stringify(s)); setTimeout(drawRcpts, 400); }));
}
function showLetter() {
  const one = scopeTeam() ? T(scopeTeam()) : null;
  const m = openModal(`<div class="no-print" style="margin-bottom:10px"><div class="form" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
      <div class="field"><label>Ref. No.</label><input type="text" id="l_ref" value="${esc(CM.ref)}"></div><div class="field"><label>Date</label><input type="text" id="l_date" value="${esc(CM.date)}"></div>
      <div class="field"><label>To</label><input type="text" id="l_to" value="${esc(CM.to)}"></div><div class="field"><label>Signatory</label><input type="text" id="l_sig" value="${esc(CM.sigName)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Designation</label><input type="text" id="l_des" value="${esc(CM.sigDesig)}"></div></div>
    <div class="row"><button class="btn gold sm" id="prn">Print / Save as PDF</button><button class="btn ghost sm" id="cls">Close</button><span class="hint">In the print dialog choose “Save as PDF”.</span></div></div><div class="letter" id="letter"></div>`, true);
  const draw = () => {
    ['ref', 'date', 'to'].forEach(k => { CM[k] = $('#l_' + k, m).value; }); CM.sigName = $('#l_sig', m).value; CM.sigDesig = $('#l_des', m).value;
    $('#letter', m).innerHTML = `<div class="lh"><b>CANARA BANK | केनरा बैंक</b><span>${esc(one ? one.name : CFG.CIRCLE_NAME + ' Office')} · General Administration Section</span></div>
      <div class="meta"><span>Ref: ${esc(CM.ref)}</span><span>Date: ${esc(CM.date)}</span></div><p>To,<br>${esc(CM.to)}</p><p>Dear Sir / Madam,</p><div class="sub">Sub: ${esc(CM.subject)}</div><div class="bd">${esc(CM.body)}</div>
      <div class="sig"><b>${esc(CM.sigName)}</b><br>${esc(CM.sigDesig)}</div>`;
  };
  $$('input', m).forEach(i => i.addEventListener('input', draw)); draw(); $('#cls', m).onclick = closeModal;
  $('#prn', m).onclick = () => { document.body.classList.add('printing'); const off = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', off); }; window.addEventListener('afterprint', off); window.print(); setTimeout(off, 2000); };
}

/* ---------- reports ---------- */
const LIB = { xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', pdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', at: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js' };
const loaded = {};
const loadLib = src => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Export library not available offline yet. Open Reports once while online.')); }; document.head.appendChild(s); }));
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
function buildReports() {
  const P = myParts(), teams = scopeTeams(), br = A.branches.filter(inScope);
  const sorted = [...P].sort((a, b) => a.team_id.localeCompare(b.team_id) || a.sport.localeCompare(b.sport) || String(a.created_at).localeCompare(String(b.created_at)));
  const row = (n, p) => [n, p ? p.full_name + (p.is_captain ? ' (Captain)' : '') : '', p ? p.staff_no : '', p ? p.contact : '', p ? p.branch_name : ''];
  const cform = teams.map(tm => {
    const cs = squadOf(P, 'cricket', tm.id), cap = cs.playing.concat(cs.reserve).find(x => x.is_captain), rows = [];
    for (let i = 0; i < CFG.CRICKET_PLAYING; i++) rows.push(row(i + 1, cs.playing[i]));
    rows.push(['', 'RESERVE PLAYERS', '', '', '']); for (let i = 0; i < CFG.CRICKET_RESERVE; i++) rows.push(row(CFG.CRICKET_PLAYING + i + 1, cs.reserve[i]));
    return { title: tm.name, form: true, head: [`Team Name: ${tm.name}`, `Captain Name & Contact No: ${cap ? cap.full_name + ' / ' + cap.contact : ''}`], cols: ['S.No', 'Player Name', 'Staff No', 'Contact Number', 'Branch / RO / CO / HO'], rows, foot: ['Captain Signature: ______________________'] };
  });
  const bform = teams.map(tm => { const bd = squadOf(P, 'badminton', tm.id), rows = []; for (let i = 0; i < CFG.BADMINTON_TEAM; i++) rows.push(row(i + 1, bd.playing[i])); return { title: tm.name, form: true, head: [`Team Name: ${tm.name}`], cols: ['S.No', "Player Name (Women's Doubles)", 'Staff No', 'Contact Number', 'Branch / RO / CO / HO'], rows, foot: ['Player-1 Signature: ____________________        Player-2 Signature: ____________________'] }; });
  const sel = l => l.filter(x => ['playing', 'reserve'].includes(x.status)).length;
  const tsum = teams.map(tm => { const c = squadOf(P, 'cricket', tm.id), b = squadOf(P, 'badminton', tm.id), cap = c.playing.concat(c.reserve).find(x => x.is_captain), bl = A.branches.filter(x => x.team_id === tm.id), used = bl.filter(x => P.some(p => p.dp_code === x.dp_code && p.status !== 'withdrawn')).length; return [tm.name, c.pool.length, c.playing.length, c.reserve.length, cap ? cap.full_name : '', b.pool.length, b.playing.length, bl.length ? `${used}/${bl.length}` : 'n/a']; });
  const brows = br.map(b => { const mine = P.filter(x => x.dp_code === b.dp_code && x.status !== 'withdrawn'), mc = mine.filter(x => x.sport === 'cricket'), mb = mine.filter(x => x.sport === 'badminton'); return { b, mc, mb, row: [tname(b.team_id), b.dp_code, b.branch_name, b.incharge_name || '', mc.length, sel(mc), mb.length, sel(mb), mc.length + mb.length] }; });
  const fxSec = ['cricket', 'badminton'].map(s => ({ title: s === 'cricket' ? 'Cricket' : 'Badminton', cols: ['Match', 'Team A', 'Team B', 'Date', 'Time', 'Venue', 'Winner', 'Note'], rows: resolvedFx(s).map(f => ['M' + f.match_no, f.a ? tname(f.a) : 'Winner of M' + f.src_a, f.b ? tname(f.b) : 'Winner of M' + f.src_b, f.match_date ? fmtDate(f.match_date) : '', f.match_time || '', f.venue || '', f.winner ? tname(f.winner) : '', f.result_note || '']) }));
  const xv = P.filter(x => x.circle_pick && x.sport === 'cricket').sort((a, b) => (b.is_captain ? 1 : 0) - (a.is_captain ? 1 : 0));
  return [
    { key: 'register', title: 'Participation Register', sections: [{ title: 'Register', cols: ['S.No', 'RO / office', 'Sport', 'Name', 'Staff No', 'Designation', 'Branch / Unit', 'Mobile', 'Role / Partner', 'Status', 'Captain', 'Registered on'], rows: sorted.map((x, i) => [i + 1, tname(x.team_id), SPORT[x.sport], x.full_name, x.staff_no, x.designation || '', x.branch_name, x.contact, x.playing_role || x.partner_pref || '', statusLabel(x.sport, x.status), x.is_captain ? 'Yes' : '', fmtDate(x.created_at)]) }] },
    { key: 'cricket_forms', title: 'Entry Forms - Cricket (Men)', note: `${cform.length} team(s), one page each`, sections: cform },
    { key: 'badminton_forms', title: 'Entry Forms - Badminton (Women Doubles)', note: `${bform.length} team(s), one page each`, sections: bform },
    { key: 'team_summary', title: 'Team-wise Summary', sections: [{ title: 'Teams', cols: ['Team', 'Cricket nominated', 'Playing XI', 'Reserves', 'Captain', 'Badminton nominated', 'Pair selected', 'Branches nominated'], rows: tsum }] },
    { key: 'branchwise', title: 'Branch-wise Participation', sections: [{ title: 'Branches', cols: ['RO / office', 'DP Code', 'Branch / Unit', 'Incharge', 'Cricket nominated', 'Cricket selected', 'Badminton nominated', 'Badminton selected', 'Total'], rows: brows.map(x => x.row) }] },
    { key: 'pending', title: 'Branches Yet to Nominate', sections: [{ title: 'Pending', cols: ['S.No', 'RO / office', 'DP Code', 'Branch / Unit', 'Incharge', 'WhatsApp'], rows: brows.filter(x => !x.mc.length && !x.mb.length).map((x, i) => [i + 1, tname(x.b.team_id), x.b.dp_code, x.b.branch_name, x.b.incharge_name || '', x.b.whatsapp || '']) }] },
    { key: 'fixtures', title: 'Fixtures & Results', sections: fxSec },
    { key: 'circle_xv', title: 'Circle XV (Cricket)', sections: [{ title: 'Circle XV', cols: ['S.No', 'Player', 'Staff No', 'Contact', 'RO / office', 'Branch'], rows: xv.map((x, i) => [i + 1, x.full_name + (x.is_captain ? ' (Captain)' : ''), x.staff_no, x.contact, tname(x.team_id), x.branch_name]) }] }
  ];
}
async function pdfReport(rep) {
  try { await loadLib(LIB.pdf); await loadLib(LIB.at); } catch (e) { return toast(e.message, true); }
  const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: rep.sections.some(s => s.cols.length > 8) ? 'l' : 'p', unit: 'mm', format: 'a4' });
  rep.sections.forEach((s, i) => {
    if (i) doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(10, 38, 71); doc.text('Canara Bank - ' + CFG.CIRCLE_NAME, 14, 14);
    doc.setFontSize(11); doc.text('Canara Premier League 4.0 - ' + rep.title + (rep.sections.length > 1 ? ' - ' + s.title : ''), 14, 21);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    let y = 27; (s.head || []).forEach(h => { doc.text(h, 14, y); y += 5; });
    doc.text('Generated on ' + new Date().toLocaleString('en-IN'), 14, y);
    doc.autoTable({ startY: y + 5, head: [s.cols], body: s.rows.map(r => r.map(String)), theme: 'grid', headStyles: { fillColor: [7, 58, 117], textColor: 255, fontSize: 9 }, alternateRowStyles: { fillColor: [242, 247, 252] },
      styles: { fontSize: 8.5, cellPadding: s.form ? 3 : 2, minCellHeight: s.form ? 9 : 0, lineColor: [150, 160, 180] },
      didParseCell: d => { if (d.section === 'body' && d.row.raw[1] === 'RESERVE PLAYERS') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [212, 175, 55]; } } });
    let fy = doc.lastAutoTable.finalY + 14; (s.foot || []).forEach(f => { doc.setTextColor(0); doc.text(f, 14, fy); fy += 8; });
  });
  const n = doc.internal.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${n}`, W - 14, H - 8, { align: 'right' }); }
  doc.save(`CPL4_${rep.key}_${stamp()}.pdf`);
}
async function xlsxReport(reps, name) {
  try { await loadLib(LIB.xlsx); } catch (e) { return toast(e.message, true); }
  const wb = XLSX.utils.book_new(), used = new Set();
  reps.forEach(rep => rep.sections.forEach(r => {
    const aoa = [['Canara Bank - ' + CFG.CIRCLE_NAME + ' - CPL 4.0'], [rep.title + (rep.sections.length > 1 ? ' - ' + r.title : '')], ...(r.head || []).map(h => [h]), [], r.cols, ...r.rows, ...(r.foot ? [[]] : []), ...(r.foot || []).map(f => [f])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = r.cols.map((c, i) => ({ wch: Math.min(42, Math.max(String(c).length + 2, ...r.rows.map(x => String(x[i] ?? '').length + 2))) }));
    let nm = (reps.length > 1 ? rep.title.split(' ')[0] + ' ' : '') + r.title; nm = nm.replace(/[\\/?*[\]:]/g, '').slice(0, 28);
    let u = nm, k = 2; while (used.has(u)) u = nm.slice(0, 25) + ' ' + k++; used.add(u);
    XLSX.utils.book_append_sheet(wb, ws, u);
  }));
  XLSX.writeFile(wb, `${name}_${stamp()}.xlsx`);
}
function reports(t) {
  const reps = buildReports();
  t.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn gold" id="allX">Download full Excel pack</button><span class="hint">${scopeTeam() ? 'Scope: ' + esc(tname(scopeTeam())) : 'Scope: all ROs / offices'}. Libraries are cached once, then exports work offline.</span></div>
  <div class="grid g2">${reps.map((r, i) => `<div class="card"><h3>${esc(r.title)}</h3><p class="small muted">${r.note ? esc(r.note) : r.sections.reduce((a, s) => a + s.rows.length, 0) + ' rows'}</p><div class="row"><button class="btn ghost sm" data-v="${i}">View</button><button class="btn sm" data-p="${i}">PDF</button><button class="btn sm" data-x="${i}">Excel</button></div></div>`).join('')}</div><div id="rview" style="margin-top:18px"></div>`;
  $('#allX').onclick = () => xlsxReport(reps.filter(r => !r.key.endsWith('forms')), 'CPL4_all_reports');
  $$('[data-p]', t).forEach(b => b.onclick = () => pdfReport(reps[b.dataset.p]));
  $$('[data-x]', t).forEach(b => b.onclick = () => xlsxReport([reps[b.dataset.x]], 'CPL4_' + reps[b.dataset.x].key));
  $$('[data-v]', t).forEach(b => b.onclick = () => {
    const r = reps[b.dataset.v];
    $('#rview').innerHTML = `<h2>${esc(r.title)}</h2>` + r.sections.map(s => `${r.sections.length > 1 ? `<h3 style="margin-top:14px">${esc(s.title)}</h3>` : ''}${(s.head || []).map(h => `<p class="small">${esc(h)}</p>`).join('')}<div class="tw"><table class="tbl"><thead><tr>${s.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(x => `<tr>${x.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.cols.length}" class="muted">No data yet.</td></tr>`}</tbody></table></div>${(s.foot || []).map(f => `<p class="small" style="margin-top:10px">${esc(f)}</p>`).join('')}`).join('');
    $('#rview').scrollIntoView({ behavior: 'smooth' });
  });
}

/* ---------- branches ---------- */
function branches(t) {
  const l = A.branches.filter(inScope), miss = l.filter(b => !normNum(b.whatsapp)).length, showTeam = !scopeTeam();
  t.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="btn gold" id="addB">+ Add branch</button><button class="btn" id="lstB">Import branch list</button><button class="btn ghost" id="impB">Import incharge numbers</button><span class="hint">${l.length} branches · ${miss} without a valid WhatsApp number</span></div>
  ${l.length ? `<div class="tw"><table class="tbl"><thead><tr><th>DP</th><th>Branch / unit</th>${showTeam ? '<th>RO / office</th>' : ''}<th>Incharge</th><th>WhatsApp</th><th></th></tr></thead><tbody>
  ${l.map(b => `<tr data-dp="${b.dp_code}"><td>${b.dp_code}</td><td>${esc(b.branch_name)}</td>${showTeam ? `<td>${esc(tname(b.team_id))}</td>` : ''}<td>${esc(b.incharge_name)}</td><td>${esc(b.whatsapp)}</td><td class="right" style="white-space:nowrap"><button class="btn ghost sm" data-e>Edit</button> <button class="btn ghost sm" data-d>Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">No branches yet for ${scopeTeam() ? esc(tname(scopeTeam())) : 'any RO'}. Use <b>Import branch list</b> to paste them from Excel.</p>`}`;
  $('#addB').onclick = () => branchForm(); $('#impB').onclick = importNumbers; $('#lstB').onclick = importList;
  $$('tr[data-dp]', t).forEach(tr => {
    const b = A.branches.find(x => String(x.dp_code) === tr.dataset.dp);
    $('[data-e]', tr).onclick = () => branchForm(b);
    $('[data-d]', tr).onclick = async () => { if (!online() || !confirm(`Delete ${b.branch_name}?`)) return; try { await db.del('cpl_branches', 'dp_code=eq.' + b.dp_code); await reload('Deleted'); } catch (e) { toast(e.message, true); } };
  });
}
function branchForm(b) {
  const edit = !!b; b = b || {};
  const tid = b.team_id || scopeTeam() || '';
  const m = openModal(`<h2>${edit ? 'Edit' : 'Add'} branch</h2><form id="bf" class="form" style="grid-template-columns:1fr">
    <div class="field"><label>DP code</label><input name="dp" type="tel" value="${esc(b.dp_code)}" ${edit ? 'readonly' : ''} required></div>
    <div class="field"><label>Branch / unit name</label><input name="name" type="text" value="${esc(b.branch_name)}" required></div>
    <div class="field"><label>RO / office</label><select name="team" ${wide() ? '' : 'disabled'}><option value="">Select</option>${teamsList().map(x => `<option value="${esc(x.id)}" ${tid === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Incharge name</label><input name="inc" type="text" value="${esc(b.incharge_name)}"></div>
    <div class="field"><label>WhatsApp number</label><input name="wa" type="tel" value="${esc(b.whatsapp)}" placeholder="10 digits"></div>
    <div class="row"><button class="btn gold" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  $('#cx', m).onclick = closeModal;
  $('#bf', m).onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const f = e.target.elements, dp = parseInt(f.dp.value, 10), team = f.team.value;
    if (!dp || !f.name.value.trim() || !team) return toast('DP code, name and RO are required', true);
    try { await db.upsert('cpl_branches', { dp_code: dp, branch_name: f.name.value.trim(), team_id: team, incharge_name: f.inc.value.trim() || null, whatsapp: f.wa.value.trim() || null, sort_order: b.sort_order || 100 }); closeModal(); await reload('Saved'); } catch (err) { toast(err.message, true); }
  };
}
function importList() {
  const team = scopeTeam();
  if (!team) return toast('Pick one RO in the “Viewing” selector first', true);
  const m = openModal(`<h2>Import branch list · ${esc(tname(team))}</h2><p class="small muted">Paste rows from Excel: <b>DP code, Branch name</b> and optionally <b>Incharge name, WhatsApp number</b> (tab or comma separated). Existing DP codes are updated.</p>
    <textarea id="paste" style="min-height:200px" placeholder="407&#9;Bengaluru Coles Road&#9;Name&#9;98xxxxxxxx"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn gold" id="go">Import</button><button class="btn ghost" id="cx">Cancel</button></div>`);
  $('#cx', m).onclick = closeModal;
  $('#go', m).onclick = async () => {
    if (!online()) return;
    const rows = $('#paste', m).value.split('\n').map(l => l.split(/\t|,/).map(x => x.trim())).filter(r => /^\d+$/.test(r[0]) && r[1]);
    if (!rows.length) return toast('No valid rows found (need DP code and branch name)', true);
    try { await db.upsert('cpl_branches', rows.map((r, i) => ({ dp_code: parseInt(r[0], 10), branch_name: r[1], team_id: team, incharge_name: r[2] || null, whatsapp: r[3] || null, sort_order: i + 1 })), 'dp_code'); closeModal(); await reload(`Imported ${rows.length} branches`); } catch (e) { toast(e.message, true); }
  };
}
function importNumbers() {
  const m = openModal(`<h2>Import incharge numbers</h2><p class="small muted">Paste rows from Excel with 3 columns: <b>DP code, Incharge name, WhatsApp number</b>. Existing branches are updated.</p>
    <textarea id="paste" style="min-height:200px" placeholder="407&#9;Name Surname&#9;98xxxxxxxx"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn gold" id="go">Import</button><button class="btn ghost" id="cx">Cancel</button></div>`);
  $('#cx', m).onclick = closeModal;
  $('#go', m).onclick = async () => {
    if (!online()) return;
    const rows = $('#paste', m).value.split('\n').map(l => l.split(/\t|,/).map(x => x.trim())).filter(r => /^\d+$/.test(r[0]));
    if (!rows.length) return toast('No valid rows found', true);
    let ok = 0, skip = 0;
    for (const r of rows) {
      const dp = parseInt(r[0], 10);
      if (!A.branches.some(b => b.dp_code === dp)) { skip++; continue; }
      try { await db.patch('cpl_branches', 'dp_code=eq.' + dp, { incharge_name: r[1] || null, whatsapp: r[2] || null }); ok++; } catch (e) { skip++; }
    }
    closeModal(); await reload(`Updated ${ok} branches` + (skip ? `, skipped ${skip}` : ''));
  };
}

/* ---------- teams & users (super admin) ---------- */
function setup(t) {
  const sup = isSuper(), list = A.admins.filter(u => sup || u.role === 'coordinator');
  t.innerHTML = `
  <section><div class="sec-h"><h2>${sup ? 'Admins' : 'RO admins'}</h2><div class="row"><button class="btn gold" id="addU">+ Add RO admin</button>${sup ? '<button class="btn" id="addC">+ Add Sub CO admin</button>' : ''}</div></div>
    <div class="banner info">${sup ? '<b>Super admin</b> creates the <b>Sub CO admin</b> (Circle Office). The <b>Sub CO admin</b> then creates the <b>RO admin</b> profile for each RO.' : '<b>As Sub CO admin you create the RO admin profile</b> for every RO of your circle. Each RO admin sees and edits only their own RO.'} The login is created right here: set a password and share it by WhatsApp.</div>
    <div class="tw"><table class="tbl"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>RO / office</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${esc(roleLabel(u.role))}</td><td>${u.team_id ? esc(tname(u.team_id)) : '-'}</td><td class="right">${u.role === 'super' || u.email.toLowerCase() === String(sb.session.email || '').toLowerCase() ? '' : `<button class="btn ghost sm" data-ue="${esc(u.email)}">Edit</button> <button class="btn ghost sm" data-ud="${esc(u.email)}">Remove</button>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="hint" style="margin-top:8px">${teamsList().filter(x => !list.some(u => u.team_id === x.id && u.role === 'coordinator')).length} RO / office(s) still have no RO admin.</p></section>
  ${sup ? `<section><div class="sec-h"><h2>Teams (ROs / offices)</h2><div class="row"><button class="btn gold" id="addT">+ Add team</button><button class="btn" id="impF">Import fixtures</button></div></div>
    <div class="tw"><table class="tbl"><thead><tr><th>Team</th><th>Type</th><th>Circle</th><th>ID</th><th></th></tr></thead><tbody>${D.pub.teams.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.kind)}</td><td>${esc((D.pub.circles.find(c => c.id === x.circle_id) || {}).name || x.circle_id)}</td><td class="small muted">${esc(x.id)}</td><td class="right"><button class="btn ghost sm" data-te="${esc(x.id)}">Edit</button> <button class="btn ghost sm" data-td="${esc(x.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>
    <p class="hint" style="margin-top:8px">To add another circle later: add its circle in <b>Add team</b> (choose “New circle”), add its ROs, then use <b>Import fixtures</b> with the Annexure-2 text.</p></section>` : ''}`;
  $('#addU').onclick = () => userForm(null, 'coordinator');
  const ac = $('#addC'); if (ac) ac.onclick = () => userForm(null, 'circle');
  if (sup) { $('#addT').onclick = () => teamForm(); $('#impF').onclick = importFixtures; }
  $$('[data-ue]', t).forEach(b => b.onclick = () => { const u = A.admins.find(x => x.email === b.dataset.ue); userForm(u, u.role); });
  $$('[data-ud]', t).forEach(b => b.onclick = async () => { if (!online() || !confirm('Remove this admin profile? The login can no longer open the admin area.')) return; try { await db.del('cpl_admins', 'email=eq.' + encodeURIComponent(b.dataset.ud)); await reload('Removed'); } catch (e) { toast(e.message, true); } });
  $$('[data-te]', t).forEach(b => b.onclick = () => teamForm(T(b.dataset.te)));
  $$('[data-td]', t).forEach(b => b.onclick = async () => { const tm = T(b.dataset.td); if (!online() || !confirm(`Delete ${tm.name}? This also deletes ALL its nominations and notices.`)) return; try { await db.del('cpl_teams', 'id=eq.' + tm.id); await loadPublic(); await reload('Deleted'); } catch (e) { toast(e.message, true); } });
}
const genPw = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = new Uint32Array(10); (window.crypto || { getRandomValues: x => x.forEach((_, i) => { x[i] = Math.random() * 4e9; }) }).getRandomValues(a); return Array.from(a, n => c[n % c.length]).join(''); };
function userForm(u, role) {
  u = u || {}; role = u.role || role || 'coordinator';
  const isNew = !u.email, circ = role === 'circle', lab = circ ? 'Sub CO admin' : 'RO admin';
  const opts = circ ? teamsList() : teamsList();
  const m = openModal(`<h2>${isNew ? 'Add' : 'Edit'} ${lab}</h2><form id="uf" class="form" style="grid-template-columns:1fr">
    <div class="field"><label>Email (their login)</label><input name="email" type="email" value="${esc(u.email)}" ${isNew ? '' : 'readonly'} required></div>
    <div class="field"><label>Name</label><input name="name" type="text" value="${esc(u.name)}"></div>
    <div class="field"><label>${circ ? 'Circle Office (decides which circle they manage)' : 'RO / office'}</label><select name="team" required><option value="">Select</option>${opts.map(x => `<option value="${esc(x.id)}" ${u.team_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    ${isNew ? `<div class="field"><label>Initial password</label><div class="row" style="flex-wrap:nowrap"><input name="pw" type="text" value="${genPw()}" minlength="8" required style="flex:1"><button class="btn ghost sm" type="button" id="gp">New</button></div><span class="hint">Shared with them after saving. They can change it from Admin &rarr; Change password.</span></div>` : ''}
    <div class="row"><button class="btn gold" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  $('#cx', m).onclick = closeModal; const gp = $('#gp', m); if (gp) gp.onclick = () => { m.querySelector('[name=pw]').value = genPw(); };
  $('#uf', m).onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const f = e.target.elements, email = f.email.value.trim().toLowerCase(); if (!email || !f.team.value) return toast('Email and RO / office are required', true);
    const row = { email, name: f.name.value.trim() || null, role, team_id: f.team.value };
    let note = '';
    try {
      if (isNew) {
        const pw = f.pw.value; if (pw.length < 8) return toast('Password needs at least 8 characters', true);
        try { const r = await sb.signUp(email, pw); if (!r.confirmed) note = 'warn'; } catch (er) { if (er.code === 'exists') note = 'exists'; else throw er; }
      }
      await db.upsert('cpl_admins', row, 'email');
      const pw = isNew ? f.pw.value : '';
      closeModal(); await reload('Saved');
      if (isNew) credModal(row, pw, note);
    } catch (err) { toast(/not allowed|disabled/i.test(err.message) ? 'Sign-ups are switched off in Supabase (Authentication > Providers > Email > Allow new users to sign up).' : err.message, true); }
  };
}
function credModal(row, pw, note) {
  const link = baseUrl() + '#/admin', who = `${roleLabel(row.role)}, ${tname(row.team_id)}`;
  const msg = `*CPL 4.0 admin login - ${who}*\n\nLink: ${link}\nEmail: ${row.email}\n${note === 'exists' ? '(Use your existing password)' : 'Password: ' + pw}\n\n${row.role === 'circle' ? 'As Sub CO admin you can create the RO admin profile for each RO (Admin > RO admins > Add RO admin).' : 'As RO admin you can select your RO team, record trials, post notices and message branches.'}\nPlease change the password after the first login (Admin > Change password).`;
  const warn = note === 'exists' ? '<div class="banner info">A login with this email already existed, so its password was not changed. The admin profile is now linked.</div>' : note === 'warn' ? '<div class="banner warn"><b>Email confirmation is ON in Supabase.</b> This login cannot sign in until the email is confirmed. Turn off Authentication &rarr; Providers &rarr; Email &rarr; Confirm email, or confirm the user in the dashboard.</div>' : '';
  const m = openModal(`<h2>Profile created</h2>${warn}<p class="small">Send these details to <b>${esc(row.name || row.email)}</b>:</p><textarea id="credTx" style="min-height:170px;width:100%">${esc(msg)}</textarea>
    <div class="row" style="margin-top:12px"><a class="btn gold" id="credWa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a><button class="btn ghost" id="credCp">Copy</button><button class="btn ghost" id="credX">Close</button></div>`);
  const ta = $('#credTx', m); ta.addEventListener('input', () => { $('#credWa', m).href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); });
  $('#credCp', m).onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { toast('Copy not allowed', true); } };
  $('#credX', m).onclick = closeModal;
}
function teamForm(x) {
  x = x || {};
  const m = openModal(`<h2>${x.id ? 'Edit' : 'Add'} team</h2><form id="tf2" class="form" style="grid-template-columns:1fr">
    <div class="field"><label>Name</label><input name="name" type="text" value="${esc(x.name)}" placeholder="e.g. Hassan RO" required></div>
    <div class="field"><label>Type</label><select name="kind">${['RO', 'CO', 'HO'].map(k => `<option ${x.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    <div class="field"><label>Circle</label><select name="circle">${D.pub.circles.map(c => `<option value="${esc(c.id)}" ${x.circle_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">New circle…</option></select></div>
    <div class="field hide" id="ncWrap"><label>New circle name</label><input name="ncname" type="text" placeholder="e.g. Mangalore Circle"></div>
    <div class="row"><button class="btn gold" type="submit">Save</button><button class="btn ghost" type="button" id="cx">Cancel</button></div></form>`);
  const f = $('#tf2', m); $('#cx', m).onclick = closeModal;
  f.elements.circle.onchange = () => $('#ncWrap', m).classList.toggle('hide', f.elements.circle.value !== '__new');
  f.onsubmit = async e => {
    e.preventDefault(); if (!online()) return;
    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = f.elements.name.value.trim(); if (!name) return toast('Name is required', true);
    try {
      let cid = f.elements.circle.value;
      if (cid === '__new') { const cn = f.elements.ncname.value.trim(); if (!cn) return toast('Enter the circle name', true); cid = slug(cn); await db.upsert('cpl_circles', { id: cid, name: cn, sort_order: D.pub.circles.length + 1 }); }
      await db.upsert('cpl_teams', { id: x.id || slug(name), circle_id: cid, name, kind: f.elements.kind.value, sort_order: x.sort_order || D.pub.teams.length + 1 });
      closeModal(); await loadPublic(); await reload('Saved');
    } catch (err) { toast(err.message, true); }
  };
}
function importFixtures() {
  const m = openModal(`<h2>Import fixtures</h2><p class="small muted">Paste the Annexure-2 schedule for one circle. One match per line, like <b>M1 DEVANAHALLI RO VS MYSURU RURAL RO</b> or <b>M7 WINNER MATCH 1 VS WINNER MATCH 2</b>. Team names must already exist. The same bracket is created for cricket and badminton; existing matches are updated.</p>
    <div class="field"><label>Circle</label><select id="ic">${D.pub.circles.map(c => `<option value="${esc(c.id)}" ${c.id === D.circle ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <textarea id="paste" style="min-height:220px;margin-top:10px"></textarea><div id="ierr" class="small" style="color:var(--bad);margin-top:6px"></div>
    <div class="row" style="margin-top:12px"><button class="btn gold" id="go">Import</button><button class="btn ghost" id="cx">Cancel</button></div>`, true);
  $('#cx', m).onclick = closeModal;
  $('#go', m).onclick = async () => {
    if (!online()) return;
    const cid = $('#ic', m).value, teams = D.pub.teams.filter(x => x.circle_id === cid), norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, ''), strip = s => norm(s).replace(/(ro|co)$/, '');
    const find = n => teams.find(x => norm(x.name) === norm(n)) || teams.find(x => strip(x.name) === strip(n));
    const errs = [], out = [];
    $('#paste', m).value.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      const mm = line.match(/^M\s*(\d+)\s+(.+?)\s+VS\s+(.+)$/i); if (!mm) { errs.push('Cannot read: ' + line); return; }
      const side = s => { const w = s.trim().match(/^WINNER\s+MA\w*\s*(\d+)$/i); if (w) return { src: parseInt(w[1], 10) }; const tm = find(s.trim()); return tm ? { team: tm.id } : null; };
      const a = side(mm[2]), b = side(mm[3]);
      if (!a || !b) { errs.push(`Unknown team in: ${line}`); return; }
      ['cricket', 'badminton'].forEach(sp => out.push({ circle_id: cid, sport: sp, match_no: parseInt(mm[1], 10), team_a: a.team || null, src_a: a.src || null, team_b: b.team || null, src_b: b.src || null }));
    });
    if (errs.length) { $('#ierr', m).innerHTML = esc(errs.join(' | ')); return; }
    if (!out.length) return toast('Nothing to import', true);
    try { await db.upsert('cpl_fixtures', out, 'circle_id,sport,match_no'); closeModal(); await loadPublic(); await reload(`Imported ${out.length / 2} matches`); } catch (e) { toast(e.message, true); }
  };
}

window.CPL.pages.admin = renderAdmin;
})();

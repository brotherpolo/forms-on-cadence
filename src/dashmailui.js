// Dashboards → Email schedule (administrators): email a dashboard every weekday, week or month to
// people, roles and other addresses. The server sends it (Cadence's functions, dashMailer) from
// dashMails/{dashboardId}; "Send a test to me" sends one now (dashMailTest).
import { esc, toast } from './ui.js';
import { store, saveDashMail, deleteDashMail, testDashMail } from './store.js';
import { FREQS, DAYS, scheduleText } from './dashmail.js';

let M = null; // { id, name, d: draft, busy, err, armed }
const root = () => { let r = document.getElementById('dm-root'); if (!r) { r = document.createElement('div'); r.id = 'dm-root'; document.body.appendChild(r); } return r; };
const nameOf = (u) => store.profiles?.[u.id]?.displayName || u.displayName || (u.email || '').split('@')[0] || 'Someone';
const hours = () => Array.from({ length: 24 }, (_, h) => [h, `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`]);

export function initDashMail() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-dm]');
    if (!el) return;
    e.stopPropagation();
    onClick(el, e);
  }, true);
  document.addEventListener('change', (e) => { const el = e.target; if (M && el.closest?.('#dm-root') && el.dataset?.dmf) { e.stopPropagation(); onField(el); } }, true);
  document.addEventListener('input', (e) => { const el = e.target; if (M && el.dataset?.dmf === 'addresses') { e.stopPropagation(); M.d.to.addresses = el.value; } }, true);
  document.addEventListener('keydown', (e) => { if (M && e.key === 'Escape' && !M.busy) { e.preventDefault(); e.stopPropagation(); close(); } }, true);
}

/** The dashboard header's button: "Email schedule", or what it's set to. Administrators only. */
export function headerButton(dash) {
  const s = store.dashMails?.[dash.id];
  const on = !!s?.on;
  return `<button type="button" class="db-home${on ? ' on' : ''}" data-dm="open" data-v="${esc(dash.id)}" title="${on ? esc(scheduleText(s)) : 'Email this dashboard on a schedule'}">✉ ${on ? esc(scheduleText(s)) : 'Email schedule'}</button>`;
}

function open(id) {
  const dash = (store.dashboards || []).find((x) => x.id === id);
  if (!dash) return;
  const s = store.dashMails?.[id];
  M = { id, name: dash.name || 'Dashboard', busy: false, err: '', armed: false, exists: !!s,
    d: s ? { on: !!s.on, freq: s.freq || 'weekly', day: s.day ?? 1, hour: s.hour ?? 8, to: { people: [...(s.to?.people || [])], roles: [...(s.to?.roles || [])], addresses: s.to?.addresses || '' }, createdAt: s.createdAt || null, last: s.lastAt ? { at: s.lastAt, status: s.lastStatus || '', n: (s.lastTo || []).length } : null }
      : { on: true, freq: 'weekly', day: 1, hour: 8, to: { people: [store.user?.uid].filter(Boolean), roles: [], addresses: '' }, createdAt: null, last: null } };
  paint();
  setTimeout(() => root().querySelector('[data-dmf="freq"]')?.focus(), 0);
}
function close() { M = null; root().innerHTML = ''; }

function paint() {
  const r = root();
  if (!M) { r.innerHTML = ''; return; }
  const d = M.d;
  const users = [...(store.users || [])].filter((u) => u.email && !store.profiles?.[u.id]?.removed).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const roles = [...(store.roles || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const dayPick = d.freq === 'weekly' ? `<label class="dm-l"><span>On</span><select class="in" data-dmf="day">${DAYS.map((n, i) => `<option value="${i}"${+d.day === i ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`
    : d.freq === 'monthly' ? `<label class="dm-l"><span>On day</span><select class="in" data-dmf="day">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => `<option value="${n}"${+d.day === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` : '';
  const last = d.last ? `<p class="help">Last sent ${esc(new Date(d.last.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${d.last.status && d.last.status !== 'sent' ? ` · <b class="dm-bad">${esc(d.last.status)}</b>` : d.last.n ? ` to ${d.last.n} ${d.last.n === 1 ? 'person' : 'people'}` : ''}.</p>` : '';
  r.innerHTML = `<div class="lv-scrim" data-dm="scrim"><div class="lv-dlg dm-dlg" role="dialog" aria-modal="true" aria-labelledby="dm-h">
    <h2 id="dm-h">Email “${esc(M.name)}”</h2>
    <p class="help">The dashboard’s reports, as of that morning, with its saved period. Charts arrive as small tables any email program can show.</p>
    <label class="switch dm-on"><input type="checkbox" data-dmf="on"${d.on ? ' checked' : ''}><span class="tr"></span><span>Send it on a schedule</span></label>
    <fieldset class="dm-f"${d.on ? '' : ' disabled'}>
      <div class="dm-row"><label class="dm-l"><span>How often</span><select class="in" data-dmf="freq">${FREQS.map(([k, l]) => `<option value="${k}"${d.freq === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${dayPick}
        <label class="dm-l"><span>At</span><select class="in" data-dmf="hour">${hours().map(([h, l]) => `<option value="${h}"${+d.hour === h ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <p class="help dm-sum">${esc(scheduleText(d))} (Eastern time).</p>
      <div class="dm-l"><span>People</span><div class="dm-list">${users.map((u) => `<label class="opt"><input type="checkbox" data-dmf="person" value="${esc(u.id)}"${d.to.people.includes(u.id) ? ' checked' : ''}>${esc(nameOf(u))}</label>`).join('') || '<p class="help">No one yet.</p>'}</div></div>
      ${roles.length ? `<div class="dm-l"><span>Roles <small class="help">everyone in them, at the time</small></span><div class="dm-list dm-roles">${roles.map((x) => `<label class="opt"><input type="checkbox" data-dmf="role" value="${esc(x.id)}"${d.to.roles.includes(x.id) ? ' checked' : ''}>${esc(x.name || 'Untitled role')}</label>`).join('')}</div></div>` : ''}
      <label class="dm-l"><span>Other email addresses</span><input class="in" data-dmf="addresses" value="${esc(d.to.addresses)}" placeholder="name@example.com, …" autocomplete="off"></label>
      <p class="help dm-warn">Everyone it goes to sees these numbers, even for forms they can’t open in Formwright.</p>
    </fieldset>
    ${last}
    ${M.err ? `<p class="err" role="alert">${esc(M.err)}</p>` : ''}
    <div class="lv-dlgacts"><button type="button" class="btn" data-dm="test"${M.busy ? ' disabled' : ''}>${M.busy === 'test' ? 'Sending…' : 'Send a test to me'}</button><span class="grow"></span>
      <button type="button" class="btn ghost" data-dm="cancel"${M.busy ? ' disabled' : ''}>Cancel</button><button type="button" class="btn primary" data-dm="save"${M.busy ? ' disabled' : ''}>${M.busy === 'save' ? 'Saving…' : 'Save'}</button></div>
  </div></div>`;
}

function onField(el) {
  const d = M.d, k = el.dataset.dmf;
  if (k === 'on') d.on = el.checked;
  else if (k === 'freq') { d.freq = el.value; d.day = el.value === 'monthly' ? 1 : el.value === 'weekly' ? 1 : d.day; }
  else if (k === 'day') d.day = +el.value;
  else if (k === 'hour') d.hour = +el.value;
  else if (k === 'person' || k === 'role') { const key = k === 'person' ? 'people' : 'roles'; const set = new Set(d.to[key]); if (el.checked) set.add(el.value); else set.delete(el.value); d.to[key] = [...set]; return; }
  else if (k === 'addresses') { d.to.addresses = el.value; return; }
  M.err = ''; paint(); root().querySelector(`[data-dmf="${k}"]`)?.focus();
}

const goodAddr = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean);
async function save() {
  const d = M.d;
  const bad = goodAddr(d.to.addresses).filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (bad.length) { M.err = `That doesn’t look like an email address: ${bad[0]}`; paint(); return; }
  if (d.on && !d.to.people.length && !d.to.roles.length && !goodAddr(d.to.addresses).length) { M.err = 'Pick who it goes to.'; paint(); return; }
  M.busy = 'save'; M.err = ''; paint();
  try {
    await saveDashMail(M.id, { on: d.on, freq: d.freq, day: +d.day || 0, hour: +d.hour || 0, to: { people: d.to.people, roles: d.to.roles, addresses: goodAddr(d.to.addresses).join(', ').slice(0, 2000) }, createdAt: d.createdAt });
    toast(d.on ? `Saved. ${scheduleText(d)}.` : 'Saved. It won’t be emailed.');
    close();
  } catch (e) {
    console.error('[formwright] dashboard email', e);
    M.busy = false; M.err = e?.code === 'permission-denied' ? 'That wasn’t allowed: the latest Cadence security rules may not be deployed yet.' : 'Saving didn’t work. Check your connection and try again.'; paint();
  }
}
async function test() {
  M.busy = 'test'; M.err = ''; paint();
  try {
    const r = await testDashMail(M.id);
    toast(`Sent to ${r?.to || 'you'}. It can take a minute to arrive.`);
    M.busy = false; paint();
  } catch (e) {
    console.error('[formwright] dashboard email test', e);
    M.busy = false;
    M.err = e?.code === 'functions/not-found' || /not.?found/i.test(e?.message || '') ? 'The email service isn’t set up yet: deploy the Cadence functions first (see the install steps).' : 'The test didn’t send: ' + (e?.message || 'unknown error') + '.';
    paint();
  }
}

function onClick(el, e) {
  const a = el.dataset.dm;
  if (a === 'open') { open(el.dataset.v); return; }
  if (!M) return;
  if (a === 'scrim') { if (e.target === el && !M.busy) close(); return; }
  if (a === 'cancel') { if (!M.busy) close(); return; }
  if (a === 'save') { if (!M.busy) save(); return; }
  if (a === 'test') { if (!M.busy) test(); }
}
export const isOpen = () => !!M;
export { deleteDashMail };

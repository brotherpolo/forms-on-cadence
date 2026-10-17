// My work → All mentions and All tasks (administrators only).
// All mentions: every @mention, who it was for, who wrote it, on which record, read or not.
// Opening one shows the comment without marking it read for the person it was meant for.
// All tasks: Cadence tasks linked to Formwright records (people's own tasks stay private), with
// Reassign: give one or several to someone else, or back to their owner. The owner stays.
import { esc, badge } from './ui.js';
import { watchAllMentions, watchRecordTasks, reassignTasks } from './store.js';
import { reassignPatch, alreadyWith, dueInfo, dateKey } from './tasks.js';
import { assignablePeople, roleChoices, open as openTask } from './taskmodal.js';
import { ago, avatarColor, initials } from './commentlogic.js';
import { filterMentions, filterTasks, sortTasks, holder } from './allworklogic.js';
import { pickerHTML, pickerFilter, pickerKey, pickerFocus } from './peoplepick.js';
import { openCounts } from './pickerlogic.js';

let H = null; // { store, recById, formById, recTitle, view(), showComment(recordId, commentId), openRecord(id), toast, renderMain, isAdmin() }
const A = { m: null, mList: [], mReady: false, mErr: false, t: null, tList: [], tReady: false, tErr: false,
  mf: { who: '', unread: false }, tf: { who: '', form: '', status: 'open' }, sel: new Set(), dlg: null };

export function initAllWork(helpers) {
  H = helpers;
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-aw]');
    if (!el) return;
    e.stopPropagation();
    onClick(el, e);
  }, true);
  document.addEventListener('change', (e) => { const el = e.target; if (el.dataset?.awf) { e.stopPropagation(); onFilter(el); } }, true);
  // the Reassign pop-up's person picker
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('#aw-root [data-pk="pick"]');
    if (!el || !A.dlg || A.dlg.busy || el.disabled) return;
    e.stopPropagation();
    A.dlg.who = el.dataset.v; paintDlg(); pickerFocus(dlgRoot(), A.dlg.who);
  }, true);
  document.addEventListener('input', (e) => { const el = e.target; if (A.dlg && el.dataset?.pkQ && el.closest('#aw-root')) { e.stopPropagation(); A.dlg.q = el.value; pickerFilter(el); } }, true);
  document.addEventListener('keydown', (e) => {
    if (!A.dlg) return;
    if (e.key === 'Escape' && !A.dlg.busy) { e.preventDefault(); e.stopPropagation(); A.dlg = null; paintDlg(); return; }
    if (e.target.closest?.('#aw-root')) { if (pickerKey(e)) e.stopPropagation(); else if (e.key === 'Enter' && e.target.dataset?.pkQ) { e.preventDefault(); const first = dlgRoot().querySelector('.pk-opt:not([hidden]):not([disabled])'); if (first) first.click(); } }
  }, true);
}
const onTab = (tab) => H.view().name === 'mywork' && H.tab() === tab;
/** Start listening once an administrator opens one of the tabs. */
export function start(tab) {
  if (!H.isAdmin()) return;
  if (tab === 'allm' && !A.m) A.m = watchAllMentions((l) => { A.mList = l; A.mReady = true; A.mErr = false; if (onTab('allm')) H.renderMain(); }, (e) => { console.warn('[formwright] all mentions', e?.code || e); A.mReady = true; A.mErr = true; if (onTab('allm')) H.renderMain(); });
  if (tab === 'allt' && !A.t) A.t = watchRecordTasks((l) => { A.tList = l; A.tReady = true; A.tErr = false; const ids = new Set(l.map((x) => x.id)); [...A.sel].forEach((id) => { if (!ids.has(id)) A.sel.delete(id); }); if (onTab('allt')) H.renderMain(); }, (e) => { console.warn('[formwright] all tasks', e?.code || e); A.tReady = true; A.tErr = true; if (onTab('allt')) H.renderMain(); });
}
export function stop() { A.m?.(); A.t?.(); Object.assign(A, { m: null, mList: [], mReady: false, t: null, tList: [], tReady: false, sel: new Set(), dlg: null }); paintDlg(); }

const nameOf = (uid, fb) => H.store.profiles?.[uid]?.displayName || fb || 'Someone';
const people = () => Object.entries(H.store.profiles || {}).filter(([, p]) => p && !p.removed).map(([uid, p]) => ({ uid, name: p.displayName || p.email || 'Someone' })).sort((a, b) => a.name.localeCompare(b.name));
const av = (uid, name) => String(uid).startsWith('role:') ? '<span class="cm-av sm pk-ic" aria-hidden="true">◉</span>' : `<span class="cm-av sm" style="background:${avatarColor(uid)}" aria-hidden="true">${esc(initials(name))}</span>`;
const denied = (msg) => `<div class="panel empty"><h2>Couldn’t load this</h2><p>${msg} The latest Cadence security rules may not be deployed yet.</p></div>`;
const recLabel = (recordId, fallback) => { const r = H.recById(recordId), f = r && H.formById(r.formId); return { rec: r, form: f, title: r && f ? H.recTitle(r, f) : fallback || 'a record' }; };

/* ---------- All mentions ---------- */
export function allMentionsHTML() {
  start('allm');
  if (A.mErr) return denied('Everyone’s mentions couldn’t be read.');
  if (!A.mReady) return '<div class="panel"><p class="note">Loading mentions…</p></div>';
  const list = filterMentions(A.mList, A.mf);
  const unread = A.mList.filter((m) => !m.read).length;
  const ppl = people();
  const bar = `<div class="aw-bar"><label class="aw-f"><span>Person</span><select class="in" data-awf="m-who"><option value="">Everyone</option>${ppl.map((p) => `<option value="${esc(p.uid)}"${A.mf.who === p.uid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="aw-chk"><input type="checkbox" data-awf="m-unread"${A.mf.unread ? ' checked' : ''}> Unread only</label>
    <span class="grow help">${list.length} of ${A.mList.length}${unread ? ` · ${unread} unread` : ''}</span></div>`;
  if (!list.length) return `${bar}<div class="panel empty"><h2>No mentions${A.mf.who || A.mf.unread ? ' match' : ' yet'}</h2><p>When someone types @ and a name in a comment, it shows up here.</p></div>`;
  const row = (m) => {
    const { title, form } = recLabel(m.recordId, m.recordTitle);
    const to = nameOf(m.to), by = nameOf(m.by, m.byName);
    return `<tr data-aw="m-open" data-id="${esc(m.id)}" class="${m.read ? '' : 'aw-unread'}" tabindex="0">
      <td><span class="aw-who">${av(m.to, to)}${esc(to)}</span>${m.role ? `<small class="help"> via ${esc(m.role)}</small>` : ''}</td><td><span class="aw-who">${av(m.by, by)}${esc(by)}</span></td>
      <td>${form ? badge(form) : ''}<span class="aw-rec">${esc(title)}</span></td><td class="aw-snip">${esc(m.snippet || '')}</td>
      <td class="aw-when" title="${esc(new Date(m.at || 0).toLocaleString())}">${esc(ago(m.at || 0))}</td>
      <td>${m.read ? '<span class="aw-st">Read</span>' : '<span class="aw-st un">Unread</span>'}</td></tr>`;
  };
  // phones: one card per mention (tables are hidden below 640px)
  const card = (m) => {
    const { title, form } = recLabel(m.recordId, m.recordTitle);
    const to = nameOf(m.to), by = nameOf(m.by, m.byName);
    return `<button type="button" class="card aw-card${m.read ? '' : ' aw-unread'}" data-aw="m-open" data-id="${esc(m.id)}">
      <span class="aw-ch"><span class="aw-who">${av(m.by, by)}<b>${esc(by)}</b></span><span class="aw-arrow" aria-hidden="true">→</span><span class="aw-who">${av(m.to, to)}<b>${esc(to)}</b></span>${m.read ? '<span class="aw-st">Read</span>' : '<span class="aw-st un">Unread</span>'}</span>
      <span class="aw-csnip">${esc(m.snippet || '')}</span>
      <span class="meta"><span class="aw-recl">${form ? badge(form) : ''}${esc(title)}</span><span>${esc(ago(m.at || 0))}</span></span></button>`;
  };
  return `${bar}<div class="panel"><div class="tblwrap"><table class="tbl aw-tbl"><thead><tr><th>To</th><th>From</th><th>Record</th><th>Comment</th><th>When</th><th>Status</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
    <div class="cards aw-cards">${list.map(card).join('')}</div></div>
    <p class="help">Opening one shows the comment; it stays unread for the person it was meant for.</p>`;
}

/* ---------- All tasks ---------- */
export function allTasksHTML() {
  start('allt');
  if (A.tErr) return denied('Tasks linked to records couldn’t be read.');
  if (!A.tReady) return '<div class="panel"><p class="note">Loading tasks…</p></div>';
  const today = dateKey(new Date());
  const list = sortTasks(filterTasks(A.tList, A.tf), today);
  const ppl = people();
  const forms = [...new Set(A.tList.map((t) => t.formId).filter(Boolean))].map((id) => H.formById(id)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const nOpen = A.tList.filter((t) => !t.done).length, nLate = A.tList.filter((t) => !t.done && t.due && t.due < today).length;
  const sel = [...A.sel].filter((id) => list.some((t) => t.id === id));
  const bar = `<div class="aw-bar"><label class="aw-f"><span>Person</span><select class="in" data-awf="t-who"><option value="">Everyone</option>${ppl.map((p) => `<option value="${esc(p.uid)}"${A.tf.who === p.uid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}${(H.store.roles || []).length ? `<optgroup label="Roles">${[...H.store.roles].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((r) => `<option value="role:${esc(r.id)}"${A.tf.who === 'role:' + r.id ? ' selected' : ''}>${esc(r.name || 'Untitled role')}</option>`).join('')}</optgroup>` : ''}</select></label>
    <label class="aw-f"><span>Form</span><select class="in" data-awf="t-form"><option value="">All forms</option>${forms.map((f) => `<option value="${esc(f.id)}"${A.tf.form === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <div class="segs" role="group" aria-label="Status">${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button type="button" class="${A.tf.status === k ? 'on' : ''}" aria-pressed="${A.tf.status === k}" data-aw="t-status" data-v="${k}">${l}</button>`).join('')}</div>
    <span class="grow help">${list.length} shown · ${nOpen} open${nLate ? ` · <b class="aw-late">${nLate} overdue</b>` : ''}</span></div>
    ${sel.length ? `<div class="aw-selbar" role="region" aria-label="Selected tasks"><b>${sel.length} selected</b><button type="button" class="btn sm primary" data-aw="t-reassign-sel">Reassign…</button><button type="button" class="btn sm ghost" data-aw="t-clear">Clear</button></div>` : ''}`;
  if (!list.length) return `${bar}<div class="panel empty"><h2>No tasks${A.tf.who || A.tf.form || A.tf.status !== 'open' ? ' match' : ' open'}</h2><p>Cadence tasks linked to records show up here. People’s own tasks without a record stay private.</p></div>`;
  const all = list.length && sel.length === list.length;
  const row = (t) => {
    const { title, form, rec } = recLabel(t.recordId, t.recordSnap?.title);
    const h = holder(t), due = t.due ? dueInfo(t.due, today) : null, late = !t.done && t.due && t.due < today;
    return `<tr class="aw-trow${t.done ? ' aw-done' : ''}${late ? ' aw-over' : ''}" data-aw="t-row" data-id="${esc(t.id)}" title="Open this task">
      <td class="aw-cb"><input type="checkbox" data-aw="t-sel" data-id="${esc(t.id)}" aria-label="Select ${esc(t.title || 'task')}"${A.sel.has(t.id) ? ' checked' : ''}></td>
      <td class="aw-title"><button type="button" class="aw-tbtn" data-aw="t-row" data-id="${esc(t.id)}">${esc(t.title || 'Untitled task')}</button></td>
      <td>${rec ? `<button type="button" class="aw-link" data-aw="t-open" data-id="${esc(t.recordId)}">${form ? badge(form) : ''}${esc(title)}</button>` : `<span class="help">${esc(title)} (removed)</span>`}</td>
      <td><span class="aw-who">${av(h.uid, h.name)}${esc(h.name)}${t.assigneeId || t.assigneeRole ? '' : ' <small class="help">(owner)</small>'}</span>${t.done && t.doneByName ? `<small class="help aw-doneby">Done by ${esc(t.doneByName)}</small>` : ''}</td>
      <td>${esc(t.ownerName || t.ownerEmail || 'Someone')}</td>
      <td>${due ? `<span class="aw-due ${late ? 'late' : due.tone}">${esc(due.text)}</span>` : '<span class="help">–</span>'}</td>
      <td>${t.done ? '<span class="aw-st">Done</span>' : '<span class="aw-st un">Open</span>'}</td>
      <td class="aw-act"><button type="button" class="btn sm" data-aw="t-reassign" data-id="${esc(t.id)}">Reassign…</button></td></tr>`;
  };
  // phones: one card per task (tables are hidden below 640px)
  const card = (t) => {
    const { title, form, rec } = recLabel(t.recordId, t.recordSnap?.title);
    const h = holder(t), due = t.due ? dueInfo(t.due, today) : null, late = !t.done && t.due && t.due < today;
    return `<div class="card aw-card aw-tcard${t.done ? ' aw-done' : ''}" data-aw="t-row" data-id="${esc(t.id)}">
      <div class="aw-ch"><input type="checkbox" data-aw="t-sel" data-id="${esc(t.id)}" aria-label="Select ${esc(t.title || 'task')}"${A.sel.has(t.id) ? ' checked' : ''}><button type="button" class="aw-tbtn aw-title" data-aw="t-row" data-id="${esc(t.id)}">${esc(t.title || 'Untitled task')}</button>${t.done ? '<span class="aw-st">Done</span>' : '<span class="aw-st un">Open</span>'}</div>
      <div>${rec ? `<button type="button" class="aw-link" data-aw="t-open" data-id="${esc(t.recordId)}">${form ? badge(form) : ''}${esc(title)}</button>` : `<span class="help">${esc(title)} (removed)</span>`}</div>
      <div class="meta"><span class="aw-who">${av(h.uid, h.name)}${esc(h.name)}${t.assigneeId || t.assigneeRole ? '' : ' (owner)'}</span>${t.done && t.doneByName ? `<span>Done by ${esc(t.doneByName)}</span>` : ''}${t.assigneeId || t.assigneeRole ? `<span>From ${esc(t.ownerName || t.ownerEmail || 'someone')}</span>` : ''}${due ? `<span class="aw-due ${late ? 'late' : due.tone}">${esc(due.text)}</span>` : ''}</div>
      <div class="aw-cact"><button type="button" class="btn sm" data-aw="t-reassign" data-id="${esc(t.id)}">Reassign…</button></div></div>`;
  };
  return `${bar}<div class="panel"><div class="tblwrap"><table class="tbl aw-tbl aw-tasks"><thead><tr><th class="aw-cb"><input type="checkbox" data-aw="t-all" aria-label="Select all shown"${all ? ' checked' : ''}></th><th>Task</th><th>Record</th><th>Assigned to</th><th>Owner</th><th>Due</th><th>Status</th><th><span class="sr">Reassign</span></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
    <div class="cards aw-cards"><label class="aw-call"><input type="checkbox" data-aw="t-all"${all ? ' checked' : ''}> Select all shown</label>${list.map(card).join('')}</div></div>
    <p class="help">Only Cadence tasks linked to records are listed. Reassigning changes who does it; each task’s owner still sees it.</p>`;
}

/* ---------- Reassign pop-up ---------- */
function dlgRoot() { let r = document.getElementById('aw-root'); if (!r) { r = document.createElement('div'); r.id = 'aw-root'; document.body.appendChild(r); } return r; }
function paintDlg() {
  const r = dlgRoot(), d = A.dlg;
  if (!d) { r.innerHTML = ''; return; }
  const tasks = d.ids.map((id) => A.tList.find((t) => t.id === id)).filter(Boolean);
  const one = tasks.length === 1 ? tasks[0] : null;
  const owners = [...new Set(tasks.map((t) => t.ownerName || t.ownerEmail || 'the owner'))];
  r.innerHTML = `<div class="lv-scrim" data-aw="scrim"><div class="lv-dlg aw-dlg" role="dialog" aria-modal="true" aria-labelledby="aw-h">
    <h2 id="aw-h">${one ? `Reassign “${esc(one.title || 'Untitled task')}”` : `Reassign ${tasks.length} tasks`}</h2>
    ${one ? `<p class="help">Now with <b>${esc(holder(one).name)}</b>. Owner: ${esc(one.ownerName || one.ownerEmail || 'someone')}.</p>` : `<p class="help">Owners: ${esc(owners.slice(0, 4).join(', '))}${owners.length > 4 ? '…' : ''}.</p>`}
    ${d.loading ? '<p class="note">Loading people…</p>' : `<div class="mail-l"><span class="mlab" id="aw-give">Give ${one ? 'it' : 'them'} to</span>
      ${pickerHTML({ id: 'aw', label: `Give ${one ? 'it' : 'them'} to`, people: d.people, sel: d.who, q: d.q, counts: openCounts(A.tList),
        pinned: [{ uid: '__owner', name: one ? `Back to ${one.ownerName || one.ownerEmail || 'the owner'} (owner)` : 'Back to each task’s owner', ok: true, icon: '↩' }],
        roles: d.roles, exclude: one ? [one.ownerId, holder(one).uid] : [] })}</div>
      <p class="help">They get Cadence’s “assigned to you” notice. The owner stays the same and still sees ${one ? 'it' : 'them'}. It’s noted in the audit trail.</p>`}
    ${d.err ? `<p class="err" role="alert">${esc(d.err)}</p>` : ''}
    <div class="lv-dlgacts"><button type="button" class="btn ghost" data-aw="d-cancel"${d.busy ? ' disabled' : ''}>Cancel</button><button type="button" class="btn primary" data-aw="d-save"${d.busy || !d.who ? ' disabled' : ''}>${d.busy ? 'Reassigning…' : 'Reassign'}</button></div>
  </div></div>`;
  if (d.loading) r.querySelector('.aw-dlg')?.focus?.();
}
async function openDlg(ids) {
  if (!ids.length) return;
  A.dlg = { ids, loading: true, people: [], who: '', q: '', busy: false, err: '' };
  paintDlg();
  let ppl = [];
  try { ppl = await assignablePeople(); } catch (e) { console.error(e); }
  if (!A.dlg) return;
  A.dlg.people = ppl.map((p) => ({ ...p, ok: !!p.ok })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  A.dlg.roles = roleChoices();
  A.dlg.loading = false;
  paintDlg();
  pickerFocus(dlgRoot(), '', true);
}
async function saveDlg() {
  const d = A.dlg;
  if (!d || !d.who || d.busy) return;
  const me = H.store.user?.uid, now = Date.now();
  const target = d.who === '__owner' ? null : d.people.find((p) => p.uid === d.who) || (d.roles || []).find((r) => r.uid === d.who);
  if (d.who !== '__owner' && (!target || !target.ok)) return;
  const tasks = d.ids.map((id) => A.tList.find((t) => t.id === id)).filter(Boolean);
  const pairs = tasks.filter((t) => !alreadyWith(t, target)).map((t) => [t.id, reassignPatch(t, target, me, now)]);
  d.busy = true; d.err = ''; paintDlg();
  try {
    if (pairs.length) await reassignTasks(pairs);
    const to = target ? target.name.split(' ')[0] : 'their owners';
    const tn = target ? (target.role ? target.name : target.name.split(' ')[0]) : null;
    H.toast(!pairs.length ? 'Nothing to change: already with them.' : pairs.length === 1 ? `Reassigned to ${tn || (tasks[0].ownerName || 'the owner').split(' ')[0]}` : `${pairs.length} tasks reassigned to ${tn || to}`);
    A.sel.clear(); A.dlg = null; paintDlg(); H.renderMain();
  } catch (e) {
    console.error('[formwright] reassign', e);
    d.busy = false;
    d.err = e?.code === 'permission-denied' ? 'Cadence didn’t allow that: the latest Cadence security rules may not be deployed yet, or that person can’t be given tasks.' : 'That didn’t work. Check your connection and try again.';
    paintDlg();
  }
}

/* ---------- events ---------- */
function onClick(el, e) {
  const a = el.dataset.aw, id = el.dataset.id;
  if (a === 'm-open') { const m = A.mList.find((x) => x.id === id); if (m) H.showComment(m.recordId, m.commentId); return; }
  if (a === 't-open') { H.openRecord(id); return; }
  if (a === 't-status') { A.tf.status = el.dataset.v; H.renderMain(); return; }
  if (a === 't-sel') { if (el.checked) A.sel.add(id); else A.sel.delete(id); H.renderMain(); [...document.querySelectorAll(`[data-aw="t-sel"][data-id="${CSS.escape(id)}"]`)].find((x) => x.offsetParent)?.focus(); return; }
  if (a === 't-all') { const shown = sortTasks(filterTasks(A.tList, A.tf), dateKey(new Date())); if (el.checked) shown.forEach((t) => A.sel.add(t.id)); else A.sel.clear(); H.renderMain(); return; }
  if (a === 't-clear') { A.sel.clear(); H.renderMain(); return; }
  if (a === 't-reassign') { openDlg([id]); return; }
  if (a === 't-row') {
    if (e.target.closest?.('input,select,a,label') && !e.target.closest('.aw-tbtn')) return;
    const t = A.tList.find((x) => x.id === id); if (!t) return;
    const rec = t.recordId && H.recById(t.recordId);
    openTask(t.recordId, t.id, { task: t, reassign: () => openDlg([t.id]), openRecord: rec ? () => H.openRecord(t.recordId) : null });
    return;
  }
  if (a === 't-reassign-sel') { openDlg([...A.sel].filter((x) => A.tList.some((t) => t.id === x))); return; }
  if (a === 'd-cancel' || (a === 'scrim' && e.target === el && !A.dlg?.busy)) { A.dlg = null; paintDlg(); return; }
  if (a === 'd-save') saveDlg();
}
function onFilter(el) {
  const k = el.dataset.awf;
  if (k === 'm-who') A.mf.who = el.value;
  else if (k === 'm-unread') A.mf.unread = el.checked;
  else if (k === 't-who') A.tf.who = el.value;
  else if (k === 't-form') A.tf.form = el.value;
  H.renderMain();
  document.querySelector(`[data-awf="${k}"]`)?.focus();
}
// keyboard: Enter on a mention row opens it
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.dataset?.aw === 'm-open') { e.preventDefault(); e.target.click(); } });

// Cadence tasks in a Formwright pop-up: add one to a record, open one to edit it, tick it off, delete it.
// It reads and writes the same task documents Cadence does (tasks.js builds them; Cadence's security
// rules check every write), so a task added here shows in Cadence at once, and the other way round.
import { esc, colorOf } from './ui.js';
import { pickerHTML, pickerFilter, pickerKey, pickerFocus } from './peoplepick.js';
import { avatarColor, initials } from './commentlogic.js';
import { normEmail, reassignPatch, passChoices, cadenceLists, mapNodes, newTaskDoc, editPatch, nextOccurrence, assignChoices, donePatch, cadenceLink, dateKey, REPEAT_CHOICES, taskRefusal } from './tasks.js';
import { loadCadenceItems, assignableUids, writeTasks, updateTask, deleteTask, taskCheckReads, probeTask } from './store.js';

let H = null;   // { store, recById, formById, recTitle, toast, cadenceUrl, tasks() }
let M = null;   // the open pop-up
export function initTaskModal(helpers) {
  H = helpers;
  // the pop-up handles its own events; nothing behind it sees them
  const inside = (e) => M && e.target.closest?.('#tk-root');
  document.addEventListener('click', (e) => { if (inside(e)) { e.stopPropagation(); onClick(e); } }, true);
  document.addEventListener('input', (e) => { if (inside(e)) { e.stopPropagation(); onInput(e.target); } }, true);
  document.addEventListener('change', (e) => { if (inside(e)) e.stopPropagation(); }, true);
  document.addEventListener('keydown', (e) => { if (inside(e)) { e.stopPropagation(); onKeydown(e); } }, true);
}
export const isOpen = () => !!M;

const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const me = () => { const u = H.store.user || {}; return { uid: u.uid, name: H.store.me?.displayName || u.displayName || (u.email || '').split('@')[0], email: normEmail(u.email) }; };
const root = () => {
  let r = document.getElementById('tk-root');
  if (!r) { r = document.createElement('div'); r.id = 'tk-root'; document.body.appendChild(r); }
  return r;
};

/** Everyone in Formwright who could be given a task, with whether Cadence lets them be. */
export async function assignablePeople() {
  const byUid = new Map();
  Object.entries(H.store.profiles || {}).forEach(([id, p]) => { if (p && !p.removed && p.email) byUid.set(id, { uid: id, name: p.displayName || p.email, email: normEmail(p.email) }); });
  (H.store.users || []).forEach((u) => { if (u.email && !byUid.has(u.id)) byUid.set(u.id, { uid: u.id, name: H.store.profiles?.[u.id]?.displayName || u.displayName || u.email, email: normEmail(u.email), cadence: u.role === 'admin' || u.cadence === true }); else if (byUid.has(u.id)) byUid.get(u.id).cadence = u.role === 'admin' || u.cadence === true; });
  const list = [...byUid.values()];
  const ok = await assignableUids(list.map((p) => p.email));
  list.forEach((p) => { p.ok = ok.get(p.email) === p.uid; });
  return list;
}

/** Open the pop-up: a new task for this record, or an existing task (taskId). */
/** opts (My work → All tasks): { task, reassign(), openRecord() } — the task as listed there, and what
 *  the view-only pop-up's buttons do for someone else's task (administrators can only reassign those). */
export async function open(recordId, taskId = null, opts = {}) {
  const task = taskId ? (opts.task || (H.tasks() || []).find((t) => t.id === taskId)) : null;
  if (taskId && !task) return;
  const mine = !task || task.ownerId === H.store.user?.uid;
  const view = !!task && !mine && task.assigneeId !== H.store.user?.uid;
  // a record task given to me: I can pass it on to someone else (Reassign)
  const passOn = !!task && !mine && task.assigneeId === H.store.user?.uid && !!task.recordId;
  M = { recordId, id: taskId, task, owner: mine, passOn, view, opts, loading: true, busy: false, nodeOpen: false, nodeQ: '', whoOpen: false, whoQ: '', armed: false, newSub: '', err: '' };
  paint();
  const [items, ppl] = await Promise.all([mine ? loadCadenceItems() : Promise.resolve({}), mine || passOn ? assignablePeople() : Promise.resolve([])]);
  if (!M || M.id !== taskId) return;
  M.lists = mine ? cadenceLists(items.settings) : {
    types: task.typeId ? [{ id: task.typeId, ...(task.typeSnap || { name: 'Their type', color: '#8C94A6' }) }] : [],
    levels: task.levelId ? [{ id: task.levelId, ...(task.levelSnap || { name: 'Their priority', color: '#8C94A6' }) }] : [],
  };
  M.nodes = mine ? mapNodes(items.map) : [];
  const cur = task?.assigneeId ? { uid: task.assigneeId, name: task.assigneeName || task.assigneeEmail || 'Someone', email: normEmail(task.assigneeEmail) } : null;
  M.people = mine ? assignChoices(ppl, me(), cur) : passOn ? passChoices(ppl, task, me()) : [];
  M.draft = task ? {
    title: task.title || '', notes: task.notes || '', due: task.due || '', time: task.time || '', repeat: task.repeat || 'none',
    typeId: task.typeId || '', levelId: task.levelId || '', nodeId: task.nodeId || '', who: task.assigneeId || task.ownerId,
    subtasks: (task.subtasks || []).map((s) => (typeof s === 'string' ? { id: uid('s'), title: s, done: false } : { id: s.id || uid('s'), title: s.title || s.text || '', done: !!s.done })),
  } : { title: '', notes: '', due: '', time: '', repeat: 'none', typeId: M.lists.defType || '', levelId: M.lists.defLevel || '', nodeId: '', who: H.store.user.uid, subtasks: [] };
  M.loading = false;
  paint();
  setTimeout(() => root().querySelector(task ? '[data-tki="notes"]' : '[data-tki="title"]')?.focus(), 0);
}

export function close() { M = null; const r = document.getElementById('tk-root'); if (r) r.innerHTML = ''; }

/** "Assigned to": the chosen person, as a button that opens the person picker. */
function whoField() {
  const p = M.people.find((x) => x.uid === M.draft.who) || M.people[0];
  const label = !p ? 'Choose…' : p.me ? (M.passOn ? 'Me (keep it)' : `Me (${p.name || 'you'})`) : p.owner ? `${p.name} (owner)` : p.name || p.email;
  return `<div class="tk-l"><span id="tk-who-l">Assigned to</span><button type="button" class="in tk-who" data-tk="who" aria-haspopup="listbox" aria-expanded="${M.whoOpen}" aria-labelledby="tk-who-l tk-who-v">${p ? `<span class="cm-av sm" style="background:${avatarColor(p.uid)}" aria-hidden="true">${esc(initials(p.name || p.email || '?'))}</span>` : ''}<span id="tk-who-v" class="tk-who-v">${esc(label)}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div>`;
}
/** The person picker under "Assigned to": me (or me and the owner, when passing it on) first. */
function whoPanel() {
  const pin = M.people.filter((p) => p.me || p.owner).map((p) => ({ ...p, av: p.name, name: p.me ? (M.passOn ? 'Me (keep it)' : `Me (${p.name || 'you'})`) : `${p.name} (owner): give it back` }));
  const rest = M.people.filter((p) => !p.me && !p.owner);
  return `<div class="tk-whop">${pickerHTML({ id: 'tk', label: 'Assigned to', people: rest, pinned: pin, sel: M.draft.who, q: M.whoQ })}</div>`;
}

const pill = (hex, label, cls = '') => `<span class="tk-pill ${cls}" style="--pc:${esc(hex)}"><i></i>${esc(label)}</span>`;
function paint() {
  const r = root();
  if (!M) { r.innerHTML = ''; return; }
  const rec = H.recById(M.recordId), form = rec ? H.formById(rec.formId) : null;
  const linkLine = rec && form ? `<p class="tk-link"><span class="badge" style="background:${colorOf(form)}" aria-hidden="true">${esc(String(form.name || 'F')[0].toUpperCase())}</span>Linked to ${esc(form.name)}: <b>${esc(H.recTitle(rec, form))}</b></p>` : '';
  if (M.loading) {
    r.innerHTML = `<div class="lv-scrim tk-scrim" data-tk="scrim"><div class="lv-dlg tk-dlg" role="dialog" aria-modal="true" aria-label="Task"><p class="note">Loading…</p></div></div>`;
    return;
  }
  const d = M.draft, t = M.task, own = M.owner, dis = M.busy ? ' disabled' : '', ro = own ? '' : ' disabled';
  const holderName = t ? (t.assigneeId ? t.assigneeName || t.assigneeEmail || 'someone' : t.ownerName || t.ownerEmail || 'its owner') : '';
  const from = M.view ? `<p class="help tk-from">${esc(t.ownerName || t.ownerEmail || 'Someone')}’s task${t.assigneeId ? `, with ${esc(holderName)}` : ''}. Only they can change it${M.opts.reassign ? '; you can reassign it' : ''}.</p>`
    : !own && t ? `<p class="help tk-from">From ${esc(t.ownerName || t.ownerEmail || 'someone')}. You can change the notes, date and checklist${M.passOn ? ', and pass it on to someone else' : ''}; the rest is theirs.</p>` : '';
  const levels = M.lists.levels || [];
  const node = (M.nodes || []).find((n) => n.id === d.nodeId);
  const q = M.nodeQ.trim().toLowerCase();
  const nodeOpts = [{ id: '', title: 'Not on the map', hex: '', depth: 0 }].concat((M.nodes || []).filter((n) => !q || n.title.toLowerCase().includes(q)));
  const subsDone = d.subtasks.filter((s) => s.done).length;
  const who = M.people.find((p) => p.uid === d.who);
  const canDel = t && (own || (t.assigneeId === H.store.user.uid && t.spawnedFrom && !t.done));
  r.innerHTML = `<div class="lv-scrim tk-scrim" data-tk="scrim"><div class="lv-dlg tk-dlg${M.view ? ' tk-view' : ''}" role="dialog" aria-modal="true" aria-labelledby="tk-h" data-stop-scrim="1">
    <div class="tk-head"><h2 id="tk-h">${t ? (t.done ? 'Task (done)' : 'Task') : 'New task'}</h2><button type="button" class="ibtn" data-tk="close" aria-label="Close">✕</button></div>
    ${linkLine}${from}
    <fieldset class="tk-f"${M.view ? ' disabled' : dis}>
      <label class="tk-l"><span>Title</span><input class="in tk-title" data-tki="title" maxlength="500" value="${esc(d.title)}" placeholder="What needs doing?"${ro}></label>
      <label class="tk-l"><span>Notes</span><textarea class="in" data-tki="notes" rows="3" maxlength="20000" placeholder="Details, links, anything that helps">${esc(d.notes)}</textarea></label>
      <div class="tk-row3">
        <label class="tk-l"><span>Due date</span><input class="in" type="date" data-tki="due" value="${esc(d.due)}"></label>
        <label class="tk-l"><span>Time</span><input class="in" type="time" data-tki="time" value="${esc(d.time)}"${d.due ? '' : ' disabled title="Pick a date first"'}></label>
        <label class="tk-l"><span>Repeat</span><select class="in" data-tki="repeat"${ro}>${REPEAT_CHOICES.map(([k, l]) => `<option value="${k}"${d.repeat === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${own ? `<div class="tk-row2">
        ${whoField()}${M.whoOpen ? whoPanel() : ''}
        <label class="tk-l tk-type"><span>Type</span><select class="in" data-tki="typeId"><option value="">No type</option>${(M.lists.types || []).map((x) => `<option value="${esc(x.id)}"${d.typeId === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      </div>` : M.passOn ? `<div class="tk-row2">
        ${whoField()}${M.whoOpen ? whoPanel() : ''}
        <div class="tk-l tk-type"><span>Type</span><p class="tk-ro">${(M.lists.types[0] && pill(M.lists.types[0].color, M.lists.types[0].name)) || 'No type'}</p></div>
      </div><p class="help tk-who-help">To pass this on, pick who should do it instead. ${esc(t.ownerName || 'The owner')} still sees it.</p>` : `<div class="tk-row2"><div class="tk-l"><span>Assigned to</span><p class="tk-ro">${M.view ? esc(holderName) : 'You'}</p></div><div class="tk-l"><span>Type</span><p class="tk-ro">${(M.lists.types[0] && pill(M.lists.types[0].color, M.lists.types[0].name)) || 'No type'}</p></div></div>`}
      ${own ? `<div class="tk-l tk-nodew"><span>On the map</span>
        <div class="tk-nodeline"><button type="button" class="tk-pill tk-pickn${node ? '' : ' tk-none'}" data-tk="nodes" aria-haspopup="listbox" aria-expanded="${M.nodeOpen}"${node ? ` style="--pc:${esc(node.hex)}"` : ''}><i></i>${esc(node ? node.title : d.nodeId ? 'Its node was deleted' : 'Link to a node')}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
          ${d.nodeId ? `<button type="button" class="ibtn" data-tk="node" data-v="" aria-label="Unlink from the map" title="Unlink">✕</button>` : ''}${node?.parent ? `<span class="help">in ${esc(node.parent)}</span>` : ''}</div>
        ${M.nodeOpen ? `<div class="tk-nodes" role="listbox" aria-label="Your Cadence map"><input class="in" data-tki="nodeQ" value="${esc(M.nodeQ)}" placeholder="Search your map" aria-label="Search your map" autocomplete="off">
          <div class="tk-nlist">${(M.nodes || []).length ? nodeOpts.map((n) => `<button type="button" role="option" class="tk-nopt${n.id === (d.nodeId || '') ? ' on' : ''}" aria-selected="${n.id === (d.nodeId || '')}" data-tk="node" data-v="${esc(n.id)}" style="padding-left:${10 + (q ? 0 : n.depth * 18)}px">${n.id ? pill(n.hex, n.title) : `<span class="tk-pill tk-none"><i></i>${esc(n.title)}</span>`}${n.id === (d.nodeId || '') ? '<span class="tk-check">✓</span>' : ''}</button>`).join('') : '<p class="note">Your Cadence map has no nodes yet.</p>'}</div></div>` : ''}
        <small class="help">Your own Cadence map. Only you see this link.</small></div>` : ''}
      <div class="tk-l"><span>Priority</span>${own ? `<div class="segs tk-lv" role="group" aria-label="Priority">${levels.map((l) => `<button type="button" class="${d.levelId === l.id ? 'on' : ''}" aria-pressed="${d.levelId === l.id}" data-tk="level" data-v="${esc(l.id)}"><i style="background:${esc(l.color)}"></i>${esc(l.name)}</button>`).join('')}</div>` : `<p class="tk-ro">${levels[0] ? pill(levels[0].color, levels[0].name) : 'None'}</p>`}</div>
      <div class="tk-l"><span>Checklist ${d.subtasks.length ? `<small class="help">${subsDone} of ${d.subtasks.length} done</small>` : ''}</span>
        <div class="tk-subs">${d.subtasks.map((s, i) => `<div class="tk-sub${s.done ? ' done' : ''}"><button type="button" class="tcheck${s.done ? ' on' : ''}" data-tk="sub-done" data-i="${i}" aria-pressed="${s.done}" aria-label="${s.done ? 'Not done' : 'Done'}: ${esc(s.title)}">✓</button><input class="tk-subt" data-tki="sub" data-i="${i}" value="${esc(s.title)}" aria-label="Step ${i + 1}" maxlength="500"><button type="button" class="ibtn" data-tk="sub-del" data-i="${i}" aria-label="Remove ${esc(s.title)}">✕</button></div>`).join('')}
          <div class="tk-sub tk-subnew"><span aria-hidden="true">+</span><input data-tki="newSub" value="${esc(M.newSub)}" placeholder="Add a step, then press Enter" aria-label="Add a checklist step" maxlength="500"></div></div></div>
      ${M.err ? `<p class="err" role="alert">${esc(M.err)}</p>` : ''}
    </fieldset>
    ${M.view ? `<div class="tk-foot">
      ${M.opts.openRecord ? `<button type="button" class="btn" data-tk="openrec">Open record</button>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn ghost" data-tk="close">Close</button>
      ${M.opts.reassign ? `<button type="button" class="btn primary" data-tk="reassign">Reassign…</button>` : ''}
    </div>` : `<div class="tk-foot">
      ${canDel ? `<button type="button" class="btn${M.armed ? ' danger armed' : ' ghost danger'}" data-tk="del"${dis}>${M.armed ? 'Tap again to delete' : 'Delete'}</button>` : ''}
      ${t ? `<button type="button" class="btn" data-tk="done"${dis}>${t.done ? 'Mark not done' : 'Mark done'}</button>` : ''}
      ${H.cadenceUrl ? `<a class="tk-cad" href="${esc(cadenceLink(H.cadenceUrl, t ? { task: t.id } : { addTaskFor: M.recordId }))}" target="cadence" rel="noopener">Open in Cadence ↗</a>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn ghost" data-tk="close"${dis}>Cancel</button>
      <button type="button" class="btn primary" data-tk="save"${dis}>${M.busy ? 'Saving…' : t ? 'Save changes' : 'Add task'}</button>
    </div>`}
  </div></div>`;
}

/** Tick a task off (or reopen it). A repeating task makes its next occurrence, as in Cadence. */
export async function toggleDone(t) {
  const now = Date.now(), myId = H.store.user.uid;
  const patch = donePatch(!t.done, myId, now);
  if (!t.done && t.repeat && t.repeat !== 'none' && !t.spawnedNext) {
    const next = nextOccurrence(t, uid('t'), now, dateKey(new Date()));
    await writeTasks([next], [[t.id, { ...patch, spawnedNext: next.id }]]);
    return 'next';
  }
  if (t.done && t.spawnedNext) {
    const sp = (H.tasks() || []).find((x) => x.id === t.spawnedNext);
    if (sp && !sp.done && (sp.ownerId === myId || (sp.assigneeId === myId && sp.spawnedFrom))) { try { await deleteTask(sp.id); } catch (e) { /* already gone */ } }
    await updateTask(t.id, { ...patch, spawnedNext: null });
    return 'reopened';
  }
  await updateTask(t.id, patch);
  return t.done ? 'reopened' : 'done';
}

async function save() {
  const d = M.draft;
  if (!String(d.title).trim()) { M.err = 'Give the task a title.'; paint(); root().querySelector('[data-tki="title"]')?.focus(); return; }
  if (M.newSub.trim()) { d.subtasks.push({ id: uid('s'), title: M.newSub.trim(), done: false }); M.newSub = ''; }
  const mine = me(), who = M.owner ? M.people.find((p) => p.uid === d.who) : null;
  if (M.owner && who && !who.me && !who.ok && who.uid !== M.task?.assigneeId) { M.err = `${who.name} can’t be given tasks yet.`; paint(); return; }
  M.busy = true; M.err = ''; paint();
  try {
    const now = Date.now();
    if (!M.task) {
      const rec = H.recById(M.recordId), form = rec ? H.formById(rec.formId) : null;
      const link = rec && form ? { recordId: rec.id, formId: form.id, recordSnap: { title: String(H.recTitle(rec, form)).slice(0, 500), form: String(form.name || 'Untitled form').slice(0, 200), color: colorOf(form) } } : null;
      const t = newTaskDoc(uid('t'), d, mine, who && !who.me ? who : null, link, M.lists, now);
      try { await writeTasks([t]); }
      catch (e) {
        if (e?.code !== 'permission-denied') throw e;
        const r = await explainRefusal(t, who);
        if (!r.saved) { const err = new Error(r.msg); err.diag = r.msg; throw err; }
      }
      H.toast(who && !who.me ? `Task added and given to ${who.name.split(' ')[0]}` : 'Task added');
    } else {
      const patch = editPatch(M.task, d, mine, who && !who.me ? who : null, M.owner, M.lists, now);
      if (Object.keys(patch).length) { await updateTask(M.task.id, patch); H.toast('Task saved'); }
      // passed on to someone else (or back to the owner): a change of its own, as Cadence's rules want
      if (M.passOn && d.who !== mine.uid) {
        const to = M.people.find((p) => p.uid === d.who);
        if (to && to.ok) {
          await updateTask(M.task.id, reassignPatch(M.task, to.owner ? null : to, mine.uid, now));
          H.toast(to.owner ? `Given back to ${String(to.name).split(' ')[0]}` : `Passed to ${String(to.name).split(' ')[0]}`);
        }
      }
    }
    close();
  } catch (e) {
    console.error('[formwright] task', e);
    M.busy = false;
    M.err = e?.diag ? e.diag : e?.code === 'permission-denied' ? 'Cadence didn’t allow that. You may not have Cadence switched on, or the person you picked can’t be given tasks yet. If you use Brave or an ad blocker, turn it off for this site (Brave: the lion icon → Shields down) and try again.' : 'Saving didn’t work. Check your connection and try again.';
    paint();
  }
}

/** A new task was refused: read what Cadence's rules read and say which check failed. When nothing
 *  stands out, find the part it refuses with test tasks that are removed straight away. If only the
 *  copied type and priority names were the problem, the task is saved without them ({ saved: true }). */
async function explainRefusal(t, who) {
  const reads = await taskCheckReads(t);
  console.warn('[formwright] task refused. What the rules read:', { task: t, ...reads });
  const err = (x) => !!(x && x.error);
  if (err(reads.account)) return { msg: `Cadence didn’t allow that, and your own account couldn’t be read (${reads.account.error}). Sign out and sign in again. If you use Brave or an ad blocker, turn it off for this site.` };
  const why = taskRefusal(me(), reads.account, t, err(reads.record) ? null : reads.record, err(reads.person) ? null : reads.person, { assignee: who?.name });
  if (why.length) return { msg: 'Cadence didn’t allow that. ' + why.join(' ') };
  if (t.typeSnap || t.levelSnap) {
    try { await writeTasks([{ ...t, typeSnap: null, levelSnap: null }]); console.warn('[formwright] task saved without its type/priority copy'); return { saved: true }; } catch (e) { /* not that */ }
  }
  const self = { ...t, id: uid('t'), title: 'Formwright check (removed automatically)', assigneeId: null, assigneeName: null, assigneeEmail: null, members: [t.ownerId], typeSnap: null, levelSnap: null };
  const ref = `ref: ${String(t.ownerId).slice(0, 6)} → ${String(t.assigneeId || '').slice(0, 6)} ${t.assigneeEmail || ''}`;
  if (t.assigneeId && (await probeTask(self))) return { msg: `Cadence refused giving this task to ${who?.name || 'that person'}, but accepts it as your own task, and their Cadence entry looks right from here. Please send a screenshot of this message to your administrator. (${ref})` };
  if (t.recordId && (await probeTask({ ...self, recordId: null, formId: null, recordSnap: null }))) return { msg: `Cadence refused linking a task to this record, though your access looks right from here. Ask an administrator to press Recalculate access in Security groups, then try again. (${ref})` };
  return { msg: `Cadence didn’t allow any task from you just now, though your account looks right from here. Sign out and sign in again, then try once more. (${ref})` };
}

export function onClick(e) {
  if (!M) return false;
  const pk = e.target.closest?.('[data-pk="pick"]');
  if (pk && M.draft && !pk.disabled) { M.draft.who = pk.dataset.v; M.whoOpen = false; M.whoQ = ''; paint(); root().querySelector('[data-tk="who"]')?.focus(); return true; }
  const el = e.target.closest?.('[data-tk]');
  if (!el) {
    let redraw = false;
    if (M.nodeOpen && !e.target.closest?.('.tk-nodew')) { M.nodeOpen = false; redraw = true; }
    if (M.whoOpen && !e.target.closest?.('.tk-whop')) { M.whoOpen = false; M.whoQ = ''; redraw = true; }
    if (redraw) paint();
    return !!e.target.closest?.('#tk-root');
  }
  const a = el.dataset.tk, d = M.draft;
  if (a === 'scrim') { if (e.target === el && !M.busy) close(); return true; }
  if (M.loading || !d) { if (a === 'close') close(); return true; }
  if (a !== 'del') M.armed = false;
  switch (a) {
    case 'close': if (!M.busy) close(); return true;
    case 'save': if (!M.view) save(); return true;
    case 'reassign': { const f = M.opts.reassign; close(); f?.(); return true; }
    case 'openrec': { const f = M.opts.openRecord; close(); f?.(); return true; }
    case 'level': d.levelId = el.dataset.v; break;
    case 'who': M.whoOpen = !M.whoOpen; M.whoQ = ''; M.nodeOpen = false; paint(); if (M.whoOpen) setTimeout(() => { root().querySelector('.tk-whop')?.scrollIntoView({ block: 'nearest' }); pickerFocus(root(), d.who, true); }, 0); return true;
    case 'nodes': M.whoOpen = false; M.nodeOpen = !M.nodeOpen; M.nodeQ = ''; paint(); if (M.nodeOpen) setTimeout(() => root().querySelector('[data-tki="nodeQ"]')?.focus(), 0); return true;
    case 'node': d.nodeId = el.dataset.v; M.nodeOpen = false; break;
    case 'sub-done': d.subtasks[+el.dataset.i].done = !d.subtasks[+el.dataset.i].done; break;
    case 'sub-del': d.subtasks.splice(+el.dataset.i, 1); break;
    case 'del':
      if (!M.armed) { M.armed = true; break; }
      M.busy = true; paint();
      deleteTask(M.task.id).then(() => { H.toast('Task deleted'); close(); }).catch((err) => { console.error(err); M.busy = false; M.armed = false; M.err = 'Couldn’t delete it. Try again.'; paint(); });
      return true;
    case 'done':
      M.busy = true; paint();
      toggleDone(M.task).then((r) => { H.toast(r === 'next' ? 'Done. The next one is in your tasks.' : r === 'done' ? 'Marked done' : 'Reopened'); close(); }).catch((err) => { console.error(err); M.busy = false; M.err = 'Couldn’t update it. Try again.'; paint(); });
      return true;
    default: return true;
  }
  paint();
  return true;
}

export function onInput(el) {
  if (M && el.dataset?.pkQ) { M.whoQ = el.value; pickerFilter(el); return true; }
  if (!M || !M.draft || !el.dataset?.tki) return false;
  const k = el.dataset.tki, d = M.draft;
  if (k === 'nodeQ') { M.nodeQ = el.value; const pos = el.selectionStart; paint(); const s = root().querySelector('[data-tki="nodeQ"]'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (err) { /* fine */ } } return true; }
  if (k === 'newSub') { M.newSub = el.value; return true; }
  if (k === 'sub') { d.subtasks[+el.dataset.i].title = el.value; return true; }
  if (k === 'title' && M.err) { M.err = ''; root().querySelector('.tk-f .err')?.remove(); }
  d[k] = el.value;
  if (k === 'due') { const tm = root().querySelector('[data-tki="time"]'); if (tm) tm.disabled = !el.value; if (!el.value) d.time = ''; }
  return true;
}

export function onKeydown(e) {
  if (!M) return false;
  if (e.key === 'Escape') { if (M.whoOpen) { M.whoOpen = false; M.whoQ = ''; paint(); root().querySelector('[data-tk="who"]')?.focus(); } else if (M.nodeOpen) { M.nodeOpen = false; paint(); } else if (!M.busy) close(); return true; }
  const el = e.target;
  if (pickerKey(e)) return true;
  if (e.key === 'Enter' && el.dataset?.pkQ) { e.preventDefault(); root().querySelector('.tk-whop .pk-opt:not([hidden]):not([disabled])')?.click(); return true; }
  if (e.key === 'Enter' && el.dataset?.tki === 'newSub') {
    e.preventDefault();
    const v = el.value.trim(); if (!v) return true;
    M.draft.subtasks.push({ id: uid('s'), title: v, done: false }); M.newSub = '';
    paint(); root().querySelector('[data-tki="newSub"]')?.focus();
    return true;
  }
  if (e.key === 'Enter' && el.dataset?.tki === 'title') { e.preventDefault(); if (!M.view) save(); return true; }
  return !!el.closest?.('#tk-root');
}

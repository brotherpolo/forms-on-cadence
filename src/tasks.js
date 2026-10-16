// Cadence tasks linked to a Formwright record: display helpers and links into Cadence.
// Cadence stores tasks in the shared `tasks` collection. A task links to a record with
// recordId, formId and recordSnap; members = [ownerId] or [ownerId, assigneeId].
// Pure functions: no DOM, no Firebase.

const REPEATS = { daily: 'Repeats daily', weekdays: 'Repeats on weekdays', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };

export const repeats = (t) => !!(t && t.repeat && t.repeat !== 'none');

/** Open tasks first (by due date, undated last), then done tasks, most recently done first. */
export function sortTasks(list) {
  const due = (t) => (t.due || '9999-99-99') + (t.time || '99:99');
  return (list || []).slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    if (a.done) return (b.doneAt || 0) - (a.doneAt || 0);
    return due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : String(a.title || '').localeCompare(String(b.title || ''));
  });
}

/** Local YYYY-MM-DD for a Date (Cadence's date keys are local, not UTC). */
export function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** { text, tone } for a due date: tone is 'late', 'today' or '' */
export function dueInfo(due, todayKey) {
  if (!due) return { text: 'No date', tone: '' };
  const [y, m, d] = due.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 864e5);
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: '' };
  if (days === -1) return { text: 'Yesterday', tone: 'late' };
  const date = new Date(y, m - 1, d);
  const sameYear = y === ty;
  const text = date.toLocaleDateString(undefined, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return days < 0 ? { text: text + ' · ' + -days + 'd late', tone: 'late' } : { text, tone: '' };
}

/** Who else is on the task, from the viewer's side: "Assigned to Farren" or "From Farren". */
export function whoLine(t, myUid) {
  const first = (name, email) => String(name || email || 'someone').split(' ')[0];
  if (t.ownerId === myUid && t.assigneeId) return 'Assigned to ' + first(t.assigneeName, t.assigneeEmail);
  if (t.assigneeId === myUid && t.ownerId !== myUid) return 'From ' + first(t.ownerName, t.ownerEmail);
  return '';
}

export const repeatLabel = (t) => REPEATS[t.repeat] || '';

/** Everything a task can be found by: title, notes, people, its due text, Done, repeats, subtasks. */
export function taskText(t, todayKey) {
  const subs = Array.isArray(t.subtasks) ? t.subtasks.map((x) => (typeof x === 'string' ? x : x && (x.title || x.text)) || '') : [];
  return [t.title, t.notes, t.ownerName, t.assigneeName, t.done ? 'Done' : dueInfo(t.due, todayKey).text, t.due || '', repeatLabel(t), ...subs]
    .filter(Boolean).join(' \u2022 ');
}

/** A link into Cadence: base address plus query parameters, or '' when Cadence's address isn't set. */
export function cadenceLink(base, params) {
  base = String(base || '').trim();
  if (!base) return '';
  const url = base.replace(/[?#].*$/, '');
  const q = new URLSearchParams(params || {}).toString();
  return url + (q ? '?' + q : '');
}

/** The fields Cadence expects when a task is ticked off or reopened outside Cadence. */
export function donePatch(done, myUid, now) {
  return { done: !!done, doneAt: done ? now : null, doneBy: done ? myUid : null, updatedAt: now };
}

/* ---------- Adding and editing tasks in Formwright (the same documents Cadence writes) ---------- */

// Cadence's starting lists, used until someone has saved their own in Cadence (same ids)
export const DEFAULT_TYPES = [
  { id: 'ty-work', name: 'Work', color: '#3B6FE0', glyph: 'briefcase' },
  { id: 'ty-personal', name: 'Personal', color: '#C2410C', glyph: 'home' },
  { id: 'ty-errand', name: 'Errand', color: '#0E8F7E', glyph: 'cart' },
  { id: 'ty-health', name: 'Health', color: '#D23F6E', glyph: 'heart' },
  { id: 'ty-learning', name: 'Learning', color: '#8A55D6', glyph: 'book' },
];
export const DEFAULT_LEVELS = [
  { id: 'lv-critical', name: 'Critical', color: '#E5383B' },
  { id: 'lv-high', name: 'High', color: '#F08A24' },
  { id: 'lv-normal', name: 'Normal', color: '#3B82C4' },
  { id: 'lv-low', name: 'Low', color: '#8C94A6' },
];
export const REPEAT_CHOICES = [['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']];

/** Someone's types and levels from their Cadence settings document (or Cadence's starting lists). */
export function cadenceLists(settings) {
  const s = settings || {};
  const types = Array.isArray(s.types) ? s.types.filter((t) => t && t.id) : DEFAULT_TYPES;
  const levels = Array.isArray(s.levels) && s.levels.length ? s.levels.filter((l) => l && l.id) : DEFAULT_LEVELS;
  const defLevel = levels.some((l) => l.id === s.defaultLevel) ? s.defaultLevel : (levels.find((l) => l.id === 'lv-normal') || levels[0]).id;
  const defType = types.some((t) => t.id === s.defaultType) ? s.defaultType : null;
  return { types, levels, defLevel, defType };
}

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
/** Cadence's next date for a repeating task (from its due date, or today when it has none). */
export function nextDue(key, repeat, todayKey = keyOf(new Date())) {
  const base = parseKey(key || todayKey);
  const add = (n) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
  if (repeat === 'daily') return keyOf(add(1));
  if (repeat === 'weekly') return keyOf(add(7));
  if (repeat === 'monthly') { const x = new Date(base.getFullYear(), base.getMonth() + 1, 1); x.setDate(Math.min(base.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return keyOf(x); }
  if (repeat === 'weekdays') { let x = add(1); while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1); return keyOf(x); }
  return null;
}
const dayDiff = (a, b) => Math.round((Date.UTC(...a.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(...b.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))) / 864e5);

const PALETTE = { red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', pink: '#ec4899', gray: '#64748b' };
const plainLabel = (raw) => String(raw || '').replace(/<span style="font-size:\s*[^;]+;">(.*?)<\/span>/gi, '$1').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/<\/?u>/g, '').replace(/\s*\n\s*/g, ' ').trim();
/**
 * Someone's Cadence map as a list to pick from: each node under its parent (as Cadence draws the
 * tree: undirected edges, source → target), roots in map order. → [{ id, title, hex, depth, parent }]
 */
export function mapNodes(map) {
  const nodes = (map?.nodes || []).filter((n) => n && n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map(), kids = new Map();
  (map?.edges || []).forEach((e) => {
    if (!e || e.directed || !byId.has(e.source) || !byId.has(e.target) || e.source === e.target || parent.has(e.target)) return;
    parent.set(e.target, e.source);
    if (!kids.has(e.source)) kids.set(e.source, []);
    kids.get(e.source).push(e.target);
  });
  const out = [], seen = new Set();
  const visit = (id, depth) => {
    if (seen.has(id)) return; seen.add(id);
    const n = byId.get(id), title = plainLabel(n.linkCaption || n.label);
    const p = parent.get(id);
    if (title) out.push({ id, title, hex: PALETTE[n.color] || PALETTE.gray, depth: Math.min(depth, 6), parent: p ? plainLabel(byId.get(p).linkCaption || byId.get(p).label) : '' });
    (kids.get(id) || []).forEach((k) => visit(k, title ? depth + 1 : depth));
  };
  nodes.forEach((n) => { if (!parent.has(n.id)) visit(n.id, 0); });
  nodes.forEach((n) => visit(n.id, 0)); // anything in a loop
  return out;
}

const snapOf = (x, keys) => (x ? Object.fromEntries(keys.map((k) => [k, x[k] ?? null])) : null);
/**
 * A new task, as Cadence writes it. me: { uid, name, email }; who: { uid, name, email } or null (me);
 * draft: { title, notes, due, time, repeat, typeId, levelId, nodeId, subtasks: [{ id, title, done }] };
 * link: { recordId, formId, recordSnap }; lists: from cadenceLists (for the assignee's copy of the names).
 */
/** An email as Cadence keeps it: trimmed and lowercase (its people directory and rules compare that way). */
export const normEmail = (e) => String(e || '').trim().toLowerCase();

export function newTaskDoc(id, draft, me, who, link, lists, now) {
  const assigned = who && who.uid && who.uid !== me.uid;
  const t = {
    id, title: String(draft.title || '').trim().slice(0, 500) || 'Untitled task', notes: String(draft.notes || '').slice(0, 20000),
    typeId: draft.typeId || null, levelId: draft.levelId || null, due: draft.due || null, time: draft.due && draft.time ? draft.time : null,
    done: false, doneAt: null, createdAt: now, updatedAt: now,
    subtasks: (draft.subtasks || []).slice(0, 200).map((s) => ({ id: s.id, title: String(s.title || '').slice(0, 500), done: !!s.done })),
    repeat: draft.repeat || 'none', nodeId: draft.nodeId || null,
    ownerId: me.uid, ownerName: me.name || null, ownerEmail: me.email || null,
    assigneeId: assigned ? who.uid : null, assigneeName: assigned ? who.name || null : null, assigneeEmail: assigned ? who.email || null : null,
    members: assigned ? [me.uid, who.uid] : [me.uid],
    recordId: link?.recordId || null, formId: link?.recordId ? link.formId || null : null, recordSnap: link?.recordId ? link.recordSnap || null : null,
  };
  if (assigned) Object.assign(t, snaps(t, lists));
  return t;
}
function snaps(t, lists) {
  const ty = (lists?.types || []).find((x) => x.id === t.typeId), lv = (lists?.levels || []).find((x) => x.id === t.levelId);
  return { typeSnap: snapOf(ty, ['name', 'color', 'glyph']), levelSnap: snapOf(lv, ['name', 'color']) };
}

/**
 * Reassign: give a task linked to a record to someone else, or back to its owner (who = null or
 * the owner). The owner stays; members mirror owner + assignee, as Cadence's rules want.
 * who: { uid, name, email } | null; by: the uid doing it.
 */
export function reassignPatch(task, who, by, now) {
  const to = who && who.uid && who.uid !== task.ownerId ? who : null;
  return {
    assigneeId: to ? to.uid : null, assigneeName: to ? to.name || null : null, assigneeEmail: to ? normEmail(to.email) || null : null,
    members: to ? [task.ownerId, to.uid] : [task.ownerId],
    updatedAt: now, reassignedBy: by, reassignedAt: now,
  };
}
/** Who a task can be passed to by its assignee: keep it, back to the owner, or anyone else Cadence lets have it. */
export function passChoices(people, task, me) {
  const owner = { uid: task.ownerId, name: task.ownerName || task.ownerEmail || 'The owner', email: task.ownerEmail || '', ok: true, owner: true };
  const rest = (people || []).filter((p) => p && p.uid && p.uid !== me.uid && p.uid !== task.ownerId).map((p) => ({ ...p }))
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
  return [{ uid: me.uid, name: me.name, email: me.email, ok: true, me: true }, owner, ...rest];
}

/** Fields an assignee may change (Cadence's rules); the owner may change the rest too. */
export const ASSIGNEE_FIELDS = ['notes', 'due', 'time', 'subtasks'];
/**
 * What saving the pop-up changes on an existing task: only what's different, only what this person
 * may change, with Cadence's reschedule counts (moved, pushed) and the assignee's copy of names.
 * owner: is this person the task's owner. → patch ({} when nothing changed)
 */
export function editPatch(old, draft, me, who, owner, lists, now) {
  const p = {};
  const set = (k, v) => { if (JSON.stringify(old[k] ?? null) !== JSON.stringify(v ?? null)) p[k] = v; };
  set('notes', String(draft.notes || '').slice(0, 20000));
  set('due', draft.due || null);
  set('time', draft.due && draft.time ? draft.time : null);
  set('subtasks', (draft.subtasks || []).slice(0, 200).map((s) => ({ id: s.id, title: String(s.title || '').slice(0, 500), done: !!s.done })));
  if (owner) {
    set('title', String(draft.title || '').trim().slice(0, 500) || 'Untitled task');
    set('typeId', draft.typeId || null); set('levelId', draft.levelId || null);
    set('repeat', draft.repeat || 'none'); set('nodeId', draft.nodeId || null);
    const assigned = who && who.uid && who.uid !== me.uid;
    set('assigneeId', assigned ? who.uid : null);
    if ('assigneeId' in p) Object.assign(p, { assigneeName: assigned ? who.name || null : null, assigneeEmail: assigned ? who.email || null : null, members: assigned ? [old.ownerId, who.uid] : [old.ownerId] });
    if (assigned) { const s = snaps({ typeId: draft.typeId, levelId: draft.levelId }, lists); set('typeSnap', s.typeSnap); set('levelSnap', s.levelSnap); }
    else if (old.typeSnap || old.levelSnap) { p.typeSnap = null; p.levelSnap = null; }
  }
  if (!Object.keys(p).length) return p;
  if ('due' in p && old.due && p.due) { p.moved = (old.moved || 0) + 1; p.pushed = (old.pushed || 0) + Math.max(0, dayDiff(p.due, old.due)); }
  p.updatedAt = now;
  return p;
}

/** The next occurrence of a repeating task, as Cadence makes it when one is ticked off. */
export function nextOccurrence(t, newId, now, todayKey) {
  const next = JSON.parse(JSON.stringify(t));
  ['spawnedNext', 'moved', 'pushed', 'doneBy'].forEach((k) => delete next[k]);
  Object.assign(next, { id: newId, done: false, doneAt: null, createdAt: now, updatedAt: now, due: nextDue(t.due, t.repeat, todayKey), spawnedFrom: t.id });
  next.subtasks = (next.subtasks || []).map((s) => ({ ...s, done: false }));
  return next;
}

/** Who a task can go to: the people in Formwright, with whether Cadence lets them be assigned. */
export function assignChoices(people, me, current) {
  const list = (people || []).filter((p) => p && p.uid && p.uid !== me.uid).map((p) => ({ ...p }));
  if (current && current.uid && current.uid !== me.uid && !list.some((p) => p.uid === current.uid)) list.push({ ...current, ok: true });
  list.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
  return [{ uid: me.uid, name: me.name, email: me.email, ok: true, me: true }, ...list];
}

/**
 * Why Cadence's rules refused a new task, worked out from what they read. Mirrors firestore.rules
 * (tasks create): Cadence switched on, owner email, the assignee's people entry, and the record link.
 * me: { uid, email } (signed-in); account: users/{me} data or null; task: the doc that was refused;
 * record: records/{task.recordId} data or null (undefined when there's no link);
 * person: people/{task.assigneeEmail} data or null (undefined when unassigned);
 * names: { assignee, record } for the messages. Returns a list of reasons (empty: none found).
 */
export function taskRefusal(me, account, task, record, person, names = {}) {
  const out = [];
  if (!account) return ['Your Formwright account wasn’t found on the server. Sign out and sign in again.'];
  const admin = account.role === 'admin';
  if (!admin && account.cadence !== true) out.push('Cadence isn’t switched on for you. An administrator can turn on “Can use Cadence” for you in Users.');
  if (task.ownerEmail && task.ownerEmail !== normEmail(me.email)) out.push(`Your sign-in email (${normEmail(me.email) || 'none'}) doesn’t match the one on the task (${task.ownerEmail}). Sign out and sign in again.`);
  if (task.assigneeId) {
    const who = names.assignee || task.assigneeName || task.assigneeEmail;
    if (!person) out.push(`${who} isn’t in Cadence’s people list under ${task.assigneeEmail}. They need to open Cadence once while signed in with that address.`);
    else if (person.uid !== task.assigneeId) out.push(`Cadence’s people list has ${task.assigneeEmail} on a different account (${String(person.uid || 'none').slice(0, 8)}…) from the ${who} you picked (${String(task.assigneeId).slice(0, 8)}…). They should open Cadence once to fix it.`);
  }
  if (task.recordId) {
    if (!record) out.push('This record isn’t saved on the server yet (or was deleted). Save it, check your connection, and try again.');
    else if (record.formId !== task.formId) out.push('The task points at the wrong form for this record. Reload the page and try again.');
    else if (!admin) {
      const acc = account.access || {};
      const lvl = acc[task.formId] || acc['*'] || {};
      const view = lvl.view || 'none';
      const responsible = record.assignee === me.uid || (record.assigneeGroup && (account.groups || []).includes(record.assigneeGroup));
      const sees = view === 'all' || (view === 'own' && record.ownerId === me.uid) || responsible;
      if (!sees) out.push(view === 'own'
        ? `Your access to this form is “only records you created”, and someone else created this one. An administrator can give your group “All records” for this form.`
        : `Your access doesn’t include this form (it says “${view}”). An administrator can change your security group, then press Recalculate access.`);
    }
  }
  return out;
}

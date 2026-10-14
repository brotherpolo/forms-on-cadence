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

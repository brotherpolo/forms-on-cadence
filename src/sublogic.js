// The sections under a record's fields (grids, child records, Cadence tasks): which columns
// each shows, how it's sorted and how many rows it shows. Saved per person on each device,
// like folded sections. Pure functions: no DOM, no Firebase.
//
// prefs for one section: { cols: [key…] | undefined, sort: { key, dir } | null, show: 5|10|15|20|'all' }
// Section keys match the fold keys: 'g:<childFormId>', 'c:<childFormId>', 't:tasks'.

export const SHOW_OPTS = [5, 10, 15, 20, 'all'];
export const DEFAULT_SHOW = 10;
export const MAX_COLS = 20;

export const storeKey = (uid) => 'fw.subs.' + (uid || 'anon');

/** Saved prefs for every section, from localStorage text (bad or missing → {}). */
export function readSubs(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {};
  }
}

/** One section's prefs, tidied: unknown values fall back to the defaults. */
export function prefsOf(all, formId, key) {
  const p = (all && all[formId] && all[formId][key]) || {};
  return {
    cols: Array.isArray(p.cols) ? p.cols.filter((k) => typeof k === 'string').slice(0, MAX_COLS) : undefined,
    sort: p.sort && typeof p.sort.key === 'string' ? { key: p.sort.key, dir: p.sort.dir === 'desc' ? 'desc' : 'asc' } : null,
    show: SHOW_OPTS.includes(p.show) ? p.show : DEFAULT_SHOW,
  };
}

/** All prefs with one section's changed (a field set to undefined is dropped). */
export function setPrefs(all, formId, key, patch) {
  const cur = { ...((all && all[formId] && all[formId][key]) || {}), ...patch };
  Object.keys(cur).forEach((k) => cur[k] === undefined && delete cur[k]);
  return { ...(all || {}), [formId]: { ...((all && all[formId]) || {}), [key]: cur } };
}

/** The columns to show: the saved choice (only ones that still exist), else the defaults. */
export function colsFor(saved, catalog, defaults, { min = 0 } = {}) {
  const keys = new Set(catalog.map((c) => c.key));
  if (Array.isArray(saved)) {
    const seen = new Set();
    const ok = saved.filter((k) => keys.has(k) && !seen.has(k) && seen.add(k));
    if (ok.length >= min) return ok;
  }
  return defaults.filter((k) => keys.has(k));
}

/** Tick or untick a column (a ticked one joins at the end); never below `min` columns. */
export function toggleCol(cols, key, { min = 0, max = MAX_COLS } = {}) {
  if (cols.includes(key)) return cols.length > min ? cols.filter((k) => k !== key) : cols.slice();
  return cols.length < max ? cols.concat(key) : cols.slice();
}

/** Move a shown column one place left (-1) or right (+1). */
export function moveCol(cols, key, dir) {
  const i = cols.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return cols.slice();
  const out = cols.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Clicking a heading: sort by it; again reverses; numbers and dates start biggest / newest first. */
export function nextSort(cur, key, firstDir = 'asc') {
  if (cur && cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir };
}

/**
 * The rows to show: rows that must always show (new, or with a problem) plus the first
 * `show` of the rest, in their order. → { rows, hidden }
 */
export function limitRows(rows, show, always = () => false) {
  if (show === 'all' || !(show > 0)) return { rows: rows.slice(), hidden: 0 };
  let n = 0, hidden = 0;
  const out = rows.filter((r) => {
    if (always(r)) return true;
    if (n < show) { n++; return true; }
    hidden++;
    return false;
  });
  return { rows: out, hidden };
}

/** Sort rows on r.sortVal: numbers by size, text naturally, blanks last; ties keep their order. */
export function sortByVal(rows, dir) {
  const d = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = a.r.sortVal, y = b.r.sortVal;
    const xe = x == null || x === '', ye = y == null || y === '';
    if (xe || ye) return xe === ye ? a.i - b.i : xe ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return c * d || a.i - b.i;
  }).map((x) => x.r);
}

/* ---------- Cadence tasks as a table ---------- */

export const TASK_COLS = [
  { key: 'due', label: 'Due' },
  { key: 'days', label: 'Days open', num: true },
  { key: 'owner', label: 'Owner' },
  { key: 'assignee', label: 'Assigned to' },
  { key: 'status', label: 'Status' },
  { key: 'repeat', label: 'Repeats' },
  { key: 'notes', label: 'Notes' },
  { key: 'created', label: 'Created', date: true },
  { key: 'doneAt', label: 'Done on', date: true },
];
export const TASK_DEFAULT = ['due', 'days', 'owner', 'assignee', 'status'];

const DAY = 864e5;
const localDay = (t) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };

/** Whole days a task has been open: from when it was made to when it was done (or today). */
export function daysOpen(t, now) {
  if (!t || !(t.createdAt > 0)) return null;
  const end = t.done && t.doneAt > 0 ? t.doneAt : now;
  return Math.max(0, Math.round((localDay(end) - localDay(t.createdAt)) / DAY));
}

const REPEATS = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
const shortDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/**
 * One task cell: { text, sort, num, tone }. dueInfo(due, todayKey) gives the due text and
 * tone ('late' | 'today' | '') the app shows.
 */
export function taskCell(key, t, { todayKey, now, dueInfo }) {
  switch (key) {
    case 'title': { const s = String(t.title || 'Untitled task'); return { text: s, sort: s.toLowerCase() }; }
    case 'due': {
      if (!t.due) return { text: '', sort: null };
      const d = dueInfo(t.due, todayKey);
      return { text: t.done ? d.text.replace(/ · \d+d late$/, '') : d.text, sort: t.due + (t.time || ''), tone: t.done ? '' : d.tone };
    }
    case 'days': { const n = daysOpen(t, now); return { text: n == null ? '' : n === 1 ? '1 day' : n + ' days', sort: n, num: true }; }
    case 'owner': { const s = t.ownerName || t.ownerEmail || ''; return { text: s, sort: s ? s.toLowerCase() : null }; }
    case 'assignee': { const s = t.assigneeName || t.assigneeEmail || (t.assigneeRole ? `${t.assigneeRoleName || 'A role'} (role)` : ''); return { text: s, sort: s ? s.toLowerCase() : null }; }
    case 'status': return { text: t.done ? (t.doneByName ? `Done by ${t.doneByName}` : 'Done') : 'Open', sort: t.done ? 1 : 0, tone: t.done ? 'ok' : '' };
    case 'repeat': { const s = REPEATS[t.repeat] || ''; return { text: s, sort: s || null }; }
    case 'notes': { const s = String(t.notes || '').replace(/\s*\n\s*/g, ' ').trim(); return { text: s, sort: s ? s.toLowerCase() : null, long: true }; }
    case 'created': return { text: shortDate(t.createdAt), sort: t.createdAt || null };
    case 'doneAt': return { text: t.done ? shortDate(t.doneAt) : '', sort: t.done ? t.doneAt || null : null };
    default: return { text: '', sort: null };
  }
}

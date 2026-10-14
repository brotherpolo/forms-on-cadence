// The Reports and Dashboards lists: a table with the columns you pick and one search box
// that looks through every column shown. Pure functions: no DOM, no Firebase.
// A row is { id, name, cells: { key: { text, sort } } }; dash.js works out the cells.

export const REPORT_COLS = [
  { key: 'type', label: 'Type' },
  { key: 'form', label: 'Data from' },
  { key: 'dashes', label: 'On dashboards' },
  { key: 'updated', label: 'Last updated', date: true },
  { key: 'value', label: 'Value' },
  { key: 'group', label: 'Grouped by' },
  { key: 'col', label: 'Split by' },
  { key: 'time', label: 'Over time' },
  { key: 'conds', label: 'Conditions' },
  { key: 'owner', label: 'Owner' },
  { key: 'sharing', label: 'Sharing' },
  { key: 'created', label: 'Created', date: true },
];
export const REPORT_DEFAULT = ['type', 'form', 'dashes', 'updated'];

export const DASH_COLS = [
  { key: 'count', label: 'Reports', num: true },
  { key: 'home', label: 'Home' },
  { key: 'sharing', label: 'Sharing' },
  { key: 'updated', label: 'Last updated', date: true },
  { key: 'reports', label: 'Reports on it' },
  { key: 'period', label: 'Starting period' },
  { key: 'owner', label: 'Owner' },
  { key: 'created', label: 'Created', date: true },
];
export const DASH_DEFAULT = ['count', 'home', 'sharing', 'updated'];

export const colsKey = (kind, uid) => 'fw.cols.' + kind + '.' + (uid || 'me');

/** The columns to show: the saved choice (known keys only, in its order), else the defaults. */
export function readCols(storage, kind, uid, all, defaults) {
  try {
    const v = JSON.parse(storage.getItem(colsKey(kind, uid)));
    if (Array.isArray(v)) { const ok = v.filter((k) => all.some((c) => c.key === k)); return [...new Set(ok)]; }
  } catch (e) { /* none saved, or storage blocked */ }
  return defaults.slice();
}
export function saveCols(storage, kind, uid, cols) {
  try { storage.setItem(colsKey(kind, uid), JSON.stringify(cols)); } catch (e) { /* private mode */ }
}
/** Tick or untick a column; a ticked column joins at the end. */
export function toggleCol(cols, key) { return cols.includes(key) ? cols.filter((k) => k !== key) : cols.concat(key); }
/** Move a shown column one place left (-1) or right (+1). */
export function moveCol(cols, key, dir) {
  const i = cols.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return cols.slice();
  const out = cols.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Rows whose name or shown columns contain every word typed, in any order, any case. */
export function searchRows(rows, q, cols) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice();
  return rows.filter((r) => {
    const hay = norm([r.name].concat(cols.map((k) => r.cells[k]?.text || '')).join(' \u0001 '));
    return words.every((w) => hay.includes(w));
  });
}

const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Sort by a column ('name' or a column key): numbers and dates by value, text naturally, blanks last. */
export function sortRows(rows, key, dir = 1) {
  const val = (r) => (key === 'name' ? r.name : r.cells[key]?.sort ?? r.cells[key]?.text);
  const blank = (v) => v == null || v === '';
  return rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (blank(x) && blank(y)) return coll.compare(a.name || '', b.name || '');
    if (blank(x)) return 1;
    if (blank(y)) return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y));
    return c * dir || coll.compare(a.name || '', b.name || '');
  });
}
/** Clicking a heading: sort by it; clicking again reverses. Dates and numbers start newest / biggest first. */
export function nextSort(cur, key, all) {
  if (cur && cur.k === key) return { k: key, d: -cur.d };
  const c = all.find((x) => x.key === key);
  return { k: key, d: c && (c.date || c.num) ? -1 : 1 };
}

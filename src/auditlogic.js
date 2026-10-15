// Audit trail: what each entry says, the filters, and the CSV. Pure functions: no DOM, no
// Firebase. The entries are written by the server (Cadence folder, functions/audit.js).

/** The "What" filter: kinds of change. `q` is what the server can filter on; `test` checks an entry. */
export const KINDS = [
  { key: '', label: 'Everything' },
  { key: 'created', label: 'Records created', q: ['kind', 'created'], test: (e) => e.area === 'record' && e.kind === 'created' },
  { key: 'changed', label: 'Records changed', q: ['kind', 'changed'], test: (e) => e.area === 'record' && ['changed', 'moved', 'owner'].includes(e.kind) },
  { key: 'deleted', label: 'Records deleted', q: ['kind', 'deleted'], test: (e) => e.area === 'record' && e.kind === 'deleted' },
  { key: 'restored', label: 'Records restored', q: ['kind', 'restored'], test: (e) => e.kind === 'restored' },
  { key: 'emailed', label: 'PDFs emailed', q: ['kind', 'emailed'], test: (e) => e.kind === 'emailed' },
  { key: 'form', label: 'Form designs', q: ['area', 'form'], test: (e) => e.area === 'form' },
  { key: 'group', label: 'Security groups', q: ['area', 'group'], test: (e) => e.area === 'group' },
  { key: 'user', label: 'Users', q: ['area', 'user'], test: (e) => e.area === 'user' },
  { key: 'settings', label: 'Settings', q: ['area', 'settings'], test: (e) => e.area === 'settings' },
];

/**
 * The one filter the database applies (it can use one at a time, newest first); the rest are
 * checked on what comes back. Most specific first: a record, a form, a person, a kind.
 */
export function serverFilter(f) {
  if (f.recordId) return ['recordId', f.recordId];
  if (f.formId) return ['formId', f.formId];
  if (f.by) return ['by', f.by];
  const k = KINDS.find((x) => x.key === f.kind);
  return k && k.q ? k.q : null;
}

/** Whether an entry passes every filter (the search words too). text(entry) gives its searchable text. */
export function matches(e, f, text) {
  if (f.recordId && e.recordId !== f.recordId) return false;
  if (f.formId && e.formId !== f.formId) return false;
  if (f.by && e.by !== f.by) return false;
  const k = KINDS.find((x) => x.key === f.kind);
  if (k && k.test && !k.test(e)) return false;
  if (f.from && e.at < f.from) return false;
  if (f.to && e.at >= f.to) return false;
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) { const t = text(e).toLowerCase(); if (!words.every((w) => t.includes(w))) return false; }
  return true;
}

/** A change's label for people: form settings the server names by their key get a proper name. */
export const changeLabel = (c) => (c.key === 'prop:rules' ? 'Show and hide rules' : c.label);

/** "changed", "deleted"… as a verb for the sentence "Adam changed Invoice INV-0058". */
export function verb(e) {
  const v = {
    created: e.area === 'user' ? 'signed in for the first time:' : 'created',
    changed: 'changed', deleted: 'deleted', restored: 'restored', moved: 'moved', owner: 'gave to someone else',
    emailed: 'emailed the PDF of', removed: 'removed', numbered: 'numbered the records of',
  }[e.kind];
  return v || e.kind || 'changed';
}

/** What the entry is about, in words: "Invoices · INV-0058", "Security group Office"… */
export function targetText(e) {
  if (e.area === 'record') return [e.formName || 'Record', e.title || 'Untitled'].join(' · ');
  if (e.area === 'form') return 'form ' + (e.targetName || e.formName || '');
  if (e.area === 'group') return 'security group ' + (e.targetName || '');
  if (e.area === 'user') return e.targetName || 'an account';
  if (e.area === 'settings') return e.targetName || 'settings';
  return e.targetName || '';
}

/** Which changes can be put back: a field, the parent or the owner, with the whole old value kept. */
export function canPutBack(e, c) {
  if (e.area !== 'record' || !['changed', 'moved', 'owner'].includes(e.kind)) return false;
  if (['signature', 'file', 'image'].includes(c.type)) return false; // only their names are kept
  if (typeof c.from === 'string' && c.from.length >= 1001 && c.from.endsWith('…')) return false; // shortened
  if (c.key === 'parent' || c.key === 'owner') return true;
  return true;
}

/** Midnight (local) of a YYYY-MM-DD, and of the day after, as times. */
export function dayRange(fromKey, toKey) {
  const at = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  return { from: fromKey ? at(fromKey) : null, to: toKey ? at(toKey) + 864e5 : null };
}

/** CSV: one row per change (an entry with no field changes gets one row). show(entry, change, 'from'|'to') formats values. */
export function csvRows(entries, show, when) {
  const rows = [];
  entries.forEach((e) => {
    const base = [when(e.at), e.byName || '', verb(e), e.area === 'record' ? e.formName || '' : e.area, targetText(e)];
    const cs = e.changes && e.changes.length ? e.changes : [null];
    cs.forEach((c) => rows.push([...base, c ? changeLabel(c) : '', c ? show(e, c, 'from') : '', c ? show(e, c, 'to') : '', e.note || '']));
  });
  return { headers: ['When', 'Who', 'What', 'Form or area', 'Record or item', 'Field', 'Was', 'Now', 'Note'], rows };
}

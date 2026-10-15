// Import templates and checking imported rows. Pure functions: no DOM, no Firebase.
//
// A template has one column per importable field (system names as headings), a Record ID
// column (blank = new record, filled = update that record) and, for a form that sits under
// another form, a column naming the parent record. Rows are checked before anything is
// saved; each comes back as new, update, unchanged ("same") or a problem with a way to fix it.

import { isEmpty } from './util.js';

export const MAX_ROWS = 5000;
export const UNDO_DAYS = 7;
export const UNDO_MS = UNDO_DAYS * 864e5;
export const LIST_LIMIT = 2000; // record titles offered as a dropdown in the template, up to this many
export const TEMPLATE_ROWS = 5000; // dropdowns and formats reach this far down the sheet

export const IMPORT_TYPES = new Set(['text', 'textarea', 'email', 'phone', 'url', 'number', 'decimal', 'currency', 'percent', 'rating', 'range', 'date', 'time', 'datetime', 'checkbox', 'select', 'radio', 'multiselect', 'color', 'relation', 'location']);
const SKIP_WHY = { formula: 'calculated', autonumber: 'numbered automatically', file: 'file', image: 'photo', signature: 'signature' };
const NUMERIC = new Set(['number', 'decimal', 'currency', 'percent', 'range', 'rating']);
const TEXTISH = new Set(['text', 'textarea', 'email', 'phone', 'url']);
const TYPE_NAME = { text: 'Text', textarea: 'Long text', email: 'Email', phone: 'Phone', url: 'Website', number: 'Whole number', decimal: 'Decimal', currency: 'Currency', percent: 'Percent', rating: 'Rating', range: 'Number', date: 'Date', time: 'Time', datetime: 'Date and time', checkbox: 'Yes / No', select: 'Choice', radio: 'Choice', multiselect: 'Several choices', color: 'Color', relation: 'Link', location: 'Location' };

/* ---------- small helpers ---------- */

import { sysOf } from './fieldnames.js';

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const normTitle = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const pad = (n) => String(n).padStart(2, '0');

/** A number as plain text without float noise (12.300000000000001 -> "12.3"). */
const numText = (n) => (Number.isInteger(n) ? String(n) : String(+n.toPrecision(15)));

/** Cell value -> trimmed text. */
export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return numText(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v).trim();
}

/** How alike two short strings are, 0..1 (edit distance). */
export function similar(a, b) {
  a = String(a).slice(0, 80); b = String(b).slice(0, 80);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.5) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

function sameVal(a, b) {
  const n = (v) => (v === undefined || v === '' || (Array.isArray(v) && !v.length) ? null : v);
  a = n(a); b = n(b);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => sameVal(a[k], b[k]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------- dates and times ---------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const okYMD = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return y >= 1000 && y <= 9999 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

/** Excel's day number (1900 system) <-> date parts. */
export function serialParts(v) {
  const d = new Date(Math.round((v - 25569) * 864e5));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
export const toSerial = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 864e5 + 25569;

function parseDatePart(sIn) {
  const s = String(sIn).trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m, y, mo, d;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (a > 12) { d = a; mo = b; } else { mo = a; d = b; }
  } else if ((m = /^(?:[a-z]+ )?([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/i.exec(s))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = +m[2]; y = +m[3]; }
  else if ((m = /^(?:[a-z]+ )?(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,})\.? (\d{4})$/i.exec(s))) { mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; d = +m[1]; y = +m[3]; }
  else return null;
  return mo > 0 && okYMD(y, mo, d) ? { y, m: mo, d } : null;
}

function parseTimePart(sIn) {
  const s = String(sIn).trim().toLowerCase();
  let m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*([ap])\.?\s*m?\.?$/.exec(s);
  if (m) {
    let h = +m[1]; const mi = +(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    if (m[3] === 'p' && h < 12) h += 12;
    if (m[3] === 'a' && h === 12) h = 0;
    return { h, mi };
  }
  m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m && +m[1] < 24 && +m[2] < 60) return { h: +m[1], mi: +m[2] };
  return null;
}

export function parseDate(raw) {
  if (typeof raw === 'number') { if (raw < 1 || raw > 2958465) return null; const p = serialParts(Math.floor(raw)); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  const s = String(raw).trim();
  const iso = /^(\d{4}-\d{1,2}-\d{1,2})[T ]/.exec(s);
  const p = parseDatePart(iso ? iso[1] : s);
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
}

export function parseTime(raw) {
  if (typeof raw === 'number') { if (raw < 0) return null; const mins = Math.round((raw % 1) * 1440) % 1440; return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
  const t = parseTimePart(raw);
  return t ? `${pad(t.h)}:${pad(t.mi)}` : null;
}

export function parseDateTime(raw) {
  if (typeof raw === 'number') {
    if (raw < 1 || raw > 2958466) return null;
    const p = serialParts(Math.round(raw * 1440) / 1440);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
  }
  const s = String(raw).trim();
  let m = /^(\d{4}-\d{1,2}-\d{1,2})[T ](.+)$/.exec(s);
  if (!m) m = /^(.*?)[ T]+(\d{1,2}(?::\d{2}){0,2}(?:\.\d+)?\s*(?:[ap]\.?\s*m?\.?)?)$/i.exec(s);
  const d = parseDatePart(m ? m[1] : s);
  if (!d) return null;
  const t = m ? parseTimePart(m[2]) : { h: 0, mi: 0 };
  if (!t) return null;
  return `${d.y}-${pad(d.m)}-${pad(d.d)}T${pad(t.h)}:${pad(t.mi)}`;
}

/* ---------- numbers ---------- */

export function parseNumber(raw) {
  if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
  if (typeof raw === 'boolean') return NaN;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/[\s, ']/g, '').replace(/^[^\d+\-.]+/, '').replace(/[^\d.]+$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/* ---------- template columns ---------- */

export const parentFormsOf = (form, forms) => (forms || []).filter((f) => f.id !== form.id && (f.children || []).some((c) => c.formId === form.id));

/** A sub-form shown as a grid needs a parent; other child forms may stand alone. */
export const parentRequired = (form, parents) => parents.some((p) => (p.children || []).some((c) => c.formId === form.id && c.display === 'grid'));

/**
 * The columns of a form's template, in order: Record ID, the parent (if any), then each
 * importable field. header is the heading written in row 1 (required ones end in " *").
 */
export function templateColumns(form, parents, itemName) {
  const cols = [{ key: 'id', label: 'Record ID', kind: 'id' }];
  if (parents.length) cols.push({ key: 'parent', label: parents.length === 1 ? itemName(parents[0]) : 'Belongs to', kind: 'parent', required: parentRequired(form, parents) });
  (form.fields || []).filter((f) => IMPORT_TYPES.has(f.type)).forEach((f) => cols.push({ key: f.id, label: sysOf(f) || 'Field', kind: 'field', field: f, required: !!f.required }));
  const seen = new Map();
  cols.forEach((c) => {
    const k = norm(c.label), n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    c.name = n > 1 ? `${c.label} (${n})` : c.label;
    c.header = c.name + (c.required ? ' *' : '');
  });
  return cols;
}

export const skippedFields = (form) => (form.fields || []).filter((f) => SKIP_WHY[f.type]).map((f) => ({ id: f.id, label: f.label, why: SKIP_WHY[f.type] }));

const listText = (a, max = 12) => (a.length > max ? a.slice(0, max).join(', ') + ` and ${a.length - max} more` : a.join(', '));

/** One line per column for the Guide sheet and the import screen. */
export function guideRows(form, cols, ctx) {
  const item = ctx.itemName(form).toLowerCase();
  return cols.map((c) => {
    if (c.kind === 'id') return { col: c.name, type: 'ID', required: false, what: `Leave blank to add a new ${item}. Exports fill it in; keep it to update that ${item}.` };
    if (c.kind === 'parent') {
      const names = ctx.parents.map((p) => ctx.itemName(p).toLowerCase());
      return { col: c.name, type: 'Belongs to', required: c.required, what: `The ${names.join(' or ')} this ${item} belongs to: its name or its Record ID.${c.required ? '' : ' Leave blank if it doesn’t belong to one.'}` };
    }
    const f = c.field;
    const range = (f.min != null && f.min !== '' ? ` From ${f.min}` : '') + (f.max != null && f.max !== '' && f.type !== 'rating' ? `${f.min != null && f.min !== '' ? ' to' : ' Up to'} ${f.max}.` : f.min != null && f.min !== '' ? ' up.' : '');
    let what;
    switch (f.type) {
      case 'text': what = 'Any text.'; break;
      case 'textarea': what = 'Any text. Line breaks are kept.'; break;
      case 'email': what = 'An email address like name@example.com.'; break;
      case 'phone': what = 'A phone number with at least 7 digits.'; break;
      case 'url': what = 'A web address like example.com.'; break;
      case 'number': what = 'A whole number.' + range; break;
      case 'decimal': case 'currency': what = 'A number. $ signs and commas are fine.' + range; break;
      case 'percent': what = 'A number: 45 means 45%.' + range; break;
      case 'rating': what = `A whole number from 0 to ${f.max || 5}.`; break;
      case 'range': what = `A number from ${f.min ?? 0} to ${f.max ?? 100}.`; break;
      case 'date': what = 'A date. Any date Excel recognises, or YYYY-MM-DD.'; break;
      case 'time': what = 'A time like 14:30 or 2:30 PM.'; break;
      case 'datetime': what = 'A date and time like 2026-10-13 14:30.'; break;
      case 'checkbox': what = 'Yes or No. Blank means No.'; break;
      case 'select': case 'radio': what = `One of: ${listText(f.options || [])}. Pick from the dropdown.`; break;
      case 'multiselect': what = `Any of: ${listText(f.options || [])}. Separate several with semicolons, like “A; B”.`; break;
      case 'color': what = 'A color code like #3346c8.'; break;
      case 'relation': { const t = ctx.formById(f.relForm); what = t ? `A ${ctx.itemName(t).toLowerCase()} in Formwright: its name or its Record ID.` : 'A record’s name or Record ID.'; break; }
      case 'location': what = 'An address, or latitude and longitude like 43.65, -79.38.'; break;
      default: what = '';
    }
    return { col: c.name, type: TYPE_NAME[f.type] || f.type, required: c.required, what };
  });
}

/* ---------- writing values into a template ---------- */

/** A stored value -> a spreadsheet cell ({ v, s } for dates so Excel shows them as dates). */
export function exportValue(f, v, ctx) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return f.type === 'checkbox' ? 'No' : null;
  switch (f.type) {
    case 'checkbox': return v ? 'Yes' : 'No';
    case 'number': case 'decimal': case 'currency': case 'percent': case 'range': case 'rating': return typeof v === 'number' ? v : parseNumber(v);
    case 'date': { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? { v: toSerial(+m[1], +m[2], +m[3]), s: 'date' } : String(v); }
    case 'datetime': { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v); return m ? { v: toSerial(+m[1], +m[2], +m[3], +m[4], +m[5]), s: 'datetime' } : String(v); }
    case 'time': { const m = /^(\d{1,2}):(\d{2})/.exec(v); return m ? { v: (+m[1] * 60 + +m[2]) / 1440, s: 'time' } : String(v); }
    case 'multiselect': return (Array.isArray(v) ? v : [v]).join('; ');
    case 'relation': { const r = ctx.lookup.byId.get(v); return r ? ctx.titleOf(r) : null; }
    case 'location': return v.address || (v.lat != null && v.lat !== '' ? `${v.lat}, ${v.lng}` : null);
    default: return String(v);
  }
}

/* ---------- reading values out of a file ---------- */

/** Finds records by Record ID or title, with "did you mean" suggestions. */
export function makeLookup(records, titleOf) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const idx = new Map();
  const index = (fid) => {
    let m = idx.get(fid);
    if (!m) {
      m = new Map();
      records.forEach((r) => { if (r.formId !== fid) return; const t = normTitle(titleOf(r)); if (!m.has(t)) m.set(t, []); m.get(t).push(r); });
      idx.set(fid, m);
    }
    return m;
  };
  const memo = new Map();
  return {
    byId,
    titleOf,
    count: (fid) => records.reduce((n, r) => n + (r.formId === fid), 0),
    titles: (fid) => [...index(fid).values()].map((rs) => titleOf(rs[0])),
    find(formIds, text) {
      const s = cellText(text);
      const r = byId.get(s);
      if (r && formIds.includes(r.formId)) return { rec: r };
      const t = normTitle(s);
      const hits = [];
      formIds.forEach((fid) => hits.push(...(index(fid).get(t) || [])));
      if (hits.length === 1) return { rec: hits[0] };
      if (hits.length > 1) return { many: hits };
      const key = formIds.join(',') + '|' + t;
      if (!memo.has(key)) {
        const cands = [];
        formIds.forEach((fid) => {
          const m = index(fid);
          const cheap = m.size > 1500;
          m.forEach((recs, k) => {
            const sc = cheap ? (k.startsWith(t) || t.startsWith(k) ? 0.7 : 0) : similar(t, k);
            if (sc >= 0.6) cands.push([sc, recs]);
          });
        });
        cands.sort((a, b) => b[0] - a[0]);
        memo.set(key, cands.slice(0, 3).flatMap((x) => x[1]).slice(0, 5));
      }
      return { none: true, suggest: memo.get(key) };
    },
  };
}

const recOption = (r, ctx) => ({ v: r.id, label: `${ctx.titleOf(r)} (ID ${r.id})` });

/** How the import screen offers to fix a bad value of this field. */
function fixFor(f, ctx, extra = {}) {
  switch (f.type) {
    case 'select': case 'radio': return { type: 'choice', options: (f.options || []).map((o) => ({ v: o, label: o })), blank: !f.required };
    case 'checkbox': return { type: 'choice', options: [{ v: 'Yes', label: 'Yes' }, { v: 'No', label: 'No' }] };
    case 'date': case 'time': case 'datetime': return { type: f.type };
    case 'relation': return extra.recs && extra.recs.length ? { type: 'choice', options: extra.recs.map((r) => recOption(r, ctx)), blank: !f.required } : { type: 'text' };
    default: return { type: 'text', hint: f.type === 'multiselect' ? 'Separate choices with ;' : '' };
  }
}

/**
 * One cell -> { ok: true, v } or { ok: false, msg, fix }.
 * Blank cells are fine here (required fields are checked separately).
 */
export function parseValue(f, raw, ctx) {
  if (isBlank(raw)) return { ok: true, v: f.type === 'checkbox' ? false : null };
  const bad = (msg, extra) => ({ ok: false, msg, fix: fixFor(f, ctx, extra) });
  const text = cellText(raw);
  const quoted = `“${text.length > 40 ? text.slice(0, 40) + '…' : text}”`;
  if (NUMERIC.has(f.type)) {
    let n;
    if (f.type === 'rating' && typeof raw === 'string' && /^[★☆\s]+$/.test(raw)) n = (raw.match(/★/g) || []).length;
    else n = parseNumber(raw);
    if (n == null || Number.isNaN(n)) return bad(`${quoted} isn’t a number.`);
    if ((f.type === 'number' || f.type === 'rating') && !Number.isInteger(n)) return bad(`${quoted} isn’t a whole number.`);
    if (f.type === 'rating') { if (n < 0 || n > (f.max || 5)) return bad(`must be from 0 to ${f.max || 5}.`); return { ok: true, v: n }; }
    const min = f.type === 'range' ? f.min ?? 0 : f.min, max = f.type === 'range' ? f.max ?? 100 : f.max;
    if (min != null && min !== '' && n < +min) return bad(`${quoted} is below the minimum of ${min}.`);
    if (max != null && max !== '' && n > +max) return bad(`${quoted} is above the maximum of ${max}.`);
    return { ok: true, v: n };
  }
  switch (f.type) {
    case 'text': return { ok: true, v: text };
    case 'textarea': return { ok: true, v: typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : text };
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? { ok: true, v: text } : bad(`${quoted} isn’t an email address.`);
    case 'url': {
      try { const u = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'https://' + text); if (!u.hostname.includes('.')) throw 0; } catch (e) { return bad(`${quoted} isn’t a web address.`); }
      return { ok: true, v: text };
    }
    case 'phone': return /^[+()\-.\s\d]+$/.test(text) && text.replace(/\D/g, '').length >= 7 ? { ok: true, v: text } : bad(`${quoted} isn’t a phone number.`);
    case 'date': { const v = parseDate(raw); return v ? { ok: true, v } : bad(`${quoted} isn’t a date.`); }
    case 'time': { const v = parseTime(raw); return v ? { ok: true, v } : bad(`${quoted} isn’t a time.`); }
    case 'datetime': { const v = parseDateTime(raw); return v ? { ok: true, v } : bad(`${quoted} isn’t a date and time.`); }
    case 'checkbox': {
      if (typeof raw === 'boolean') return { ok: true, v: raw };
      if (typeof raw === 'number' && (raw === 0 || raw === 1)) return { ok: true, v: raw === 1 };
      const t = text.toLowerCase();
      if (['yes', 'y', 'true', 'x', '✓', '✔', 'on', 'checked', '1'].includes(t)) return { ok: true, v: true };
      if (['no', 'n', 'false', 'off', 'unchecked', '0', '-'].includes(t)) return { ok: true, v: false };
      return bad(`${quoted} isn’t Yes or No.`);
    }
    case 'select': case 'radio': {
      const opts = f.options || [];
      const hit = opts.find((o) => o.trim().toLowerCase() === text.toLowerCase()) || opts.find((o) => norm(o) === norm(text));
      if (hit != null) return { ok: true, v: hit };
      const near = opts.map((o) => [similar(norm(o), norm(text)), o]).sort((a, b) => b[0] - a[0])[0];
      return bad(`${quoted} isn’t one of the choices.${near && near[0] >= 0.5 ? ` Closest is “${near[1]}”.` : ''}`);
    }
    case 'multiselect': {
      const opts = f.options || [];
      const find = (p) => opts.find((o) => o.trim().toLowerCase() === p.toLowerCase()) ?? opts.find((o) => norm(o) === norm(p));
      let parts = text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 1 && text.includes(',') && find(text) == null) {
        const byComma = text.split(',').map((p) => p.trim()).filter(Boolean);
        if (byComma.every((p) => find(p) != null)) parts = byComma;
      }
      const out = [], missing = [];
      parts.forEach((p) => { const o = find(p); if (o == null) missing.push(p); else if (!out.includes(o)) out.push(o); });
      if (missing.length) return bad(`${missing.map((m) => `“${m}”`).join(', ')} ${missing.length > 1 ? 'aren’t choices' : 'isn’t one of the choices'}.`);
      return { ok: true, v: opts.filter((o) => out.includes(o)) };
    }
    case 'color': {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
      if (!m) return bad(`${quoted} isn’t a color code like #3346c8.`);
      const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
      return { ok: true, v: '#' + h.toLowerCase() };
    }
    case 'location': {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
      if (m) {
        const lat = +m[1], lng = +m[2];
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return bad('latitude must be -90 to 90 and longitude -180 to 180.');
        return { ok: true, v: { address: '', lat, lng } };
      }
      return { ok: true, v: { address: text, lat: null, lng: null } };
    }
    case 'relation': {
      if (!f.relForm) return bad('this field doesn’t link to a form yet.');
      const hit = ctx.lookup.find([f.relForm], raw);
      if (hit.rec) return { ok: true, v: hit.rec.id };
      const target = ctx.formById(f.relForm);
      const what = target ? ctx.itemName(target).toLowerCase() : 'record';
      if (hit.many) return bad(`${hit.many.length} ${target ? String(target.name).toLowerCase() : 'records'} are called ${quoted}. Pick one.`, { recs: hit.many });
      return bad(`no ${what} called ${quoted}.${hit.suggest.length ? ` Closest is “${ctx.titleOf(hit.suggest[0])}”.` : ''}`, { recs: hit.suggest });
    }
    default: return { ok: true, v: text };
  }
}

/** Is this cell the value the record already has (allowing for how exports write it)? */
function sameAsOld(f, raw, old, ctx) {
  if (isBlank(raw)) return f.type === 'checkbox' ? !old : isEmpty(old);
  const p = parseValue(f, raw, ctx);
  if (p.ok && sameVal(p.v, old)) return true;
  const ex = exportValue(f, old, ctx);
  const t = ex && typeof ex === 'object' ? ex.v : ex;
  return t != null && cellText(t) === cellText(raw);
}

/* ---------- matching columns ---------- */

/** File headings -> [{ key, how }] where key is a template column key ('' = not imported). */
export function matchColumns(headers, cols) {
  const used = new Set();
  const out = headers.map(() => ({ key: '', how: '' }));
  const pass = (how, pred) => headers.forEach((h, i) => {
    if (out[i].key || isBlank(h)) return;
    const n = norm(h);
    const c = cols.find((x) => !used.has(x.key) && pred(x, n));
    if (c) { out[i] = { key: c.key, how }; used.add(c.key); }
  });
  pass('exact', (c, n) => norm(c.header) === n || norm(c.name) === n);
  pass('exact', (c, n) => norm(c.label) === n || (c.field && norm(c.field.id) === n));
  pass('exact', (c, n) => c.field && norm(c.field.label) === n); // a caption, for older templates
  pass('exact', (c, n) => c.key === 'id' && ['id', 'record id', 'recordid', 'record'].includes(n));
  pass('close', (c, n) => c.key === 'parent' && ['parent', 'belongs to', 'parent record', 'parent id'].includes(n));
  pass('close', (c, n) => { const a = norm(c.label); return a.length >= 3 && n.length >= 3 && (n.startsWith(a + ' ') || a.startsWith(n + ' ') || similar(a, n) >= 0.8); });
  return out;
}

/* ---------- checking rows ---------- */

function defaultsFor(form) {
  const v = {};
  (form.fields || []).forEach((f) => { if (f.type === 'checkbox') v[f.id] = false; if (f.type === 'range') v[f.id] = f.min ?? 0; });
  return v;
}

/**
 * Check every row.
 * input: {
 *   form, cols (templateColumns), map: [column key per file column, '' = skip],
 *   rows: [[cell]] (data rows only), rowNums: [sheet row number per row],
 *   overrides: Map(rowIndex -> { cells: { colIndex: raw }, asNew: bool }),
 *   ctx: { lookup (makeLookup), titleOf, formById, itemName, parents, compute(form, rec) -> { fieldId: value }, show(field, v) -> text }
 * }
 * Each result: { i, n, action: 'new'|'update'|'same'|'problem', id, values, parentId, parentFormId, problems, changes }
 */
export function checkRows(input) {
  const { form, cols, map, rows, ctx } = input;
  const overrides = input.overrides || new Map();
  const idCol = map.indexOf('id');
  const cellOf = (i, ci) => { const ov = overrides.get(i); return ov && ov.cells && ci in ov.cells ? ov.cells[ci] : rows[i][ci]; };
  const idOf = (i) => (idCol < 0 || overrides.get(i)?.asNew ? '' : cellText(cellOf(i, idCol)));
  const first = new Map();
  rows.forEach((r, i) => { const id = idOf(i); if (id && !first.has(id)) first.set(id, i); });
  return rows.map((r, i) => checkOne(i, input, (ci) => cellOf(i, ci), idOf(i), first, idCol));
}

function checkOne(i, input, cell, idText, first, idCol) {
  const { form, cols, map, ctx, rowNums } = input;
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const item = ctx.itemName(form).toLowerCase();
  const problems = [], changes = [];
  let existing = null;
  if (idText) {
    const r = ctx.lookup.byId.get(idText);
    if (!r || r.formId !== form.id) problems.push({ ci: idCol, key: 'id', msg: r ? `Record ID ${idText} belongs to a different form.` : `Record ID ${idText}: no ${item} with this ID. It may have been deleted.`, fix: { type: 'asnew' } });
    else if (first.get(idText) !== i) problems.push({ ci: idCol, key: 'id', msg: `Record ID ${idText} is also on row ${rowNums[first.get(idText)]}. A record can only be in the file once.`, fix: { type: 'asnew' } });
    else existing = r;
  }
  const values = existing ? JSON.parse(JSON.stringify(existing.values || {})) : defaultsFor(form);
  let parentId = existing ? existing.parentId || null : null;
  let parentFormId = existing ? existing.parentFormId || null : null;
  const show = (f, v) => (ctx.show ? ctx.show(f, v) : cellText(v));

  map.forEach((key, ci) => {
    if (!key || key === 'id') return;
    const col = byKey.get(key);
    if (!col) return;
    const raw = cell(ci);
    if (key === 'parent') {
      const pids = ctx.parents.map((p) => p.id);
      const oldParent = existing && existing.parentId ? ctx.lookup.byId.get(existing.parentId) : null;
      if (isBlank(raw)) {
        if (col.required) problems.push({ ci, key, msg: `${col.label} is required.`, fix: { type: 'text' } });
        else if (existing && parentId) { changes.push({ label: col.label, from: oldParent ? ctx.titleOf(oldParent) : '', to: '' }); parentId = null; parentFormId = null; }
        return;
      }
      if (oldParent && (cellText(raw) === oldParent.id || normTitle(cellText(raw)) === normTitle(ctx.titleOf(oldParent)))) return;
      const hit = ctx.lookup.find(pids, raw);
      if (hit.rec) {
        if (existing && hit.rec.id !== existing.parentId) changes.push({ label: col.label, from: oldParent ? ctx.titleOf(oldParent) : '', to: ctx.titleOf(hit.rec) });
        parentId = hit.rec.id; parentFormId = hit.rec.formId;
        return;
      }
      const t = cellText(raw), what = ctx.parents.map((p) => ctx.itemName(p).toLowerCase()).join(' or ');
      if (hit.many) problems.push({ ci, key, msg: `${col.label}: ${hit.many.length} records are called “${t}”. Pick one.`, fix: { type: 'choice', options: hit.many.map((r) => recOption(r, ctx)), blank: !col.required } });
      else problems.push({ ci, key, msg: `${col.label}: no ${what} called “${t}”.${hit.suggest.length ? ` Closest is “${ctx.titleOf(hit.suggest[0])}”.` : ''}`, fix: hit.suggest.length ? { type: 'choice', options: hit.suggest.map((r) => recOption(r, ctx)), blank: !col.required } : { type: 'text' } });
      return;
    }
    const f = col.field;
    const old = existing ? existing.values?.[f.id] : undefined;
    if (existing && sameAsOld(f, raw, old, ctx)) return;
    const p = parseValue(f, raw, ctx);
    if (!p.ok) { problems.push({ ci, key, msg: `${col.name}: ${p.msg}`, fix: p.fix }); return; }
    if (existing && !sameVal(p.v, old)) changes.push({ label: col.name, from: show(f, old), to: show(f, p.v) });
    values[f.id] = p.v;
  });

  // required fields: every one on a new record; only the file's columns on an update
  cols.forEach((c) => {
    if (!c.required || problems.some((p) => p.key === c.key)) return;
    const ci = map.indexOf(c.key);
    if (existing && ci < 0) return;
    if (c.kind === 'parent') {
      if (!parentId) problems.push({ ci, key: c.key, msg: ci < 0 ? `${c.label} is required, but no column in your file goes into it.` : `${c.label} is required.`, fix: ci < 0 ? null : { type: 'text' } });
      return;
    }
    if (c.kind !== 'field') return;
    const f = c.field, v = values[f.id];
    if (!(f.type === 'checkbox' ? !v : isEmpty(v))) return;
    problems.push({ ci, key: c.key, msg: ci < 0 ? `${c.name} is required, but no column in your file goes into it.` : f.type === 'checkbox' ? `${c.name} must be Yes.` : `${c.name} is required.`, fix: ci < 0 ? null : fixFor(f, ctx) });
  });

  // a new record under a parent: link fields that point at the parent's form, and copied fields
  if (!existing && parentId) {
    const pf = ctx.formById(parentFormId);
    const parent = ctx.lookup.byId.get(parentId);
    (form.fields || []).forEach((f) => { if (f.type === 'relation' && f.relForm === parentFormId && isEmpty(values[f.id])) values[f.id] = parentId; });
    const rel = (pf?.children || []).find((c) => c.formId === form.id);
    if (rel?.copy && parent) {
      (form.fields || []).forEach((f) => {
        if (f.type === 'formula' || f.type === 'autonumber' || map.includes(f.id)) return;
        const m = (pf.fields || []).find((p) => p.type === f.type && p.type !== 'heading' && String(p.label).trim().toLowerCase() === String(f.label).trim().toLowerCase());
        if (m && !isEmpty(parent.values?.[m.id]) && isEmpty(values[f.id])) values[f.id] = JSON.parse(JSON.stringify(parent.values[m.id]));
      });
    }
  }

  const action = problems.length ? 'problem' : existing ? (changes.length ? 'update' : 'same') : 'new';
  if ((action === 'new' || action === 'update') && ctx.compute) {
    Object.assign(values, ctx.compute(form, { id: existing ? existing.id : '__import' + i, formId: form.id, values, parentId, parentFormId }));
  }
  return { i, n: rowNums[i], action, id: existing ? existing.id : null, values, parentId, parentFormId, problems, changes };
}

export function summarize(results) {
  const s = { rows: results.length, new: 0, update: 0, same: 0, problem: 0 };
  results.forEach((r) => { s[r.action]++; });
  return s;
}

/** Where the data starts: the first row with anything in it is the heading row. */
export function splitSheet(rows) {
  const h = rows.findIndex((r) => r && r.some((x) => !isBlank(x)));
  if (h < 0) return { headers: [], data: [], rowNums: [] };
  const body = rows.slice(h + 1).map((r, k) => ({ r: r || [], n: h + k + 2 })).filter((x) => x.r.some((v) => !isBlank(v)));
  const width = Math.max(rows[h].length, ...body.map((x) => x.r.length));
  const headers = Array.from({ length: width }, (_, k) => cellText(rows[h][k]));
  // drop trailing columns with no heading and nothing in them
  while (headers.length && isBlank(headers[headers.length - 1]) && !body.some((x) => !isBlank(x.r[headers.length - 1]))) headers.pop();
  const data = body.map((x) => Array.from({ length: Math.max(headers.length, x.r.length) }, (_, k) => (x.r[k] === undefined ? null : x.r[k])));
  return { headers, data, rowNums: body.map((x) => x.n) };
}

/* ---------- templates ---------- */

const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;
const colLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/**
 * The sheets of a template workbook, ready for writeXlsx. mode 'blank' or 'data'
 * (every record of the form the admin can see, with Record IDs, for updating).
 * names: { main, guide, lists } sheet names already made safe and unique.
 */
export function templateSheets(form, cols, ctx, mode, names) {
  const STYLE_OF = { date: 'date', datetime: 'datetime', time: 'time', text: 'text', phone: 'text', email: 'text', url: 'text', textarea: 'wrap' };
  const head = cols.map((c) => ({ v: c.header, s: c.kind === 'id' ? 'idhead' : 'head' }));
  const widths = cols.map((c) => ({ width: c.kind === 'id' ? 16 : c.kind === 'parent' ? 28 : c.field.type === 'textarea' ? 40 : Math.min(40, Math.max(12, c.header.length + 4)), style: c.kind === 'id' ? 'text' : c.kind === 'field' ? STYLE_OF[c.field.type] : undefined }));
  const rows = [head];
  if (mode === 'data') {
    ctx.records.filter((r) => r.formId === form.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach((r) => {
      rows.push(cols.map((c) => {
        if (c.kind === 'id') return { v: r.id, s: 'text' };
        if (c.kind === 'parent') { const p = r.parentId && ctx.lookup.byId.get(r.parentId); return p ? ctx.titleOf(p) : null; }
        return exportValue(c.field, r.values?.[c.field.id], ctx);
      }));
    });
  }
  const last = Math.max(TEMPLATE_ROWS, rows.length) + 1;
  const lists = [], validations = [];
  const addList = (ci, title, values, warn) => {
    const k = lists.length;
    lists.push([title, ...values]);
    validations.push({ sqref: `${colLetter(ci)}2:${colLetter(ci)}${last}`, list: `${quoteSheet(names.lists)}!$${colLetter(k)}$2:$${colLetter(k)}$${values.length + 1}`, warn, error: warn ? 'This isn’t on the list. It will be checked when you import.' : 'Pick a value from the list.' });
  };
  cols.forEach((c, ci) => {
    if (c.kind === 'parent') {
      const titles = ctx.parents.flatMap((p) => ctx.lookup.titles(p.id));
      if (titles.length && titles.length <= LIST_LIMIT) addList(ci, c.name, [...new Set(titles)].sort((a, b) => a.localeCompare(b)), true);
      return;
    }
    if (c.kind !== 'field') return;
    const f = c.field;
    if ((f.type === 'select' || f.type === 'radio') && (f.options || []).length) addList(ci, c.name, f.options, false);
    else if (f.type === 'checkbox') validations.push({ sqref: `${colLetter(ci)}2:${colLetter(ci)}${last}`, list: '"Yes,No"' });
    else if (f.type === 'relation' && f.relForm) {
      const titles = ctx.lookup.titles(f.relForm);
      if (titles.length && titles.length <= LIST_LIMIT) addList(ci, c.name, [...new Set(titles)].sort((a, b) => a.localeCompare(b)), true);
    }
  });
  const item = ctx.itemName(form).toLowerCase();
  const guide = [
    [{ v: 'Column', s: 'head' }, { v: 'Type', s: 'head' }, { v: 'Required', s: 'head' }, { v: 'What to enter', s: 'head' }],
    ...guideRows(form, cols, ctx).map((g) => [{ v: g.col, s: 'bold' }, g.type, g.required ? 'Required' : '', { v: g.what, s: 'wrap' }]),
    [],
    [{ v: 'How to use this file', s: 'bold' }],
    [null, null, null, { v: `Keep row 1 as it is. Add one ${item} per row below it, then import the file from the ${form.name} list in Formwright (Import and templates › Import a filled-in file).`, s: 'wrap' }],
    [null, null, null, { v: `Leave Record ID blank for a new ${item}. A row with a Record ID updates that ${item}; only the columns in the file change.`, s: 'wrap' }],
    [null, null, null, { v: 'You can delete columns you don’t need. Formwright ignores this Guide sheet.', s: 'wrap' }],
  ];
  const skipped = skippedFields(form);
  if (skipped.length) guide.push([], [{ v: 'Not in the template', s: 'bold' }], ...skipped.map((s) => [s.label, s.why === 'calculated' ? 'Calculation' : s.why[0].toUpperCase() + s.why.slice(1), '', { v: s.why === 'calculated' ? 'Worked out by Formwright after the import.' : 'Can’t come from a spreadsheet. Add it in Formwright.', s: 'wrap' }]));
  const sheets = [
    { name: names.main, rows, cols: widths, freeze: true, validations },
    { name: names.guide, rows: guide, cols: [{ width: 26 }, { width: 16 }, { width: 11 }, { width: 80 }] },
  ];
  if (lists.length) {
    const height = Math.max(...lists.map((l) => l.length));
    const lrows = Array.from({ length: height }, (_, r) => lists.map((l) => (r === 0 ? { v: l[r], s: 'bold' } : l[r] ?? null)));
    sheets.push({ name: names.lists, rows: lrows, cols: lists.map(() => ({ width: 30 })), hidden: true });
  }
  return sheets;
}

/** The sheet in a picked workbook that holds the data: not hidden, not the Guide or Lists. */
export function pickSheet(sheets) {
  const i = sheets.findIndex((s) => !s.hidden && !/^(guide|lists)$/i.test(s.name) && s.rows.some((r) => r && r.some((x) => !isBlank(x))));
  return i < 0 ? 0 : i;
}

/* ---------- undo ---------- */

/**
 * What undoing an import would do.
 * imp: the import record ({ added, updated, stamp }); records: everything loaded;
 * before: Map(recordId -> the record as it was before the import).
 * Records changed since the import (their updatedAt is no longer the import's stamp) are
 * kept and listed. Rows under removed parents are removed too, so nothing is orphaned.
 */
export function undoPlan(imp, records, before) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const kids = new Map();
  records.forEach((r) => { if (r.parentId) { if (!kids.has(r.parentId)) kids.set(r.parentId, []); kids.get(r.parentId).push(r); } });
  const del = [], kept = [], restore = [];
  let gone = 0;
  (imp.added || []).forEach((id) => {
    const r = byId.get(id);
    if (!r) { gone++; return; }
    if (r.updatedAt !== imp.stamp) kept.push(id); else del.push(id);
  });
  const delSet = new Set(del);
  const under = [];
  const queue = [...del];
  while (queue.length) {
    const id = queue.shift();
    (kids.get(id) || []).forEach((k) => { if (delSet.has(k.id)) return; delSet.add(k.id); under.push(k.id); queue.push(k.id); });
  }
  (imp.updated || []).forEach((id) => {
    const r = byId.get(id);
    if (!r || delSet.has(id)) { gone++; return; }
    const b = before.get(id);
    if (!b) return;
    if (r.updatedAt !== imp.stamp) { kept.push(id); return; }
    restore.push({ id, values: b.values || {}, parentId: b.parentId ?? null, parentFormId: b.parentFormId ?? null });
  });
  return { del, under, restore, kept, gone };
}

/** Undo is offered for 7 days. A "running" import that never finished (the tab closed) can be undone too. */
export const undoOpen = (imp, now) => !!imp && imp.status !== 'undone' && now < (imp.createdAt || 0) + UNDO_MS;

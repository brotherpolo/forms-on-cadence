import { sysOf, uniqueSysNames } from './fieldnames.js';
// Form designer → Fields → Text: a form's fields and sections as plain lines, and back.
// Pure functions (no DOM, no Firebase), unit-tested.
//
//   # Project details                                   ← a section heading
//   Project name: text, required                @p_title
//   Stage: dropdown [Scoping, In progress, Done], half  @p_stage
//   Budget with tax: calculated as currency = ROUND({Budget} * 1.13, 2)  @p_tax
//   Client: link to Clients
//
// The @tag at the end is the field's identity: change the words before it and it's the same
// field (its saved values stay with it). A line without a tag is a new field.
// Only what the text can say is changed; other settings of an existing field are kept.

const TYPE_WORDS = [
  ['text', 'text', ['short text']],
  ['textarea', 'long text', ['textarea', 'paragraph']],
  ['email', 'email', []],
  ['phone', 'phone', []],
  ['url', 'website', ['url', 'web address']],
  ['location', 'location', ['address']],
  ['number', 'whole number', ['number', 'integer']],
  ['decimal', 'decimal', []],
  ['currency', 'currency', ['money']],
  ['percent', 'percent', ['percentage']],
  ['rating', 'rating', ['stars']],
  ['autonumber', 'auto number', ['autonumber']],
  ['range', 'slider', ['range']],
  ['formula', 'calculated', ['calculation', 'formula']],
  ['date', 'date', []],
  ['time', 'time', []],
  ['datetime', 'date & time', ['date and time', 'datetime']],
  ['checkbox', 'yes/no', ['yes / no', 'checkbox', 'yes or no']],
  ['select', 'dropdown', ['select']],
  ['radio', 'single choice', ['radio']],
  ['multiselect', 'multiple choice', ['multi choice', 'multiselect']],
  ['file', 'file', ['file upload']],
  ['image', 'photo', ['image', 'picture']],
  ['signature', 'signature', []],
  ['color', 'color', ['colour']],
  ['relation', 'link to', ['link']],
];
export const TYPE_NAME = Object.fromEntries(TYPE_WORDS.map(([k, w]) => [k, w]));
const WORD_TYPE = new Map();
TYPE_WORDS.forEach(([k, w, more]) => [w, ...more, k].forEach((x) => WORD_TYPE.set(x, k)));
/** Every word Text view takes as a type, and every setting word (for colouring as you type). */
export const TYPE_WORDS_ALL = [...WORD_TYPE.keys()];
export const SETTING_WORDS = ['required', 'half', 'full', 'in list', 'help', 'placeholder', 'system name', 'min', 'max', 'step', 'stars', 'decimals', 'digits', 'start', 'prefix', 'yearly', 'suffix', 'currency', 'as'];
export const TYPE_LIST = TYPE_WORDS.filter(([k]) => k !== 'relation').map(([, w]) => w).concat(['link to <form name>']);

const CHOICE = new Set(['select', 'radio', 'multiselect']);
const FULL_BY_DEFAULT = new Set(['heading', 'textarea', 'location', 'multiselect', 'file', 'signature']);
const FORMATS = ['decimal', 'number', 'currency', 'percent', 'days', 'text'];
const defaultWidth = (type) => (FULL_BY_DEFAULT.has(type) ? 'full' : 'half');
const widthOf = (f) => (f.width === 'half' ? 'half' : 'full');

/* ---------- writing ---------- */
const quote = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const needsQuote = (s, extra) => s !== s.trim() || /^["#]|^\/\//.test(s) || new RegExp('[",\\[\\]@' + extra + ']').test(s);
const nameOut = (s, extra = ':') => (needsQuote(s, extra) ? quote(s) : s);
const numOut = (n) => String(Number(n));

/** One field as a line. formName(id) names a linked form. */
export function fieldLine(f, { formName = () => '', withId = true } = {}) {
  const tag = withId ? '  @' + f.id : '';
  if (f.type === 'heading') return `# ${nameOut(f.label || 'Section', '')}${f.help ? ', help ' + quote(f.help) : ''}${tag}`;
  let type = TYPE_NAME[f.type] || f.type;
  if (f.type === 'relation') type = 'link to ' + nameOut(formName(f.relForm) || '?', '');
  if (CHOICE.has(f.type)) type += ' [' + (f.options || []).map((o) => (/[,\]"]/.test(o) || o !== o.trim() ? quote(o) : o)).join(', ') + ']';
  const o = [type];
  if (f.type === 'formula' && (f.format || 'decimal') !== 'decimal') o.push('as ' + f.format);
  if (f.required && f.type !== 'formula' && f.type !== 'autonumber') o.push('required');
  if (widthOf(f) !== defaultWidth(f.type)) o.push(widthOf(f));
  if (f.inList) o.push('in list');
  if (f.placeholder) o.push('placeholder ' + quote(f.placeholder));
  if (f.type === 'rating') { if ((f.max ?? 5) !== 5) o.push('stars ' + numOut(f.max)); }
  else if (f.type === 'range') {
    if ((f.min ?? 0) !== 0) o.push('min ' + numOut(f.min));
    if ((f.max ?? 100) !== 100) o.push('max ' + numOut(f.max));
    if ((f.step ?? 1) !== 1) o.push('step ' + numOut(f.step));
  } else {
    if (f.min != null && f.min !== '') o.push('min ' + numOut(f.min));
    if (f.max != null && f.max !== '') o.push('max ' + numOut(f.max));
  }
  if ((f.type === 'decimal' || (f.type === 'formula' && ['decimal', 'number', 'percent'].includes(f.format || 'decimal'))) && f.decimals != null && f.decimals !== '' && Number(f.decimals) !== 2) o.push('decimals ' + numOut(f.decimals));
  if ((f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) && f.currency && String(f.currency).toUpperCase() !== 'CAD') o.push('currency ' + String(f.currency).toUpperCase());
  if (f.suffix) o.push('suffix ' + quote(f.suffix));
  if (f.type === 'autonumber') {
    if (f.prefix) o.push('prefix ' + quote(f.prefix));
    if ((f.start ?? 1) !== 1) o.push('start ' + numOut(f.start));
    if ((f.digits ?? 1) !== 1) o.push('digits ' + numOut(f.digits));
    if (f.year) o.push('yearly');
  }
  if (f.help) o.push('help ' + quote(f.help));
  if (String(f.sysName || '').trim() && String(f.sysName).trim() !== f.label) o.push('system name ' + quote(String(f.sysName).trim()));
  const expr = f.type === 'formula' ? ' = ' + String(f.expr || '').replace(/\s*\n\s*/g, ' ') : '';
  return `${nameOut(f.label || 'Untitled field')}: ${o.join(', ')}${expr}${tag}`;
}

/** The whole field list as text. */
export function formToText(form, ctx = {}) {
  const out = [];
  (form.fields || []).forEach((f, i) => {
    if (f.type === 'heading' && i > 0) out.push('');
    out.push(fieldLine(f, ctx));
  });
  return out.join('\n') + '\n';
}

/* ---------- reading ---------- */
function dist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** The type word nearest a misspelling (within 2 letters), or ''. */
function closest(w) {
  if (!w) return '';
  let best = '', bd = 3;
  TYPE_WORDS.forEach(([, word]) => { const x = dist(w, word); if (x < bd) { bd = x; best = word; } });
  return best;
}
/** Splits at top-level commas (outside quotes and [ ]). */
function splitTop(s) {
  const out = []; let cur = '', q = false, br = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && i + 1 < s.length) { cur += s[++i]; continue; } if (c === '"') q = false; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if (c === '[') br++;
    if (c === ']') br = Math.max(0, br - 1);
    if (c === ',' && !br) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  if (q) throw new Error('A quote (") isn’t closed.');
  if (br) throw new Error('A [ isn’t closed with ].');
  return out.map((x) => x.trim());
}
/** Index of the first `ch` outside quotes and brackets, or -1. */
function topIndex(s, ch, from = 0) {
  let q = false, br = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === '"') q = false; continue; }
    if (c === '"') { q = true; continue; }
    if (c === '[') br++;
    else if (c === ']') br = Math.max(0, br - 1);
    else if (!br && s.startsWith(ch, i)) return i;
  }
  return -1;
}
function unquote(s) {
  s = s.trim();
  if (s.startsWith('"')) {
    if (!/"$/.test(s) || s.length < 2) throw new Error(`${s} is missing its closing quote.`);
    return s.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return s;
}
function num(word, v) {
  const n = Number(String(v).trim());
  if (String(v).trim() === '' || !isFinite(n)) throw new Error(`“${word}” needs a number, like ${word} 2.`);
  return n;
}

/**
 * Text → fields. ctx: { fields (the draft's current fields), forms: [{id,name}], newId() }.
 * Returns { fields, errors: [{ line, msg }], warnings: [{ line, msg }] }; fields is null when there are errors.
 */
export function textToFields(text, ctx = {}) {
  const cur = new Map((ctx.fields || []).map((f) => [f.id, f]));
  const known = new Set([...(ctx.known || []), ...cur.keys()]);
  const forms = ctx.forms || [];
  const newId = ctx.newId || (() => 'x' + Math.random().toString(36).slice(2, 9));
  const errors = [], warnings = [], out = [], seen = new Map();
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = i + 1;
    let s = raw.trim();
    if (!s || s.startsWith('//')) return;
    try {
      let id = null;
      const m = /\s@([A-Za-z0-9_-]+)$/.exec(' ' + s);
      if (m) { id = m[1]; s = s.slice(0, s.length - m[0].length + 1).trim(); }
      else if (/\s@\S*$/.test(' ' + s)) throw new Error('The @tag at the end has characters it can’t have. Leave it as it was, or delete it to make a new field.');
      if (id) {
        if (id.startsWith('_')) throw new Error(`@${id} can’t be used: tags can’t start with _.`);
        if (seen.has(id)) throw new Error(`@${id} is also on line ${seen.get(id)}. To copy a field, delete the @tag from the copy so it becomes a new field.`);
        seen.set(id, line);
        if (!known.has(id)) warnings.push({ line, msg: `@${id} isn’t a field on this form, so it’s added as a new field with that tag.` });
      }
      const prev = id ? cur.get(id) : null;
      // a section heading
      if (s.startsWith('#')) {
        const parts = splitTop(s.replace(/^#+\s*/, ''));
        const label = unquote(parts[0] || '');
        if (!label) throw new Error('A section needs a name after the #.');
        const f = prev ? { ...prev } : { id: id || newId(), required: false, inList: false, width: 'full', help: '' };
        if (!f.id) f.id = id || newId();
        Object.assign(f, { type: 'heading', label, help: '' });
        parts.slice(1).forEach((p) => {
          const w = /^help\s+(.*)$/i.exec(p);
          if (!w) throw new Error(`After a section name only help "…" can go: “${p}” isn’t understood.`);
          f.help = unquote(w[1]);
        });
        out.push(f);
        return;
      }
      // Label: type, options = formula
      const colon = topIndex(s, ':');
      if (colon < 0) throw new Error('Write it as  Name: type  (for example  Due date: date, required), or start a section with #.');
      const label = unquote(s.slice(0, colon));
      if (!label) throw new Error('The field needs a name before the colon.');
      let rest = s.slice(colon + 1).trim();
      let expr = null;
      const eq = topIndex(rest, '=');
      if (eq >= 0) { expr = rest.slice(eq + 1).trim(); rest = rest.slice(0, eq).trim(); }
      const parts = splitTop(rest);
      // the type (with its options list, or the linked form)
      let t = parts[0] || '', opts = null;
      const lb = t.indexOf('[');
      if (lb >= 0) {
        if (!/\]\s*$/.test(t)) throw new Error('Options go inside [ ], like dropdown [Open, Closed].');
        opts = splitTop(t.slice(lb + 1, t.lastIndexOf(']'))).map(unquote).filter((x) => x !== '');
        t = t.slice(0, lb).trim();
      }
      const tl = t.toLowerCase().replace(/\s+/g, ' ');
      let type = WORD_TYPE.get(tl), relForm = null;
      if (!type && /^link( to)?\s+/.test(tl)) {
        type = 'relation';
        const name = unquote(t.replace(/^link(\s+to)?\s+/i, ''));
        const fm = forms.find((x) => String(x.name || '').trim().toLowerCase() === name.trim().toLowerCase());
        if (!fm) throw new Error(`There’s no form called “${name}”. Forms: ${forms.map((x) => x.name).join(', ') || 'none'}.`);
        relForm = fm.id;
      }
      if (type === 'relation' && !relForm) throw new Error('Say which form it links to, like  Client: link to Clients.');
      if (!type) { const near = closest(tl); throw new Error(`“${t || '(nothing)'}” isn’t a field type.${near ? ` Did you mean “${near}”?` : ''} Use one of: ${TYPE_LIST.join(', ')}.`); }
      if (opts && !CHOICE.has(type)) throw new Error('Only dropdown, single choice and multiple choice fields take options in [ ].');
      if (CHOICE.has(type) && !(opts || []).length) throw new Error(`A ${TYPE_NAME[type]} needs its options, like ${TYPE_NAME[type]} [Open, Closed].`);
      if (expr != null && type !== 'formula') throw new Error('Only calculated fields take = and a formula.');
      if (type === 'formula' && !expr) throw new Error('A calculated field needs its formula after =, like  = {Price} * {Quantity}.');
      // start from the field as it was (keeps what the text can't say), then set what it says
      const f = prev ? { ...prev } : { id: id || newId() };
      if (!f.id) f.id = id || newId();
      const wasType = prev?.type;
      Object.assign(f, { type, label, required: false, width: defaultWidth(type), inList: false, help: '' });
      for (const k of ['placeholder', 'min', 'max', 'step', 'suffix', 'sysName']) delete f[k];
      if (type === 'decimal') f.decimals = 2; else if (type !== 'formula') delete f.decimals;
      if (type === 'currency') f.currency = 'CAD'; else if (type !== 'formula') delete f.currency;
      if (type === 'rating') f.max = 5;
      if (type === 'range') Object.assign(f, { min: 0, max: 100, step: 1 });
      if (type === 'autonumber') Object.assign(f, { prefix: '', start: 1, digits: 1, year: false });
      if (type === 'formula') Object.assign(f, { expr, format: 'decimal', decimals: 2 }); else delete f.expr;
      if (type === 'formula' && wasType === 'formula' && prev.currency) f.currency = prev.currency;
      if (CHOICE.has(type)) f.options = opts; else delete f.options;
      if (type === 'relation') f.relForm = relForm; else delete f.relForm;
      for (const p of parts.slice(1)) {
        if (!p) throw new Error('There’s an extra comma.');
        const sn = /^system\s+name\s+(.*)$/i.exec(p);
        if (sn) { const v = unquote(sn[1]).trim(); if (!v) throw new Error('system name needs a name in quotes, like system name "Contact name".'); if (/[{}]/.test(v)) throw new Error('A system name can’t have { or } in it.'); f.sysName = v.slice(0, 80); continue; }
        const w = /^([a-z]+(?:\s+list)?)\b\s*(.*)$/i.exec(p);
        const key = (w ? w[1] : p).toLowerCase(), val = w ? w[2] : '';
        const only = (types, what) => { if (!types.includes(type)) throw new Error(`“${key}” doesn’t apply to a ${TYPE_NAME[type]} field${what ? ' (' + what + ')' : ''}.`); };
        switch (key) {
          case 'required': if (type === 'formula' || type === 'autonumber') throw new Error(`A ${TYPE_NAME[type]} field fills itself in, so it can’t be required.`); f.required = true; break;
          case 'half': case 'full': f.width = key; break;
          case 'in list': f.inList = true; break;
          case 'help': f.help = unquote(val); break;
          case 'placeholder': f.placeholder = unquote(val); break;
          case 'min': only(['number', 'decimal', 'currency', 'percent', 'range']); f.min = num('min', val); break;
          case 'max': only(['number', 'decimal', 'currency', 'percent', 'range']); f.max = num('max', val); break;
          case 'step': only(['range']); f.step = num('step', val); break;
          case 'stars': only(['rating']); f.max = num('stars', val); break;
          case 'decimals': only(['decimal', 'formula']); f.decimals = num('decimals', val); break;
          case 'digits': only(['autonumber']); f.digits = num('digits', val); break;
          case 'start': only(['autonumber']); f.start = num('start', val); break;
          case 'prefix': only(['autonumber']); f.prefix = unquote(val); break;
          case 'yearly': only(['autonumber']); f.year = true; break;
          case 'suffix': only(['range']); f.suffix = unquote(val); break;
          case 'currency': only(['currency', 'formula']); if (!/^[a-z]{3}$/i.test(val.trim())) throw new Error('currency needs a 3-letter code, like currency USD.'); f.currency = val.trim().toUpperCase(); break;
          case 'as': {
            only(['formula'], 'it says how a calculation shows');
            const fm = val.trim().toLowerCase();
            if (!FORMATS.includes(fm)) throw new Error(`“as ${val}” isn’t a way to show a result. Use one of: ${FORMATS.join(', ')}.`);
            f.format = fm; if (fm === 'currency' && !f.currency) f.currency = 'CAD'; break;
          }
          default: throw new Error(`“${p}” isn’t understood. You can use: required, half, full, in list, help "…", placeholder "…", system name "…", min, max${type === 'formula' ? ', as currency' : ''}${type === 'autonumber' ? ', prefix, start, digits, yearly' : ''}.`);
        }
      }
      out.push(f);
    } catch (e) {
      errors.push({ line, msg: e.message });
    }
  });
  // every field gets a unique system name (a second "Name" becomes "Name 2"); calculations must name fields that exist
  const lineOf = (f) => { let n = 0, k = -1; for (let i = 0; i < lines.length; i++) { const s = lines[i].trim(); if (!s || s.startsWith('//')) continue; k++; if (out[k] === f) { n = i + 1; break; } } return n; };
  let given = [];
  if (!errors.length) {
    const u = uniqueSysNames(out);
    given = u.given;
    u.fields.forEach((f, i) => { if (f !== out[i]) out[i] = f; });
    const lc = (x) => String(x).trim().toLowerCase();
    const caps = new Map();
    out.forEach((f) => { if (f.type !== 'heading') caps.set(lc(f.label), (caps.get(lc(f.label)) || 0) + 1); });
    const sysNames = new Set(out.filter((f) => f.type !== 'heading').map((f) => lc(sysOf(f))));
    const names = new Set(sysNames);
    caps.forEach((n, k) => { if (n === 1) names.add(k); }); // a caption only one field has works too
    // a renamed field: calculations that use its old system name follow it, as in the designer
    const renamed = new Map();
    out.forEach((f) => { const o = cur.get(f.id); if (o && o.type !== 'heading' && f.type !== 'heading' && sysOf(o) !== sysOf(f) && !sysNames.has(lc(sysOf(o)))) renamed.set(lc(sysOf(o)), sysOf(f)); });
    out.forEach((f) => {
      if (f.type !== 'formula') return;
      if (renamed.size) f.expr = String(f.expr).replace(/\{([^}]*)\}/g, (m, n) => (renamed.has(lc(n)) ? '{' + renamed.get(lc(n)) + '}' : m));
      const bad = [...String(f.expr).matchAll(/\{([^}]*)\}/g)].map((x) => x[1].trim()).filter((n) => !names.has(lc(n)));
      if (bad.length) errors.push({ line: lineOf(f), msg: `{${bad[0]}} isn’t a field on this form.` });
    });
  }
  errors.sort((a, b) => a.line - b.line);
  return { fields: errors.length ? null : out, errors, warnings, given };
}

/* ---------- what changed ---------- */
function lisLength(arr) {
  const t = [];
  arr.forEach((x) => { let lo = 0, hi = t.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; } t[lo] = x; });
  return t.length;
}
const SAY = ['type', 'label', 'sysName', 'required', 'width', 'inList', 'help', 'placeholder', 'options', 'min', 'max', 'step', 'decimals', 'currency', 'suffix', 'prefix', 'start', 'digits', 'year', 'expr', 'format', 'relForm'];
const DEFAULTS = {
  decimal: { decimals: 2 }, currency: { currency: 'CAD' }, rating: { max: 5 }, range: { min: 0, max: 100, step: 1 },
  autonumber: { prefix: '', start: 1, digits: 1 }, formula: { format: 'decimal', decimals: 2 },
};
const norm = (f, k) => {
  if (k === 'width') return widthOf(f);
  if (k === 'required' || k === 'inList' || k === 'year') return !!f[k];
  const v = f[k] ?? DEFAULTS[f.type]?.[k] ?? '';
  return k === 'currency' && v ? String(v).toUpperCase() : v;
};

/** Field changes between two field lists. countValues(id) → saved records with a value in it. */
export function fieldChanges(before = [], after = [], countValues = () => 0) {
  const b = new Map(before.map((f) => [f.id, f])), a = new Map(after.map((f) => [f.id, f]));
  const ch = { added: [], removed: [], renamed: [], retyped: [], changed: [], moved: 0 };
  after.forEach((f) => { if (!b.has(f.id)) ch.added.push(f.label); });
  before.forEach((f) => { if (!a.has(f.id)) ch.removed.push({ label: f.label, heading: f.type === 'heading', values: f.type === 'heading' ? 0 : countValues(f.id) }); });
  after.forEach((f) => { const o = b.get(f.id); if (o && o.label !== f.label) ch.renamed.push([o.label, f.label]); });
  const ren = new Map(after.filter((f) => b.has(f.id) && sysOf(b.get(f.id)) !== sysOf(f)).map((f) => [sysOf(b.get(f.id)).trim().toLowerCase(), sysOf(f)]));
  const follow = (e) => String(e || '').replace(/\{([^}]*)\}/g, (m, n) => (ren.has(n.trim().toLowerCase()) ? '{' + ren.get(n.trim().toLowerCase()) + '}' : m));
  ch.followed = [];
  after.forEach((f) => {
    const o = b.get(f.id); if (!o) return;
    if (o.type !== f.type) { ch.retyped.push(f.label); return; }
    const diff = SAY.filter((k) => k !== 'label' && JSON.stringify(norm(o, k)) !== JSON.stringify(norm(f, k)));
    if (diff.length === 1 && diff[0] === 'expr' && ren.size && follow(o.expr) === f.expr) ch.followed.push(f.label);
    else if (diff.length) ch.changed.push(f.label);
  });
  const order = new Map(before.map((f, i) => [f.id, i]));
  const common = after.filter((f) => order.has(f.id)).map((f) => order.get(f.id));
  ch.moved = common.length - lisLength(common);
  return ch;
}
const list = (xs, n = 4) => (xs.length > n ? xs.slice(0, n).join(', ') + ` and ${xs.length - n} more` : xs.join(', '));

/** Field changes as short lines for a summary. */
export function changeLines(ch) {
  const out = [];
  if (ch.added.length) out.push(`Added ${ch.added.length}: ${list(ch.added)}`);
  if (ch.removed.length) {
    const vals = ch.removed.filter((r) => r.values);
    out.push(`Removed ${ch.removed.length}: ${list(ch.removed.map((r) => r.label + (r.values ? ` (${r.values} record${r.values === 1 ? ' has' : 's have'} a value)` : '')))}${vals.length ? '. Saved values are kept, hidden, and come back if the field is restored.' : ''}`);
  }
  if (ch.renamed.length) out.push(`Renamed ${ch.renamed.length}: ${list(ch.renamed.map(([o, n]) => `${o} → ${n}`), 3)}`);
  if (ch.retyped.length) out.push(`Type changed: ${list(ch.retyped)}`);
  if (ch.changed.length) out.push(`Settings changed: ${list(ch.changed)}`);
  if (ch.followed?.length) out.push(`Calculations updated to the new name${ch.renamed.length === 1 ? '' : 's'}: ${list(ch.followed)}`);
  if (ch.moved) out.push(`Moved ${ch.moved}`);
  return out;
}

/** Everything that differs between two versions of a whole form, as short lines. */
export function formChangeLines(before, after, countValues) {
  if (!before) return ['First version'];
  const out = changeLines(fieldChanges(before.fields || [], after.fields || [], countValues));
  const same = (k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  if ((before.name || '') !== (after.name || '')) out.push(`Renamed the form: ${before.name} → ${after.name}`);
  if (!same('children')) out.push('Relationships changed');
  if (!same('rules')) out.push(`Rules changed (${(before.rules || []).length} → ${(after.rules || []).length})`);
  if (!same('workflow')) out.push('Workflow changed');
  const SKIP = new Set(['fields', 'children', 'rules', 'workflow', 'name', 'updatedAt', 'activeVersion', 'id', 'order']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => !SKIP.has(k)));
  if ([...keys].some((k) => !same(k))) out.push('Settings changed');
  return out.length ? out : ['No changes'];
}

/** A version file's form, checked: { form } or { error }. */
export function readVersionFile(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { error: 'That isn’t a JSON file Formwright can read.' }; }
  const form = j && j.formwright === 'form-version' ? j.form : j;
  if (!form || typeof form !== 'object' || !Array.isArray(form.fields)) return { error: 'That file doesn’t hold a form (it has no list of fields).' };
  const bad = form.fields.find((f) => !f || typeof f !== 'object' || !f.id || !f.type || !(f.type === 'heading' || TYPE_NAME[f.type]));
  if (bad) return { error: `A field in that file isn’t valid${bad && bad.label ? ` (“${bad.label}”)` : ''}.` };
  return { form, formId: j.formId || form.id || null, formName: j.formName || form.name || '', version: j.version || null };
}

// Show/hide rules: "When Status is Closed, hide Tasks", "When Type is Repair, show Warranty and
// set Warranty end required". Pure functions (no DOM, no Firebase), so they're unit-tested and
// shared by the record page, saving, PDFs, the designer and "apply to existing records".
//
// A form keeps its rules in form.rules:
//   { id, off?, join: 'all'|'any', conds: [Cond | Group], acts: [{ do, targets: [key] }] }
//   Cond  { id, src: 'self' | <parent form id>, field, op, value }
//   Group { id, group: true, join: 'all'|'any', conds: [Cond] }        (one level only)
//   do    'hide' | 'show' | 'require' | 'optional' | 'clear'
//   key   'f:<field id>' (a field, or a Section Heading and everything under it)
//         'g:<sub-form id>' (a grid) · 'c:<child form id>' (a child section) · 't:tasks'
//
// How they combine:
//   · Show when… means hidden otherwise. Hide wins over Show when both apply.
//   · Set required when… means not required otherwise. Required wins over Not required.
//     A hidden field is never required.
//   · Clear value: while it applies, the field is empty and locked.
//   · A hidden or cleared field counts as empty for every rule (what will be saved), so
//     rules that depend on it are worked out again until nothing changes.
import { headingOf } from './foldlogic.js';

export const ACTIONS = [
  { key: 'hide', label: 'Hide' },
  { key: 'show', label: 'Show' },
  { key: 'require', label: 'Set required' },
  { key: 'optional', label: 'Set not required' },
  { key: 'clear', label: 'Clear value' },
];
export const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));

const NO_VALUE = new Set(['heading', 'formula', 'autonumber']);
/** Fields whose value a rule can clear or make required. */
export const holdsValue = (f) => !!f && !NO_VALUE.has(f.type);

/** What kind of comparisons a field gets. */
export function kindOf(f) {
  if (!f) return 'other';
  switch (f.type) {
    case 'select': case 'radio': return 'choice';
    case 'multiselect': return 'multi';
    case 'checkbox': return 'bool';
    case 'number': case 'decimal': case 'currency': case 'percent': case 'rating': case 'range': return 'num';
    case 'formula': return f.format === 'date' ? 'date' : f.format === 'text' ? 'text' : 'num';
    case 'date': case 'datetime': return 'date';
    case 'time': return 'time';
    case 'text': case 'textarea': case 'email': case 'phone': case 'url': case 'autonumber': return 'text';
    case 'relation': return 'link';
    default: return 'other';
  }
}

// value: '' none · 'one' one option · 'many' several options · 'num' · 'date' · 'time' · 'text' · 'record'
const E = [{ key: 'empty', label: 'is empty', value: '' }, { key: 'filled', label: 'is not empty', value: '' }];
export const OPS = {
  choice: [{ key: 'is', label: 'is', value: 'one' }, { key: 'not', label: 'is not', value: 'one' }, { key: 'anyof', label: 'is any of', value: 'many' }, { key: 'noneof', label: 'is none of', value: 'many' }, ...E],
  multi: [{ key: 'has', label: 'includes', value: 'one' }, { key: 'hasnot', label: 'doesn’t include', value: 'one' }, { key: 'hasany', label: 'includes any of', value: 'many' }, ...E],
  bool: [{ key: 'yes', label: 'is Yes', value: '' }, { key: 'no', label: 'is No', value: '' }],
  num: [{ key: 'eq', label: '=', value: 'num' }, { key: 'ne', label: '≠', value: 'num' }, { key: 'gt', label: 'more than', value: 'num' }, { key: 'ge', label: 'at least', value: 'num' }, { key: 'lt', label: 'less than', value: 'num' }, { key: 'le', label: 'at most', value: 'num' }, ...E],
  date: [{ key: 'on', label: 'is on', value: 'date' }, { key: 'before', label: 'is before', value: 'date' }, { key: 'after', label: 'is after', value: 'date' }, { key: 'onbefore', label: 'is on or before', value: 'date' }, { key: 'onafter', label: 'is on or after', value: 'date' }, ...E],
  time: [{ key: 'on', label: 'is', value: 'time' }, { key: 'before', label: 'is before', value: 'time' }, { key: 'after', label: 'is after', value: 'time' }, ...E],
  text: [{ key: 'is', label: 'is', value: 'text' }, { key: 'not', label: 'is not', value: 'text' }, { key: 'contains', label: 'contains', value: 'text' }, { key: 'notcontains', label: 'doesn’t contain', value: 'text' }, ...E],
  link: [{ key: 'is', label: 'is', value: 'record' }, { key: 'not', label: 'is not', value: 'record' }, ...E],
  other: [...E],
};
export const opsFor = (f) => OPS[kindOf(f)];
export const opOf = (f, op) => opsFor(f).find((o) => o.key === op) || null;

export function isBlank(v) {
  if (v == null || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  if (typeof v === 'object') return Object.values(v).every((x) => x == null || x === '');
  return false;
}
const low = (s) => String(s ?? '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const day = (v, n) => String(v ?? '').slice(0, n);

/** Does one condition hold for value v of field f? An unfinished condition never holds. */
export function testCond(cond, v, f) {
  const o = f && opOf(f, cond.op);
  if (!o) return false;
  if (cond.op === 'empty') return isBlank(v);
  if (cond.op === 'filled') return !isBlank(v);
  const want = cond.value;
  if (o.value && o.value !== '' && (want == null || want === '' || (Array.isArray(want) && !want.length))) return false;
  switch (kindOf(f)) {
    case 'choice':
      if (cond.op === 'is') return v === want;
      if (cond.op === 'not') return v !== want;
      if (cond.op === 'anyof') return list(want).includes(v);
      if (cond.op === 'noneof') return !list(want).includes(v);
      return false;
    case 'multi': {
      const have = list(v);
      if (cond.op === 'has') return have.includes(want);
      if (cond.op === 'hasnot') return !have.includes(want);
      if (cond.op === 'hasany') return list(want).some((x) => have.includes(x));
      return false;
    }
    case 'bool': return cond.op === 'yes' ? v === true : v !== true;
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return cond.op === 'ne';
      const w = Number(want);
      if (!Number.isFinite(w)) return false;
      return { eq: v === w, ne: v !== w, gt: v > w, ge: v >= w, lt: v < w, le: v <= w }[cond.op] ?? false;
    }
    case 'date': case 'time': {
      if (isBlank(v)) return false;
      const n = kindOf(f) === 'date' ? 10 : 5;
      const a = day(v, n), b = day(want, n);
      return { on: a === b, before: a < b, after: a > b, onbefore: a <= b, onafter: a >= b }[cond.op] ?? false;
    }
    case 'text':
      if (cond.op === 'is') return low(v) === low(want);
      if (cond.op === 'not') return low(v) !== low(want);
      if (cond.op === 'contains') return low(v).includes(low(want));
      if (cond.op === 'notcontains') return !low(v).includes(low(want));
      return false;
    case 'link':
      if (cond.op === 'is') return v === want;
      if (cond.op === 'not') return v !== want;
      return false;
    default: return false;
  }
}

/**
 * Does a rule's "when" hold? look(cond) → { f, v } (the field and its value), or null when the
 * field doesn't exist any more (that condition never holds). A rule with no complete
 * condition never fires.
 */
export function ruleFires(rule, look) {
  const one = (c) => { const x = look(c); return !!x && testCond(c, x.v, x.f); };
  const group = (g) => {
    const cs = (g.conds || []).filter((c) => c && c.field);
    if (!cs.length) return null;
    return g.join === 'any' ? cs.some(one) : cs.every(one);
  };
  const parts = (rule.conds || []).map((c) => (c && c.group ? group(c) : c && c.field ? one(c) : null)).filter((x) => x !== null);
  if (!parts.length) return false;
  return rule.join === 'any' ? parts.some(Boolean) : parts.every(Boolean);
}

/** The keys a rule's actions point at, with what they do: [[do, key]]. */
const actPairs = (rule) => (rule.acts || []).flatMap((a) => (a.targets || []).map((k) => [a.do, k]));

/**
 * Work out the rules for one record.
 *   form: the form (fields, rules)
 *   get(src, fieldId) → { f, v }: the field and its value on this record ('self') or on its
 *     parent (src = the parent form's id; null when the record's parent is another form)
 * → { hidden: Set(keys), hiddenFields: Set(field ids), cleared: Set(field ids),
 *     required: (field) → boolean, fired: Map(rule id → boolean), blank: Set(field ids) }
 */
export function evaluate(form, get) {
  const fields = form?.fields || [];
  const rules = (form?.rules || []).filter((r) => r && !r.off);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const under = headingOf(fields);
  let blank = new Set();
  let st = null;
  for (let pass = 0; pass < 6; pass++) {
    const look = (c) => {
      if (!c.src || c.src === 'self') { const f = byId.get(c.field); if (!f) return null; return { f, v: blank.has(f.id) ? null : get('self', c.field)?.v }; }
      return get(c.src, c.field);
    };
    st = once(rules, fields, byId, under, look);
    if (sameSet(st.blank, blank)) break;
    blank = st.blank;
  }
  return st;
}
function once(rules, fields, byId, under, look) {
  const show = new Map(), hide = new Set(), req = new Map(), opt = new Set(), clear = new Set(), fired = new Map();
  rules.forEach((r) => {
    const on = ruleFires(r, look);
    fired.set(r.id, on);
    actPairs(r).forEach(([d, k]) => {
      if (d === 'show') { if (!show.has(k)) show.set(k, false); if (on) show.set(k, true); }
      if (!on) { if (d === 'require' && !req.has(k)) req.set(k, false); return; }
      if (d === 'hide') hide.add(k);
      if (d === 'require') req.set(k, true);
      if (d === 'optional') opt.add(k);
      if (d === 'clear') clear.add(k);
    });
  });
  const hidden = new Set(hide);
  show.forEach((any, k) => { if (!any) hidden.add(k); });
  const hiddenFields = new Set();
  fields.forEach((f) => { if (hidden.has('f:' + f.id) || (under[f.id] && hidden.has('f:' + under[f.id]))) hiddenFields.add(f.id); });
  fields.forEach((f) => { if (hiddenFields.has(f.id)) hidden.add('f:' + f.id); });
  const cleared = new Set();
  clear.forEach((k) => { const f = byId.get(k.slice(2)); if (k.startsWith('f:') && holdsValue(f) && !hiddenFields.has(f.id)) cleared.add(f.id); });
  const blank = new Set([...hiddenFields, ...cleared].filter((id) => holdsValue(byId.get(id))));
  const required = (f) => {
    if (!f || !holdsValue(f) || hiddenFields.has(f.id) || cleared.has(f.id)) return false;
    const k = 'f:' + f.id;
    if (req.get(k) === true) return true;
    if (opt.has(k)) return false;
    if (req.has(k)) return false; // "set required when…" and it doesn't apply
    return !!f.required;
  };
  return { hidden, hiddenFields, cleared, required, fired, blank };
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** No rules at all: everything as designed. */
export const NO_RULES = { hidden: new Set(), hiddenFields: new Set(), cleared: new Set(), required: (f) => !!(f && f.required && holdsValue(f)), fired: new Map(), blank: new Set() };

/** The fields a save empties: hidden or cleared, and holding something now. */
export function toClear(form, values, st) {
  return (form?.fields || []).filter((f) => holdsValue(f) && st.blank.has(f.id) && !isBlank(values?.[f.id])).map((f) => f.id);
}
/** values with those fields removed (a new object). */
export function withoutCleared(values, ids) {
  const out = { ...(values || {}) };
  ids.forEach((id) => { delete out[id]; });
  return out;
}

/** Everything a rule could point at on this form, for the designer's menus. */
export function targetsOf(form, { grids = [], kids = [], tasks = true } = {}) {
  const out = (form?.fields || []).map((f) => ({ key: 'f:' + f.id, label: f.label || 'Untitled field', kind: f.type === 'heading' ? 'section' : 'field', field: f }));
  grids.forEach((cf) => out.push({ key: 'g:' + cf.id, label: cf.name, kind: 'grid' }));
  kids.forEach((cf) => out.push({ key: 'c:' + cf.id, label: cf.name, kind: 'child' }));
  if (tasks) out.push({ key: 't:tasks', label: 'Tasks', kind: 'tasks' });
  return out;
}
/** Can this action apply to this target? */
export function actionFits(d, t) {
  if (!t) return false;
  if (d === 'hide' || d === 'show') return true;
  return t.kind === 'field' && holdsValue(t.field);
}

/**
 * Problems and clashes to show in the designer: [{ ruleId, text }].
 * ctx: { targets (targetsOf), parentFields: Map(formId → { name, fields }) }
 */
export function checkRules(form, ctx) {
  const out = [];
  const tmap = new Map((ctx.targets || []).map((t) => [t.key, t]));
  const fmap = new Map((form?.fields || []).map((f) => [f.id, f]));
  const name = (k) => tmap.get(k)?.label || 'something that no longer exists';
  const rules = (form?.rules || []).filter((r) => r && !r.off);
  const flat = (r) => (r.conds || []).flatMap((c) => (c && c.group ? c.conds || [] : [c])).filter(Boolean);
  rules.forEach((r, i) => {
    const n = `Rule ${(form.rules || []).indexOf(r) + 1}`;
    const cs = flat(r);
    if (!cs.some((c) => c.field)) out.push({ ruleId: r.id, text: `${n} has no conditions yet, so it never applies.` });
    if (!actPairs(r).length) out.push({ ruleId: r.id, text: `${n} doesn’t do anything yet: add what it hides, shows or sets.` });
    cs.forEach((c) => {
      if (!c.field) return;
      const pf = c.src && c.src !== 'self' ? ctx.parentFields?.get(c.src) : null;
      const f = !c.src || c.src === 'self' ? fmap.get(c.field) : pf?.fields?.find((x) => x.id === c.field);
      if (!f) { out.push({ ruleId: r.id, text: `${n} uses a field that no longer exists. That condition never holds.` }); return; }
      const o = opOf(f, c.op);
      if (!o) { out.push({ ruleId: r.id, text: `${n}: pick how to compare ${f.label}.` }); return; }
      if (o.value === 'one' || o.value === 'many') {
        const bad = list(c.value).filter((x) => !(f.options || []).includes(x));
        if (bad.length) out.push({ ruleId: r.id, text: `${n}: “${bad[0]}” is no longer an option of ${f.label}.` });
        if (!list(c.value).length) out.push({ ruleId: r.id, text: `${n}: pick a value for ${f.label}.` });
      } else if (o.value && (c.value == null || c.value === '')) out.push({ ruleId: r.id, text: `${n}: fill in a value for ${f.label}.` });
    });
    actPairs(r).forEach(([d, k]) => {
      if (!tmap.has(k)) out.push({ ruleId: r.id, text: `${n} points at something that no longer exists.` });
      else if (!actionFits(d, tmap.get(k))) out.push({ ruleId: r.id, text: `${n}: “${ACTION_LABEL[d]}” doesn’t work on ${name(k)}.` });
      if (k.startsWith('f:') && (d === 'hide' || d === 'show' || d === 'clear') && cs.some((c) => (!c.src || c.src === 'self') && 'f:' + c.field === k)) {
        out.push({ ruleId: r.id, text: `${n} ${d === 'clear' ? 'clears' : 'hides'} ${name(k)}, which its own condition looks at. Once saved it would be emptied, and the rule would change its mind.` });
      }
    });
  });
  // clashes between rules
  const by = new Map();
  rules.forEach((r) => actPairs(r).forEach(([d, k]) => { if (!by.has(k)) by.set(k, new Set()); by.get(k).add(d); }));
  by.forEach((ds, k) => {
    if (ds.has('show') && ds.has('hide')) out.push({ ruleId: null, text: `${name(k)} has both Show and Hide rules. When both apply, Hide wins.` });
    if (ds.has('require') && ds.has('optional')) out.push({ ruleId: null, text: `${name(k)} has both Set required and Set not required rules. When both apply, Set required wins.` });
    if (ds.has('clear') && ds.has('require')) out.push({ ruleId: null, text: `${name(k)} can be cleared and set required. While it’s cleared it isn’t required.` });
  });
  return out;
}

/** "Status is Closed", "Job › Type is any of Repair, Install" */
export function condText(c, ctx) {
  const pf = c.src && c.src !== 'self' ? ctx.parentFields?.get(c.src) : null;
  const f = !c.src || c.src === 'self' ? (ctx.form?.fields || []).find((x) => x.id === c.field) : pf?.fields?.find((x) => x.id === c.field);
  if (!f) return 'a field that no longer exists';
  const o = opOf(f, c.op);
  const who = pf ? `${pf.name} › ${f.label}` : f.label;
  if (!o) return who + ' …';
  let v = '';
  if (o.value === 'many') v = list(c.value).join(', ');
  else if (o.value === 'record') v = ctx.recordTitle ? ctx.recordTitle(c.value) : String(c.value || '');
  else if (o.value) v = String(c.value ?? '');
  return `${who} ${o.label}${v ? ' ' + v : o.value ? ' …' : ''}`;
}
/** The whole rule as a sentence. */
export function ruleText(rule, ctx) {
  const tmap = new Map((ctx.targets || []).map((t) => [t.key, t]));
  const part = (c) => (c.group ? '(' + (c.conds || []).filter((x) => x.field).map((x) => condText(x, ctx)).join(c.join === 'any' ? ' or ' : ' and ') + ')' : condText(c, ctx));
  const when = (rule.conds || []).filter((c) => (c.group ? (c.conds || []).some((x) => x.field) : c.field)).map(part).join(rule.join === 'any' ? ' or ' : ' and ');
  const then = (rule.acts || []).filter((a) => (a.targets || []).length).map((a) => `${ACTION_LABEL[a.do].toLowerCase()} ${a.targets.map((k) => tmap.get(k)?.label || '?').join(', ')}`).join('; ');
  return `When ${when || '…'}: ${then || '…'}`;
}

/** Rules with what no longer exists (fields deleted from this form), or doesn't fit, removed. */
export function pruneRules(form, { targets, parentFields } = {}) {
  const tmap = new Map((targets || []).map((t) => [t.key, t]));
  const fids = new Set((form?.fields || []).map((f) => f.id));
  const okCond = (c) => !c.field || ((!c.src || c.src === 'self') ? fids.has(c.field) : !!parentFields?.get(c.src)?.fields?.some((f) => f.id === c.field));
  return (form?.rules || []).map((r) => ({
    ...r,
    conds: (r.conds || []).map((c) => (c.group ? { ...c, conds: (c.conds || []).filter(okCond) } : c)).filter((c) => (c.group ? c.conds.length : okCond(c))),
    acts: (r.acts || []).map((a) => ({ ...a, targets: (a.targets || []).filter((k) => actionFits(a.do, tmap.get(k))) })).filter((a) => a.targets.length),
  }));
}

/**
 * Saved records that a set of rules would change: [{ id, clear: [field ids] }], plus counts per
 * field. getFor(record) → get(src, fieldId) for that record (see evaluate).
 */
export function impactOf(form, records, getFor) {
  const rows = [], perField = new Map();
  records.forEach((r) => {
    const st = evaluate(form, getFor(r));
    const ids = toClear(form, r.values, st);
    if (!ids.length) return;
    rows.push({ id: r.id, clear: ids });
    ids.forEach((id) => perField.set(id, (perField.get(id) || 0) + 1));
  });
  return { rows, perField };
}

/** Whether two rule lists behave the same (ignoring ids of conditions and order of keys). */
export function sameRules(a, b) {
  const norm = (rs) => JSON.stringify((rs || []).map((r) => ({ off: !!r.off, join: r.join || 'all', conds: (r.conds || []).map((c) => (c.group ? { g: 1, join: c.join || 'all', conds: (c.conds || []).map(({ src, field, op, value }) => ({ src: src || 'self', field, op, value })) } : { src: c.src || 'self', field: c.field, op: c.op, value: c.value })), acts: r.acts || [] })));
  return norm(a) === norm(b);
}

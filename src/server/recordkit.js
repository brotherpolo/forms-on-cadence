// What the server needs to understand records the way the app does: field text, titles,
// calculations, rules and the PDF model. Pure (no DOM, no Firebase): it's bundled into the
// Cadence functions as fwkit.cjs (see scripts/build-fwkit.mjs) for automations, and unit-tested.
//
//   const kit = makeKit({ forms, records, locale, timeZone })
//   kit.recTitle(rec) · kit.text(form, rec, field) · kit.valOf(field, rec, form) · kit.fieldText(form, rec, label)
//   kit.rulesFor(form, rec) → rules.evaluate state · kit.look(form, rec)(cond) for automation conditions
//   kit.pdfModel(form, rec, { stamp }) → the model pdfdraw.js draws
import { FX } from '../formulas.js';
import { fieldItem } from '../pdfdoc.js';
import { evaluate, NO_RULES } from '../rules.js';
import { withStageField, stageName, STAGE_FIELD, stageView } from '../workflow.js';

const POPUP = new Set(['textarea', 'file', 'image', 'signature', 'location', 'multiselect']);
export const COLORS = ['#3346c8', '#0f7b6c', '#b4531a', '#8a3fb8', '#b42367', '#3d6b1f', '#56607a', '#0b6aa2'];
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.values(v).some((x) => x != null && x !== ''));
const lc = (s) => String(s || '').trim().toLowerCase();
export const itemName = (f) => (f?.itemName || '').trim() || (f?.name || 'Record').replace(/s$/i, '');

export function makeKit({ forms = [], records = [], locale = 'en-CA', timeZone = 'America/Toronto' } = {}) {
  const formMap = new Map(forms.map((f) => [f.id, f]));
  const recMap = new Map(records.map((r) => [r.id, r]));
  const kids = new Map();
  records.forEach((r) => { if (r.parentId) { if (!kids.has(r.parentId)) kids.set(r.parentId, []); kids.get(r.parentId).push(r); } });
  const formById = (id) => formMap.get(id);
  const recById = (id) => recMap.get(id);
  const childrenOf = (id, formId) => (kids.get(id) || []).filter((r) => !formId || r.formId === formId);

  const titleFieldOf = (form) => {
    const fs = form?.fields || [];
    return fs.find((f) => f.id === form.titleField) || fs.find((f) => ['text', 'email', 'phone', 'url'].includes(f.type)) || fs.find((f) => f.type !== 'heading');
  };
  const num = (v, o) => Number(v).toLocaleString(locale, o);
  function fmtCalc(f, v) {
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'number' || f.format === 'text') return String(v);
    const d = f.decimals ?? 2;
    try {
      switch (f.format) {
        case 'number': return num(v, { maximumFractionDigits: d });
        case 'currency': return new Intl.NumberFormat(locale, { style: 'currency', currency: (f.currency || 'CAD').toUpperCase() }).format(v);
        case 'percent': return num(v, { maximumFractionDigits: d }) + '%';
        case 'days': return num(v) + (Math.abs(v) === 1 ? ' day' : ' days');
        default: return num(v, { minimumFractionDigits: d, maximumFractionDigits: d });
      }
    } catch (e) { return String(v); }
  }
  function fmt(f, v) {
    if (f.type !== 'formula' && isEmpty(v)) return '';
    try {
      switch (f.type) {
        case 'formula': return fmtCalc(f, v);
        case 'checkbox': return v ? 'Yes' : 'No';
        case 'decimal': return num(v, { minimumFractionDigits: f.decimals ?? 2, maximumFractionDigits: f.decimals ?? 2 });
        case 'number': return num(v);
        case 'currency': return new Intl.NumberFormat(locale, { style: 'currency', currency: (f.currency || 'CAD').toUpperCase() }).format(v);
        case 'percent': return v + '%';
        case 'range': return v + (f.suffix || '');
        case 'rating': return `${v} of ${f.max || 5}`;
        case 'multiselect': return v.join(', ');
        case 'location': return v.address || (v.lat != null ? `${v.lat}, ${v.lng}` : '');
        case 'file': case 'image': return v.name || 'File';
        case 'signature': return 'Signed';
        case 'autonumber': return String(v);
        case 'relation': { const r = recById(v); return r ? recTitle(r) : '(removed)'; }
        case 'date': return new Date(v + 'T00:00:00Z').toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
        case 'datetime': return new Date(v).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
        default: return String(v);
      }
    } catch (e) { return String(v); }
  }
  const fieldByName = (form, name) => { const n = lc(name); return (form?.fields || []).find((f) => f.type !== 'heading' && (lc(f.label) === n || f.id === name)); };
  function rawFor(f, rec, form, depth) {
    if (f.type === 'formula') return evalFormula(form, f, rec, depth + 1);
    const v = f.type === 'autonumber' ? rec.nums?.[f.id] : rec.values?.[f.id];
    if (f.type === 'relation') { const r = v && recById(v); return r ? recTitle(r) : ''; }
    if (f.type === 'location') return v?.address || '';
    if (f.type === 'file' || f.type === 'image') return v?.name || '';
    return v ?? null;
  }
  function evalFormula(form, f, rec, depth = 0) {
    if (depth > 20) throw FX.E('loop');
    const ast = FX.parse(f.expr || '');
    return FX.ev(ast, {
      check: false,
      ref: (name) => { const g = fieldByName(form, name); if (!g || g.id === f.id) throw FX.E('bad field'); return rawFor(g, rec, form, depth); },
      family: (fn, a) => {
        if (fn === 'PARENT') { const p = rec.parentId && recById(rec.parentId); if (!p) return null; const pf = formById(p.formId); const pg = fieldByName(pf, a[0]); if (!pg) throw FX.E('bad parent field'); return rawFor(pg, p, pf, depth); }
        const cf = forms.find((x) => lc(x.name) === lc(a[0])); if (!cf) throw FX.E('bad form');
        const ks = rec.id ? childrenOf(rec.id, cf.id) : [];
        if (fn === 'CHILDCOUNT') return ks.length;
        const g = fieldByName(cf, a[1]); if (!g) throw FX.E('bad child field');
        const vals = ks.map((k) => FX.num(rawFor(g, k, cf, depth)));
        if (fn === 'CHILDSUM') return vals.reduce((s, x) => s + x, 0);
        if (fn === 'CHILDAVG') return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
        if (fn === 'CHILDMIN') return vals.length ? Math.min(...vals) : 0;
        return vals.length ? Math.max(...vals) : 0;
      },
    });
  }
  function valOf(f, rec, form) {
    if (f.id === STAGE_FIELD) return stageName(form || formById(rec.formId), rec);
    if (f.type === 'autonumber') return rec.nums?.[f.id] ?? null;
    if (f.type !== 'formula') return rec.values?.[f.id];
    form = form || formById(rec.formId);
    try { const v = evalFormula(form, f, rec); return typeof v === 'number' && !isFinite(v) ? null : v; } catch (e) { return null; }
  }
  function recTitle(rec, form) {
    form = form || formById(rec.formId); if (!form) return 'Untitled';
    const f = titleFieldOf(form); const t = f ? fmt(f, valOf(f, rec, form)) : '';
    return t || 'Untitled ' + itemName(form).toLowerCase();
  }
  const text = (form, rec, f) => (f.type === 'heading' ? '' : f.type === 'textarea' ? String(valOf(f, rec, form) ?? '') : fmt(f, valOf(f, rec, form)));
  /** {Field name} in templates: this record's field, or undefined when there's no such field. */
  const fieldText = (form, rec, label) => { const f = fieldByName(form, label); return f ? text(form, rec, f) : undefined; };

  /** The getter rules.js needs for one record (its parent comes from the data loaded). */
  function getter(form, rec, parent) {
    const byId = new Map((withStageField(form).fields || []).map((f) => [f.id, f]));
    const p = parent !== undefined ? parent : rec.parentId ? recById(rec.parentId) : null;
    return (src, fid) => {
      if (src === 'self') { const f = byId.get(fid); return f ? { f, v: valOf(f, rec, form) } : null; }
      if (!p || p.formId !== src) return null;
      const pf = formById(src); const f = withStageField(pf)?.fields?.find((x) => x.id === fid);
      return f ? { f, v: valOf(f, p, pf) } : null;
    };
  }
  const rulesFor = (form, rec) => (form?.rules?.length ? evaluate(withStageField(form), getter(form, rec)) : NO_RULES);
  /** For automation conditions: look(cond) → { f, v } like the rules use. */
  function look(form, rec) {
    const g = getter(form, rec);
    return (c) => {
      if (!c.src || c.src === 'self') { const f = (withStageField(form).fields || []).find((x) => x.id === c.field); return f ? { f, v: valOf(f, rec, form) } : null; }
      return g(c.src, c.field);
    };
  }

  /** The PDF model (as pdfdraw.js draws it), with the form's default columns. */
  function pdfModel(form, rec, { stamp = '', userName = (id) => '' } = {}) {
    const rs = rulesFor(form, rec), sv = stageView(form, rec.stage); // what the rules and the record's stage hide is left out
    const items = (form.fields || []).filter((f) => !rs.hiddenFields.has(f.id) && !rs.hidden.has('f:' + f.id) && !sv.hide.has(f.id) && !sv.keys.has('f:' + f.id)).map((f) => {
      const v = f.type === 'heading' || rs.cleared.has(f.id) ? null : valOf(f, rec, form);
      const it = fieldItem(f, v, f.type === 'heading' ? '' : f.type === 'rating' ? (isEmpty(v) ? '' : `${v} of ${f.max || 5}`) : text(form, { ...rec, values: { ...rec.values, [f.id]: v } }, f));
      return it;
    });
    const sections = [];
    const order = Array.isArray(form.sectionOrder) && form.sectionOrder.length ? form.sectionOrder : (form.children || []).map((c) => c.formId);
    const seen = new Set();
    [...order, ...(form.children || []).map((c) => c.formId)].forEach((k) => {
      if (seen.has(k)) return; seen.add(k);
      const rel = (form.children || []).find((c) => c.formId === k); const cf = rel && formById(k);
      if (!cf || cf.id === form.id) return;
      const isGrid = rel.display === 'grid';
      if (rs.hidden.has((isGrid ? 'g:' : 'c:') + cf.id) || sv.keys.has((isGrid ? 'g:' : 'c:') + cf.id)) return;
      const rows = childrenOf(rec.id, cf.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const usable = (cf.fields || []).filter((f) => f.type !== 'heading');
      const num = (f) => (['number', 'decimal', 'currency', 'percent', 'range'].includes(f.type) || f.type === 'formula');
      if (isGrid) {
        const picked = Array.isArray(rel.cols) && rel.cols.length ? rel.cols.map((id) => usable.find((f) => f.id === id)).filter(Boolean) : usable.filter((f) => !POPUP.has(f.type)).slice(0, 8);
        const cols = picked.length ? picked : usable.slice(0, 1);
        const totals = cols.map((f) => { if (!num(f) || f.type === 'rating') return null; let s = 0, n = 0; rows.forEach((r) => { const v = valOf(f, r, cf); if (typeof v === 'number' && isFinite(v)) { s += v; n++; } }); return n ? s : null; });
        sections.push({
          title: cf.name, count: rows.length, cols: cols.map((f) => ({ label: f.label, num: num(f) })),
          rows: rows.map((r) => { const st = rulesFor(cf, r); return cols.map((f) => (st.blank.has(f.id) ? '' : text(cf, r, f))); }),
          total: rows.length > 1 && totals.some((t) => t != null) ? cols.map((f, i) => (totals[i] == null ? (i === 0 ? 'Total' : '') : fmt(f, totals[i]))) : null,
          empty: `No ${cf.name.toLowerCase()}.`,
        });
      } else {
        const tf = titleFieldOf(cf);
        const cols = usable.filter((f) => f.inList && f.id !== tf?.id && !POPUP.has(f.type)).slice(0, 4);
        sections.push({
          title: cf.name, count: rows.length, cols: [{ label: tf?.label || itemName(cf) }, ...cols.map((f) => ({ label: f.label, num: num(f) }))],
          rows: rows.map((r) => [recTitle(r, cf), ...cols.map((f) => text(cf, r, f))]), total: null,
          empty: `No ${cf.name.toLowerCase()} for this ${itemName(form).toLowerCase()}.`,
        });
      }
    });
    const parent = rec.parentId ? recById(rec.parentId) : null, pform = parent ? formById(parent.formId) : null;
    const day = (t) => new Date(t).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone });
    const meta = [rec.createdAt ? `Created ${day(rec.createdAt)}${userName(rec.createdBy || rec.ownerId) ? ' by ' + userName(rec.createdBy || rec.ownerId) : ''}` : '',
      rec.updatedAt && rec.updatedAt !== rec.createdAt ? `Last updated ${day(rec.updatedAt)}` : '', userName(rec.ownerId) ? `Owner ${userName(rec.ownerId)}` : ''].filter(Boolean);
    return { accent: COLORS[(form.color ?? 0) % COLORS.length], formName: form.name, title: recTitle(rec, form), meta, parent: parent && pform ? `${pform.name}: ${recTitle(parent, pform)}` : null, items, sections, stamp };
  }

  return { formById, recById, childrenOf, titleFieldOf, fmt, fmtCalc, valOf, recTitle, text, fieldText, getter, rulesFor, look, pdfModel };
}

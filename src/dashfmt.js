// Numbers and cells in reports and dashboards, written out the same way on screen (dash.js) and in
// scheduled dashboard emails (dashmail.js, sent by the server). Pure functions: no DOM.
import { fieldOf, valueOf, textOf, kindOf } from './reportlogic.js';
import { nounOf } from './dashlogic.js';

export function measureField(c, def) { const m = def.measure || { fn: 'count' }; return m.fn !== 'count' && m.ref ? fieldOf(c, m.ref) : null; }
export function fmtMeasure(c, def, v) {
  if (v == null || (typeof v === 'number' && isNaN(v))) return '–';
  const f = measureField(c, def);
  if (!f) return Math.round(v).toLocaleString();
  if (f.type === 'rating') return (Math.round(v * 10) / 10).toLocaleString() + ' ★';
  const val = def.measure.fn === 'avg' ? Math.round(v * 100) / 100 : v;
  if (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(f.currency || 'CAD').toUpperCase(), maximumFractionDigits: Math.abs(val) >= 100 ? 0 : 2 }).format(val); } catch (e) { return String(val); }
  }
  if (f.type === 'percent' || (f.type === 'formula' && f.format === 'percent')) return (Math.round(val * 10) / 10).toLocaleString() + '%';
  if (f.type === 'range') return (Math.round(val * 10) / 10) + (f.suffix || '');
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: def.measure.fn === 'avg' ? 2 : 1 });
}
export function fmtShort(c, def, v) {
  const f = measureField(c, def);
  const cur = f && (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) ? '$' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return cur + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return cur + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return cur + (Math.round(v * 10) / 10).toLocaleString();
}
export function measureLabel(c, def) {
  const m = def.measure || { fn: 'count' };
  const form = c.formById(def.form);
  if (m.fn === 'count' || !m.ref) return 'Number of ' + (form ? nounOf(form, 2) : 'records');
  const f = fieldOf(c, m.ref);
  return (m.fn === 'avg' ? 'Average ' : 'Total ') + (f ? f.label.toLowerCase() : 'value');
}
export function cellText(c, ref, rec) {
  const f = fieldOf(c, ref); if (!f) return '';
  const v = valueOf(c, rec, ref);
  if (f.type === 'relation') { const t = v && c.recById(v); return t ? c.recTitle(t) : ''; }
  return textOf(c, f, v);
}
export const isNumRef = (c, r) => { const f = fieldOf(c, r); return !!f && kindOf(f) === 'num'; };


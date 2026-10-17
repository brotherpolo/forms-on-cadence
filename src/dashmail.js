// Scheduled dashboard emails: when one is due, and the email itself. Built on the server (Cadence's
// functions, dashMailer) from the same numbers the dashboard shows. Email programs don't run scripts
// or draw charts, so charts become small tables with bars made of coloured cells. Pure: no DOM.
import { fieldOf, bucketsOf, measureOf, refLabel } from './reportlogic.js';
import { PERIODS, periodRange, rowsFor, kpiOf, slicesOf, groupRows, pivotOf, sortRecs, normalizeDef, readingOrder, canvasTiles, groupLabel } from './dashlogic.js';
import { fmtMeasure, measureLabel, cellText, isNumRef } from './dashfmt.js';

export const FREQS = [['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['daily', 'Every day']];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourText = (h) => { const n = ((+h % 24) + 24) % 24; return `${n % 12 || 12}:00 ${n < 12 ? 'AM' : 'PM'}`; };
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

/** "Every Monday at 8:00 AM" */
export function scheduleText(s) {
  if (!s) return '';
  const at = ' at ' + hourText(s.hour ?? 8);
  if (s.freq === 'weekly') return 'Every ' + DAYS[(+s.day || 0) % 7] + at;
  if (s.freq === 'monthly') return 'On the ' + ord(Math.min(28, Math.max(1, +s.day || 1))) + ' of every month' + at;
  if (s.freq === 'daily') return 'Every day' + at;
  return 'Every weekday' + at;
}

/** The parts of a moment in a time zone: { key: 'YYYY-MM-DD', hour, dow (0 = Sunday), dom }. */
export function partsIn(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), dom: +p.day };
}

/** Is a schedule due in this hour? → the slot ('2026-10-19T08') or ''. Each slot is sent once (lastSlot). */
export function dueSlot(s, parts) {
  if (!s || !s.on || parts.hour !== (+s.hour || 0)) return '';
  const ok = s.freq === 'daily' ? true
    : s.freq === 'weekly' ? parts.dow === (+s.day || 0) % 7
    : s.freq === 'monthly' ? parts.dom === Math.min(28, Math.max(1, +s.day || 1))
    : parts.dow >= 1 && parts.dow <= 5;
  const slot = `${parts.key}T${String(parts.hour).padStart(2, '0')}`;
  return ok && s.lastSlot !== slot ? slot : '';
}

/** Everyone a schedule goes to: people, everyone in the roles, and other addresses (lowercase, once each, at most 50). */
export function recipients(s, people, roleHolders = () => []) {
  const to = s && s.to ? s.to : {};
  const list = [];
  (to.people || []).forEach((u) => list.push(people.get(u)?.email || ''));
  (to.roles || []).forEach((r) => roleHolders(r).forEach((u) => list.push(people.get(u)?.email || '')));
  String(to.addresses || '').split(/[,;\s]+/).forEach((a) => list.push(a));
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 50);
}

/* ---------- the email ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INK = '#141826', MUTED = '#5a6174', LINE = '#e3e5ec', BAR = '#3346c8', SOFT = '#f3f4f7';
const COLORS = ['#3346c8', '#0f7b6c', '#c2410c', '#8a55d6', '#d23f6e', '#0e8fa8', '#a16207', '#5a6174'];
const td = (s, x = '') => `<td style="padding:6px 8px;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};${x}">${s}</td>`;
const th = (s, x = '') => `<th style="padding:6px 8px;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};text-align:left;font-weight:600;${x}">${s}</th>`;
const table = (rows, head = '') => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${head}${rows}</table>`;
const barCell = (v, max, color = BAR) => { const w = Math.max(1, Math.round((max > 0 ? Math.max(0, v) / max : 0) * 100)); return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><td style="width:${w}%;height:10px;background:${color};border-radius:3px;font-size:0;line-height:0">&nbsp;</td>${w < 100 ? `<td style="width:${100 - w}%;font-size:0;line-height:0">&nbsp;</td>` : ''}</tr></table>`; };
const more = (n, what) => (n > 0 ? `<p style="margin:6px 0 0;font-size:12px;color:${MUTED}">and ${n} more ${what}</p>` : '');

function periodLabel(iv, d) {
  if (iv === 'week') return 'Week of ' + d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  if (iv === 'month') return d.toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
  if (iv === 'quarter') return 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();
  return String(d.getFullYear());
}

/** One report as email HTML (and a line of plain text). */
export function reportBlock(c, def, extra, now) {
  const form = c.formById(def.form);
  if (!form) return { html: `<p style="color:${MUTED};font-size:13px">This report’s form isn’t available.</p>`, text: '(form not available)' };
  if (def.type === 'kpi') {
    const k = kpiOf(c, def, extra, now);
    const v = fmtMeasure(c, def, k.value);
    const cmp = def.compare && k.delta != null ? `${k.delta >= 0 ? '▲ +' : '▼ '}${Math.round(k.delta)}% vs ${esc(k.prevLabel)} (${esc(fmtMeasure(c, def, k.prev))})` : '';
    return { html: `<div style="font-size:30px;font-weight:700;color:${INK};line-height:1.15">${esc(v)}</div><div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(measureLabel(c, def))}${cmp ? ' · ' + cmp : ''}</div>`, text: `${measureLabel(c, def)}: ${v}${cmp ? ' (' + cmp.replace(/<[^>]+>/g, '') + ')' : ''}` };
  }
  const list = rowsFor(c, def, extra);
  if (!list.length) return { html: `<p style="color:${MUTED};font-size:13px;margin:0">No records match this report.</p>`, text: 'No records match.' };
  if (def.type === 'bar' || def.type === 'donut') {
    const items = slicesOf(c, def, list).filter((x) => def.type === 'bar' || x.value > 0);
    const shown = items.slice(0, 15);
    const max = Math.max(0, ...shown.map((x) => x.value)) || 1, total = items.reduce((a, b) => a + b.value, 0) || 1;
    const rows = shown.map((x, i) => `<tr>${td(esc(x.key), 'width:34%')}${td(barCell(x.value, def.type === 'donut' ? total : max, def.type === 'donut' ? COLORS[i % COLORS.length] : BAR), 'width:44%')}${td(esc(fmtMeasure(c, def, x.value)) + (def.type === 'donut' ? ` <span style="color:${MUTED}">${Math.round((x.value / total) * 100)}%</span>` : ''), 'text-align:right;white-space:nowrap')}</tr>`).join('');
    return { html: table(rows) + more(items.length - shown.length, 'groups'), text: shown.map((x) => `${x.key}: ${fmtMeasure(c, def, x.value)}`).join('; ') };
  }
  if (def.type === 'line' || def.type === 'area') {
    if (!fieldOf(c, def.time)) return { html: '', text: '' };
    const iv = def.interval || 'month';
    const b = bucketsOf(c, def, list, now, extra.range).slice(-12);
    const max = Math.max(0, ...b.map((x) => x.value)) || 1;
    const rows = b.map((x) => `<tr>${td(esc(periodLabel(iv, x.date)), 'width:34%;white-space:nowrap')}${td(barCell(x.value, max), 'width:44%')}${td(esc(fmtMeasure(c, def, x.value)), 'text-align:right;white-space:nowrap')}</tr>`).join('');
    return { html: table(rows), text: b.map((x) => `${periodLabel(iv, x.date)}: ${fmtMeasure(c, def, x.value)}`).join('; ') };
  }
  if (def.type === 'pivot') {
    const p = pivotOf(c, def, list);
    if (!p) return { html: '', text: '' };
    const cols = p.cols.slice(0, 8), rows = p.rows.slice(0, 20);
    const head = `<tr>${th(esc(groupLabel(c, def.group) || ''))}${cols.map((k) => th(esc(k), 'text-align:right')).join('')}${th('Total', 'text-align:right')}</tr>`;
    const body = rows.map((r) => `<tr>${td(esc(r.key))}${r.cells.slice(0, 8).map((v) => td(v == null ? '–' : esc(fmtMeasure(c, def, v)), 'text-align:right')).join('')}${td('<b>' + esc(fmtMeasure(c, def, r.total)) + '</b>', 'text-align:right')}</tr>`).join('');
    const tot = `<tr>${td('<b>Total</b>', `background:${SOFT}`)}${p.colTotals.slice(0, 8).map((v) => td('<b>' + esc(fmtMeasure(c, def, v)) + '</b>', `text-align:right;background:${SOFT}`)).join('')}${td('<b>' + esc(fmtMeasure(c, def, p.grand)) + '</b>', `text-align:right;background:${SOFT}`)}</tr>`;
    return { html: table(body + tot, head) + more(p.rows.length - rows.length + p.moreRows, 'rows'), text: `${p.rows.length} rows, total ${fmtMeasure(c, def, p.grand)}` };
  }
  if (def.type === 'grouped') {
    const groups = groupRows(c, def, def.group, list);
    const shown = groups.slice(0, 20);
    const rows = shown.map((g) => `<tr>${td(esc(g.key))}${td(String(g.rows.length), `text-align:right;color:${MUTED}`)}${td(esc(fmtMeasure(c, def, g.value)), 'text-align:right')}</tr>`).join('');
    const head = `<tr>${th(esc(groupLabel(c, def.group) || 'Group'))}${th('Records', 'text-align:right')}${th(esc(measureLabel(c, def)), 'text-align:right')}</tr>`;
    const tot = `<tr>${td('<b>Total</b>', `background:${SOFT}`)}${td('<b>' + list.length + '</b>', `text-align:right;background:${SOFT}`)}${td('<b>' + esc(fmtMeasure(c, def, measureOf(c, def, list))) + '</b>', `text-align:right;background:${SOFT}`)}</tr>`;
    return { html: table(rows + tot, head) + more(groups.length - shown.length, 'groups'), text: shown.map((g) => `${g.key}: ${fmtMeasure(c, def, g.value)}`).join('; ') };
  }
  // table
  const cols = (def.columns || []).filter((r) => fieldOf(c, r)).slice(0, 6);
  if (!cols.length) return { html: '', text: '' };
  const sref = (def.sort && cols[def.sort.i]) || cols[0];
  const sorted = sortRecs(c, list, sref, def.sort?.dir || 1);
  const shown = sorted.slice(0, 15);
  const head = `<tr>${cols.map((r) => th(esc(refLabel(c, r, def.form)), isNumRef(c, r) ? 'text-align:right' : '')).join('')}</tr>`;
  const body = shown.map((rec) => `<tr>${cols.map((r) => td(esc(cellText(c, r, rec) || '–'), isNumRef(c, r) ? 'text-align:right;white-space:nowrap' : '')).join('')}</tr>`).join('');
  return { html: table(body, head) + more(sorted.length - shown.length, 'records'), text: `${sorted.length} records` };
}

/**
 * The whole email for a dashboard: { subject, html, text }.
 * dash: the dashboard; reports: id → saved report; opts: { now, link, schedule, company }.
 * Numbers use the dashboard's saved period; its field filters show everything (no one has picked a value).
 */
export function dashEmail(c, dash, reports, { now = Date.now(), link = '', schedule = null, company = '' } = {}) {
  const periodKey = dash.filters?.period || 'all';
  const range = periodRange(periodKey, now);
  const extra = { periodKey, range: range ? { from: range.from, to: range.to } : null, fields: [] };
  const date = new Date(now).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const periodName = (PERIODS.find((p) => p[0] === periodKey) || PERIODS[0])[1];
  const parts = [], text = [`${dash.name || 'Dashboard'} · ${periodName} · ${date}`, ''];
  readingOrder(canvasTiles(dash.tiles || []).filter((t) => t.report || t.text)).forEach((t) => {
    if (t.text) {
      parts.push(`<tr><td style="padding:14px 0 6px">${t.text.title ? `<div style="font-size:15px;font-weight:700;color:${INK}">${esc(t.text.title)}</div>` : ''}${String(t.text.body || '').split(/\n{2,}/).filter(Boolean).map((p) => `<p style="margin:6px 0 0;font-size:13px;color:${INK}">${esc(p)}</p>`).join('')}</td></tr>`);
      if (t.text.title || t.text.body) text.push([t.text.title, t.text.body].filter(Boolean).join(': '));
      return;
    }
    const r = reports.get(t.report);
    if (!r || !r.def) return;
    const def = normalizeDef(c, r.def);
    const b = reportBlock(c, def, extra, now);
    parts.push(`<tr><td style="padding:14px 16px;border:1px solid ${LINE};border-radius:10px;background:#ffffff"><div style="font-size:15px;font-weight:700;color:${INK};margin-bottom:8px">${esc(r.name || 'Report')}</div>${b.html}</td></tr><tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>`);
    text.push(`${r.name || 'Report'}: ${b.text}`);
  });
  if (!parts.length) parts.push(`<tr><td style="font-size:13px;color:${MUTED}">This dashboard has no reports yet.</td></tr>`);
  const foot = `${schedule ? esc(scheduleText(schedule)) + '. ' : ''}Sent by Formwright${company ? ' for ' + esc(String(company).replace(/\.$/, '')) : ''}. An administrator can change who gets this on the dashboard (Email schedule).`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${SOFT}"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${SOFT}"><tr><td align="center" style="padding:20px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <tr><td style="padding:0 0 14px"><div style="font-size:22px;font-weight:700;color:${INK}">${esc(dash.name || 'Dashboard')}</div><div style="font-size:13px;color:${MUTED};margin-top:2px">${esc(periodName)} · ${esc(date)}${link ? ` · <a href="${esc(link)}" style="color:${BAR}">Open the dashboard</a>` : ''}</div></td></tr>
      ${parts.join('')}
      <tr><td style="padding:10px 0 0;font-size:12px;color:${MUTED}">${foot}</td></tr>
    </table></td></tr></table></body></html>`;
  if (link) text.push('', 'Open the dashboard: ' + link);
  return { subject: `${dash.name || 'Dashboard'} · ${new Date(now).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`.slice(0, 200), html, text: text.join('\n') };
}

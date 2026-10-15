// Importing records from a spreadsheet (admins only): the templates menu on a form's list,
// the import screen (choose file → match columns → check rows → import) and Import history
// with undo. The checking lives in importlogic.js; reading and writing files in xlsx.js.
import './imports.css';
import { store, runImport, importBefore, undoImport } from './store.js';
import { isAdmin } from './access.js';
import { $, esc, uid, toast, itemName, badge } from './ui.js';
import {
  MAX_ROWS, UNDO_DAYS, templateColumns, guideRows, skippedFields, makeLookup, matchColumns, checkRows, summarize, splitSheet,
  templateSheets, pickSheet, undoPlan, undoOpen, parentFormsOf, cellText, norm, parseDate, parseDateTime, parseTime,
} from './importlogic.js';
import { writeXlsx, readSheets, sheetName } from './xlsx.js';

let H = { ruleClears: null, fmt: null, recTitle: null, formById: null, go: null, renderMain: null, computeFormulas: null };
export function initImports(helpers) { H = { ...H, ...helpers }; }

const PAGE = 100;
const fresh = (formId) => ({
  formId, step: 'file', fileName: '', sheets: [], sheetIdx: 0, headers: [], data: [], rowNums: [], map: [], how: [], mine: new Set(),
  results: null, overrides: new Map(), filter: 'all', shown: PAGE, skip: true, err: '', reading: false,
  progress: { done: 0, total: 0 }, done: null, focusFix: false,
});
let IM = fresh(null);
let menuFor = null; // form whose Import menu is open
let ask = null; // { imp, plan, lines, busy } — the undo confirmation
let asking = null; // import ID whose undo is being worked out

const me = () => store.user?.uid;
const formOf = (id) => H.formById(id);
const lower = (s) => String(s || '').toLowerCase();
const plural = (n, form) => `${n.toLocaleString()} ${n === 1 ? lower(itemName(form)) : lower(form.name)}`;
const when = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const whenTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const ICON = {
  imp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg>',
  up: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"></path></svg>',
  ok: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>',
};

/** Everything the checks need to know about the data that's loaded. */
function ctxFor(form) {
  const titleOf = (r) => H.recTitle(r);
  return {
    lookup: makeLookup(store.records, titleOf), titleOf, formById: H.formById, itemName, records: store.records,
    parents: parentFormsOf(form, store.forms),
    compute: (f, rec) => H.computeFormulas(f, rec),
    show: (f, v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '' : H.fmt(f, v)),
  };
}

/* ---------- downloads ---------- */

function save(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[\\/:*?"<>|]+/g, ' ');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function downloadTemplate(formId, mode) {
  const form = formOf(formId);
  if (!form) return;
  try {
    const ctx = ctxFor(form);
    const cols = templateColumns(form, ctx.parents, itemName);
    const taken = new Set();
    const names = { main: sheetName(form.name, taken), guide: sheetName('Guide', taken), lists: sheetName('Lists', taken) };
    const bytes = await writeXlsx(templateSheets(form, cols, ctx, mode, names));
    const day = new Date().toISOString().slice(0, 10);
    save(bytes, mode === 'data' ? `${form.name} export ${day}.xlsx` : `${form.name} template.xlsx`);
    toast(mode === 'data' ? `Downloaded ${plural(store.records.filter((r) => r.formId === form.id).length, form)} with their Record IDs` : `Downloaded the ${form.name} template`);
  } catch (e) {
    console.error(e);
    toast('The template couldn’t be made. Try again.');
  }
}

/* ---------- the menu on a form's list ---------- */

/** The "Import and templates" button for a form's list (admins only). */
export function importButton(form) {
  if (!isAdmin(store.me)) return '';
  const open = menuFor === form.id;
  const kids = (form.children || []).map((c) => formOf(c.formId)).filter((cf) => cf && cf.id !== form.id);
  const n = store.records.filter((r) => r.formId === form.id).length;
  const item = (act, id, title, sub, extra = '') => `<button type="button" class="im-mi" role="menuitem" data-im="${act}" data-id="${esc(id)}"${extra}><b>${esc(title)}</b><small>${esc(sub)}</small></button>`;
  const menu = open ? `<div class="im-menu" role="menu" aria-label="Import and templates">
      <div class="im-mlab">Templates (Excel)</div>
      ${item('tpl', form.id, 'Blank template', 'One column per field, dropdowns for choices', ' data-v="blank"')}
      ${n ? item('tpl', form.id, 'Export with data, to update', `All ${plural(n, form)}, with Record IDs`, ' data-v="data"') : ''}
      ${kids.map((cf) => item('tpl', cf.id, `${cf.name} template`, `Sub-form rows, each naming its ${lower(itemName(form))}`, ' data-v="blank"')).join('')}
      <div class="im-msep"></div>
      ${item('go', form.id, 'Import a filled-in file…', `.xlsx or .csv, up to ${MAX_ROWS.toLocaleString()} rows`)}
      ${kids.map((cf) => item('go', cf.id, `Import ${lower(cf.name)}…`, `Rows that belong to ${lower(form.name)}`)).join('')}
      <button type="button" class="im-mi" role="menuitem" data-im="history"><b>Import history</b><small>Undo an import for ${UNDO_DAYS} days</small></button>
    </div>` : '';
  return `<div class="im-anchor"><button type="button" class="btn${open ? ' on' : ''}" data-im="menu" data-id="${esc(form.id)}" aria-expanded="${open}" aria-haspopup="menu">${ICON.imp}Import and templates</button>${menu}</div>`;
}

/* ---------- the import screen ---------- */

export const importTitle = () => { const f = formOf(IM.formId); return f ? 'Import ' + lower(f.name) : 'Import'; };
/** True while rows are being saved: leaving would cut the import short. */
export const importRunning = () => IM.step === 'run';
/** Don't redraw under someone typing a fix, or while saving (progress is drawn directly). */
export function importBusy() {
  if (IM.step === 'run') return true;
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('#im') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'file' && a.type !== 'checkbox');
}

/** Start an import for a form (from the menu). */
export function openImport(formId) {
  if (IM.formId !== formId || IM.step === 'done') IM = fresh(formId);
  menuFor = null;
  H.go({ name: 'import', formId });
}

const STEPS = [['file', 'Choose file'], ['map', 'Match columns'], ['check', 'Check rows'], ['run', 'Import']];

export function viewImport(form) {
  if (!form) return '<div class="panel empty"><p>This form no longer exists.</p></div>';
  if (!isAdmin(store.me)) return '<div class="panel empty"><p>Only admins can import.</p></div>';
  if (IM.formId !== form.id) IM = fresh(form.id);
  const at = IM.step === 'done' ? 4 : STEPS.findIndex((s) => s[0] === IM.step);
  const steps = STEPS.map(([k, label], i) => `<li class="im-st${i === at ? ' on' : i < at ? ' done' : ''}"${i === at ? ' aria-current="step"' : ''}><i>${i < at ? '✓' : i + 1}</i>${label}</li>`).join('');
  let body = '';
  if (IM.step === 'file') body = stepFile(form);
  else if (IM.step === 'map') body = stepMap(form);
  else if (IM.step === 'check') body = stepCheck(form);
  else if (IM.step === 'run') body = stepRun(form);
  else body = stepDone(form);
  return `<div class="im" id="im">
    <div class="crumbs"><button type="button" class="im-link" data-im="list" data-id="${esc(form.id)}">${esc(form.name)}</button> › Import</div>
    <div class="head"><div class="ttl">${badge(form, 1)}<div><h1>Import ${esc(lower(form.name))}</h1></div></div><span class="chip">Admins only</span></div>
    <ol class="im-steps" aria-label="Import steps">${steps}</ol>
    ${body}
    ${ask ? undoDialog() : ''}
  </div>`;
}

function stepFile(form) {
  const ctx = ctxFor(form);
  const cols = templateColumns(form, ctx.parents, itemName);
  const guide = guideRows(form, cols, ctx);
  const skipped = skippedFields(form);
  return `<section class="panel im-pad">
    <div class="im-drop" id="im-drop">
      <span class="im-upic">${ICON.up}</span>
      <h2>${IM.reading ? 'Reading the file…' : 'Drop your filled-in file here'}</h2>
      <p class="help">Excel (.xlsx) or CSV, up to ${MAX_ROWS.toLocaleString()} rows. Nothing is saved until the last step.</p>
      <label class="btn primary im-pick"><input type="file" id="im-file" accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"${IM.reading ? ' disabled' : ''}>Choose file</label>
      <button type="button" class="im-link" data-im="tpl" data-v="blank" data-id="${esc(form.id)}">Download the blank template</button>
      ${IM.err ? `<p class="im-err" role="alert">${esc(IM.err)}</p>` : ''}
    </div>
    <details class="im-guide"><summary>What goes in each column</summary>
      <div class="im-wrap"><table class="tbl"><thead><tr><th>Column</th><th>Type</th><th>What to enter</th></tr></thead><tbody>
      ${guide.map((g) => `<tr><td><b>${esc(g.col)}</b>${g.required ? ' <span class="im-req">Required</span>' : ''}</td><td>${esc(g.type)}</td><td>${esc(g.what)}</td></tr>`).join('')}
      </tbody></table></div>
      ${skipped.length ? `<p class="help">Not imported: ${skipped.map((s) => `${esc(s.label)} (${esc(s.why)})`).join(', ')}.</p>` : ''}
    </details>
  </section>`;
}

/** The first few values in a column, with Excel's day numbers shown as dates when they go into a date field. */
function samples(ci, field) {
  const out = [];
  const asDate = field && { date: parseDate, datetime: parseDateTime, time: parseTime }[field.type];
  for (const r of IM.data) {
    const v = r[ci];
    let t = asDate && typeof v === 'number' ? asDate(v) || cellText(v) : cellText(v);
    if (asDate && field.type === 'datetime') t = t.replace('T', ' ');
    if (t) out.push(t.length > 30 ? t.slice(0, 30) + '…' : t);
    if (out.length === 3) break;
  }
  return out.join(', ');
}

function colsOf(form) { return templateColumns(form, parentFormsOf(form, store.forms), itemName); }

function stepMap(form) {
  const cols = colsOf(form);
  const skipped = skippedFields(form);
  const visible = IM.sheets.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  const rows = IM.headers.map((h, ci) => {
    const key = IM.map[ci] || '';
    const skip = !key && skipped.find((s) => norm(s.label) === norm(h));
    const [tag, cls] = key ? (IM.mine.has(ci) ? ['Matched by you', 'ok'] : IM.how[ci] === 'close' ? ['Close match', 'warn'] : ['Matched', 'ok'])
      : skip ? [skip.why === 'calculated' ? 'Calculated, not imported' : `Can’t import a ${skip.why}`, 'off'] : ['Not imported', 'off'];
    return `<tr><td><b>${esc(h || `(column ${ci + 1})`)}</b></td><td class="im-mono">${esc(samples(ci, cols.find((c) => c.key === key)?.field))}</td>
      <td><select class="in" data-imc="map" data-ci="${ci}" aria-label="Field for ${esc(h || 'column ' + (ci + 1))}">
        <option value="">Don’t import</option>
        ${cols.map((c) => `<option value="${esc(c.key)}"${c.key === key ? ' selected' : ''}>${esc(c.kind === 'id' ? 'Record ID (update existing)' : c.name)}</option>`).join('')}
      </select></td><td><span class="im-tag ${cls}">${esc(tag)}</span></td></tr>`;
  }).join('');
  const mapped = new Set(IM.map.filter(Boolean));
  const missing = cols.filter((c) => c.required && !mapped.has(c.key));
  const notes = [];
  if (!mapped.size) notes.push(`<span class="im-tag bad">No columns are matched yet</span>`);
  missing.forEach((c) => notes.push(`<span class="im-tag warn">${esc(c.name)} (required) isn’t matched: new ${esc(lower(form.name))} will need it</span>`));
  if (mapped.size && !missing.length) notes.push(`<span class="im-tag ok">Every required field is matched</span>`);
  if (!mapped.has('id')) notes.push(`<span class="im-tag off">No Record ID column: every row will be a new ${esc(lower(itemName(form)))}</span>`);
  return `<section class="panel">
    <div class="im-fileline"><b class="im-mono">${esc(IM.fileName)}</b><span class="help">${IM.data.length.toLocaleString()} row${IM.data.length === 1 ? '' : 's'}</span>
      ${visible.length > 1 ? `<label class="help" for="im-sheet">Sheet</label><select class="in im-auto" id="im-sheet" data-imc="sheet">${visible.map((x) => `<option value="${x.i}"${x.i === IM.sheetIdx ? ' selected' : ''}>${esc(x.s.name)}</option>`).join('')}</select>` : ''}
      <span class="grow"></span><button type="button" class="btn sm" data-im="restart">Choose a different file</button></div>
    <div class="im-sub"><h2>Match your columns to fields</h2><p class="help">Matched by name. Change any that are wrong. Fields not in your file stay as they are on updates and blank on new ${esc(lower(form.name))}.</p></div>
    <div class="im-wrap"><table class="tbl im-maptbl"><thead><tr><th>Column in your file</th><th>First values</th><th>Goes into field</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="im-foot"><div class="im-notes">${notes.join('')}</div>
      <div class="im-acts im-right"><button type="button" class="btn" data-im="restart">Back</button>
      <button type="button" class="btn primary" data-im="check"${mapped.size ? '' : ' disabled'}>Check rows</button></div></div>
  </section>`;
}

function recheck(form) {
  const ctx = ctxFor(form);
  IM.results = checkRows({ form, cols: colsOf(form), map: IM.map, rows: IM.data, rowNums: IM.rowNums, overrides: IM.overrides, ctx });
  IM.ctx = ctx;
}

const ACTION = { new: ['New', 'new'], update: ['Update', 'warn'], same: ['No change', 'off'], problem: ['Problem', 'bad'] };

function cellDisplay(r, key, ci, form, cols) {
  const bad = r.problems.some((p) => p.ci === ci);
  const ov = IM.overrides.get(r.i);
  const raw = ov && ov.cells && ci in ov.cells ? ov.cells[ci] : IM.data[r.i][ci];
  if (bad || !key) return { t: cellText(raw), cls: bad ? 'bad' : 'skip' };
  if (key === 'id') return { t: r.id || (ov?.asNew ? '' : cellText(raw)), cls: '' };
  const col = cols.find((c) => c.key === key);
  if (key === 'parent') { const p = r.parentId && IM.ctx.lookup.byId.get(r.parentId); return { t: p ? IM.ctx.titleOf(p) : '', cls: r.changes.some((c) => c.label === col.label) ? 'chg' : '' }; }
  if (!col) return { t: cellText(raw), cls: '' };
  return { t: IM.ctx.show(col.field, r.values[col.field.id]), cls: r.changes.some((c) => c.label === col.name) ? 'chg' : '' };
}

function fixControl(r, p, form) {
  const f = p.fix;
  if (!f) return '';
  const a = `data-row="${r.i}" data-ci="${p.ci}"`;
  const lab = `aria-label="Fix row ${r.n}"`;
  switch (f.type) {
    case 'asnew': return `<button type="button" class="btn sm" data-im="asnew" data-row="${r.i}">Add as a new ${esc(lower(itemName(form)))} instead</button>`;
    case 'choice': return `<select class="in im-auto" data-imfix="set" ${a} ${lab}><option value="">Pick…</option>${f.options.map((o) => `<option value="${esc(o.v)}">${esc(o.label)}</option>`).join('')}${f.blank ? '<option value="__blank">Leave it blank</option>' : ''}</select>`;
    case 'date': return `<input class="in im-auto" type="date" data-imfix="set" ${a} ${lab}>`;
    case 'time': return `<input class="in im-auto" type="time" data-imfix="set" ${a} ${lab}>`;
    case 'datetime': return `<input class="in im-auto" type="datetime-local" data-imfix="set" ${a} ${lab}>`;
    default: {
      const ov = IM.overrides.get(r.i);
      const raw = ov && ov.cells && p.ci in ov.cells ? ov.cells[p.ci] : IM.data[r.i][p.ci];
      return `<input class="in im-auto im-txt" type="text" data-imfix="set" ${a} ${lab} value="${esc(cellText(raw))}" placeholder="${esc(f.hint || 'Type a new value')}"><span class="help">Press Enter to check it</span>`;
    }
  }
}

function stepCheck(form) {
  if (store.recordsLoading.size) return '<div class="panel empty"><p>Loading records to check against…</p></div>';
  if (!IM.results) recheck(form);
  const cols = colsOf(form);
  const s = summarize(IM.results);
  const shownCols = IM.map.map((k, ci) => ({ k, ci })).filter((x) => x.k);
  const list = IM.filter === 'all' ? IM.results : IM.results.filter((r) => r.action === IM.filter);
  const page = list.slice(0, IM.shown);
  const filters = [['all', `All (${s.rows.toLocaleString()})`], ['problem', `Problems (${s.problem})`], ['new', `New (${s.new})`], ['update', `Updates (${s.update})`]];
  if (s.same) filters.push(['same', `No change (${s.same})`]);
  const head = `<tr><th>Row</th><th>Action</th>${shownCols.map((x) => `<th>${esc(IM.headers[x.ci] || '')}</th>`).join('')}</tr>`;
  const span = shownCols.length + 2;
  const body = page.map((r) => {
    const [label, cls] = ACTION[r.action];
    let html = `<tr class="im-r ${r.action}"><td class="im-mono">${r.n}</td><td><span class="im-tag ${cls}">${label}</span></td>${shownCols.map((x) => { const d = cellDisplay(r, x.k, x.ci, form, cols); return `<td class="${d.cls}" title="${esc(d.t)}">${esc(d.t)}</td>`; }).join('')}</tr>`;
    if (r.problems.length) html += `<tr class="im-fixrow"><td></td><td colspan="${span - 1}">${r.problems.map((p) => `<div class="im-fix"><span class="im-msg">${esc(p.msg)}</span>${fixControl(r, p, form)}</div>`).join('')}</td></tr>`;
    else if (r.changes.length) html += `<tr class="im-noterow"><td></td><td colspan="${span - 1}"><span class="help">Changes ${esc(r.changes.slice(0, 4).map((c) => `${c.label} (${c.from || 'blank'} → ${c.to || 'blank'})`).join(', '))}${r.changes.length > 4 ? ` and ${r.changes.length - 4} more` : ''}</span></td></tr>`;
    else if (IM.overrides.has(r.i)) html += `<tr class="im-noterow"><td></td><td colspan="${span - 1}"><span class="im-tag ok">Fixed</span></td></tr>`;
    return html;
  }).join('');
  const go = s.new + s.update;
  const blocked = (!IM.skip && s.problem > 0) || go === 0;
  const goText = !IM.skip && s.problem ? `Fix or skip ${s.problem} problem row${s.problem === 1 ? '' : 's'}` : go ? `Import ${go.toLocaleString()} row${go === 1 ? '' : 's'}` : 'Nothing to import';
  return `<div class="im-sum">
      <div class="panel im-sc"><b>${s.rows.toLocaleString()}</b><span>rows in the file</span></div>
      <div class="panel im-sc"><b>${s.new.toLocaleString()}</b><span>new ${esc(lower(form.name))}</span></div>
      <div class="panel im-sc"><b>${s.update.toLocaleString()}</b><span>updates to existing ${esc(lower(form.name))}</span></div>
      <div class="panel im-sc${s.problem ? ' bad' : ''}"><b>${s.problem.toLocaleString()}</b><span>rows with problems</span></div>
    </div>
    <section class="panel">
      <div class="im-fileline"><h2>Check before importing</h2><span class="grow"></span>
        <div class="lv-seg" role="group" aria-label="Show rows">${filters.map(([k, l]) => `<button type="button" class="${IM.filter === k ? 'on' : ''}" aria-pressed="${IM.filter === k}" data-im="filter" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>
      ${page.length ? `<div class="im-wrap im-rows"><table class="tbl im-tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>` : `<p class="im-more">${IM.filter === 'problem' ? 'No problems left.' : 'No rows here.'}</p>`}
      ${list.length > page.length ? `<div class="im-more"><button type="button" class="btn sm" data-im="more">Show ${Math.min(PAGE, list.length - page.length)} more</button><span class="help">${(list.length - page.length).toLocaleString()} more rows</span></div>` : ''}
      <div class="im-foot">
        <label class="im-chk"><input type="checkbox" data-imc="skip"${IM.skip ? ' checked' : ''}>Skip rows that still have problems</label>
        ${(() => { const fx = rulesEffect(form); if (!fx) return ''; const labels = new Map((form.fields || []).map((x) => [x.id, x.label])); return `<p class="help im-rulesnote"><span class="im-tag rule">Rules</span> The form’s show and hide rules empty ${fx.vals.toLocaleString()} value${fx.vals === 1 ? '' : 's'} on ${fx.rows.toLocaleString()} row${fx.rows === 1 ? '' : 's'} as they’re saved: ${esc([...fx.per].map(([id, n]) => `${labels.get(id) || 'Field'} (${n})`).join(', '))}. Undoing the import puts them back too.</p>`; })()}
        ${(() => { const n = (store.automations || []).filter((a) => a.on && a.formId === form.id && ['created', 'changed'].includes(a.trigger?.type)).length; return n ? `<p class="help im-rulesnote"><span class="im-tag rule">Automations</span> ${n} automation${n === 1 ? '' : 's'} on ${esc(lower(form.name))} may run for the imported rows, as if they’d been saved by hand.</p>` : ''; })()}
        <span class="help im-foothelp">${s.same ? `${s.same} row${s.same === 1 ? ' has' : 's have'} no changes and will be left alone. ` : ''}Skipped rows can be downloaded afterwards to fix and import again.</span>
        <div class="im-acts im-right"><button type="button" class="btn" data-im="back-map">Back</button>
        <button type="button" class="btn primary" data-im="run"${blocked ? ' disabled' : ''}>${esc(goText)}</button></div>
      </div>
    </section>`;
}

function stepRun() {
  const { done, total } = IM.progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<section class="panel im-pad"><div class="im-run">
    <h2>Importing…</h2>
    <div class="im-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" id="im-bar"><i style="width:${pct}%"></i></div>
    <p class="help" id="im-prog">Saved ${done.toLocaleString()} of ${total.toLocaleString()} rows. Keep this tab open.</p>
  </div></section>`;
}

function stepDone(form) {
  const d = IM.done;
  const imp = store.imports.find((x) => x.id === d.id);
  const undone = imp?.status === 'undone';
  const lines = undone
    ? [`Removed ${imp.undo?.removed ?? 0} ${lower(form.name)} it added${imp.undo?.under ? ` and ${imp.undo.under} records under them` : ''}.`, `Put ${imp.undo?.restored ?? 0} updated ${lower(form.name)} back the way they were.`]
    : d.error ? [d.error, `${d.saved.toLocaleString()} of ${d.total.toLocaleString()} rows were saved before it stopped. You can undo those from Import history.`]
    : [`${plural(d.counts.added, form)} added, owned by you.`, `${plural(d.counts.updated, form)} updated (only the columns in your file).`, d.counts.same ? `${d.counts.same} row${d.counts.same === 1 ? '' : 's'} had no changes.` : '', d.skipped.length ? `${d.skipped.length} row${d.skipped.length === 1 ? '' : 's'} skipped with problems.` : 'No rows skipped.'].filter(Boolean);
  const title = undone ? 'Import undone' : d.error ? 'The import stopped part way' : `Imported ${(d.counts.added + d.counts.updated).toLocaleString()} rows into ${form.name}`;
  return `<section class="panel im-pad"><div class="im-done">
    <div class="im-ring${undone || d.error ? ' off' : ''}">${ICON.ok}</div>
    <h2>${esc(title)}</h2>
    <ul class="im-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="im-acts">
      <button type="button" class="btn primary" data-im="list" data-id="${esc(form.id)}">Open ${esc(form.name)}</button>
      ${!undone && d.skipped.length ? '<button type="button" class="btn" data-im="skipped">Download skipped rows (.xlsx)</button>' : ''}
      ${imp && undoOpen(imp, Date.now()) ? `<button type="button" class="btn im-danger" data-im="undo-ask" data-id="${esc(imp.id)}"${asking === imp.id ? ' disabled' : ''}>${asking === imp.id ? 'Working it out…' : 'Undo this import'}</button>` : ''}
      <button type="button" class="btn" data-im="history">Import history</button>
    </div>
    <p class="help">${undone ? 'You can import the file again any time.' : `Undo stays available for ${UNDO_DAYS} days in Import history. ${esc(form.name)} someone edits after the import are left alone by undo.`}</p>
  </div></section>`;
}

/* ---------- reading the picked file ---------- */

async function readFile(file) {
  const form = formOf(IM.formId);
  if (!file || !form) return;
  IM.reading = true; IM.err = ''; H.renderMain();
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('This file is over 25 MB. Split it into smaller files.');
    const sheets = await readSheets(new Uint8Array(await file.arrayBuffer()), file.name);
    IM.fileName = file.name;
    IM.sheets = sheets;
    const err = useSheet(pickSheet(sheets), form);
    if (err) throw new Error(err);
  } catch (e) {
    if (!/^[A-Z]/.test(e?.message || '')) console.error(e); // our own messages are for the person, not the console
    IM.err = e && e.message && !/^[a-z]/.test(e.message) ? e.message : 'This file couldn’t be read. Use an .xlsx or .csv file.';
    IM.step = 'file';
  }
  IM.reading = false;
  H.renderMain();
}

/** Use one sheet of the file. Returns an error message, or '' when it has rows to import. */
function useSheet(i, form) {
  const sh = IM.sheets[i];
  const { headers, data, rowNums } = splitSheet(sh ? sh.rows : []);
  if (!headers.length) return 'This sheet is empty.';
  if (!data.length) return 'There are no rows under the headings.';
  if (data.length > MAX_ROWS) return `This sheet has ${data.length.toLocaleString()} rows. Import up to ${MAX_ROWS.toLocaleString()} at a time: split it into smaller files.`;
  const m = matchColumns(headers, colsOf(form));
  Object.assign(IM, { sheetIdx: i, headers, data, rowNums, map: m.map((x) => x.key), how: m.map((x) => x.how), mine: new Set(), results: null, overrides: new Map(), filter: 'all', shown: PAGE, step: 'map', err: '' });
  return '';
}

/* ---------- the form's show/hide rules ----------
   A row whose values a rule hides or clears is saved with those fields empty, the same as
   saving the record by hand. The check step says how many. */
const rowRec = (form, r) => ({ id: r.action === 'update' ? r.id : null, formId: form.id, values: r.values, parentId: r.parentId || null, parentFormId: r.parentFormId || null });
function rulesEffect(form) {
  if (!form?.rules?.length || !H.ruleClears || !IM.results) return null;
  const per = new Map(); let rows = 0, vals = 0;
  IM.results.forEach((r) => {
    if (r.action !== 'new' && r.action !== 'update') return;
    const ids = H.ruleClears(form, rowRec(form, r));
    if (!ids.length) return;
    rows++; vals += ids.length; ids.forEach((id) => per.set(id, (per.get(id) || 0) + 1));
  });
  return rows ? { rows, vals, per } : null;
}
function ruleValues(form, r) {
  if (!form?.rules?.length || !H.ruleClears) return r.values;
  const ids = H.ruleClears(form, rowRec(form, r));
  if (!ids.length) return r.values;
  const v = { ...r.values }; ids.forEach((id) => { delete v[id]; });
  if (H.computeFormulas) Object.assign(v, H.computeFormulas(form, { ...rowRec(form, r), values: v }));
  return v;
}

/* ---------- saving ---------- */

async function start() {
  const form = formOf(IM.formId);
  if (!form || !IM.results) return;
  const go = IM.results.filter((r) => r.action === 'new' || r.action === 'update');
  const skipped = IM.results.filter((r) => r.action === 'problem');
  if (!go.length || (!IM.skip && skipped.length)) return;
  const id = uid('imp');
  const creates = go.filter((r) => r.action === 'new').map((r) => ({ id: uid('r'), values: ruleValues(form, r), parentId: r.parentId, parentFormId: r.parentFormId }));
  const updates = go.filter((r) => r.action === 'update').map((r) => ({ id: r.id, values: ruleValues(form, r), parentId: r.parentId, parentFormId: r.parentFormId }));
  const counts = { added: creates.length, updated: updates.length, same: IM.results.filter((r) => r.action === 'same').length, skipped: skipped.length };
  IM.step = 'run'; IM.progress = { done: 0, total: go.length };
  H.renderMain();
  const paint = () => {
    const { done, total } = IM.progress, pct = total ? Math.round((done / total) * 100) : 0;
    const bar = $('#im-bar'); if (bar) { bar.setAttribute('aria-valuenow', pct); bar.firstElementChild.style.width = pct + '%'; }
    const p = $('#im-prog'); if (p) p.textContent = `Saved ${done.toLocaleString()} of ${total.toLocaleString()} rows. Keep this tab open.`;
  };
  try {
    await runImport({ id, formId: form.id, formName: form.name, fileName: IM.fileName, counts, creates, updates }, (done, total) => { IM.progress = { done, total }; paint(); });
    IM.done = { id, counts, skipped, total: go.length, saved: go.length };
  } catch (e) {
    console.error(e);
    IM.done = { id, counts, skipped, total: go.length, saved: IM.progress.done, error: e?.code === 'permission-denied' ? 'Firestore refused part of the import. Check that you’re still an admin and that the latest security rules are deployed.' : 'The import stopped part way, probably because the connection dropped.' };
  }
  IM.step = 'done';
  H.renderMain();
  toast(IM.done.error ? 'The import stopped part way' : `Imported ${(counts.added + counts.updated).toLocaleString()} rows`);
}

async function downloadSkipped() {
  const form = formOf(IM.formId);
  const rows = (IM.done?.skipped || []);
  if (!form || !rows.length) return;
  const head = [...IM.headers.map((h) => ({ v: h, s: 'head' })), { v: 'Problem', s: 'head' }];
  const data = rows.map((r) => [...IM.data[r.i].slice(0, IM.headers.length), r.problems.map((p) => p.msg).join(' ')]);
  const bytes = await writeXlsx([{ name: form.name, rows: [head, ...data], freeze: true, cols: [...IM.headers.map(() => ({ width: 18 })), { width: 60, style: 'wrap' }] }]);
  save(bytes, `${IM.fileName.replace(/\.[^.]+$/, '')} - skipped rows.xlsx`);
}

/* ---------- undo ---------- */

async function askUndo(importId) {
  const imp = store.imports.find((x) => x.id === importId);
  if (!imp || asking) return;
  if (store.recordsLoading.size) { toast('Still loading records. Try again in a moment.'); return; }
  asking = importId; H.renderMain();
  try {
    const before = await importBefore(importId);
    const plan = undoPlan(imp, store.records, before);
    const form = formOf(imp.formId);
    const many = (n) => (form ? plural(n, form) : `${n.toLocaleString()} record${n === 1 ? '' : 's'}`);
    const the = (n) => (n === 1 ? 'the ' + (form ? lower(itemName(form)) : 'record') : 'the ' + many(n));
    const titles = (ids) => ids.map((id) => store.records.find((r) => r.id === id)).filter(Boolean).map((r) => H.recTitle(r));
    const lines = [];
    if (plan.del.length) lines.push(`Removes ${the(plan.del.length)} it added${plan.under.length ? `, and the ${plan.under.length.toLocaleString()} record${plan.under.length === 1 ? '' : 's'} added under ${plan.del.length === 1 ? 'it' : 'them'} since` : ''}.`);
    if (plan.restore.length) lines.push(isRules(imp) ? `Puts back the values the rule change emptied on ${the(plan.restore.length)}.` : `Puts ${the(plan.restore.length)} it updated back the way ${plan.restore.length === 1 ? 'it was' : 'they were'} before the import.`);
    if (plan.kept.length) { const t = titles(plan.kept); lines.push(`${many(plan.kept.length)} ${plan.kept.length === 1 ? 'was' : 'were'} edited after the ${isRules(imp) ? 'change' : 'import'}, so ${plan.kept.length === 1 ? 'it’s' : 'they’re'} left as ${plan.kept.length === 1 ? 'it is' : 'they are'}: ${t.slice(0, 5).join(', ')}${t.length > 5 ? ` and ${t.length - 5} more` : ''}.`); }
    if (plan.gone) lines.push(`${plan.gone} record${plan.gone === 1 ? '' : 's'} it touched ${plan.gone === 1 ? 'has' : 'have'} since been deleted.`);
    if (!plan.del.length && !plan.restore.length) lines.push('There’s nothing left to change. Undoing just marks the import as undone.');
    ask = { imp, plan, lines, busy: false };
  } catch (e) {
    console.error(e);
    toast('Couldn’t work out what to undo. Check your connection and try again.');
  }
  asking = null;
  H.renderMain();
  setTimeout(() => $('#im-undo-go')?.focus(), 0);
}

function undoDialog() {
  return `<div class="im-scrim" data-im="undo-cancel"><div class="im-dlg" role="dialog" aria-modal="true" aria-labelledby="im-dlg-h">
    <h3 id="im-dlg-h">${isRules(ask.imp) ? 'Undo this rule change?' : `Undo “${esc(ask.imp.fileName || 'this import')}”?`}</h3>
    <ul class="im-list">${ask.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="help">${isRules(ask.imp) ? 'The rules stay as they are, so these fields empty again the next time each record is saved. To keep the values, change the rules too.' : 'This can’t itself be undone, but you can import the file again.'}</p>
    <div class="im-acts end"><button type="button" class="btn" data-im="undo-cancel">Keep the import</button><button type="button" class="btn im-dfill" id="im-undo-go" data-im="undo-go"${ask.busy ? ' disabled' : ''}>${ask.busy ? 'Undoing…' : isRules(ask.imp) ? 'Undo rule change' : 'Undo import'}</button></div>
  </div></div>`;
}

async function doUndo() {
  if (!ask || ask.busy) return;
  ask.busy = true; H.renderMain();
  try {
    await undoImport(ask.imp, ask.plan);
    toast(isRules(ask.imp) ? 'Undid the rule change' : `Undid ${ask.imp.fileName || 'the import'}`);
  } catch (e) {
    console.error(e);
    toast(e?.code === 'permission-denied' ? 'Firestore refused the undo. Check that the latest security rules are deployed.' : 'The undo didn’t finish. Check your connection and try again.');
  }
  ask = null;
  H.renderMain();
}

/* ---------- Import history ---------- */

let histForm = '', histKind = '';
const isRules = (i) => i?.counts?.kind === 'rules';
export function viewImports() {
  if (!isAdmin(store.me)) return '<div class="panel empty"><p>Only admins can see imports.</p></div>';
  const now = Date.now();
  const formsUsed = [...new Set(store.imports.map((i) => i.formId))].map((id) => ({ id, name: formOf(id)?.name || store.imports.find((i) => i.formId === id)?.formName || 'Deleted form' }));
  const anyRules = store.imports.some(isRules);
  const list = store.imports.filter((i) => (!histForm || i.formId === histForm) && (!histKind || (histKind === 'rules') === isRules(i)));
  const rows = list.map((i) => {
    const c = i.counts || {};
    const by = store.profiles[i.ownerId]?.displayName || (i.ownerId === me() ? 'You' : 'An admin');
    let undo;
    if (i.status === 'undone') undo = `<span class="im-tag warn">Undone</span>${i.undoneAt ? `<small>${esc(when(i.undoneAt))}</small>` : ''}`;
    else if (i.status === 'running' && IM.step === 'run' && IM.done == null && now - i.createdAt < 36e5) undo = '<span class="im-tag off">Running…</span>';
    else if (undoOpen(i, now)) undo = `<button type="button" class="btn sm im-danger" data-im="undo-ask" data-id="${esc(i.id)}"${asking === i.id ? ' disabled' : ''}>${asking === i.id ? 'Working it out…' : 'Undo'}</button><small>until ${esc(when(i.createdAt + UNDO_DAYS * 864e5))}</small>`;
    else undo = '<span class="im-tag off">Undo expired</span>';
    const status = i.status === 'failed' || (i.status === 'running' && now - i.createdAt > 36e5) ? ' <span class="im-tag bad">Stopped part way</span>' : '';
    return `<tr class="${i.status === 'undone' ? 'im-gone' : ''}"><td>${esc(when(i.createdAt))}<small>${esc(whenTime(i.createdAt))}</small></td>
      <td>${esc(formOf(i.formId)?.name || i.formName || 'Deleted form')}</td><td class="${isRules(i) ? 'im-fname' : 'im-mono im-fname'}" title="${esc(i.fileName || '')}">${isRules(i) ? `<span class="im-tag rule">${esc(i.counts.what || 'Rule change')}</span> ${esc(Object.entries(i.counts.fields || {}).map(([l, n]) => `${l} (${n})`).join(', ') || 'Fields emptied')}` : esc(i.fileName || '')}${status}</td>
      <td>${esc(by)}</td><td class="num">${(c.added || 0).toLocaleString()}</td><td class="num">${(c.updated || 0).toLocaleString()}</td><td class="num">${(c.skipped || 0).toLocaleString()}</td><td class="im-undo">${undo}</td></tr>`;
  }).join('');
  return `<div class="im" id="im">
    <div class="head"><div class="ttl"><div><h1>Import history</h1><p class="sub">Imports, and rule changes applied to saved records, by every admin. Undo one within ${UNDO_DAYS} days.</p></div></div>
      ${anyRules ? `<div class="actions"><div class="segs im-kind" role="group" aria-label="Show">${[['', 'All'], ['imports', 'Imports'], ['rules', 'Rule changes']].map(([k, l]) => `<button type="button" class="${histKind === k ? 'on' : ''}" aria-pressed="${histKind === k}" data-im="kind" data-v="${k}">${l}</button>`).join('')}</div></div>` : ''}
      ${formsUsed.length > 1 ? `<div class="actions"><label class="help" for="im-hform">Form</label><select class="in im-auto" id="im-hform" data-imc="hform"><option value="">All forms</option>${formsUsed.map((f) => `<option value="${esc(f.id)}"${f.id === histForm ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>` : ''}</div>
    ${list.length ? `<section class="panel"><div class="im-wrap"><table class="tbl im-hist"><thead><tr><th>When</th><th>Form</th><th>File or change</th><th>By</th><th class="num">Added</th><th class="num">Updated</th><th class="num">Skipped</th><th>Undo</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
      : `<div class="panel empty"><h2>No imports yet</h2><p>Import from a form’s list: Import and templates › Import a filled-in file.</p></div>`}
    <div class="im-cards">
      <div class="panel im-note"><h3>Admins only</h3><p class="help">Only admins see Import, the templates and this page. Imported records belong to the admin who imported them.</p></div>
      <div class="panel im-note"><h3>Undo for ${UNDO_DAYS} days</h3><p class="help">Removes what an import added and restores what it changed. Records someone edited after the import are left alone and listed.</p></div>
      <div class="panel im-note"><h3>Sub-form rows follow their parent</h3><p class="help">Undoing an import also removes rows added under the records it added, so nothing is left orphaned.</p></div>
    </div>
    ${ask ? undoDialog() : ''}
  </div>`;
}

/** Forget everything on sign-out. */
export function resetImports() { IM = fresh(null); menuFor = null; ask = null; asking = null; histForm = ''; histKind = ''; }

/* ---------- events ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-im]');
  if (menuFor && !e.target.closest('.im-anchor')) { menuFor = null; if (!el) { H.renderMain(); return; } }
  if (!el) return;
  const a = el.dataset.im, id = el.dataset.id;
  if (a === 'undo-cancel' && el.classList.contains('im-scrim') && e.target !== el) return; // clicks inside the dialog
  const form = formOf(IM.formId);
  switch (a) {
    case 'menu': menuFor = menuFor === id ? null : id; H.renderMain(); document.querySelector('.im-menu .im-mi')?.focus(); break;
    case 'tpl': menuFor = null; H.renderMain(); downloadTemplate(id, el.dataset.v); break;
    case 'go': openImport(id); break;
    case 'history': menuFor = null; H.go({ name: 'imports' }); break;
    case 'kind': histKind = el.dataset.v || ''; H.renderMain(); break;
    case 'list': H.go({ name: 'records', formId: id }); break;
    case 'restart': Object.assign(IM, fresh(IM.formId)); H.renderMain(); break;
    case 'check': IM.results = null; IM.overrides = new Map(); IM.filter = 'all'; IM.shown = PAGE; IM.step = 'check'; H.renderMain(); window.scrollTo(0, 0); break;
    case 'back-map': IM.step = 'map'; H.renderMain(); break;
    case 'filter': IM.filter = el.dataset.v; IM.shown = PAGE; H.renderMain(); break;
    case 'more': IM.shown += PAGE; H.renderMain(); break;
    case 'asnew': { const i = +el.dataset.row; const ov = IM.overrides.get(i) || { cells: {} }; ov.asNew = true; IM.overrides.set(i, ov); if (form) recheck(form); H.renderMain(); focusNextFix(); break; }
    case 'run': start(); break;
    case 'skipped': downloadSkipped(); break;
    case 'undo-ask': askUndo(id); break;
    case 'undo-cancel': ask = null; H.renderMain(); break;
    case 'undo-go': doUndo(); break;
  }
});

function focusNextFix() {
  setTimeout(() => { const c = document.querySelector('#im [data-imfix], #im [data-im="asnew"]'); if (c) c.focus({ preventScroll: false }); }, 0);
}

function applyFix(t) {
  const form = formOf(IM.formId);
  if (!form) return;
  const i = +t.dataset.row, ci = +t.dataset.ci;
  if (t.value === '' && t.tagName === 'SELECT') return;
  const ov = IM.overrides.get(i) || { cells: {} };
  ov.cells = { ...ov.cells, [ci]: t.value === '__blank' ? '' : t.value };
  IM.overrides.set(i, ov);
  recheck(form);
  H.renderMain();
  const r = IM.results[i];
  toast(r.action === 'problem' ? `Row ${r.n} still has a problem` : `Row ${r.n} fixed`);
  focusNextFix();
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'im-file') { readFile(t.files && t.files[0]); return; }
  if (t.dataset.imfix) { applyFix(t); return; }
  const k = t.dataset.imc;
  if (!k) return;
  const form = formOf(IM.formId);
  if (k === 'map') {
    const ci = +t.dataset.ci, key = t.value;
    IM.map = IM.map.map((x, j) => (j === ci ? key : key && x === key ? '' : x));
    IM.mine.add(ci);
    H.renderMain();
    document.querySelector(`#im select[data-ci="${ci}"]`)?.focus();
  } else if (k === 'sheet' && form) { const err = useSheet(+t.value, form); if (err) toast(err); H.renderMain(); document.getElementById('im-sheet')?.focus(); }
  else if (k === 'skip') { IM.skip = t.checked; H.renderMain(); document.querySelector('#im [data-imc="skip"]')?.focus(); }
  else if (k === 'hform') { histForm = t.value; H.renderMain(); document.getElementById('im-hform')?.focus(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.imfix && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); return; } // blur sends the change
  if (e.key !== 'Escape') return;
  if (ask && !ask.busy) { ask = null; H.renderMain(); return; }
  if (menuFor) { const id = menuFor; menuFor = null; H.renderMain(); document.querySelector(`[data-im="menu"][data-id="${CSS.escape(id)}"]`)?.focus(); }
});

document.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('#im-drop'); if (!d) return; e.preventDefault(); d.classList.add('over'); });
document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('#im-drop'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('over'); });
document.addEventListener('drop', (e) => { const d = e.target.closest && e.target.closest('#im-drop'); if (!d) return; e.preventDefault(); d.classList.remove('over'); readFile(e.dataTransfer?.files?.[0]); });
window.addEventListener('beforeunload', (e) => { if (IM.step === 'run') { e.preventDefault(); e.returnValue = ''; } });

// Form designer: the Fields tab's Text view, the History tab (versions), drafts and Make active.
// The text format and change summaries are in formtext.js (pure); storage in store.js.
import { esc } from './ui.js';
import { sysOf } from './fieldnames.js';
import { newVersionId, putVersion, loadVersions } from './store.js';
import { paint, sectionsIn } from './formtextcolor.js';
import { formToText, textToFields, fieldChanges, changeLines, formChangeLines, readVersionFile, TYPE_LIST } from './formtext.js';

let H = {};
export function initFormVer(helpers) { H = helpers; }

const V = { formId: null, list: null, loading: false, err: '', view: 'visual', text: null, open: {}, confirm: null, bannerOff: false, onDraft: null, file: null, busy: false };
const KINDS = { saved: 'Saved', draft: 'Draft', loaded: 'Draft from a file', activated: 'Made active again', baseline: 'Before version history' };
const DRAFTS = new Set(['draft', 'loaded']);

/* ---------- opening a form ---------- */
/** Called whenever the designer opens a form (or a new one: formId null). Always opens in Visual. */
export function openForm(formId) {
  Object.assign(V, { formId, list: formId ? null : [], err: '', view: 'visual', text: null, open: {}, confirm: null, bannerOff: false, onDraft: null, file: null, busy: false });
  if (formId) refresh();
}
export async function refresh() {
  const id = V.formId; if (!id) return;
  V.loading = true;
  try { const list = await loadVersions(id); if (V.formId === id) { V.list = list; V.err = ''; } }
  catch (e) { console.error('[formwright] versions', e); if (V.formId === id) { V.list = V.list || []; V.err = e?.code === 'permission-denied' ? 'Version history needs the latest security rules (deploy the Cadence rules).' : 'Couldn’t load the version history.'; } }
  V.loading = false;
  if (V.formId === id) H.renderMain();
}
const active = (form) => (V.list || []).find((v) => v.id === form?.activeVersion) || null;
const activeAt = (form) => active(form)?.at || form?.updatedAt || 0;
function newerDraft(form) {
  if (!form || !V.list) return null;
  const t = activeAt(form);
  return V.list.find((v) => DRAFTS.has(v.kind) && v.at > t) || null;
}
const nextN = () => Math.max(0, ...(V.list || []).map((v) => v.n || 0)) + 1;

/** A clean copy of a form for a version (no designer-only keys). */
function snapshot(f) {
  const o = JSON.parse(JSON.stringify(f));
  ['dirty', 'isNew', '_labels', '_newForms', '_inherit', 'activeVersion'].forEach((k) => delete o[k]);
  return o;
}
const countValues = (formId) => (id) => H.recordsOf(formId).filter((r) => !H.isEmpty(r.values?.[id])).length;
const formName = (id) => H.forms().find((x) => x.id === id)?.name || '';

/** The designer's draft made from a version: same form ID, sub-forms that still exist, current list order. */
function draftFrom(v) {
  const saved = H.formById(V.formId);
  const f = JSON.parse(JSON.stringify(v.form));
  f.id = V.formId;
  f.children = (f.children || []).filter((c) => H.formById(c.formId));
  if (saved) { f.order = saved.order; f.activeVersion = saved.activeVersion; }
  return { ...f, fields: f.fields || [], dirty: true, isNew: false, _labels: Object.fromEntries((saved?.fields || []).map((x) => [x.id, sysOf(x)])) };
}

/* ---------- writing versions ---------- */
/** The ID the next saved version will have (put on the form as activeVersion before it's saved). */
export const prepare = (formId) => newVersionId(formId);

/** After Save form (or Make active) has written the form: record the version, and the old form first if history is new. */
export async function recordVersion(before, out, vid, meta = {}) {
  try {
    if (V.formId !== out.id) V.formId = out.id;
    if (V.list === null) V.list = await loadVersions(out.id);
    if (before && !V.list.length) {
      const b = { n: 1, at: before.updatedAt || Date.now() - 1, kind: 'baseline', note: '', summary: ['The form as it was before version history began'], form: snapshot(before) };
      const bid = newVersionId(out.id);
      await putVersion(out.id, bid, b);
      V.list.unshift({ ...b, id: bid, by: H.me() });
    }
    const v = { n: nextN(), at: out.updatedAt || Date.now(), kind: meta.kind || 'saved', note: meta.note || '', from: meta.from || null, fromN: meta.fromN || null, summary: formChangeLines(before ? snapshot(before) : null, snapshot(out), countValues(out.id)), form: snapshot(out) };
    await putVersion(out.id, vid, v);
    V.list.unshift({ ...v, id: vid, by: H.me() });
    V.onDraft = null; V.bannerOff = true;
    return v;
  } catch (e) {
    console.error('[formwright] version', e);
    setTimeout(() => H.toast(e?.code === 'permission-denied' ? 'Form saved, but its version wasn’t recorded: deploy the latest Cadence security rules.' : 'Form saved, but its version wasn’t recorded. It will be on the next save.'), 1200);
    return null;
  }
}

async function saveDraft(f, kind = 'draft', note = '', form = null) {
  if (V.busy) return;
  const saved = H.formById(V.formId);
  if (!saved) { H.toast('Save the form once before saving drafts.'); return; }
  V.busy = true;
  try {
    if (V.list === null) V.list = await loadVersions(V.formId);
    if (!V.list.length) { // history starts with the live form, so a draft never hides it
      const b = { n: 1, at: saved.updatedAt || Date.now() - 1, kind: 'baseline', note: '', summary: ['The form as it was before version history began'], form: snapshot(saved) };
      const bid = newVersionId(V.formId); await putVersion(V.formId, bid, b); V.list.unshift({ ...b, id: bid, by: H.me() });
    }
    const snap = snapshot(form || { ...f, name: String(f.name || '').trim() || saved.name });
    snap.id = V.formId;
    const v = { n: nextN(), at: Date.now(), kind, note, summary: formChangeLines(snapshot(saved), snap, countValues(V.formId)), form: snap };
    const id = newVersionId(V.formId);
    await putVersion(V.formId, id, v);
    V.list.unshift({ ...v, id, by: H.me() });
    V.busy = false;
    return { ...v, id };
  } catch (e) {
    V.busy = false;
    console.error('[formwright] draft', e);
    H.toast(e?.code === 'permission-denied' ? 'Saving the draft was refused: deploy the latest Cadence security rules.' : 'Saving the draft failed. Check your connection and try again.');
    return null;
  }
}

/* ---------- Text view ---------- */
export const textMode = () => V.view === 'text';
/** Unapplied text edits (Save form waits for them). */
export const textPending = () => V.view === 'text' && !!V.text?.dirty;
const textOf = (f) => formToText(f, { formName });

export function switchHTML() {
  return `<div class="fv-bar"><div class="segs fv-sw" role="group" aria-label="How to edit fields"><button type="button" class="${V.view === 'visual' ? 'on' : ''}" aria-pressed="${V.view === 'visual'}" data-fv="visual">Visual</button><button type="button" class="${V.view === 'text' ? 'on' : ''}" aria-pressed="${V.view === 'text'}" data-fv="text">Text</button></div>
    <span class="help fv-say">${V.view === 'text' ? 'Every field on one line. Good for big changes: add, rename, reorder by moving lines, or paste a list.' : 'Drag field types onto the form, or switch to Text for big changes.'}</span></div>`;
}

const CHEAT = `<details class="fxref ft-help"><summary>How to write fields</summary><div class="ft-helpb">
  <p><code>Name: type, options</code> on each line. <code># Section name</code> starts a section. Lines starting <code>//</code> are notes and are ignored.</p>
  <p><b>Types:</b> ${TYPE_LIST.map((t) => `<code>${esc(t)}</code>`).join(' ')}</p>
  <p><b>Options:</b> <code>required</code> <code>half</code> <code>full</code> <code>in list</code> (a column in the starting list) <code>help "…"</code> <code>placeholder "…"</code> <code>system name "Contact name"</code> · long text: <code>plain</code> (no formatting toolbar) <code>min 0</code> <code>max 100</code> <code>decimals 2</code> <code>currency USD</code> · sliders: <code>step 5</code> <code>suffix "%"</code> · ratings: <code>stars 10</code> · auto numbers: <code>prefix "INV-"</code> <code>start 100</code> <code>digits 4</code> <code>yearly</code></p>
  <p><b>Choices:</b> <code>Status: dropdown [Open, In progress, Closed]</code> (also <code>single choice</code>, <code>multiple choice</code>). Put an option in quotes if it has a comma.</p>
  <p><b>Calculations:</b> <code>Total: calculated, as currency = {Price} * {Quantity}</code>. Show as decimal, number, currency, percent, days or text.</p>
  <p><b>Links:</b> <code>Client: link to Clients</code></p>
  <p><b>Captions and system names:</b> the name before the colon is the caption people see, and several fields can share one. Calculations and {placeholders} use the <b>system name</b>, which is the caption unless you add <code>system name "…"</code>. Two fields with the same caption and no system name: the second gets one, like “Name 2”.</p>
  <p><b>The @tag</b> at the end of a line is that field’s identity. Change anything before it and it’s still the same field, with its saved values. To add a field, write a new line without a tag. Delete a line to remove the field (saved values are kept, hidden, and Version history can bring it back).</p></div></details>`;

export function viewText(f) {
  if (!V.text) V.text = { value: textOf(f), base: textOf(f), dirty: false, result: null, preview: null };
  const t = V.text, n = t.value.split('\n').length;
  const errs = t.result?.errors || [], warns = t.result?.warnings || t.preview?.warnings || [];
  const pp = paint(t.value, { caretLine: 0, problems: liveProblems(t.value) });
  return `<div class="ft">
    ${CHEAT}
    ${jumpHTML(t.value, pp.count)}
    <div class="ft-ed"><div class="ft-gut" aria-hidden="true"><div class="ft-gutin">${pp.gut}</div></div><div class="ft-code"><div class="ft-hl" aria-hidden="true"><div class="ft-hlin">${pp.code}</div></div><textarea class="ft-in" data-ftext="1" spellcheck="false" autocapitalize="off" autocomplete="off" rows="${Math.min(40, Math.max(14, n + 2))}" aria-label="Fields as text" wrap="off">${esc(t.value)}</textarea></div></div>
    ${errs.length ? `<div class="panel am-warn ft-errs" role="alert"><b>${errs.length === 1 ? '1 thing to fix' : errs.length + ' things to fix'}</b><ul>${errs.map((e) => `<li><button type="button" class="linkbtn" data-fv="line" data-line="${e.line}">Line ${e.line}</button>: ${esc(e.msg)}</li>`).join('')}</ul></div>` : ''}
    ${!errs.length && warns.length ? `<div class="panel ft-warns" role="note"><ul>${warns.map((e) => `<li><button type="button" class="linkbtn" data-fv="line" data-line="${e.line}">Line ${e.line}</button>: ${esc(e.msg)}</li>`).join('')}</ul></div>` : ''}
    ${t.preview ? `<div class="panel ft-preview" role="region" aria-label="Changes to apply"><b>Apply these changes?</b><ul>${t.preview.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p class="help">They go into the designer. Nothing is live until you press Save form (or Save as draft).</p><div class="actions"><button type="button" class="btn ghost" data-fv="keep">Keep editing</button><button type="button" class="btn primary" data-fv="confirm" id="ft-confirm">Apply</button></div></div>` : ''}
    <div class="actions ft-acts"><span class="help grow">${t.dirty ? 'Changes not applied yet.' : 'Matches the designer.'}</span><button type="button" class="btn ghost" data-fv="reset"${t.dirty ? '' : ' disabled'}>Reset</button><button type="button" class="btn primary" data-fv="apply"${t.dirty ? '' : ' disabled'}>Apply changes</button></div>
  </div>`;
}

/* ---------- colours as you type ---------- */
let caret = 0, painted = '', paintTimer = 0;
/** What the parser says is wrong, by line (a quick check as you type; Apply changes says it in full). */
function liveProblems(value) {
  const f = H.fdraft(); if (!f) return new Map();
  try {
    const r = textToFields(value, { fields: f.fields, known: f.fields.map((x) => x.id), forms: H.forms().filter((x) => x.id !== f.id).concat([{ id: f.id, name: f.name }]), newId: () => 'x' + Math.random().toString(36).slice(2, 10) });
    return new Map((r.errors || []).map((e) => [e.line, e.msg]));
  } catch { return new Map(); }
}
function jumpHTML(value, count) {
  const secs = sectionsIn(value);
  if (!secs.length && !count) return '<div class="ft-jump" hidden></div>';
  return `<div class="ft-jump">${secs.length ? `<span class="ft-jl">Jump to</span>${secs.map((x) => `<button type="button" class="ft-chip" data-fv="jump" data-line="${x.line}">${esc(x.name)}</button>`).join('')}` : ''}${count ? `<span class="ft-probs">${count === 1 ? '1 line needs a look' : count + ' lines need a look'}</span>` : ''}</div>`;
}
const caretLineOf = (ta) => (document.activeElement === ta ? ta.value.slice(0, ta.selectionStart || 0).split('\n').length : 0);
/** Repaint the colours under the textarea (now, or soon after typing stops for the slower parser check). */
function repaint(ta, force = false) {
  if (!ta || !V.text) return;
  const cl = caretLineOf(ta);
  const key = cl + '|' + ta.value;
  if (!force && key === painted) return;
  painted = key; caret = cl;
  const pp = paint(ta.value, { caretLine: cl, problems: liveProblems(ta.value) });
  const ed = ta.closest('.ft-ed'); if (!ed) return;
  ed.querySelector('.ft-hlin').innerHTML = pp.code;
  ed.querySelector('.ft-gutin').innerHTML = pp.gut;
  const j = document.querySelector('.ft .ft-jump'); const jh = jumpHTML(ta.value, pp.count);
  if (j && j.outerHTML !== jh) j.outerHTML = jh;
  syncScroll(ta);
}
function syncScroll(ta) {
  const ed = ta.closest('.ft-ed'); if (!ed) return;
  ed.querySelector('.ft-hlin').style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`;
  ed.querySelector('.ft-gutin').style.transform = `translateY(${-ta.scrollTop}px)`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', (e) => { if (e.target?.dataset?.ftext) syncScroll(e.target); }, true);
  const moved = (e) => { const ta = e.target; if (!ta?.dataset?.ftext) return; if (caretLineOf(ta) !== caret) repaint(ta); else syncScroll(ta); };
  document.addEventListener('keyup', moved);
  document.addEventListener('click', moved);
  document.addEventListener('focusout', (e) => { if (e.target?.dataset?.ftext) setTimeout(() => repaint(e.target), 0); });
}

function applyText(f) {
  const t = V.text; if (!t) return;
  const saved = H.formById(f.id);
  const r = textToFields(t.value, { fields: f.fields, known: (saved?.fields || []).map((x) => x.id), forms: H.forms().filter((x) => x.id !== f.id).concat([{ id: f.id, name: f.name }]), newId: H.newId });
  t.result = r;
  if (r.errors.length) { t.preview = null; H.renderMain(); setTimeout(() => document.querySelector('.ft-errs')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); return; }
  const lines = changeLines(fieldChanges(f.fields, r.fields, countValues(f.id)));
  (r.given || []).forEach((g) => { const l = `${g.label}: system name set to “${g.sysName}”, since another field is called that. Rename it with system name "…" if you like.`; if (!lines.includes(l)) lines.push(l); });
  if (!lines.length) { t.result = null; t.preview = null; t.base = t.value; t.dirty = false; H.renderMain(); H.toast('Nothing changed.'); return; }
  t.preview = { fields: r.fields, lines, warnings: r.warnings };
  H.renderMain();
  setTimeout(() => { const b = document.getElementById('ft-confirm'); b?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); b?.focus({ preventScroll: true }); }, 0);
}
function confirmText(f) {
  const t = V.text; if (!t?.preview) return;
  f.fields = t.preview.fields;
  if (f.titleField && !f.fields.some((x) => x.id === f.titleField)) f.titleField = '';
  H.setFdirty();
  const txt = textOf(f);
  V.text = { value: txt, base: txt, dirty: false, result: null, preview: null };
  H.renderMain();
  H.toast('Applied. Press Save form to put it live, or Save as draft.');
}
function goLine(n, top = false) {
  const ta = document.querySelector('[data-ftext]'); if (!ta) return;
  const lines = ta.value.split('\n'); let s = 0;
  for (let i = 0; i < n - 1 && i < lines.length; i++) s += lines[i].length + 1;
  ta.focus(); ta.setSelectionRange(s, s + (lines[n - 1] || '').length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; ta.scrollTop = Math.max(0, (n - (top ? 1 : 4)) * lh); repaint(ta, true);
}

/* ---------- drafts ---------- */
export function bannerHTML(f) {
  if (f.isNew || V.bannerOff) return '';
  const d = newerDraft(H.formById(f.id)); if (!d) return '';
  return `<div class="panel fv-banner" role="note"><div class="grow"><b>There’s a draft of this form</b><span class="help">Version ${d.n}, saved ${esc(H.when(d.at))} by ${esc(H.personName(d.by))}${d.note ? ' · ' + esc(d.note) : ''}. It isn’t active: everyone still sees the active version.</span></div>
    <div class="actions"><button type="button" class="btn ghost" data-fv="draft-skip">Start from the active version</button><button type="button" class="btn primary" data-fv="draft-open" data-id="${esc(d.id)}">Continue the draft</button></div></div>`;
}
/** The savebar's status. */
export function saveState(f) {
  if (f.dirty) return 'Unsaved changes';
  if (V.onDraft) return `Draft saved (version ${V.onDraft}) · not active yet`;
  return 'All changes saved';
}

/* ---------- History tab ---------- */
function extras(form) {
  const w = form.workflow?.on ? `workflow: ${(form.workflow.stages || []).length} stages` : 'no workflow';
  const k = (form.children || []).length, r = (form.rules || []).length;
  return `${(form.fields || []).filter((x) => x.type !== 'heading').length} fields · ${k} relationship${k === 1 ? '' : 's'} · ${r} rule${r === 1 ? '' : 's'} · ${w}`;
}
export function viewHistory(f) {
  if (f.isNew) return `<div class="panel empty"><h2>No history yet</h2><p>Every time the form is saved, a copy is kept here. You can look back at any version, download it, or make it active again.</p></div>`;
  const saved = H.formById(f.id);
  const list = V.list;
  const head = `<section class="panel ver-top"><div class="grow"><b>Version history</b><p class="help">A copy of the whole form (fields, sections, relationships, rules, workflow and settings) is kept every time it’s saved. <b>Make active</b> puts any version live again; the change is recorded as a new version, so you can always switch back. Drafts are versions nobody sees until they’re made active.</p></div>
    <label class="btn sm ver-load"><input type="file" accept=".json,application/json" data-verfile="1" hidden>Load from file</label></section>`;
  const fileQ = V.file ? `<div class="panel fv-banner" role="alert"><div class="grow"><b>That file is from another form</b><span class="help">It was saved from “${esc(V.file.formName || 'another form')}”. Its fields won’t match this form’s saved values. Load it as a draft here anyway?</span></div><div class="actions"><button type="button" class="btn ghost" data-fv="file-cancel">Cancel</button><button type="button" class="btn primary" data-fv="file-load">Load as draft</button></div></div>` : '';
  if (V.err) return head + fileQ + `<div class="panel am-warn">${esc(V.err)}</div>`;
  if (!list) return head + fileQ + '<div class="panel"><p class="note">Loading versions…</p></div>';
  if (!list.length) return head + fileQ + `<div class="panel empty"><h2>No versions yet</h2><p>History starts the next time this form is saved. The form as it is now is kept as “Before version history”, so you can always come back to it.</p></div>`;
  const act = f.activeVersion || saved?.activeVersion || (list.find((v) => v.kind === 'baseline') || {}).id;
  const row = (v) => {
    const isAct = v.id === act, op = V.open[v.id];
    const label = KINDS[v.kind] || v.kind;
    const what = v.kind === 'activated' && v.fromN ? `${label} (from version ${v.fromN})` : label;
    let more = '';
    if (op === 'view') more = `<div class="ver-more"><p class="help">${esc(extras(v.form || {}))}</p><pre class="ver-pre">${esc(formToText(v.form || {}, { formName, withId: false }))}</pre></div>`;
    if (op === 'compare') {
      const lines = formChangeLines(snapshot(saved), v.form || {}, countValues(f.id));
      more = `<div class="ver-more"><p class="help">Making this version active would change the live form like this:</p><ul class="ver-ul">${lines.map((l) => `<li>${esc(l === 'No changes' ? 'Nothing: it’s the same as the active version.' : l)}</li>`).join('')}</ul></div>`;
    }
    const armed = V.confirm === v.id;
    return `<li class="ver${isAct ? ' on' : ''}${DRAFTS.has(v.kind) ? ' draft' : ''}">
      <div class="ver-h"><b>Version ${v.n}</b>${isAct ? '<span class="chip ok">Active</span>' : ''}${DRAFTS.has(v.kind) ? '<span class="chip">Draft</span>' : ''}<span class="help">${esc(what)} · ${esc(H.when(v.at))} · ${esc(H.personName(v.by))}${v.note ? ' · ' + esc(v.note) : ''}</span></div>
      ${(v.summary || []).length ? `<p class="ver-sum">${(v.summary || []).map(esc).join(' · ')}</p>` : ''}
      <div class="ver-acts"><button type="button" class="btn sm ghost" data-fv="view" data-id="${esc(v.id)}" aria-expanded="${op === 'view'}">${op === 'view' ? 'Hide' : 'View'}</button>${isAct ? '' : `<button type="button" class="btn sm ghost" data-fv="compare" data-id="${esc(v.id)}" aria-expanded="${op === 'compare'}">Compare with active</button>`}<button type="button" class="btn sm ghost" data-fv="download" data-id="${esc(v.id)}">Download JSON</button>${isAct ? '' : `<button type="button" class="btn sm${armed ? ' danger armed' : ''}" data-fv="activate" data-id="${esc(v.id)}"${V.busy ? ' disabled' : ''}>${armed ? 'Tap again: make it live' : 'Make active'}</button>`}</div>
      ${more}</li>`;
  };
  return head + fileQ + `<ol class="ver-list">${list.map(row).join('')}</ol>`;
}

function download(v) {
  const saved = H.formById(V.formId);
  const data = { formwright: 'form-version', version: v.n, kind: v.kind, at: v.at, by: v.by, formId: V.formId, formName: saved?.name || v.form?.name || '', form: v.form };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(saved?.name || 'Form').replace(/[\\/:*?"<>|]+/g, '-')} - version ${v.n}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function loadFile(r, name) {
  const v = await saveDraft(null, 'loaded', name, r.form);
  V.file = null;
  if (!v) return;
  V.bannerOff = false;
  H.toast(`Loaded as draft version ${v.n}. Continue it from the banner, or use Make active.`);
  H.renderMain();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- events ---------- */
export function onClick(el) {
  const a = el.dataset.fv, f = H.fdraft(); if (!a || !f) return false;
  const v = (V.list || []).find((x) => x.id === el.dataset.id);
  if (a !== 'activate') V.confirm = null;
  switch (a) {
    case 'visual':
      if (V.view === 'visual') return true;
      if (V.text?.dirty) { H.toast('Apply your text changes, or press Reset, before switching to Visual.'); return true; }
      V.view = 'visual'; V.text = null; H.renderMain(); return true;
    case 'text':
      if (V.view === 'text') return true;
      V.view = 'text'; V.text = null; H.closeField(); H.renderMain(); setTimeout(() => document.querySelector('[data-ftext]')?.focus({ preventScroll: true }), 0); return true;
    case 'apply': applyText(f); return true;
    case 'keep': if (V.text) V.text.preview = null; H.renderMain(); setTimeout(() => document.querySelector('[data-ftext]')?.focus(), 0); return true;
    case 'confirm': confirmText(f); return true;
    case 'reset': V.text = { value: textOf(f), base: textOf(f), dirty: false, result: null, preview: null }; H.renderMain(); return true;
    case 'line': goLine(+el.dataset.line); return true;
    case 'jump': goLine(+el.dataset.line, true); return true;
    case 'draft-skip': V.bannerOff = true; H.renderMain(); return true;
    case 'draft-open': {
      const d = (V.list || []).find((x) => x.id === el.dataset.id); if (!d) return true;
      H.setFdraft(draftFrom(d)); V.bannerOff = true; V.text = null; V.view = 'visual';
      H.renderMain(); H.toast(`Draft version ${d.n} opened. Save form puts it live; Save as draft keeps it as a draft.`); return true;
    }
    case 'view': case 'compare': if (v) { V.open = { ...V.open, [v.id]: V.open[v.id] === a ? null : a }; H.renderMain(); } return true;
    case 'download': if (v) download(v); return true;
    case 'activate': {
      if (!v || V.busy) return true;
      if (f.dirty) { H.toast('Save or discard your changes first, then make a version active.'); return true; }
      if (V.confirm !== v.id) { V.confirm = v.id; H.renderMain(); setTimeout(() => { if (V.confirm === v.id) { V.confirm = null; H.renderMain(); } }, 5000); return true; }
      V.confirm = null;
      H.setFdraft(draftFrom(v)); V.text = null; V.view = 'visual';
      H.saveForm({ kind: 'activated', from: v.id, fromN: v.n });
      return true;
    }
    case 'file-cancel': V.file = null; H.renderMain(); return true;
    case 'file-load': if (V.file) loadFile(V.file.r, V.file.name); return true;
  }
  return false;
}
export async function saveAsDraft() {
  const f = H.fdraft(); if (!f) return;
  if (textPending()) { H.toast('Apply your text changes first (or press Reset).'); return; }
  if (!String(f.name || '').trim()) { H.toast('Give the form a name first.'); return; }
  const v = await saveDraft(f);
  if (!v) return;
  f.dirty = false; V.onDraft = v.n; V.bannerOff = true;
  H.renderMain();
  H.toast(`Saved as draft (version ${v.n}). Nobody sees it until it’s made active in History.`);
}
export function onInput(el) {
  if (!el.dataset?.ftext || !V.text) return false;
  V.text.value = el.value;
  repaint(el);
  const was = V.text.dirty;
  V.text.dirty = el.value !== V.text.base;
  if (V.text.dirty) H.setFdirty();
  if (was !== V.text.dirty) {
    const r = document.querySelector('[data-fv="apply"]'), s = document.querySelector('[data-fv="reset"]'), h = document.querySelector('.ft-acts .help');
    if (r) r.disabled = !V.text.dirty; if (s) s.disabled = !V.text.dirty; if (h) h.textContent = V.text.dirty ? 'Changes not applied yet.' : 'Matches the designer.';
  }
  return true;
}
export function onChange(el) {
  if (!el.dataset?.verfile) return false;
  const file = el.files?.[0]; el.value = '';
  if (!file) return true;
  if (file.size > 900000) { H.toast('That file is too big to be a form version.'); return true; }
  file.text().then((txt) => {
    const r = readVersionFile(txt);
    if (r.error) { H.toast(r.error); return; }
    if (r.formId && r.formId !== V.formId) { V.file = { r, name: file.name, formName: r.formName }; H.renderMain(); return; }
    loadFile(r, file.name);
  });
  return true;
}

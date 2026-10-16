// Word templates on a record: the Export ▾ menu (PDF, then each of the form's Word templates),
// the Word templates pop-up (add, check, rename, replace, download, delete), and filling one in.
// The filling itself is docxtpl.js; this file gives it the record (a "scope") and the form (a
// "schema" for checking). Anyone who can see a form can add templates to it; whoever added one,
// or an administrator, can change or delete it.
import { esc } from './ui.js';
import { fieldByName } from './fieldnames.js';
import { richBlocks } from './richtext.js';
import { watchTemplates, addTemplate, replaceTemplateFile, renameTemplate, deleteTemplate, templateBytes, getExportSettings, fileBlob } from './store.js';

// H: { store, view(), recById, formById, recTitle, itemName, valOf(f,rec,form), fmt(f,v), realName(uid),
//      stageName(form,rec), wfOn(form), parentsOf(formId), calcExpr(form,rec,expr), checkExpr(form,expr),
//      isAdmin(), toast, dirty(), exportPdf() }
let H = null;
const W = { formId: null, unsub: null, list: [], ready: false, menu: false, dlg: null };

export function initWordUI(helpers) {
  H = helpers;
  const inside = (e) => e.target.closest?.('#xw-root');
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-xw]');
    if (W.menu && !inside(e) && !(btn && btn.dataset.xw === 'menu')) closeMenu();
    if (W.menu && inside(e) && e.target.closest('[data-act]')) setTimeout(closeMenu, 0); // PDF: the app makes it
    if (!btn) return;
    e.stopPropagation();
    onAct(btn, e);
  }, true);
  document.addEventListener('input', (e) => { if (W.dlg && e.target.dataset?.xwi) { onInput(e.target); e.stopPropagation(); } }, true);
  document.addEventListener('change', (e) => { if (e.target.dataset?.xwFile !== undefined) { e.stopPropagation(); onFile(e.target); } }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (W.menu) { e.preventDefault(); e.stopPropagation(); closeMenu(); document.getElementById('pdf-btn')?.focus(); return; }
    if (W.dlg && !W.dlg.busy) { e.preventDefault(); e.stopPropagation(); W.dlg = null; paint(); document.getElementById('pdf-btn')?.focus(); }
  }, true);
  window.addEventListener('resize', () => { if (W.menu) placeMenu(); });
}

const root = () => {
  let r = document.getElementById('xw-root');
  if (!r) { r = document.createElement('div'); r.id = 'xw-root'; document.body.appendChild(r); }
  return r;
};
const norm = (s) => String(s || '').trim().toLowerCase();
const sing = (s) => norm(s).replace(/s$/, '');

/* ---------- watching the open record's form ---------- */
export function sync() {
  const v = H.view();
  const want = v.name === 'record' && v.recordId ? v.formId : null;
  if (want === W.formId) return;
  if (W.unsub) { W.unsub(); W.unsub = null; }
  Object.assign(W, { formId: want, list: [], ready: false, menu: false, dlg: null });
  paint();
  if (want) W.unsub = watchTemplates(want, (list) => { W.list = list; W.ready = true; if (W.menu || W.dlg) paint(); }, (e) => { console.warn('[formwright] Word templates', e?.code || e); W.list = []; W.ready = true; if (W.menu || W.dlg) paint(); });
}
export function stop() { if (W.unsub) W.unsub(); Object.assign(W, { formId: null, unsub: null, list: [], menu: false, dlg: null }); paint(); }

/** The record bar's button. */
export function exportButton(busy) {
  return `<button class="btn" data-xw="menu" id="pdf-btn" aria-haspopup="menu" aria-expanded="${W.menu}"${busy ? ' disabled' : ''} title="Download this record as a PDF or a Word document">${busy ? 'Working…' : 'Export'} <span aria-hidden="true">▾</span></button>`;
}

/* ---------- the menu ---------- */
function menuHTML() {
  const items = W.list.map((t) => `<button type="button" role="menuitem" class="xw-item" data-xw="run" data-id="${esc(t.id)}"><span class="xw-ic doc" aria-hidden="true">W</span><span class="grow">${esc(t.name)}<small>Word document${t.problems ? ` · ${t.problems} problem${t.problems === 1 ? '' : 's'}` : ''}</small></span></button>`).join('');
  return `<div class="xw-menu" role="menu" aria-label="Export">
    <button type="button" role="menuitem" class="xw-item" data-act="export-pdf"><span class="xw-ic pdf" aria-hidden="true">P</span><span class="grow">PDF<small>The standard layout</small></span></button>
    ${W.list.length ? `<div class="xw-sep" role="separator"></div>${items}` : !W.ready ? '<p class="xw-note">Loading Word templates…</p>' : ''}
    <div class="xw-sep" role="separator"></div>
    <button type="button" role="menuitem" class="xw-item" data-xw="manage"><span class="xw-ic" aria-hidden="true">⚙</span><span class="grow">Word templates…<small>${W.list.length ? 'Add, check or change them' : 'Add one made in Word'}</small></span></button>
  </div>`;
}
function placeMenu() {
  const b = document.getElementById('pdf-btn'), m = document.querySelector('#xw-root .xw-menu');
  if (!b || !m) return;
  const r = b.getBoundingClientRect(), w = Math.min(320, innerWidth - 16);
  m.style.width = w + 'px';
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  const below = r.bottom + 6, h = m.offsetHeight;
  m.style.top = (below + h > innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below) + 'px';
}
function openMenu() {
  if (H.dirty()) { H.toast('Save your changes first, so the export matches what’s saved.'); return; }
  W.menu = true; paint();
  document.getElementById('pdf-btn')?.setAttribute('aria-expanded', 'true');
  document.querySelector('#xw-root .xw-item')?.focus();
}
function closeMenu() { W.menu = false; paint(); document.getElementById('pdf-btn')?.setAttribute('aria-expanded', 'false'); }

/* ---------- the pop-up ---------- */
function paint() {
  const r = root();
  if (!W.menu && !W.dlg) { r.innerHTML = ''; return; }
  const keep = document.activeElement?.dataset?.xwi ? [document.activeElement.dataset.xwi, document.activeElement.selectionStart] : null;
  r.innerHTML = (W.menu ? menuHTML() : '') + (W.dlg ? dlgHTML() : '');
  if (W.menu) placeMenu();
  if (keep) { const i = r.querySelector(`[data-xwi="${keep[0]}"]`); if (i) { i.focus(); try { i.setSelectionRange(keep[1], keep[1]); } catch (e) { /* not text */ } } }
}
const mine = (t) => t.by === H.store.user?.uid || H.isAdmin();
function checkHTML(c, open) {
  if (!c) return '';
  const bad = c.tags.filter((t) => !t.ok);
  const errs = c.errors || [];
  const head = errs.length ? `<p class="xw-bad">This template can’t be used yet: ${esc(errs[0])}${errs.length > 1 ? ` (and ${errs.length - 1} more)` : ''}</p>`
    : bad.length ? `<p class="xw-warn">${bad.length} of ${c.tags.length} placeholder${c.tags.length === 1 ? '' : 's'} ${bad.length === 1 ? 'isn’t' : 'aren’t'} recognised. They’ll stay as typed in the document.</p>`
      : `<p class="xw-ok">✓ All ${c.tags.length} placeholder${c.tags.length === 1 ? '' : 's'} recognised.</p>`;
  const rows = [...errs.slice(1).map((e) => ({ text: '', ok: false, why: e })), ...c.tags.filter((t) => !t.ok), ...(open ? c.tags.filter((t) => t.ok) : [])];
  return `${head}${rows.length ? `<ul class="xw-tags">${rows.map((t) => `<li class="${t.ok ? 'ok' : 'bad'}"><code>${esc(t.text)}</code>${t.why ? `<span>${esc(t.why)}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
}
function dlgHTML() {
  const d = W.dlg, form = H.formById(W.formId);
  const p = d.pending;
  const list = W.list.map((t) => {
    const can = mine(t), armed = d.armed === t.id;
    const when = new Date(t.updatedAt || t.at || 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `<li class="xw-t">
      <div class="xw-row">${can && d.rename === t.id ? `<input class="in" data-xwi="rename" value="${esc(d.renameText)}" maxlength="120" aria-label="Template name"><button type="button" class="btn sm primary" data-xw="rename-save" data-id="${esc(t.id)}">Save</button><button type="button" class="btn sm ghost" data-xw="rename-cancel">Cancel</button>`
        : `<b class="grow">${esc(t.name)}</b>${can ? `<button type="button" class="btn sm ghost" data-xw="rename" data-id="${esc(t.id)}">Rename</button>` : ''}`}</div>
      <p class="help">Added by ${esc(t.byName || H.realName(t.by))} · ${esc(when)} · ${t.problems ? `<span class="xw-warnt">${t.problems} placeholder${t.problems === 1 ? '' : 's'} not recognised</span>` : `${t.tags || 0} placeholders`}</p>
      ${d.recheck?.id === t.id ? checkHTML(d.recheck.check, true) : ''}
      <div class="xw-acts">
        <button type="button" class="btn sm" data-xw="check" data-id="${esc(t.id)}"${d.busy ? ' disabled' : ''}>${d.recheck?.id === t.id ? 'Hide check' : 'Check'}</button>
        <button type="button" class="btn sm" data-xw="download" data-id="${esc(t.id)}">Download template</button>
        ${can ? `<label class="btn sm xw-file">Replace…<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-xw-file data-id="${esc(t.id)}" hidden></label>
        <button type="button" class="btn sm danger${armed ? ' armed' : ''}" data-xw="delete" data-id="${esc(t.id)}"${d.busy ? ' disabled' : ''}>${armed ? 'Tap again to delete' : 'Delete'}</button>` : ''}
      </div></li>`;
  }).join('');
  const pend = p ? `<div class="xw-pend">
      <h3>${p.replace ? `Replace “${esc(W.list.find((t) => t.id === p.replace)?.name || '')}”` : 'New template'}</h3>
      ${p.replace ? '' : `<label class="xw-l"><span>Name in the Export menu</span><input class="in" data-xwi="name" value="${esc(p.name)}" maxlength="120"></label>`}
      <p class="help">${esc(p.file.name)} · ${Math.max(1, Math.round(p.file.size / 1024))} KB</p>
      ${p.check ? checkHTML(p.check, p.all) : '<p class="help">Checking…</p>'}
      ${p.check && p.check.tags.some((t) => t.ok) ? `<button type="button" class="cm-lnk" data-xw="all">${p.all ? 'Hide the recognised ones' : `Show all ${p.check.tags.length}`}</button>` : ''}
      <div class="lv-dlgacts"><button type="button" class="btn ghost" data-xw="pend-cancel"${d.busy ? ' disabled' : ''}>Cancel</button><button type="button" class="btn primary" data-xw="pend-save"${d.busy || !p.check || p.check.errors.length || (!p.replace && !p.name.trim()) ? ' disabled' : ''}>${d.busy ? 'Saving…' : p.replace ? 'Replace' : 'Add template'}</button></div>
    </div>` : '';
  return `<div class="lv-scrim xw-scrim" data-xw="scrim"><div class="lv-dlg xw-dlg" role="dialog" aria-modal="true" aria-labelledby="xw-h" data-xw-stop="1">
    <div class="xw-top"><h2 id="xw-h">Word templates for ${esc(form?.name || 'this form')}</h2><button type="button" class="tk-x" data-xw="close" aria-label="Close">×</button></div>
    <p class="help">Make a document in Word and type field names in braces where values should go, like <code>{${esc(sampleField(form))}}</code>. Everyone who can see ${esc(form?.name || 'this form')} can use these from Export.</p>
    ${pend}
    ${W.list.length ? `<ul class="xw-list">${list}</ul>` : p ? '' : '<p class="xw-empty">No Word templates yet.</p>'}
    ${p ? '' : `<div class="xw-add"><label class="btn primary xw-file">Add a Word template…<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-xw-file hidden></label><a class="cm-lnk" href="${SAMPLE_URL}" download="Formwright quote template.docx">Sample template with every option</a></div>`}
  </div></div>`;
}
const SAMPLE_URL = '/word-template-sample.docx';
const sampleField = (form) => { const f = (form?.fields || []).find((x) => x.type !== 'heading'); return f ? f.label : 'Field name'; };

/* ---------- the form, for checking ---------- */
const SYS = new Set(['today', 'now', 'exported by', 'owner', 'created by', 'created', 'last updated', 'item name', 'form name', 'stage', 'company name', 'title']);
const childForm = (form, name) => (form.children || []).map((c) => H.formById(c.formId)).find((cf) => cf && (norm(cf.name) === norm(name) || sing(cf.name) === sing(name) || norm(H.itemName(cf)) === norm(name)));
const formMatch = (f, name) => norm(name) === 'parent' || norm(f.name) === norm(name) || sing(f.name) === sing(name) || norm(H.itemName(f)) === norm(name);
function splitName(name) { const i = String(name).indexOf(':'); return i > 0 ? [name.slice(0, i).trim(), name.slice(i + 1).trim()] : null; }
export function formSchema(form, depth = 0) {
  const linkedSchema = (pre) => {
    if (depth > 4) return null;
    const rf = fieldByName(form, pre);
    if (rf && rf.type === 'relation') { const lf = H.formById(rf.relForm); return lf ? formSchema(lf, depth + 1) : null; }
    const pf = H.parentsOf(form.id).find((f) => formMatch(f, pre));
    return pf ? formSchema(pf, depth + 1) : null;
  };
  return {
    has(name) {
      const f = fieldByName(form, name);
      if (f && f.type !== 'heading') return true;
      const sp = splitName(name);
      if (sp) { const s = linkedSchema(sp[0]); return !!s && s.has(sp[1]); }
      return SYS.has(norm(name));
    },
    list(name) { const cf = childForm(form, name); return cf ? formSchema(cf, depth + 1) : null; },
    formula(expr) { return H.checkExpr(form, expr); },
    image(name) {
      const f = fieldByName(form, name);
      if (f) return ['image', 'signature', 'file'].includes(f.type);
      const sp = splitName(name);
      if (sp) { const s = linkedSchema(sp[0]); return !!s && s.image(sp[1]); }
      return norm(name) === 'logo';
    },
  };
}

/* ---------- the record, for filling in ---------- */
function picture(v) {
  return (async () => {
    const { dataUrlBytes, photoBytes } = await import('./pdfexport.js');
    if (typeof v === 'string') {
      const b = dataUrlBytes(v);
      if (!b) return null;
      if (b[0] === 0x89 && b[1] === 0x50) return { bytes: b, type: 'png' };
      return photoBytes(new Blob([b]));
    }
    if (v && (v.path || v.url)) {
      if (v.type && !/^image\//.test(v.type)) return null;
      return photoBytes(await fileBlob(v));
    }
    return null;
  })();
}
const EMPTY = { get: () => ({ type: 'text', v: '', text: '' }), list: () => [], calc: () => ({ v: null }), image: () => Promise.resolve(null) };
export function recordScope(rec, form, ctx, depth = 0) {
  const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fieldVal = (f) => {
    let v = H.valOf(f, rec, form);
    let text = '';
    try { text = f.type === 'rating' ? (v == null || v === '' ? '' : `${v} of ${f.max || 5}`) : f.type === 'textarea' ? String(v ?? '') : H.fmt(f, v); } catch (e) { text = String(v ?? ''); }
    if (f.type === 'relation') v = text;
    if (f.type === 'checkbox') v = !!v;
    const blocks = f.type === 'textarea' && !f.plain ? richBlocks(rec.values, f.id) : null;
    return { type: f.type === 'formula' ? (f.format === 'currency' ? 'currency' : typeof v === 'number' ? 'number' : 'text') : f.type, v, text, blocks, currency: f.currency };
  };
  const linked = (pre) => {
    if (depth > 4) return null;
    const rf = fieldByName(form, pre);
    if (rf && rf.type === 'relation') { const r = H.recById(rec.values?.[rf.id]); const lf = r && H.formById(r.formId); return r && lf ? recordScope(r, lf, ctx, depth + 1) : EMPTY; }
    const p = rec.parentId ? H.recById(rec.parentId) : null, pf = p && H.formById(p.formId);
    if (p && pf && formMatch(pf, pre)) return recordScope(p, pf, ctx, depth + 1);
    if (!p && H.parentsOf(form.id).some((f) => formMatch(f, pre))) return EMPTY;
    return null;
  };
  const sys = (name) => {
    const me = H.store.user?.uid;
    switch (norm(name)) {
      case 'today': { const d = new Date(); return { type: 'sysdate', v: d, text: shortDate(d) }; }
      case 'now': { const d = new Date(); return { type: 'systime', v: d, text: d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }; }
      case 'exported by': return { type: 'text', v: H.realName(me), text: H.realName(me) };
      case 'owner': return { type: 'text', v: H.realName(rec.ownerId), text: H.realName(rec.ownerId) };
      case 'created by': { const n = H.realName(rec.createdBy || rec.ownerId); return { type: 'text', v: n, text: n }; }
      case 'created': return rec.createdAt ? { type: 'sysdate', v: new Date(rec.createdAt), text: shortDate(rec.createdAt) } : { type: 'text', v: '', text: '' };
      case 'last updated': return rec.updatedAt ? { type: 'sysdate', v: new Date(rec.updatedAt), text: shortDate(rec.updatedAt) } : { type: 'text', v: '', text: '' };
      case 'item name': return { type: 'text', v: H.itemName(form), text: H.itemName(form) };
      case 'form name': return { type: 'text', v: form.name, text: form.name };
      case 'stage': { const s = H.wfOn(form) && rec.stage ? H.stageName(form, rec) : ''; return { type: 'text', v: s, text: s }; }
      case 'company name': return { type: 'text', v: ctx.brand.companyName || '', text: ctx.brand.companyName || '' };
      case 'title': { const t = H.recTitle(rec, form); return { type: 'text', v: t, text: t }; }
    }
    return null;
  };
  return {
    get(name) {
      const f = fieldByName(form, name);
      if (f && f.type !== 'heading') return fieldVal(f);
      const sp = splitName(name);
      if (sp) { const s = linked(sp[0]); if (s) return s.get(sp[1]); }
      return sys(name);
    },
    list(name) {
      const cf = childForm(form, name);
      if (!cf) return null;
      return H.store.records.filter((r) => r.parentId === rec.id && r.formId === cf.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((r) => recordScope(r, cf, ctx, depth + 1));
    },
    calc(expr) { return H.calcExpr(form, rec, expr); },
    image(name) {
      const f = fieldByName(form, name);
      if (f) return ['image', 'signature', 'file'].includes(f.type) ? picture(rec.values?.[f.id]) : undefined;
      const sp = splitName(name);
      if (sp) { const s = linked(sp[0]); if (s) return s.image(sp[1]); }
      if (norm(name) === 'logo') return picture(ctx.brand.logo || null);
      return undefined;
    },
  };
}

/* ---------- actions ---------- */
async function onAct(b, e) {
  const a = b.dataset.xw, id = b.dataset.id;
  if (a === 'menu') { if (W.menu) closeMenu(); else openMenu(); return; }
  if (a === 'manage') { closeMenu(); W.dlg = { pending: null, armed: null, rename: null, busy: false }; paint(); root().querySelector('.xw-dlg .xw-file')?.focus(); return; }
  if (a === 'run') { closeMenu(); run(W.list.find((t) => t.id === id)); return; }
  if (!W.dlg) return;
  const d = W.dlg;
  if (a !== 'delete' && d.armed) d.armed = null;
  if (a === 'scrim' && (e.target !== b || d.busy)) return; // a click inside the pop-up, not on the shade around it
  if (a === 'close' || a === 'scrim') { W.dlg = null; paint(); document.getElementById('pdf-btn')?.focus(); return; }
  if (a === 'all') { d.pending.all = !d.pending.all; paint(); return; }
  if (a === 'pend-cancel') { d.pending = null; paint(); return; }
  if (a === 'pend-save') { savePending(); return; }
  if (a === 'rename') { const t = W.list.find((x) => x.id === id); d.rename = id; d.renameText = t?.name || ''; paint(); root().querySelector('[data-xwi="rename"]')?.select(); return; }
  if (a === 'rename-cancel') { d.rename = null; paint(); return; }
  if (a === 'rename-save') {
    const name = String(d.renameText || '').trim();
    if (!name) { H.toast('Give it a name.'); return; }
    try { await renameTemplate(id, name); d.rename = null; paint(); H.toast('Renamed'); } catch (e) { console.error(e); H.toast(denied(e) || 'Renaming didn’t work. Try again.'); }
    return;
  }
  if (a === 'delete') {
    if (d.armed !== id) { d.armed = id; paint(); root().querySelector(`[data-xw="delete"][data-id="${CSS.escape(id)}"]`)?.focus(); return; }
    d.armed = null; d.busy = true; paint();
    const t = W.list.find((x) => x.id === id);
    try { await deleteTemplate(t); H.toast(`Deleted “${t.name}”`); } catch (e) { console.error(e); H.toast(denied(e) || 'Deleting didn’t work. Try again.'); }
    d.busy = false; paint();
    return;
  }
  if (a === 'download') {
    const t = W.list.find((x) => x.id === id);
    try { save(await templateBytes(t), t.name.replace(/\.docx$/i, '') + '.docx'); } catch (e) { console.error(e); H.toast('Couldn’t download it. Check your connection and try again.'); }
    return;
  }
  if (a === 'check') {
    if (d.recheck?.id === id) { d.recheck = null; paint(); return; }
    const t = W.list.find((x) => x.id === id);
    d.busy = true; paint();
    try { const { checkDocx } = await import('./docxtpl.js'); d.recheck = { id, check: await checkDocx(await templateBytes(t), formSchema(H.formById(W.formId))) }; }
    catch (e) { console.error(e); H.toast(e.message && /Word file/.test(e.message) ? e.message : 'Couldn’t check it. Try again.'); }
    d.busy = false; paint();
  }
}
const denied = (e) => (e?.code === 'permission-denied' || e?.code === 'storage/unauthorized' ? 'Not allowed: the latest security rules may not be deployed yet, or you can’t change this one.' : '');
function onInput(t) {
  if (t.dataset.xwi === 'name' && W.dlg?.pending) { W.dlg.pending.name = t.value; const b = root().querySelector('[data-xw="pend-save"]'); if (b) b.disabled = !t.value.trim() || !W.dlg.pending.check || W.dlg.pending.check.errors.length > 0; }
  if (t.dataset.xwi === 'rename' && W.dlg) W.dlg.renameText = t.value;
}
async function onFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file || !W.dlg) return;
  if (!/\.docx$/i.test(file.name)) { H.toast('Choose a Word file (.docx). Older .doc files: open in Word and Save As .docx.'); return; }
  if (file.size > 10 * 1024 * 1024) { H.toast('That file is over 10 MB. Make the pictures in it smaller and try again.'); return; }
  const p = W.dlg.pending = { file, name: file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim(), check: null, replace: input.dataset.id || null, all: false };
  paint();
  try {
    const { checkDocx } = await import('./docxtpl.js');
    p.check = await checkDocx(new Uint8Array(await file.arrayBuffer()), formSchema(H.formById(W.formId)));
  } catch (e) {
    console.error(e);
    p.check = { tags: [], errors: [/Word file/.test(e.message) ? e.message : 'Formwright couldn’t read that file.'] };
  }
  if (W.dlg?.pending === p) { paint(); root().querySelector(p.replace ? '[data-xw="pend-save"]' : '[data-xwi="name"]')?.focus(); }
}
async function savePending() {
  const d = W.dlg, p = d?.pending;
  if (!p || !p.check || p.check.errors.length || d.busy) return;
  const summary = { tags: p.check.tags.length, problems: p.check.tags.filter((t) => !t.ok).length };
  d.busy = true; paint();
  try {
    if (p.replace) { await replaceTemplateFile(W.list.find((t) => t.id === p.replace), p.file, summary); H.toast('Template replaced'); }
    else { await addTemplate(W.formId, p.file, p.name.trim(), summary); H.toast(`Added “${p.name.trim()}”. It’s in Export now.`); }
    d.pending = null;
  } catch (e) { console.error(e); H.toast(denied(e) || 'Saving the template didn’t work. Check your connection and try again.'); }
  d.busy = false; paint();
}
function save(bytes, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
let running = false;
async function run(t) {
  const v = H.view(), rec = H.recById(v.recordId), form = rec && H.formById(rec.formId);
  if (!t || !rec || !form || running) return;
  if (H.dirty()) { H.toast('Save your changes first, so the export matches what’s saved.'); return; }
  running = true; H.busy(true);
  try {
    const [{ fillDocx }, bytes, brand] = await Promise.all([import('./docxtpl.js'), templateBytes(t), getExportSettings()]);
    const cur = (form.fields || []).find((f) => f.type === 'currency')?.currency || 'CAD';
    const out = await fillDocx(bytes, recordScope(rec, form, { brand }), { currency: cur });
    const name = `${safeName(t.name)} - ${safeName(H.recTitle(rec, form))}.docx`;
    save(out.bytes, name);
    const notes = [];
    if (out.missing.length) notes.push(`${out.missing.length} placeholder${out.missing.length === 1 ? ' wasn’t' : 's weren’t'} recognised (${out.missing.slice(0, 3).map((m) => '{' + m + '}').join(', ')}${out.missing.length > 3 ? '…' : ''})`);
    if (out.pictures) notes.push(`${out.pictures} picture${out.pictures === 1 ? '' : 's'} couldn’t be included`);
    if (out.errors.length) notes.push(out.errors[0]);
    H.toast(`Downloaded ${name}${notes.length ? '. ' + notes.join('. ') + '.' : ''}`, notes.length ? { duration: 9000 } : undefined);
  } catch (e) {
    console.error('[formwright] Word export', e);
    H.toast(e.template ? `The template has a problem: ${e.template[0]}` : /Word file/.test(e.message || '') ? e.message : 'Couldn’t make the Word document. Check your connection and try again.', { duration: 9000 });
  } finally { running = false; H.busy(false); }
}

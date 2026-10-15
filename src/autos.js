// Administration → Automations: the list and the editor. Automations run on the server
// (Cadence functions/automate.js); here admins set them up, test them on a record and read
// their run history. Wording and checks: autologic.js. Conditions reuse the rule builder.
import { store, saveAutomation, setAutomationOn, deleteAutomation, loadRuns, testAutomation } from './store.js';
import { esc, uid, clone, toast, badge, itemName } from './ui.js';
import { opsFor, opOf } from './rules.js';
import { condsHTML, rulesClick, rulesChange, rulesCtx } from './rulesui.js';
import { TRIGGERS, ACTS, SET_MODES, NO_SET, MAX_ACTS, blankAutomation, blankAct, autoText, triggerText, checkAutomation } from './autologic.js';

let H = { formById: null, parentsOf: null, recordsOf: null, recTitle: null, go: null, renderMain: null, forms: () => [] };
export function initAutos(helpers) { H = { ...H, ...helpers }; }

const AM = { id: null, draft: null, dirty: false, busy: false, armed: false, problems: null, runs: null, runsBusy: false, test: { recordId: '', busy: false, out: null, err: null }, leaveArmed: false };
const people = () => [...store.users].map((u) => ({ id: u.id, name: store.profiles[u.id]?.displayName || u.displayName || (u.email || '').split('@')[0] || 'Unnamed', email: u.email || '' })).sort((a, b) => a.name.localeCompare(b.name));
const personName = (id) => people().find((p) => p.id === id)?.name || 'someone';
const ctxText = { formById: (id) => H.formById(id), parentsOf: (id) => H.parentsOf(id), person: personName };
const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fieldsOf = (f, pred = () => true) => (f?.fields || []).filter((x) => x.type !== 'heading' && pred(x));

export const isDirty = (view) => view.name === 'automation' && !!AM.draft && AM.dirty && !AM.leaveArmed;

/* ---------- the list ---------- */
export function viewAutomations() {
  const list = store.automations;
  const err = store.automationsError;
  const cards = list.map((a) => {
    const f = H.formById(a.formId);
    return `<div class="fcard am-card${a.on ? '' : ' off'}">${f ? badge(f, 1) : '<span class="badge">?</span>'}<div class="info"><b>${esc(a.name || 'Untitled automation')}</b><span class="help am-say">${esc(autoText(a, ctxText))}</span>
      <div class="tags"><span class="chip">${esc(f ? f.name : 'Deleted form')}</span>${a.on ? '' : '<span class="chip warn">Off</span>'}</div></div>
      <div class="ctl"><label class="switch"><input type="checkbox" data-am-on="${esc(a.id)}"${a.on ? ' checked' : ''} aria-label="${esc(a.name)} on or off"><span class="tr"></span><span>${a.on ? 'On' : 'Off'}</span></label>
      <button class="btn sm primary" data-act="am-edit" data-id="${esc(a.id)}">Edit</button></div></div>`;
  }).join('');
  return `<div class="head"><div class="ttl"><div><h1>Automations</h1><p class="sub">“When this happens, do that.” Automations run on the server, whatever changes a record: someone on a phone, an import, Set field or another automation, and at 7:00 a.m. for dates. Only administrators see this page.</p></div></div>
    <div class="actions"><button class="btn primary" data-act="am-new">+ New automation</button></div></div>
    ${err ? `<div class="panel am-warn" role="alert">${err === 'permission-denied' ? 'Automations need the latest Cadence security rules and functions. Deploy them from Cloud Shell (see the install steps).' : 'Couldn’t load automations. Check your connection.'}</div>` : ''}
    ${list.length ? `<div class="panel flist">${cards}</div>` : `<div class="panel empty"><h2>No automations yet</h2><p>For example: when an invoice’s Status becomes Approved, create a Cadence task to send it; or 3 days before a project’s Due date, email its owner.</p><button class="btn primary" data-act="am-new">+ New automation</button></div>`}`;
}

/* ---------- the editor ---------- */
export function openAutomation(id, formId) {
  const a = id && store.automations.find((x) => x.id === id);
  AM.id = a ? a.id : uid('au');
  AM.draft = a ? clone(a) : blankAutomation(formId || H.forms()[0]?.id || '');
  AM.dirty = !a; AM.busy = false; AM.armed = false; AM.problems = null; AM.leaveArmed = false;
  AM.runs = null; AM.test = { recordId: '', busy: false, out: null, err: null };
  H.go({ name: 'automation', autoId: AM.id });
  if (a) refreshRuns();
}
async function refreshRuns() {
  if (!store.automations.some((x) => x.id === AM.id)) { AM.runs = []; return; }
  AM.runsBusy = true; H.renderMain();
  try { AM.runs = await loadRuns(AM.id); } catch (e) { console.error(e); AM.runs = null; }
  AM.runsBusy = false; H.renderMain();
}
const formOf = () => H.formById(AM.draft?.formId);
const fakeForm = () => ({ ...(formOf() || { id: '', fields: [] }), isNew: false, rules: [AM.draft] });
function dirty() { AM.dirty = true; AM.problems = null; const n = document.getElementById('am-dirty'); if (n) n.textContent = 'Unsaved changes'; }

function valueControl(f, v, attrs) {
  if (!f) return '';
  const a = attrs;
  if (f.type === 'select' || f.type === 'radio') return `<select class="in am-v" ${a}><option value=""></option>${(f.options || []).map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.type === 'multiselect') { const have = Array.isArray(v) ? v : []; return `<span class="rl-many">${(f.options || []).map((o) => `<label class="rl-chk"><input type="checkbox" ${a} data-many value="${esc(o)}"${have.includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}</span>`; }
  if (f.type === 'checkbox') return `<select class="in am-v" ${a}><option value="true"${v === true ? ' selected' : ''}>Yes</option><option value="false"${v === false ? ' selected' : ''}>No</option></select>`;
  if (['number', 'decimal', 'currency', 'percent', 'rating', 'range'].includes(f.type)) return `<input class="in am-v am-num" type="number" step="any" ${a} value="${esc(v ?? '')}">`;
  if (f.type === 'date') return `<input class="in am-v" type="date" ${a} value="${esc(v ?? '')}">`;
  if (f.type === 'datetime') return `<input class="in am-v" type="datetime-local" ${a} value="${esc(v ?? '')}">`;
  if (f.type === 'time') return `<input class="in am-v" type="time" ${a} value="${esc(v ?? '')}">`;
  if (f.type === 'relation') { const tf = H.formById(f.relForm); const rs = tf ? H.recordsOf(tf.id).map((r) => ({ r, t: H.recTitle(r, tf) })).sort((x, y) => x.t.localeCompare(y.t)).slice(0, 500) : []; return `<select class="in am-v" ${a}><option value=""></option>${rs.map(({ r, t }) => `<option value="${esc(r.id)}"${r.id === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
  return `<input class="in am-v" type="text" ${a} value="${esc(v ?? '')}" maxlength="500">`;
}

function triggerHTML(a, form) {
  const t = a.trigger || {};
  const sel = `<select class="in am-sel" data-am="ttype" aria-label="When">${TRIGGERS.map((x) => `<option value="${x.key}"${x.key === t.type ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
  let more = '';
  if (t.type === 'changed') {
    const f = fieldsOf(form).find((x) => x.id === t.field);
    more = `<div class="am-row"><span class="am-lab">Which field</span><select class="in am-sel" data-am="tfield"><option value="">Any field</option>${fieldsOf(form, (x) => !['formula'].includes(x.type)).map((x) => `<option value="${x.id}"${x.id === t.field ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      ${f ? `<select class="in am-sel" data-am="top" aria-label="Changes to"><option value="">changes to anything</option>${opsFor(f).map((o) => `<option value="${o.key}"${o.key === t.op ? ' selected' : ''}>becomes: ${esc(o.label)}</option>`).join('')}</select>${t.op && opOf(f, t.op)?.value ? valueControl(f, t.value, 'data-am="tval"') : ''}` : ''}</div>`;
  } else if (t.type === 'date') {
    const ds = fieldsOf(form, (x) => x.type === 'date' || x.type === 'datetime');
    more = `<div class="am-row"><select class="in am-sel" data-am="trel" aria-label="When"><option value="on"${!t.rel || t.rel === 'on' ? ' selected' : ''}>On the day of</option><option value="before"${t.rel === 'before' ? ' selected' : ''}>Days before</option><option value="after"${t.rel === 'after' ? ' selected' : ''}>Days after</option></select>
      ${t.rel === 'before' || t.rel === 'after' ? `<input class="in am-num" type="number" min="0" max="365" step="1" data-am="tdays" value="${esc(t.days ?? 1)}" aria-label="Days">` : ''}
      <select class="in am-sel" data-am="tdate" aria-label="Date field"><option value="">Pick a date field…</option>${ds.map((x) => `<option value="${x.id}"${x.id === t.dateField ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <p class="help">Checked every morning at 7:00 a.m. (Toronto time), once per record per day.${ds.length ? '' : ' This form has no date fields yet.'}</p>`;
  } else if (t.type === 'emailed') more = '<p class="help">Runs after someone sends this record with Email PDF.</p>';
  else if (t.type === 'stage') {
    const st = form.workflow?.on ? form.workflow.stages || [] : [];
    more = st.length ? `<div class="am-row"><span class="am-lab">To</span><select class="in am-sel" data-am="tstage"><option value="">any stage</option>${st.map((x) => `<option value="${esc(x.id)}"${x.id === t.to ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : '<p class="help">This form has no workflow yet (form designer → Workflow).</p>';
  }
  else more = '<p class="help">Runs once, when the record is first saved (by hand, an import, or another automation).</p>';
  return `<div class="am-row"><span class="am-lab">When ${esc((form ? itemName(form) : 'a record').toLowerCase())}</span>${sel}</div>${more}`;
}

function setRows(x, ai, tf, srcForm) {
  const rows = (x.sets || []).map((s, si) => {
    const f = fieldsOf(tf).find((g) => g.id === s.field);
    const at = `data-a="${ai}" data-s="${si}"`;
    const modes = SET_MODES.filter((m) => m.key !== 'today' || (f && ['date', 'datetime', 'time'].includes(f.type)));
    return `<div class="am-set"><select class="in am-sel" ${at} data-ama="sfield" aria-label="Field"><option value="">Pick a field…</option>${fieldsOf(tf, (g) => !NO_SET.has(g.type)).map((g) => `<option value="${g.id}"${g.id === s.field ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
      ${f ? `<select class="in am-sel" ${at} data-ama="smode" aria-label="How">${modes.map((m) => `<option value="${m.key}"${m.key === (s.mode || 'value') ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      ${(s.mode || 'value') === 'value' ? valueControl(f, s.value, `${at} data-ama="sval"`) : s.mode === 'copy' ? `<select class="in am-sel" ${at} data-ama="sfrom" aria-label="Copy from"><option value="">Pick a field of this ${esc(itemName(srcForm).toLowerCase())}…</option>${fieldsOf(srcForm, (g) => g.type === f.type || (g.type === 'formula' && ['number', 'decimal', 'currency', 'percent', 'text'].includes(f.type))).map((g) => `<option value="${g.id}"${g.id === s.from ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>` : ''}` : ''}
      <button type="button" class="ibtn rl-x" data-act="am-dels" ${at} aria-label="Remove">✕</button></div>`;
  }).join('');
  return `${rows}<button type="button" class="btn sm ghost" data-act="am-adds" data-a="${ai}">+ Field</button>`;
}

function actHTML(x, ai, form) {
  const n = (AM.draft.acts || []).length;
  const head = `<div class="am-acth"><b>Then</b><select class="in am-sel" data-a="${ai}" data-ama="do" aria-label="Action ${ai + 1}">${ACTS.map((k) => `<option value="${k.key}"${k.key === x.do ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}</select><span class="grow"></span>
    <button type="button" class="ibtn" data-act="am-movea" data-a="${ai}" data-dir="-1" aria-label="Move up"${ai === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ibtn" data-act="am-movea" data-a="${ai}" data-dir="1" aria-label="Move down"${ai === n - 1 ? ' disabled' : ''}>↓</button>
    <button type="button" class="ibtn rl-x" data-act="am-dela" data-a="${ai}" aria-label="Remove this action">✕</button></div>`;
  const at = `data-a="${ai}"`;
  const parents = H.parentsOf(form?.id || '') || [];
  let body = '';
  if (x.do === 'set') {
    const tgt = x.target === 'parent' ? 'p:' + (x.parentForm || '') : 'self';
    const tf = x.target === 'parent' ? H.formById(x.parentForm) : form;
    body = `<div class="am-row"><span class="am-lab">On</span><select class="in am-sel" ${at} data-ama="target"><option value="self"${tgt === 'self' ? ' selected' : ''}>this ${esc(itemName(form || {}).toLowerCase())}</option>${parents.map((p) => `<option value="p:${p.id}"${tgt === 'p:' + p.id ? ' selected' : ''}>its parent ${esc(itemName(p).toLowerCase())}</option>`).join('')}</select></div>
      ${tf ? setRows(x, ai, tf, form) : ''}`;
  } else if (x.do === 'task') {
    body = `<label class="am-f"><span class="am-lab">Task title</span><input class="in" ${at} data-ama="title" value="${esc(x.title || '')}" maxlength="300"></label>
      <label class="am-f"><span class="am-lab">Notes</span><textarea class="in" rows="2" ${at} data-ama="notes" maxlength="5000">${esc(x.notes || '')}</textarea></label>
      <div class="am-row"><span class="am-lab">For</span><select class="in am-sel" ${at} data-ama="assign"><option value="owner"${x.assign === 'owner' ? ' selected' : ''}>the record’s owner</option><option value="actor"${x.assign === 'actor' ? ' selected' : ''}>whoever made the change</option><option value="person"${x.assign === 'person' ? ' selected' : ''}>a specific person</option></select>
        ${x.assign === 'person' ? `<select class="in am-sel" ${at} data-ama="person"><option value="">Pick someone…</option>${people().map((p) => `<option value="${p.id}"${p.id === x.person ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
        <span class="am-lab">Due in</span><input class="in am-num" type="number" min="0" max="365" ${at} data-ama="dueDays" value="${esc(x.dueDays ?? '')}" placeholder="—" aria-label="Due in days"><span class="help">days (empty: no due date)</span></div>
      <p class="help">The task links to the record. Whoever gets it needs Cadence switched on (Users) to see it.</p>`;
  } else if (x.do === 'email') {
    const to = x.to || {};
    const ef = fieldsOf(form, (g) => g.type === 'email');
    const chk = (attr, val, on, label) => `<label class="rl-chk"><input type="checkbox" ${at} data-ama="${attr}" value="${esc(val)}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    body = `<div class="am-f"><span class="am-lab">To</span><span class="rl-many">${ef.map((g) => chk('tofield', g.id, (to.fields || []).includes(g.id), g.label)).join('')}
        ${parents.flatMap((p) => fieldsOf(p, (g) => g.type === 'email').map((g) => chk('topfield', g.id, (to.parentFields || []).includes(g.id), `${itemName(p)} › ${g.label}`))).join('')}
        ${chk('toowner', '1', !!to.owner, 'The record’s owner')}</span>
        <details class="am-people"><summary>People${(to.people || []).length ? ` (${to.people.length})` : ''}</summary><span class="rl-many">${people().filter((p) => p.email).map((p) => chk('toperson', p.id, (to.people || []).includes(p.id), p.name)).join('')}</span></details>
        <input class="in" ${at} data-ama="toaddr" value="${esc(to.addresses || '')}" placeholder="Other addresses, separated by commas"></div>
      <label class="am-f"><span class="am-lab">Subject</span><input class="in" ${at} data-ama="subject" value="${esc(x.subject || '')}" maxlength="200"></label>
      <label class="am-f"><span class="am-lab">Message</span><textarea class="in" rows="5" ${at} data-ama="message" maxlength="10000">${esc(x.message || '')}</textarea></label>
      <label class="switch"><input type="checkbox" ${at} data-ama="pdf"${x.pdf ? ' checked' : ''}><span class="tr"></span><span>Attach the record’s PDF</span></label>
      <p class="help">Sent from the company Gmail, like Email PDF, and listed under the record’s Sent emails. The PDF uses each section’s standard columns.</p>`;
  } else if (x.do === 'child') {
    const kids = (form?.children || []).map((c) => H.formById(c.formId)).filter((cf) => cf && cf.id !== form.id);
    const cf = H.formById(x.formId);
    body = `<div class="am-row"><span class="am-lab">Create</span><select class="in am-sel" ${at} data-ama="cform"><option value="">Pick a child form…</option>${kids.map((k) => `<option value="${k.id}"${k.id === x.formId ? ' selected' : ''}>${esc(itemName(k))}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" ${at} data-ama="ccopy"${x.copy ? ' checked' : ''}><span class="tr"></span><span>Copy matching fields</span></label></div>
      ${cf ? `<p class="help">Under this ${esc(itemName(form).toLowerCase())}, owned by its owner. Also set:</p>${setRows(x, ai, cf, form)}` : ''}`;
  }
  return `<div class="panel am-act">${head}${body}</div>`;
}

export function viewAutomation() {
  const a = AM.draft;
  if (!a) return '<div class="panel empty"><p>Pick an automation from the list.</p></div>';
  const form = formOf();
  const exists = store.automations.some((x) => x.id === AM.id);
  const forms = H.forms();
  const recs = form ? H.recordsOf(form.id).map((r) => ({ r, t: H.recTitle(r, form) })).sort((x, y) => x.t.localeCompare(y.t)).slice(0, 500) : [];
  const ctx = form ? rulesCtx(fakeForm()) : null;
  const t = AM.test;
  return `<div class="am-ed">
    <div class="crumbs"><button data-act="nav-automations">Automations</button><span>›</span><span>${exists ? esc(a.name || 'Untitled') : 'New automation'}</span></div>
    <div class="head"><div class="ttl"><div style="flex:1;min-width:0"><input class="title-in" data-am="name" value="${esc(a.name || '')}" placeholder="Name, e.g. Send approved invoices" aria-label="Automation name" maxlength="120"></div></div>
      <div class="actions"><label class="switch"><input type="checkbox" data-am="on"${a.on ? ' checked' : ''}><span class="tr"></span><span>${a.on ? 'On' : 'Off'}</span></label></div></div>
    <p class="am-sentence">${esc(autoText(a, ctxText))}</p>
    <div class="am-cols"><div class="am-main">
    <section class="panel am-sec"><h2 class="dz-h">Form</h2><select class="in am-sel" data-am="form" aria-label="Form"><option value="">Pick a form…</option>${forms.map((f) => `<option value="${f.id}"${f.id === a.formId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></section>
    ${form ? `<section class="panel am-sec"><h2 class="dz-h">When</h2>${triggerHTML(a, form)}</section>
    <section class="panel am-sec am-conds">${condsHTML(ctx, a, 0, { label: 'Only if', empty: 'No conditions: it runs every time the “when” happens.' })}</section>
    <section class="am-acts">${(a.acts || []).map((x, i) => actHTML(x, i, form)).join('')}
      ${(a.acts || []).length < MAX_ACTS ? `<button type="button" class="btn" data-act="am-adda">+ Action</button>` : ''}</section>
    <details class="panel am-sec am-tips"><summary>Fields in titles, subjects and messages</summary><p class="help">Type a field’s name in braces: <code>{Status}</code>, <code>{Total}</code>. A parent’s field: <code>{${esc(itemName((H.parentsOf(form.id) || [])[0] || { name: 'Client' }))} › Name}</code>. Also <code>{Title}</code>, <code>{Item}</code>, <code>{Company}</code>, <code>{Date}</code>.</p></details>` : ''}
    ${AM.problems && AM.problems.length ? `<div class="panel am-warn" role="alert"><b>Before saving</b><ul>${AM.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <aside class="am-side">
      <section class="panel am-sec"><h2 class="dz-h">Test run</h2><p class="help">See what it would do to one record. Nothing is changed or sent.</p>
        ${form ? `<select class="in" data-am="trec" aria-label="Record to test"><option value="">Pick a ${esc(itemName(form).toLowerCase())}…</option>${recs.map(({ r, t: tt }) => `<option value="${esc(r.id)}"${r.id === t.recordId ? ' selected' : ''}>${esc(tt)}</option>`).join('')}</select>
        <button type="button" class="btn" data-act="am-test"${t.busy || !t.recordId ? ' disabled' : ''}>${t.busy ? 'Working it out…' : 'Test run'}</button>` : ''}
        ${t.err ? `<p class="err">${esc(t.err)}</p>` : ''}
        ${t.out ? `<div class="am-out"><p><b>${esc(t.out.title)}</b>: ${t.out.holds ? 'the conditions hold.' : '<b>the conditions don’t hold</b>, so it wouldn’t run.'}${t.out.due === false ? ' Its date isn’t today.' : t.out.due ? ' Its date is today.' : ''}</p><ul>${t.out.steps.map((s) => `<li class="${s.kind === 'skip' ? 'muted' : ''}">${esc(s.text)}</li>`).join('') || '<li>Nothing to do.</li>'}</ul></div>` : ''}
      </section>
      <section class="panel am-sec"><div class="am-acth"><h2 class="dz-h">Run history</h2><span class="grow"></span>${exists ? `<button type="button" class="btn sm ghost" data-act="am-runs"${AM.runsBusy ? ' disabled' : ''}>Refresh</button>` : ''}</div>
        ${!exists ? '<p class="help">Save it to start a history.</p>' : AM.runs == null ? `<p class="help">${AM.runsBusy ? 'Loading…' : 'Couldn’t load the history.'}</p>` : AM.runs.length ? `<ul class="am-runs">${AM.runs.map((r) => `<li class="${r.ok ? '' : 'bad'}"><span class="am-rw">${esc(when(r.at))}</span> ${r.recordId && r.title ? `<button type="button" class="au-link" data-act="open-record" data-id="${esc(r.recordId)}">${esc(r.title)}</button>` : ''}<ul>${(r.did || []).map((d) => `<li>${esc(d)}</li>`).join('')}${(r.errors || []).map((d) => `<li class="err">${esc(d)}</li>`).join('')}</ul></li>`).join('')}</ul>` : '<p class="help">It hasn’t run yet.</p>'}
      </section>
    </aside></div>
    <div class="panel savebar" style="border-radius:var(--r)">${exists ? `<button class="btn danger${AM.armed ? ' armed' : ''}" data-act="am-del">${AM.armed ? 'Tap again to delete' : 'Delete'}</button>` : ''}<span class="grow" id="am-dirty">${AM.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <button class="btn ghost" data-act="am-back">${AM.dirty ? (AM.leaveArmed ? 'Tap again to discard' : 'Discard') : 'Done'}</button><button class="btn primary" data-act="am-save"${AM.busy ? ' disabled' : ''}>${AM.busy ? 'Saving…' : 'Save'}</button></div>
  </div>`;
}

/* ---------- editing ---------- */
const act = (el) => AM.draft?.acts?.[+el.dataset.a];
const field = (f, id) => fieldsOf(f).find((x) => x.id === id);
function parseVal(f, el) {
  if (!f) return el.value;
  if (f.type === 'checkbox') return el.value === 'true';
  if (['number', 'decimal', 'currency', 'percent', 'rating', 'range'].includes(f.type)) return el.value === '' ? '' : Number(el.value);
  return el.value;
}
function setTargetForm(x) { return x.do === 'child' ? H.formById(x.formId) : x.target === 'parent' ? H.formById(x.parentForm) : formOf(); }

export async function onClick(a, el) {
  if (!a.startsWith('am-')) return false;
  const d = AM.draft;
  switch (a) {
    case 'am-new': openAutomation(null, H.forms()[0]?.id); return true;
    case 'am-edit': openAutomation(el.dataset.id); return true;
    case 'am-back':
      if (AM.dirty && !AM.leaveArmed) { AM.leaveArmed = true; H.renderMain(); setTimeout(() => { if (AM.leaveArmed) { AM.leaveArmed = false; H.renderMain(); } }, 4000); return true; }
      AM.draft = null; AM.dirty = false; AM.leaveArmed = false; H.go({ name: 'automations' }); return true;
    case 'am-save': return save(), true;
    case 'am-del':
      if (!AM.armed) { AM.armed = true; H.renderMain(); setTimeout(() => { if (AM.armed) { AM.armed = false; H.renderMain(); } }, 5000); return true; }
      try { await deleteAutomation(AM.id); toast('Automation deleted'); AM.draft = null; AM.dirty = false; H.go({ name: 'automations' }); } catch (e) { toast('Couldn’t delete it. Check your connection.'); }
      return true;
    case 'am-adda': if ((d.acts || []).length < MAX_ACTS) { d.acts.push(blankAct('task')); dirty(); H.renderMain(); } return true;
    case 'am-dela': d.acts.splice(+el.dataset.a, 1); dirty(); H.renderMain(); return true;
    case 'am-movea': { const i = +el.dataset.a, j = i + +el.dataset.dir; if (j < 0 || j >= d.acts.length) return true; [d.acts[i], d.acts[j]] = [d.acts[j], d.acts[i]]; dirty(); H.renderMain(); return true; }
    case 'am-adds': { const x = act(el); if (!x) return true; (x.sets = x.sets || []).push({ field: '', mode: 'value', value: '' }); dirty(); H.renderMain(); return true; }
    case 'am-dels': { const x = act(el); if (!x) return true; x.sets.splice(+el.dataset.s, 1); dirty(); H.renderMain(); return true; }
    case 'am-runs': refreshRuns(); return true;
    case 'am-test': {
      if (!AM.test.recordId || AM.test.busy) return true;
      AM.test.busy = true; AM.test.err = null; AM.test.out = null; H.renderMain();
      try { AM.test.out = await testAutomation(JSON.parse(JSON.stringify(d)), AM.test.recordId); }
      catch (e) { console.error(e); AM.test.err = /not-found/.test(String(e?.code)) && !/record/.test(e?.message || '') ? 'Testing needs the latest Cadence functions. Deploy them first (see the install steps).' : e?.message || 'The test didn’t run. Try again.'; }
      AM.test.busy = false; H.renderMain(); return true;
    }
  }
  return false;
}

async function save() {
  const d = AM.draft;
  const form = formOf();
  AM.problems = checkAutomation(d, form, ctxText);
  if (AM.problems.length) { H.renderMain(); document.querySelector('.am-warn')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  AM.busy = true; H.renderMain();
  try {
    const out = { name: d.name.trim(), formId: d.formId, on: !!d.on, trigger: d.trigger, join: d.join || 'all', conds: d.conds || [], acts: d.acts };
    await saveAutomation(AM.id, out);
    AM.dirty = false; toast('Automation saved'); refreshRuns();
  } catch (e) {
    console.error(e);
    toast(e?.code === 'permission-denied' ? 'Firestore refused it. Deploy the latest Cadence security rules first (see the install steps).' : 'Saving failed. Check your connection and try again.');
  }
  AM.busy = false; H.renderMain();
}

export function onInput(t) {
  if (!AM.draft || !t.closest?.('.am-ed')) return false;
  const d = AM.draft;
  if (t.dataset.am === 'name') { d.name = t.value; dirty(); return true; }
  const x = t.dataset.a != null ? act(t) : null;
  if (x && ['title', 'notes', 'subject', 'message'].includes(t.dataset.ama)) { x[t.dataset.ama] = t.value; dirty(); return true; }
  if (x && t.dataset.ama === 'toaddr') { x.to = x.to || {}; x.to.addresses = t.value; dirty(); return true; }
  return false;
}

export function onChange(t) {
  if (t.dataset?.amOn) { setAutomationOn(t.dataset.amOn, t.checked).catch(() => toast('Couldn’t change it. Check your connection.')); return true; }
  if (!AM.draft || !t.closest?.('.am-ed')) return false;
  if (t.closest('.am-conds') && (t.dataset.rlj || t.dataset.rlc)) { rulesChange(fakeForm(), t, dirty); return true; }
  const d = AM.draft, form = formOf(), redraw = () => { dirty(); H.renderMain(); };
  switch (t.dataset.am) {
    case 'on': d.on = t.checked; redraw(); return true;
    case 'form': if (d.formId !== t.value) { Object.assign(d, blankAutomation(t.value), { name: d.name, on: d.on }); } redraw(); return true;
    case 'ttype': d.trigger = { type: t.value }; if (t.value === 'date') d.trigger.rel = 'on'; redraw(); return true;
    case 'tfield': d.trigger = { type: 'changed', field: t.value || undefined }; if (!t.value) delete d.trigger.field; redraw(); return true;
    case 'top': { d.trigger.op = t.value || undefined; if (!t.value) delete d.trigger.op; const f = field(form, d.trigger.field); const o = f && opOf(f, t.value); d.trigger.value = o && o.value === 'many' ? [] : ''; redraw(); return true; }
    case 'tval': { const f = field(form, d.trigger.field); if ('many' in t.dataset) { const have = new Set(Array.isArray(d.trigger.value) ? d.trigger.value : []); if (t.checked) have.add(t.value); else have.delete(t.value); d.trigger.value = (f?.options || []).filter((o) => have.has(o)); } else d.trigger.value = parseVal(f, t); redraw(); return true; }
    case 'trel': d.trigger.rel = t.value; if (t.value !== 'on' && d.trigger.days == null) d.trigger.days = 1; redraw(); return true;
    case 'tdays': d.trigger.days = Math.max(0, Math.min(365, Math.round(Number(t.value) || 0))); redraw(); return true;
    case 'tdate': d.trigger.dateField = t.value; redraw(); return true;
    case 'tstage': d.trigger = { type: 'stage' }; if (t.value) d.trigger.to = t.value; redraw(); return true;
    case 'trec': AM.test.recordId = t.value; AM.test.out = null; AM.test.err = null; H.renderMain(); return true;
  }
  const x = t.dataset.a != null ? act(t) : null;
  if (!x) return false;
  const s = t.dataset.s != null ? x.sets?.[+t.dataset.s] : null;
  switch (t.dataset.ama) {
    case 'do': if (x.do !== t.value) d.acts[+t.dataset.a] = blankAct(t.value); redraw(); return true;
    case 'target': if (t.value === 'self') { x.target = 'self'; delete x.parentForm; } else { x.target = 'parent'; x.parentForm = t.value.slice(2); } x.sets = [{ field: '', mode: 'value', value: '' }]; redraw(); return true;
    case 'sfield': if (s) { s.field = t.value; s.mode = 'value'; s.value = ''; delete s.from; } redraw(); return true;
    case 'smode': if (s) { s.mode = t.value; s.value = ''; delete s.from; } redraw(); return true;
    case 'sfrom': if (s) s.from = t.value; redraw(); return true;
    case 'sval': if (s) { const f = field(setTargetForm(x), s.field); if ('many' in t.dataset) { const have = new Set(Array.isArray(s.value) ? s.value : []); if (t.checked) have.add(t.value); else have.delete(t.value); s.value = (f?.options || []).filter((o) => have.has(o)); } else s.value = parseVal(f, t); } redraw(); return true;
    case 'assign': x.assign = t.value; if (t.value !== 'person') delete x.person; redraw(); return true;
    case 'person': x.person = t.value; redraw(); return true;
    case 'dueDays': x.dueDays = t.value === '' ? '' : Math.max(0, Math.min(365, Math.round(Number(t.value) || 0))); redraw(); return true;
    case 'tofield': case 'topfield': case 'toperson': { x.to = x.to || {}; const k = { tofield: 'fields', topfield: 'parentFields', toperson: 'people' }[t.dataset.ama]; const have = new Set(x.to[k] || []); if (t.checked) have.add(t.value); else have.delete(t.value); x.to[k] = [...have]; redraw(); return true; }
    case 'toowner': x.to = x.to || {}; x.to.owner = t.checked; redraw(); return true;
    case 'pdf': x.pdf = t.checked; redraw(); return true;
    case 'cform': x.formId = t.value; x.sets = []; redraw(); return true;
    case 'ccopy': x.copy = t.checked; redraw(); return true;
  }
  return false;
}

// the "only if" conditions use the rule builder's buttons (data-rl)
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-rl]');
  if (!el || !el.closest('.am-ed .am-conds') || !AM.draft) return;
  rulesClick(fakeForm(), el, dirty);
});

/** Forget everything on sign-out. */
export function resetAutos() { AM.id = null; AM.draft = null; AM.dirty = false; }
export { triggerText };

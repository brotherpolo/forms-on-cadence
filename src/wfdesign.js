// Form designer → Workflow tab: stages, who each goes to, its buttons, and fields per stage.
// The logic lives in workflow.js; this file draws the editor and handles its events.
import { esc, uid } from './ui.js';
import { FIELD_MODES, defaultMoves, checkWorkflow } from './workflow.js';

let H = { setFdirty: null, renderMain: null, people: () => [], groups: () => [], sections: () => [], ui: () => ({}) };
export function initWfDesign(helpers) { H = { ...H, ...helpers }; }

const ASSIGN = [
  { key: 'owner', label: 'the record’s owner' },
  { key: 'person', label: 'a specific person' },
  { key: 'group', label: 'a security group' },
  { key: 'mover', label: 'whoever moved it here' },
  { key: 'keep', label: 'the same person as before' },
];
const newStage = (name) => ({ id: uid('s'), name, assign: { type: 'owner' }, notify: { task: true, email: false }, fields: {}, sections: {}, moves: [] });
function starter() {
  const st = [newStage('Draft'), newStage('Review'), newStage('Approved')];
  st[1].assign = { type: 'person' };
  st.forEach((s, i) => { s.moves = defaultMoves(st, i); });
  return { on: true, stages: st };
}

function stageCard(f, s, i, n) {
  const ui = H.ui();
  const at = `data-si="${i}"`;
  const a = s.assign || { type: 'owner' };
  const moves = (s.moves || []).map((m, mi) => `<div class="wf-mv"><input class="in" ${at} data-mi="${mi}" data-wfd="mlabel" value="${esc(m.label || '')}" placeholder="Button label, e.g. Approve" maxlength="40" aria-label="Button label">
      <span class="help">to</span><select class="in am-sel" ${at} data-mi="${mi}" data-wfd="mto" aria-label="Goes to stage">${f.workflow.stages.filter((x) => x.id !== s.id).map((x) => `<option value="${esc(x.id)}"${x.id === m.to ? ' selected' : ''}>${esc(x.name || 'Untitled stage')}</option>`).join('')}</select>
      <label class="rl-chk"><input type="checkbox" ${at} data-mi="${mi}" data-wfd="mcomment"${m.comment ? ' checked' : ''}><span>Ask why</span></label>
      <button type="button" class="ibtn rl-x" ${at} data-mi="${mi}" data-wfa="mdel" aria-label="Remove this button">✕</button></div>`).join('');
  return `<article class="panel wf-stage">
    <header class="rl-h"><span class="wf-num">${i + 1}</span><input class="in wf-name" ${at} data-wfd="name" value="${esc(s.name || '')}" placeholder="Stage name" maxlength="40" aria-label="Stage ${i + 1} name"><span class="grow"></span>
      <button type="button" class="ibtn" ${at} data-wfa="up" aria-label="Move stage up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ibtn" ${at} data-wfa="down" aria-label="Move stage down"${i === n - 1 ? ' disabled' : ''}>↓</button>
      <button type="button" class="btn sm danger${ui.confirm === 'wfs-' + s.id ? ' armed' : ''}" ${at} data-wfa="del">${ui.confirm === 'wfs-' + s.id ? 'Tap again to delete' : 'Delete'}</button></header>
    <div class="am-row"><span class="am-lab">Goes to</span><select class="in am-sel" ${at} data-wfd="atype">${ASSIGN.map((x) => `<option value="${x.key}"${x.key === a.type ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      ${a.type === 'person' ? `<select class="in am-sel" ${at} data-wfd="aperson"><option value="">Pick someone…</option>${H.people().map((p) => `<option value="${esc(p.id)}"${p.id === a.person ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      ${a.type === 'group' ? `<select class="in am-sel" ${at} data-wfd="agroup"><option value="">Pick a group…</option>${H.groups().map((g) => `<option value="${esc(g.id)}"${g.id === a.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select>` : ''}</div>
    <div class="am-row"><label class="switch"><input type="checkbox" ${at} data-wfd="ntask"${s.notify?.task ? ' checked' : ''}><span class="tr"></span><span>Create a Cadence task for them</span></label>
      <label class="switch"><input type="checkbox" ${at} data-wfd="nemail"${s.notify?.email ? ' checked' : ''}><span class="tr"></span><span>Email them</span></label></div>
    <div class="wf-mvs"><span class="am-lab">Buttons</span>${moves || '<p class="help">No buttons: records stop here (the last stage), unless an administrator moves them.</p>'}
      <button type="button" class="btn sm ghost" ${at} data-wfa="madd">+ Button</button></div>
  </article>`;
}

function fieldTable(f) {
  const st = f.workflow.stages;
  const rows = [];
  (f.fields || []).forEach((x) => rows.push({ key: x.id, label: x.type === 'heading' ? `Section: ${x.label}` : x.label, heading: x.type === 'heading', calc: ['formula', 'autonumber'].includes(x.type) }));
  H.sections(f).forEach((x) => rows.push({ key: x.key, label: x.label, section: true }));
  const cell = (r, s, si) => {
    if (r.section || r.heading) {
      const v = r.section ? (s.sections || {})[r.key] || 'show' : (s.fields || {})[r.key] === 'hide' ? 'hide' : 'show';
      return `<select class="in wf-cell${v === 'hide' ? ' off' : ''}" data-si="${si}" data-wfd="${r.section ? 'sec' : 'fmode'}" data-k="${esc(r.key)}" aria-label="${esc(r.label)} at ${esc(s.name)}"><option value="show">Shown</option><option value="hide"${v === 'hide' ? ' selected' : ''}>Hidden</option></select>`;
    }
    const v = (s.fields || {})[r.key] || 'edit';
    return `<select class="in wf-cell m-${v}" data-si="${si}" data-wfd="fmode" data-k="${esc(r.key)}" aria-label="${esc(r.label)} at ${esc(s.name)}">${FIELD_MODES.filter((m) => !(r.calc && (m.key === 'req'))).map((m) => `<option value="${m.key}"${m.key === v ? ' selected' : ''}>${esc(r.calc && m.key === 'edit' ? 'Shown' : m.label)}</option>`).join('')}</select>`;
  };
  return `<section class="panel wf-fields"><h2 class="dz-h">Fields at each stage</h2><p class="help"><b>Required</b> fields must be filled before moving on to a later stage. <b>View only</b> shows the value without letting it change. <b>Hidden</b> hides it at that stage only; its value is kept. Hiding a section hides every field under it.</p>
    <div class="tblwrap"><table class="tbl wf-ftbl"><thead><tr><th>Field</th>${st.map((s) => `<th>${esc(s.name || 'Untitled')}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.heading || r.section ? 'wf-secrow' : ''}"><td>${esc(r.label)}</td>${st.map((s, si) => `<td>${cell(r, s, si)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}

export function viewWorkflow(f) {
  const w = f.workflow;
  const on = !!w?.on;
  const probs = on ? checkWorkflow(f, { people: new Set(H.people().map((p) => p.id)), groups: new Set(H.groups().map((g) => g.id)) }) : [];
  return `<div class="wf-design">
    <section class="panel am-sec"><label class="switch"><input type="checkbox" data-wfd="on"${on ? ' checked' : ''}><span class="tr"></span><span>Use a workflow for ${esc((f.name || 'this form').toLowerCase())}</span></label>
      <p class="help">Records move through stages, like Draft → Review → Approved. At each stage one person (or a security group) is responsible: only they and administrators can change the record, and it shows in their <b>My work</b>. Each stage has its own buttons to move on, and decides which fields show, can change, or must be filled first. Records already saved join the workflow when someone starts them.</p></section>
    ${on ? `${probs.length ? `<div class="panel am-warn" role="note"><b>To fix</b><ul>${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      <div class="wf-stages">${w.stages.map((s, i) => stageCard(f, s, i, w.stages.length)).join('')}</div>
      <div class="rl-adds"><button type="button" class="btn" data-wfa="add">+ Stage</button><button type="button" class="btn ghost" data-wfa="defaults" title="Replace every stage's buttons with Next and Send back">Standard buttons</button></div>
      ${w.stages.length ? fieldTable(f) : ''}
      <p class="help">The Stage can be used in show/hide rules and automations (“when the Stage becomes Approved…”).</p>` : ''}
  </div>`;
}

function changed(sel) { H.setFdirty(); H.renderMain(); if (sel) setTimeout(() => document.querySelector(sel)?.focus({ preventScroll: true }), 0); }

export function wfClick(f, el) {
  const w = f.workflow, a = el.dataset.wfa, i = +el.dataset.si, s = w?.stages?.[i];
  const ui = H.ui();
  if (a !== 'del') ui.confirm = null;
  switch (a) {
    case 'add': { const ns = newStage('Stage ' + (w.stages.length + 1)); const last = w.stages[w.stages.length - 1]; w.stages.push(ns); if (last) { last.moves = (last.moves || []).concat([{ id: uid('m'), label: `Send to ${ns.name}`, to: ns.id, comment: false }]); ns.moves = [{ id: uid('m'), label: 'Send back', to: last.id, comment: true }]; } changed(`[data-si="${w.stages.length - 1}"][data-wfd="name"]`); return; }
    case 'defaults': w.stages.forEach((x, j) => { x.moves = defaultMoves(w.stages, j); }); changed(); return;
    case 'up': case 'down': { const j = i + (a === 'up' ? -1 : 1); if (!s || j < 0 || j >= w.stages.length) return; [w.stages[i], w.stages[j]] = [w.stages[j], w.stages[i]]; changed(`[data-si="${j}"][data-wfa="${a}"]:not(:disabled)`); return; }
    case 'del': {
      if (!s) return;
      if (ui.confirm !== 'wfs-' + s.id) { ui.confirm = 'wfs-' + s.id; H.renderMain(); setTimeout(() => { if (ui.confirm === 'wfs-' + s.id) { ui.confirm = null; H.renderMain(); } }, 5000); return; }
      ui.confirm = null; w.stages.splice(i, 1); w.stages.forEach((x) => { x.moves = (x.moves || []).filter((m) => m.to !== s.id); }); changed(); return;
    }
    case 'madd': { if (!s) return; const to = w.stages[i + 1] || w.stages[i - 1]; (s.moves = s.moves || []).push({ id: uid('m'), label: '', to: to ? to.id : '', comment: false }); changed(`[data-si="${i}"][data-mi="${s.moves.length - 1}"][data-wfd="mlabel"]`); return; }
    case 'mdel': if (s) { s.moves.splice(+el.dataset.mi, 1); changed(); } return;
  }
}

export function wfInput(f, el) {
  const w = f.workflow, s = w?.stages?.[+el.dataset.si];
  if (!s) return false;
  if (el.dataset.wfd === 'name') { s.name = el.value; H.setFdirty(); return true; }
  if (el.dataset.wfd === 'mlabel') { const m = s.moves?.[+el.dataset.mi]; if (m) m.label = el.value; H.setFdirty(); return true; }
  return false;
}

export function wfChange(f, el) {
  const d = el.dataset.wfd;
  if (d === 'on') { if (el.checked) f.workflow = f.workflow?.stages?.length ? { ...f.workflow, on: true } : starter(); else f.workflow = { ...(f.workflow || { stages: [] }), on: false }; changed(); return true; }
  const s = f.workflow?.stages?.[+el.dataset.si];
  if (!s) return false;
  switch (d) {
    case 'name': case 'mlabel': changed(); return true; // names show in other stages' menus and the table
    case 'atype': s.assign = { type: el.value }; changed(); return true;
    case 'aperson': s.assign = { type: 'person', person: el.value }; changed(); return true;
    case 'agroup': s.assign = { type: 'group', group: el.value }; changed(); return true;
    case 'ntask': s.notify = { ...(s.notify || {}), task: el.checked }; changed(); return true;
    case 'nemail': s.notify = { ...(s.notify || {}), email: el.checked }; changed(); return true;
    case 'mto': { const m = s.moves?.[+el.dataset.mi]; if (m) m.to = el.value; changed(); return true; }
    case 'mcomment': { const m = s.moves?.[+el.dataset.mi]; if (m) m.comment = el.checked; changed(); return true; }
    case 'fmode': { s.fields = { ...(s.fields || {}) }; if (el.value === 'edit' || el.value === 'show') delete s.fields[el.dataset.k]; else s.fields[el.dataset.k] = el.value; changed(); return true; }
    case 'sec': { s.sections = { ...(s.sections || {}) }; if (el.value === 'show') delete s.sections[el.dataset.k]; else s.sections[el.dataset.k] = 'hide'; changed(); return true; }
  }
  return false;
}

// Workflows: a form's records move through stages (Draft → Review → Approved…). Each stage
// has someone responsible (the assignee), its own buttons to move on, and decides which fields
// show, which can be changed and which must be filled before moving on.
// Pure functions (no DOM, no Firebase): unit-tested, and bundled for the server too.
//
// form.workflow = { on, stages: [{
//   id, name,
//   assign: { type: 'owner' | 'person' | 'group' | 'mover' | 'keep', person?, group? },
//   notify: { task: bool, email: bool },
//   fields: { [fieldId]: 'edit' | 'req' | 'view' | 'hide' }   (missing = 'edit'; a heading: 'hide' hides its section)
//   sections: { ['g:'|'c:'+formId | 't:tasks']: 'hide' }         (missing = shown)
//   moves: [{ id, label, to: stageId, comment: bool }]           (the buttons)
// }] }
// record: stage (stage id), assignee (uid|null), assigneeGroup (group id|null), stageAt (ms)
import { headingOf } from './foldlogic.js';

export const STAGE_FIELD = '_stage';
export const FIELD_MODES = [
  { key: 'edit', label: 'Edit' },
  { key: 'req', label: 'Required' },
  { key: 'view', label: 'View only' },
  { key: 'hide', label: 'Hidden' },
];

export const wfOn = (form) => !!(form?.workflow?.on && (form.workflow.stages || []).length);
export const stagesOf = (form) => (wfOn(form) ? form.workflow.stages : []);
export const stageById = (form, id) => stagesOf(form).find((s) => s.id === id) || null;
export const firstStage = (form) => stagesOf(form)[0] || null;
export const stageIndex = (form, id) => stagesOf(form).findIndex((s) => s.id === id);

/** The form with a "Stage" pseudo field, so rules and automations can use it in conditions. */
export function withStageField(form) {
  if (!wfOn(form)) return form;
  return { ...form, fields: [...(form.fields || []), { id: STAGE_FIELD, type: 'select', label: 'Stage', options: stagesOf(form).map((s) => s.name), pseudo: true }] };
}
/** A record's stage name (what the Stage pseudo field holds). */
export const stageName = (form, rec) => stageById(form, rec?.stage)?.name || '';

/** What a stage does to the record page: { hide, view, req: Set(field ids), keys: Set(section keys hidden) }. */
export function stageView(form, stageId) {
  const st = stageById(form, stageId);
  const out = { hide: new Set(), view: new Set(), req: new Set(), keys: new Set() };
  if (!st) return out;
  const fields = form.fields || [];
  const under = headingOf(fields);
  const mode = (id) => (st.fields || {})[id] || 'edit';
  fields.forEach((f) => {
    const m = mode(f.id), hm = under[f.id] ? mode(under[f.id]) : 'edit';
    if (f.type === 'heading') { if (m === 'hide') out.keys.add('f:' + f.id); return; }
    if (m === 'hide' || hm === 'hide') out.hide.add(f.id);
    else if (m === 'view' || hm === 'view') out.view.add(f.id);
    else if (m === 'req' && !['formula', 'autonumber'].includes(f.type)) out.req.add(f.id);
  });
  Object.entries(st.sections || {}).forEach(([k, v]) => { if (v === 'hide') out.keys.add(k); });
  return out;
}

/** Can this person work on the record now? Admins always; otherwise its assignee (or a member of its group). */
export function canWork(rec, me) {
  if (!me) return false;
  if (me.role === 'admin') return true;
  if (!rec || !rec.stage) return true; // not in the workflow yet: ordinary access applies
  const id = me.uid || me.id;
  return rec.assignee === id || (!!rec.assigneeGroup && (me.groups || []).includes(rec.assigneeGroup));
}

/** Who a stage goes to when a record arrives there: { assignee, assigneeGroup }. */
export function assigneeFor(stage, rec, moverId) {
  const a = stage?.assign || { type: 'owner' };
  if (a.type === 'person' && a.person) return { assignee: a.person, assigneeGroup: null };
  if (a.type === 'group' && a.group) return { assignee: null, assigneeGroup: a.group };
  if (a.type === 'mover') return { assignee: moverId || rec?.ownerId || null, assigneeGroup: null };
  if (a.type === 'keep' && rec && (rec.assignee || rec.assigneeGroup)) return { assignee: rec.assignee || null, assigneeGroup: rec.assigneeGroup || null };
  return { assignee: rec?.ownerId || moverId || null, assigneeGroup: null };
}

/** A stage's buttons with their target stages (moves to stages that no longer exist are left out). */
export function movesOf(form, stageId) {
  const st = stageById(form, stageId);
  return (st?.moves || []).map((m) => ({ ...m, target: stageById(form, m.to) })).filter((m) => m.target && m.label);
}

/** Required-before-moving-on fields still empty: [field]. isBlank(v), hidden: Set of field ids the rules hide. */
export function missingToMove(form, stageId, values, isBlank, hidden = new Set()) {
  const v = stageView(form, stageId);
  return (form.fields || []).filter((f) => v.req.has(f.id) && !hidden.has(f.id) && (f.type === 'checkbox' ? values?.[f.id] !== true : isBlank(values?.[f.id])));
}

/** Default buttons for a new list of stages: Next → following stage; Send back (with a comment) → previous. */
export function defaultMoves(stages, i) {
  const out = [];
  if (stages[i + 1]) out.push({ id: 'm' + Math.random().toString(36).slice(2, 7), label: i === stages.length - 2 ? 'Complete' : `Send to ${stages[i + 1].name}`, to: stages[i + 1].id, comment: false });
  if (i > 0) out.push({ id: 'm' + Math.random().toString(36).slice(2, 7), label: 'Send back', to: stages[i - 1].id, comment: true });
  return out;
}

/** Problems in a workflow's set-up: [text]. */
export function checkWorkflow(form, { people = new Set(), groups = new Set() } = {}) {
  if (!form?.workflow?.on) return [];
  const out = [], st = form.workflow.stages || [];
  if (!st.length) out.push('Add at least one stage.');
  const names = new Set();
  st.forEach((s, i) => {
    const n = s.name?.trim() ? `“${s.name.trim()}”` : `Stage ${i + 1}`;
    if (!s.name?.trim()) out.push(`Stage ${i + 1} needs a name.`);
    else if (names.has(s.name.trim().toLowerCase())) out.push(`Two stages are called ${n}.`); else names.add(s.name.trim().toLowerCase());
    if (s.assign?.type === 'person' && !s.assign.person) out.push(`${n}: pick who it goes to.`);
    if (s.assign?.type === 'person' && s.assign.person && people.size && !people.has(s.assign.person)) out.push(`${n}: that person no longer has an account.`);
    if (s.assign?.type === 'group' && !s.assign.group) out.push(`${n}: pick which security group.`);
    if (s.assign?.type === 'group' && s.assign.group && groups.size && !groups.has(s.assign.group)) out.push(`${n}: that security group no longer exists.`);
    (s.moves || []).forEach((m) => { if (!m.label?.trim()) out.push(`${n}: a button needs a label.`); if (!st.some((x) => x.id === m.to)) out.push(`${n}: “${m.label || 'a button'}” goes to a stage that no longer exists.`); });
  });
  return out;
}

/** How long it's been waiting, in words: "today", "1 day", "5 days". */
export function waited(since, now) {
  if (!since) return '';
  const d = Math.floor((now - since) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
}

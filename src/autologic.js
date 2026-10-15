// Automations: the wording and the checks. Pure functions (no DOM, no Firebase), unit-tested.
// The server runs them (Cadence functions/automate.js); autos.js is the editor.
import { condText } from './rules.js';

export const TRIGGERS = [
  { key: 'created', label: 'is created' },
  { key: 'changed', label: 'changes' },
  { key: 'date', label: 'reaches a date' },
  { key: 'emailed', label: 'is emailed (Email PDF)' },
  { key: 'stage', label: 'moves to a workflow stage' },
];
export const ACTS = [
  { key: 'set', label: 'Set fields' },
  { key: 'task', label: 'Create a Cadence task' },
  { key: 'email', label: 'Send an email' },
  { key: 'child', label: 'Create a child record' },
];
export const SET_MODES = [
  { key: 'value', label: 'to' },
  { key: 'today', label: 'to today' },
  { key: 'copy', label: 'to the value of' },
  { key: 'clear', label: 'to empty' },
];
export const NO_SET = new Set(['heading', 'formula', 'autonumber', 'file', 'image', 'signature', 'location']);
export const MAX_ACTS = 10;

const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const itemOf = (f) => (f?.itemName || '').trim() || (f?.name || 'record').replace(/s$/i, '');

export function blankAutomation(formId) {
  return { name: '', formId: formId || '', on: true, trigger: { type: 'changed' }, join: 'all', conds: [], acts: [{ do: 'task', title: 'Follow up {Title}', notes: '', assign: 'owner', dueDays: 2 }] };
}
export function blankAct(kind) {
  if (kind === 'set') return { do: 'set', target: 'self', sets: [{ field: '', mode: 'value', value: '' }] };
  if (kind === 'task') return { do: 'task', title: 'Follow up {Title}', notes: '', assign: 'owner', dueDays: 2 };
  if (kind === 'email') return { do: 'email', to: { fields: [], parentFields: [], people: [], owner: false, addresses: '' }, subject: '{Item} {Title}', message: 'Hello,\n\n\n\nThank you,\n{Company}', pdf: false };
  return { do: 'child', formId: '', copy: true, sets: [] };
}

/** "When an Invoice changes Status to Approved" */
export function triggerText(a, form) {
  const t = a.trigger || {}, it = itemOf(form).toLowerCase();
  const field = (id) => (form?.fields || []).find((f) => f.id === id);
  if (t.type === 'created') return `When ${an(it)} is created`;
  if (t.type === 'emailed') return `When ${an(it)} is emailed`;
  if (t.type === 'stage') { const st = (form?.workflow?.stages || []).find((x) => x.id === t.to); return `When ${an(it)} moves to ${st ? st.name : 'any stage'}`; }
  if (t.type === 'date') {
    const f = field(t.dateField), n = Math.max(0, Math.round(Number(t.days) || 0));
    const when = t.rel === 'before' ? `${n} day${n === 1 ? '' : 's'} before` : t.rel === 'after' ? `${n} day${n === 1 ? '' : 's'} after` : 'on';
    return `${when[0].toUpperCase() + when.slice(1)} ${an(it)}’s ${f ? f.label : '(pick a date field)'}, at 7:00 a.m.`;
  }
  const f = field(t.field);
  if (!f) return `When ${an(it)} changes`;
  if (!t.op) return `When ${an(it)}’s ${f.label} changes`;
  return `When ${an(it)}’s ${condText({ src: 'self', field: f.id, op: t.op, value: t.value }, { form }).replace(/ is /, ' becomes ')}`;
}

/** The whole automation as a sentence, for the list. */
export function autoText(a, ctx) {
  const form = ctx.formById(a.formId);
  const parentFields = new Map((ctx.parentsOf ? ctx.parentsOf(a.formId) : []).map((p) => [p.id, { name: p.name, fields: p.fields || [] }]));
  const conds = (a.conds || []).map((c) => (c.group ? '(' + (c.conds || []).filter((x) => x.field).map((x) => condText(x, { form, parentFields })).join(c.join === 'any' ? ' or ' : ' and ') + ')' : c.field ? condText(c, { form, parentFields }) : '')).filter((x) => x && x !== '()');
  const acts = (a.acts || []).map((x) => actText(x, form, ctx)).filter(Boolean);
  return `${triggerText(a, form)}${conds.length ? ', only if ' + conds.join(a.join === 'any' ? ' or ' : ' and ') : ''}: ${acts.join('; ') || 'nothing yet'}.`;
}
export function actText(x, form, ctx = {}) {
  const fl = (f, id) => (f?.fields || []).find((g) => g.id === id)?.label || '?';
  if (x.do === 'set') {
    const tf = x.target === 'parent' ? ctx.formById?.(x.parentForm) : form;
    const parts = (x.sets || []).filter((s) => s.field).map((s) => `${fl(tf, s.field)} ${s.mode === 'today' ? 'to today' : s.mode === 'clear' ? 'to empty' : s.mode === 'copy' ? 'to ' + fl(form, s.from) : 'to ' + (Array.isArray(s.value) ? s.value.join(', ') : s.value === true ? 'Yes' : s.value === false ? 'No' : s.value || 'empty')}`);
    return parts.length ? `set ${parts.join(', ')}${x.target === 'parent' ? ` on the ${itemOf(tf).toLowerCase()}` : ''}` : '';
  }
  if (x.do === 'task') {
    const who = x.assign === 'person' ? (ctx.person ? ctx.person(x.person) : 'someone') : x.assign === 'actor' ? 'whoever made the change' : 'the record’s owner';
    return `create task “${x.title || 'Follow up'}” for ${who}${x.dueDays !== '' && x.dueDays != null ? `, due in ${x.dueDays} day${Number(x.dueDays) === 1 ? '' : 's'}` : ''}`;
  }
  if (x.do === 'email') {
    const to = x.to || {}, who = [...(to.fields || []).map((id) => fl(form, id)), ...(to.parentFields || []).length ? ['the parent’s email'] : [], ...(to.owner ? ['the owner'] : []), ...(to.people || []).map((u) => (ctx.person ? ctx.person(u) : 'someone')), ...String(to.addresses || '').split(/[,;\s]+/).filter(Boolean)];
    return `email ${who.join(', ') || '(nobody yet)'}${x.pdf ? ' with the PDF' : ''}`;
  }
  if (x.do === 'child') { const cf = ctx.formById?.(x.formId); return cf ? `create ${an(itemOf(cf).toLowerCase())}` : ''; }
  return '';
}

/** Problems to fix before saving: [text]. */
export function checkAutomation(a, form, ctx = {}) {
  const out = [];
  if (!String(a.name || '').trim()) out.push('Give it a name.');
  if (!form) { out.push('Pick a form.'); return out; }
  const has = (f, id) => (f?.fields || []).some((g) => g.id === id);
  const t = a.trigger || {};
  if (t.type === 'date' && !has(form, t.dateField)) out.push('Pick the date field it waits for.');
  if (t.type === 'changed' && t.field && !has(form, t.field)) out.push('The field it watches no longer exists.');
  if (t.type === 'stage' && !form.workflow?.on) out.push('This form has no workflow (form designer → Workflow).');
  if (t.type === 'stage' && t.to && !(form.workflow?.stages || []).some((x) => x.id === t.to)) out.push('That stage no longer exists.');
  if (t.type === 'changed' && t.op && ['is', 'not', 'eq', 'ne', 'on', 'contains', 'has'].includes(t.op) && (t.value === '' || t.value == null)) out.push('Fill in what the field changes to.');
  if (!(a.acts || []).length) out.push('Add at least one thing for it to do.');
  (a.acts || []).forEach((x, i) => {
    const n = `Action ${i + 1}`;
    if (x.do === 'set') {
      if (x.target === 'parent' && !x.parentForm) out.push(`${n}: pick the parent form.`);
      if (!(x.sets || []).some((s) => s.field)) out.push(`${n}: pick a field to set.`);
      (x.sets || []).forEach((s) => { if (s.field && s.mode === 'copy' && !s.from) out.push(`${n}: pick the field to copy from.`); });
    }
    if (x.do === 'task' && !String(x.title || '').trim()) out.push(`${n}: give the task a title.`);
    if (x.do === 'task' && x.assign === 'person' && !x.person) out.push(`${n}: pick who gets the task.`);
    if (x.do === 'email') {
      const to = x.to || {};
      if (!(to.fields || []).length && !(to.parentFields || []).length && !(to.people || []).length && !to.owner && !String(to.addresses || '').trim()) out.push(`${n}: say who the email goes to.`);
      const bad = String(to.addresses || '').split(/[,;\s]+/).filter((s) => s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s));
      if (bad.length) out.push(`${n}: “${bad[0]}” isn’t an email address.`);
      if (!String(x.subject || '').trim()) out.push(`${n}: add a subject.`);
    }
    if (x.do === 'child' && !x.formId) out.push(`${n}: pick which child form.`);
  });
  return out;
}

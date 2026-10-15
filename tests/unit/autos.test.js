// Automations: wording and checks (src/autologic.js), and the server's record kit (src/server/recordkit.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoText, triggerText, checkAutomation, blankAutomation, blankAct } from '../../src/autologic.js';
import { makeKit } from '../../src/server/recordkit.js';

const form = { id: 'f_inv', name: 'Invoices', itemName: 'Invoice', fields: [{ id: 'st', type: 'select', label: 'Status', options: ['Draft', 'Approved'] }, { id: 'due', type: 'date', label: 'Due date' }, { id: 'em', type: 'email', label: 'Billing email' }, { id: 'amt', type: 'currency', label: 'Total' }], children: [{ formId: 'f_n' }] };
const kid = { id: 'f_n', name: 'Notes', itemName: 'Note', fields: [{ id: 'x', type: 'text', label: 'Text' }] };
const ctx = { formById: (id) => [form, kid].find((f) => f.id === id), parentsOf: () => [], person: (id) => (id === 'u1' ? 'Amy' : 'someone') };

test('triggers read naturally', () => {
  assert.equal(triggerText({ trigger: { type: 'created' } }, form), 'When an invoice is created');
  assert.equal(triggerText({ trigger: { type: 'changed' } }, form), 'When an invoice changes');
  assert.equal(triggerText({ trigger: { type: 'changed', field: 'st' } }, form), 'When an invoice’s Status changes');
  assert.equal(triggerText({ trigger: { type: 'changed', field: 'st', op: 'is', value: 'Approved' } }, form), 'When an invoice’s Status becomes Approved');
  assert.equal(triggerText({ trigger: { type: 'date', dateField: 'due', rel: 'before', days: 3 } }, form), '3 days before an invoice’s Due date, at 7:00 a.m.');
  assert.equal(triggerText({ trigger: { type: 'emailed' } }, form), 'When an invoice is emailed');
});

test('the whole automation as a sentence', () => {
  const a = { formId: 'f_inv', trigger: { type: 'changed', field: 'st', op: 'is', value: 'Approved' }, join: 'all', conds: [{ src: 'self', field: 'amt', op: 'gt', value: 1000 }], acts: [
    { do: 'set', target: 'self', sets: [{ field: 'due', mode: 'today' }] }, { do: 'task', title: 'Send it', assign: 'person', person: 'u1', dueDays: 1 },
    { do: 'email', to: { fields: ['em'], owner: true, addresses: 'a@b.co' }, pdf: true }, { do: 'child', formId: 'f_n' }] };
  assert.equal(autoText(a, ctx), 'When an invoice’s Status becomes Approved, only if Total more than 1000: set Due date to today; create task “Send it” for Amy, due in 1 day; email Billing email, the owner, a@b.co with the PDF; create a note.');
});

test('checks before saving', () => {
  const a = blankAutomation('f_inv');
  assert.deepEqual(checkAutomation({ ...a, name: '' }, form), ['Give it a name.']);
  const bad = { ...a, name: 'x', trigger: { type: 'date' }, acts: [blankAct('email'), { do: 'set', target: 'self', sets: [{ field: '', mode: 'value' }] }, { do: 'task', title: '', assign: 'person' }, { do: 'child', formId: '' }] };
  bad.acts[0].to.addresses = 'nope';
  const msgs = checkAutomation(bad, form);
  assert.ok(msgs.includes('Pick the date field it waits for.'));
  assert.ok(msgs.some((m) => /Action 1: “nope” isn’t an email address/.test(m)));
  assert.ok(msgs.some((m) => /Action 2: pick a field to set/.test(m)));
  assert.ok(msgs.some((m) => /Action 3: give the task a title/.test(m)) && msgs.some((m) => /Action 3: pick who gets the task/.test(m)));
  assert.ok(msgs.some((m) => /Action 4: pick which child form/.test(m)));
  assert.deepEqual(checkAutomation({ ...a, name: 'x', acts: [] }, form), ['Add at least one thing for it to do.']);
});

test('record kit: text, calculations, parent and children, rules in the PDF model', () => {
  const forms = [
    { id: 'p', name: 'Clients', fields: [{ id: 'n', type: 'text', label: 'Name' }], children: [{ formId: 'j' }] },
    { id: 'j', name: 'Jobs', titleField: 't', color: 1, children: [{ formId: 'l', display: 'grid' }], fields: [{ id: 't', type: 'text', label: 'Title' }, { id: 'h', type: 'decimal', label: 'Hours', decimals: 1 }, { id: 'c', type: 'formula', label: 'Lines', expr: 'CHILDSUM("Lines", "Qty")', format: 'number' }, { id: 'pn', type: 'formula', label: 'Client', expr: 'PARENT("Name")', format: 'text' }, { id: 's', type: 'checkbox', label: 'Secret on' }, { id: 'sec', type: 'text', label: 'Secret' }],
      rules: [{ id: 'r', join: 'all', conds: [{ src: 'self', field: 's', op: 'no' }], acts: [{ do: 'hide', targets: ['f:sec'] }] }] },
    { id: 'l', name: 'Lines', fields: [{ id: 'q', type: 'number', label: 'Qty' }] },
  ];
  const recs = [{ id: 'c1', formId: 'p', values: { n: 'Northwind' } }, { id: 'j1', formId: 'j', parentId: 'c1', values: { t: 'Roof', h: 2.5, sec: 'x' } }, { id: 'l1', formId: 'l', parentId: 'j1', values: { q: 2 } }, { id: 'l2', formId: 'l', parentId: 'j1', values: { q: 3 } }];
  const k = makeKit({ forms, records: recs });
  assert.equal(k.recTitle(recs[1]), 'Roof');
  assert.equal(k.fieldText(forms[1], recs[1], 'Hours'), '2.5');
  assert.equal(k.fieldText(forms[1], recs[1], 'Lines'), '5');
  assert.equal(k.fieldText(forms[1], recs[1], 'Client'), 'Northwind');
  assert.equal(k.fieldText(forms[1], recs[1], 'Nope'), undefined);
  const m = k.pdfModel(forms[1], recs[1]);
  assert.ok(!m.items.some((i) => i.label === 'Secret'), 'the rules hide Secret');
  assert.deepEqual([m.title, m.parent, m.sections[0].title, m.sections[0].rows], ['Roof', 'Clients: Northwind', 'Lines', [['2'], ['3']]]);
  const look = k.look(forms[1], recs[1]);
  assert.equal(look({ src: 'p', field: 'n' }).v, 'Northwind');
});

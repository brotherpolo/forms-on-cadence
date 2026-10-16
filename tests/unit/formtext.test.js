// Form designer → Fields → Text, and version summaries (src/formtext.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formToText, textToFields, fieldChanges, changeLines, formChangeLines, readVersionFile, fieldLine } from '../../src/formtext.js';

const ex = JSON.parse(readFileSync(new URL('../../src/examples.json', import.meta.url), 'utf8'));
const forms = ex.forms.map((f) => ({ id: f.id, name: f.name }));
const formName = (id) => forms.find((x) => x.id === id)?.name;
let n = 0; const newId = () => 'new' + ++n;

test('every example form round-trips with no changes', () => {
  for (const f of ex.forms) {
    const r = textToFields(formToText(f, { formName }), { fields: f.fields, forms });
    assert.deepEqual(r.errors, [], f.name);
    assert.deepEqual(changeLines(fieldChanges(f.fields, r.fields)), [], f.name);
  }
});

test('writing lines', () => {
  assert.equal(fieldLine({ id: 'a', type: 'select', label: 'Status', options: ['Open', 'Done, finally'], required: true, width: 'half' }), 'Status: dropdown [Open, "Done, finally"], required  @a');
  assert.equal(fieldLine({ id: 'h', type: 'heading', label: 'Money', help: 'All in CAD' }), '# Money, help "All in CAD"  @h');
  assert.equal(fieldLine({ id: 'c', type: 'formula', label: 'Total', expr: '{A} *\n {B}', format: 'currency', currency: 'USD', width: 'half' }), 'Total: calculated, as currency, currency USD = {A} * {B}  @c');
  assert.equal(fieldLine({ id: 't', type: 'text', label: 'Time: start', width: 'half' }), '"Time: start": text  @t');
  assert.equal(fieldLine({ id: 'r', type: 'relation', label: 'Client', relForm: 'f_clients', width: 'half' }, { formName }), 'Client: link to Clients  @r');
});

test('reading: new, renamed, reordered, removed, with settings kept', () => {
  const fields = [
    { id: 'a', type: 'text', label: 'Name', required: true, width: 'half', inList: true, help: '', secret: 'kept' },
    { id: 'b', type: 'currency', label: 'Budget', width: 'half', currency: 'CAD' },
    { id: 'c', type: 'date', label: 'Due', width: 'half' },
  ];
  const txt = `# Basics
Due date: date, required  @c
Full name: text, required, in list  @a
// a note
Status: dropdown [Open, Closed], full
Total: calculated, as currency = {Budget} * 1.13
`;
  const r = textToFields(txt, { fields, forms, newId });
  assert.deepEqual(r.errors, [{ line: 6, msg: '{Budget} isn’t a field on this form.' }], 'Budget was removed, so the calculation can’t use it');
  const r2 = textToFields(txt.replace('{Budget}', '{Due date}'), { fields, forms, newId });
  assert.deepEqual(r2.errors, []);
  const [h, due, name, st, tot] = r2.fields;
  assert.equal(h.type, 'heading'); assert.equal(h.label, 'Basics');
  assert.deepEqual([due.id, due.label, due.required], ['c', 'Due date', true]);
  assert.deepEqual([name.id, name.label, name.inList, name.secret], ['a', 'Full name', true, 'kept'], 'other settings kept');
  assert.deepEqual([st.type, st.options, st.width], ['select', ['Open', 'Closed'], 'full']);
  assert.deepEqual([tot.type, tot.format, tot.expr, tot.currency], ['formula', 'currency', '{Due date} * 1.13', 'CAD']);
  const ch = fieldChanges(fields, r2.fields, (id) => (id === 'b' ? 7 : 0));
  assert.deepEqual(ch.renamed, [['Name', 'Full name'], ['Due', 'Due date']].reverse());
  assert.deepEqual(ch.removed, [{ label: 'Budget', heading: false, values: 7 }]);
  assert.equal(ch.added.length, 3);
  assert.equal(ch.moved, 1);
  const lines = changeLines(ch);
  assert.match(lines[1], /Removed 1: Budget \(7 records have a value\)\. Saved values are kept/);
});

test('mistakes are reported by line', () => {
  const r = textToFields(['Name text', 'A: curency', 'B: dropdown', 'C: text, bold', 'D: text  @x', 'E: number  @x', 'F: date = 1', 'G: link to Nowhere', 'H: text, help "open'].join('\n'), { fields: [], forms, newId });
  assert.equal(r.fields, null);
  const by = Object.fromEntries(r.errors.map((e) => [e.line, e.msg]));
  assert.match(by[1], /Name: type/);
  assert.match(by[2], /“curency” isn’t a field type. Did you mean “currency”?/);
  assert.match(by[3], /needs its options/);
  assert.match(by[4], /“bold” isn’t understood/);
  assert.match(by[6], /@x is also on line 5/);
  assert.match(by[7], /Only calculated fields/);
  assert.match(by[8], /no form called “Nowhere”/);
  assert.match(by[9], /quote/);
});

test('options, types and warnings', () => {
  const r = textToFields(['Rate: slider, min 1, max 10, step 0.5, suffix "x"', 'Stars: rating, stars 10', 'No: auto number, prefix "INV-", start 100, digits 4, yearly', 'Ok: yes/no', 'Ok: text', 'Pic: photo  @old'].join('\n'), { fields: [], forms, newId });
  assert.deepEqual(r.errors, []);
  const [a, b, c] = r.fields;
  assert.deepEqual([a.type, a.min, a.max, a.step, a.suffix], ['range', 1, 10, 0.5, 'x']);
  assert.equal(b.max, 10);
  assert.deepEqual([c.type, c.prefix, c.start, c.digits, c.year], ['autonumber', 'INV-', 100, 4, true]);
  assert.deepEqual(r.given.map((g) => g.sysName), ['Ok 2'], 'a shared caption: the second gets its own system name');
  assert.equal(r.fields[4].sysName, 'Ok 2');
  assert.ok(r.warnings.some((w) => /@old isn’t a field/.test(w.msg)));
  assert.match(textToFields('X: number, required, stars 3', { forms }).errors[0].msg, /doesn’t apply/);
  assert.match(textToFields('X: calculated, required = 1', { forms }).errors[0].msg, /can’t be required/);
});

test('whole-form summaries and version files', () => {
  const a = { name: 'Jobs', fields: [{ id: 'x', type: 'text', label: 'T' }], rules: [], workflow: { on: false }, color: 1 };
  const b = { ...a, name: 'Work', rules: [{ id: 'r' }], workflow: { on: true, stages: [] }, color: 2, children: [{ formId: 'k' }] };
  assert.deepEqual(formChangeLines(a, a), ['No changes']);
  assert.deepEqual(formChangeLines(null, a), ['First version']);
  assert.deepEqual(formChangeLines(a, b), ['Renamed the form: Jobs → Work', 'Relationships changed', 'Rules changed (0 → 1)', 'Workflow changed', 'Settings changed']);
  assert.equal(readVersionFile('{').error, 'That isn’t a JSON file Formwright can read.');
  assert.match(readVersionFile('{"fields":[{"id":"a","type":"weird","label":"Q"}]}').error, /“Q”/);
  const ok = readVersionFile(JSON.stringify({ formwright: 'form-version', formId: 'f1', formName: 'Jobs', version: 3, form: a }));
  assert.deepEqual([ok.formId, ok.formName, ok.version, ok.form.name], ['f1', 'Jobs', 3, 'Jobs']);
});

test('renaming a field updates calculations that use its old name', () => {
  const fields = [{ id: 'a', type: 'currency', label: 'Budget', width: 'half' }, { id: 't', type: 'formula', label: 'Tax', expr: '{Budget} * 0.13', width: 'half' }];
  const r = textToFields('Total budget: currency  @a\nTax: calculated = {Budget} * 0.13  @t\n', { fields, forms });
  assert.deepEqual(r.errors, []);
  assert.equal(r.fields[1].expr, '{Total budget} * 0.13');
  assert.match(textToFields('Total budget: currency  @a\nTax: calculated = {Budgt} * 0.13  @t\n', { fields, forms }).errors[0].msg, /\{Budgt\}/);
});

test('system names: written, read, and followed by calculations', () => {
  const fields = [{ id: 'a', type: 'text', label: 'Name', width: 'half' }, { id: 't', type: 'formula', label: 'Greeting', expr: '{Name}', width: 'half' }];
  assert.equal(fieldLine({ id: 'a', type: 'text', label: 'Name', sysName: 'Client name', width: 'half' }), 'Name: text, system name "Client name"  @a');
  assert.equal(fieldLine({ id: 'a', type: 'text', label: 'Name', sysName: 'Name', width: 'half' }), 'Name: text  @a', 'the same as the caption: not written');
  const r = textToFields('Name: text, system name "Client name"  @a\nGreeting: calculated = {Name}  @t\n', { fields, forms });
  assert.deepEqual([r.errors, r.fields[0].sysName, r.fields[1].expr], [[], 'Client name', '{Client name}']);
  const r2 = textToFields('Name: text  @a\nName: text, system name "Contact name"\nGreeting: calculated = {Contact name} & {Name}  @t\n', { fields, forms });
  assert.deepEqual([r2.errors, r2.given], [[], []]);
  assert.match(textToFields('Name: text, system name ""', { forms }).errors[0].msg, /needs a name/);
  assert.match(textToFields('Name: text, system name "{x}"', { forms }).errors[0].msg, /can’t have/);
  assert.deepEqual(changeLines(fieldChanges([{ id: 'a', type: 'text', label: 'Name' }], [{ id: 'a', type: 'text', label: 'Name', sysName: 'Client name' }])), ['Settings changed: Name']);
});

test('long text: plain turns formatting off', () => {
  assert.equal(fieldLine({ id: 'n', type: 'textarea', label: 'Notes', width: 'full', plain: true }), 'Notes: long text, plain  @n');
  assert.equal(fieldLine({ id: 'n', type: 'textarea', label: 'Notes', width: 'full' }), 'Notes: long text  @n');
  const r = textToFields('Notes: long text, plain  @n\nBrief: long text  @b', { fields: [{ id: 'n', type: 'textarea', label: 'Notes', width: 'full' }, { id: 'b', type: 'textarea', label: 'Brief', width: 'full', plain: true }], forms });
  assert.deepEqual([r.errors, r.fields[0].plain, r.fields[1].plain], [[], true, undefined]);
  assert.match(textToFields('Name: text, plain', { forms }).errors[0].msg, /doesn’t apply/);
  assert.deepEqual(changeLines(fieldChanges([{ id: 'n', type: 'textarea', label: 'Notes' }], [{ id: 'n', type: 'textarea', label: 'Notes', plain: true }])), ['Settings changed: Notes']);
});

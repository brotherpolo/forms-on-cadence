// "Placeholders for <form>" (src/docxgen.js): what's listed, and that all of it is recognised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeholderModel, placeholderDocx, formSchema, fieldLine, condName } from '../../src/docxgen.js';
import { checkDocx, fillDocx, docText } from '../../src/docxtpl.js';
import { unzip } from '../../src/xlsx.js';

const F = (id, label, type, extra = {}) => ({ id, label, type, ...extra });
const forms = [
  { id: 'cl', name: 'Clients', itemName: 'Client', fields: [F('c1', 'Company name', 'text'), F('c2', 'Logo', 'image'), F('c3', 'Since', 'date')], children: [{ formId: 'pr' }] },
  { id: 'pr', name: 'Projects', itemName: 'Project', titleField: 'p1', workflow: { on: true, stages: [{ id: 's', name: 'Draft' }] }, fields: [
    F('p1', 'Project name', 'text'), F('p2', 'Stage', 'select', { options: ['Scoping', 'In progress', 'Done'] }), F('p3', 'Budget', 'currency', { currency: 'CAD' }),
    F('p4', 'Start date', 'date'), F('h1', 'Checks', 'heading'), F('p5', 'Safe and sound', 'checkbox'), F('p6', 'Brief', 'textarea'), F('p7', 'Photo', 'image'),
    F('p8', 'Sign-off', 'signature'), F('p9', 'Issues', 'multiselect', { options: ['A', 'B'] }), F('p10', 'With tax', 'formula', { expr: '{Budget} * 1.13', format: 'currency' }), F('p11', 'Contact', 'relation', { relForm: 'co' })],
    children: [{ formId: 'li', display: 'grid', cols: ['l1', 'l2', 'l3'] }, { formId: 'vi' }] },
  { id: 'li', name: 'Line items', itemName: 'Line item', fields: [F('l1', 'Description', 'text'), F('l2', 'Qty', 'decimal'), F('l3', 'Amount', 'currency', { currency: 'CAD' }), F('l4', 'Billable', 'checkbox')], children: [] },
  { id: 'vi', name: 'Site visits', itemName: 'Site visit', fields: [F('v1', 'Visit summary', 'text'), F('v2', 'Visited at', 'datetime'), F('v3', 'Contact on site', 'relation', { relForm: 'co' }), F('v4', 'Crew', 'number')], children: [] },
  { id: 'co', name: 'Contacts', itemName: 'Contact', titleField: 'k1', fields: [F('k1', 'Full name', 'text'), F('k2', 'Phone', 'phone')], children: [] },
];
const byId = (id) => forms.find((f) => f.id === id);
const ctx = {
  formById: byId, parentsOf: (id) => forms.filter((f) => (f.children || []).some((c) => c.formId === id)),
  itemName: (f) => f.itemName || f.name, wfOn: (f) => !!f.workflow?.on, now: new Date(2026, 9, 16),
  gridCols: (rel, cf) => rel.cols.map((id) => cf.fields.find((f) => f.id === id)),
  checkExpr: (form, e) => { const m = /CHILD(?:SUM|COUNT)\("([^"]+)"/.exec(e); return m && (form.children || []).some((c) => byId(c.formId)?.name === m[1]) ? null : 'unknown'; },
};

test('each field gets the placeholder that suits it', () => {
  assert.equal(fieldLine(F('a', 'Start', 'date')).ph, '{Start|long}');
  assert.equal(fieldLine(F('a', 'Ok', 'checkbox')).ph, '{Ok|Yes/No}');
  assert.equal(fieldLine(F('a', 'Pic', 'image')).ph, '{%Pic|width=8cm}');
  assert.equal(fieldLine(F('a', 'Sig', 'signature')).ph, '{%Sig|height=2cm}');
  assert.equal(fieldLine(F('a', 'Name', 'text', { sysName: 'Client name' }), 'Client: ').ph, '{Client: Client name}');
  assert.equal(condName(F('a', 'Safe and sound', 'checkbox')), '[Safe and sound]');
  assert.equal(condName(F('a', 'Budget', 'number')), 'Budget');
});

test('the model: fields, parent, link, grid, child records, conditions, every record', () => {
  const m = placeholderModel(byId('pr'), ctx);
  const titles = m.sections.map((s) => s.title);
  assert.deepEqual(titles, ['This project', 'The client it belongs to', 'Line items (grid)', 'Site visits (child records)', 'Show or hide parts', 'Every record']);
  const mine = m.sections[0].rows;
  assert.ok(mine.some((r) => r.sub === 'Checks'), 'section headings become sub-rows');
  assert.ok(mine.some((r) => r.ph === '{Contact: Phone}'), 'a linked record’s field');
  assert.ok(m.sections[1].rows.some((r) => r.ph === '{%Client: Logo|width=8cm}'));
  assert.deepEqual(m.sections[2].grid.cols.map((c) => c.ph), ['{Description}', '{Qty}', '{Amount}']);
  assert.ok(m.sections[2].rows.some((r) => r.ph === '{= CHILDSUM("Line items", "Amount")|currency}'));
  assert.deepEqual(m.sections[3].lines, ['{#each Site visits}', '{Visit summary}, {Visited at|long}', '{/each}']);
  const conds = m.sections[4].rows.map((r) => r.ph);
  assert.ok(conds.includes('{#if Stage = "In progress"} … {/if}'));
  assert.ok(conds.includes('{#if [Safe and sound]} … {/if}'), 'a name with "and" in brackets');
  assert.ok(conds.includes('{#each Line items|where Billable} … {/each}'));
  assert.ok(conds.includes('{#each Site visits|sort Visited at desc} … {/each}'));
  const every = m.sections[5].rows.map((r) => r.ph);
  assert.ok(every.includes('{Today|long}') && every.includes('{%Logo|height=1.5cm}'));
  assert.ok(!every.includes('{Stage}'), 'a field called Stage wins over the workflow stage');
  assert.match(m.intro, /Oct 16, 2026/);
});

test('the Word file: everything in it is recognised, for every form', async () => {
  const form = byId('pr');
  const bytes = await placeholderDocx(placeholderModel(form, ctx));
  const c = await checkDocx(bytes, formSchema(form, ctx));
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.tags.filter((t) => !t.ok), []);
  assert.ok(c.tags.length > 30, `${c.tags.length} placeholders`);
  // and every form: the parent, the children
  for (const f of forms) {
    const b = await placeholderDocx(placeholderModel(f, ctx));
    const cc = await checkDocx(b, formSchema(f, ctx));
    assert.deepEqual([...cc.errors, ...cc.tags.filter((t) => !t.ok).map((t) => t.text + ' ' + t.why)], [], f.name);
  }
  const files = unzip(bytes);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(files.has(n), n);
  const text = docText(new TextDecoder().decode(await files.get('word/document.xml')()));
  assert.match(text, /^Placeholders for Projects/);
  assert.match(text, /\{Client: Company name\}/);
});

test('schema: parents by form or item name, links, children, pictures', () => {
  const s = formSchema(byId('pr'), ctx);
  assert.equal(s.has('Client: Company name'), true);
  assert.equal(s.has('Clients: Company name'), true);
  assert.equal(s.has('Parent: Since'), true);
  assert.equal(s.has('Contact: Phone'), true);
  assert.equal(s.has('Contact: Nope'), false);
  assert.equal(s.has('Today'), true);
  assert.equal(s.has('Nope'), false);
  assert.equal(s.has('Checks'), false, 'a heading isn’t a value');
  assert.ok(s.list('Line items') && s.list('Line item') && !s.list('Nope'));
  assert.equal(s.image('Photo'), true);
  assert.equal(s.image('Client: Logo'), true);
  assert.equal(s.image('Budget'), false);
  assert.equal(s.image('Logo'), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChildForm, searchableForms, searchForms } from '../../src/navlogic.js';

const forms = [
  { id: 'li', name: 'Line Item', showInSidebar: true, order: 1 },
  { id: 'inv', name: 'Invoice', showInSidebar: true, order: 2, children: [{ formId: 'li', display: 'grid' }] },
  { id: 'cust', name: 'Customer', showInSidebar: false, order: 3, children: [{ formId: 'inv' }, { formId: 'con' }] },
  { id: 'con', name: 'Contact', showInSidebar: false, order: 4 },
  { id: 'li2', name: 'Line items 2', showInSidebar: false, order: 5 },
  { id: 'sec', name: 'Secret', showInSidebar: true, order: 6 },
];
const all = () => true;

test('child forms are searchable only when switched on for the sidebar', () => {
  assert.ok(isChildForm(forms, 'li') && isChildForm(forms, 'con') && !isChildForm(forms, 'cust'));
  assert.deepEqual(searchableForms(forms, all).map((f) => f.id), ['li', 'inv', 'cust', 'li2', 'sec'], 'Contact is a hidden child: left out');
  assert.deepEqual(searchableForms(forms, (f) => f.id !== 'sec').map((f) => f.id), ['li', 'inv', 'cust', 'li2'], 'forms you can’t see never show');
});

test('search: any case, anywhere in the name, earlier matches first', () => {
  assert.deepEqual(searchForms(forms, '', all), []);
  assert.deepEqual(searchForms(forms, '  ', all), []);
  assert.deepEqual(searchForms(forms, 'LINE', all).map((x) => x.form.id), ['li', 'li2']);
  assert.deepEqual(searchForms(forms, 'o', all).map((x) => x.form.id), ['inv', 'cust'], 'Invoice has its o earlier than Customer');
  const r = searchForms(forms, 'voi', all)[0];
  assert.equal(r.form.id, 'inv'); assert.equal(r.at, 2); assert.equal(r.len, 3);
  assert.deepEqual(searchForms(forms, 'contact', all), [], 'a hidden child form is not found');
});

import { allSearchable, designerMatch } from '../../src/navlogic.js';

test('clicking into Search forms lists every form it can find, in order', () => {
  const forms = [
    { id: 'b', name: 'Billing', order: 2, children: [{ formId: 'li' }] },
    { id: 'a', name: 'Accounts', order: 1 },
    { id: 'li', name: 'Line Item', order: 3 },
    { id: 'x', name: 'Secret', order: 0 }
  ];
  const out = allSearchable(forms, (f) => f.id !== 'x');
  assert.deepEqual(out.map((r) => r.form.id), ['a', 'b']);
  assert.deepEqual([out[0].at, out[0].len], [0, 0]);
});

test('the designer search matches form names only, any case', () => {
  assert.equal(designerMatch({ name: 'Line Item' }, 'item'), true);
  assert.equal(designerMatch({ name: 'Line Item', fields: [{ label: 'Invoice #' }] }, 'invoice'), false);
  assert.equal(designerMatch({ name: 'Anything' }, '  '), true);
});

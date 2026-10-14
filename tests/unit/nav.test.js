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

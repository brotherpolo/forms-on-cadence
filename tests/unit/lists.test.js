import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columnCatalog, defaultConfig, cleanConfig, sameConfig, cellOf, filterRecords, searchRows, sortRows, firstDir,
  columnTotal, viewsFor, canSaveView, canDeleteView, viewDoc, toCsv, optionsOf, defaultViewId, filterCount,
} from '../../src/listlogic.js';

const clients = { id: 'clients', name: 'Clients', fields: [
  { id: 'cname', type: 'text', label: 'Company name', inList: true },
  { id: 'cstatus', type: 'select', label: 'Status', options: ['Lead', 'Active'], inList: true },
  { id: 'notes', type: 'textarea', label: 'Notes', inList: true }] };
const projects = { id: 'projects', name: 'Projects', titleField: 'pname', fields: [
  { id: 'pname', type: 'text', label: 'Project name', inList: true },
  { id: 'stage', type: 'select', label: 'Stage', options: ['Scoping', 'In progress', 'Done'], inList: true },
  { id: 'budget', type: 'currency', label: 'Budget', inList: true },
  { id: 'tags', type: 'multiselect', label: 'Tags', options: ['A', 'B'] },
  { id: 'urgent', type: 'checkbox', label: 'Urgent' },
  { id: 'brief', type: 'textarea', label: 'Brief', inList: true },
  { id: 'h1', type: 'heading', label: 'Section' }] };
const visits = { id: 'visits', name: 'Site visits', fields: [{ id: 'vs', type: 'text', label: 'Summary' }] };

const ctx = { form: projects, titleField: projects.fields[0], parents: [clients], children: [visits] };
const recs = [
  { id: 'c1', formId: 'clients', values: { cname: 'Halden', cstatus: 'Active' } },
  { id: 'r1', formId: 'projects', parentId: 'c1', values: { pname: 'Rebrand', stage: 'In progress', budget: 48000, tags: ['A'], urgent: true }, updatedAt: 3, createdAt: 1, createdBy: 'u1' },
  { id: 'r2', formId: 'projects', values: { pname: 'audit', stage: 'Done', budget: 9000, tags: ['B'] }, updatedAt: 5, createdBy: 'u2' },
  { id: 'r3', formId: 'projects', values: { pname: 'Zebra', stage: 'Scoping' }, updatedAt: 1, createdBy: 'u1' },
  { id: 'v1', formId: 'visits', parentId: 'r1', values: {} },
  { id: 'v2', formId: 'visits', parentId: 'r1', values: {} },
];
const byId = new Map(recs.map((r) => [r.id, r]));
const h = {
  form: projects,
  formById: (id) => ({ clients, projects, visits }[id]),
  recById: (id) => byId.get(id),
  valOf: (f, r) => r.values?.[f.id],
  fmt: (f, v) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : String(v)),
  recTitle: (r) => r.values.pname || r.values.cname || 'Untitled',
  kids: (id, fid) => recs.filter((r) => r.parentId === id && r.formId === fid).length,
  nameOf: (u) => ({ u1: 'Adam', u2: 'Farren' }[u]),
};

test('catalog leaves out the title and headings, keeps long text, and adds parent, counts and record info', () => {
  const keys = columnCatalog(ctx).map((c) => c.key);
  assert.ok(!keys.includes('f:pname'));
  assert.ok(keys.includes('f:brief') && !keys.includes('f:h1'));
  assert.ok(keys.includes('f:stage') && keys.includes('parent'));
  assert.ok(keys.includes('p:clients:cstatus') && keys.includes('p:clients:notes'));
  assert.ok(keys.includes('kids:visits') && keys.includes('sys:by') && keys.includes('sys:owner'));
});

test('default config follows "Show as list column", with Belongs to first', () => {
  const d = defaultConfig(ctx);
  assert.deepEqual(d.cols, ['parent', 'f:stage', 'f:budget', 'f:brief']);
  assert.deepEqual(d.sort, { key: 'sys:updated', dir: 'desc' });
});

test('long text shows on one line in a list', () => {
  const h = { form: projects, valOf: (f, r) => r.values[f.id], fmt: (f, v) => (v == null ? '' : String(v)) };
  const c = cellOf('f:brief', { values: { brief: 'First line\n\n  second line ' } }, h);
  assert.equal(c.text, 'First line second line');
  assert.equal(c.long, true);
});

test('cleanConfig drops missing columns, duplicates and stale filter options', () => {
  const cat = columnCatalog(ctx);
  const c = cleanConfig({ cols: ['f:stage', 'f:gone', 'f:stage', 7], sort: { key: 'f:gone', dir: 'asc' }, filters: { stage: ['Done', 'Old'], budget: ['1'], nope: ['x'] }, density: 'huge' }, cat, projects);
  assert.deepEqual(c.cols, ['f:stage']);
  assert.deepEqual(c.sort, { key: 'sys:updated', dir: 'desc' });
  assert.deepEqual(c.filters, { stage: ['Done'] });
  assert.equal(c.density, 'cozy');
  assert.equal(filterCount(c), 1);
});

test('sameConfig ignores filter option order', () => {
  const a = { cols: ['a'], sort: { key: 'title', dir: 'asc' }, filters: { s: ['x', 'y'] }, density: 'cozy' };
  assert.ok(sameConfig(a, { ...a, filters: { s: ['y', 'x'] } }));
  assert.ok(!sameConfig(a, { ...a, cols: ['b'] }));
});

test('cells read fields, the parent, parent fields, counts and record info', () => {
  const r1 = byId.get('r1');
  assert.equal(cellOf('f:budget', r1, h).sort, 48000);
  assert.equal(cellOf('f:budget', r1, h).num, true);
  assert.equal(cellOf('parent', r1, h).text, 'Halden');
  assert.equal(cellOf('p:clients:cstatus', r1, h).text, 'Active');
  assert.equal(cellOf('p:clients:cstatus', byId.get('r2'), h).text, '');
  assert.equal(cellOf('kids:visits', r1, h).sort, 2);
  assert.equal(cellOf('sys:by', r1, h).text, 'Adam');
  assert.equal(cellOf('sys:owner', { ...r1, ownerId: r1.createdBy }, h).text, 'Adam', 'Owner column names the owner');
  assert.equal(cellOf('title', byId.get('r2'), h).sort, 'audit');
});

test('filters: any option within a field, every field must match', () => {
  const ps = recs.filter((r) => r.formId === 'projects');
  assert.deepEqual(filterRecords(ps, { stage: ['Done', 'Scoping'] }, projects).map((r) => r.id), ['r2', 'r3']);
  assert.deepEqual(filterRecords(ps, { tags: ['A'] }, projects).map((r) => r.id), ['r1']);
  assert.deepEqual(filterRecords(ps, { urgent: ['No'] }, projects).map((r) => r.id), ['r2', 'r3']);
  assert.deepEqual(filterRecords(ps, { stage: ['Done'], urgent: ['Yes'] }, projects).map((r) => r.id), []);
  assert.equal(filterRecords(ps, {}, projects).length, 3);
});

test('sorting puts empty values last in both directions', () => {
  const rows = [{ id: 'a', sortVal: 5 }, { id: 'b', sortVal: null }, { id: 'c', sortVal: 1 }];
  assert.deepEqual(sortRows(rows, 'asc').map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(rows, 'desc').map((r) => r.id), ['a', 'c', 'b']);
  const t = [{ id: 'x', sortVal: 'item 10' }, { id: 'y', sortVal: 'item 9' }];
  assert.deepEqual(sortRows(t, 'asc').map((r) => r.id), ['y', 'x']);
  assert.equal(firstDir({ num: true }), 'desc');
  assert.equal(firstDir({ key: 'f:stage', num: false }), 'asc');
});

test('search looks in the title and shown cells; totals add numbers', () => {
  const rows = [{ title: 'Rebrand', cells: [{ text: 'Halden', value: 10 }] }, { title: 'Audit', cells: [{ text: 'Marrow', value: 5 }] }];
  assert.equal(searchRows(rows, 'hald').length, 1);
  assert.equal(searchRows(rows, '  ').length, 2);
  assert.equal(columnTotal({ sum: true }, rows, 0), 15);
  assert.equal(columnTotal({ sum: false }, rows, 0), null);
});

test('views: default first, then shared, then mine; others\' private views hidden', () => {
  const base = defaultConfig(ctx);
  const docs = [
    { id: 'v1', formId: 'projects', name: 'Zed', shared: false, ownerId: 'me', cols: [] },
    { id: 'v2', formId: 'projects', name: 'Due soon', shared: true, ownerId: 'adm', cols: ['f:stage'] },
    { id: 'v3', formId: 'projects', name: 'Theirs', shared: false, ownerId: 'other', cols: [] },
    { id: 'v4', formId: 'clients', name: 'Other form', shared: true, ownerId: 'adm', cols: [] },
  ];
  let vs = viewsFor(projects, docs, 'me', base);
  assert.deepEqual(vs.map((v) => v.name), ['All projects', 'Due soon', 'Zed']);
  assert.equal(vs[0].builtin, true);
  assert.deepEqual(vs[0].cfg, base);
  vs = viewsFor(projects, [...docs, { id: defaultViewId('projects'), formId: 'projects', shared: true, ownerId: 'adm', name: 'x', cols: ['f:budget'] }], 'me', base);
  assert.deepEqual(vs[0].cfg.cols, ['f:budget']);
  assert.equal(vs.length, 3);
});

test('who may save and delete views', () => {
  const builtin = { builtin: true, shared: true, doc: null };
  assert.equal(canSaveView(builtin, 'me', false), false);
  assert.equal(canSaveView(builtin, 'me', true), true);
  assert.equal(canDeleteView(builtin, 'me', true), false);
  assert.equal(canDeleteView({ ...builtin, doc: {} }, 'me', true), true);
  const own = { shared: false, ownerId: 'me' };
  assert.equal(canSaveView(own, 'me', false), true);
  assert.equal(canSaveView({ shared: true, ownerId: 'me' }, 'me', false), false);
  assert.equal(canDeleteView({ shared: true, ownerId: 'x' }, 'me', true), true);
  assert.equal(canDeleteView({ shared: true, ownerId: 'x' }, 'me', false), false);
});

test('viewDoc trims and stamps', () => {
  const d = viewDoc({ formId: 'projects', name: '  ', ownerId: 'me', shared: 1, cfg: { cols: ['a'], sort: { key: 'title', dir: 'asc' }, filters: { s: ['x'] }, density: 'compact' }, now: 9 });
  assert.equal(d.name, 'Untitled view');
  assert.equal(d.shared, true);
  assert.equal(d.createdAt, 9);
  assert.deepEqual(Object.keys(d).sort(), ['cols', 'createdAt', 'density', 'filters', 'formId', 'name', 'ownerId', 'shared', 'sort', 'updatedAt']);
});

test('CSV quotes, escapes, and defuses formulas but keeps numbers', () => {
  const s = toCsv(['Name', 'Note'], [['A, B', 'say "hi"'], ['=SUM(1)', '-5'], ['-x', '']]);
  assert.equal(s, 'Name,Note\r\n"A, B","say ""hi"""\r\n\'=SUM(1),-5\r\n\'-x,');
  assert.deepEqual(optionsOf({ type: 'checkbox' }), ['Yes', 'No']);
});

test('titles sort by their real value: dates by calendar, numbers by size, blanks last', async () => {
  const { titleSortOf, cellOf, sortRows } = await import('../../src/listlogic.js');
  const form = { id: 'li', titleField: 'd', fields: [{ id: 'd', type: 'date', label: 'Date' }] };
  const fmt = (f, v) => (v ? new Date(v + 'T00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const h = { form, valOf: (f, r) => r.values[f.id], fmt, recTitle: (r) => fmt(null, r.values.d) || 'Untitled' };
  const recs = ['2020-08-26', '2022-12-02', '2020-12-03', '2021-08-29', ''].map((d, i) => ({ id: 'r' + i, values: { d } }));
  const rows = recs.map((rec) => ({ rec, sortVal: cellOf('title', rec, h).sort }));
  assert.deepEqual(sortRows(rows, 'asc').map((r) => r.rec.values.d), ['2020-08-26', '2020-12-03', '2021-08-29', '2022-12-02', '']);
  assert.deepEqual(sortRows(rows, 'desc').map((r) => r.rec.values.d), ['2022-12-02', '2021-08-29', '2020-12-03', '2020-08-26', '']);
  const nform = { id: 'inv', titleField: 'n', fields: [{ id: 'n', type: 'number', label: '#' }] };
  const nh = { form: nform, valOf: (f, r) => r.values[f.id], fmt: (f, v) => String(v), recTitle: (r) => String(r.values.n) };
  const nrows = [10, 2, 1].map((n) => ({ rec: { values: { n } }, sortVal: titleSortOf({ values: { n } }, nform, nh) }));
  assert.deepEqual(sortRows(nrows, 'asc').map((r) => r.rec.values.n), [1, 2, 10]);
});

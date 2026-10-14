import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templateColumns, guideRows, exportValue, makeLookup, parseValue, matchColumns, checkRows, summarize, splitSheet,
  templateSheets, pickSheet, undoPlan, undoOpen, parseDate, parseTime, parseDateTime, parseNumber, parentFormsOf,
  skippedFields, UNDO_MS,
} from '../../src/importlogic.js';
import { writeXlsx, readSheets, readCsv, zip, unzip, sheetName } from '../../src/xlsx.js';

const itemName = (f) => (f.itemName || f.name.replace(/s$/, ''));
const clients = { id: 'clients', name: 'Clients', itemName: 'Client', titleField: 'cname', children: [{ formId: 'projects', copy: true }], fields: [
  { id: 'cname', type: 'text', label: 'Company name', required: true },
  { id: 'region', type: 'select', label: 'Region', options: ['North', 'South'] }] };
const projects = { id: 'projects', name: 'Projects', itemName: 'Project', titleField: 'pname', children: [{ formId: 'lines', display: 'grid' }], fields: [
  { id: 'pname', type: 'text', label: 'Project name', required: true },
  { id: 'stage', type: 'select', label: 'Stage', options: ['Scoping', 'In progress', 'Review', 'Done'] },
  { id: 'budget', type: 'currency', label: 'Budget', min: 0 },
  { id: 'start', type: 'date', label: 'Start date' },
  { id: 'bill', type: 'checkbox', label: 'Billable' },
  { id: 'tags', type: 'multiselect', label: 'Tags', options: ['Print', 'Web', 'Signage'] },
  { id: 'contact', type: 'relation', label: 'Contact', relForm: 'contacts' },
  { id: 'region', type: 'select', label: 'Region', options: ['North', 'South'] },
  { id: 'tax', type: 'formula', label: 'Budget with tax', expr: '{Budget} * 1.13' },
  { id: 'sow', type: 'file', label: 'Statement of work' },
  { id: 'h', type: 'heading', label: 'Section' }] };
const lines = { id: 'lines', name: 'Line items', itemName: 'Line item', titleField: 'item', fields: [
  { id: 'item', type: 'text', label: 'Item', required: true },
  { id: 'qty', type: 'decimal', label: 'Qty' }] };
const contacts = { id: 'contacts', name: 'Contacts', itemName: 'Contact', titleField: 'kname', fields: [{ id: 'kname', type: 'text', label: 'Name' }] };
const forms = [clients, projects, lines, contacts];
const formById = (id) => forms.find((f) => f.id === id);

const STAMP = 1760000000000;
const records = [
  { id: 'c1', formId: 'clients', values: { cname: 'Halden Studio', region: 'North' } },
  { id: 'c2', formId: 'clients', values: { cname: 'Northgate Dental' } },
  { id: 'c3', formId: 'clients', values: { cname: 'Twin' } },
  { id: 'c4', formId: 'clients', values: { cname: 'twin' } },
  { id: 'k1', formId: 'contacts', values: { kname: 'Dana Okafor' } },
  { id: 'p1', formId: 'projects', parentId: 'c1', parentFormId: 'clients', values: { pname: 'Rebrand', stage: 'In progress', budget: 48000, start: '2026-08-04', bill: true, tags: ['Print', 'Web'], contact: 'k1' }, updatedAt: 5 },
  { id: 'p2', formId: 'projects', parentId: 'c2', parentFormId: 'clients', values: { pname: 'Signage', stage: 'Review', budget: 12500, bill: false }, updatedAt: 5 },
];
const titleOf = (r) => String(r.values?.[formById(r.formId).titleField] ?? '');

function ctxFor(form, recs = records) {
  const lookup = makeLookup(recs, titleOf);
  return {
    lookup, titleOf, formById, itemName, records: recs, parents: parentFormsOf(form, forms),
    compute: (f, rec) => (f.id === 'projects' ? { tax: rec.values.budget == null ? null : Math.round(rec.values.budget * 113) / 100 } : {}),
    show: (f, v) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)),
  };
}

test('template columns: Record ID, parent, importable fields; required marked; skipped listed', () => {
  const ctx = ctxFor(projects);
  const cols = templateColumns(projects, ctx.parents, itemName);
  assert.deepEqual(cols.map((c) => c.header), ['Record ID', 'Client', 'Project name *', 'Stage', 'Budget', 'Start date', 'Billable', 'Tags', 'Contact', 'Region']);
  assert.equal(cols[1].required, false);
  assert.deepEqual(skippedFields(projects).map((s) => s.why), ['calculated', 'file']);
  const lc = templateColumns(lines, parentFormsOf(lines, forms), itemName);
  assert.equal(lc[1].header, 'Project *', 'a grid sub-form needs its parent');
  const dup = templateColumns({ id: 'd', name: 'D', fields: [{ id: 'a', type: 'text', label: 'Name' }, { id: 'b', type: 'text', label: 'name' }] }, [], itemName);
  assert.deepEqual(dup.map((c) => c.header), ['Record ID', 'Name', 'name (2)']);
  const g = guideRows(projects, cols, ctx);
  assert.match(g.find((x) => x.col === 'Stage').what, /Scoping, In progress, Review, Done/);
  assert.match(g.find((x) => x.col === 'Contact').what, /contact in Formwright/);
});

test('dates, times and numbers in the forms people type them', () => {
  assert.equal(parseDate(46300), '2026-10-05');
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('10/5/2026'), '2026-10-05');
  assert.equal(parseDate('25/12/2026'), '2026-12-25');
  assert.equal(parseDate('Oct 5, 2026'), '2026-10-05');
  assert.equal(parseDate('5 October 2026'), '2026-10-05');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('next tues'), null);
  assert.equal(parseTime(0.5), '12:00');
  assert.equal(parseTime('2:30 PM'), '14:30');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseDateTime(46300.75), '2026-10-05T18:00');
  assert.equal(parseDateTime('2026-10-05 09:30'), '2026-10-05T09:30');
  assert.equal(parseDateTime('10/5/2026 2:30 PM'), '2026-10-05T14:30');
  assert.equal(parseDateTime('2026-10-05'), '2026-10-05T00:00');
  assert.equal(parseNumber('$48,000'), 48000);
  assert.equal(parseNumber('(1,250.50)'), -1250.5);
  assert.equal(parseNumber('45%'), 45);
  assert.equal(parseNumber('CAD 12'), 12);
  assert.ok(Number.isNaN(parseNumber('twelve')));
});

test('parseValue: choices, yes/no, several choices, links, limits', () => {
  const ctx = ctxFor(projects);
  const F = (id) => projects.fields.find((f) => f.id === id);
  assert.deepEqual(parseValue(F('stage'), 'in progress', ctx), { ok: true, v: 'In progress' });
  const bad = parseValue(F('stage'), 'Done-ish', ctx);
  assert.equal(bad.ok, false); assert.match(bad.msg, /isn’t one of the choices\. Closest is “Done”/);
  assert.equal(bad.fix.type, 'choice'); assert.equal(bad.fix.options.length, 4);
  assert.equal(parseValue(F('bill'), 'y', ctx).v, true);
  assert.equal(parseValue(F('bill'), '', ctx).v, false);
  assert.equal(parseValue(F('bill'), 'maybe', ctx).ok, false);
  assert.deepEqual(parseValue(F('tags'), 'web; print', ctx).v, ['Print', 'Web'], 'kept in option order');
  assert.deepEqual(parseValue(F('tags'), 'Web, Signage', ctx).v, ['Web', 'Signage']);
  assert.match(parseValue(F('tags'), 'Web; Radio', ctx).msg, /“Radio” isn’t one of the choices/);
  assert.equal(parseValue(F('budget'), '-5', ctx).ok, false, 'minimum 0');
  assert.equal(parseValue(F('contact'), 'dana okafor', ctx).v, 'k1');
  assert.equal(parseValue(F('contact'), 'k1', ctx).v, 'k1', 'by Record ID');
  const miss = parseValue(F('contact'), 'Dana Okafro', ctx);
  assert.match(miss.msg, /no contact called “Dana Okafro”\. Closest is “Dana Okafor”/);
  assert.equal(miss.fix.options[0].v, 'k1');
  assert.deepEqual(parseValue({ type: 'location' }, '43.65, -79.38', ctx).v, { address: '', lat: 43.65, lng: -79.38 });
  assert.equal(parseValue({ type: 'color' }, 'ABC', ctx).v, '#aabbcc');
  assert.equal(parseValue({ type: 'phone' }, 4165550142, ctx).v, '4165550142');
  assert.equal(parseValue({ type: 'number' }, '3.5', ctx).ok, false);
  assert.equal(parseValue({ type: 'rating', max: 5 }, '★★★', ctx).v, 3);
});

test('matching file headings to columns', () => {
  const ctx = ctxFor(projects);
  const cols = templateColumns(projects, ctx.parents, itemName);
  const m = matchColumns(['Record ID', 'Project name *', 'client', 'Budget ($)', 'Kickoff', 'Stage', 'Notes from PM', '', 'stage'], cols);
  assert.deepEqual(m.map((x) => x.key), ['id', 'pname', 'parent', 'budget', '', 'stage', '', '', '']);
  assert.equal(m[3].how, 'exact');
  const m2 = matchColumns(['ID', 'Belongs to', 'Projct name', 'Start'], cols);
  assert.deepEqual(m2.map((x) => x.key), ['id', 'parent', 'pname', 'start']);
  assert.equal(m2[2].how, 'close');
});

function run(form, headers, rows, opts = {}) {
  const ctx = ctxFor(form, opts.records);
  const cols = templateColumns(form, ctx.parents, itemName);
  const map = opts.map || matchColumns(headers, cols).map((x) => x.key);
  return checkRows({ form, cols, map, rows, rowNums: rows.map((r, i) => i + 2), overrides: opts.overrides, ctx });
}

test('checking rows: new, update with changes, unchanged, problems', () => {
  const headers = ['Record ID', 'Client', 'Project name', 'Stage', 'Budget', 'Start date', 'Billable', 'Tags', 'Contact'];
  const rows = [
    [null, 'Halden Studio', 'Pine Street mural', 'Scoping', '6,250', '2026-10-20', 'Yes', 'Print', 'Dana Okafor'],
    ['p1', 'Halden Studio', 'Rebrand', 'Review', 52000, 46238, 'Yes', 'Print; Web', 'Dana Okafor'],
    ['p2', 'Northgate Dental', 'Signage', 'Review', 12500, null, 'No', null, null],
    [null, 'Halden Studios', 'Annual report', 'Done-ish', 'abc', 'next tues', 'Yes', null, null],
    ['p9', null, 'Ghost', null, null, null, null, null, null],
    ['p1', null, 'Again', null, null, null, null, null, null],
    [null, 'twin', 'Twin project', null, null, null, null, null, null],
    [null, null, null, 'Scoping', null, null, null, null, null],
  ];
  const r = run(projects, headers, rows);
  assert.deepEqual(r.map((x) => x.action), ['new', 'update', 'same', 'problem', 'problem', 'problem', 'problem', 'problem']);
  assert.equal(r[0].parentId, 'c1'); assert.equal(r[0].values.budget, 6250); assert.equal(r[0].values.contact, 'k1');
  assert.equal(r[0].values.tax, 7062.5, 'formulas worked out');
  assert.equal(r[0].values.region, 'North', 'a copy relationship copies matching fields from the parent');
  assert.deepEqual(r[1].changes.map((c) => c.label), ['Stage', 'Budget'], 'date serial 46238 is the same 2026-08-04; tags and contact unchanged');
  assert.equal(r[1].values.pname, 'Rebrand');
  assert.equal(r[1].values.tax, 58760);
  const p3 = r[3].problems.map((p) => p.key);
  assert.deepEqual(p3, ['parent', 'stage', 'budget', 'start']);
  assert.match(r[3].problems[0].msg, /no client called “Halden Studios”\. Closest is “Halden Studio”/);
  assert.match(r[4].problems[0].msg, /Record ID p9: no project with this ID/);
  assert.match(r[5].problems[0].msg, /also on row 3/);
  assert.equal(r[6].problems[0].fix.options.length, 2, 'two clients called twin: pick one');
  assert.match(r[7].problems[0].msg, /Project name is required/);
  const s = summarize(r);
  assert.deepEqual(s, { rows: 8, new: 1, update: 1, same: 1, problem: 5 });
});

test('fixes: replacement values and "add as new instead"', () => {
  const headers = ['Record ID', 'Client', 'Project name', 'Stage'];
  const rows = [[null, 'Halden Studios', 'Annual report', 'Done-ish'], ['p9', 'Halden Studio', 'Ghost', null]];
  const overrides = new Map([[0, { cells: { 1: 'c1', 3: 'Done' } }], [1, { asNew: true }]]);
  const r = run(projects, headers, rows, { overrides });
  assert.deepEqual(r.map((x) => x.action), ['new', 'new']);
  assert.equal(r[0].values.stage, 'Done'); assert.equal(r[0].parentId, 'c1');
});

test('an update only changes the columns in the file; clearing a cell clears the value', () => {
  const r = run(projects, ['Record ID', 'Budget', 'Tags'], [['p1', null, '']]);
  assert.equal(r[0].action, 'update');
  assert.equal(r[0].values.budget, null);
  assert.equal(r[0].values.tags, null);
  assert.equal(r[0].values.stage, 'In progress', 'untouched');
  assert.equal(r[0].parentId, 'c1');
  const r2 = run(projects, ['Record ID', 'Project name'], [['p1', '']]);
  assert.equal(r2[0].action, 'problem', 'a required field can’t be cleared');
});

test('required field with no column: new rows can’t be imported, updates can', () => {
  const r = run(projects, ['Record ID', 'Stage'], [[null, 'Done'], ['p2', 'Done']]);
  assert.equal(r[0].action, 'problem');
  assert.match(r[0].problems[0].msg, /no column in your file goes into it/);
  assert.equal(r[0].problems[0].fix, null);
  assert.equal(r[1].action, 'update');
});

test('sub-form rows name their parent; it’s required for a grid', () => {
  const r = run(lines, ['Project', 'Item', 'Qty'], [['Rebrand', 'Workshop', '24'], [null, 'Orphan', '1'], ['p2', 'Panels', '6']]);
  assert.deepEqual(r.map((x) => x.action), ['new', 'problem', 'new']);
  assert.equal(r[0].parentId, 'p1'); assert.equal(r[0].parentFormId, 'projects');
  assert.equal(r[2].parentId, 'p2');
  assert.match(r[1].problems[0].msg, /Project is required/);
});

test('splitSheet: heading row is the first non-empty row; blank rows skipped; row numbers kept', () => {
  const s = splitSheet([[], [null, null], ['A', 'B', null], [1, 2], [], [null, 'x', null, null]]);
  assert.deepEqual(s.headers, ['A', 'B']);
  assert.deepEqual(s.data, [[1, 2], [null, 'x', null, null]]);
  assert.deepEqual(s.rowNums, [4, 6]);
  assert.equal(pickSheet([{ name: 'Guide', rows: [['x']] }, { name: 'Lists', hidden: true, rows: [['y']] }, { name: 'Projects', rows: [['z']] }]), 2);
});

test('exportValue writes what parseValue reads back unchanged', () => {
  const ctx = ctxFor(projects);
  for (const f of projects.fields.filter((x) => !['formula', 'file', 'heading'].includes(x.type))) {
    const v = records[5].values[f.id];
    if (v === undefined) continue;
    const cell = exportValue(f, v, ctx);
    const raw = cell && typeof cell === 'object' ? cell.v : cell;
    assert.deepEqual(parseValue(f, raw, ctx).v, v, f.label);
  }
  assert.deepEqual(exportValue(projects.fields[3], '2026-08-04', ctx), { v: 46238, s: 'date' });
});

test('template workbook: header, data, dropdowns, guide, hidden lists; reads back', async () => {
  const ctx = ctxFor(projects);
  const cols = templateColumns(projects, ctx.parents, itemName);
  const taken = new Set();
  const names = { main: sheetName('Projects', taken), guide: sheetName('Guide', taken), lists: sheetName('Lists', taken) };
  const sheets = templateSheets(projects, cols, ctx, 'data', names);
  assert.equal(sheets.length, 3);
  assert.equal(sheets[0].rows.length, 3, 'header + 2 projects');
  assert.deepEqual(sheets[0].rows[1][0], { v: 'p1', s: 'text' });
  assert.equal(sheets[0].rows[1][1], 'Halden Studio');
  assert.ok(sheets[0].validations.some((v) => v.list === '"Yes,No"'));
  assert.ok(sheets[0].validations.some((v) => /^'Lists'!\$A\$2:\$A\$4$/.test(v.list)), 'parent dropdown from the Lists sheet');
  const u8 = await writeXlsx(sheets);
  const back = await readSheets(u8, 'x.xlsx');
  assert.deepEqual(back.map((s) => [s.name, s.hidden]), [['Projects', false], ['Guide', false], ['Lists', true]]);
  const { headers, data } = splitSheet(back[0].rows);
  const map = matchColumns(headers, cols).map((x) => x.key);
  const r = checkRows({ form: projects, cols, map, rows: data, rowNums: data.map((_, i) => i + 2), ctx });
  assert.deepEqual(r.map((x) => x.action), ['same', 'same'], 'an untouched export imports as no changes');
});

test('zip round trip and CSV reading', async () => {
  const z = await zip([{ name: 'a.txt', data: new TextEncoder().encode('hello '.repeat(50)) }, { name: 'ü/b.txt', data: new Uint8Array([1, 2, 3]) }]);
  const m = unzip(z);
  assert.equal(new TextDecoder().decode(await m.get('a.txt')()), 'hello '.repeat(50));
  assert.deepEqual([...(await m.get('ü/b.txt')())], [1, 2, 3]);
  assert.deepEqual(readCsv('﻿Name,Notes\r\n"Smith, J","said ""hi""\nthen left"\r\nA,\n'), [['Name', 'Notes'], ['Smith, J', 'said "hi"\nthen left'], ['A', null]]);
  assert.deepEqual(readCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  const s = await readSheets(new TextEncoder().encode('x,y\n1,2'), 'f.csv');
  assert.deepEqual(s[0].rows, [['x', 'y'], ['1', '2']]);
  await assert.rejects(readSheets(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'old.xls'), /older Excel file/);
  assert.equal(sheetName('a/b:c*?[d]'), 'a b c   d');
  assert.equal(sheetName('History'), 'History 1');
});

test('undo plan: removes what was added, restores what changed, keeps what was edited since', () => {
  const now = STAMP + 1000;
  const recs = [
    { id: 'n1', formId: 'projects', updatedAt: STAMP },
    { id: 'n2', formId: 'projects', updatedAt: STAMP + 500 },
    { id: 'kid', formId: 'lines', parentId: 'n1', updatedAt: STAMP + 600 },
    { id: 'u1', formId: 'projects', updatedAt: STAMP, values: { pname: 'New' } },
    { id: 'u2', formId: 'projects', updatedAt: STAMP + 700 },
  ];
  const imp = { added: ['n1', 'n2', 'gone'], updated: ['u1', 'u2'], stamp: STAMP, createdAt: STAMP, status: 'done' };
  const before = new Map([['u1', { values: { pname: 'Old' }, parentId: 'c1', parentFormId: 'clients' }], ['u2', { values: {} }]]);
  const p = undoPlan(imp, recs, before);
  assert.deepEqual(p.del, ['n1']);
  assert.deepEqual(p.under, ['kid']);
  assert.deepEqual(p.restore, [{ id: 'u1', values: { pname: 'Old' }, parentId: 'c1', parentFormId: 'clients' }]);
  assert.deepEqual(p.kept, ['n2', 'u2']);
  assert.equal(p.gone, 1);
  assert.equal(undoOpen(imp, now), true);
  assert.equal(undoOpen(imp, STAMP + UNDO_MS + 1), false);
  assert.equal(undoOpen({ ...imp, status: 'undone' }, now), false);
});

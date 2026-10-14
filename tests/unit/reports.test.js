import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainOf, valueOf, rowsOf, measureOf, groupsOf, bucketsOf, kindOf, reportFields, widgetFor, dropField, changeType,
  layout, settle, resize, move, snapCols, autoTitle, niceStep, defaultColumns,
} from '../../src/reportlogic.js';
import { parseRoute, routeFor } from '../../src/route.js';

// Clients -> Projects -> Visits, and Contacts under Clients (not linked to Projects)
const forms = [
  { id: 'clients', name: 'Clients', titleField: 'name', children: [{ formId: 'projects' }, { formId: 'contacts' }], fields: [
    { id: 'name', type: 'text', label: 'Company name' },
    { id: 'industry', type: 'text', label: 'Industry' },
    { id: 'status', type: 'select', label: 'Status', options: ['Lead', 'Active', 'Paused'] }] },
  { id: 'projects', name: 'Projects', titleField: 'title', children: [{ formId: 'visits' }], fields: [
    { id: 'title', type: 'text', label: 'Project name' },
    { id: 'stage', type: 'select', label: 'Stage', options: ['Scoping', 'In progress', 'Done'] },
    { id: 'budget', type: 'currency', label: 'Budget' },
    { id: 'due', type: 'date', label: 'Due date' },
    { id: 'brief', type: 'textarea', label: 'Brief' },
    { id: 'h1', type: 'heading', label: 'Section' }] },
  { id: 'visits', name: 'Site visits', titleField: 'sum', children: [], fields: [
    { id: 'sum', type: 'text', label: 'Summary' },
    { id: 'when', type: 'datetime', label: 'Visited at' },
    { id: 'safe', type: 'checkbox', label: 'Safety briefing' },
    { id: 'issues', type: 'multiselect', label: 'Issues', options: ['Access', 'Power', 'None'] },
    { id: 'crew', type: 'number', label: 'Crew' }] },
  { id: 'contacts', name: 'Contacts', titleField: 'kname', children: [], fields: [{ id: 'kname', type: 'text', label: 'Name' }] },
];
const rec = (id, formId, values, parentId = null, extra = {}) => ({ id, formId, values, parentId, ownerId: 'u1', createdAt: 1, ...extra });
const records = [
  rec('c1', 'clients', { name: 'Acme', industry: 'Retail', status: 'Active' }),
  rec('c2', 'clients', { name: 'Globex', industry: 'Health', status: 'Lead' }),
  rec('p1', 'projects', { title: 'Lobby', stage: 'In progress', budget: 100, due: '2026-10-20' }, 'c1'),
  rec('p2', 'projects', { title: 'Roof', stage: 'Done', budget: 50 }, 'c1'),
  rec('p3', 'projects', { title: 'Wiring', stage: 'Scoping', budget: 25 }, 'c2'),
  rec('v1', 'visits', { sum: 'Check', when: '2026-10-12T09:00', safe: true, issues: ['Access', 'Power'], crew: 3 }, 'p1'),
  rec('v2', 'visits', { sum: 'Check', when: '2026-10-05T09:00', safe: false, issues: ['None'], crew: 5 }, 'p3'),
];
const byF = new Map(forms.map((f) => [f.id, f]));
const byR = new Map(records.map((r) => [r.id, r]));
const ctx = { forms, records, profiles: { u1: { displayName: 'Adam' } }, formById: (id) => byF.get(id) || null, recById: (id) => byR.get(id) || null, fmt: (f, v) => (f.type === 'currency' ? '$' + v : Array.isArray(v) ? v.join(', ') : String(v)), recTitle: (r) => r.values.name || r.values.title || r.id };

test('parent chains and values through parents', () => {
  assert.deepEqual(chainOf(ctx, 'visits'), ['visits', 'projects', 'clients']);
  assert.equal(valueOf(ctx, byR.get('v1'), { form: 'clients', id: 'industry' }), 'Retail');
  assert.equal(valueOf(ctx, byR.get('v2'), { form: 'projects', id: 'budget' }), 25);
  assert.equal(valueOf(ctx, byR.get('p1'), { form: 'projects', id: '_owner' }), 'u1');
  assert.equal(valueOf(ctx, byR.get('p1'), { form: 'contacts', id: 'kname' }), undefined);
});

test('field kinds and the fields a report offers', () => {
  const p = byF.get('projects');
  assert.equal(kindOf(p.fields[1], p), 'group');
  assert.equal(kindOf(p.fields[2], p), 'num');
  assert.equal(kindOf(p.fields[3], p), 'date');
  assert.equal(kindOf(p.fields[0], p), 'key');
  assert.equal(kindOf(p.fields[4], p), 'other');
  assert.ok(!reportFields(p).some((f) => f.type === 'heading'));
  assert.ok(reportFields(p).some((f) => f.id === '_created'));
});

test('filters: is, is not, multiple choice and yes/no', () => {
  const w = { form: 'projects', filter: { ref: { form: 'projects', id: 'stage' }, op: 'not', value: 'Done' } };
  assert.deepEqual(rowsOf(ctx, w).map((r) => r.id), ['p1', 'p3']);
  assert.deepEqual(rowsOf(ctx, { form: 'visits', filter: { ref: { form: 'visits', id: 'issues' }, op: 'is', value: 'Power' } }).map((r) => r.id), ['v1']);
  assert.deepEqual(rowsOf(ctx, { form: 'visits', filter: { ref: { form: 'visits', id: 'safe' }, op: 'is', value: 'No' } }).map((r) => r.id), ['v2']);
  assert.deepEqual(rowsOf(ctx, { form: 'projects', filter: { ref: { form: 'clients', id: 'status' }, op: 'is', value: 'Active' } }).map((r) => r.id), ['p1', 'p2']);
});

test('count, total and average', () => {
  const list = rowsOf(ctx, { form: 'projects' });
  assert.equal(measureOf(ctx, { measure: { fn: 'count' } }, list), 3);
  assert.equal(measureOf(ctx, { measure: { fn: 'sum', ref: { form: 'projects', id: 'budget' } } }, list), 175);
  assert.equal(measureOf(ctx, { measure: { fn: 'avg', ref: { form: 'visits', id: 'crew' } } }, rowsOf(ctx, { form: 'visits' })), 4);
  assert.equal(measureOf(ctx, { measure: { fn: 'avg', ref: { form: 'projects', id: 'budget' } } }, []), null);
});

test('grouping follows option order, joins parents, and splits multiple choice', () => {
  const w = { form: 'projects', measure: { fn: 'sum', ref: { form: 'projects', id: 'budget' } }, group: { form: 'projects', id: 'stage' } };
  assert.deepEqual(groupsOf(ctx, w, rowsOf(ctx, w)).map((x) => x.key + '=' + x.value), ['Scoping=25', 'In progress=100', 'Done=50']);
  const j = { form: 'projects', measure: { fn: 'sum', ref: { form: 'projects', id: 'budget' } }, group: { form: 'clients', id: 'industry' } };
  assert.deepEqual(groupsOf(ctx, j, rowsOf(ctx, j)).map((x) => x.key + '=' + x.value), ['Retail=150', 'Health=25']);
  const m = { form: 'visits', measure: { fn: 'count' }, group: { form: 'visits', id: 'issues' } };
  assert.deepEqual(groupsOf(ctx, m, rowsOf(ctx, m)).map((x) => x.key + '=' + x.value), ['Access=1', 'Power=1', 'None=1']);
});

test('more than eight groups fold into Other', () => {
  const many = Array.from({ length: 12 }, (_, i) => rec('x' + i, 'clients', { name: 'C' + i, industry: 'I' + i }));
  const c2 = { ...ctx, records: many };
  const items = groupsOf(c2, { form: 'clients', measure: { fn: 'count' }, group: { form: 'clients', id: 'industry' } }, many);
  assert.equal(items.length, 8);
  assert.equal(items[7].key, 'Other (5)');
  assert.equal(items[7].value, 5);
});

test('weekly buckets count records in the right week', () => {
  const w = { form: 'visits', measure: { fn: 'count' }, time: { form: 'visits', id: 'when' }, interval: 'week' };
  const b = bucketsOf(ctx, w, rowsOf(ctx, w), new Date('2026-10-13T12:00').getTime());
  assert.equal(b.length, 26);
  assert.equal(b[25].value, 1); // week of Oct 12
  assert.equal(b[24].value, 1); // week of Oct 5
  assert.equal(b.reduce((a, x) => a + x.value, 0), 2);
  const m = bucketsOf(ctx, { ...w, interval: 'month' }, rowsOf(ctx, w), new Date('2026-10-13T12:00').getTime());
  assert.equal(m.length, 12);
  assert.equal(m[11].value, 2);
});

test('charts over time can follow the records’ dates, a chosen range, or a dashboard period', () => {
  const now = new Date('2026-10-13T12:00').getTime();
  const w = { form: 'visits', type: 'line', measure: { fn: 'count' }, time: { form: 'visits', id: 'when' }, interval: 'week', span: 'fit' };
  const fit = bucketsOf(ctx, w, rowsOf(ctx, w), now);
  assert.equal(fit.length, 2, 'just the weeks from the first visit to the last');
  assert.deepEqual(fit.map((x) => x.value), [1, 1]);
  assert.equal(fit[0].date.getDate(), 5); // week of Monday Oct 5
  const old = [{ id: 'o1', formId: 'visits', values: { when: '2020-08-03T10:00' } }, { id: 'o2', formId: 'visits', values: { when: '2021-02-14T10:00' } }];
  const om = bucketsOf(ctx, { ...w, interval: 'month' }, old, now);
  assert.equal(om.length, 7, 'Aug 2020 to Feb 2021, years ago');
  assert.equal(om[0].date.getFullYear(), 2020); assert.equal(om[6].value, 1);
  const q = bucketsOf(ctx, { ...w, interval: 'quarter' }, old, now);
  assert.deepEqual(q.map((x) => [x.date.getFullYear(), x.date.getMonth(), x.value]), [[2020, 6, 1], [2020, 9, 0], [2021, 0, 1]]);
  const cu = bucketsOf(ctx, { ...w, interval: 'month', span: 'custom', from: '2020-10-01', to: '2020-12-31' }, old, now);
  assert.deepEqual(cu.map((x) => x.date.getMonth()), [9, 10, 11]);
  const half = bucketsOf(ctx, { ...w, interval: 'year', span: 'custom', from: '2019-05-01' }, old, now);
  assert.deepEqual(half.map((x) => [x.date.getFullYear(), x.value]), [[2019, 0], [2020, 1], [2021, 1]], 'a blank end follows the records');
  const yr = bucketsOf(ctx, { ...w, interval: 'month' }, rowsOf(ctx, w), now, { from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
  assert.equal(yr.length, 10, 'This year: Jan to now');
  assert.equal(bucketsOf(ctx, { ...w, span: 'fit' }, [], now).length, 26, 'no records: the last 26 weeks');
});

test('a dropped field makes the right widget', () => {
  assert.equal(widgetFor(ctx, { form: 'projects', id: 'budget' }, 'a').type, 'kpi');
  assert.equal(widgetFor(ctx, { form: 'projects', id: 'stage' }, 'b').type, 'bar');
  assert.equal(widgetFor(ctx, { form: 'visits', id: 'when' }, 'c').type, 'line');
  const t = widgetFor(ctx, { form: 'projects', id: 'title' }, 'd');
  assert.equal(t.type, 'table');
  assert.deepEqual(t.columns.slice(0, 2), [{ form: 'projects', id: 'title' }, { form: 'clients', id: 'name' }]);
  assert.equal(widgetFor(ctx, { form: 'projects', id: 'brief' }, 'e').type, 'table');
});

test('dropping onto a widget changes it, joins, re-bases or refuses', () => {
  const bar = widgetFor(ctx, { form: 'projects', id: 'stage' }, 'w');
  let r = dropField(ctx, bar, { form: 'projects', id: 'budget' });
  assert.deepEqual(r.widget.measure, { fn: 'sum', ref: { form: 'projects', id: 'budget' } });
  r = dropField(ctx, r.widget, { form: 'clients', id: 'industry' });
  assert.deepEqual(r.widget.group, { form: 'clients', id: 'industry' });
  assert.equal(r.widget.form, 'projects');
  r = dropField(ctx, bar, { form: 'visits', id: 'crew' });
  assert.equal(r.widget.form, 'visits');
  assert.match(r.message, /now counts site visits/);
  r = dropField(ctx, bar, { form: 'contacts', id: 'kname' });
  assert.equal(r.widget, null);
  assert.match(r.message, /aren’t linked/);
  r = dropField(ctx, bar, { form: 'visits', id: 'when' });
  assert.equal(r.widget.type, 'line');
  const tbl = widgetFor(ctx, { form: 'projects', id: 'title' }, 't');
  r = dropField(ctx, tbl, { form: 'projects', id: 'brief' });
  assert.ok(r.widget.columns.some((c) => c.id === 'brief'));
  r = dropField(ctx, bar, { form: 'projects', id: 'brief' });
  assert.equal(r.widget, null);
});

test('switching type fills in what the new type needs', () => {
  const k = widgetFor(ctx, { form: 'projects', id: 'budget' }, 'k');
  const b = changeType(ctx, k, 'bar');
  assert.ok(b.group);
  const l = changeType(ctx, k, 'line');
  assert.deepEqual(l.time, { form: 'projects', id: 'due' });
  const t = changeType(ctx, k, 'table');
  assert.ok(t.columns.length >= 2);
  assert.equal(autoTitle(ctx, b), 'Total budget by stage');
  assert.deepEqual(defaultColumns(ctx, 'clients')[0], { form: 'clients', id: 'name' });
});

const rowsFull = (L, ws) => {
  const by = {};
  ws.forEach((w) => { const p = L[w.id]; (by[p.row] = by[p.row] || []).push(p); });
  return Object.values(by).every((ps) => ps.reduce((a, p) => a + p.c, 0) === 12 && ps.every((p) => p.h === ps[0].h));
};

test('the grid never leaves gaps, and rows share one height', () => {
  const ws = [{ id: 'a', cols: 3, rows: 1 }, { id: 'b', cols: 3, rows: 2 }, { id: 'c', cols: 6, rows: 2 }, { id: 'd', cols: 4, rows: 1 }, { id: 'e', cols: 12, rows: 3 }];
  const L = layout(ws);
  assert.ok(rowsFull(L, ws));
  assert.equal(L.a.h, 2); // shares the row with taller widgets
  assert.deepEqual([L.d.c0, L.d.c], [0, 12]); // alone in its row: fills it
  assert.equal(L._rows, 2 + 1 + 3);
  for (let n = 0; n < 50; n++) {
    const rnd = Array.from({ length: 1 + (n % 9) }, (_, i) => ({ id: 'w' + i, cols: [3, 4, 6, 8, 9, 12][(n * 7 + i * 5) % 6], rows: 1 + ((n + i) % 4) }));
    assert.ok(rowsFull(layout(rnd), rnd), 'row gap in case ' + n);
  }
});

test('resizing keeps the widget as asked, neighbours fill, and settling keeps it', () => {
  let ws = [{ id: 'a', cols: 6, rows: 2 }, { id: 'b', cols: 6, rows: 2 }];
  ws = resize(ws, 'a', 4, 3);
  const L = layout(ws, 'a');
  assert.deepEqual([L.a.c, L.b.c, L.a.h, L.b.h], [4, 8, 3, 3]);
  ws = settle(ws, 'a');
  assert.deepEqual(ws.map((w) => [w.cols, w.rows]), [[4, 3], [8, 3]]);
  assert.deepEqual(layout(ws).a, { c0: 0, c: 4, r0: 0, h: 3, row: 0 });
  assert.equal(snapCols(5), 4);
  assert.equal(snapCols(7), 6);
  assert.equal(snapCols(11), 12);
});

test('moving widgets', () => {
  const ws = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(move(ws, 'c', 'a').map((w) => w.id), ['c', 'a', 'b']);
  assert.deepEqual(move(ws, 'a', null).map((w) => w.id), ['b', 'c', 'a']);
  assert.equal(niceStep(37 / 4), 10);
});

test('report addresses', () => {
  assert.deepEqual(parseRoute('#/reports'), { kind: 'reports' });
  assert.deepEqual(parseRoute('#/report/r_1'), { kind: 'report', id: 'r_1' });
  assert.equal(routeFor({ name: 'reports' }), '#/reports');
  assert.equal(routeFor({ name: 'report', reportId: 'r 1' }), '#/report/r%201');
});

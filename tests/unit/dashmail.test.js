import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeKit } from '../../src/server/recordkit.js';
import { dashEmail, dueSlot, partsIn, recipients, scheduleText } from '../../src/dashmail.js';

const ex = JSON.parse(readFileSync(new URL('../../src/examples.json', import.meta.url)));
const k = makeKit({ forms: ex.forms, records: ex.records });
const c = { forms: ex.forms, records: ex.records, profiles: {}, formById: k.formById, recById: k.recById, valOf: (f, r, form) => k.valOf(f, r, form), fmt: (f, v) => k.fmt(f, v), recTitle: (r) => k.recTitle(r, k.formById(r.formId)) };
const P = (id) => ({ form: 'f_projects', id });
const reports = new Map([
  ['k', { name: 'Projects', def: { form: 'f_projects', type: 'kpi', measure: { fn: 'count' } } }],
  ['b', { name: 'Budget by stage', def: { form: 'f_projects', type: 'bar', group: P('p_stage'), measure: { fn: 'sum', ref: P('p_budget') } } }],
  ['d', { name: 'Clients', def: { form: 'f_clients', type: 'donut', group: { form: 'f_clients', id: 'c_status' } } }],
  ['l', { name: 'Starts', def: { form: 'f_projects', type: 'line', time: P('p_start'), interval: 'month', span: 'fit' } }],
  ['g', { name: 'Grouped', def: { form: 'f_projects', type: 'grouped', group: P('p_stage'), columns: [P('p_title')] } }],
  ['t', { name: 'All projects', def: { form: 'f_projects', type: 'table', columns: [P('p_title'), P('p_budget')] } }],
]);
const dash = { name: 'Pipeline <weekly>', filters: { period: 'all' }, tiles: [
  { id: '1', report: 'k', x: 0, y: 0, w: 6, h: 3 }, { id: '2', report: 'b', x: 6, y: 0, w: 12, h: 6 }, { id: '3', text: { title: 'Notes', body: 'Ring Bea.' }, x: 0, y: 3, w: 6, h: 3 },
  { id: '4', report: 'd', x: 0, y: 6, w: 8, h: 6 }, { id: '5', report: 'l', x: 8, y: 6, w: 8, h: 6 }, { id: '6', report: 'g', x: 0, y: 12, w: 12, h: 6 }, { id: '7', report: 't', x: 12, y: 12, w: 12, h: 6 }, { id: '8', report: 'gone', x: 0, y: 18, w: 6, h: 3 },
] };

test('the email: every report as tables a mail program can show, in reading order', () => {
  const m = dashEmail(c, dash, reports, { now: Date.UTC(2026, 9, 19, 12), link: 'https://fw.example/#/dashboard/x', schedule: { freq: 'weekly', day: 1, hour: 8 } });
  assert.match(m.subject, /^Pipeline <weekly> · Oct 19$/);
  assert.ok(m.html.includes('Pipeline &lt;weekly&gt;') && !m.html.includes('<weekly>'), 'names are escaped');
  const order = ['Projects', 'Budget by stage', 'Notes', 'Clients', 'Starts', 'Grouped', 'All projects'].map((n) => m.html.indexOf('>' + n + '<'));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'reading order ' + order);
  assert.ok(!/<script|<svg|<style/i.test(m.html), 'no scripts, SVG or style blocks');
  assert.match(m.html, /Open the dashboard/);
  assert.match(m.html, /Every Monday at 8:00 AM/);
  const projects = ex.records.filter((r) => r.formId === 'f_projects').length;
  assert.match(m.text, new RegExp('Projects: Number of projects: ' + projects));
  assert.match(m.text, /Budget by stage: .*\$/);
  assert.match(m.text, /All projects: \d+ records/);
  assert.match(m.text, /Notes: Ring Bea\./);
});

test('when a schedule is due, and who it goes to', () => {
  const mon8 = partsIn(Date.UTC(2026, 9, 19, 12, 5), 'America/Toronto'); // 8:05 in Toronto
  assert.deepEqual(mon8, { key: '2026-10-19', hour: 8, dow: 1, dom: 19 });
  assert.equal(dueSlot({ on: true, freq: 'weekly', day: 1, hour: 8 }, mon8), '2026-10-19T08');
  assert.equal(dueSlot({ on: true, freq: 'weekly', day: 1, hour: 8, lastSlot: '2026-10-19T08' }, mon8), '', 'once per slot');
  assert.equal(dueSlot({ on: true, freq: 'weekly', day: 2, hour: 8 }, mon8), '');
  assert.equal(dueSlot({ on: true, freq: 'weekdays', hour: 8 }, mon8), '2026-10-19T08');
  assert.equal(dueSlot({ on: true, freq: 'weekdays', hour: 8 }, { ...mon8, dow: 6 }), '', 'not on Saturday');
  assert.equal(dueSlot({ on: true, freq: 'monthly', day: 19, hour: 8 }, mon8), '2026-10-19T08');
  assert.equal(dueSlot({ on: false, freq: 'daily', hour: 8 }, mon8), '');
  assert.equal(scheduleText({ freq: 'monthly', day: 1, hour: 13 }), 'On the 1st of every month at 1:00 PM');
  const people = new Map([['a', { email: 'A@x.example' }], ['b', { email: 'b@x.example' }], ['c', { email: '' }]]);
  assert.deepEqual(recipients({ to: { people: ['a', 'c'], roles: ['r'], addresses: 'b@x.example, bad, z@y.example' } }, people, () => ['b']), ['a@x.example', 'b@x.example', 'z@y.example']);
});

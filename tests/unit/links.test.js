import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeFor } from '../../src/route.js';
import { sortTasks, dueInfo, whoLine, cadenceLink, donePatch, repeats, dateKey } from '../../src/tasks.js';

test('record and form addresses round-trip', () => {
  assert.deepEqual(parseRoute('#/record/r_123'), { kind: 'record', id: 'r_123' });
  assert.deepEqual(parseRoute('#/form/f_clients/'), { kind: 'form', id: 'f_clients' });
  assert.equal(routeFor({ name: 'record', formId: 'f', recordId: 'a b' }), '#/record/a%20b');
  assert.deepEqual(parseRoute(routeFor({ name: 'record', formId: 'f', recordId: 'a b' })), { kind: 'record', id: 'a b' });
  assert.equal(routeFor({ name: 'records', formId: 'f_x' }), '#/form/f_x');
});

test('other screens and bad addresses get no route', () => {
  assert.equal(routeFor({ name: 'record', formId: 'f', recordId: null }), '');
  assert.equal(routeFor({ name: 'designer' }), '');
  assert.equal(parseRoute(''), null);
  assert.equal(parseRoute('#/record/'), null);
  assert.equal(parseRoute('#/users/x'), null);
  assert.equal(parseRoute('#/record/%E0%A4%A'), null);
});

test('open tasks by due date, undated after, then done tasks newest first', () => {
  const list = [
    { title: 'done old', done: true, doneAt: 1 },
    { title: 'later', due: '2026-10-20' },
    { title: 'no date' },
    { title: 'soon', due: '2026-10-13', time: '09:00' },
    { title: 'done new', done: true, doneAt: 5 },
    { title: 'soon earlier', due: '2026-10-13', time: '08:00' },
  ];
  assert.deepEqual(sortTasks(list).map((t) => t.title), ['soon earlier', 'soon', 'later', 'no date', 'done new', 'done old']);
});

test('due dates read naturally', () => {
  assert.deepEqual(dueInfo('2026-10-12', '2026-10-12'), { text: 'Today', tone: 'today' });
  assert.equal(dueInfo('2026-10-13', '2026-10-12').text, 'Tomorrow');
  assert.equal(dueInfo('2026-10-11', '2026-10-12').tone, 'late');
  assert.match(dueInfo('2026-10-02', '2026-10-12').text, /10d late$/);
  assert.equal(dueInfo(null, '2026-10-12').text, 'No date');
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('who else is on the task', () => {
  const t = { ownerId: 'a', ownerName: 'Adam Pollack', assigneeId: 'f', assigneeName: 'Farren Applebaum' };
  assert.equal(whoLine(t, 'a'), 'Assigned to Farren');
  assert.equal(whoLine(t, 'f'), 'From Adam');
  assert.equal(whoLine({ ownerId: 'a' }, 'a'), '');
});

test('links into Cadence', () => {
  assert.equal(cadenceLink('https://x.github.io/cadence/', { addTaskFor: 'r 1' }), 'https://x.github.io/cadence/?addTaskFor=r+1');
  assert.equal(cadenceLink('https://x.github.io/cadence/#list', { task: 't1' }), 'https://x.github.io/cadence/?task=t1');
  assert.equal(cadenceLink('', { task: 't1' }), '');
});

test('ticking off matches what Cadence writes', () => {
  assert.deepEqual(donePatch(true, 'u', 7), { done: true, doneAt: 7, doneBy: 'u', updatedAt: 7 });
  assert.deepEqual(donePatch(false, 'u', 8), { done: false, doneAt: null, doneBy: null, updatedAt: 8 });
  assert.equal(repeats({ repeat: 'weekly' }), true);
  assert.equal(repeats({ repeat: 'none' }), false);
});

test('a task can be found by its title, notes, people, due text, repeat and subtasks', async () => {
  const { taskText } = await import('../../src/tasks.js');
  const t = { title: 'Send invoice', notes: 'Attach the timesheet', ownerName: 'Adam Pollack', assigneeName: 'Sam Ritchie', due: '2026-10-16', repeat: 'monthly', subtasks: [{ title: 'Check hours' }, 'Export PDF'] };
  const text = taskText(t, '2026-10-14').toLowerCase();
  for (const w of ['send invoice', 'timesheet', 'sam', 'adam', 'repeats monthly', 'check hours', 'export pdf', '2026-10-16']) assert.ok(text.includes(w), w);
  assert.ok(taskText({ title: 'x', done: true }, '2026-10-14').includes('Done'));
  assert.equal(taskText({}, '2026-10-14'), 'No date');
});

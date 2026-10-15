// Workflows (src/workflow.js): stages, who works on a record, what each stage shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../../src/workflow.js';
import { triggerText, checkAutomation } from '../../src/autologic.js';
import { makeKit } from '../../src/server/recordkit.js';

const stages = [
  { id: 's1', name: 'Draft', assign: { type: 'owner' }, fields: { appr: 'hide', hA: 'hide' }, moves: [{ id: 'm1', label: 'Send to Review', to: 's2' }] },
  { id: 's2', name: 'Review', assign: { type: 'group', group: 'g_rev' }, fields: { amt: 'view', note: 'req' }, sections: { 'c:f_kid': 'hide' }, moves: [{ id: 'm2', label: 'Approve', to: 's3' }, { id: 'm3', label: 'Send back', to: 's1', comment: true }, { id: 'm4', label: 'Gone', to: 'zz' }] },
  { id: 's3', name: 'Approved', assign: { type: 'keep' }, fields: { hA: 'view' }, moves: [] },
];
const form = { id: 'f', name: 'Requests', fields: [{ id: 'amt', type: 'currency', label: 'Amount' }, { id: 'note', type: 'text', label: 'Note' }, { id: 'hA', type: 'heading', label: 'Approval' }, { id: 'appr', type: 'text', label: 'Approver' }, { id: 'when', type: 'date', label: 'Approved on' }], workflow: { on: true, stages } };
const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

test('on/off and lookups', () => {
  assert.equal(W.wfOn(form), true);
  assert.equal(W.wfOn({ ...form, workflow: { on: false, stages } }), false);
  assert.equal(W.wfOn({ ...form, workflow: { on: true, stages: [] } }), false);
  assert.equal(W.firstStage(form).id, 's1');
  assert.equal(W.stageIndex(form, 's3'), 2);
  assert.equal(W.stageName(form, { stage: 's2' }), 'Review');
  assert.equal(W.stageName(form, { stage: 'nope' }), '');
});

test('the Stage pseudo field', () => {
  const f = W.withStageField(form);
  const s = f.fields.at(-1);
  assert.equal(s.id, W.STAGE_FIELD);
  assert.deepEqual(s.options, ['Draft', 'Review', 'Approved']);
  assert.equal(form.fields.length, 5, 'original untouched');
  const off = { ...form, workflow: { on: false } };
  assert.equal(W.withStageField(off), off);
});

test('what each stage shows', () => {
  const d = W.stageView(form, 's1');
  assert.ok(d.keys.has('f:hA'), 'section hidden');
  assert.ok(d.hide.has('appr') && d.hide.has('when'), 'fields under a hidden heading are hidden');
  const r = W.stageView(form, 's2');
  assert.ok(r.view.has('amt'));
  assert.ok(r.req.has('note'));
  assert.ok(r.keys.has('c:f_kid'));
  const a = W.stageView(form, 's3');
  assert.ok(a.view.has('appr') && a.view.has('when'), 'view-only heading makes its fields view only');
  assert.equal(W.stageView(form, 'zz').hide.size, 0);
});

test('who can work on it', () => {
  const rec = { stage: 's2', assignee: null, assigneeGroup: 'g_rev' };
  assert.equal(W.canWork(rec, { role: 'admin' }), true);
  assert.equal(W.canWork(rec, { uid: 'u1', groups: ['g_rev'] }), true);
  assert.equal(W.canWork(rec, { uid: 'u1', groups: ['g_x'] }), false);
  assert.equal(W.canWork({ stage: 's1', assignee: 'u1' }, { id: 'u1' }), true);
  assert.equal(W.canWork({ stage: 's1', assignee: 'u2' }, { uid: 'u1' }), false);
  assert.equal(W.canWork({}, { uid: 'u1' }), true, 'not in the workflow yet');
  assert.equal(W.canWork(rec, null), false);
});

test('who a stage goes to', () => {
  const rec = { ownerId: 'own', assignee: 'u7', assigneeGroup: null };
  assert.deepEqual(W.assigneeFor({ assign: { type: 'owner' } }, rec, 'mv'), { assignee: 'own', assigneeGroup: null });
  assert.deepEqual(W.assigneeFor({ assign: { type: 'person', person: 'p' } }, rec, 'mv'), { assignee: 'p', assigneeGroup: null });
  assert.deepEqual(W.assigneeFor({ assign: { type: 'group', group: 'g' } }, rec, 'mv'), { assignee: null, assigneeGroup: 'g' });
  assert.deepEqual(W.assigneeFor({ assign: { type: 'mover' } }, rec, 'mv'), { assignee: 'mv', assigneeGroup: null });
  assert.deepEqual(W.assigneeFor({ assign: { type: 'keep' } }, rec, 'mv'), { assignee: 'u7', assigneeGroup: null });
  assert.deepEqual(W.assigneeFor({ assign: { type: 'keep' } }, { ownerId: 'own' }, 'mv'), { assignee: 'own', assigneeGroup: null }, 'keep with nobody falls back to the owner');
});

test('buttons and required-before-moving-on', () => {
  assert.deepEqual(W.movesOf(form, 's2').map((m) => m.label), ['Approve', 'Send back'], 'button to a missing stage left out');
  assert.deepEqual(W.missingToMove(form, 's2', { note: '' }, blank).map((f) => f.id), ['note']);
  assert.deepEqual(W.missingToMove(form, 's2', { note: 'ok' }, blank), []);
  assert.deepEqual(W.missingToMove(form, 's2', {}, blank, new Set(['note'])), [], 'rule-hidden fields are not required');
  const d = W.defaultMoves(stages, 1);
  assert.deepEqual(d.map((m) => [m.label, m.to, m.comment]), [['Complete', 's3', false], ['Send back', 's1', true]]);
  assert.equal(W.defaultMoves(stages, 0)[0].label, 'Send to Review');
});

test('set-up checks', () => {
  assert.deepEqual(W.checkWorkflow(form), ['“Review”: “Gone” goes to a stage that no longer exists.']);
  assert.deepEqual(W.checkWorkflow({ workflow: { on: true, stages: [] } }), ['Add at least one stage.']);
  const bad = { workflow: { on: true, stages: [{ id: 'a', name: '', assign: { type: 'person' } }, { id: 'b', name: 'X', assign: { type: 'group', group: 'old' }, moves: [{ label: 'Go', to: 'zz' }] }, { id: 'c', name: 'x' }] } };
  const p = W.checkWorkflow(bad, { groups: new Set(['g1']) });
  assert.ok(p.includes('Stage 1 needs a name.'));
  assert.ok(p.includes('Stage 1: pick who it goes to.'));
  assert.ok(p.includes('“X”: that security group no longer exists.'));
  assert.ok(p.some((s) => s.includes('goes to a stage that no longer exists')));
  assert.ok(p.includes('Two stages are called “x”.'));
});

test('waited', () => {
  const now = Date.UTC(2026, 9, 15);
  assert.equal(W.waited(0, now), '');
  assert.equal(W.waited(now - 1000, now), 'today');
  assert.equal(W.waited(now - 864e5, now), '1 day');
  assert.equal(W.waited(now - 5 * 864e5, now), '5 days');
});

test('stage trigger wording and checks', () => {
  assert.equal(triggerText({ trigger: { type: 'stage', to: 's2' } }, { ...form, itemName: 'Request' }), 'When a request moves to Review');
  assert.equal(triggerText({ trigger: { type: 'stage' } }, { ...form, itemName: 'Request' }), 'When a request moves to any stage');
  const a = { name: 'x', formId: 'f', trigger: { type: 'stage', to: 'gone' }, acts: [{ do: 'task', title: 't', assign: 'owner' }] };
  assert.deepEqual(checkAutomation(a, form), ['That stage no longer exists.']);
  assert.deepEqual(checkAutomation(a, { ...form, workflow: { on: false } }), ['This form has no workflow (form designer → Workflow).', 'That stage no longer exists.']);
});

test('server kit: stage in values and hidden from the PDF', () => {
  const rec = { id: 'r', formId: 'f', stage: 's1', values: { amt: 5, note: 'n', appr: 'Bo' } };
  const kit = makeKit({ forms: [form], records: [rec], locale: 'en-CA', timeZone: 'America/Toronto' });
  assert.equal(kit.valOf({ id: W.STAGE_FIELD }, rec, form), 'Draft');
  const m = kit.pdfModel(form, rec);
  const labels = JSON.stringify(m);
  assert.ok(!labels.includes('Approver'), 'stage-hidden field left out of the PDF');
  assert.ok(labels.includes('Amount'));
});

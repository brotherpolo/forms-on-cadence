// Show/hide rules (src/rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, testCond, toClear, withoutCleared, checkRules, ruleText, pruneRules, impactOf, targetsOf, actionFits, sameRules, NO_RULES, isBlank, opsFor } from '../../src/rules.js';

const F = (id, type, extra = {}) => ({ id, type, label: id[0].toUpperCase() + id.slice(1), ...extra });
const form = (rules, more = []) => ({ id: 'f_job', fields: [
  F('status', 'select', { options: ['Open', 'Scheduled', 'Closed'] }), F('type', 'radio', { options: ['Repair', 'Install'] }),
  F('tags', 'multiselect', { options: ['Roof', 'Wall'] }), F('urgent', 'checkbox'), F('hours', 'number'), F('due', 'date'),
  F('notes', 'textarea'), F('sec', 'heading'), F('warranty', 'text'), F('wend', 'date', { required: true }), ...more], rules });
const getter = (values, parents = {}) => (src, fid) => {
  if (src === 'self') return { v: values[fid] };
  const p = parents[src]; if (!p) return null;
  const f = p.fields.find((x) => x.id === fid); return f ? { f, v: p.values[fid] } : null;
};
const R = (conds, acts, join = 'all') => ({ id: 'r' + Math.random().toString(36).slice(2, 6), join, conds, acts });
const C = (field, op, value, src = 'self') => ({ id: 'c', src, field, op, value });

test('comparisons', () => {
  const sel = F('s', 'select', { options: ['A', 'B'] });
  assert.equal(testCond(C('s', 'is', 'A'), 'A', sel), true);
  assert.equal(testCond(C('s', 'anyof', ['A', 'B']), 'B', sel), true);
  assert.equal(testCond(C('s', 'noneof', ['A']), '', sel), true);
  assert.equal(testCond(C('s', 'is', ''), 'A', sel), false, 'unfinished never holds');
  const n = F('n', 'currency');
  assert.equal(testCond(C('n', 'gt', '100'), 150, n), true);
  assert.equal(testCond(C('n', 'le', 100), 100, n), true);
  assert.equal(testCond(C('n', 'ne', 5), null, n), true);
  assert.equal(testCond(C('n', 'gt', 5), null, n), false);
  const d = F('d', 'datetime');
  assert.equal(testCond(C('d', 'before', '2026-10-15'), '2026-10-14T23:00', d), true);
  assert.equal(testCond(C('d', 'on', '2026-10-15'), '2026-10-15T09:00', d), true);
  const t = F('t', 'text');
  assert.equal(testCond(C('t', 'contains', 'ROOF'), 'Flat roof leak', t), true);
  assert.equal(testCond(C('t', 'is', 'abc'), ' ABC ', t), true);
  const m = F('m', 'multiselect', { options: ['Roof', 'Wall'] });
  assert.equal(testCond(C('m', 'has', 'Roof'), ['Roof'], m), true);
  assert.equal(testCond(C('m', 'hasany', ['Wall', 'X']), ['Roof'], m), false);
  const b = F('b', 'checkbox');
  assert.equal(testCond(C('b', 'yes'), true, b), true);
  assert.equal(testCond(C('b', 'no'), undefined, b), true);
  assert.equal(testCond(C('x', 'empty'), { name: '', lat: null }, F('x', 'location')), true);
  assert.equal(testCond(C('x', 'filled'), { name: 'a.pdf', url: 'u' }, F('x', 'file')), true);
  assert.deepEqual(opsFor(F('p', 'image')).map((o) => o.key), ['empty', 'filled']);
  assert.equal(isBlank(0), false);
});

test('show when…: hidden otherwise; hide wins; a heading hides its section', () => {
  const fm = form([R([C('type', 'is', 'Repair')], [{ do: 'show', targets: ['f:sec'] }]), R([C('status', 'is', 'Closed')], [{ do: 'hide', targets: ['f:sec', 't:tasks', 'g:f_lines'] }])]);
  let st = evaluate(fm, getter({ type: 'Install' }));
  assert.ok(st.hiddenFields.has('warranty') && st.hiddenFields.has('wend') && st.hidden.has('f:sec'));
  assert.ok(!st.hidden.has('t:tasks'));
  st = evaluate(fm, getter({ type: 'Repair' }));
  assert.ok(!st.hiddenFields.has('warranty'));
  st = evaluate(fm, getter({ type: 'Repair', status: 'Closed' }));
  assert.ok(st.hiddenFields.has('warranty') && st.hidden.has('t:tasks') && st.hidden.has('g:f_lines'), 'hide beats show');
});

test('required: set required / not required, never while hidden', () => {
  const fm = form([R([C('status', 'is', 'Scheduled')], [{ do: 'require', targets: ['f:due'] }]), R([C('type', 'is', 'Install')], [{ do: 'optional', targets: ['f:wend'] }])]);
  const due = fm.fields.find((f) => f.id === 'due'), wend = fm.fields.find((f) => f.id === 'wend');
  assert.equal(evaluate(fm, getter({ status: 'Scheduled' })).required(due), true);
  assert.equal(evaluate(fm, getter({ status: 'Open' })).required(due), false);
  assert.equal(evaluate(fm, getter({})).required(wend), true, 'as designed');
  assert.equal(evaluate(fm, getter({ type: 'Install' })).required(wend), false);
  const hid = form([R([C('urgent', 'yes')], [{ do: 'hide', targets: ['f:wend'] }])]);
  assert.equal(evaluate(hid, getter({ urgent: true })).required(hid.fields.find((f) => f.id === 'wend')), false);
  assert.equal(NO_RULES.required(wend), true);
});

test('clear value: locked and emptied while it applies; what a save empties', () => {
  const fm = form([R([C('status', 'is', 'Closed')], [{ do: 'clear', targets: ['f:hours', 'f:sec'] }, { do: 'hide', targets: ['f:notes'] }])]);
  const st = evaluate(fm, getter({ status: 'Closed', hours: 3, notes: 'x', warranty: '' }));
  assert.ok(st.cleared.has('hours') && !st.cleared.has('sec'), 'a heading has no value to clear');
  const vals = { status: 'Closed', hours: 3, notes: 'x', urgent: false };
  const ids = toClear(fm, vals, st);
  assert.deepEqual(ids.sort(), ['hours', 'notes']);
  assert.deepEqual(withoutCleared(vals, ids), { status: 'Closed', urgent: false });
  assert.deepEqual(vals.hours, 3, 'original untouched');
});

test('rules that depend on hidden fields see them as empty (chains settle)', () => {
  // hide Type when Status is Closed; show Warranty only when Type is Repair
  const fm = form([R([C('status', 'is', 'Closed')], [{ do: 'hide', targets: ['f:type'] }]), R([C('type', 'is', 'Repair')], [{ do: 'show', targets: ['f:warranty'] }])]);
  const st = evaluate(fm, getter({ status: 'Closed', type: 'Repair', warranty: 'W1' }));
  assert.ok(st.hiddenFields.has('type') && st.hiddenFields.has('warranty'));
  assert.deepEqual(toClear(fm, { status: 'Closed', type: 'Repair', warranty: 'W1' }, st).sort(), ['type', 'warranty']);
});

test('all / any and one level of groups', () => {
  const g = { id: 'g', group: true, join: 'all', conds: [C('type', 'is', 'Repair'), C('urgent', 'yes')] };
  const fm = form([R([g, C('hours', 'gt', 10)], [{ do: 'hide', targets: ['f:notes'] }], 'any')]);
  assert.ok(evaluate(fm, getter({ type: 'Repair', urgent: true })).hiddenFields.has('notes'));
  assert.ok(!evaluate(fm, getter({ type: 'Repair' })).hiddenFields.has('notes'));
  assert.ok(evaluate(fm, getter({ hours: 11 })).hiddenFields.has('notes'));
  const empty = form([R([], [{ do: 'hide', targets: ['f:notes'] }])]);
  assert.ok(!evaluate(empty, getter({})).hiddenFields.has('notes'), 'no conditions: never applies');
  const off = form([{ ...R([C('urgent', 'no')], [{ do: 'hide', targets: ['f:notes'] }]), off: true }]);
  assert.ok(!evaluate(off, getter({})).hiddenFields.has('notes'), 'switched-off rules are ignored');
});

test('conditions on the parent record', () => {
  const pf = { name: 'Clients', fields: [F('kind', 'select', { options: ['Retail', 'Trade'] })] };
  const fm = form([R([C('kind', 'is', 'Trade', 'f_cli')], [{ do: 'show', targets: ['f:warranty'] }])]);
  assert.ok(!evaluate(fm, getter({}, { f_cli: { ...pf, values: { kind: 'Trade' } } })).hiddenFields.has('warranty'));
  assert.ok(evaluate(fm, getter({}, { f_cli: { ...pf, values: { kind: 'Retail' } } })).hiddenFields.has('warranty'));
  assert.ok(evaluate(fm, getter({})).hiddenFields.has('warranty'), 'no parent of that form: the condition doesn’t hold');
});

test('designer checks, sentences and pruning', () => {
  const pf = new Map([['f_cli', { name: 'Clients', fields: [F('kind', 'select', { options: ['Retail'] })] }]]);
  const fm = form([
    R([C('status', 'is', 'Gone')], [{ do: 'hide', targets: ['f:status'] }]),
    R([C('urgent', 'yes')], [{ do: 'show', targets: ['f:notes'] }, { do: 'require', targets: ['t:tasks'] }]),
    R([C('kind', 'is', 'Retail', 'f_cli')], [{ do: 'hide', targets: ['f:notes'] }]),
    R([], []),
  ]);
  const targets = targetsOf(fm, { grids: [{ id: 'f_lines', name: 'Line items' }], kids: [], tasks: true });
  const msgs = checkRules(fm, { targets, parentFields: pf }).map((m) => m.text);
  assert.ok(msgs.some((m) => /“Gone” is no longer an option/.test(m)));
  assert.ok(msgs.some((m) => /hides Status, which its own condition looks at/.test(m)));
  assert.ok(msgs.some((m) => /Set required” doesn’t work on Tasks/.test(m)));
  assert.ok(msgs.some((m) => /Notes has both Show and Hide rules/.test(m)));
  assert.ok(msgs.some((m) => /Rule 4 has no conditions/.test(m)) && msgs.some((m) => /Rule 4 doesn’t do anything/.test(m)));
  assert.equal(ruleText(fm.rules[2], { form: fm, targets, parentFields: pf }), 'When Clients › Kind is Retail: hide Notes');
  const g = { id: 'g', group: true, join: 'any', conds: [C('type', 'is', 'Repair'), C('hours', 'gt', 5)] };
  assert.equal(ruleText(R([g, C('urgent', 'yes')], [{ do: 'clear', targets: ['f:hours'] }]), { form: fm, targets }), 'When (Type is Repair or Hours more than 5) and Urgent is Yes: clear value Hours');
  assert.ok(actionFits('clear', targets.find((t) => t.key === 'f:hours')) && !actionFits('clear', targets.find((t) => t.key === 'f:sec')) && actionFits('hide', targets.find((t) => t.key === 'g:f_lines')));
  const fewer = { ...fm, fields: fm.fields.filter((f) => f.id !== 'notes' && f.id !== 'urgent') };
  const pr = pruneRules(fewer, { targets: targetsOf(fewer, {}), parentFields: pf });
  assert.deepEqual(pr[1].conds, [], 'condition on a deleted field removed');
  assert.deepEqual(pr[1].acts, [], 'actions on deleted / unknown targets removed');
  assert.ok(sameRules(fm.rules, JSON.parse(JSON.stringify(fm.rules))) && !sameRules(fm.rules, pr));
});

test('impact on saved records', () => {
  const fm = form([R([C('status', 'is', 'Closed')], [{ do: 'hide', targets: ['f:sec'] }])]);
  const recs = [{ id: 'a', values: { status: 'Closed', warranty: 'W', wend: '2027-01-01' } }, { id: 'b', values: { status: 'Open', warranty: 'W' } }, { id: 'c', values: { status: 'Closed' } }];
  const out = impactOf(fm, recs, (r) => getter(r.values));
  assert.deepEqual(out.rows, [{ id: 'a', clear: ['warranty', 'wend'] }]);
  assert.deepEqual([...out.perField], [['warranty', 1], ['wend', 1]]);
});

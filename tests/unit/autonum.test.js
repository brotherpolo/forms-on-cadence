// Auto number fields: the designer's preview matches what the server hands out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatAuto, nextAuto, missingNumbers, autoSettings } from '../../src/autonum.js';

test('numbers look the way the settings say', () => {
  const f = { prefix: 'INV-', start: 1001, digits: 4 };
  assert.equal(formatAuto(f, 1001, 2026), 'INV-1001');
  assert.equal(formatAuto({ ...f, digits: 6 }, 7, 2026), 'INV-000007');
  assert.equal(formatAuto({ ...f, year: true, digits: 3 }, 7, 2026), 'INV-2026-007');
  assert.equal(formatAuto({}, 5, 2026), '5');
  assert.deepEqual(autoSettings({ start: -3, digits: 40, prefix: 'x'.repeat(30) }), { prefix: 'x'.repeat(20), start: 0, digits: 9, year: false });
});

test('the next number comes from the counter, never below the start', () => {
  const f = { start: 100 };
  assert.equal(nextAuto(f, null, 2026), 100);
  assert.equal(nextAuto(f, { next: 158 }, 2026), 158);
  assert.equal(nextAuto({ start: 500 }, { next: 158 }, 2026), 500);
  assert.equal(nextAuto({ start: 1, year: true }, { years: { 2025: 40 } }, 2026), 1, 'a new year starts again');
  assert.equal(nextAuto({ start: 1, year: true }, { years: { 2026: 12 } }, 2026), 12);
});

test('records still waiting for a number', () => {
  const recs = [{ formId: 'f', nums: { n: '1' } }, { formId: 'f', values: { n: '57' } }, { formId: 'f', values: {} }, { formId: 'g', values: {} }];
  assert.deepEqual(missingNumbers(recs, 'f', 'n'), { missing: 2, typed: 1 });
});

// Runs when the Cadence folder sits next to this one (as on a developer's machine); skipped in CI.
const SERVER = fileURLToPath(new URL('../../../cadence/functions/autonumber.js', import.meta.url));
test('the app and the server format numbers the same way', { skip: !existsSync(SERVER) && 'Cadence folder not here' }, () => {
  const server = createRequire(import.meta.url)(SERVER);
  for (const f of [{ prefix: 'INV-', digits: 4 }, { year: true, digits: 2 }, {}, { prefix: 'WO', start: 9, digits: 1, year: true }]) {
    for (const n of [1, 9, 42, 12345]) assert.equal(formatAuto(f, n, 2026), server.formatNumber(f, n, 2026));
  }
});

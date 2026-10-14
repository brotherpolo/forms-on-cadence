import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTheme, readTheme, applyTheme, themeLabel, THEME_KEY } from '../../src/theme.js';

const store = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; };
function fakeDoc() {
  const metas = [{ a: { name: 'theme-color', media: '(prefers-color-scheme: light)' } }, { a: { name: 'theme-color', media: '(prefers-color-scheme: dark)' } }]
    .map((x) => ({ getAttribute: (k) => x.a[k] ?? null, setAttribute: (k, v) => { x.a[k] = v; }, a: x.a }));
  return { documentElement: { dataset: {} }, querySelectorAll: () => metas, metas };
}

test('the button cycles Auto, Light, Dark', () => {
  assert.equal(nextTheme('auto'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'auto');
  assert.equal(nextTheme('purple'), 'light');
  assert.equal(themeLabel('dark'), 'Dark');
});

test('the choice is read per device, defaulting to Auto', () => {
  assert.equal(readTheme(store()), 'auto');
  assert.equal(readTheme(store({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(readTheme(store({ [THEME_KEY]: 'nonsense' })), 'auto');
  assert.equal(readTheme({ getItem() { throw new Error('blocked'); } }), 'auto');
});

test('applying a theme sets the page, the browser bar and the stored choice', () => {
  const d = fakeDoc(), s = store();
  applyTheme(d, 'light', s);
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.deepEqual(d.metas.map((m) => m.a.content), ['#ffffff', '#ffffff']);
  assert.equal(s.m[THEME_KEY], 'light');
  applyTheme(d, 'dark', s);
  assert.deepEqual(d.metas.map((m) => m.a.content), ['#171a23', '#171a23']);
  applyTheme(d, 'auto', s);
  assert.equal(d.documentElement.dataset.theme, undefined);
  assert.deepEqual(d.metas.map((m) => m.a.content), ['#ffffff', '#171a23']);
  assert.equal(THEME_KEY in s.m, false);
});

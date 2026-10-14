/* Light, dark or automatic (follow the device). The choice is kept per device in localStorage.
   index.html applies it before the page draws, so there is no flash of the wrong colours. */
export const THEMES = ['auto', 'light', 'dark'];
export const THEME_KEY = 'fw.theme';
// the browser bar colour for each look (matches --surface)
export const BAR = { light: '#ffffff', dark: '#171a23' };

export const nextTheme = (t) => THEMES[(THEMES.indexOf(THEMES.includes(t) ? t : 'auto') + 1) % THEMES.length];
export const themeLabel = (t) => ({ auto: 'Auto', light: 'Light', dark: 'Dark' })[t] || 'Auto';

export function readTheme(storage) {
  try { const t = storage && storage.getItem(THEME_KEY); return THEMES.includes(t) ? t : 'auto'; } catch (e) { return 'auto'; }
}

/** Put the choice on the page: data-theme on <html> (none = follow the device) and the browser bar colour. */
export function applyTheme(doc, t, storage) {
  const theme = THEMES.includes(t) ? t : 'auto';
  if (theme === 'auto') delete doc.documentElement.dataset.theme; else doc.documentElement.dataset.theme = theme;
  doc.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute('media') || '';
    const look = theme !== 'auto' ? theme : /dark/.test(media) ? 'dark' : 'light';
    m.setAttribute('content', BAR[look]);
  });
  if (storage) { try { if (theme === 'auto') storage.removeItem(THEME_KEY); else storage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ } }
  return theme;
}

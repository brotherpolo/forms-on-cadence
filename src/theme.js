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

/* Colour scheme and density, also per device. The scheme recolours the accent, the background and
   the sidebar; each has a light and a dark version (Light / Dark / Auto above still applies). */
export const SCHEMES = ['indigo', 'spruce', 'sand'];
export const SCHEME_KEY = 'fw.scheme';
export const schemeLabel = (s) => ({ indigo: 'Indigo', spruce: 'Spruce', sand: 'Sand' })[s] || 'Indigo';
export const DENSITIES = ['comfortable', 'compact'];
export const DENSITY_KEY = 'fw.density';
export const densityLabel = (d) => ({ comfortable: 'Comfortable', compact: 'Compact' })[d] || 'Comfortable';

function readOne(storage, key, list) {
  try { const v = storage && storage.getItem(key); return list.includes(v) ? v : list[0]; } catch (e) { return list[0]; }
}
function applyOne(doc, storage, key, list, attr, v) {
  const val = list.includes(v) ? v : list[0];
  if (val === list[0]) delete doc.documentElement.dataset[attr]; else doc.documentElement.dataset[attr] = val;
  if (storage) { try { if (val === list[0]) storage.removeItem(key); else storage.setItem(key, val); } catch (e) { /* private mode */ } }
  return val;
}
export const readScheme = (storage) => readOne(storage, SCHEME_KEY, SCHEMES);
export const applyScheme = (doc, s, storage) => applyOne(doc, storage, SCHEME_KEY, SCHEMES, 'scheme', s);
export const readDensity = (storage) => readOne(storage, DENSITY_KEY, DENSITIES);
export const applyDensity = (doc, d, storage) => applyOne(doc, storage, DENSITY_KEY, DENSITIES, 'density', d);

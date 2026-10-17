// Runs before the page draws (kept out of index.html so the site can refuse inline scripts).
// 1. Light / Dark chosen on this device (src/theme.js), so there's no flash of the wrong colours.
try {
  var t = localStorage.getItem('fw.theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.content = t === 'dark' ? '#171a23' : '#ffffff'; });
  }
  // colour scheme and density (src/theme.js)
  var s = localStorage.getItem('fw.scheme');
  if (s === 'spruce' || s === 'sand') document.documentElement.dataset.scheme = s;
  if (localStorage.getItem('fw.density') === 'compact') document.documentElement.dataset.density = 'compact';
  // the sidebar folded to a strip of icons (Alt+B, or « at its top)
  if (localStorage.getItem('fw.rail') === '1') document.documentElement.dataset.rail = '1';
} catch (e) { /* storage blocked */ }
// 2. Lets Android install Formwright as an app (see public/sw.js).
if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });

// Formwright service worker.
// Its only jobs: let Android Chrome install Formwright as an app, and show a short
// message instead of the browser's error page when a page is opened with no connection.
// It caches nothing, so updates are never held back; Firestore keeps its own offline data.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#3346c8">
<title>Formwright</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f3f4f7;color:#141826;text-align:center;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0f1117;color:#e7e9f0}}b{display:block;font-size:1.25rem;margin-bottom:6px}button{margin-top:16px;font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#3346c8;color:#fff}</style></head>
<body><div><b>You’re offline</b>Formwright needs a connection to open. Check your signal and try again.<br><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  // only page loads; everything else (scripts, Firestore, Storage) goes straight to the network
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

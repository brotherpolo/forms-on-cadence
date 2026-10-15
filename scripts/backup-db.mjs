#!/usr/bin/env node
// Back up the whole Firestore database (an export) and wait for it to finish.
// Used by the deploy workflows before every deploy, so there's always a copy from just
// before an update. Exits with an error (stopping the deploy) if the backup fails.
//
//   node scripts/backup-db.mjs <gs://bucket/folder> <name> [project]
//   GOOGLE_APPLICATION_CREDENTIALS = the service account key file (the deploy account)
//
// The account needs "Cloud Datastore Import Export Admin" on the project and write access
// to the bucket. No extra packages: it signs in with the key using Node's own crypto.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [prefix, name, projectArg] = process.argv.slice(2);
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const MAX_WAIT_MS = 20 * 60e3;
const API = process.env.FIRESTORE_API || 'https://firestore.googleapis.com'; // a stand-in server in tests
const POLL_MS = Number(process.env.BACKUP_POLL_MS) || 5000;

function die(msg) { console.error('::error::Database backup failed: ' + msg); process.exit(1); }
if (!prefix || !/^gs:\/\/[a-z0-9._-]+(\/.*)?$/.test(prefix)) die('say where to save it, e.g. gs://tasks-2ae9d-db-exports/before-deploy');
if (!keyFile) die('GOOGLE_APPLICATION_CREDENTIALS is not set');

let key;
try { key = JSON.parse(readFileSync(keyFile, 'utf8')); } catch (e) { die('the service account key could not be read'); }
const project = projectArg || process.env.PROJECT || key.project_id;
if (!project) die('no project');

const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + claims).sign(key.private_key).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claims + '.' + sig }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) die('could not sign in with the service account key (' + (j.error_description || r.status) + ')');
  return j.access_token;
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13); // 20261015-0412
const folder = `${prefix.replace(/\/+$/, '')}/${stamp}${name ? '-' + name.replace(/[^\w.-]+/g, '-') : ''}`;
async function main() {
const token = await accessToken();
const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
console.log(`Backing up project ${project} to ${folder} …`);
const start = await fetch(`${API}/v1/projects/${project}/databases/(default):exportDocuments`, {
  method: 'POST', headers: auth, body: JSON.stringify({ outputUriPrefix: folder }),
});
const op = await start.json().catch(() => ({}));
if (!start.ok || !op.name) die((op.error && op.error.message) || 'the export did not start (HTTP ' + start.status + ')');

const began = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  const r = await fetch(`${API}/v1/${op.name}`, { headers: auth });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) die((s.error && s.error.message) || 'could not check the export (HTTP ' + r.status + ')');
  if (s.done) {
    if (s.error) die(s.error.message || 'the export reported an error');
    const p = s.metadata && s.metadata.progressDocuments;
    console.log(`Backup done${p && p.completedWork ? `: ${p.completedWork} documents` : ''}. Saved in ${folder}`);
    break;
  }
  if (Date.now() - began > MAX_WAIT_MS) die('it took more than 20 minutes');
  process.stdout.write('.');
}
}
main().catch((e) => die((e && e.cause && e.cause.message) || (e && e.message) || String(e)));

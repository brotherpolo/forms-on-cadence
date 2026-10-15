// Administration → Audit trail: every change to records, forms, security groups, accounts and
// settings, newest first, with filters, Put back, Restore (deleted records, 90 days) and CSV.
// The server writes the entries (Cadence folder, functions/audit.js); admins only.
import { store, loadAudit, restoreDeleted, setRecordsValue, attachRecords, setOwner, setAutoNumber } from './store.js';
import { esc, toast, badge } from './ui.js';
import { toCsv } from './listlogic.js';
import { KINDS, serverFilter, matches, verb, targetText, canPutBack, dayRange, csvRows, changeLabel } from './auditlogic.js';

let H = { fmt: null, formById: null, recById: null, recTitle: null, go: null, renderMain: null };
export function initAudit(helpers) { H = { ...H, ...helpers }; }

const RESTORE_DAYS = 90;
const PAGE = 100;
// f: filters; entries: loaded so far; key: what was loaded (filters the database applied)
const A = { f: { formId: '', by: '', kind: '', fromKey: '', toKey: '', q: '', recordId: '' }, entries: [], cursor: null, more: false, key: null, busy: false, error: null, armed: null, working: null };

export const handles = (view) => view.name === 'audit';
const people = () => [...store.users].map((u) => ({ id: u.id, name: store.profiles[u.id]?.displayName || u.displayName || (u.email || '').split('@')[0] || 'Someone' })).sort((a, b) => a.name.localeCompare(b.name));
const personName = (id) => (id === 'system' ? 'System' : store.profiles[id]?.displayName || people().find((p) => p.id === id)?.name || 'Someone');
const whenLong = (t) => new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeOnly = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayHead = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** The filters the database applies, as a key: a change means loading again from the top. */
function loadKey() {
  const r = dayRange(A.f.fromKey, A.f.toKey);
  return JSON.stringify([serverFilter(A.f), r.from, r.to]);
}
async function load(more) {
  if (A.busy) return;
  A.busy = true; A.error = null;
  if (!more) { A.entries = []; A.cursor = null; A.key = loadKey(); }
  const key = A.key;
  try {
    const r = dayRange(A.f.fromKey, A.f.toKey);
    const page = await loadAudit({ filter: serverFilter(A.f), from: r.from, to: r.to, after: more ? A.cursor : null, size: PAGE });
    if (key !== A.key) return;
    A.entries = A.entries.concat(page.entries); A.cursor = page.cursor; A.more = page.more;
  } catch (e) {
    console.error('[formwright] audit', e);
    A.error = e?.code === 'failed-precondition' ? 'index' : e?.code === 'permission-denied' ? 'rules' : 'other';
  } finally { A.busy = false; H.renderMain(); }
}

/** Open the trail, optionally for one record ({ recordId }). */
export function openFor(view) {
  if ((view.recordId || '') !== A.f.recordId) { A.f = { ...A.f, recordId: view.recordId || '', formId: view.recordId ? '' : A.f.formId }; A.key = null; }
}

/** A value as the app shows it: formatted like the field, people and records by name. */
function show(e, c, side) {
  const v = c[side];
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (c.type === 'person') return personName(v);
  if (c.type === 'parent') { const r = H.recById(v); return r ? H.recTitle(r) : '(a deleted record)'; }
  if (v === 'signed' && c.type === 'signature') return 'Signed';
  if (typeof v === 'object' && !Array.isArray(v) && v.name) return v.name;
  const form = e.formId ? H.formById(e.formId) : null;
  const f = form && (form.fields || []).find((x) => x.id === c.key && x.type === c.type);
  try { if (f) return H.fmt(f, v); } catch (err) { /* fall through */ }
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return v.address || JSON.stringify(v);
  return String(v);
}
const entryText = (e) => [e.byName, verb(e), targetText(e), e.note, ...(e.changes || []).flatMap((c) => [c.label, show(e, c, 'from'), show(e, c, 'to')])].filter(Boolean).join(' ');

export function viewAudit(view) {
  openFor(view);
  if (A.key !== loadKey() && !A.busy) setTimeout(() => load(false), 0);
  const shown = A.entries.filter((e) => matches(e, { ...A.f, ...dayRange(A.f.fromKey, A.f.toKey) }, entryText));
  const rec = A.f.recordId ? H.recById(A.f.recordId) : null;
  const forms = [...store.forms].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const sel = (k, opts, label) => `<label class="au-f"><span>${label}</span><select class="in" data-au="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}"${A.f[k] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const filters = `<div class="au-filters">
    ${A.f.recordId ? `<span class="chip acc au-only">Only ${esc(rec ? H.recTitle(rec) : 'this record')}<button type="button" class="ibtn" data-act="au-clear-rec" aria-label="Show every record">✕</button></span>` : sel('formId', [['', 'Every form'], ...forms.map((f) => [f.id, f.name])], 'Form')}
    ${sel('by', [['', 'Anyone'], ...people().map((p) => [p.id, p.name]), ['system', 'System']], 'Who')}
    ${sel('kind', KINDS.map((k) => [k.key, k.label]), 'What')}
    <label class="au-f"><span>From</span><input class="in" type="date" data-au="fromKey" value="${esc(A.f.fromKey)}"></label>
    <label class="au-f"><span>To</span><input class="in" type="date" data-au="toKey" value="${esc(A.f.toKey)}"></label>
    <label class="au-f au-q"><span>Search</span><input class="in" type="search" data-au="q" value="${esc(A.f.q)}" placeholder="A record, a value, a name"></label>
    <button type="button" class="btn" data-act="au-csv"${shown.length ? '' : ' disabled'}>Export CSV</button>
  </div>`;
  let body;
  if (A.error === 'index') body = `<div class="panel"><p class="note">The audit trail's search indexes are still being prepared. This takes a few minutes after an install; try again shortly.</p><div class="gfoot"><button class="btn sm" data-act="au-retry">Try again</button></div></div>`;
  else if (A.error) body = `<div class="panel"><p class="note">${A.error === 'rules' ? 'The audit trail isn’t switched on yet: deploy the Cadence rules (see the install steps).' : 'Couldn’t load the audit trail. Check your connection.'}</p><div class="gfoot"><button class="btn sm" data-act="au-retry">Try again</button></div></div>`;
  else if (!A.entries.length && (A.busy || A.key !== loadKey())) body = `<div class="panel"><p class="note">Loading…</p></div>`;
  else if (!shown.length) body = `<div class="panel"><p class="note">${A.entries.length ? 'Nothing matches these filters in what’s loaded.' : 'No changes recorded yet. The trail starts from when it was installed.'}${A.more ? ' Load more to look further back.' : ''}</p>${A.more ? `<div class="gfoot"><button class="btn sm" data-act="au-more"${A.busy ? ' disabled' : ''}>${A.busy ? 'Loading…' : 'Load more'}</button></div>` : ''}</div>`;
  else {
    let day = '', html = '';
    shown.forEach((e) => {
      const d = dayHead(e.at);
      if (d !== day) { html += `<h3 class="au-day">${esc(d)}</h3>`; day = d; }
      html += entryHTML(e);
    });
    body = `<div class="au-list">${html}</div><div class="au-foot"><span class="help">${shown.length} shown${A.entries.length !== shown.length ? ` of ${A.entries.length} loaded` : ''}</span>${A.more ? `<button class="btn sm" data-act="au-more"${A.busy ? ' disabled' : ''}>${A.busy ? 'Loading…' : 'Load more'}</button>` : '<span class="help">That’s everything.</span>'}</div>`;
  }
  return `<div class="head"><div class="ttl"><div><h1>Audit trail</h1><p class="sub">Every change to records, forms, security groups, users and settings, newest first. Kept for good, and only administrators can see it.</p></div></div></div>
  ${filters}${body}`;
}

function entryHTML(e) {
  const form = e.formId ? H.formById(e.formId) : null;
  const rec = e.recordId ? H.recById(e.recordId) : null;
  const target = e.area === 'record'
    ? `${form ? badge(form) : ''}${rec ? `<button type="button" class="au-link" data-act="open-record" data-id="${esc(e.recordId)}">${esc(targetText(e))}</button>` : `<span class="au-gone">${esc(targetText(e))}</span>`}`
    : `<span>${esc(targetText(e))}</span>`;
  const changes = (e.changes || []).length ? `<ul class="au-changes">${e.changes.map((c, i) => {
    const from = show(e, c, 'from'), to = show(e, c, 'to');
    const pb = canPutBack(e, c) && rec ? putBackBtn(e, c, i, rec) : '';
    return `<li><span class="au-l">${esc(changeLabel(c))}</span><span class="au-v">${from ? `<s>${esc(from)}</s>` : '<i>empty</i>'} <span aria-hidden="true">→</span><span class="sr"> to </span> ${to ? `<b>${esc(to)}</b>` : '<i>empty</i>'}</span>${pb}</li>`;
  }).join('')}</ul>` : '';
  let action = '';
  if (e.area === 'record' && e.kind === 'deleted') {
    if (e.restoredAt) action = `<p class="help">Restored ${esc(whenLong(e.restoredAt))} by ${esc(personName(e.restoredBy))}.</p>`;
    else if (rec) action = '';
    else if (Date.now() - e.at > RESTORE_DAYS * 864e5) action = `<p class="help">Over ${RESTORE_DAYS} days ago, so it can’t be restored here.</p>`;
    else action = `<div class="au-act"><button type="button" class="btn sm" data-act="au-restore" data-id="${esc(e.id)}"${A.working === e.id ? ' disabled' : ''}>${A.working === e.id ? 'Restoring…' : 'Restore'}</button><span class="help">Brings it back as it was, with its rows and links.</span></div>`;
  }
  return `<article class="au-e au-${esc(e.area)} au-k-${esc(e.kind)}">
    <time class="au-t" datetime="${new Date(e.at).toISOString()}" title="${esc(whenLong(e.at))}">${esc(timeOnly(e.at))}</time>
    <div class="au-main"><p class="au-s"><b>${esc(e.byName || personName(e.by))}</b> ${esc(verb(e))} ${target}</p>${changes}${e.note ? `<p class="au-note">${esc(e.note)}</p>` : ''}${action}</div>
  </article>`;
}

function currentOf(rec, c) {
  if (c.key === 'parent') return rec.parentId || null;
  if (c.key === 'owner') return rec.ownerId || null;
  return rec.values?.[c.key] ?? null;
}
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || ((a == null || a === '') && (b == null || b === ''));
function putBackBtn(e, c, i, rec) {
  const id = e.id + ':' + i;
  const moved = !sameVal(currentOf(rec, c), c.to);
  const armed = A.armed === id;
  return `<button type="button" class="btn sm ghost au-pb${armed ? ' armed' : ''}" data-act="au-putback" data-id="${esc(e.id)}" data-i="${i}"${A.working === id ? ' disabled' : ''} title="Set it back to what it was">${armed ? (moved ? 'It’s changed since. Tap again' : 'Tap again to put back') : 'Put back'}</button>`;
}

async function putBack(entryId, i) {
  const e = A.entries.find((x) => x.id === entryId); const c = e?.changes?.[i];
  const rec = e && H.recById(e.recordId);
  if (!c || !rec) return;
  const id = entryId + ':' + i;
  if (A.armed !== id) { A.armed = id; H.renderMain(); setTimeout(() => { if (A.armed === id) { A.armed = null; H.renderMain(); } }, 5000); return; }
  A.armed = null; A.working = id; H.renderMain();
  try {
    if (c.key === 'parent') {
      const p = c.from ? H.recById(c.from) : null;
      if (c.from && !p) throw new Error('The old parent no longer exists.');
      await attachRecords([{ id: rec.id, parentId: c.from || null, parentFormId: p ? p.formId : null, set: {} }]);
    } else if (c.key === 'owner') {
      if (!c.from) throw new Error('There was no owner before.');
      await setOwner([rec.id], c.from);
    } else if (c.type === 'autonumber') {
      if (!c.from) throw new Error('It had no number before.');
      await setAutoNumber(rec.id, c.key, String(c.from));
    } else {
      await setRecordsValue([rec], c.key, c.from ?? null);
    }
    toast(`${c.label} put back on ${H.recTitle(rec)}`);
    setTimeout(() => load(false), 1500); // the server notes the put-back as a change
  } catch (err) {
    console.error('[formwright] put back', err);
    toast(err?.message && !/permission/i.test(err.message) ? err.message : 'Couldn’t put it back. Try again.');
  }
  A.working = null; H.renderMain();
}

async function restore(entryId) {
  if (A.working) return;
  A.working = entryId; H.renderMain();
  try {
    const out = await restoreDeleted(entryId);
    const e = A.entries.find((x) => x.id === entryId);
    if (e) { e.restoredAt = Date.now(); e.restoredBy = store.user?.uid; }
    toast(`Restored${out.parentGone ? ' on its own (its parent was deleted too)' : ''}.`);
    setTimeout(() => load(false), 1500);
  } catch (err) {
    console.error('[formwright] restore', err);
    toast(/not-found/.test(err?.code || '') && /function|404/i.test(err?.message || '') ? 'The restore service isn’t set up yet. Deploy the Cadence functions first.' : err?.message || 'Couldn’t restore it. Try again.');
  }
  A.working = null; H.renderMain();
}

function exportCsv() {
  const shown = A.entries.filter((e) => matches(e, { ...A.f, ...dayRange(A.f.fromKey, A.f.toKey) }, entryText));
  const { headers, rows } = csvRows(shown, show, whenLong);
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Audit trail ${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}`);
}

export async function onClick(a, el) {
  switch (a) {
    case 'au-more': load(true); return true;
    case 'au-retry': A.key = null; load(false); return true;
    case 'au-clear-rec': A.f.recordId = ''; A.key = null; H.go({ name: 'audit' }); return true;
    case 'au-csv': exportCsv(); return true;
    case 'au-putback': putBack(el.dataset.id, +el.dataset.i); return true;
    case 'au-restore': restore(el.dataset.id); return true;
    default: return false;
  }
}
export function onInput(t) {
  if (t.dataset.au !== 'q') return false;
  A.f.q = t.value;
  const pos = t.selectionStart;
  H.renderMain();
  const i = document.querySelector('[data-au="q"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* type=search */ } }
  return true;
}
export function onChange(t) {
  const k = t.dataset.au;
  if (!k || k === 'q') return false;
  A.f[k] = t.value;
  H.renderMain();
  return true;
}

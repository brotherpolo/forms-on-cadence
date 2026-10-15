// Data layer: Firestore subscriptions, writes, and Storage uploads.
// The UI reads the synchronous arrays on `store` and re-renders when `store.onChange` fires.

import { app, db, storage } from './firebase.js';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy,
  limit,
  startAfter,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBlob } from 'firebase/storage';
import { isAdmin, formLevel, effectiveAccess, withInherited } from './access.js';
import { clone } from './util.js';

export const store = {
  mode: 'cloud',
  ready: false,
  user: null, // Firebase Auth user
  me: null, // users/{uid} document + uid
  forms: [],
  records: [],
  profiles: {},
  groups: [],
  users: [],
  reports: [], // my reports and reports shared with everyone, newest first
  reportsReady: false,
  listViews: [], // saved list views: mine and shared ones, all forms
  reportDefs: [], // saved reports: mine and shared ones
  dashboards: [], // dashboards: mine and shared ones
  dashReady: false,
  listViewsReady: false,
  imports: [], // admins: past imports, newest first
  automations: [], automationsError: null, // admins: Administration → Automations
  recordsLoading: new Set(),
  onChange: () => {},
  onError: () => {},
  put,
  del,
};

let baseUnsubs = [];
let adminUnsubs = [];
const recordSubs = new Map(); // formId -> { key, unsub }
const recordsByForm = new Map(); // formId -> records[]
// records waiting on this person in a workflow, which they might not otherwise see ("own" access)
let assignedSub = null, assigned = [];
const got = { forms: false, me: false };

const fail = (where) => (err) => {
  console.error(`[formwright] ${where}`, err);
  store.onError(err, where);
};

function changed() {
  if (!store.ready && got.forms && got.me) store.ready = true;
  if (store.ready) store.onChange();
}

/** Create users/{uid} and profiles/{uid} on first sign-in. */
export async function ensureAccount(user) {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      email: user.email || '',
      displayName: user.displayName || '',
      role: 'member',
      groups: [],
      access: {},
      createdAt: Date.now(),
    });
  }
  const name = user.displayName || (user.email || '').split('@')[0] || 'User';
  try {
    await setDoc(doc(db, 'profiles', user.uid), { displayName: name }, { merge: true });
  } catch (e) {
    console.warn('[formwright] profile not saved', e);
  }
}

/** Admins and people in at least one security group. The rules show a brand-new account nothing else. */
const isMemberMe = () => isAdmin(store.me) || ((store.me && store.me.groups) || []).length > 0;
let memberUnsubs = [];
let memberOn = null;
let memberParts = []; // { start: () => unsubscribe, empty: () => void }

/** Start or stop the listeners that need membership, so a new account asks only for what it may read. */
function syncMember() {
  const m = !!store.me && isMemberMe();
  if (m === memberOn) return;
  memberOn = m;
  memberUnsubs.forEach((u) => u());
  memberUnsubs = [];
  if (m) memberUnsubs = memberParts.map((x) => x.start());
  else memberParts.forEach((x) => x.empty());
}

export function startData(user) {
  stopData();
  store.user = user;
  store.ready = false;
  got.forms = got.me = false;
  memberParts = [];

  baseUnsubs.push(
    onSnapshot(
      doc(db, 'users', user.uid),
      (s) => {
        store.me = s.exists() ? { uid: user.uid, ...s.data() } : null;
        got.me = true;
        syncMember();
        syncAdminSubs();
        syncRecordSubs();
        changed();
      },
      fail('your account')
    )
  );
  // Form designs and display names: for members only.
  const onForms = (docs) => { store.forms = docs.map((d) => ({ ...d.data(), id: d.id })); got.forms = true; syncRecordSubs(); changed(); };
  memberParts.push({ start: () => onSnapshot(collection(db, 'forms'), (s) => onForms(s.docs), fail('forms')), empty: () => onForms([]) });
  // someone removed keeps their name, marked so: "Jane Smith (removed)" (baseName is the plain name)
  const onProfiles = (docs) => { store.profiles = Object.fromEntries(docs.map((d) => { const p = d.data(); return [d.id, p.removed ? { ...p, baseName: p.displayName, displayName: (p.displayName || 'Someone') + ' (removed)' } : p]; })); changed(); };
  memberParts.push({ start: () => onSnapshot(collection(db, 'profiles'), (s) => onProfiles(s.docs), fail('profiles')), empty: () => onProfiles([]) });

  /**
   * Mine plus shared, as two queries, because the rules only let a list through when it asks
   * for exactly what you may read. The shared half waits for membership.
   */
  const pair = (col, label, merge) => {
    const parts = { mine: [], shared: [] }, have = { mine: false, shared: false };
    const done = (part) => (snap) => {
      parts[part] = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      have[part] = true;
      const m = new Map();
      [...parts.mine, ...parts.shared].forEach((x) => m.set(x.id, x));
      merge([...m.values()], have.mine && have.shared);
    };
    baseUnsubs.push(onSnapshot(query(collection(db, col), where('ownerId', '==', user.uid)), done('mine'), fail('your ' + label)));
    memberParts.push({
      start: () => onSnapshot(query(collection(db, col), where('shared', '==', true)), done('shared'), fail('shared ' + label)),
      empty: () => done('shared')({ docs: [] }),
    });
  };
  pair('reports', 'old reports', (list, ok) => { store.reports = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); store.reportsReady = ok; changed(); });
  const ready = { reportDefs: false, dashboards: false };
  ['reportDefs', 'dashboards'].forEach((key) => pair(key, key === 'reportDefs' ? 'saved reports' : 'dashboards', (list, ok) => {
    store[key] = list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    ready[key] = ok;
    store.dashReady = ready.reportDefs && ready.dashboards;
    changed();
  }));
  pair('listViews', 'list views', (list, ok) => { store.listViews = list; store.listViewsReady = ok; changed(); });
}

export function stopData() {
  baseUnsubs.forEach((u) => u());
  baseUnsubs = [];
  memberUnsubs.forEach((u) => u());
  memberUnsubs = [];
  memberOn = null;
  adminUnsubs.forEach((u) => u());
  adminUnsubs = [];
  recordSubs.forEach((s) => s.unsub());
  recordSubs.clear();
  recordsByForm.clear();
  if (assignedSub) { assignedSub(); assignedSub = null; }
  assigned = [];
  Object.assign(store, { ready: false, user: null, me: null, forms: [], records: [], profiles: {}, groups: [], users: [], reports: [], reportsReady: false, listViews: [], listViewsReady: false, imports: [], reportDefs: [], dashboards: [], dashReady: false });
  store.recordsLoading.clear();
}

function syncAdminSubs() {
  const admin = isAdmin(store.me);
  if (admin && !adminUnsubs.length) {
    adminUnsubs.push(
      onSnapshot(
        collection(db, 'groups'),
        (s) => {
          store.groups = s.docs.map((d) => ({ ...d.data(), id: d.id }));
          changed();
        },
        fail('groups')
      )
    );
    adminUnsubs.push(
      onSnapshot(
        collection(db, 'imports'),
        (s) => {
          store.imports = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          changed();
        },
        fail('import history')
      )
    );
    adminUnsubs.push(
      onSnapshot(
        collection(db, 'automations'),
        (s) => {
          store.automations = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          store.automationsError = null;
          changed();
        },
        (err) => { store.automationsError = err?.code || 'error'; changed(); } // e.g. the security rules aren't deployed yet
      )
    );
    adminUnsubs.push(
      onSnapshot(
        collection(db, 'users'),
        (s) => {
          store.users = s.docs.map((d) => ({ ...d.data(), id: d.id }));
          changed();
        },
        fail('users')
      )
    );
  } else if (!admin && adminUnsubs.length) {
    adminUnsubs.forEach((u) => u());
    adminUnsubs = [];
    store.groups = [];
    store.users = [];
    store.imports = [];
    store.automations = [];
  }
}

/**
 * Subscribe to the records the person may see, one query per form.
 * "all" -> every record of the form; "own" -> only records they own.
 * Queries must match the security rules exactly or Firestore rejects them.
 */
function syncRecordSubs() {
  if (!store.user || !got.me) return;
  const uidNow = store.user.uid;
  const want = new Map();
  for (const f of store.forms) {
    const view = formLevel(store.me, f.id).view;
    if (view !== 'none') want.set(f.id, view);
  }
  for (const [formId, sub] of recordSubs) {
    if (want.get(formId) !== sub.key) {
      sub.unsub();
      recordSubs.delete(formId);
      recordsByForm.delete(formId);
    }
  }
  for (const [formId, view] of want) {
    if (recordSubs.has(formId)) continue;
    const base = collection(db, 'records');
    const q =
      view === 'all'
        ? query(base, where('formId', '==', formId))
        : query(base, where('formId', '==', formId), where('ownerId', '==', uidNow));
    store.recordsLoading.add(formId);
    const unsub = onSnapshot(
      q,
      (s) => {
        recordsByForm.set(
          formId,
          s.docs.map((d) => withNums({ ...d.data(), id: d.id }))
        );
        store.recordsLoading.delete(formId);
        flattenRecords();
        changed();
      },
      (err) => {
        store.recordsLoading.delete(formId);
        fail(`records for form ${formId}`)(err);
      }
    );
    recordSubs.set(formId, { key: view, unsub });
  }
  if (!assignedSub && store.forms.some((f) => f.workflow?.on)) {
    assignedSub = onSnapshot(query(collection(db, 'records'), where('assignee', '==', uidNow)),
      (s) => { assigned = s.docs.map((d) => withNums({ ...d.data(), id: d.id })); flattenRecords(); changed(); },
      () => { assigned = []; }); // older security rules: only the usual access applies
  }
  flattenRecords();
}

function flattenRecords() {
  const all = [...recordsByForm.values()].flat();
  if (assigned.length) { const have = new Set(all.map((r) => r.id)); assigned.forEach((r) => { if (!have.has(r.id)) all.push(r); }); }
  store.records = all;
}

/** Update the display name other people see. */
export async function saveProfileName(userId, displayName) {
  await setDoc(doc(db, 'profiles', userId), { displayName: String(displayName).slice(0, 120) }, { merge: true });
}

/** The dashboard that opens when you start Formwright ('' for none). */
export async function setHomeDashboard(id) {
  await setDoc(doc(db, 'profiles', store.user.uid), { homeDashboard: String(id || '').slice(0, 100) }, { merge: true });
}

/* ---------- PDF exports: company name and logo (settings/exports) ---------- */

let exportSettings = null; // read once per visit; an admin's save refreshes it
/** { companyName, logo } for PDF exports ({} when none are set or they can't be read). */
export async function getExportSettings(fresh = false) {
  if (exportSettings && !fresh) return exportSettings;
  try {
    const s = await getDoc(doc(db, 'settings', 'exports'));
    exportSettings = s.exists() ? s.data() : {};
  } catch (e) {
    console.warn('[formwright] export settings', e);
    return {};
  }
  return exportSettings;
}
export async function saveExportSettings({ companyName, logo }) {
  const data = { companyName: String(companyName || '').trim().slice(0, 120), logo: logo || null, updatedAt: Date.now(), updatedBy: store.user.uid };
  await setDoc(doc(db, 'settings', 'exports'), data);
  exportSettings = data;
}

/** An uploaded file's contents (for photos in a PDF), through Storage so its rules apply. */
export async function fileBlob(v) {
  if (v.path) {
    try { return await getBlob(ref(storage, v.path)); } catch (e) { if (!v.url) throw e; }
  }
  const r = await fetch(v.url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.blob();
}

/* ---------- Cadence tasks linked to a record ---------- */

/**
 * Live list of the Cadence tasks linked to one record that this person owns or is
 * assigned. Cadence's rules only allow reading tasks you're a member of, so the
 * query must filter on members. Returns an unsubscribe function.
 */
export function watchTasks(recordId, onNext, onError) {
  const q = query(
    collection(db, 'tasks'),
    where('members', 'array-contains', store.user.uid),
    where('recordId', '==', recordId)
  );
  return onSnapshot(q, (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id }))), onError);
}

/** Tick a task off or reopen it, writing only the fields Cadence's rules let an owner or assignee change. */
export async function setTaskDone(taskId, patch) {
  await updateDoc(doc(db, 'tasks', taskId), patch);
}

/* ---------- Reports ---------- */

/** Save a report you own. Owner never changes. */
export async function saveReport(rep) {
  const now = Date.now();
  const data = plain({
    name: String(rep.name || 'Untitled report').slice(0, 120) || 'Untitled report',
    ownerId: store.user.uid,
    shared: !!rep.shared,
    widgets: (rep.widgets || []).slice(0, 60),
    createdAt: rep.createdAt || now,
    updatedAt: now,
  });
  await setDoc(doc(db, 'reports', rep.id), data);
}

export async function deleteReport(id) {
  await deleteDoc(doc(db, 'reports', id));
}

/* ---------- List views and bulk record changes ---------- */

export async function saveListView(id, data) {
  await setDoc(doc(db, 'listViews', id), plain(data));
}

export async function deleteListView(id) {
  await deleteDoc(doc(db, 'listViews', id));
}

/** Delete many records. Each one is checked by the rules, so pass only ones you may delete. */
export async function deleteRecords(ids) {
  await commitOps(ids.map((id) => (b) => b.delete(doc(db, 'records', id))));
}

/** Set one field to the same value on many records (owner and creator unchanged). */
export async function setRecordsValue(recs, fieldId, value) {
  const me = store.user.uid, now = Date.now();
  await commitOps(
    recs.map((r) => (b) =>
      b.update(doc(db, 'records', r.id), { ['values.' + fieldId]: plain(value), updatedAt: now, updatedBy: me })
    )
  );
}

/** Replace records' values (rules emptying fields, a bulk set): changes [{ id, values }]. Auto numbers are untouched. */
export async function rewriteValues(changes) {
  const me = store.user.uid, now = Date.now();
  await commitOps(changes.map((c) => (b) => b.update(doc(db, 'records', c.id), { values: plain(c.values || {}), updatedAt: now, updatedBy: me })));
}

/**
 * Attach records to a parent, or detach them (parentId null). changes: [{ id, parentId,
 * parentFormId, set: { fieldId: value } }]. Only the parent link and the listed fields change.
 */
export async function attachRecords(changes) {
  const me = store.user.uid, now = Date.now();
  await commitOps(changes.map((c) => (b) => {
    const data = { parentId: c.parentId || null, parentFormId: c.parentFormId || null, updatedAt: now, updatedBy: me };
    Object.entries(c.set || {}).forEach(([k, v]) => { data['values.' + k] = plain(v); });
    b.update(doc(db, 'records', c.id), data);
  }));
}

/* ---------- Imports (admins) ---------- */

/**
 * Save an import. The import's record (imports/{id}) is written first and lists every record
 * it will add or change, so even an import cut short can be undone. Each update writes the
 * record as it was (imports/{id}/before/{recordId}) in the same batch as the change.
 * creates: [{ id, values, parentId, parentFormId }]; updates: [{ id, values, parentId, parentFormId }].
 * onProgress(done, total) runs after each batch.
 */
export async function runImport({ id, formId, formName, fileName, counts, creates, updates }, onProgress = () => {}) {
  const me = store.user.uid;
  const stamp = Date.now();
  const byId = new Map(store.records.map((r) => [r.id, r]));
  await setDoc(doc(db, 'imports', id), plain({
    formId, formName: String(formName || '').slice(0, 120), fileName: String(fileName || '').slice(0, 200), ownerId: me,
    createdAt: stamp, stamp, status: 'running', added: creates.map((c) => c.id), updated: updates.map((u) => u.id), counts,
  }));
  const groups = [];
  creates.forEach((c) => groups.push([(b) => b.set(doc(db, 'records', c.id), plain({
    formId, values: c.values || {}, parentId: c.parentId || null, parentFormId: c.parentFormId || null,
    ownerId: me, createdBy: me, createdAt: stamp, updatedAt: stamp, updatedBy: me,
  }))]));
  updates.forEach((u) => {
    const old = byId.get(u.id);
    if (!old) return;
    groups.push([
      (b) => b.set(doc(db, 'imports', id, 'before', u.id), plain({ values: old.values || {}, parentId: old.parentId || null, parentFormId: old.parentFormId || null, updatedAt: old.updatedAt || 0, updatedBy: old.updatedBy || '' })),
      (b) => b.set(doc(db, 'records', u.id), plain({
        formId: old.formId, values: u.values || {}, parentId: u.parentId || null, parentFormId: u.parentFormId || null,
        ownerId: old.ownerId, createdBy: old.createdBy, createdAt: old.createdAt || stamp, updatedAt: stamp, updatedBy: me,
      }), KEEP_NUMS),
    ]);
  });
  const total = groups.length;
  try {
    let batch = writeBatch(db), n = 0, done = 0;
    for (const g of groups) {
      if (n + g.length > 450) { await batch.commit(); onProgress(done, total); batch = writeBatch(db); n = 0; }
      g.forEach((op) => op(batch));
      n += g.length; done++;
    }
    if (n) await batch.commit();
    onProgress(done, total);
    await updateDoc(doc(db, 'imports', id), { status: 'done', finishedAt: Date.now() });
  } catch (e) {
    try { await updateDoc(doc(db, 'imports', id), { status: 'failed', finishedAt: Date.now() }); } catch (e2) { /* offline */ }
    throw e;
  }
  return stamp;
}

/** The records an import changed, as they were before it: Map(recordId -> before). */
export async function importBefore(importId) {
  const s = await getDocs(collection(db, 'imports', importId, 'before'));
  return new Map(s.docs.map((d) => [d.id, d.data()]));
}

/** Carry out an undo plan (importlogic.undoPlan) and mark the import undone. */
export async function undoImport(imp, plan) {
  const me = store.user.uid, now = Date.now();
  const byId = new Map(store.records.map((r) => [r.id, r]));
  const ops = [];
  [...plan.del, ...plan.under].forEach((rid) => ops.push((b) => b.delete(doc(db, 'records', rid))));
  plan.restore.forEach((x) => {
    const old = byId.get(x.id);
    if (!old) return;
    ops.push((b) => b.set(doc(db, 'records', x.id), plain({
      formId: old.formId, values: x.values || {}, parentId: x.parentId || null, parentFormId: x.parentFormId || null,
      ownerId: old.ownerId, createdBy: old.createdBy, createdAt: old.createdAt || now, updatedAt: now, updatedBy: me,
    }), KEEP_NUMS));
  });
  (imp.updated || []).forEach((rid) => ops.push((b) => b.delete(doc(db, 'imports', imp.id, 'before', rid))));
  await commitOps(ops);
  await updateDoc(doc(db, 'imports', imp.id), {
    status: 'undone', undoneAt: now, undoneBy: me,
    undo: { removed: plan.del.length, under: plan.under.length, restored: plan.restore.length, kept: plan.kept.slice(0, 50), gone: plan.gone },
  });
}

/* ---------- Saved reports and dashboards ---------- */

export async function saveReportDef(id, data) { await setDoc(doc(db, 'reportDefs', id), plain(data)); }
export async function deleteReportDef(id) { await deleteDoc(doc(db, 'reportDefs', id)); }
export async function saveDashboard(id, data) { await setDoc(doc(db, 'dashboards', id), plain(data)); }
export async function deleteDashboard(id) { await deleteDoc(doc(db, 'dashboards', id)); }

/** Write a converted old report (its saved reports, then its dashboard), then remove the old one. */
export async function writeMigration(mig, legacyId) {
  const ops = mig.reports.map((r) => (b) => b.set(doc(db, 'reportDefs', r.id), plain(r.data)));
  ops.push((b) => b.set(doc(db, 'dashboards', mig.dashboard.id), plain(mig.dashboard.data)));
  ops.push((b) => b.delete(doc(db, 'reports', legacyId)));
  await commitOps(ops);
}

/* ---------- Auto numbers ---------- */

/**
 * A record's auto numbers (nums, written only by the server) shown as ordinary field values,
 * so lists, reports, search, titles and PDFs need nothing special. The server's number wins.
 */
export function withNums(r) {
  if (!r || !r.nums || typeof r.nums !== 'object') return r;
  const form = store.forms.find((f) => f.id === r.formId);
  // only fields that are still Auto number (one changed back to text shows what's typed)
  const keep = form ? Object.fromEntries(Object.entries(r.nums).filter(([k]) => (form.fields || []).some((f) => f.id === k && f.type === 'autonumber'))) : r.nums;
  return { ...r, values: { ...(r.values || {}), ...keep } };
}

const fns = () => getFunctions(app, 'us-central1');
/** Admins: number the records of a form that have none yet (keeps numbers already typed in). */
export async function fillAutoNumbers(formId, fieldId) {
  return (await httpsCallable(fns(), 'autoNumberFill')({ formId, fieldId })).data;
}
/** Admins: change one record's number (must be unique on its form). */
export async function setAutoNumber(recordId, fieldId, value) {
  return (await httpsCallable(fns(), 'autoNumberSet')({ recordId, fieldId, value })).data;
}
/** Admins: the next number a field will hand out ({ next, years } or null). */
export async function autoCounter(formId, fieldId) {
  try { const s = await getDoc(doc(db, 'counters', `${formId}__${fieldId}`)); return s.exists() ? s.data() : null; } catch (e) { return null; }
}

/* ---------- Email PDF ---------- */

/** Admins: send a record's PDF. mail: { recordId, to, cc, copyMe, subject, message, pdf (base64), fileName } */
export async function emailRecord(mail) {
  return (await httpsCallable(fns(), 'emailRecord')(mail)).data;
}
/* ---------- Workflows ---------- */
/** Move a record to another stage: the record and its history entry together. */
export async function moveStage(recordId, patch, entry) {
  const me = store.user.uid, now = Date.now();
  const b = writeBatch(db);
  b.update(doc(db, 'records', recordId), plain({ ...patch, updatedAt: now, updatedBy: me }));
  b.set(doc(collection(db, 'records', recordId, 'stages')), plain({ ...entry, at: now, by: me }));
  await b.commit();
}
/** Live stage history of a record, newest first. */
export function watchStages(recordId, onNext) {
  return onSnapshot(collection(db, 'records', recordId, 'stages'), (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.at || 0) - (a.at || 0))), () => onNext([]));
}

/* ---------- Automations (admins) ---------- */
export async function saveAutomation(id, data) {
  const me = store.user.uid, now = Date.now();
  const old = store.automations.find((a) => a.id === id);
  await setDoc(doc(db, 'automations', id), plain({ ...data, createdBy: old?.createdBy || me, createdAt: old?.createdAt || now, updatedAt: now, updatedBy: me }));
}
export async function setAutomationOn(id, on) { await updateDoc(doc(db, 'automations', id), { on: !!on, updatedAt: Date.now(), updatedBy: store.user.uid }); }
export async function deleteAutomation(id) { await deleteDoc(doc(db, 'automations', id)); }
/** The latest runs of one automation, newest first. */
export async function loadRuns(id, n = 25) {
  const s = await getDocs(query(collection(db, 'automations', id, 'runs'), orderBy('at', 'desc'), limit(n)));
  return s.docs.map((d) => ({ ...d.data(), id: d.id }));
}
/** Test run: what an automation would do to one record (nothing is changed). */
export async function testAutomation(automation, recordId) {
  return (await httpsCallable(fns(), 'automationTest')({ automation, recordId })).data;
}

/** Live list of what's been emailed from a record, newest first. Returns an unsubscribe function. */
export function watchEmails(recordId, onNext, onError) {
  return onSnapshot(collection(db, 'records', recordId, 'emails'), (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.at || 0) - (a.at || 0))), onError || (() => onNext([])));
}

/* ---------- Audit trail (admins) ---------- */

/**
 * A page of the audit trail, newest first. filter: [field, value] the database applies (or null);
 * from/to: times; after: the last page's cursor. → { entries, cursor, more }
 */
export async function loadAudit({ filter = null, from = null, to = null, after = null, size = 100 } = {}) {
  const parts = [];
  if (filter) parts.push(where(filter[0], '==', filter[1]));
  if (from) parts.push(where('at', '>=', from));
  if (to) parts.push(where('at', '<', to));
  parts.push(orderBy('at', 'desc'));
  if (after) parts.push(startAfter(after));
  parts.push(limit(size));
  const s = await getDocs(query(collection(db, 'audit'), ...parts));
  return { entries: s.docs.map((d) => ({ ...d.data(), id: d.id })), cursor: s.docs[s.docs.length - 1] || null, more: s.docs.length === size };
}
/** Admins: bring a deleted record back from its audit entry. */
export async function restoreDeleted(auditId) {
  return (await httpsCallable(fns(), 'restoreRecord')({ auditId })).data;
}

/* ---------- Writes ---------- */

// A record is always written with these fields only, so the server's auto numbers (nums,
// autoLog) on it are left as they are.
const RECORD_FIELDS = ['formId', 'values', 'parentId', 'parentFormId', 'ownerId', 'createdBy', 'createdAt', 'updatedAt', 'updatedBy'];
const KEEP_NUMS = { mergeFields: RECORD_FIELDS };

const plain = (o) => JSON.parse(JSON.stringify(o ?? null));

async function put(col, obj) {
  if (col === 'records') return putRecord(obj);
  const data = plain(obj);
  delete data.id;
  await setDoc(doc(db, col, obj.id), data);
}

async function del(col, id) {
  await deleteDoc(doc(db, col, id));
}

/** Save a record, stamping ownership. Owner and creator never change after creation. */
export async function putRecord(rec) {
  await setDoc(doc(db, 'records', rec.id), recordData(rec), KEEP_NUMS);
}

/**
 * Save a record together with its sub-form rows: rows to write (new or changed) and row
 * IDs to delete. Up to 450 writes go in one batch, so a normal save is all-or-nothing.
 */
export async function saveRecordBundle(rec, rows, removedIds) {
  const ops = [(b) => b.set(doc(db, 'records', rec.id), recordData(rec), KEEP_NUMS)];
  rows.forEach((r) => ops.push((b) => b.set(doc(db, 'records', r.id), recordData(r), KEEP_NUMS)));
  removedIds.forEach((id) => ops.push((b) => b.delete(doc(db, 'records', id))));
  await commitOps(ops);
}

function recordData(rec) {
  const me = store.user.uid;
  const existing = store.records.find((r) => r.id === rec.id);
  const now = Date.now();
  return {
    formId: rec.formId,
    values: plain(rec.values || {}),
    parentId: rec.parentId || null,
    parentFormId: rec.parentFormId || null,
    ownerId: existing?.ownerId || me,
    createdBy: existing?.createdBy || me,
    createdAt: existing?.createdAt || rec.createdAt || now,
    updatedAt: rec.updatedAt || now,
    updatedBy: me,
  };
}

/** Commit many writes in chunks under Firestore's 500-operation batch limit. */
async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
}

/** Admin: delete a form, its records, and references to it from other forms. */
export async function deleteFormCascade(formId) {
  const ops = [];
  store.records
    .filter((r) => r.formId === formId)
    .forEach((r) => ops.push((b) => b.delete(doc(db, 'records', r.id))));
  store.forms
    .filter((f) => f.id !== formId && (f.children || []).some((c) => c.formId === formId))
    .forEach((f) =>
      ops.push((b) => b.update(doc(db, 'forms', f.id), { children: f.children.filter((c) => c.formId !== formId) }))
    );
  store.listViews
    .filter((v) => v.formId === formId)
    .forEach((v) => ops.push((b) => b.delete(doc(db, 'listViews', v.id))));
  ops.push((b) => b.delete(doc(db, 'forms', formId)));
  await commitOps(ops);
}

/** Admin: load the example forms and records. */
export async function loadExamples(examples) {
  const me = store.user.uid;
  const ops = [];
  examples.forms.forEach((f) => {
    const d = clone(f);
    delete d.id;
    ops.push((b) => b.set(doc(db, 'forms', f.id), d));
  });
  examples.records.forEach((r) => {
    const d = {
      formId: r.formId,
      values: r.values,
      parentId: r.parentId || null,
      parentFormId: r.parentFormId || null,
      ownerId: me,
      createdBy: me,
      createdAt: r.createdAt || Date.now(),
      updatedAt: r.updatedAt || Date.now(),
      updatedBy: me,
    };
    ops.push((b) => b.set(doc(db, 'records', r.id), d));
  });
  await commitOps(ops);
}

/* ---------- Files ---------- */

export async function uploadFile(file, formId) {
  const me = store.user.uid;
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `uploads/${formId}/${me}/${Date.now()}-${safe}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(r);
  return { name: file.name, size: file.size, type: file.type, path, url };
}

/* ---------- Admin: users and groups ---------- */

function accessFor(groupIds, groups, forms = store.forms) {
  return withInherited(effectiveAccess(groups.filter((g) => groupIds.includes(g.id))), forms);
}

/**
 * Save a group and its membership, then recompute effective access for every
 * person whose membership or permissions changed.
 */
export async function saveGroup(group, memberIds) {
  const data = plain({ name: group.name, description: group.description || '', access: group.access || {}, updatedAt: Date.now() });
  const groupsAfter = store.groups.filter((g) => g.id !== group.id).concat([{ ...data, id: group.id }]);
  const ops = [(b) => b.set(doc(db, 'groups', group.id), data)];
  for (const u of store.users) {
    const had = (u.groups || []).includes(group.id);
    const has = memberIds.includes(u.id);
    if (!had && !has) continue;
    const groups = (u.groups || []).filter((g) => g !== group.id).concat(has ? [group.id] : []);
    ops.push((b) => b.update(doc(db, 'users', u.id), { groups, access: accessFor(groups, groupsAfter) }));
  }
  await commitOps(ops);
}

export async function deleteGroup(groupId) {
  const groupsAfter = store.groups.filter((g) => g.id !== groupId);
  const ops = [(b) => b.delete(doc(db, 'groups', groupId))];
  for (const u of store.users) {
    if (!(u.groups || []).includes(groupId)) continue;
    const groups = u.groups.filter((g) => g !== groupId);
    ops.push((b) => b.update(doc(db, 'users', u.id), { groups, access: accessFor(groups, groupsAfter) }));
  }
  await commitOps(ops);
}

export async function setUserGroups(userId, groupIds) {
  await updateDoc(doc(db, 'users', userId), { groups: groupIds, access: accessFor(groupIds, store.groups) });
}

export async function setUserRole(userId, role) {
  await updateDoc(doc(db, 'users', userId), { role });
}

/** Remove a person: their sign-in and account go, their records stay (or go to giveTo).
    Runs on the server (Cadence's functions, removeAccount), which checks the caller is an admin. */
export async function removeAccount(uid, giveTo) {
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'removeAccount');
  const r = await fn({ uid, giveTo: giveTo || null });
  return r.data;
}

/** Give records to someone else (admins). Who created them stays as history. */
export async function setOwner(recordIds, ownerId) {
  const ids = [...new Set(recordIds)];
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.update(doc(db, 'records', id), { ownerId, updatedAt: Date.now(), updatedBy: store.user.uid }));
    await b.commit();
  }
  return ids.length;
}

/** Let someone use Cadence, or stop them (admins only; the rules check users/{uid}.cadence). */
export async function setUserCadence(userId, on) {
  await updateDoc(doc(db, 'users', userId), { cadence: !!on });
}

/** Recompute everyone's access from their groups (repair tool). */
export async function recomputeAllAccess(forms = store.forms) {
  const ops = store.users.map((u) => (b) =>
    b.update(doc(db, 'users', u.id), { access: accessFor(u.groups || [], store.groups, forms) })
  );
  await commitOps(ops);
}

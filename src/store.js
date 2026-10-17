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
  getDocFromServer,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy,
  limit,
  startAfter,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBlob, deleteObject } from 'firebase/storage';
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
  roles: [], // job roles (Administration → Roles): who does the work, separate from access
  users: [],
  reports: [], // my reports and reports shared with everyone, newest first
  reportsReady: false,
  listViews: [], // saved list views: mine and shared ones, all forms
  reportDefs: [], // saved reports: mine and shared ones
  dashboards: [], // dashboards: mine and shared ones
  dashReady: false,
  homeDefault: '', // settings/home: the dashboard Home shows for anyone without their own
  listViewsReady: false,
  imports: [], // admins: past imports, newest first
  automations: [], automationsError: null, // admins: Administration → Automations
  mentions: [], // My work → Mentions: comments where someone @mentioned you, newest first
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
const roleSubs = new Map(), roleRecs = new Map(); // roles: records waiting on a role I hold
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
        registerForTasks();
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
  // roles: everyone with access reads their names (a workflow stage or a stage history line names them)
  const onRoles = (docs) => { store.roles = docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))); changed(); };
  memberParts.push({ start: () => onSnapshot(collection(db, 'roles'), (s) => onRoles(s.docs), (err) => { console.warn('[formwright] roles', err?.code || err); onRoles([]); }), empty: () => onRoles([]) });

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
  // My work → Mentions: written by the server when someone @mentions you in a comment
  const onMentions = (s) => { store.mentions = s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (b.at || 0) - (a.at || 0)); changed(); };
  const mentionsPlain = () => onSnapshot(query(collection(db, 'mentions'), where('to', '==', user.uid), limit(200)), onMentions, () => { store.mentions = []; });
  let mUnsub = onSnapshot(query(collection(db, 'mentions'), where('to', '==', user.uid), orderBy('at', 'desc'), limit(200)), onMentions,
    () => { mUnsub = mentionsPlain(); }); // the index isn't built yet (or older rules): without the order
  baseUnsubs.push(() => mUnsub());
  // the dashboard Home shows for anyone who hasn't picked their own (settings/home, set by an admin)
  memberParts.push({
    start: () => onSnapshot(doc(db, 'settings', 'home'), (s) => { store.homeDefault = s.exists() ? String(s.data().dashboardId || '') : ''; store.homeDefaultReady = true; changed(); }, () => { store.homeDefault = ''; store.homeDefaultReady = true; changed(); }),
    empty: () => { store.homeDefault = ''; store.homeDefaultReady = true; },
  });
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
  roleSubs.forEach((u) => u()); roleSubs.clear(); roleRecs.clear();
  assigned = [];
  Object.assign(store, { ready: false, user: null, me: null, forms: [], records: [], profiles: {}, groups: [], users: [], reports: [], reportsReady: false, listViews: [], listViewsReady: false, imports: [], reportDefs: [], dashboards: [], dashReady: false, homeDefault: '', homeDefaultReady: false, mentions: [] });
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
  // roles: one listener per role I hold (a stage can go to a role)
  const wantRoles = new Set(store.forms.some((f) => f.workflow?.on) ? ((store.me && store.me.roles) || []).slice(0, 20) : []);
  roleSubs.forEach((u, r) => { if (!wantRoles.has(r)) { u(); roleSubs.delete(r); roleRecs.delete(r); } });
  wantRoles.forEach((r) => {
    if (roleSubs.has(r)) return;
    roleSubs.set(r, onSnapshot(query(collection(db, 'records'), where('assigneeRole', '==', r)),
      (s) => { roleRecs.set(r, s.docs.map((d) => withNums({ ...d.data(), id: d.id }))); flattenRecords(); changed(); },
      () => { roleRecs.delete(r); }));
  });
  flattenRecords();
}

function flattenRecords() {
  const all = [...recordsByForm.values()].flat();
  const extra = assigned.concat(...roleRecs.values());
  if (extra.length) { const have = new Set(all.map((r) => r.id)); extra.forEach((r) => { if (!have.has(r.id)) { have.add(r.id); all.push(r); } }); }
  store.records = all;
}

/** Update the display name other people see. */
export async function saveProfileName(userId, displayName) {
  await setDoc(doc(db, 'profiles', userId), { displayName: String(displayName).slice(0, 120) }, { merge: true });
}

/** Admins: the dashboard Home shows for anyone who hasn't chosen their own ('' for none). */
export async function setDefaultHome(id) {
  await setDoc(doc(db, 'settings', 'home'), { dashboardId: String(id || '').slice(0, 100), updatedAt: Date.now(), updatedBy: store.user.uid });
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

/* ---------- Adding and editing Cadence tasks in Formwright ----------
   The same documents Cadence writes (tasks/{id}); Cadence's security rules check every write. */

const cadenceOn = () => !!store.me && (store.me.role === 'admin' || store.me.cadence === true);
export const canUseTasks = cadenceOn;
let registered = '';
/**
 * So people can be given tasks without opening Cadence first: put my email in Cadence's people
 * directory (people/{email} → my uid; Cadence's rules let only me write my own) and on my
 * profile (so the people picker can list me). Once per session; failures are harmless.
 */
async function registerForTasks() {
  const u = store.user, email = String(u?.email || '').toLowerCase();
  if (!u || !email || registered === u.uid + (cadenceOn() ? '+' : '')) return;
  registered = u.uid + (cadenceOn() ? '+' : '');
  const name = store.me?.displayName || u.displayName || email.split('@')[0];
  // the profile keeps the address exactly as signed in (the rules check that); Cadence's directory is lowercase
  try { await setDoc(doc(db, 'profiles', u.uid), { email: u.email }, { merge: true }); } catch (e) { /* rules not updated yet */ }
  if (cadenceOn() && u.emailVerified !== false) {
    try { await setDoc(doc(db, 'people', email), { uid: u.uid, name: String(name).slice(0, 200) }); } catch (e) { console.warn('[formwright] people directory', e?.code || e); }
  }
}

/** My Cadence settings (types, levels) and map, or nulls when I haven't any. */
export async function loadCadenceItems() {
  const uid = store.user?.uid;
  const one = async (id) => { try { const s = await getDoc(doc(db, 'users', uid, 'items', id)); return s.exists() ? s.data() : null; } catch (e) { return null; } };
  const [settings, map] = await Promise.all([one('settings'), one('map')]);
  return { settings, map };
}

const peopleSeen = new Map(); // email → uid ('' when they can't be assigned)
/** Who Cadence lets me assign: for each email, the uid in Cadence's people directory, or ''. */
/** What Cadence's rules read when a task is refused, fresh from the server: my account, the
 *  linked record, and the assignee's people entry. Each is the data, null if missing, or
 *  { error } if it couldn't be read. */
export async function taskCheckReads(task) {
  const read = async (path) => { try { const s = await getDocFromServer(doc(db, ...path)); return s.exists() ? s.data() : null; } catch (e) { return { error: e?.code || 'error' }; } };
  const [account, record, person] = await Promise.all([
    read(['users', store.user.uid]),
    task.recordId ? read(['records', task.recordId]) : undefined,
    task.assigneeEmail ? read(['people', task.assigneeEmail]) : undefined,
  ]);
  return { account, record, person };
}
/** Try writing one task, then remove it again (diagnosis only). true if Cadence allowed it. */
export async function probeTask(t) {
  try { await setDoc(doc(db, 'tasks', t.id), plain(t)); } catch (e) { return false; }
  try { await deleteDoc(doc(db, 'tasks', t.id)); } catch (e) { /* left behind; harmless */ }
  return true;
}

export async function assignableUids(emails) {
  emails = emails.map((e) => String(e || '').trim().toLowerCase());
  await Promise.all([...new Set(emails.filter(Boolean))].filter((e) => !peopleSeen.has(e)).map(async (e) => {
    try { const s = await getDoc(doc(db, 'people', e)); peopleSeen.set(e, s.exists() ? String(s.data().uid || '') : ''); } catch (err) { peopleSeen.set(e, ''); }
  }));
  return new Map(emails.map((e) => [e, peopleSeen.get(e) || '']));
}

/** Add tasks (a batch, so a repeating task's next occurrence and its link land together). */
export async function writeTasks(creates, updates = []) {
  const b = writeBatch(db);
  creates.forEach((t) => b.set(doc(db, 'tasks', t.id), plain(t)));
  updates.forEach(([id, patch]) => b.update(doc(db, 'tasks', id), plain(patch)));
  await b.commit();
}
export async function updateTask(id, patch) { await updateDoc(doc(db, 'tasks', id), plain(patch)); }
export async function deleteTask(id) { await deleteDoc(doc(db, 'tasks', id)); }

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
/* ---------- Form version history (admins) ----------
   forms/{formId}/versions/{id}: { n, at, by, kind, note, from, fromN, summary[], form }.
   kind: saved (Save form) · draft (Save as draft) · loaded (from a file, a draft) ·
   activated (Make active) · baseline (the form as it was before history began). Never changed. */
/** A new version's ID (nothing is written). */
export const newVersionId = (formId) => doc(collection(db, 'forms', formId, 'versions')).id;
export async function putVersion(formId, id, data) {
  await setDoc(doc(db, 'forms', formId, 'versions', id), plain({ ...data, by: store.user.uid }));
}
/** A form's versions, newest first. */
export async function loadVersions(formId, n = 200) {
  const s = await getDocs(query(collection(db, 'forms', formId, 'versions'), orderBy('at', 'desc'), limit(n)));
  return s.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** Test run: what an automation would do to one record (nothing is changed). */
export async function testAutomation(automation, recordId) {
  return (await httpsCallable(fns(), 'automationTest')({ automation, recordId })).data;
}

/** Admins: delete sent emails and their kept PDFs. what: { ids: [emailId] } or { all: true }. → { deleted: n } */
export async function deleteSentEmails(recordId, what) {
  return (await httpsCallable(fns(), 'deleteSentEmails')({ recordId, ...what })).data;
}
/** Live list of what's been emailed from a record, newest first. Returns an unsubscribe function. */
/* ---------- Comments on a record, and @mentions ---------- */
/** The record's comments, oldest first (replies are put under their comment by the app). */
export function watchComments(recordId, onNext, onError) {
  return onSnapshot(collection(db, 'records', recordId, 'comments'), (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.at || 0) - (b.at || 0))), onError || (() => onNext([])));
}
export async function addComment(recordId, data) {
  const ref = doc(collection(db, 'records', recordId, 'comments'));
  await setDoc(ref, plain({ ...data, by: store.user.uid, at: Date.now() }));
  return ref.id;
}
export async function updateComment(recordId, id, patch) { await updateDoc(doc(db, 'records', recordId, 'comments', id), plain({ ...patch, editedAt: Date.now() })); }
export async function deleteComment(recordId, id) { await deleteDoc(doc(db, 'records', recordId, 'comments', id)); }
/** Administrators: every @mention (My work → All mentions), newest first. */
export function watchAllMentions(onNext, onError) {
  return onSnapshot(query(collection(db, 'mentions'), orderBy('at', 'desc'), limit(500)), (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id }))), onError || (() => onNext([])));
}
/** Administrators: Cadence tasks linked to Formwright records (My work → All tasks). People's own tasks stay private. */
export function watchRecordTasks(onNext, onError) {
  return onSnapshot(query(collection(db, 'tasks'), where('recordId', '!=', null), limit(2000)), (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id }))), onError || (() => onNext([])));
}
/** Reassign several tasks at once: [[taskId, patch]] (tasks.js reassignPatch). */
export async function reassignTasks(pairs) {
  for (let i = 0; i < pairs.length; i += 400) {
    const b = writeBatch(db);
    pairs.slice(i, i + 400).forEach(([id, patch]) => b.update(doc(db, 'tasks', id), patch));
    await b.commit();
  }
}
export async function markMentionsRead(ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.update(doc(db, 'mentions', id), { read: true }));
    await b.commit();
  }
}

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

/* ---------- Word templates (Export ▾ on a record) ----------
   docTemplates/{id}: { formId, name, path, url, size, by, byName, at, updatedAt, tags, problems }; the
   file is in Storage at docTemplates/{formId}/{uid}/{time}-{file}.docx. Anyone who can see the form
   can add one; whoever added it (or an administrator) can rename or delete it. */
export function watchTemplates(formId, onNext, onError) {
  return onSnapshot(query(collection(db, 'docTemplates'), where('formId', '==', formId)),
    (s) => onNext(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => String(a.name).localeCompare(String(b.name)))), onError || (() => onNext([])));
}
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export async function addTemplate(formId, file, name, check) {
  const me = store.user.uid;
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `docTemplates/${formId}/${me}/${Date.now()}-${safe}`;
  await uploadBytes(ref(storage, path), file, { contentType: DOCX });
  const url = await getDownloadURL(ref(storage, path));
  const id = doc(collection(db, 'docTemplates')).id;
  const now = Date.now();
  await setDoc(doc(db, 'docTemplates', id), plain({ formId, name: String(name).slice(0, 120), path, url, size: file.size, by: me, byName: store.profiles[me]?.displayName || store.me?.displayName || '', at: now, updatedAt: now, tags: check.tags, problems: check.problems }));
  return id;
}
export async function replaceTemplateFile(t, file, check) {
  const me = store.user.uid;
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `docTemplates/${t.formId}/${me}/${Date.now()}-${safe}`;
  await uploadBytes(ref(storage, path), file, { contentType: DOCX });
  const url = await getDownloadURL(ref(storage, path));
  await updateDoc(doc(db, 'docTemplates', t.id), { path, url, size: file.size, updatedAt: Date.now(), tags: check.tags, problems: check.problems });
  try { await deleteObject(ref(storage, t.path)); } catch (e) { /* the old file can stay */ }
}
export async function renameTemplate(id, name) { await updateDoc(doc(db, 'docTemplates', id), { name: String(name).slice(0, 120), updatedAt: Date.now() }); }
export async function deleteTemplate(t) {
  await deleteDoc(doc(db, 'docTemplates', t.id));
  try { await deleteObject(ref(storage, t.path)); } catch (e) { /* already gone */ }
}
export async function templateBytes(t) {
  const b = await fileBlob({ path: t.path, url: t.url });
  return new Uint8Array(await b.arrayBuffer());
}

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

/* ---------- Admin: job roles (who does the work; access stays with security groups) ---------- */
/** Save a role and who holds it (users/{uid}.roles). */
export async function saveJobRole(role, memberIds) {
  const data = plain({ name: String(role.name || '').trim().slice(0, 80), description: String(role.description || '').slice(0, 500), updatedAt: Date.now(), createdAt: role.createdAt || Date.now() });
  const ops = [(b) => b.set(doc(db, 'roles', role.id), data)];
  for (const u of store.users) {
    const had = (u.roles || []).includes(role.id), has = memberIds.includes(u.id);
    if (had === has) continue;
    const roles = (u.roles || []).filter((r) => r !== role.id).concat(has ? [role.id] : []);
    ops.push((b) => b.update(doc(db, 'users', u.id), { roles }));
  }
  await commitOps(ops);
}
export async function deleteJobRole(roleId) {
  const ops = [(b) => b.delete(doc(db, 'roles', roleId))];
  for (const u of store.users) {
    if (!(u.roles || []).includes(roleId)) continue;
    ops.push((b) => b.update(doc(db, 'users', u.id), { roles: u.roles.filter((r) => r !== roleId) }));
  }
  await commitOps(ops);
}
export async function setUserJobRoles(userId, roleIds) {
  await updateDoc(doc(db, 'users', userId), { roles: [...new Set(roleIds)] });
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

// Form designer → Rules: show/hide rules built with clicks. Each rule reads as a sentence:
//   When [Status ▾] [is ▾] [Closed ▾]  (+ condition, + group)
//   Then [Hide ▾] [Tasks ✕] [Notes ✕] [+ add ▾]  (+ action)
// The logic lives in rules.js; this file draws the editor and handles its clicks.
import { esc, uid } from './ui.js';
import { ACTIONS, opsFor, opOf, kindOf, targetsOf, actionFits, checkRules, ruleText, ruleLabel } from './rules.js';
import { withStageField } from './workflow.js';
import { shownName } from './fieldnames.js';

let H = { fdraft: () => null, formById: null, recById: null, parentsOf: null, recordsOf: null, recTitle: null, setFdirty: null, renderMain: null, ui: () => ({}), canSeeTasks: () => true };
export function initRules(helpers) { H = { ...H, ...helpers }; initDrag(); }

/* The designer shows one rule at a time; the list beside it picks which. */
const S = { sel: new Map(), q: '', drag: null };
function selIndex(f) {
  const rules = f.rules || [], id = S.sel.get(f.id);
  const i = rules.findIndex((r) => r.id === id);
  return i < 0 ? 0 : i;
}
const select = (f, id) => { if (id) S.sel.set(f.id, id); };

const MAX_RULES = 100, MAX_CONDS = 12, MAX_TARGETS = 40;

/** The form's sub-forms (grids) and child forms, including ones not saved yet. */
function sectionsOf(f) {
  const look = (id) => H.formById(id) || (f._newForms || []).find((x) => x.id === id);
  const grids = [], kids = [];
  (f.children || []).forEach((c) => { const cf = look(c.formId); if (!cf || cf.id === f.id) return; (c.display === 'grid' ? grids : kids).push(cf); });
  return { grids, kids };
}
/** What rules on this form can look at and point at. */
export function rulesCtx(f) {
  const { grids, kids } = sectionsOf(f);
  const parents = (f.isNew ? [] : H.parentsOf(f.id)) || [];
  const parentFields = new Map(parents.map((p) => [p.id, { name: p.name, fields: (withStageField(p).fields || []).filter((x) => x.type !== 'heading') }]));
  const targets = targetsOf(f, { grids, kids, tasks: H.canSeeTasks() });
  return { form: withStageField(f), targets, parentFields, recordTitle: titleOf }; // conditions can use the workflow Stage
}
function titleOf(id) {
  if (!id) return '';
  const r = H.recById && H.recById(id), fm = r && H.formById(r.formId);
  if (r && fm) return H.recTitle(r, fm);
  return 'a record';
}

const fieldOf = (ctx, c) => (!c.src || c.src === 'self' ? (ctx.form.fields || []).find((x) => x.id === c.field) : ctx.parentFields.get(c.src)?.fields.find((x) => x.id === c.field));

function fieldPick(ctx, c, at) {
  const own = (ctx.form.fields || []).filter((x) => x.type !== 'heading');
  const cur = c.field ? (c.src && c.src !== 'self' ? c.src : 'self') + '|' + c.field : '';
  const opt = (src, x) => `<option value="${esc(src + '|' + x.id)}"${cur === src + '|' + x.id ? ' selected' : ''}>${esc(src === 'self' ? shownName(ctx.form, x) : x.label || 'Untitled field')}</option>`;
  let html = `<select class="in rl-f" ${at} data-rlc="field" aria-label="Field"><option value="">Pick a field…</option><optgroup label="This form">${own.map((x) => opt('self', x)).join('')}</optgroup>`;
  ctx.parentFields.forEach((p, id) => { html += `<optgroup label="Parent: ${esc(p.name)}">${p.fields.map((x) => opt(id, x)).join('')}</optgroup>`; });
  if (c.field && !fieldOf(ctx, c)) html += `<option value="${esc(cur)}" selected>(deleted field)</option>`;
  return html + '</select>';
}
function valuePick(ctx, c, f, at) {
  const o = f && opOf(f, c.op);
  if (!o || !o.value) return '';
  const v = c.value;
  switch (o.value) {
    case 'one': return `<select class="in rl-v" ${at} data-rlc="value" aria-label="Value"><option value="">Pick…</option>${(f.options || []).map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}${v && !(f.options || []).includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
    case 'many': { const have = Array.isArray(v) ? v : []; return `<span class="rl-many" role="group" aria-label="Values">${(f.options || []).map((x) => `<label class="rl-chk"><input type="checkbox" ${at} data-rlc="many" value="${esc(x)}"${have.includes(x) ? ' checked' : ''}><span>${esc(x)}</span></label>`).join('')}</span>`; }
    case 'num': return `<input class="in rl-v rl-num" type="number" step="any" inputmode="decimal" ${at} data-rlc="value" value="${esc(v ?? '')}" aria-label="Number">`;
    case 'date': return `<input class="in rl-v" type="date" ${at} data-rlc="value" value="${esc(v ?? '')}" aria-label="Date">`;
    case 'time': return `<input class="in rl-v" type="time" ${at} data-rlc="value" value="${esc(v ?? '')}" aria-label="Time">`;
    case 'record': { const tf = H.formById(f.relForm); const rs = tf ? H.recordsOf(tf.id).map((r) => ({ r, t: H.recTitle(r, tf) })).sort((a, b) => a.t.localeCompare(b.t)).slice(0, 500) : []; return `<select class="in rl-v" ${at} data-rlc="value" aria-label="Record"><option value="">Pick…</option>${rs.map(({ r, t }) => `<option value="${esc(r.id)}"${r.id === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`; }
    default: return `<input class="in rl-v" type="text" ${at} data-rlc="value" value="${esc(v ?? '')}" aria-label="Text" maxlength="200">`;
  }
}
function condRow(ctx, c, ri, ci, gi) {
  const at = `data-r="${ri}" data-c="${ci}"${gi != null ? ` data-g="${gi}"` : ''}`;
  const f = fieldOf(ctx, c);
  const ops = f ? opsFor(f) : [];
  return `<div class="rl-cond">${fieldPick(ctx, c, at)}
    ${f ? `<select class="in rl-op" ${at} data-rlc="op" aria-label="Comparison">${ops.map((o) => `<option value="${o.key}"${o.key === c.op ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : ''}
    ${valuePick(ctx, c, f, at)}
    <button type="button" class="ibtn rl-x" data-rl="delc" ${at} aria-label="Remove this condition">✕</button></div>`;
}
const joinPick = (j, at, words) => `<select class="in rl-join" ${at} aria-label="Match">${[['all', words[0]], ['any', words[1]]].map(([k, l]) => `<option value="${k}"${(j || 'all') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

function actRow(ctx, a, ri, ai) {
  const at = `data-r="${ri}" data-a="${ai}"`;
  const tmap = new Map(ctx.targets.map((t) => [t.key, t]));
  const fits = ctx.targets.filter((t) => actionFits(a.do, t) && !(a.targets || []).includes(t.key));
  const group = (kinds, label) => { const xs = fits.filter((t) => kinds.includes(t.kind)); return xs.length ? `<optgroup label="${label}">${xs.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</optgroup>` : ''; };
  const chips = (a.targets || []).map((k) => { const t = tmap.get(k); const bad = !t || !actionFits(a.do, t); return `<span class="rl-tgt${bad ? ' bad' : ''}">${t && { section: 1, grid: 1, child: 1 }[t.kind] ? `<small>${{ section: 'Section', grid: 'Grid', child: 'Child' }[t.kind]}</small>` : ''}${esc(t ? t.label : 'Deleted')}<button type="button" class="rl-tx" data-rl="deltarget" ${at} data-k="${esc(k)}" aria-label="Remove ${esc(t ? t.label : 'it')}">✕</button></span>`; }).join('');
  const more = (a.targets || []).length < MAX_TARGETS && fits.length ? `<select class="in rl-add" ${at} data-rla="add" aria-label="Add something to ${esc(ACTIONS.find((x) => x.key === a.do)?.label || '')}"><option value="">+ Add…</option>${group(['field'], 'Fields')}${group(['section'], 'Sections (heading and its fields)')}${group(['grid', 'child', 'tasks'], 'Under the fields')}</select>` : '';
  return `<div class="rl-act"><select class="in rl-do" ${at} data-rla="do" aria-label="Action">${ACTIONS.map((x) => `<option value="${x.key}"${x.key === a.do ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
    <span class="rl-tgts">${chips}${more}</span><button type="button" class="ibtn rl-x" data-rl="dela" ${at} aria-label="Remove this action">✕</button></div>`;
}

/** The "when" part of a rule: conditions, groups and the buttons to add them (also used by automations). */
export function condsHTML(ctx, r, ri, { label = 'When', words = ['all of these are true', 'any of these is true'], empty = 'Add a condition: which field, and what it should be.' } = {}) {
  const conds = (r.conds || []).map((c, ci) => {
    if (!c.group) return condRow(ctx, c, ri, ci);
    return `<div class="rl-group"><div class="rl-gh">${joinPick(c.join, `data-r="${ri}" data-c="${ci}" data-rlj="g"`, ['All of these', 'Any of these'])}<button type="button" class="btn sm ghost" data-rl="addc" data-r="${ri}" data-c="${ci}">+ Condition</button><button type="button" class="ibtn rl-x" data-rl="delc" data-r="${ri}" data-c="${ci}" aria-label="Remove this group">✕</button></div>
      ${(c.conds || []).map((x, gi) => condRow(ctx, x, ri, ci, gi)).join('') || '<p class="help">Add a condition to this group.</p>'}</div>`;
  }).join('');
  const nc = (r.conds || []).reduce((s, c) => s + (c.group ? (c.conds || []).length : 1), 0);
  return `<div class="rl-when"><span class="rl-lab">${esc(label)}</span>${(r.conds || []).length > 1 ? joinPick(r.join, `data-r="${ri}" data-rlj="r"`, words) : ''}</div>
    <div class="rl-conds">${conds || `<p class="help">${esc(empty)}</p>`}</div>
    <div class="rl-adds">${nc < MAX_CONDS ? `<button type="button" class="btn sm" data-rl="addc" data-r="${ri}">+ Condition</button><button type="button" class="btn sm ghost" data-rl="addg" data-r="${ri}" title="Several conditions together, like (A and B) or C">+ Group</button>` : ''}</div>`;
}

function ruleCard(ctx, r, ri, n, msgs) {
  const mine = msgs.filter((m) => m.ruleId === r.id);
  return `<article class="panel rl-card${r.off ? ' off' : ''}" data-rlid="${esc(r.id)}">
    <header class="rl-h"><b class="rl-num">Rule ${ri + 1}</b><label class="rl-namel"><span class="sr">Rule ${ri + 1} name</span><input class="in rl-name" data-rlname="1" data-r="${ri}" value="${esc(r.name || '')}" maxlength="60" placeholder="Name this rule (optional)" autocomplete="off"></label><span class="rl-fire" data-rlfire="${esc(r.id)}" hidden>Applies now</span>
      <label class="switch rl-on"><input type="checkbox" data-rl="toggle" data-r="${ri}"${r.off ? '' : ' checked'}><span class="tr"></span><span>${r.off ? 'Off' : 'On'}</span></label>
      <button type="button" class="ibtn" data-rl="move" data-r="${ri}" data-dir="-1" aria-label="Move rule ${ri + 1} up"${ri === 0 ? ' disabled' : ''}>↑</button>
      <button type="button" class="ibtn" data-rl="move" data-r="${ri}" data-dir="1" aria-label="Move rule ${ri + 1} down"${ri === n - 1 ? ' disabled' : ''}>↓</button>
      <button type="button" class="btn sm ghost" data-rl="dup" data-r="${ri}">Duplicate</button>
      <button type="button" class="btn sm danger${H.ui().confirm === 'rl-' + r.id ? ' armed' : ''}" data-rl="del" data-r="${ri}">${H.ui().confirm === 'rl-' + r.id ? 'Tap again to delete' : 'Delete'}</button></header>
    ${condsHTML(ctx, r, ri)}
    <div class="rl-when"><span class="rl-lab">Then</span></div>
    <div class="rl-acts">${(r.acts || []).map((a, ai) => actRow(ctx, a, ri, ai)).join('')}</div>
    <div class="rl-adds"><button type="button" class="btn sm" data-rl="adda" data-r="${ri}">+ Action</button></div>
    <p class="rl-say">${esc(ruleText(r, ctx))}</p>
    ${mine.length ? `<ul class="rl-msgs">${mine.map((m) => `<li>${esc(m.text)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

/** The left side of the Rules tab: the rule being edited, and problems found in the rules. */
export function viewRules(f) {
  const ctx = rulesCtx(f);
  const rules = f.rules || [];
  const msgs = checkRules(withStageField(f), ctx);
  const clashes = msgs.filter((m) => !m.ruleId);
  const ri = selIndex(f), r = rules[ri];
  const clashLine = (m) => (m.rules
    ? `<li><b>${esc(m.target)}</b>: ${m.rules.map((x) => `<button type="button" class="linkbtn" data-rl="pick" data-id="${esc(x.id)}">${esc(x.label)}</button> ${esc(x.verb)}`).join(', ')}. ${esc(m.tail)}</li>`
    : `<li>${esc(m.text)}</li>`);
  return `<section class="rl-list" aria-label="Rules">
    <div class="rl-top"><div><h2 class="dz-h">Show and hide rules</h2><p class="help">Rules decide what shows on a ${esc((f.itemName || f.name || 'record').toLowerCase())} as people fill it in. A hidden field, or one a rule clears, is emptied when the record is saved. Hiding isn’t a permission: lists, reports and exports still show the data.</p></div></div>
    ${clashes.length ? `<div class="panel rl-clash" role="note"><b>Rules that overlap</b><ul>${clashes.map(clashLine).join('')}</ul></div>` : ''}
    ${r ? `${rules.length > 1 ? `<div class="panel rl-nav"><b>Rule ${ri + 1} of ${rules.length}</b><span class="grow"></span><button type="button" class="btn sm" data-rl="prev"${ri === 0 ? ' disabled' : ''}>‹ Prev</button><button type="button" class="btn sm" data-rl="next"${ri === rules.length - 1 ? ' disabled' : ''}>Next ›</button></div>` : ''}
      ${ruleCard(ctx, r, ri, rules.length, msgs)}`
    : `<div class="panel rl-empty"><p><b>No rules yet.</b> For example: when <i>Type</i> is <i>Repair</i>, show <i>Warranty details</i>; or when <i>Status</i> is <i>Closed</i>, hide <i>Tasks</i>.</p>${rules.length < MAX_RULES ? '<button type="button" class="btn primary" data-rl="add">+ Add rule</button>' : ''}</div>`}
    <details class="rl-how"><summary>How rules work together</summary><ul class="help">
      <li><b>Show</b> means hidden the rest of the time. <b>Set required</b> means not required the rest of the time.</li>
      <li>When rules disagree, <b>Hide</b> wins over Show and <b>Set required</b> wins over Set not required. A hidden field is never required.</li>
      <li><b>Clear value</b> empties the field and locks it while the rule applies.</li>
      <li>Hiding a <b>section heading</b> hides every field under it. Hiding a grid, child section or Tasks never deletes anything.</li>
      <li>Conditions can look at the <b>parent</b> record (for example the client a job belongs to).</li>
      <li>The order of the rules doesn’t change what they do; drag them in the list to keep related rules together.</li>
    </ul></details>
  </section>`;
}

/** The right side's list of every rule: pick one to edit, search, drag to reorder. */
export function rulesListHTML(f) {
  const rules = f.rules || [];
  if (!rules.length) return '';
  const ctx = rulesCtx(f);
  const msgs = checkRules(withStageField(f), ctx);
  const overlap = new Set(msgs.filter((m) => m.rules).flatMap((m) => m.rules.map((x) => x.id)));
  const bad = new Set(msgs.filter((m) => m.ruleId).map((m) => m.ruleId));
  const cur = rules[selIndex(f)]?.id;
  const q = S.q.trim().toLowerCase();
  let shown = 0;
  const items = rules.map((r, i) => {
    const say = ruleText(r, ctx), title = String(r.name || '').trim() || `Rule ${i + 1}`;
    const hay = `${ruleLabel(f, r)} ${say}`.toLowerCase();
    const hit = !q || hay.includes(q); if (hit) shown++;
    return `<li class="rl-li${r.off ? ' off' : ''}" data-rldrag="${esc(r.id)}" data-rltext="${esc(hay)}"${q ? '' : ' draggable="true"'}${hit ? '' : ' hidden'}>
      <span class="rl-grip" aria-hidden="true" title="Drag to change the order">⋮⋮</span>
      <button type="button" class="rl-pick${r.id === cur ? ' on' : ''}" data-rl="pick" data-id="${esc(r.id)}"${r.id === cur ? ' aria-current="true"' : ''}>
        <span class="rl-n">${i + 1}</span>
        <span class="rl-pm"><b data-rltitle="${esc(r.id)}">${esc(title)}</b><span class="rl-ps">${esc(say)}</span>
          <span class="rl-tags"><span class="rl-fire" data-rlfire="${esc(r.id)}" hidden>Applies now</span>${overlap.has(r.id) ? '<span class="rl-tag warn">Overlaps</span>' : ''}${bad.has(r.id) ? '<span class="rl-tag warn">Needs attention</span>' : ''}${r.off ? '<span class="rl-tag">Off</span>' : ''}</span></span>
      </button></li>`;
  }).join('');
  return `<section class="panel rl-index" aria-label="All rules">
    <div class="rl-ih"><h2 class="dz-h">Rules <span class="count">${rules.length}</span></h2>${rules.length < MAX_RULES ? '<button type="button" class="btn sm primary" data-rl="add">+ Add rule</button>' : ''}</div>
    ${rules.length > 3 ? `<label class="rl-q"><span class="sr">Find a rule</span><input type="search" class="in" data-rlq="1" value="${esc(S.q)}" placeholder="Find a rule: name, field or section" autocomplete="off"></label>` : ''}
    <ol class="rl-ol">${items}</ol>
    <p class="help rl-none"${q && !shown ? '' : ' hidden'}>No rule mentions “${esc(S.q)}”.</p>
    <p class="help rl-ihelp">${q ? 'Clear the search to drag rules into a new order.' : 'Click a rule to edit it. Drag ⋮⋮ to change the order.'}</p>
  </section>`;
}

/** Typing in the Rules tab: a rule's name (the list follows as you type), and the list's search. */
export function rulesInput(f, el) {
  if (el.dataset?.rlname) {
    const r = (f.rules || [])[+el.dataset.r]; if (!r) return false;
    r.name = el.value.slice(0, 60);
    H.setFdirty();
    const t = document.querySelector(`[data-rltitle="${CSS.escape(r.id)}"]`); if (t) t.textContent = r.name.trim() || `Rule ${+el.dataset.r + 1}`;
    return true;
  }
  if (el.dataset?.rlq) {
    S.q = el.value;
    const q = S.q.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('.rl-ol [data-rldrag]').forEach((li) => {
      const hit = !q || li.dataset.rltext.includes(q); li.hidden = !hit; if (hit) shown++;
      if (q) li.removeAttribute('draggable'); else li.setAttribute('draggable', 'true');
    });
    const none = document.querySelector('.rl-none'); if (none) { none.hidden = !(q && !shown); none.textContent = `No rule mentions “${S.q}”.`; }
    const help = document.querySelector('.rl-ihelp'); if (help) help.textContent = q ? 'Clear the search to drag rules into a new order.' : 'Click a rule to edit it. Drag ⋮⋮ to change the order.';
    return true;
  }
  return false;
}

/* Dragging rules in the list into a new order. */
let dragReady = false;
function initDrag() {
  if (dragReady || typeof document === 'undefined') return; dragReady = true;
  const liOf = (e) => e.target?.closest?.('.rl-ol [data-rldrag]');
  const clear = () => document.querySelectorAll('.rl-ol .over, .rl-ol .dragging').forEach((x) => x.classList.remove('over', 'dragging'));
  document.addEventListener('dragstart', (e) => {
    const li = liOf(e); if (!li || S.q.trim()) return;
    S.drag = li.dataset.rldrag; li.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.drag); } catch (x) { /* some browsers */ }
  });
  document.addEventListener('dragover', (e) => {
    const li = liOf(e); if (!li || !S.drag) return;
    e.preventDefault();
    if (!li.classList.contains('over')) { document.querySelectorAll('.rl-ol .over').forEach((x) => x.classList.remove('over')); if (li.dataset.rldrag !== S.drag) li.classList.add('over'); }
  });
  document.addEventListener('drop', (e) => {
    const li = liOf(e); if (!li || !S.drag) return;
    e.preventDefault();
    const f = H.fdraft(), rules = f?.rules || [];
    const from = rules.findIndex((r) => r.id === S.drag), to = rules.findIndex((r) => r.id === li.dataset.rldrag);
    S.drag = null; clear();
    if (from < 0 || to < 0 || from === to) return;
    const [m] = rules.splice(from, 1); rules.splice(to, 0, m);
    changed();
  });
  document.addEventListener('dragend', () => { S.drag = null; clear(); });
}

/* ---------- editing ---------- */
const blankCond = () => ({ id: uid('c'), src: 'self', field: '', op: '', value: '' });
const blankRule = () => ({ id: uid('rl'), join: 'all', conds: [blankCond()], acts: [{ do: 'hide', targets: [] }] });
function condAt(f, el) {
  const r = (f.rules || [])[+el.dataset.r]; if (!r) return {};
  const c = r.conds?.[+el.dataset.c]; if (!c) return { r };
  if (el.dataset.g != null && c.group) return { r, c: c.conds?.[+el.dataset.g], list: c.conds, i: +el.dataset.g };
  return { r, c, list: r.conds, i: +el.dataset.c };
}
let onDirty = null; // who to tell about a change: the form designer, or the automation editor
function changed(focusSel) {
  (onDirty || H.setFdirty)(); H.renderMain();
  if (focusSel) setTimeout(() => document.querySelector(focusSel)?.focus({ preventScroll: true }), 0);
}

export function rulesClick(f, el, dirty = null) {
  onDirty = dirty;
  const a = el.dataset.rl, rules = (f.rules = f.rules || []);
  const ri = +el.dataset.r, r = rules[ri];
  const ui = H.ui();
  if (a !== 'del') ui.confirm = null;
  switch (a) {
    case 'pick': { select(f, el.dataset.id); H.renderMain(); setTimeout(() => { const c = document.querySelector('.rl-card'); if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 0); return; }
    case 'prev': case 'next': { const i = selIndex(f) + (a === 'next' ? 1 : -1); if (rules[i]) { select(f, rules[i].id); H.renderMain(); } return; }
    case 'add': { if (rules.length >= MAX_RULES) return; const nr = blankRule(); rules.push(nr); select(f, nr.id); S.q = ''; changed(`[data-rlid="${nr.id}"] .rl-f`); return; }
    case 'del': {
      if (!r) return;
      if (ui.confirm !== 'rl-' + r.id) { ui.confirm = 'rl-' + r.id; H.renderMain(); setTimeout(() => { if (ui.confirm === 'rl-' + r.id) { ui.confirm = null; H.renderMain(); } }, 5000); return; }
      ui.confirm = null; rules.splice(ri, 1); select(f, (rules[ri] || rules[ri - 1])?.id); changed(); return;
    }
    case 'dup': { if (!r || rules.length >= MAX_RULES) return; const c = JSON.parse(JSON.stringify(r)); c.id = uid('rl'); if (c.name) c.name = (c.name + ' (copy)').slice(0, 60); rules.splice(ri + 1, 0, c); select(f, c.id); changed(`[data-rlid="${c.id}"] .rl-f`); return; }
    case 'move': { const j = ri + +el.dataset.dir; if (!r || j < 0 || j >= rules.length) return; [rules[ri], rules[j]] = [rules[j], rules[ri]]; changed(`[data-rl="move"][data-r="${j}"][data-dir="${el.dataset.dir}"]:not(:disabled)`); return; }
    case 'addc': {
      if (!r) return;
      if (el.dataset.c != null) { const g = r.conds[+el.dataset.c]; if (g?.group) { g.conds.push(blankCond()); changed(`.rl-cond [data-r="${ri}"][data-c="${el.dataset.c}"][data-g="${g.conds.length - 1}"][data-rlc="field"]`); } return; }
      r.conds.push(blankCond()); changed(`.rl-cond [data-r="${ri}"][data-c="${r.conds.length - 1}"][data-rlc="field"]:not([data-g])`); return;
    }
    case 'addg': { if (!r) return; r.conds.push({ id: uid('g'), group: true, join: 'any', conds: [blankCond(), blankCond()] }); changed(); return; }
    case 'delc': { const { list, i } = condAt(f, el); if (!list) return; list.splice(i, 1); changed(); return; }
    case 'adda': { if (!r) return; const used = new Set(r.acts.map((x) => x.do)); r.acts.push({ do: ACTIONS.find((x) => !used.has(x.key))?.key || 'hide', targets: [] }); changed(); return; }
    case 'dela': { if (!r) return; r.acts.splice(+el.dataset.a, 1); changed(); return; }
    case 'deltarget': { const act = r?.acts?.[+el.dataset.a]; if (!act) return; act.targets = act.targets.filter((k) => k !== el.dataset.k); changed(`[data-rla="add"][data-r="${ri}"][data-a="${el.dataset.a}"]`); return; }
  }
}

export function rulesChange(f, el, dirty = null) {
  onDirty = dirty;
  const rules = f.rules || [], ri = +el.dataset.r, r = rules[ri];
  if (!r) return;
  if (el.dataset.rl === 'toggle') { r.off = !el.checked; if (!r.off) delete r.off; changed(); return; }
  if (el.dataset.rlj === 'r') { r.join = el.value; changed(); return; }
  if (el.dataset.rlj === 'g') { const g = r.conds[+el.dataset.c]; if (g) g.join = el.value; changed(); return; }
  if (el.dataset.rlc) {
    const { c } = condAt(f, el); if (!c) return;
    const ctx = rulesCtx(f);
    if (el.dataset.rlc === 'field') {
      const [src, field] = el.value.split('|'); c.src = src || 'self'; c.field = field || '';
      const nf = fieldOf(ctx, c); const ops = nf ? opsFor(nf) : [];
      c.op = ops[0]?.key || ''; c.value = '';
      changed(`[data-rlc="op"][data-r="${el.dataset.r}"][data-c="${el.dataset.c}"]${el.dataset.g != null ? `[data-g="${el.dataset.g}"]` : ':not([data-g])'}`);
      return;
    }
    if (el.dataset.rlc === 'op') {
      const nf = fieldOf(ctx, c); const was = nf && opOf(nf, c.op), now = nf && opOf(nf, el.value);
      c.op = el.value;
      if (!now || !now.value || (was && was.value !== now.value)) c.value = now && now.value === 'many' ? [] : '';
      changed(`[data-rlc="value"][data-r="${el.dataset.r}"][data-c="${el.dataset.c}"]${el.dataset.g != null ? `[data-g="${el.dataset.g}"]` : ':not([data-g])'}`);
      return;
    }
    if (el.dataset.rlc === 'many') { const have = new Set(Array.isArray(c.value) ? c.value : []); if (el.checked) have.add(el.value); else have.delete(el.value); const nf = fieldOf(ctx, c); c.value = (nf?.options || []).filter((x) => have.has(x)); changed(); return; }
    if (el.dataset.rlc === 'value') {
      const nf = fieldOf(ctx, c); const o = nf && opOf(nf, c.op);
      c.value = o && o.value === 'num' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      changed(); return;
    }
  }
  if (el.dataset.rla === 'do') {
    const act = r.acts[+el.dataset.a]; if (!act) return;
    act.do = el.value;
    const tmap = new Map(rulesCtx(f).targets.map((t) => [t.key, t]));
    act.targets = act.targets.filter((k) => actionFits(act.do, tmap.get(k)));
    changed(); return;
  }
  if (el.dataset.rla === 'add') {
    const act = r.acts[+el.dataset.a]; if (!act || !el.value) return;
    if (!act.targets.includes(el.value)) act.targets.push(el.value);
    changed(`[data-rla="add"][data-r="${ri}"][data-a="${el.dataset.a}"]`); return;
  }
}

/** Which conditions use the parent record, by parent form: Map(formId → Set(field ids)). */
export function parentUse(f) {
  const out = new Map();
  (f.rules || []).forEach((r) => (r.conds || []).flatMap((c) => (c.group ? c.conds || [] : [c])).forEach((c) => {
    if (!c.field || !c.src || c.src === 'self') return;
    if (!out.has(c.src)) out.set(c.src, new Set());
    out.get(c.src).add(c.field);
  }));
  return out;
}
export { kindOf };

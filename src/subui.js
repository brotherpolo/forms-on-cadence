// The tool bar, column picker, "Show" menu and "Showing 10 of 34" line used by the sections
// under a record's fields (grids, child records, tasks). HTML only; app.js handles the clicks:
//   data-act="sub-pop" | "sub-pop-close" | "sub-col-move" | "sub-cols-reset" | "sub-sort" | "sub-showall"
//   change: data-subcol (column tick), data-subshow (Show menu), data-subsort (phone sort menu)
import { esc } from './ui.js';
import { SHOW_OPTS } from './sublogic.js';

const ICON = {
  cols: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

/**
 * Columns button and, when open, its picker.
 * shown: [{key,label,src}] in order; catalog: [{key,label,group}]; fixed: label always first (or '');
 * min: fewest columns allowed.
 */
export function colsTool(k, open, shown, catalog, { fixed = '', min = 0 } = {}) {
  let pop = '';
  if (open) {
    const on = new Set(shown.map((c) => c.key));
    const groups = [];
    catalog.filter((x) => !on.has(x.key)).forEach((x) => { let g = groups.find((y) => y.name === x.group); if (!g) groups.push((g = { name: x.group, cols: [] })); g.cols.push(x); });
    pop = `<div class="lv-pop sub-pop" role="dialog" aria-label="Columns"><h3>Columns</h3><p class="lv-hint">Tick to show, arrows to reorder.${fixed ? ` ${esc(fixed)} always comes first.` : ''} Kept for you on this device.</p>
      ${fixed ? `<div class="lv-crow lv-fixed"><input type="checkbox" checked disabled aria-label="${esc(fixed)} (always shown)"><span>${esc(fixed)}</span><span class="lv-src">Always</span></div>` : ''}
      ${shown.map((x, i) => `<div class="lv-crow"><label><input type="checkbox" checked data-subcol="${esc(k)}" data-v="${esc(x.key)}"${shown.length <= min ? ' disabled' : ''}><span>${esc(x.label)}</span></label>${x.src ? `<span class="lv-src">${esc(x.src)}</span>` : ''}
        <button type="button" class="lv-mv" data-act="sub-col-move" data-k="${esc(k)}" data-v="${esc(x.key)}" data-dir="-1" aria-label="Move ${esc(x.label)} left"${i === 0 ? ' disabled' : ''}>${ICON.up}</button>
        <button type="button" class="lv-mv" data-act="sub-col-move" data-k="${esc(k)}" data-v="${esc(x.key)}" data-dir="1" aria-label="Move ${esc(x.label)} right"${i === shown.length - 1 ? ' disabled' : ''}>${ICON.down}</button></div>`).join('')}
      ${groups.map((g) => `${g.name ? `<div class="lv-sec">${esc(g.name)}</div>` : ''}${g.cols.map((x) => `<div class="lv-crow"><label><input type="checkbox" data-subcol="${esc(k)}" data-v="${esc(x.key)}"><span>${esc(x.label)}</span></label></div>`).join('')}`).join('')}
      <div class="lv-popfoot"><button class="btn ghost" type="button" data-act="sub-cols-reset" data-k="${esc(k)}">Reset columns</button><button class="btn" type="button" data-act="sub-pop-close">Done</button></div></div>`;
  }
  return `<div class="lv-anchor"><button class="btn sm${open ? ' on' : ''}" type="button" data-act="sub-pop" data-k="${esc(k)}" aria-expanded="${open}">${ICON.cols}Columns</button>${pop}</div>`;
}

/** The Show menu: 5, 10, 15, 20 or all rows. */
export function showMenu(k, show, total) {
  return `<label class="sub-show"><span>Show</span><select class="in" data-subshow="${esc(k)}" aria-label="How many to show">${SHOW_OPTS.map((n) => `<option value="${n}"${n === show ? ' selected' : ''}>${n === 'all' ? `All${total != null ? ' (' + total + ')' : ''}` : n}</option>`).join('')}</select></label>`;
}

/** Phones: a sort menu (tables become cards there, so the headings aren't on screen). */
export function sortMenu(k, cols, sort, defaultLabel) {
  const cur = sort ? sort.key + '|' + sort.dir : '';
  const opts = (defaultLabel ? [`<option value=""${cur ? '' : ' selected'}>${esc(defaultLabel)}</option>`] : [])
    .concat(cols.flatMap((c) => ['asc', 'desc'].map((d) => `<option value="${esc(c.key + '|' + d)}"${cur === c.key + '|' + d ? ' selected' : ''}>${esc(c.label)} ${d === 'asc' ? (c.num || c.date ? '(low to high)' : '(A to Z)') : (c.num || c.date ? '(high to low)' : '(Z to A)')}</option>`)));
  return `<label class="sub-sortm"><span>Sort</span><select class="in" data-subsort="${esc(k)}" aria-label="Sort by">${opts.join('')}</select></label>`;
}

/** The bar at the top of a section: search on the left, then Columns and Show, buttons on the right. */
export function toolBar({ search = '', tools = '', buttons = '', hint = '' }) {
  return `<div class="sub-tools">${search}<div class="sub-mid">${tools}</div>${buttons ? `<div class="sub-btns">${buttons}</div>` : ''}</div>${hint ? `<p class="help sub-hint">${hint}</p>` : ''}`;
}

/** "Showing 10 of 34 · Show all", when rows are held back. */
export function moreLine(k, shown, total, noun) {
  return shown < total ? `<div class="sub-more"><span>Showing ${shown} of ${total} ${esc(noun)}</span><button type="button" class="btn sm ghost" data-act="sub-showall" data-k="${esc(k)}">Show all</button></div>` : '';
}

/** A sortable heading. */
export function headCell(k, col, sort) {
  const on = sort && sort.key === col.key;
  const arr = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"${col.num ? ' class="num"' : ''}><button type="button" class="lv-hb${on ? ' on' : ''}" data-act="sub-sort" data-k="${esc(k)}" data-v="${esc(col.key)}">${esc(col.label)}<span class="lv-arr" aria-hidden="true">${arr}</span></button></th>`;
}

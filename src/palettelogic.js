// Ctrl K: one box to jump to a page, a form or a record. No DOM here, so it can be tested on its own.

const words = (q) => String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

/** How well an item matches what's typed: 0 = not at all; higher is better. Every word must appear. */
export function matchScore(label, sub, q) {
  const ws = words(q);
  if (!ws.length) return 1;
  const l = String(label || '').toLowerCase(), all = l + ' ' + String(sub || '').toLowerCase();
  if (!ws.every((w) => all.includes(w))) return 0;
  const first = ws[0];
  if (l.startsWith(first)) return 4;
  if (l.split(/[^a-z0-9]+/).some((t) => t.startsWith(first))) return 3;
  if (l.includes(first)) return 2;
  return 1;
}

/**
 * items: [{ kind: 'page'|'form'|'new'|'record', id, label, sub, at }] (at: last change, for records).
 * Typed: the best matches, pages and forms before records at the same score, up to `limit`.
 * Empty: pages, then forms, then the most recently changed records.
 */
export function paletteResults(items, q, limit = 12) {
  const rank = { page: 0, form: 1, new: 2, record: 3 };
  const typed = words(q).length > 0;
  const scored = (items || []).map((it, i) => ({ it, i, s: matchScore(it.label, it.sub, q) })).filter((x) => x.s > 0);
  if (!typed) {
    const head = scored.filter((x) => x.it.kind !== 'record' && x.it.kind !== 'new');
    const recs = scored.filter((x) => x.it.kind === 'record').sort((a, b) => (b.it.at || 0) - (a.it.at || 0)).slice(0, 5);
    return [...head, ...recs].slice(0, limit).map((x) => x.it);
  }
  return scored.sort((a, b) => b.s - a.s || rank[a.it.kind] - rank[b.it.kind] || (b.it.at || 0) - (a.it.at || 0) || a.i - b.i)
    .slice(0, limit).map((x) => x.it);
}

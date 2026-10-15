// Auto number fields: how a number looks, for the designer's preview. The server hands the
// numbers out (Cadence folder, functions/autonumber.js, which formats them the same way).
// Pure functions: no DOM, no Firebase.

const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

export function autoSettings(f) {
  return {
    prefix: String(f?.prefix || '').slice(0, 20),
    start: clampInt(f?.start, 0, 1e9, 1),
    digits: clampInt(f?.digits, 1, 9, 1),
    year: !!f?.year,
  };
}

/** 42 → 'INV-2026-0042' for prefix 'INV-', 4 digits, year on. */
export function formatAuto(f, n, year) {
  const s = autoSettings(f);
  return s.prefix + (s.year ? year + '-' : '') + String(n).padStart(s.digits, '0');
}

/** The next number a field hands out, from its counter ({ next, years } or null). */
export function nextAuto(f, counter, year) {
  const s = autoSettings(f);
  const cur = s.year ? (counter?.years || {})[String(year)] : counter?.next;
  return Math.max(s.start, Number.isFinite(cur) ? cur : s.start);
}

/** Records of a form still waiting for a number in this field, and how many of them have one typed in. */
export function missingNumbers(records, formId, fieldId) {
  const missing = records.filter((r) => r.formId === formId && !(r.nums && r.nums[fieldId]));
  const typed = missing.filter((r) => { const v = r.values?.[fieldId]; return v != null && v !== '' && !(Array.isArray(v) && !v.length); }).length;
  return { missing: missing.length, typed };
}

// Web addresses for Formwright screens, so other apps (Cadence) can link to a record
// and a refreshed or shared page opens where it was.
//   #/record/<recordId>   one record
//   #/form/<formId>       a form's record list
//   #/reports             the Reports list
//   #/report/<reportId>   one report
// Pure functions: no DOM, no Firebase.

const RE = /^#\/(record|form|report)\/([^/?#]+)\/?$/;

/** '#/record/abc' -> { kind: 'record', id: 'abc' }; '#/reports' -> { kind: 'reports' }; anything else -> null */
export function parseRoute(hash) {
  if (/^#\/reports\/?$/.test(String(hash || ''))) return { kind: 'reports' };
  const m = RE.exec(String(hash || ''));
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[2]);
  } catch (e) {
    return null;
  }
  return id ? { kind: m[1], id } : null;
}

/** The address for a view, or '' for screens that don't get one (designer, admin, new records). */
export function routeFor(view) {
  if (!view) return '';
  if (view.name === 'record' && view.recordId) return '#/record/' + encodeURIComponent(view.recordId);
  if (view.name === 'records' && view.formId) return '#/form/' + encodeURIComponent(view.formId);
  if (view.name === 'reports') return '#/reports';
  if (view.name === 'report' && view.reportId) return '#/report/' + encodeURIComponent(view.reportId);
  return '';
}

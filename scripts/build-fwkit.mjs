#!/usr/bin/env node
// Bundle what the Cadence functions need from Formwright (record text, calculations, rules,
// the PDF model and drawing) into one CommonJS file:
//   node scripts/build-fwkit.mjs ../cadence/functions/fwkit.cjs
// Run it after changing formulas, rules, PDFs or src/server/, then deploy the functions.
import { build } from 'esbuild';
const out = process.argv[2] || 'dist/fwkit.cjs';
await build({
  entryPoints: ['src/server/entry.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: out,
  banner: { js: '// Generated from Formwright src/server (scripts/build-fwkit.mjs). Do not edit by hand.' },
  logLevel: 'warning',
});
console.log('Wrote ' + out);

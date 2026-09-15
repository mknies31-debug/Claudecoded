#!/usr/bin/env node
// build-check.js — (re)inline the shared libs + templates.json into index.html
// between their marker comments, verify byte equality, syntax-check every
// inline script, and report the file size. Zero dependencies.
//
//   node test/build-check.js          inline from disk, then verify
//   node test/build-check.js --check  verify only (no rewrite); exits 1 on drift
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const MAX_BYTES = 400 * 1024;
const CHECK_ONLY = process.argv.includes('--check');

const PARTS = [
  { name: 'engine.js', file: 'netlify/functions/lib/engine.js' },
  { name: 'compliance.js', file: 'netlify/functions/lib/compliance.js' },
  { name: 'stats.js', file: 'netlify/functions/lib/stats.js' },
  { name: 'templates.json', file: 'templates.json' },
];

let failed = false;
function fail(msg) { failed = true; console.log('FAIL  ' + msg); }
function ok(msg) { console.log('ok    ' + msg); }

let html = fs.readFileSync(INDEX, 'utf8');

// 1. Inline (unless --check) and verify each part.
for (const p of PARTS) {
  const begin = `<!-- BEGIN ${p.name} -->`;
  const end = `<!-- END ${p.name} -->`;
  const a = html.indexOf(begin);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) { fail(`${p.name}: markers missing or out of order`); continue; }
  if (html.indexOf(begin, a + 1) !== -1) { fail(`${p.name}: BEGIN marker appears more than once`); continue; }
  const src = fs.readFileSync(path.join(ROOT, p.file), 'utf8');
  // For the JS libs the marker sits inside a block comment: `/* <!-- BEGIN x --> */`.
  const isJs = p.name.endsWith('.js');
  const beginFull = isJs ? begin + ' */' : begin;
  const endFull = isJs ? '/* ' + end : end;
  const a2 = html.indexOf(beginFull);
  const b2 = html.lastIndexOf(endFull, b);
  if (a2 === -1 || b2 === -1) { fail(`${p.name}: marker wrapper (${isJs ? 'block comment' : 'plain'}) not found`); continue; }
  const start = a2 + beginFull.length;
  if (!CHECK_ONLY) {
    html = html.slice(0, start) + '\n' + src + '\n' + html.slice(b2);
  }
  // Verify: text between markers, trimming exactly one leading and one trailing newline.
  const s2 = html.indexOf(beginFull) + beginFull.length;
  const e2 = html.lastIndexOf(endFull, html.indexOf(end));
  let between = html.slice(s2, e2);
  if (between.startsWith('\n')) between = between.slice(1);
  if (between.endsWith('\n')) between = between.slice(0, -1);
  if (between === src) ok(`${p.name} inlined byte-identical (${src.length} chars)`);
  else fail(`${p.name} differs from disk (inlined ${between.length} chars vs ${src.length} on disk)`);
}

if (!CHECK_ONLY) fs.writeFileSync(INDEX, html);

// 2. Every inline <script> without a JSON type must parse.
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m;
let n = 0;
while ((m = scriptRe.exec(html))) {
  const attrs = m[1] || '';
  n++;
  if (/type\s*=\s*["']application\/json["']/i.test(attrs)) {
    const body = m[2];
    const a = body.indexOf('<!-- BEGIN templates.json -->') + '<!-- BEGIN templates.json -->'.length;
    const b = body.indexOf('<!-- END templates.json -->');
    try { const j = JSON.parse(body.slice(a, b)); ok(`script #${n} JSON parses (${j.templates.length} templates)`); }
    catch (e) { fail(`script #${n} JSON does not parse: ${e.message}`); }
    continue;
  }
  if (/\ssrc\s*=/i.test(attrs)) { fail(`script #${n} has a src attribute (external scripts are not allowed)`); continue; }
  try { new Function(m[2]); ok(`script #${n} parses (${m[2].length} chars)`); }
  catch (e) { fail(`script #${n} does not parse: ${e.message}`); }
}

// 3. No external resources of any kind.
const external = html.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
if (external.length) fail('external resource references: ' + external.join(', '));
else ok('no external src/href resources');
if (/@import|url\(\s*["']?https?:/i.test(html)) fail('CSS references an external URL');

// 4. Size.
const bytes = Buffer.byteLength(html, 'utf8');
console.log(`size  index.html = ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB), limit ${MAX_BYTES / 1024} KB`);
if (bytes > MAX_BYTES) fail('index.html exceeds 400 KB');

console.log(failed ? 'BUILD-CHECK FAILED' : 'BUILD-CHECK OK');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// test/serve.js — tiny static server with gzip, the way Netlify serves the
// app (Netlify gzips text responses). Zero dependencies.
//
//   node test/serve.js [port]        default 8788, serves the keep-in-touch folder
//
// Prints the gzipped size of index.html on start so the perf numbers in
// docs/06-audit.md can be reproduced.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8788);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const type = TYPES[ext] || 'application/octet-stream';
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /^(text\/|application\/json)/.test(type);
  const out = gz ? zlib.gzipSync(body, { level: 9 }) : body;
  res.writeHead(200, Object.assign({ 'content-type': type, 'content-length': out.length, 'cache-control': 'no-store' }, gz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}));
  res.end(out);
});

server.listen(PORT, () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'));
  const gz = zlib.gzipSync(html, { level: 9 });
  console.log(`serve.js on http://localhost:${PORT}  index.html ${html.length} bytes raw, ${gz.length} bytes gzipped`);
});

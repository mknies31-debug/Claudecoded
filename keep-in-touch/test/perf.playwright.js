#!/usr/bin/env node
// perf.playwright.js — "queue loads in under one second on a throttled
// connection". Uses Chrome DevTools network emulation against the gzip server
// in test/serve.js, with a customer already in localStorage, and reports:
//   - gzipped transfer size of index.html
//   - navigation timing (responseEnd, DOMContentLoaded, load)
//   - time until the first queue card is in the DOM (MutationObserver,
//     installed before any page script runs)
// for Fast 3G (1.6 Mbps down / 750 Kbps up / 150 ms) and Slow 3G
// (400 Kbps / 400 Kbps / 400 ms). Fails if Fast 3G first-card > 1000 ms.
//
//   node test/serve.js 8788 &
//   NODE_PATH=/opt/node22/lib/node_modules node test/perf.playwright.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = require('playwright');

const BASE = process.env.KIT_URL || 'http://localhost:8788';
const ROOT = path.resolve(__dirname, '..');
const RUNS = Number(process.env.PERF_RUNS || 3);

const PROFILES = {
  'Fast 3G': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  'Slow 3G': { latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
};

function chicagoToday(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const o = {}; parts.forEach((p) => { o[p.type] = p.value; });
  return `${o.year}-${o.month}-${o.day}`;
}

// A realistic local-mode database: 40 customers, 3 of them due today.
function seedDb() {
  const customers = {};
  const today = chicagoToday(0);
  for (let i = 0; i < 40; i++) {
    const id = 'perfcust' + String(i).padStart(12, '0');
    const due = i < 3;
    const sale = due ? chicagoToday(-3 - i) : chicagoToday(-40 - i);
    customers[id] = {
      name: ['Dan Halvorson', 'Kari Lindqvist', 'Tom Ruud', 'Ann Sorensen'][i % 4] + ' ' + i, first: ['Dan', 'Kari', 'Tom', 'Ann'][i % 4],
      phone: '507555' + String(1000 + i), email: 'cust' + i + '@example.com',
      vehicle: { year: 2015 + (i % 9), make: 'Chevrolet', model: 'Silverado', trim: '' }, vehicleLabel: (2015 + (i % 9)) + ' Silverado',
      saleDate: sale, birthday: '', referredBy: '', referredByName: '', attributedTouchId: '', hook: 'the gravel road out by Goodhue', notes: '',
      emailConsent: { given: true, at: sale + 'T15:00:00.000Z', how: 'in person at sale' }, smsConsent: { given: true, at: sale + 'T15:00:00.000Z', how: 'in person at sale' },
      status: 'active', dnc: null, anchorDate: sale, anchorTouchN: 0, nextTouchN: due ? 0 : 1, slotOffset: 0, referralCredit: false, snoozedUntil: '',
      lastSentAt: '', lastSentDate: due ? '' : sale, lastReplyAt: '', lastReplyDate: '', firstTextSentAt: '', usedTemplateIds: due ? [] : ['thanks-01'], unreadReplies: 0,
      unsubscribeToken: 'tok' + String(i).padStart(29, 'x'), purchases: [{ saleDate: sale, vehicle: { year: 2015 + (i % 9), model: 'Silverado' }, vehicleLabel: (2015 + (i % 9)) + ' Silverado' }],
      pendingThanks: null, createdAt: sale + 'T15:00:00.000Z', updatedAt: sale + 'T15:00:00.000Z'
    };
  }
  const settings = {
    mickPhone: '5075550000', mickPhoneDisplay: '(507) 555-0000', fromName: 'Mick at North Star Car Guy', fromEmail: 'mick@northstarcarguy.com', replyTo: '',
    businessAddress: '123 Main St, Zumbrota, MN 55992', siteUrl: BASE, sendSecret: '', autoSendEmail: false, autoSendSms: false, sendHour: 9, minGapDays: 21,
    senderMode: 'mick', firebase: { apiKey: '', projectId: '' }, updatedAt: today + 'T00:00:00.000Z'
  };
  return { customers, touches: {}, replies: {}, templates: {}, settings, heartbeat: null };
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'));
  const gz = zlib.gzipSync(html, { level: 9 });
  console.log(`index.html: ${html.length} bytes raw, ${gz.length} bytes gzipped (${(gz.length / 1024).toFixed(1)} KB)`);

  const browser = await chromium.launch();
  const seed = JSON.stringify(seedDb());
  const results = {};

  for (const [name, cond] of Object.entries(PROFILES)) {
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
      await context.addInitScript((db) => {
        try { localStorage.setItem('kit.db', db); localStorage.setItem('kit.ui', JSON.stringify({ tab: 'queue' })); } catch (e) {}
        window.__firstCard = 0;
        const check = () => {
          if (!window.__firstCard && document.querySelector('.card[data-key]')) {
            window.__firstCard = performance.now();
            const es = performance.getEntriesByType('paint').map((p) => p.name + '=' + Math.round(p.startTime));
            window.__paints = es.join(',');
          }
        };
        const mo = new MutationObserver(check);
        mo.observe(document, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', check);
      }, seed);
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', Object.assign({ offline: false }, cond));
      await page.goto(BASE + '/', { waitUntil: 'load' });
      await page.waitForSelector('.card[data-key]', { timeout: 30000 });
      const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return {
          transferSize: nav.transferSize, encodedBodySize: nav.encodedBodySize, decodedBodySize: nav.decodedBodySize,
          ttfb: Math.round(nav.responseStart), responseEnd: Math.round(nav.responseEnd),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
          firstCard: Math.round(window.__firstCard), paints: window.__paints || '',
          cards: document.querySelectorAll('.card[data-key]').length
        };
      });
      assert.strictEqual(errors.length, 0, 'console/page errors under ' + name + ': ' + errors.join(' | '));
      assert.strictEqual(m.cards, 3, 'three due cards rendered');
      assert.ok(m.encodedBodySize < m.decodedBodySize, 'response was gzipped (encoded ' + m.encodedBodySize + ' < decoded ' + m.decodedBodySize + ')');
      runs.push(m);
      await context.close();
    }
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    results[name] = { ttfb: med('ttfb'), responseEnd: med('responseEnd'), domContentLoaded: med('domContentLoaded'), load: med('load'), firstCard: med('firstCard'), encodedBodySize: runs[0].encodedBodySize, decodedBodySize: runs[0].decodedBodySize, paints: runs[0].paints };
    console.log(`${name.padEnd(8)} (median of ${RUNS}): TTFB ${results[name].ttfb} ms · HTML received ${results[name].responseEnd} ms · DOMContentLoaded ${results[name].domContentLoaded} ms · load ${results[name].load} ms · first queue card in DOM ${results[name].firstCard} ms · wire ${results[name].encodedBodySize} B gzip / ${results[name].decodedBodySize} B raw${results[name].paints ? ' · ' + results[name].paints : ''}`);
  }

  await browser.close();
  const fast = results['Fast 3G'];
  if (fast.firstCard > 1000 || fast.load > 1000) {
    console.log(`PERF FAILED: Fast 3G first card ${fast.firstCard} ms / load ${fast.load} ms (limit 1000 ms)`);
    process.exit(1);
  }
  console.log(`PERF OK — Fast 3G: first queue card at ${fast.firstCard} ms, load ${fast.load} ms (limit 1000 ms). Slow 3G reported above for honesty; it is not a gate.`);
})().catch((e) => { console.error('PERF FAILED: ' + (e && e.stack || e)); process.exit(1); });

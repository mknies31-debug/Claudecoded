#!/usr/bin/env node
// smoke.playwright.js — opens index.html in headless Chromium at phone width,
// walks every tab, adds a customer whose thank-you is due today, and saves
// screenshots to docs/screens/. Fails on any console error, page error,
// horizontal scroll, or missing sms: link.
//
//   python3 -m http.server 8787 --directory keep-in-touch &
//   NODE_PATH=<dir with node_modules> node test/smoke.playwright.js
// Optional env: KIT_URL (default http://localhost:8787), PLAYWRIGHT_BROWSERS_PATH.
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = require('playwright');

const BASE = process.env.KIT_URL || 'http://localhost:8787';
const OUT = path.resolve(__dirname, '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

function chicagoToday(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const o = {}; parts.forEach((p) => { o[p.type] = p.value; });
  return `${o.year}-${o.month}-${o.day}`;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push('console.error: ' + msg.text()); });
  page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
  page.on('dialog', (d) => d.accept());

  let shots = 0;
  async function shot(name) {
    await page.waitForTimeout(150);
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.className = ''; });
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 375, `${name}: horizontal scroll (scrollWidth ${w} > 375)`);
    await page.screenshot({ path: path.join(OUT, name), fullPage: false });
    shots++;
    console.log('shot  ' + name + ' (scrollWidth ' + w + ')');
  }

  // 1. Queue, empty.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('nav.tabs button');
  assert.strictEqual(await page.title(), 'North Star Car Guy · Keep In Touch');
  assert.ok(await page.locator('text=Nothing due today.').count(), 'empty queue message');
  await shot('01-queue-empty.png');

  // 2. Settings: give the sign-off a phone number (exercises the settings form).
  await page.click('nav.tabs button[data-tab="settings"]');
  await page.waitForSelector('form[data-form="settings"]');
  await page.fill('form[data-form="settings"] input[name="mickPhone"]', '5075550000');
  await page.click('form[data-form="settings"] button[type="submit"]');
  await page.waitForTimeout(100);
  const savedPhone = await page.evaluate(() => JSON.parse(localStorage.getItem('kit.db')).settings.mickPhoneDisplay);
  assert.strictEqual(savedPhone, '(507) 555-0000', 'phone saved and formatted');

  // 3. Add customer form.
  await page.click('nav.tabs button[data-tab="add"]');
  await page.waitForSelector('form[data-form="customer"]');
  await shot('02-add-customer.png');

  await page.fill('input[name="name"]', 'Dan Halvorson');
  await page.fill('input[name="phone"]', '5075551234');
  await page.fill('input[name="email"]', 'Dan@Example.com');
  await page.fill('input[name="year"]', '2019');
  await page.fill('input[name="make"]', 'Chevrolet');
  await page.fill('input[name="model"]', 'Silverado');
  await page.fill('input[name="saleDate"]', chicagoToday(-3));
  await page.fill('input[name="hook"]', 'the gravel road out by Goodhue');
  await page.check('input[name="emailGiven"]');
  await page.check('input[name="smsGiven"]');
  await page.click('form[data-form="customer"] button[type="submit"]');

  // 3. Lands on the timeline.
  await page.waitForSelector('text=Timeline');
  assert.ok(await page.locator('text=Email: yes (in person at sale').count(), 'consent summary shows email yes');
  assert.ok(await page.locator('text=(507) 555-1234').count(), 'phone formatted');
  await shot('04-timeline.png');

  // 4. Queue with one THANKS card.
  await page.click('nav.tabs button[data-tab="queue"]');
  await page.waitForSelector('.card[data-key]');
  assert.strictEqual(await page.locator('.card[data-key]').count(), 1, 'one queue card');
  assert.ok(await page.locator('.card .chip.mag:has-text("Thanks")').count(), 'THANKS slot chip');
  const badge = await page.locator('nav.tabs button[data-tab="queue"] .badge').textContent();
  assert.strictEqual(badge.trim(), '1', 'queue badge = 1');
  const href = await page.getAttribute('a[data-act="sendSms"]', 'href');
  assert.ok(href && href.startsWith('sms:+15075551234?&body='), 'Send as Text href starts with sms: (' + href + ')');
  const body = decodeURIComponent(href.split('body=')[1]);
  assert.ok(/Dan/.test(body) && /2019 Silverado/.test(body), 'text body is rendered');
  assert.ok(/Reply STOP to opt out\.$/.test(body), 'first text carries the STOP line');
  const emailText = await page.inputValue('.card textarea[data-field="email"]');
  assert.ok(/North Star Car Guy/.test(emailText), 'sign-off present in email draft');
  assert.ok(!/\[first\]|\[vehicle\]|\[phone\]/.test(emailText), 'no unfilled placeholders');
  assert.ok(/\(507\) 555-0000/.test(emailText), 'phone in sign-off');
  assert.ok(await page.locator('button[data-act="approveAll"]:has-text("(1 email)")').count(), 'Approve All counts 1 email');
  await shot('03-queue-thanks.png');

  // 5. Copy Text logs an sms touch and applies the sent event.
  await page.click('button[data-act="copyText"]');
  await page.waitForSelector('.card.done');
  assert.ok(await page.locator('.card.done .chip.black:has-text("sent text")').count(), 'card shows sent text');
  const state = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kit.db'));
    const c = Object.values(d.customers)[0];
    const t = Object.values(d.touches)[0];
    return { nextTouchN: c.nextTouchN, firstTextSentAt: c.firstTextSentAt, used: c.usedTemplateIds, touch: t && { status: t.status, channels: t.channels, touchN: t.touchN, slot: t.slot } };
  });
  assert.strictEqual(state.nextTouchN, 1, 'nextTouchN advanced to 1');
  assert.ok(state.firstTextSentAt, 'firstTextSentAt stamped');
  assert.deepStrictEqual(state.touch, { status: 'sent', channels: ['sms'], touchN: 0, slot: 'THANKS' });
  assert.strictEqual(state.used.length, 1, 'usedTemplateIds recorded');

  // 6. Referrals, Templates, Settings.
  await page.click('nav.tabs button[data-tab="referrals"]');
  await page.waitForSelector('text=Last 12 months');
  await shot('05-referrals.png');

  await page.click('nav.tabs button[data-tab="templates"]');
  await page.waitForSelector('h3[data-slot="THANKS"]');
  await page.click('h3[data-slot="THANKS"]');
  await page.waitForSelector('#tpl-thanks-01');
  await page.selectOption('select[data-on-change="previewCustomer"]', { index: 1 });
  await page.waitForSelector('table');
  await shot('06-templates.png');

  await page.click('nav.tabs button[data-tab="settings"]');
  await page.waitForSelector('form[data-form="settings"]');
  assert.ok(await page.locator('text=Texts are never automated').count(), 'TCPA note present');
  assert.ok(await page.locator('text=Physical address (Mosaic Autos lot, required in every email footer)').count(), 'address label');
  await shot('07-settings.png');

  // 7. Public unsubscribe page.
  await page.goto(BASE + '/?u=abcdefghijklmnopqrstuvwxyz', { waitUntil: 'load' });
  await page.waitForSelector('text=You\'re off the list.');
  assert.strictEqual(await page.locator('nav.tabs').count(), 0, 'no tab bar on the unsubscribe page');
  await shot('08-unsubscribe.png');

  await browser.close();
  if (problems.length) {
    console.log('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`SMOKE OK — ${shots} screenshots in ${OUT}, no console or page errors`);
})().catch((e) => { console.error('SMOKE FAILED: ' + (e && e.stack || e)); process.exit(1); });

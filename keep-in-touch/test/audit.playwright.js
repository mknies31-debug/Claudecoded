#!/usr/bin/env node
// audit.playwright.js — Agent 6 browser checks at 375x812 (in addition to
// test/smoke.playwright.js):
//   1. no console errors / page errors on load and on every tab
//   2. no horizontal scroll on any screen, including a queue card with a long
//      name and a "2019 Chevrolet Silverado 2500HD High Country"
//   3. tap flow: add customer (sale = today-3) -> THANKS card -> Send as Text
//      href is sms: and body ends "Reply STOP to opt out." -> Copy Text logs a
//      touch -> log reply "STOP" -> do-not-contact, queue no longer drafts ->
//      Reactivate works
//   4. /?u=<32 chars> unsubscribe page renders without login
//
//   python3 -m http.server 8787 --directory keep-in-touch &
//   NODE_PATH=/opt/node22/lib/node_modules node test/audit.playwright.js
'use strict';

const fs = require('fs');
const assert = require('assert');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = require('playwright');

const BASE = process.env.KIT_URL || 'http://localhost:8787';
const W = 375;

function chicagoToday(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const o = {}; parts.forEach((p) => { o[p.type] = p.value; });
  return `${o.year}-${o.month}-${o.day}`;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push('console.error: ' + msg.text()); });
  page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  let checks = 0;
  async function noHScroll(label) {
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const w = document.documentElement.scrollWidth;
      // the widest element, for the report
      let worst = null;
      document.querySelectorAll('body *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > window.innerWidth + 0.5 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), tag: el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') }; });
      return { w, worst };
    });
    assert.ok(m.w <= W, `${label}: horizontal scroll (scrollWidth ${m.w} > ${W}; widest ${JSON.stringify(m.worst)})`);
    checks++;
    console.log(`ok    ${label}: scrollWidth ${m.w}`);
  }
  async function addCustomer(o) {
    await page.click('nav.tabs button[data-tab="add"]');
    await page.waitForSelector('form[data-form="customer"]');
    await page.fill('input[name="name"]', o.name);
    await page.fill('input[name="phone"]', o.phone);
    await page.fill('input[name="email"]', o.email);
    await page.fill('input[name="year"]', o.year);
    await page.fill('input[name="make"]', o.make);
    await page.fill('input[name="model"]', o.model);
    if (o.trim) await page.fill('input[name="trim"]', o.trim);
    await page.fill('input[name="saleDate"]', o.saleDate);
    if (o.hook) await page.fill('input[name="hook"]', o.hook);
    await page.check('input[name="emailGiven"]');
    await page.check('input[name="smsGiven"]');
    await page.click('form[data-form="customer"] button[type="submit"]');
    await page.waitForSelector('text=Timeline');
  }

  // 1 + 2: load, every tab, no errors, no horizontal scroll.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('nav.tabs button');
  await noHScroll('queue (empty)');
  await page.click('nav.tabs button[data-tab="settings"]');
  await page.waitForSelector('form[data-form="settings"]');
  await page.fill('form[data-form="settings"] input[name="mickPhone"]', '5075550000');
  await page.click('form[data-form="settings"] button[type="submit"]');
  await page.waitForTimeout(100);
  await noHScroll('settings');
  for (const tab of ['add', 'people', 'referrals', 'templates', 'queue']) {
    await page.click(`nav.tabs button[data-tab="${tab}"]`);
    await page.waitForTimeout(150);
    await noHScroll('tab ' + tab);
  }

  // Long name + long vehicle on a queue card.
  await addCustomer({ name: 'Bartholomew Vandenbergh-Kristiansen III', phone: '5075559876', email: 'bart@example.com', year: '2019', make: 'Chevrolet', model: 'Silverado 2500HD', trim: 'High Country', saleDate: chicagoToday(-3), hook: 'the washboard on County Road 7 past the Zumbro crossing' });
  await noHScroll('timeline (long name + Silverado 2500HD High Country)');
  await page.click('nav.tabs button[data-tab="queue"]');
  await page.waitForSelector('.card[data-key]');
  await noHScroll('queue card (long name + Silverado 2500HD High Country)');
  await page.click('.card[data-key] details summary'); // open the footer
  await noHScroll('queue card with footer open');
  const label = await page.locator('.card[data-key] .muted').first().textContent();
  assert.ok(/2019 Silverado 2500HD/.test(label), 'vehicle label on the card: ' + label);
  // Templates tab with a long template open and the preview table
  await page.click('nav.tabs button[data-tab="templates"]');
  await page.waitForSelector('h3[data-slot="VALUE"]');
  await page.click('h3[data-slot="VALUE"]');
  await page.waitForTimeout(150);
  await page.selectOption('select[data-on-change="previewCustomer"]', { index: 1 });
  await page.waitForSelector('table');
  await noHScroll('templates (VALUE open + preview table)');
  await page.click('nav.tabs button[data-tab="people"]');
  await page.waitForTimeout(150);
  await noHScroll('customers list');
  await page.click('nav.tabs button[data-tab="referrals"]');
  await page.waitForSelector('text=Last 12 months');
  await noHScroll('referrals with data');

  // 3: tap flow with a second customer.
  await addCustomer({ name: 'Dan Halvorson', phone: '5075551234', email: 'Dan@Example.com', year: '2019', make: 'Chevrolet', model: 'Silverado', saleDate: chicagoToday(-3), hook: 'the gravel road out by Goodhue' });
  await page.click('nav.tabs button[data-tab="queue"]');
  await page.waitForSelector('.card[data-key]');
  const card = page.locator('.card[data-key]', { hasText: 'Dan Halvorson' });
  assert.strictEqual(await card.count(), 1, 'Dan has one THANKS card');
  assert.ok(await card.locator('.chip.mag:has-text("Thanks")').count(), 'THANKS chip');
  const href = await card.locator('a[data-act="sendSms"]').getAttribute('href');
  assert.ok(href && href.startsWith('sms:+15075551234?&body='), 'Send as Text href is sms: ' + href);
  const body = decodeURIComponent(href.split('body=')[1]);
  assert.ok(/^Dan, /.test(body) || /Dan/.test(body), 'text addresses Dan');
  assert.ok(/2019 Silverado/.test(body), 'text names the vehicle');
  assert.ok(body.endsWith('Reply STOP to opt out.'), 'first text ends with the STOP line: ' + body.slice(-40));
  assert.strictEqual((body.match(/\?/g) || []).length, 1, 'one question in the text');
  assert.ok(!/!/.test(body), 'no exclamation point');
  const emailDraft = await card.locator('textarea[data-field="email"]').inputValue();
  assert.ok(/\n\nMick\nNorth Star Car Guy\n\(507\) 555-0000$/.test(emailDraft), 'email draft ends with the sign-off block');
  const footer = await card.locator('details .pre').textContent();
  assert.ok(/North Star Car Guy at Mosaic Autos · /.test(footer) && /\/\?u=/.test(footer), 'footer shown under the draft with the unsubscribe link');
  console.log('ok    THANKS card: sms: href, STOP line, sign-off, footer');
  checks++;

  await card.locator('button[data-act="copyText"]').click();
  await page.waitForSelector('.card.done');
  const afterCopy = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kit.db'));
    const c = Object.values(d.customers).find((x) => x.name === 'Dan Halvorson');
    const t = Object.values(d.touches).find((x) => x.customerId === c.id);
    return { nextTouchN: c.nextTouchN, firstTextSentAt: c.firstTextSentAt, touch: t && { status: t.status, channels: t.channels, touchN: t.touchN, slot: t.slot, textEnds: t.textBody.slice(-22) } };
  });
  assert.deepStrictEqual(afterCopy.touch, { status: 'sent', channels: ['sms'], touchN: 0, slot: 'THANKS', textEnds: 'Reply STOP to opt out.' });
  assert.strictEqual(afterCopy.nextTouchN, 1);
  assert.ok(afterCopy.firstTextSentAt);
  console.log('ok    Copy Text logged a touch (channels [sms], touch 0, THANKS) and advanced the cadence');
  checks++;

  // Log a reply "STOP" on the timeline.
  await page.click('.card.done .title[data-act="open"]');
  await page.waitForSelector('text=Timeline');
  await page.click('button[data-act="toggleReply"]');
  await page.waitForSelector('form[data-form="reply"]');
  await page.fill('form[data-form="reply"] textarea[name="text"]', 'STOP');
  await page.selectOption('form[data-form="reply"] select[name="channel"]', 'sms');
  dialogs.length = 0;
  await page.click('form[data-form="reply"] button[type="submit"]');
  await page.waitForSelector('button[data-act="reactivate"]');
  assert.ok(dialogs.some((d) => /reads like an opt-out/.test(d)), 'opt-out confirm shown: ' + dialogs.join(' | '));
  const dnc = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('kit.db'));
    const c = Object.values(d.customers).find((x) => x.name === 'Dan Halvorson');
    const r = Object.values(d.replies).find((x) => x.customerId === c.id);
    return { status: c.status, dnc: c.dnc, reply: r && { snippet: r.snippet, isOptOut: r.isOptOut, channel: r.channel, touchLinked: !!r.touchId } };
  });
  assert.strictEqual(dnc.status, 'dnc');
  assert.strictEqual(dnc.dnc.reason, 'STOP reply');
  assert.strictEqual(dnc.dnc.channel, 'sms');
  assert.deepStrictEqual(dnc.reply, { snippet: 'STOP', isOptOut: true, channel: 'sms', touchLinked: true });
  assert.ok(await page.locator('text=Do not contact (STOP reply').count(), 'consent summary shows do-not-contact');
  assert.ok(await page.locator('summary:has-text("Goodbye note")').count(), 'goodbye note drafted on the timeline');
  const goodbye = await page.locator('details:has(summary:has-text("Goodbye note")) .pre').textContent();
  assert.ok(!/\?/.test(goodbye.split('\n\nMick')[0]), 'goodbye body has no question');
  await noHScroll('timeline (do-not-contact)');
  console.log('ok    reply "STOP" -> do-not-contact on both channels, reply logged, goodbye drafted');
  checks++;

  // Queue no longer drafts for Dan; even "send next note now" cannot force it.
  await page.click('nav.tabs button[data-tab="queue"]');
  await page.waitForTimeout(150);
  assert.strictEqual(await page.locator('.card[data-key]:not(.done)', { hasText: 'Dan Halvorson' }).count(), 0, 'no live queue card for a do-not-contact customer');
  const badge = await page.locator('nav.tabs button[data-tab="queue"] .badge').textContent().catch(() => '0');
  assert.strictEqual(String(badge).trim(), '1', 'queue badge counts only Bartholomew (got ' + badge + ')');
  console.log('ok    queue excludes the do-not-contact customer');
  checks++;

  // Reactivate.
  await page.click('nav.tabs button[data-tab="people"]');
  await page.click('[data-act="open"]:has-text("Dan Halvorson")');
  await page.waitForSelector('button[data-act="reactivate"]');
  await page.click('button[data-act="reactivate"]');
  await page.waitForSelector('button[data-act="dnc"]');
  const re = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('kit.db')); const c = Object.values(d.customers).find((x) => x.name === 'Dan Halvorson'); return { status: c.status, dnc: c.dnc, nextTouchN: c.nextTouchN }; });
  assert.deepStrictEqual(re, { status: 'active', dnc: null, nextTouchN: 1 });
  assert.ok(await page.locator('text=Email: yes (in person at sale').count(), 'consent intact after reactivation');
  console.log('ok    Reactivate restores active status (consent untouched, cadence position kept)');
  checks++;

  // 4: unsubscribe page, no login, with a 32-char token.
  const token = 'Ab3dE5fG7hI9jK1lM3nO5pQ7rS9tUvWx';
  assert.strictEqual(token.length, 32);
  await context.clearCookies();
  const fresh = await browser.newContext({ viewport: { width: W, height: 812 }, isMobile: true, hasTouch: true }); // no localStorage at all, like a customer's phone
  const p2 = await fresh.newPage();
  p2.on('console', (msg) => { if (msg.type() === 'error') problems.push('unsubscribe console.error: ' + msg.text()); });
  p2.on('pageerror', (err) => problems.push('unsubscribe pageerror: ' + err.message));
  await p2.goto(BASE + '/?u=' + token, { waitUntil: 'load' });
  await p2.waitForSelector("text=You're off the list.");
  assert.strictEqual(await p2.locator('nav.tabs').count(), 0, 'no app chrome');
  assert.strictEqual(await p2.locator('input[type="password"]').count(), 0, 'no login prompt');
  const text = await p2.locator('body').innerText();
  assert.ok(!/\?/.test(text.replace(/\/\?u=/g, '')), 'goodbye page asks no question');
  assert.ok(!/!/.test(text), 'no exclamation point');
  const w2 = await p2.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w2 <= W, 'unsubscribe page scrollWidth ' + w2);
  console.log('ok    /?u=<32 chars> renders without login (scrollWidth ' + w2 + ')');
  checks++;
  await fresh.close();

  await browser.close();
  if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(`AUDIT BROWSER OK — ${checks} checks, no console or page errors`);
})().catch((e) => { console.error('AUDIT BROWSER FAILED: ' + (e && e.stack || e)); process.exit(1); });

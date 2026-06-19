// crm/crm.js — ROBUST VIEWS: the Referral CRM, mounted into the CARVIS shell.
//
// ES module. Imports the shared CLEAN API so the UI obeys the exact same rules
// as the cron. State lives in localStorage under carvis_referral_* and rides the
// existing CARVIS sync (snapshotStore picks the keys up automatically). The cron
// writes the same blob, so what the engine does shows up here on next pull.

import { KEYS, newCustomer, validateCustomer, digits } from '../shared/schema.mjs';
import { currentSequence, isComplete, isStagnant, daysSincePurchase, sequenceByKey } from '../shared/sequences.mjs';
import { hydrate } from '../shared/hydrate.mjs';
import { getText, VARIANTS, VARIANT_LABELS, APPROVED } from '../shared/templates.mjs';
import { isFrozen } from '../shared/compliance.mjs';

// ── tiny local helpers (no dependency on CARVIS lexical scope) ───────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (m) => { try { window.toast ? window.toast(m) : 0; } catch (e) { /* noop */ } };
const blip = (...a) => { try { window.blip && window.blip(...a); } catch (e) { /* noop */ } };
const pushCloud = () => { try { window.scheduleCloudPush && window.scheduleCloudPush(); } catch (e) { /* noop */ } };
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── store access ─────────────────────────────────────────────────────────────
function loadArr(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function loadObj(key) { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
const getCustomers = () => loadArr(KEYS.customers);
const getLogs = () => loadArr(KEYS.touchLogs);
function saveCustomers(list) { localStorage.setItem(KEYS.customers, JSON.stringify(list)); pushCloud(); }
function saveLogs(list) { localStorage.setItem(KEYS.touchLogs, JSON.stringify(list)); pushCloud(); }

// per-card chosen variant, keyed `${id}:${seqKey}`
const variantChoice = new Map();
let activeTab = 'dashboard';

// ── overlay scaffold (built once, appended to body) ──────────────────────────
function buildOverlay() {
  if (document.getElementById('crmOverlay')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'crmOverlay';
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="mh">
        <div class="av">⇄</div>
        <div><div class="mt">REFERRAL CRM</div><div class="ms">Timed follow-ups · one-tap texts · referral loop</div></div>
        <button class="x" id="crmClose">✕</button>
      </div>
      <div class="mb">
        ${APPROVED ? '' : '<div class="crm-banner" id="crmBanner">⏸ Auto-emails are <b>held</b> until your copy is approved. Texts still work — fire them by hand below. (Set APPROVED in shared/templates.mjs once your wording is in.)</div>'}
        <div class="crm-tabs">
          <button class="crm-tab on" data-tab="dashboard">◉ Daily Ops</button>
          <button class="crm-tab" data-tab="add">＋ Add Customer</button>
          <button class="crm-tab" data-tab="pipeline">≣ Pipeline</button>
        </div>
        <div class="crm-pane on" id="crmPaneDashboard"></div>
        <div class="crm-pane" id="crmPaneAdd"></div>
        <div class="crm-pane" id="crmPanePipeline"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // event wiring (delegated)
  ov.addEventListener('click', onOverlayClick);
  ov.addEventListener('change', onOverlayChange);
  ov.addEventListener('submit', onOverlaySubmit);
  document.getElementById('crmClose').addEventListener('click', closeReferrals);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeReferrals(); });
}

// ── rendering ────────────────────────────────────────────────────────────────
function render() {
  document.querySelectorAll('#crmOverlay .crm-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === activeTab));
  document.getElementById('crmPaneDashboard').classList.toggle('on', activeTab === 'dashboard');
  document.getElementById('crmPaneAdd').classList.toggle('on', activeTab === 'add');
  document.getElementById('crmPanePipeline').classList.toggle('on', activeTab === 'pipeline');
  if (activeTab === 'dashboard') renderDashboard();
  else if (activeTab === 'add') renderAdd();
  else renderPipeline();
}

function renderDashboard() {
  const customers = getCustomers();
  const logs = getLogs();
  const today = todayStr();
  const sentToday = logs.filter((l) => l.channel === 'email' && l.status === 'sent' && String(l.sentAt).slice(0, 10) === today);
  const heldToday = logs.filter((l) => l.channel === 'email' && l.status === 'held' && String(l.sentAt).slice(0, 10) === today);
  const textsSentToday = logs.filter((l) => l.channel === 'text' && l.status === 'sent' && String(l.sentAt).slice(0, 10) === today);

  document.getElementById('crmPaneDashboard').innerHTML = `
    <div class="crm-readouts">
      <div class="crm-ro"><div class="v">${sentToday.length}</div><div class="l">Emails Sent Today</div></div>
      <div class="crm-ro"><div class="v">${heldToday.length}</div><div class="l">Held (need copy)</div></div>
      <div class="crm-ro"><div class="v">${textsSentToday.length}</div><div class="l">Texts Sent Today</div></div>
    </div>
    ${sectionReferral(customers)}
    ${sectionTexts(customers)}
    ${sectionStagnant(customers, today)}
    ${sectionSentList(sentToday, customers)}
  `;
}

// Referral loop-close monitor — referredById points at a customer on file.
function sectionReferral(customers) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const open = customers.filter((c) => c.referredById && byId.has(c.referredById) && !c.referrerThanked && !isFrozen(c));
  const body = open.length ? open.map((c) => {
    const ref = byId.get(c.referredById);
    return `<div class="crm-card warn" data-id="${esc(c.id)}">
      <div class="crm-row between">
        <div><div class="cname">⚑ Thank ${esc(ref.firstName)} ${esc(ref.lastName || '')}</div>
        <div class="cmeta">${esc(ref.firstName)} referred ${esc(c.firstName)} (${esc(c.vehicle)}) — send a personal thank-you. Not automated on purpose.</div></div>
      </div>
      <div class="crm-row" style="margin-top:10px">
        ${ref.phone ? `<a class="crm-btn send sm" href="sms:${esc(digits(ref.phone))}?body=${encodeURIComponent(thankYouText(ref, c))}">✎ Text ${esc(ref.firstName)}</a>` : ''}
        <button class="crm-btn sm" data-act="copy" data-text="${esc(thankYouText(ref, c))}">⎘ Copy</button>
        <button class="crm-btn gold sm" data-act="thanked" data-id="${esc(c.id)}">✓ Marked thanked</button>
      </div>
    </div>`;
  }).join('') : '<div class="crm-empty">No open referral thank-yous. When you log a customer as referred by someone on file, it shows here.</div>';
  return section('⚑ Referral Loop — Close It', open.length, body);
}

function thankYouText(referrer, referred) {
  return `Hey ${referrer.firstName}, it's Mick. Just heard ${referred.firstName} came to me because of you. Means a lot, thank you for that.`;
}

// Texts Ready to Send — pendingTexts queue with variant dropdown + one-tap sms.
function sectionTexts(customers) {
  const cards = [];
  customers.forEach((c) => {
    if (isFrozen(c) || !Array.isArray(c.pendingTexts)) return;
    c.pendingTexts.forEach((pt) => {
      const seq = sequenceByKey(pt.sequenceKey);
      if (!seq) return;
      const ckey = `${c.id}:${pt.sequenceKey}`;
      const variant = variantChoice.get(ckey) || 'direct';
      const msg = hydrate(getText(pt.sequenceKey, variant), c);
      const smsHref = c.phone ? `sms:${digits(c.phone)}?body=${encodeURIComponent(msg)}` : '';
      cards.push(`<div class="crm-card" data-id="${esc(c.id)}" data-seq="${esc(pt.sequenceKey)}">
        <div class="crm-row between">
          <div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${esc(c.vehicle)} · ${esc(seq.label)}${c.phone ? '' : ' · no phone on file'}</div></div>
          <select class="crm-select" data-act="variant" data-key="${esc(ckey)}">
            ${VARIANTS.map((v) => `<option value="${v}" ${v === variant ? 'selected' : ''}>${VARIANT_LABELS[v]}</option>`).join('')}
          </select>
        </div>
        <div class="cbody">${esc(msg)}</div>
        <div class="crm-row">
          ${smsHref ? `<a class="crm-btn send sm" href="${smsHref}" data-act="opensms" data-id="${esc(c.id)}" data-seq="${esc(pt.sequenceKey)}" data-variant="${variant}">✆ One-tap text</a>` : '<span class="pill opt">add a phone to text</span>'}
          <button class="crm-btn sm" data-act="copy" data-text="${esc(msg)}">⎘ Copy text</button>
          <button class="crm-btn gold sm" data-act="marktext" data-id="${esc(c.id)}" data-seq="${esc(pt.sequenceKey)}" data-variant="${variant}">✓ Mark sent</button>
        </div>
      </div>`);
    });
  });
  const body = cards.length ? cards.join('') : '<div class="crm-empty">No texts queued. The daily run drops compliant text drafts here as customers hit their windows.</div>';
  return section('✆ Texts Ready to Send', cards.length, body);
}

function sectionStagnant(customers, today) {
  const stale = customers.filter((c) => isStagnant(c, today));
  const body = stale.length ? stale.map((c) => `<div class="crm-card alert" data-id="${esc(c.id)}">
      <div class="crm-row between">
        <div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
        <div class="cmeta">${esc(c.vehicle)} · stuck at ${esc(currentSequence(c).label)} · ${daysSincePurchase(c, today)} days since purchase</div></div>
        <span class="pill">stagnant 7+ days</span>
      </div>
    </div>`).join('') : '<div class="crm-empty">Nothing stagnant. Every active customer has moved within the last 7 days.</div>';
  return section('⏱ Stagnant 7+ Days', stale.length, body);
}

function sectionSentList(sentToday, customers) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const body = sentToday.length ? sentToday.map((l) => {
    const c = byId.get(l.customerId);
    return `<div class="crm-card"><div class="cname">${esc(c ? c.firstName : 'Customer')} — ${esc((sequenceByKey(l.sequenceKey) || {}).label || l.sequenceKey)}</div>
      <div class="cmeta">${esc(l.subject)} · ${new Date(l.sentAt).toLocaleTimeString()}</div></div>`;
  }).join('') : '<div class="crm-empty">No automated emails cleared yet today.</div>';
  return section('✉ Emails Cleared Today', sentToday.length, body);
}

function renderAdd() {
  const customers = getCustomers();
  document.getElementById('crmPaneAdd').innerHTML = `
    <form id="crmAddForm" autocomplete="off">
      <div class="crm-form-grid">
        <div><span class="olabel">First name *</span><input class="rin" name="firstName" placeholder="Dale"></div>
        <div><span class="olabel">Last name</span><input class="rin" name="lastName" placeholder="Carlson"></div>
        <div class="full"><span class="olabel">Vehicle *</span><input class="rin" name="vehicle" placeholder="2019 F-150"></div>
        <div><span class="olabel">Phone</span><input class="rin" name="phone" inputmode="tel" placeholder="507-555-0101"></div>
        <div><span class="olabel">Email</span><input class="rin" name="email" inputmode="email" placeholder="dale@email.com"></div>
        <div><span class="olabel">Purchase date *</span><input class="rin" type="date" name="purchaseDate" value="${todayStr()}"></div>
        <div><span class="olabel">Referred by</span>
          <select class="rin" name="referredById">
            <option value="">— nobody / walk-in —</option>
            ${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.firstName)} ${esc(c.lastName || '')} (${esc(c.vehicle)})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="crm-err" id="crmAddErr"></div>
      <button class="rgen" type="submit">◉ ADD CUSTOMER</button>
      <div class="mnote"><span>✦</span><span>Phone or email is enough to start follow-ups. Everything saves locally and rides your existing Data Sync — no separate database.</span></div>
    </form>`;
}

function renderPipeline() {
  const customers = getCustomers().slice().sort((a, b) => (a.stage - b.stage) || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const today = todayStr();
  let body;
  if (!customers.length) {
    body = '<div class="crm-empty">No customers yet. Add one from the ＋ tab — it takes about 20 seconds.</div>';
  } else {
    body = customers.map((c) => {
      const frozen = isFrozen(c);
      const done = isComplete(c);
      const stage = done ? 'Complete' : currentSequence(c).label;
      const stale = isStagnant(c, today);
      return `<div class="crm-card ${stale ? 'alert' : ''}" data-id="${esc(c.id)}">
        <div class="crm-row between">
          <div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${esc(c.vehicle)} · ${daysSincePurchase(c, today)} days · ${esc(c.email || c.phone || 'no contact')}</div></div>
          <div class="crm-row">
            ${frozen ? '<span class="pill opt">OPTED OUT</span>' : done ? '<span class="pill done">complete</span>' : `<span class="pill stage">${esc(stage)}</span>`}
            ${stale ? '<span class="pill">stagnant</span>' : ''}
          </div>
        </div>
        <div class="crm-row" style="margin-top:10px">
          <button class="crm-btn ${frozen ? 'gold' : 'ghost-red'} sm" data-act="optout" data-id="${esc(c.id)}">${frozen ? '↺ Re-enable follow-ups' : '⓪ Opt out (stop all)'}</button>
          <button class="crm-btn sm" data-act="del" data-id="${esc(c.id)}">✕ Remove</button>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('crmPanePipeline').innerHTML = section('≣ All Customers', customers.length, body);
}

function section(title, count, body) {
  return `<div class="crm-sec"><h4><span class="hbar"></span>${esc(title)}<span class="ct">${count}</span></h4>${body}</div>`;
}

// ── events ───────────────────────────────────────────────────────────────────
function onOverlayClick(e) {
  const tab = e.target.closest('.crm-tab');
  if (tab) { activeTab = tab.dataset.tab; render(); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;

  if (a === 'copy') { copyText(act.dataset.text); return; }
  if (a === 'opensms') { logTextSent(act.dataset.id, act.dataset.seq, act.dataset.variant); setTimeout(render, 50); /* anchor still navigates to sms: */ return; }
  if (a === 'marktext') { e.preventDefault(); logTextSent(act.dataset.id, act.dataset.seq, act.dataset.variant); render(); return; }
  if (a === 'thanked') { markThanked(act.dataset.id); render(); return; }
  if (a === 'optout') { toggleOptOut(act.dataset.id); render(); return; }
  if (a === 'del') { removeCustomer(act.dataset.id); render(); return; }
}

function onOverlayChange(e) {
  const sel = e.target.closest('[data-act="variant"]');
  if (sel) { variantChoice.set(sel.dataset.key, sel.value); renderDashboard(); }
}

function onOverlaySubmit(e) {
  if (e.target.id !== 'crmAddForm') return;
  e.preventDefault();
  const f = e.target;
  const fd = new FormData(f);
  const g = (n) => (fd.get(n) || '').toString();
  const input = {
    firstName: g('firstName'), lastName: g('lastName'), vehicle: g('vehicle'),
    phone: g('phone'), email: g('email'), purchaseDate: g('purchaseDate'),
    referredById: g('referredById') || null,
  };
  const v = validateCustomer(input);
  if (!v.ok) { document.getElementById('crmAddErr').textContent = Object.values(v.errors)[0]; blip(360, 0.06, 'sawtooth', 0.1); return; }
  const list = getCustomers();
  list.push(newCustomer(input));
  saveCustomers(list);
  blip(900, 0.06, 'sine', 0.12); toast('Customer added');
  activeTab = 'dashboard'; render();
}

// ── mutations ────────────────────────────────────────────────────────────────
function logTextSent(id, seqKey, variant) {
  const list = getCustomers();
  const c = list.find((x) => x.id === id);
  if (!c) return;
  c.pendingTexts = (c.pendingTexts || []).filter((p) => p.sequenceKey !== seqKey);
  c.updatedAt = new Date().toISOString();
  saveCustomers(list);
  const logs = getLogs();
  const seq = sequenceByKey(seqKey);
  logs.push({ id: 'log_' + Date.now().toString(36), customerId: id, channel: 'text', sequenceKey: seqKey, variant, subject: '', body: hydrate(getText(seqKey, variant), c), status: 'sent', sentAt: new Date().toISOString() });
  saveLogs(logs);
  toast('Text logged as sent');
}

function markThanked(id) {
  const list = getCustomers();
  const c = list.find((x) => x.id === id);
  if (!c) return;
  c.referrerThanked = true; c.updatedAt = new Date().toISOString();
  saveCustomers(list); toast('Referral thank-you closed');
}

function toggleOptOut(id) {
  const list = getCustomers();
  const c = list.find((x) => x.id === id);
  if (!c) return;
  c.optedOut = !c.optedOut; c.updatedAt = new Date().toISOString();
  saveCustomers(list);
  toast(c.optedOut ? 'Opted out — all follow-ups frozen' : 'Follow-ups re-enabled');
}

function removeCustomer(id) {
  const c = getCustomers().find((x) => x.id === id);
  if (!c) return;
  if (!window.confirm(`Remove ${c.firstName} ${c.lastName || ''} and stop tracking them?`)) return;
  saveCustomers(getCustomers().filter((x) => x.id !== id));
  toast('Customer removed');
}

function copyText(text) {
  const t = String(text || '');
  const done = () => { toast('Copied to clipboard'); blip(820, 0.05, 'sine', 0.1); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
  } else { fallbackCopy(t, done); }
}
function fallbackCopy(t, done) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select and copy manually'); }
  ta.remove();
}

// ── open / close + lifecycle ─────────────────────────────────────────────────
function openReferrals() { buildOverlay(); render(); document.getElementById('crmOverlay').classList.add('show'); blip(760, 0.06, 'sine', 0.12); }
function closeReferrals() { const o = document.getElementById('crmOverlay'); if (o) o.classList.remove('show'); }

function isOpen() { const o = document.getElementById('crmOverlay'); return o && o.classList.contains('show'); }

// Re-render when a cloud pull replaces the snapshot (so the cron's work shows up
// live if the panel is open). We wrap CARVIS's global applyStore once.
function hookSync() {
  const orig = window.applyStore;
  if (typeof orig === 'function' && !orig.__crmWrapped) {
    const wrapped = function () { const r = orig.apply(this, arguments); try { document.dispatchEvent(new Event('carvis:storeupdated')); } catch (e) { /* noop */ } return r; };
    wrapped.__crmWrapped = true;
    window.applyStore = wrapped;
  }
  document.addEventListener('carvis:storeupdated', () => { if (isOpen()) render(); });
}

function init() {
  buildOverlay();
  hookSync();
  // Wire the topbar button (added in index.html). Esc closes, matching CARVIS.
  const btn = document.getElementById('crmBtn');
  if (btn) btn.addEventListener('click', openReferrals);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReferrals(); });
  window.openReferrals = openReferrals; // let CARVIS command bar reach it later
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

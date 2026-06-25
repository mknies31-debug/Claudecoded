// crm/crm.js — ROBUST VIEWS: the Referral CRM, mounted into the CARVIS shell.
//
// ES module. Imports the shared CLEAN API so the UI obeys the exact same rules
// as the cron. State lives in localStorage under carvis_referral_* and rides the
// existing CARVIS sync (snapshotStore picks the keys up automatically). The cron
// writes the same blob, so what the engine does shows up here on next pull.

import { KEYS, newCustomer, validateCustomer, digits } from '../shared/schema.mjs';
import { currentSequence, isStagnant, daysSincePurchase, sequenceByKey, localDateStr } from '../shared/sequences.mjs';
import { hydrate } from '../shared/hydrate.mjs';
import { getText, VARIANTS, VARIANT_LABELS, APPROVED } from '../shared/templates.mjs';
import { isFrozen } from '../shared/compliance.mjs';
import { INTAKE_STEPS, isSkip, applyAnswer, EXTRACTION_PROMPT, parseExtraction } from '../shared/intake.mjs';
import { planImport, IMPORT_COLUMNS } from '../shared/import.mjs';

// ── tiny local helpers (no dependency on CARVIS lexical scope) ───────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (m) => { try { window.toast ? window.toast(m) : 0; } catch (e) { /* noop */ } };
const blip = (...a) => { try { window.blip && window.blip(...a); } catch (e) { /* noop */ } };
const pushCloud = () => { try { window.scheduleCloudPush && window.scheduleCloudPush(); } catch (e) { /* noop */ } };
const todayStr = () => localDateStr(); // Central-time calendar date, not UTC
const MOSAIC_SITE = 'https://mosaicautos.com';

// ── store access ─────────────────────────────────────────────────────────────
function loadArr(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
const getCustomers = () => loadArr(KEYS.customers);
const getLogs = () => loadArr(KEYS.touchLogs);
function saveCustomers(list) { localStorage.setItem(KEYS.customers, JSON.stringify(list)); pushCloud(); }
function saveLogs(list) { localStorage.setItem(KEYS.touchLogs, JSON.stringify(list)); pushCloud(); }

// per-card chosen variant, keyed `${id}:${seqKey}`
const variantChoice = new Map();
let activeTab = 'dashboard';
let editingId = null; // when set, the Add pane is editing an existing customer
let importPlan = null; // when set, the Add pane shows the CSV import review

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
    ${sectionTasks(customers)}
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
        <div class="cmeta">${esc(ref.firstName)} referred ${esc(c.firstName)}${c.vehicle ? ' (' + esc(c.vehicle) + ')' : ''} — send a personal thank-you. Not automated on purpose.</div></div>
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
          <div class="crm-idrow">${avatarHTML(c)}<div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${[c.vehicle, seq.label].filter(Boolean).map(esc).join(' · ')}${c.phone ? '' : ' · no phone on file'}</div></div></div>
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

// To-Dos — recurring call / video / gift reminders (the app can't do these for
// you; it hands you the task + a script and you mark it done).
const TASK_ICON = { call: '✆', video: '🎥', gift: '🎁' };
function sectionTasks(customers) {
  const cards = [];
  customers.forEach((c) => {
    if (isFrozen(c) || !Array.isArray(c.pendingTasks)) return;
    c.pendingTasks.forEach((tk) => {
      const icon = TASK_ICON[tk.type] || '◷';
      const callHref = tk.type === 'call' && c.phone ? `tel:${digits(c.phone)}` : '';
      cards.push(`<div class="crm-card" data-id="${esc(c.id)}">
        <div class="crm-row between">
          <div class="crm-idrow">${avatarHTML(c)}<div><div class="cname">${icon} ${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${[c.vehicle, tk.label || tk.type].filter(Boolean).map(esc).join(' · ')}</div></div></div>
        </div>
        <div class="cbody">${esc(tk.script || '')}</div>
        <div class="crm-row">
          ${callHref ? `<a class="crm-btn send sm" href="${callHref}">✆ Call now</a>` : ''}
          ${tk.script ? `<button class="crm-btn sm" data-act="copy" data-text="${esc(tk.script)}">⎘ Copy script</button>` : ''}
          <button class="crm-btn gold sm" data-act="marktask" data-id="${esc(c.id)}" data-seq="${esc(tk.sequenceKey)}">✓ Mark done</button>
        </div>
      </div>`);
    });
  });
  const body = cards.length ? cards.join('') : '<div class="crm-empty">No calls, videos, or gifts due. After the first year, the every-90-day touches land here.</div>';
  return section('◷ To-Do — Calls · Videos · Gifts', cards.length, body);
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

function renderAdd(prefill = {}) {
  if (importPlan) { renderImportPreview(); return; }
  const editing = !!editingId;
  const customers = getCustomers().filter((c) => c.id !== editingId); // can't refer yourself
  const v = (k) => esc(prefill[k] || '');
  const filled = Object.values(prefill).some((x) => x);
  const banner = editing
    ? '<div class="crm-banner" style="color:var(--cyan);border-color:var(--line-strong);background:rgba(92,240,255,.06)">✎ Editing this customer — their timeline, stage, and queued texts stay put. Change what you need and save.</div>'
    : (filled ? '<div class="crm-banner" style="color:var(--cyan);border-color:var(--line-strong);background:rgba(92,240,255,.06)">✓ Pulled this in for you — check it over, fix anything, then add. Name and phone are the only musts.</div>' : '');
  document.getElementById('crmPaneAdd').innerHTML = `
    ${editing ? '' : `<div class="crm-intake-launch">
      <button class="crm-btn gold" id="crmVoiceBtn" type="button">🎙 Voice intake</button>
      <button class="crm-btn" id="crmPhotoBtn" type="button">📷 From a photo</button>
      <button class="crm-btn" id="crmFileBtn" type="button">📄 From a file / PDF</button>
      <button class="crm-btn" id="crmImportBtn" type="button">⇪ Import list (CSV)</button>
      <input type="file" id="crmPhotoInput" accept="image/*" capture="environment" hidden>
      <input type="file" id="crmFileInput" accept="image/*,application/pdf,.pdf" hidden>
      <input type="file" id="crmImportInput" accept=".csv,text/csv,text/plain" hidden>
      <span class="crm-launch-or">or type it in</span>
    </div>`}
    ${banner}
    <form id="crmAddForm" autocomplete="off">
      <div class="crm-photo-row">
        <div class="crm-avatar lg" id="crmAvatarPrev">${prefill.photo ? `<img src="${esc(prefill.photo)}" alt="">` : esc(((prefill.firstName || '?')[0] + ((prefill.lastName || '')[0] || '')).toUpperCase() || '?')}</div>
        <div class="crm-photo-actions">
          <button class="crm-btn sm" id="crmAvatarBtn" type="button">📷 ${prefill.photo ? 'Change' : 'Add'} photo</button>
          <button class="crm-btn sm" id="crmAvatarClear" type="button" ${prefill.photo ? '' : 'style="display:none"'}>Remove</button>
          <input type="file" id="crmAvatarInput" accept="image/*" hidden>
          <input type="hidden" name="photo" id="crmPhotoField" value="${esc(prefill.photo || '')}">
          <div class="crm-photo-hint">Optional — a face makes the card easy to spot.</div>
        </div>
      </div>
      <div class="crm-form-grid">
        <div><span class="olabel">First name *</span><input class="rin" name="firstName" placeholder="Dale" value="${v('firstName')}"></div>
        <div><span class="olabel">Last name</span><input class="rin" name="lastName" placeholder="Carlson" value="${v('lastName')}"></div>
        <div><span class="olabel">Phone *</span><input class="rin" name="phone" inputmode="tel" placeholder="507-555-0101" value="${v('phone')}"></div>
        <div><span class="olabel">Email</span><input class="rin" name="email" inputmode="email" placeholder="dale@email.com" value="${v('email')}"></div>
        <div><span class="olabel">Vehicle</span><input class="rin" name="vehicle" placeholder="2019 F-150" value="${v('vehicle')}"></div>
        <div><span class="olabel">Stock #</span><input class="rin" name="stockNumber" placeholder="e.g. B4567" value="${v('stockNumber')}"></div>
        <div class="full"><span class="olabel">Address</span><input class="rin" name="address" placeholder="123 Main St, Zumbrota, MN" value="${v('address')}"></div>
        <div><span class="olabel">Purchase date</span><input class="rin" type="date" name="purchaseDate" value="${v('purchaseDate') || todayStr()}"></div>
        <div><span class="olabel">Referred by</span>
          <select class="rin" name="referredById">
            <option value="">— nobody / walk-in —</option>
            ${customers.map((c) => `<option value="${esc(c.id)}" ${prefill.referredById === c.id ? 'selected' : ''}>${esc(c.firstName)} ${esc(c.lastName || '')}${c.vehicle ? ' (' + esc(c.vehicle) + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="full"><span class="olabel">Other notes</span><textarea class="rin" name="notes" rows="2" placeholder="Trade, family, how they found you…">${v('notes')}</textarea></div>
      </div>
      <div class="crm-err" id="crmAddErr"></div>
      <div class="crm-row">
        <button class="rgen" type="submit" style="flex:1">◉ ${editing ? 'UPDATE CUSTOMER' : 'ADD CUSTOMER'}</button>
        ${editing ? '<button class="crm-btn sm" type="button" id="crmEditCancel">Cancel</button>' : ''}
      </div>
      <div class="mnote"><span>✦</span><span>Only <b>name</b> and <b>phone</b> are required — skip anything you don't have and fill it in later. Saves locally and rides your existing Data Sync.</span></div>
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
      const stage = currentSequence(c).label;
      const stale = isStagnant(c, today);
      const line1 = [c.vehicle || 'no vehicle on file', `${daysSincePurchase(c, today)} days`].join(' · ');
      const contact = [c.phone, c.email].filter(Boolean).join(' · ');
      const stockLine = c.stockNumber ? `<div class="cmeta">Stock <button class="crm-stock-link" type="button" data-act="stocksearch" data-stock="${esc(c.stockNumber)}" title="Copy stock # and open mosaicautos.com">${esc(c.stockNumber)} ⧉↗</button></div>` : '';
      return `<div class="crm-card ${stale ? 'alert' : ''}" data-id="${esc(c.id)}">
        <div class="crm-row between">
          <div class="crm-idrow">${avatarHTML(c, 'md')}<div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${esc(line1)}</div>
          ${stockLine}
          ${contact ? `<div class="cmeta">${esc(contact)}</div>` : ''}
          ${c.address ? `<div class="cmeta">${esc(c.address)}</div>` : ''}
          ${c.notes ? `<div class="cmeta">✎ ${esc(c.notes)}</div>` : ''}</div></div>
          <div class="crm-row">
            ${frozen ? '<span class="pill opt">OPTED OUT</span>' : `<span class="pill stage">${esc(stage)}</span>`}
            ${stale ? '<span class="pill">stagnant</span>' : ''}
          </div>
        </div>
        <div class="crm-row" style="margin-top:10px">
          <button class="crm-btn sm" data-act="edit" data-id="${esc(c.id)}">✎ Edit</button>
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
  if (tab) { editingId = null; importPlan = null; activeTab = tab.dataset.tab; render(); return; }
  if (e.target.closest('#crmVoiceBtn')) { startVoiceIntake(); return; }
  if (e.target.closest('#crmPhotoBtn')) { const inp = document.getElementById('crmPhotoInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmFileBtn')) { const inp = document.getElementById('crmFileInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmAvatarBtn')) { const inp = document.getElementById('crmAvatarInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmAvatarClear')) { setFormPhoto(''); return; }
  if (e.target.closest('#crmImportBtn')) { const inp = document.getElementById('crmImportInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmImportConfirm')) { doImport(); return; }
  if (e.target.closest('#crmImportCancel')) { importPlan = null; renderAdd(); return; }
  if (e.target.closest('#crmEditCancel')) { editingId = null; activeTab = 'pipeline'; render(); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;

  if (a === 'copy') { copyText(act.dataset.text); return; }
  if (a === 'stocksearch') { openStockSearch(act.dataset.stock); return; }
  if (a === 'opensms') { logTextSent(act.dataset.id, act.dataset.seq, act.dataset.variant); setTimeout(render, 50); /* anchor still navigates to sms: */ return; }
  if (a === 'marktext') { e.preventDefault(); logTextSent(act.dataset.id, act.dataset.seq, act.dataset.variant); render(); return; }
  if (a === 'marktask') { markTaskDone(act.dataset.id, act.dataset.seq); render(); return; }
  if (a === 'thanked') { markThanked(act.dataset.id); render(); return; }
  if (a === 'edit') { openEditCustomer(act.dataset.id); return; }
  if (a === 'optout') { toggleOptOut(act.dataset.id); render(); return; }
  if (a === 'del') { removeCustomer(act.dataset.id); render(); return; }
}

function onOverlayChange(e) {
  const sel = e.target.closest('[data-act="variant"]');
  if (sel) { variantChoice.set(sel.dataset.key, sel.value); renderDashboard(); return; }
  if ((e.target.id === 'crmPhotoInput' || e.target.id === 'crmFileInput') && e.target.files && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    extractFromFile(file);
  }
  if (e.target.id === 'crmImportInput' && e.target.files && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    loadImportFile(file);
  }
  if (e.target.id === 'crmAvatarInput' && e.target.files && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!/^image\//.test(file.type)) { toast('Pick an image for the photo'); return; }
    downscaleImage(file).then((url) => setFormPhoto(url)).catch(() => toast('Could not read that image'));
  }
}

function onOverlaySubmit(e) {
  if (e.target.id !== 'crmAddForm') return;
  e.preventDefault();
  const f = e.target;
  const fd = new FormData(f);
  const g = (n) => (fd.get(n) || '').toString();
  const input = {
    firstName: g('firstName'), lastName: g('lastName'), vehicle: g('vehicle'), stockNumber: g('stockNumber'),
    phone: g('phone'), email: g('email'), address: g('address'), notes: g('notes'),
    purchaseDate: g('purchaseDate'), referredById: g('referredById') || null,
    photo: g('photo'),
  };
  const v = validateCustomer(input);
  if (!v.ok) { document.getElementById('crmAddErr').textContent = Object.values(v.errors)[0]; blip(360, 0.06, 'sawtooth', 0.1); return; }
  const list = getCustomers();

  if (editingId) {
    const cur = list.find((x) => x.id === editingId);
    if (cur) {
      // Rebuild through newCustomer to normalize, but preserve the lifecycle
      // fields the timeline depends on (id, stage, optedOut, queued texts, etc.).
      const updated = newCustomer({ ...input, id: cur.id, stage: cur.stage, optedOut: cur.optedOut, pendingTexts: cur.pendingTexts, pendingTasks: cur.pendingTasks, createdAt: cur.createdAt });
      if (cur.referrerThanked) updated.referrerThanked = true;
      list[list.indexOf(cur)] = updated;
      saveCustomers(list);
      blip(900, 0.06, 'sine', 0.12); toast('Customer updated');
    }
    editingId = null; activeTab = 'pipeline'; render();
    return;
  }

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

function markTaskDone(id, seqKey) {
  const list = getCustomers();
  const c = list.find((x) => x.id === id);
  if (!c) return;
  const task = (c.pendingTasks || []).find((p) => p.sequenceKey === seqKey);
  c.pendingTasks = (c.pendingTasks || []).filter((p) => p.sequenceKey !== seqKey);
  c.updatedAt = new Date().toISOString();
  saveCustomers(list);
  const logs = getLogs();
  logs.push({ id: 'log_' + Date.now().toString(36), customerId: id, channel: task ? task.type : 'task', sequenceKey: seqKey, variant: '', subject: task ? task.label : '', body: task ? task.script : '', status: 'sent', sentAt: new Date().toISOString() });
  saveLogs(logs);
  toast('Marked done');
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

// Copy the stock number AND open mosaicautos.com so it can be pasted straight
// into the lot's own search. window.open runs synchronously in the click so it
// isn't popup-blocked; the clipboard write rides alongside.
function openStockSearch(stock) {
  const s = String(stock || '');
  const done = () => { toast(`Stock ${s} copied — paste it into the search on mosaicautos.com`); blip(820, 0.05, 'sine', 0.1); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(done).catch(() => fallbackCopy(s, done));
  } else { fallbackCopy(s, done); }
  try { window.open(MOSAIC_SITE, '_blank', 'noopener'); } catch (e) { /* noop */ }
}
function fallbackCopy(t, done) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select and copy manually'); }
  ta.remove();
}

// ── prefill hand-off (voice + photo both land here for review) ───────────────
function showAddPane(prefill) {
  importPlan = null;
  buildOverlay();
  document.getElementById('crmOverlay').classList.add('show');
  activeTab = 'add';
  document.querySelectorAll('#crmOverlay .crm-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'add'));
  document.getElementById('crmPaneDashboard').classList.remove('on');
  document.getElementById('crmPanePipeline').classList.remove('on');
  document.getElementById('crmPaneAdd').classList.add('on');
  renderAdd(prefill || {});
}

function openAddPrefilled(draft) { editingId = null; showAddPane(draft); }

function openEditCustomer(id) {
  const c = getCustomers().find((x) => x.id === id);
  if (!c) return;
  editingId = id;
  showAddPane({
    firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email,
    vehicle: c.vehicle, stockNumber: c.stockNumber, address: c.address, notes: c.notes,
    purchaseDate: c.purchaseDate, referredById: c.referredById || '', photo: c.photo || '',
  });
}

// ── voice intake: "enter customer" → CARVIS asks the questions ───────────────
const intake = { idx: 0, draft: {}, rec: null, listening: false };

function startVoiceIntake() {
  buildIntakeOverlay();
  populateVoicePicker(); // voices may have finished loading since the overlay was built
  intake.idx = 0; intake.draft = {};
  document.getElementById('crmIntakeOverlay').classList.add('show');
  blip(760, 0.06, 'sine', 0.12);
  intakeAsk(true);
}

function buildIntakeOverlay() {
  if (document.getElementById('crmIntakeOverlay')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'crmIntakeOverlay';
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="mh">
        <div class="av">🎙</div>
        <div><div class="mt">ENTER CUSTOMER</div><div class="ms">Say it out loud, then say “complete” to lock it in</div></div>
        <button class="x" id="crmIntakeClose">✕</button>
      </div>
      <div class="mb">
        <div class="crm-intake-progress" id="crmIntakeProg"></div>
        <div class="crm-intake-q" id="crmIntakeQ"></div>
        <div class="crm-intake-heard" id="crmIntakeHeard"></div>
        <div class="orow">
          <input class="rin" id="crmIntakeInput" placeholder="Speak, then say “complete” — or type and press enter" style="margin-top:0;flex:2" autocomplete="off">
          <button class="crm-btn gold" id="crmIntakeMic" type="button" title="Tap to talk">🎙</button>
        </div>
        <div class="crm-row" style="margin-top:10px">
          <button class="crm-btn send sm" id="crmIntakeNext" type="button">✓ Complete</button>
          <button class="crm-btn sm" id="crmIntakeSkip" type="button">Skip</button>
        </div>
        <div class="crm-intake-summary" id="crmIntakeSummary"></div>
        <div class="crm-voice-pick">
          <span>🔊 Voice</span>
          <select class="crm-select" id="crmVoiceSel"></select>
          <button class="crm-btn sm" id="crmVoiceTest" type="button">Test</button>
        </div>
        <div class="mnote"><span>✦</span><span>Four quick fields: first name, last name, phone, stock number. Say your answer then the word <b>“complete”</b> to save it and move on. First name and phone are required.</span></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('crmIntakeClose').addEventListener('click', cancelIntake);
  ov.addEventListener('click', (e) => { if (e.target === ov) cancelIntake(); });
  document.getElementById('crmIntakeMic').addEventListener('click', toggleIntakeMic);
  document.getElementById('crmIntakeNext').addEventListener('click', () => submitIntake(document.getElementById('crmIntakeInput').value));
  document.getElementById('crmIntakeSkip').addEventListener('click', skipIntake);
  document.getElementById('crmIntakeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitIntake(e.target.value); } });
  document.getElementById('crmVoiceSel').addEventListener('change', (e) => { stopIntakeRec(); setCrmVoice(e.target.value); say('Hey there — this is how I sound.'); });
  document.getElementById('crmVoiceTest').addEventListener('click', () => { stopIntakeRec(); say('Hey there — this is how I sound.'); });
  populateVoicePicker();
}

function intakeAsk(speakIntro, ackPrefix = '') {
  const step = INTAKE_STEPS[intake.idx];
  if (!step) return finishIntake();
  document.getElementById('crmIntakeProg').textContent = `Question ${intake.idx + 1} of ${INTAKE_STEPS.length}${step.required ? ' · required' : ' · optional'}`;
  document.getElementById('crmIntakeQ').textContent = step.ask;
  document.getElementById('crmIntakeHeard').textContent = '';
  document.getElementById('crmIntakeSkip').style.visibility = step.required ? 'hidden' : 'visible';
  const inp = document.getElementById('crmIntakeInput'); inp.value = ''; try { inp.focus(); } catch (e) { /* noop */ }
  renderIntakeSummary();
  const spoken = (ackPrefix ? ackPrefix + ' ' : '') + step.ask;
  if (speakIntro !== false) say(spoken, () => { if (hasSR()) startIntakeRec(); });
  else if (hasSR()) startIntakeRec();
}

function submitIntake(raw) {
  const step = INTAKE_STEPS[intake.idx];
  if (!step) return;
  stopIntakeRec();
  if (step.required && isSkip(raw)) {
    document.getElementById('crmIntakeHeard').textContent = '';
    const msg = step.reAsk || step.ask;
    document.getElementById('crmIntakeQ').textContent = msg;
    say(msg, () => { if (hasSR()) startIntakeRec(); });
    blip(360, 0.06, 'sawtooth', 0.1);
    return;
  }
  if (!isSkip(raw)) intake.draft = applyAnswer(intake.draft, step.key, raw);
  blip(820, 0.05, 'sine', 0.1);
  intake.idx += 1;
  // A warm one-word acknowledgement, spoken together with the next question so
  // it isn't cut off (each say() cancels the previous utterance).
  const ack = !isSkip(raw) && INTAKE_STEPS[intake.idx] ? pickAck() : '';
  intakeAsk(true, ack);
}

const ACKS = ['Got it.', 'Perfect.', 'Beautiful.', 'Good.', 'Nice.'];
function pickAck() { return ACKS[intake.idx % ACKS.length]; }

function skipIntake() {
  const step = INTAKE_STEPS[intake.idx];
  if (step && step.required) { toast('That one is required'); return; }
  stopIntakeRec();
  intake.idx += 1; intakeAsk(true);
}

function renderIntakeSummary() {
  const d = intake.draft;
  const rows = [
    ['First', d.firstName], ['Last', d.lastName], ['Phone', d.phone], ['Stock #', d.stockNumber],
  ].filter(([, val]) => val);
  document.getElementById('crmIntakeSummary').innerHTML = rows.length
    ? '<div class="crm-intake-have">So far: ' + rows.map(([k, val]) => `<span class="pill stage">${esc(k)}: ${esc(val)}</span>`).join(' ') + '</div>'
    : '';
}

function finishIntake() {
  stopIntakeRec();
  document.getElementById('crmIntakeOverlay').classList.remove('show');
  const who = (intake.draft.firstName || '').trim();
  say(who ? `All set. Here's ${who} — give it a look and add them.` : 'All set. Give it a look and add them.');
  openAddPrefilled(intake.draft);
}

function cancelIntake() {
  stopIntakeRec();
  const o = document.getElementById('crmIntakeOverlay'); if (o) o.classList.remove('show');
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* noop */ }
}

// Speech out — a warmer, more natural voice than the terse CARVIS default:
// pick a real "Natural"/Enhanced/Google-class voice when the browser has one,
// honor a saved preference, slow it down a touch, and keep the pitch human.
const VOICE_KEY = 'carvis_referral_voice';
let crmVoice = null, crmVoicePicked = false;

/** English voices on this device, best-sounding first. */
function englishVoices() {
  let all = [];
  try { all = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { all = []; }
  const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
  const pool = en.length ? en : all;
  return pool.slice().sort((a, b) => voiceScore(b) - voiceScore(a));
}
/** Higher = more natural. Enhanced/Premium/Natural/Neural and network voices win. */
function voiceScore(v) {
  const n = (v.name || '') + ' ' + (v.voiceURI || '');
  let s = 0;
  if (/enhanced|premium|natural|neural/i.test(n)) s += 100;
  if (/google|microsoft|siri/i.test(n)) s += 40;
  if (/samantha|ava|allison|jenny|aria|serena|zoe|nicky|evan|tom/i.test(n)) s += 25;
  if (v.localService === false) s += 15; // network voices are usually richer
  if (/en-us/i.test(v.lang || '')) s += 10;
  if (/compact|eloquence|fred|albert|zarvox|robot/i.test(n)) s -= 60; // the robotic ones
  return s;
}
function pickCrmVoice() {
  if (crmVoicePicked && crmVoice) return crmVoice;
  const voices = englishVoices();
  if (!voices.length) return null;
  let saved = '';
  try { saved = localStorage.getItem(VOICE_KEY) || ''; } catch (e) { /* noop */ }
  crmVoice = (saved && voices.find((v) => v.name === saved)) || voices[0] || null;
  crmVoicePicked = true;
  return crmVoice;
}
function setCrmVoice(name) {
  try { localStorage.setItem(VOICE_KEY, name); } catch (e) { /* noop */ }
  crmVoicePicked = false; pickCrmVoice();
}
function say(text, after) {
  let spoke = false;
  try {
    if (window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function') {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickCrmVoice(); if (v) { u.voice = v; u.lang = v.lang || 'en-US'; }
      u.rate = 0.95; u.pitch = 1.02; u.volume = 1.0; // unhurried, a touch warm
      window.speechSynthesis.speak(u);
      spoke = true;
    }
  } catch (e) { /* fall through to CARVIS speak */ }
  if (!spoke) { try { window.speak && window.speak(text); } catch (e) { /* noop */ } }
  if (after) setTimeout(after, Math.min(2800, 750 + text.length * 48));
}
// Voices load async — re-pick and refresh the chooser once they arrive.
try { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { crmVoicePicked = false; pickCrmVoice(); populateVoicePicker(); }; } catch (e) { /* noop */ }

/** Fill the in-overlay voice dropdown with this device's voices. */
function populateVoicePicker() {
  const sel = document.getElementById('crmVoiceSel');
  if (!sel) return;
  const voices = englishVoices();
  const cur = pickCrmVoice();
  if (!voices.length) { sel.innerHTML = '<option>System default</option>'; return; }
  sel.innerHTML = voices.map((v) => `<option value="${esc(v.name)}" ${cur && v.name === cur.name ? 'selected' : ''}>${esc(v.name.replace(/\s*\(.*\)$/, ''))}</option>`).join('');
}

function hasSR() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function toggleIntakeMic() { if (intake.listening) stopIntakeRec(); else startIntakeRec(); }
function startIntakeRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Voice input isn't supported here — type the answer"); return; }
  stopIntakeRec();
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  intake.rec = rec; intake.listening = true; intake.buf = '';
  const mic = document.getElementById('crmIntakeMic'); if (mic) mic.classList.add('on');
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript || '';
      if (e.results[i].isFinal) intake.buf += chunk + ' '; else interim += chunk;
    }
    const full = (intake.buf + ' ' + interim).trim();
    // Spoken "complete" commits the answer (everything before the keyword).
    const m = /\bcomplete\b/i.exec(full);
    const shown = m ? full.slice(0, m.index).trim() : full;
    const heard = document.getElementById('crmIntakeHeard'); if (heard) heard.textContent = shown ? '“' + shown + '”' : '(listening… say “complete” when done)';
    const inp = document.getElementById('crmIntakeInput'); if (inp) inp.value = shown;
    if (m) { stopIntakeRec(); submitIntake(shown); }
  };
  rec.onerror = () => { intake.listening = false; if (mic) mic.classList.remove('on'); };
  rec.onend = () => { intake.listening = false; if (mic) mic.classList.remove('on'); };
  try { rec.start(); } catch (e) { intake.listening = false; }
}
function stopIntakeRec() {
  if (intake.rec) { try { intake.rec.stop(); } catch (e) { /* noop */ } intake.rec = null; }
  intake.listening = false;
  const mic = document.getElementById('crmIntakeMic'); if (mic) mic.classList.remove('on');
}

// ── photo intake: snap/upload a card or paperwork → extract fields ──────────
async function extractFromFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImage = /^image\//.test(file.type);
  if (!isPdf && !isImage) { toast('Use a photo, image, or PDF'); return; }
  // Netlify function bodies cap ~6MB and base64 inflates ~33%, so guard the raw size.
  if (file.size && file.size > 4.5 * 1024 * 1024) { toast('That file is too big — use a photo or a smaller PDF'); return; }
  toast(isPdf ? 'Reading the PDF…' : 'Reading the photo…'); blip(620, 0.06, 'sine', 0.12);
  let dataUrl;
  try { dataUrl = await readFileAsDataURL(file); } catch (e) { toast('Could not read that file'); return; }
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) { toast('Unsupported file format'); return; }
  const [, mediaType, b64] = m;
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };
  try {
    const r = await fetch('/.netlify/functions/carvis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: [
        block,
        { type: 'text', text: EXTRACTION_PROMPT },
      ] }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast('Read failed — set ANTHROPIC_API_KEY, or type it in'); return; }
    const text = Array.isArray(d.content) ? d.content.map((p) => p.text || '').join('') : '';
    const draft = parseExtraction(text);
    if (!draft || !(draft.firstName || draft.phone || draft.vehicle || draft.email)) {
      toast("Couldn't make out the details — type them in"); openAddPrefilled({}); return;
    }
    toast('Pulled the details — check them over'); blip(900, 0.06, 'sine', 0.12);
    openAddPrefilled(draft);
  } catch (e) { toast('Read needs the CARVIS function deployed — type it in instead'); }
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('read error'));
    fr.readAsDataURL(file);
  });
}

// ── profile picture ──────────────────────────────────────────────────────────
/** Small avatar block — the photo if present, else the customer's initials. */
function avatarHTML(c, cls = 'sm') {
  const initials = (((c.firstName || '?')[0] || '?') + ((c.lastName || '')[0] || '')).toUpperCase();
  return `<div class="crm-avatar ${cls}">${c.photo ? `<img src="${esc(c.photo)}" alt="">` : esc(initials)}</div>`;
}

/** Update the add/edit form's photo (hidden field + live preview + buttons). */
function setFormPhoto(dataUrl) {
  const field = document.getElementById('crmPhotoField');
  const prev = document.getElementById('crmAvatarPrev');
  const clear = document.getElementById('crmAvatarClear');
  const btn = document.getElementById('crmAvatarBtn');
  if (!field) return;
  field.value = dataUrl || '';
  if (prev) prev.innerHTML = dataUrl ? `<img src="${esc(dataUrl)}" alt="">` : esc((((document.querySelector('#crmAddForm [name=firstName]') || {}).value || '?')[0] || '?').toUpperCase());
  if (clear) clear.style.display = dataUrl ? '' : 'none';
  if (btn) btn.textContent = `📷 ${dataUrl ? 'Change' : 'Add'} photo`;
}

/** Read an image file and return a small (~160px) JPEG data URL for storage. */
function downscaleImage(file, max = 160) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const src = String(fr.result || '');
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || max) * scale));
          const h = Math.max(1, Math.round((img.height || max) * scale));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) { resolve(src); } // no canvas (rare) → keep original
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    fr.onerror = () => reject(fr.error || new Error('read error'));
    fr.readAsDataURL(file);
  });
}

// ── bulk CSV import ──────────────────────────────────────────────────────────
function loadImportFile(file) {
  if (!/\.csv$/i.test(file.name || '') && !/(csv|plain)/.test(file.type || '')) {
    toast('Use a .csv file — export your spreadsheet as CSV'); return;
  }
  const fr = new FileReader();
  fr.onload = () => {
    try {
      importPlan = planImport(String(fr.result || ''), getCustomers(), localDateStr());
      editingId = null;
      if (!importPlan.items.length) { importPlan = null; toast('No rows found in that CSV'); return; }
      renderImportPreview();
    } catch (e) { importPlan = null; toast('Could not read that CSV'); }
  };
  fr.onerror = () => toast('Could not read that file');
  fr.readAsText(file);
}

function renderImportPreview() {
  const p = importPlan; const c = p.counts;
  const ready = p.items.filter((x) => x.status === 'ready');
  const sample = ready.slice(0, 8).map((x) => {
    const nm = [x.input.firstName, x.input.lastName].filter(Boolean).join(' ');
    const where = Number.isInteger(x.input.stage) && x.input.stage > 0 ? ` · <span class="pill stage">${esc(currentSequence({ stage: x.input.stage }).label)}</span>` : '';
    return `<div class="cmeta">• ${esc(nm)} — ${esc(x.input.phone)}${x.input.vehicle ? ' · ' + esc(x.input.vehicle) : ''}${where}</div>`;
  }).join('');
  document.getElementById('crmPaneAdd').innerHTML = `
    <div class="crm-banner" style="color:var(--cyan);border-color:var(--line-strong);background:rgba(92,240,255,.06)">⇪ Import review — nothing is saved until you confirm.</div>
    <div class="crm-readouts">
      <div class="crm-ro"><div class="v">${c.ready}</div><div class="l">Ready to add</div></div>
      <div class="crm-ro"><div class="v">${c.duplicate}</div><div class="l">Duplicates (skipped)</div></div>
      <div class="crm-ro"><div class="v">${c.invalid}</div><div class="l">Missing name/phone</div></div>
    </div>
    ${sample ? `<div class="crm-card"><div class="cname">First few:</div>${sample}</div>` : '<div class="crm-empty">No valid rows — every row needs at least a name and a phone.</div>'}
    <div class="crm-row">
      <button class="rgen" id="crmImportConfirm" type="button" style="flex:1" ${c.ready ? '' : 'disabled'}>◉ IMPORT ${c.ready} CUSTOMER${c.ready === 1 ? '' : 'S'}</button>
      <button class="crm-btn sm" id="crmImportCancel" type="button">Cancel</button>
    </div>
    <div class="mnote"><span>✦</span><span>Columns I read: <b>${IMPORT_COLUMNS.join('</b>, <b>')}</b>. A <b>Purchase Date</b> column slots older customers into the right spot on the timeline so they don't get the welcome messages. Duplicates are matched by phone.</span></div>`;
}

function doImport() {
  if (!importPlan) return;
  const ready = importPlan.items.filter((x) => x.status === 'ready');
  if (!ready.length) { toast('Nothing to import'); return; }
  const list = getCustomers();
  ready.forEach((x) => list.push(newCustomer(x.input)));
  saveCustomers(list);
  const n = ready.length; importPlan = null;
  blip(900, 0.06, 'sine', 0.12); toast(`Imported ${n} customer${n === 1 ? '' : 's'}`);
  activeTab = 'pipeline'; render();
}

// ── open / close + lifecycle ─────────────────────────────────────────────────
function openReferrals() { editingId = null; importPlan = null; buildOverlay(); render(); document.getElementById('crmOverlay').classList.add('show'); blip(760, 0.06, 'sine', 0.12); }
function closeReferrals() { editingId = null; importPlan = null; const o = document.getElementById('crmOverlay'); if (o) o.classList.remove('show'); }

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

// "enter customer" should launch the guided intake from every entry point:
//  - the mic transcript and Ask CARVIS both call openAI()
//  - the "⇄ Enter Customer" chip, the typed command bar, and ➤ send all call
//    runCmd() — wrapping it also dodges runCmd's name heuristics (e.g. a lead
//    named "Tom" matching because "cusTOMer" contains it).
// Both are global function declarations, so wrapping each once is the clean hook.
const ENTER_CUSTOMER_RE = /^\s*(?:hey\s+carvis,?\s+)?(?:enter|add|new|create|start)\s+(?:a\s+|new\s+)?(?:customer|client|profile|contact)\b/i;
function wrapGlobal(name, onMatch) {
  const orig = window[name];
  if (typeof orig === 'function' && orig.__crmWrapped) return;
  const wrapped = function (arg) {
    if (typeof arg === 'string' && ENTER_CUSTOMER_RE.test(arg)) { onMatch(); return; }
    return typeof orig === 'function' ? orig.apply(this, arguments) : undefined;
  };
  wrapped.__crmWrapped = true;
  window[name] = wrapped;
}
function hookEnterCustomer() {
  const launch = () => { const cmd = document.getElementById('cmd'); if (cmd) cmd.value = ''; startVoiceIntake(); };
  wrapGlobal('openAI', launch);  // mic + Ask CARVIS
  wrapGlobal('runCmd', launch);  // chip + command bar + send button
}

function init() {
  buildOverlay();
  hookSync();
  hookEnterCustomer();
  // Wire the topbar button (added in index.html). Esc closes, matching CARVIS.
  const btn = document.getElementById('crmBtn');
  if (btn) btn.addEventListener('click', openReferrals);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cancelIntake(); closeReferrals(); } });
  window.openReferrals = openReferrals;       // let CARVIS command bar reach it
  window.crmEnterCustomer = startVoiceIntake;  // direct programmatic entry
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

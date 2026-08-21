// crm/crm.js — ROBUST VIEWS: the Referral CRM, mounted into the CARVIS shell.
//
// ES module. Imports the shared CLEAN API so the UI obeys the exact same rules
// as the cron. State lives in localStorage under carvis_referral_* and rides the
// existing CARVIS sync (snapshotStore picks the keys up automatically). The cron
// writes the same blob, so what the engine does shows up here on next pull.

import { KEYS, newCustomer, validateCustomer, digits, migrateCustomer, CATEGORIES, CATEGORY_LABELS, isActionDue } from '../shared/schema.mjs';
import { currentSequence, isStagnant, daysSincePurchase, sequenceByKey, localDateStr } from '../shared/sequences.mjs';
import { hydrate } from '../shared/hydrate.mjs';
import { getText, VARIANTS, VARIANT_LABELS, APPROVED } from '../shared/templates.mjs';
import { isFrozen } from '../shared/compliance.mjs';
import { INTAKE_STEPS, isSkip, applyAnswer, EXTRACTION_PROMPT, parseExtraction } from '../shared/intake.mjs';
import { planImport, IMPORT_COLUMNS } from '../shared/import.mjs';
import { GOALS_KEY, LANES, LANE_LABELS, GROUPS, REWARD_LADDER, newGoal, toggleGoal, sanitizeGoals, computeGoalStats, seedGoals } from '../shared/goals.mjs';
import { computeReferralStats } from '../shared/reporting.mjs';
import { parseQuickAction, resolveDueDate, buildNextAction } from '../shared/quickaction.mjs';

// ── tiny local helpers (no dependency on CARVIS lexical scope) ───────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (m) => { try { window.toast ? window.toast(m) : 0; } catch (e) { /* noop */ } };
const blip = (...a) => { try { window.blip && window.blip(...a); } catch (e) { /* noop */ } };
const pushCloud = () => { try { window.scheduleCloudPush && window.scheduleCloudPush(); } catch (e) { /* noop */ } };
const todayStr = () => localDateStr(); // Central-time calendar date, not UTC
const MOSAIC_SITE = 'https://mosaicautos.com';

// ── store access ─────────────────────────────────────────────────────────────
function loadArr(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
// Every read upgrades old-shaped records to the current schema (migrateCustomer),
// so a software update can never misread or corrupt data saved by an old version.
const getCustomers = () => loadArr(KEYS.customers).map(migrateCustomer).filter(Boolean);
const getLogs = () => loadArr(KEYS.touchLogs);
// meta { lastRun, lastReport } — the cron writes it, sync
// pulls it here, so we can show whether the follow-up engine actually ran.
const getMeta = () => { try { const m = JSON.parse(localStorage.getItem(KEYS.meta) || '{}'); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; } catch (e) { return {}; } };
function fmtAgo(iso) {
  if (!iso) return 'never';
  const t = Date.parse(iso); if (Number.isNaN(t)) return 'unknown';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}
// Let the rest of the app (the index.html dashboard listens) know the store
// moved — same event the sync hook fires, so one listener covers both paths.
const announceStore = () => { try { document.dispatchEvent(new CustomEvent('carvis:storeupdated')); } catch (e) { /* noop */ } };
function saveCustomers(list) { snapshotHistory(); localStorage.setItem(KEYS.customers, JSON.stringify(list)); pushCloud(); announceStore(); }
function saveLogs(list) { localStorage.setItem(KEYS.touchLogs, JSON.stringify(list)); pushCloud(); announceStore(); }

// ── Goals & Rewards store (rides the same carvis_ sync + backup) ─────────────
// First open with no saved list seeds Mick's working list from shared/goals.mjs
// so the tab is never empty. After that it's whatever he's edited it to.
function getGoals() {
  const raw = localStorage.getItem(GOALS_KEY);
  if (raw == null) { const seed = seedGoals(); saveGoals(seed); return seed; }
  try { return sanitizeGoals(JSON.parse(raw)); } catch (e) { return []; }
}
function saveGoals(list) { try { localStorage.setItem(GOALS_KEY, JSON.stringify(list)); } catch (e) { /* noop */ } pushCloud(); }

// ── automatic local version history (one-tap undo, no manual export needed) ───
// Before each customer write we stash the PRIOR state under a local-only key
// (not synced, not cloud-bloating). Recover from a bad edit/delete/overwrite by
// restoring a recent version. Off-device durability is handled by cloud sync.
const HIST_KEY = 'nscrm_history';      // intentionally NOT a carvis_ key → stays local
const HIST_MAX = 30;                    // keep the last 30 changes
const HIST_BUDGET = 3000000;            // ~3MB cap so it can't blow the storage quota
function loadHistory() { try { const v = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function snapshotHistory() {
  const prev = localStorage.getItem(KEYS.customers);
  if (prev == null) return; // nothing saved yet
  let hist = loadHistory();
  if (hist.length && hist[0].customers === prev) return; // unchanged → don't churn
  let count = 0; try { count = (JSON.parse(prev) || []).length; } catch (e) { /* noop */ }
  hist.unshift({ ts: new Date().toISOString(), count, customers: prev });
  hist = hist.slice(0, HIST_MAX);
  let total = hist.reduce((n, h) => n + h.customers.length, 0);
  while (hist.length > 1 && total > HIST_BUDGET) { total -= hist.pop().customers.length; }
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); }
  catch (e) { try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 5))); } catch (_) { /* give up quietly */ } }
}
function restoreVersion(ts) {
  const snap = loadHistory().find((h) => h.ts === ts);
  if (!snap) { toast('That version is no longer available'); return; }
  let list; try { list = JSON.parse(snap.customers); } catch (e) { toast('Could not read that version'); return; }
  if (!window.confirm(`Restore the version from ${new Date(ts).toLocaleString()} (${snap.count} customer${snap.count === 1 ? '' : 's'})? Your current state is saved first, so this is undoable.`)) return;
  saveCustomers(list); // snapshots the current state first, then writes the restore
  showHistory = false;
  toast('Restored — your previous state is in history if you need it back');
  render();
}

// per-card chosen variant, keyed `${id}:${seqKey}`
const variantChoice = new Map();
let activeTab = 'dashboard';
let editingId = null; // when set, the Add pane is editing an existing customer
let importPlan = null; // when set, the Add pane shows the CSV import review
let showHistory = false; // when true, the Pipeline shows the restore-a-version panel
let pipeFilter = 'all'; // Pipeline category filter: all | hot | cold | sold
let captureChoice = null; // Add-tab launcher: which lane's choices are showing — 'photo' | 'file' | null
let photoQueue = []; // several-photos capture: files still waiting for their turn at the review form

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
        ${APPROVED ? '' : '<div class="crm-banner">⏸ Auto-emails are <b>held</b> until your copy is approved. Texts still work — fire them by hand below. (Set APPROVED in shared/templates.mjs once your wording is in.)</div>'}
        <div class="crm-tabs">
          <button class="crm-tab on" data-tab="dashboard">◉ Daily Ops</button>
          <button class="crm-tab" data-tab="add">＋ Add Customer</button>
          <button class="crm-tab" data-tab="pipeline">≣ Pipeline</button>
          <button class="crm-tab" data-tab="goals" title="Level-Up Goals — objectives and rewards (the Sales Scoreboard with your monthly numbers lives under 📊 on the main screen)">◎ Level-Up</button>
        </div>
        <div class="crm-pane on" id="crmPaneDashboard"></div>
        <div class="crm-pane" id="crmPaneAdd"></div>
        <div class="crm-pane" id="crmPanePipeline"></div>
        <div class="crm-pane" id="crmPaneGoals"></div>
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
  document.getElementById('crmPaneGoals').classList.toggle('on', activeTab === 'goals');
  if (activeTab === 'dashboard') renderDashboard();
  else if (activeTab === 'add') renderAdd();
  else if (activeTab === 'goals') renderGoals();
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
    ${sectionHealth()}
    ${sectionNextActions(customers, today)}
    ${sectionReferral(customers)}
    ${sectionTexts(customers)}
    ${sectionTasks(customers)}
    ${sectionStagnant(customers, today)}
    ${sectionScorecard(customers, logs)}
    ${sectionSentList(sentToday, customers)}
  `;
}

// Referral Scorecard — the ask → in → bought funnel plus who actually sends
// people. Pure math from shared/reporting.mjs so it can never drift from the
// engine's idea of the referral window.
function sectionScorecard(customers, logs) {
  const s = computeReferralStats(customers, logs);
  const readouts = `<div class="crm-readouts four">
      <div class="crm-ro"><div class="v">${s.asked}</div><div class="l">Asked</div></div>
      <div class="crm-ro"><div class="v">${s.received}</div><div class="l">Referrals In</div></div>
      <div class="crm-ro"><div class="v">${s.bought}</div><div class="l">Bought</div></div>
      <div class="crm-ro"><div class="v">${s.conversionPct}%</div><div class="l">Conversion</div></div>
    </div>`;
  const sources = s.topSources.length ? `<div class="crm-card"><div class="cname">Top referral sources</div>
      ${s.topSources.map((t) => `<div class="cmeta">• ${esc(t.name || 'Customer')} — ${t.count} sent, ${t.boughtCount} bought</div>`).join('')}
    </div>` : '';
  const nudge = s.received === 0 ? '<div class="crm-empty">Referrals show here once someone you logged as “Referred by” comes in.</div>' : '';
  return section('⇄ Referral Scorecard', s.received, readouts + sources + nudge);
}

// System Health — did the daily follow-up engine actually run? Reads the cron's
// last report out of synced meta. Stale (or never) is the thing to catch: a
// silent cron means no emails/texts are going out and you'd never know.
function sectionHealth() {
  const meta = getMeta();
  const lastRun = meta.lastRun || null;
  const r = meta.lastReport || null;
  const t = lastRun ? Date.parse(lastRun) : NaN;
  const stale = !lastRun || Number.isNaN(t) || (Date.now() - t) > 36 * 3600 * 1000; // ~1.5 days
  const cls = !lastRun ? 'warn' : (stale ? 'alert' : '');
  const dot = !lastRun ? '○' : (stale ? '⚠' : '●');
  const runLine = lastRun
    ? `Last run ${fmtAgo(lastRun)} · ${new Date(lastRun).toLocaleString()}`
    : 'The daily follow-up engine has not reported a run yet.';
  const failed = r && r.emailsFailed ? `<span class="pill opt">${r.emailsFailed} email${r.emailsFailed === 1 ? '' : 's'} failed</span>` : '';
  const stats = r ? `<div class="crm-row" style="margin-top:8px;gap:14px 16px">
      <span class="cmeta">✉ ${r.emailsSent || 0} sent</span>
      <span class="cmeta">⏸ ${r.emailsHeld || 0} held</span>
      <span class="cmeta">✆ ${r.textsQueued || 0} texts queued</span>
      <span class="cmeta">◦ ${r.tasksQueued || 0} tasks</span>
      <span class="cmeta">⊘ ${r.skippedOptedOut || 0} opted out</span>
    </div>` : '';
  const hint = stale
    ? `<div class="cmeta" style="margin-top:8px">${lastRun
        ? 'No run in over a day — check Netlify → Functions → daily-runner (Run now) and that CRM_SYNC_KEY matches your ⇅ Sync key.'
        : 'Once CRM_SYNC_KEY is set and the cron runs, open the app so its report syncs here. Texts still work by hand meanwhile.'}</div>`
    : '';
  const body = `<div class="crm-card ${cls}">
      <div class="crm-row between"><div class="cname">${dot} Follow-up engine</div>${failed}</div>
      <div class="cmeta">${esc(runLine)}</div>
      ${stats}${hint}
    </div>`;
  return section('◉ System Health', fmtAgo(lastRun), body);
}

// Next Actions — the universal to-do. Any contact (buyer or prospect) with a
// next step whose due date is today or past shows here, soonest first. One tap
// calls/texts them; ✓ Done clears the step. Set the step on the Add/Edit form.
function daysWord(dueStr, today) {
  if (dueStr < today) { const n = Math.round((Date.parse(today) - Date.parse(dueStr)) / 86400000); return `<span class="pill opt">Overdue ${n}d</span>`; }
  return '<span class="pill stage">Today</span>';
}
function sectionNextActions(customers, today) {
  const due = customers.filter((c) => !isFrozen(c) && isActionDue(c, today)).sort((a, b) => a.nextActionDue.localeCompare(b.nextActionDue));
  const body = due.length ? due.map((c) => `<div class="crm-card" data-id="${esc(c.id)}">
      <div class="crm-row between">
        <div class="crm-idrow">${avatarHTML(c)}<div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
        <div class="cmeta">➜ ${esc(c.nextAction)}</div></div></div>
        ${daysWord(c.nextActionDue, today)}
      </div>
      <div class="crm-row" style="margin-top:10px">
        ${c.phone ? `<a class="crm-btn send sm" href="tel:${esc(digits(c.phone))}">✆ Call</a>` : ''}
        ${c.phone ? `<a class="crm-btn sm" href="sms:${esc(digits(c.phone))}">✎ Text</a>` : ''}
        <button class="crm-btn sm" data-act="edit" data-id="${esc(c.id)}">✎ Edit step</button>
        <button class="crm-btn gold sm" data-act="actiondone" data-id="${esc(c.id)}">✓ Done</button>
      </div>
    </div>`).join('') : '<div class="crm-empty">No next steps due. Set a “Next step” + due date on any contact and it lands here when it comes up.</div>';
  return section('➜ Next Actions — Due', due.length, body);
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
const TASK_ICON = { call: '✆', video: '🎥', gift: '🎁', reachout: '💬' };
function sectionTasks(customers) {
  const cards = [];
  customers.forEach((c) => {
    if (isFrozen(c) || !Array.isArray(c.pendingTasks)) return;
    c.pendingTasks.forEach((tk) => {
      const icon = TASK_ICON[tk.type] || '◷';
      const callHref = tk.type === 'call' && c.phone ? `tel:${digits(c.phone)}` : '';
      const smsHref = tk.type === 'reachout' && c.phone ? `sms:${digits(c.phone)}?body=${encodeURIComponent(tk.script || '')}` : '';
      cards.push(`<div class="crm-card" data-id="${esc(c.id)}">
        <div class="crm-row between">
          <div class="crm-idrow">${avatarHTML(c)}<div><div class="cname">${icon} ${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${[c.vehicle, tk.label || tk.type].filter(Boolean).map(esc).join(' · ')}</div></div></div>
        </div>
        <div class="cbody">${esc(tk.script || '')}</div>
        <div class="crm-row">
          ${callHref ? `<a class="crm-btn send sm" href="${callHref}">✆ Call now</a>` : ''}
          ${smsHref ? `<a class="crm-btn send sm" href="${smsHref}">✆ One-tap text</a>` : ''}
          ${tk.script ? `<button class="crm-btn sm" data-act="copy" data-text="${esc(tk.script)}">⎘ Copy</button>` : ''}
          <button class="crm-btn gold sm" data-act="marktask" data-id="${esc(c.id)}" data-seq="${esc(tk.sequenceKey)}">✓ Mark done</button>
        </div>
      </div>`);
    });
  });
  const body = cards.length ? cards.join('') : '<div class="crm-empty">Nothing to work right now. Reach-outs for hot/cold leads and the 90-day touches land here.</div>';
  return section('◷ To-Do — Reach-outs · Calls · Gifts', cards.length, body);
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
    ${editing ? '' : `<div class="crm-capture-label">Add a customer by:</div>
    <div id="crmLaunch">${launcherHTML()}</div>`}
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
        <div class="full"><span class="olabel">Category</span>
          <select class="rin" name="category">
            ${CATEGORIES.map((k) => `<option value="${k}" ${(prefill.category || 'sold') === k ? 'selected' : ''}>${esc(CATEGORY_LABELS[k])}</option>`).join('')}
          </select>
        </div>
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
        <div><span class="olabel">Next step</span><input class="rin" name="nextAction" placeholder="e.g. Call about trade photos" value="${v('nextAction')}"></div>
        <div><span class="olabel">Next step due</span><input class="rin" type="date" name="nextActionDue" value="${v('nextActionDue')}"></div>
        <div class="full"><span class="olabel">Consent <span style="color:var(--dim);text-transform:none;letter-spacing:0">— for the record / future automated sending</span></span>
          <div class="crm-consent-row">
            <label class="crm-consent"><input type="checkbox" name="emailConsent" ${prefill.emailConsent ? 'checked' : ''}> Email OK</label>
            <label class="crm-consent"><input type="checkbox" name="smsConsent" ${prefill.smsConsent ? 'checked' : ''}> Text OK</label>
          </div>
        </div>
      </div>
      <div class="crm-err" id="crmAddErr"></div>
      <div class="crm-row">
        <button class="rgen" type="submit" style="flex:1">◉ ${editing ? 'UPDATE CUSTOMER' : 'ADD CUSTOMER'}</button>
        ${editing ? '<button class="crm-btn sm" type="button" id="crmEditCancel">Cancel</button>' : ''}
      </div>
      <div class="mnote"><span>✦</span><span>Only <b>name</b> and <b>phone</b> are required — skip anything you don't have and fill it in later. Saves locally and rides your existing Data Sync.</span></div>
    </form>`;
}

// The capture launcher — three lanes in, Photo and File each open a second row
// of choices when tapped (one contact vs. a batch). The hidden inputs live here
// too, so refreshing the launcher swaps the whole set together; the delegated
// change handler on the overlay picks them up regardless.
function launcherHTML() {
  const sub = captureChoice === 'photo'
    ? `<div class="crm-launch-sub">
        <button class="crm-btn cap sub" id="crmPhotoOneBtn" type="button">One customer</button>
        <button class="crm-btn cap sub" id="crmPhotoManyBtn" type="button">Several — one per photo</button>
      </div>`
    : captureChoice === 'file'
      ? `<div class="crm-launch-sub">
        <button class="crm-btn cap sub" id="crmFileOneBtn" type="button">One file — image / PDF</button>
        <button class="crm-btn cap sub" id="crmImportBtn" type="button">A list — CSV</button>
      </div>`
      : '';
  return `<div class="crm-intake-launch three">
      <button class="crm-btn cap gold" id="crmVoiceBtn" type="button">🎙 Voice</button>
      <button class="crm-btn cap ${captureChoice === 'photo' ? 'picked' : ''}" id="crmPhotoBtn" type="button">📷 Photo</button>
      <button class="crm-btn cap ${captureChoice === 'file' ? 'picked' : ''}" id="crmFileBtn" type="button">📄 File</button>
      ${sub}
      <input type="file" id="crmPhotoInput" accept="image/*" capture="environment" hidden>
      <input type="file" id="crmPhotoMultiInput" accept="image/*" multiple hidden>
      <input type="file" id="crmFileInput" accept="image/*,application/pdf,.pdf" hidden>
      <input type="file" id="crmImportInput" accept=".csv,text/csv,text/plain" hidden>
      <span class="crm-launch-or">…or just type it in below</span>
    </div>`;
}

// Swap just the launcher block so anything typed into the form below survives
// the Photo/File choice toggle.
function refreshLauncher() {
  const el = document.getElementById('crmLaunch');
  if (el) el.innerHTML = launcherHTML();
}

function categoryPill(c) {
  const cat = c.category || 'sold';
  return `<span class="pill pill-${esc(cat)}">${esc({ hot: 'HOT', cold: 'COLD', sold: 'SOLD' }[cat] || cat)}</span>`;
}

function renderPipeline() {
  const all = getCustomers().slice().sort((a, b) => (a.stage - b.stage) || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const today = todayStr();
  const catOf = (c) => c.category || 'sold';
  const counts = { all: all.length, hot: 0, cold: 0, sold: 0 };
  all.forEach((c) => { counts[catOf(c)] = (counts[catOf(c)] || 0) + 1; });
  const chips = [['all', 'All'], ['hot', 'Hot'], ['cold', 'Cold'], ['sold', 'Sold']]
    .map(([k, lbl]) => `<button class="crm-chip ${pipeFilter === k ? 'on' : ''}" type="button" data-act="pipefilter" data-cat="${k}">${lbl} ${counts[k] || 0}</button>`).join('');
  const customers = pipeFilter === 'all' ? all : all.filter((c) => catOf(c) === pipeFilter);

  let list;
  if (!all.length) {
    list = '<div class="crm-empty">No customers yet. Add one from the ＋ tab — it takes about 20 seconds.</div>';
  } else if (!customers.length) {
    list = `<div class="crm-empty">No ${esc(pipeFilter)} contacts yet.</div>`;
  } else {
    list = customers.map((c) => {
      const frozen = isFrozen(c);
      const prospect = catOf(c) === 'hot' || catOf(c) === 'cold';
      const stale = !prospect && isStagnant(c, today);
      const line1 = prospect ? (c.vehicle || 'prospect') : [c.vehicle || 'no vehicle on file', `${daysSincePurchase(c, today)} days`].join(' · ');
      const contact = [c.phone, c.email].filter(Boolean).join(' · ');
      const stockLine = c.stockNumber ? `<div class="cmeta">Stock <button class="crm-stock-link" type="button" data-act="stocksearch" data-stock="${esc(c.stockNumber)}" title="Copy stock # and open mosaicautos.com">${esc(c.stockNumber)} ⧉↗</button></div>` : '';
      return `<div class="crm-card ${stale ? 'alert' : ''}" data-id="${esc(c.id)}">
        <div class="crm-row between">
          <div class="crm-idrow">${avatarHTML(c, 'md')}<div><div class="cname">${esc(c.firstName)} ${esc(c.lastName || '')}</div>
          <div class="cmeta">${esc(line1)}</div>
          ${stockLine}
          ${contact ? `<div class="cmeta">${esc(contact)}</div>` : ''}
          ${c.address ? `<div class="cmeta">${esc(c.address)}</div>` : ''}
          ${c.notes ? `<div class="cmeta">✎ ${esc(c.notes)}</div>` : ''}
          ${c.nextAction ? `<div class="cmeta">➜ ${esc(c.nextAction)}${c.nextActionDue ? ` <span class="pill ${c.nextActionDue <= today ? 'opt' : 'stage'}">${c.nextActionDue <= today ? 'due' : esc(c.nextActionDue)}</span>` : ''}</div>` : ''}</div></div>
          <div class="crm-row">
            ${categoryPill(c)}
            ${frozen ? '<span class="pill opt">OPTED OUT</span>' : (prospect ? '' : `<span class="pill stage">${esc(currentSequence(c).label)}</span>`)}
            ${stale ? '<span class="pill">stagnant</span>' : ''}
            ${c.emailConsent ? '<span class="pill pill-sold" title="Email consent on file">✉ OK</span>' : ''}
            ${c.smsConsent ? '<span class="pill pill-sold" title="Text consent on file">✆ OK</span>' : ''}
          </div>
        </div>
        <div class="crm-row" style="margin-top:10px">
          <button class="crm-btn sm" data-act="edit" data-id="${esc(c.id)}">✎ Edit</button>
          <button class="crm-btn ${frozen ? 'gold' : 'ghost-red'} sm" data-act="optout" data-id="${esc(c.id)}">${frozen ? '↺ Re-enable' : '⓪ Opt out'}</button>
          <button class="crm-btn sm" data-act="del" data-id="${esc(c.id)}">✕ Remove</button>
        </div>
      </div>`;
    }).join('');
  }
  const body = `<div class="crm-chips">${chips}</div>${list}`;
  document.getElementById('crmPanePipeline').innerHTML = section('≣ Contacts', customers.length, body) + historyPanel();
}

function historyPanel() {
  const hist = loadHistory();
  if (!hist.length) return '';
  const head = `<div class="crm-row between"><span class="crm-hist-h">↶ Auto-saved versions</span>
    <button class="crm-btn sm" data-act="history-toggle" type="button">${showHistory ? 'Hide' : `Restore a version (${hist.length})`}</button></div>`;
  if (!showHistory) return `<div class="crm-sec">${head}</div>`;
  const rows = hist.map((h) => `<div class="crm-row between" style="margin-top:6px">
      <span class="cmeta">${esc(new Date(h.ts).toLocaleString())} · ${h.count} customer${h.count === 1 ? '' : 's'}</span>
      <button class="crm-btn sm" data-act="restore-version" data-ts="${esc(h.ts)}" type="button">↶ Restore</button>
    </div>`).join('');
  return `<div class="crm-sec">${head}
    <div class="crm-empty" style="text-align:left;margin-top:8px">The app saves a version before every change (kept on this device). Restoring is itself undoable. For off-device safety, keep ⇅ Sync on.</div>
    ${rows}</div>`;
}

function section(title, count, body) {
  return `<div class="crm-sec"><h4><span class="hbar"></span>${esc(title)}<span class="ct">${count}</span></h4>${body}</div>`;
}

// ── Goals & Rewards tab ──────────────────────────────────────────────────────
// The Level-Up layer: Mick's real objectives + rewards, fully editable, with the
// one rule — no reward until the box is checked. Text edits save on blur (no
// re-render, so typing keeps focus); checkbox / add / delete / reset re-render.
function renderGoals() {
  const goals = getGoals();
  const stats = computeGoalStats(goals);
  const C = 2 * Math.PI * 26;
  const ring = `<svg width="64" height="64" viewBox="0 0 64 64" class="goal-ring">
      <circle cx="32" cy="32" r="26" class="goal-ring-bg"/>
      <circle cx="32" cy="32" r="26" class="goal-ring-fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - stats.pct / 100)}"/></svg>`;

  const head = `<div class="goal-head">
      <div class="goal-head-ring">${ring}<div class="goal-head-pct">${stats.pct}%</div></div>
      <div class="goal-head-txt">
        <div class="cname">${stats.done} of ${stats.total} checked off</div>
        <div class="cmeta">No reward until the box is checked. That is the whole game.</div>
      </div>
    </div>`;

  const rewards = stats.unlockedRewards.length
    ? `<div class="crm-banner goal-earned">🏆 Earned — you checked the box, take it:<ul>${stats.unlockedRewards.map((r) => `<li><b>${esc(r.reward)}</b>${r.objective ? ` <span class="cmeta">— ${esc(r.objective)}</span>` : ''}</li>`).join('')}</ul></div>`
    : '';

  const lanes = LANES.map((lane) => {
    const inLane = goals.filter((g) => g.lane === lane);
    // Groups in defined order, then any custom groups the user added.
    const order = (GROUPS[lane] || []).slice();
    inLane.forEach((g) => { if (!order.includes(g.group)) order.push(g.group); });
    const groups = order.map((group) => {
      const rows = inLane.filter((g) => g.group === group);
      const done = rows.filter((g) => g.done).length;
      const body = rows.map(goalCard).join('') + `<div class="crm-row" style="margin-top:8px">
        <button class="crm-btn sm" data-act="goal-add" data-lane="${esc(lane)}" data-group="${esc(group)}" type="button">＋ Add objective</button></div>`;
      return section(group, `${done}/${rows.length}`, body);
    }).join('');
    return `<div class="goal-lane"><div class="goal-lane-h">${esc(LANE_LABELS[lane])}</div>${groups}</div>`;
  }).join('');

  const ladder = `<div class="crm-sec"><h4><span class="hbar"></span>Rewards Ladder<span class="ct">${REWARD_LADDER.length}</span></h4>
    ${REWARD_LADDER.map((r) => `<div class="crm-card"><div class="cname">${esc(r.tier)}</div>
      <div class="cmeta">When: ${esc(r.when)}</div><div class="cmeta">Ideas: ${esc(r.ideas)}</div></div>`).join('')}
    <div class="crm-empty" style="text-align:left;margin-top:10px">Rules: move a deadline once, fine — twice, split the goal. One big goal at a time per lane. Sunday review, every week, ten minutes.</div>
    <div class="crm-row" style="margin-top:10px"><button class="crm-btn sm ghost-red" data-act="goals-reset" type="button">↺ Reset to the starting list</button></div>
  </div>`;

  document.getElementById('crmPaneGoals').innerHTML = head + rewards + lanes + ladder;
}

function goalCard(g) {
  const field = (name, val, ph) => `<input class="rin goal-in" data-act="goal-edit" data-id="${esc(g.id)}" data-field="${name}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  return `<div class="crm-card goal-card ${g.done ? 'goal-done' : ''}" data-id="${esc(g.id)}">
    <div class="goal-top">
      <label class="goal-check"><input type="checkbox" class="goal-box" data-act="goal-toggle" data-id="${esc(g.id)}" ${g.done ? 'checked' : ''}><span class="goal-mark"></span></label>
      <input class="goal-obj" data-act="goal-edit" data-id="${esc(g.id)}" data-field="objective" value="${esc(g.objective)}" placeholder="What are you doing?">
      <button class="crm-btn sm goal-x" data-act="goal-del" data-id="${esc(g.id)}" type="button" title="Remove">✕</button>
    </div>
    <div class="goal-grid">
      <label class="goal-f"><span class="olabel">Target / Gate</span>${field('detail', g.detail, 'e.g. 100%, 30 days')}</label>
      <label class="goal-f"><span class="olabel">Deadline</span>${field('deadline', g.deadline, 'a date, or Ongoing')}</label>
      <label class="goal-f full"><span class="olabel">Reward</span>${field('reward', g.reward, 'what you earn when it is checked')}</label>
    </div>
  </div>`;
}

// ── Goals mutations ──────────────────────────────────────────────────────────
function toggleGoalDone(id) {
  const next = toggleGoal(getGoals(), id, new Date().toISOString());
  saveGoals(next);
  blip(880, 0.05, 'sine', 0.1);
  renderGoals();
}
function editGoalField(id, field, value) {
  const allowed = ['objective', 'detail', 'deadline', 'reward'];
  if (!allowed.includes(field)) return;
  const list = getGoals();
  const g = list.find((x) => x.id === id);
  if (!g) return;
  g[field] = String(value == null ? '' : value).trim();
  saveGoals(list); // no re-render: preserves the caret while typing/tabbing
}
function addGoal(lane, group) {
  const list = getGoals();
  list.push(newGoal({ id: 'goal_' + Date.now().toString(36), lane, group }));
  saveGoals(list);
  renderGoals();
}
function removeGoal(id) {
  const list = getGoals();
  const g = list.find((x) => x.id === id);
  if (g && (g.objective || g.reward) && !window.confirm('Remove this objective?')) return;
  saveGoals(list.filter((x) => x.id !== id));
  renderGoals();
}
function resetGoals() {
  if (!window.confirm('Reset to the starting Goals & Rewards list? Your current edits and check-offs will be replaced.')) return;
  const seed = seedGoals();
  saveGoals(seed);
  toast('Goals reset to the starting list');
  renderGoals();
}

// ── events ───────────────────────────────────────────────────────────────────
function onOverlayClick(e) {
  const tab = e.target.closest('.crm-tab');
  if (tab) { editingId = null; importPlan = null; showHistory = false; captureChoice = null; photoQueue = []; activeTab = tab.dataset.tab; render(); return; }
  if (e.target.closest('#crmVoiceBtn')) { startVoiceIntake(); return; }
  if (e.target.closest('#crmPhotoBtn')) { captureChoice = captureChoice === 'photo' ? null : 'photo'; refreshLauncher(); return; }
  if (e.target.closest('#crmFileBtn')) { captureChoice = captureChoice === 'file' ? null : 'file'; refreshLauncher(); return; }
  if (e.target.closest('#crmPhotoOneBtn')) { const inp = document.getElementById('crmPhotoInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmPhotoManyBtn')) { const inp = document.getElementById('crmPhotoMultiInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmFileOneBtn')) { const inp = document.getElementById('crmFileInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmAvatarBtn')) { const inp = document.getElementById('crmAvatarInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmAvatarClear')) { setFormPhoto(''); return; }
  if (e.target.closest('#crmImportBtn')) { const inp = document.getElementById('crmImportInput'); if (inp) inp.click(); return; }
  if (e.target.closest('#crmImportConfirm')) { doImport(); return; }
  if (e.target.closest('#crmImportCancel')) { importPlan = null; renderAdd(); return; }
  if (e.target.closest('#crmEditCancel')) { editingId = null; if (advancePhotoQueue()) return; activeTab = 'pipeline'; render(); return; }
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
  if (a === 'pipefilter') { pipeFilter = act.dataset.cat || 'all'; render(); return; }
  if (a === 'history-toggle') { showHistory = !showHistory; render(); return; }
  if (a === 'restore-version') { restoreVersion(act.dataset.ts); return; }
  if (a === 'actiondone') { clearNextAction(act.dataset.id); render(); return; }
  if (a === 'goal-add') { addGoal(act.dataset.lane, act.dataset.group); return; }
  if (a === 'goal-del') { removeGoal(act.dataset.id); return; }
  if (a === 'goals-reset') { resetGoals(); return; }
}

function onOverlayChange(e) {
  const sel = e.target.closest('[data-act="variant"]');
  if (sel) { variantChoice.set(sel.dataset.key, sel.value); renderDashboard(); return; }
  const box = e.target.closest('[data-act="goal-toggle"]');
  if (box) { toggleGoalDone(box.dataset.id); return; }
  const gin = e.target.closest('[data-act="goal-edit"]');
  if (gin) { editGoalField(gin.dataset.id, gin.dataset.field, gin.value); return; } // saves on blur, no re-render → keeps focus
  if ((e.target.id === 'crmPhotoInput' || e.target.id === 'crmFileInput') && e.target.files && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    extractFromFile(file);
  }
  if (e.target.id === 'crmPhotoMultiInput' && e.target.files && e.target.files.length) {
    const files = Array.from(e.target.files).filter((f) => /^image\//.test(f.type));
    e.target.value = '';
    if (!files.length) { toast('Pick photos — one customer per shot'); return; }
    // First photo goes straight to extraction; the rest wait their turn and roll
    // in one at a time as each review form is saved (or cancelled).
    photoQueue = files.slice(1);
    if (photoQueue.length) toast(`${files.length} photos — save each one as it comes up`);
    extractFromFile(files[0], { fromQueue: photoQueue.length > 0 }).then((opened) => { if (!opened) advancePhotoQueue(); });
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
    photo: g('photo'), category: g('category') || 'sold',
    nextAction: g('nextAction'), nextActionDue: g('nextActionDue'),
    emailConsent: fd.get('emailConsent') === 'on', smsConsent: fd.get('smsConsent') === 'on',
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
    editingId = null;
    if (advancePhotoQueue()) return; // drifted into an edit mid-queue — keep the run going
    activeTab = 'pipeline'; render();
    return;
  }

  // Duplicate guard: don't let the same phone get added twice by hand (import
  // already dedupes). Matches on digits so formatting differences don't slip by.
  const ph = digits(input.phone);
  const dupe = ph && list.find((c) => digits(c.phone) === ph);
  if (dupe) {
    document.getElementById('crmAddErr').textContent = `${dupe.firstName} ${dupe.lastName || ''} is already on that number — edit them instead.`;
    blip(360, 0.06, 'sawtooth', 0.1);
    return;
  }

  list.push(newCustomer(input));
  saveCustomers(list);
  blip(900, 0.06, 'sine', 0.12); toast('Customer added');
  if (advancePhotoQueue()) return; // several-photos run: roll straight into the next one
  activeTab = 'dashboard'; render();
}

// Several-photos capture: pull the next file off the queue and run it through
// extraction. Returns true when it took over (a photo was waiting), false when
// the queue is empty and the caller should carry on as normal. Unreadable
// photos are skipped so one bad shot can't stall the run.
function advancePhotoQueue() {
  if (!photoQueue.length) return false;
  const next = photoQueue.shift();
  toast(photoQueue.length ? `Next photo — ${photoQueue.length} left after this` : 'Next photo — last one');
  extractFromFile(next, { fromQueue: true }).then((opened) => {
    if (opened) return;
    if (!advancePhotoQueue()) { activeTab = 'dashboard'; if (isOpen()) render(); } // queue ended on a bad photo — land somewhere sane
  });
  return true;
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

// Clear a completed next step. Contact history stays in the touch-log trail;
// this just takes the item off the To-Do.
function clearNextAction(id) {
  const list = getCustomers();
  const c = list.find((x) => x.id === id);
  if (!c) return;
  c.nextAction = ''; c.nextActionDue = '';
  c.updatedAt = new Date().toISOString();
  saveCustomers(list);
  blip(880, 0.05, 'sine', 0.1); toast('Next step cleared');
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
    purchaseDate: c.purchaseDate, referredById: c.referredById || '', photo: c.photo || '', category: c.category || 'sold',
    nextAction: c.nextAction || '', nextActionDue: c.nextActionDue || '',
    emailConsent: c.emailConsent === true, smsConsent: c.smsConsent === true,
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
// Returns true when it opened the review form, false otherwise — the
// several-photos queue uses that to skip past a photo it couldn't read.
async function extractFromFile(file, { fromQueue = false } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImage = /^image\//.test(file.type);
  if (!isPdf && !isImage) { toast('Use a photo, image, or PDF'); return false; }
  // Netlify function bodies cap ~6MB and base64 inflates ~33%, so guard the raw size.
  if (file.size && file.size > 4.5 * 1024 * 1024) { toast('That file is too big — use a photo or a smaller PDF'); return false; }
  toast(isPdf ? 'Reading the PDF…' : 'Reading the photo…'); blip(620, 0.06, 'sine', 0.12);
  let dataUrl;
  try { dataUrl = await readFileAsDataURL(file); } catch (e) { toast('Could not read that file'); return false; }
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) { toast('Unsupported file format'); return false; }
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
    if (!r.ok) { toast('Read failed — set ANTHROPIC_API_KEY, or type it in'); return false; }
    const text = Array.isArray(d.content) ? d.content.map((p) => p.text || '').join('') : '';
    const draft = parseExtraction(text);
    if (!draft || !(draft.firstName || draft.phone || draft.vehicle || draft.email)) {
      // Mid-queue an unreadable shot gets skipped; solo it opens a blank form.
      if (fromQueue) { toast("Couldn't make out that photo — skipping it"); return false; }
      toast("Couldn't make out the details — type them in"); openAddPrefilled({}); return true;
    }
    toast('Pulled the details — check them over'); blip(900, 0.06, 'sine', 0.12);
    openAddPrefilled(draft);
    return true;
  } catch (e) { toast('Read needs the CARVIS function deployed — type it in instead'); return false; }
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
function closeReferrals() { editingId = null; importPlan = null; captureChoice = null; photoQueue = []; const o = document.getElementById('crmOverlay'); if (o) o.classList.remove('show'); }

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

// Fantastical-style quick capture — "call John Friday", "text Brenda the RAV4
// pics tomorrow" — sets a contact's nextAction/nextActionDue straight from the
// command bar (typed or spoken; both funnel through the same wrapped globals).
// shared/quickaction.mjs does the language part; this only matches the name to
// a customer and saves. Returns true when it HANDLED the phrase (saved, or told
// the user why not) so the wrapper stops there; false means "not ours — let the
// original command handling run untouched".
function tryQuickAction(arg) {
  const parsed = parseQuickAction(arg);
  if (!parsed) return false;
  const parts = parsed.name.toLowerCase().split(/\s+/);
  const first = parts[0];
  const last = parts[1] || '';
  const list = getCustomers();
  const matches = list.filter((c) => {
    if (String(c.firstName || '').trim().toLowerCase() !== first) return false;
    return !last || String(c.lastName || '').trim().toLowerCase().startsWith(last);
  });
  if (!matches.length) return false; // nobody by that name → normal command
  if (matches.length > 1) {
    const cap = first.charAt(0).toUpperCase() + first.slice(1);
    toast(`More than one ${cap} — open the CRM and set it there`);
    return true; // ambiguous — never guess a record
  }
  const c = matches[0];
  const due = resolveDueDate(parsed.dayWord, todayStr());
  c.nextAction = buildNextAction(parsed);
  c.nextActionDue = due;
  c.updatedAt = new Date().toISOString();
  saveCustomers(list);
  if (isOpen()) render();
  blip(880, 0.06, 'sine', 0.12);
  toast(`Next step saved — ${parsed.verb} ${c.firstName} by ${due}`);
  return true;
}

function wrapGlobal(name, onMatch) {
  const orig = window[name];
  if (typeof orig === 'function' && orig.__crmWrapped) return;
  const wrapped = function (arg) {
    // Order matters: the guided-intake regex keeps priority over quick capture.
    if (typeof arg === 'string' && ENTER_CUSTOMER_RE.test(arg)) { onMatch(); return; }
    if (typeof arg === 'string' && tryQuickAction(arg)) {
      const cmd = document.getElementById('cmd'); if (cmd) cmd.value = '';
      return;
    }
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

// One-time drain of the legacy silo queue. index.html stages old carvis_hot /
// carvis_contacts entries under carvis_silo_pending (it never writes the CRM
// store itself); we fold them in here, skipping anyone already on file by phone
// digits (or email when there's no phone). No validateCustomer on purpose — a
// phone-less legacy contact still belongs in the book; the phone can be added
// on the edit form later.
function drainSiloQueue() {
  let raw = null;
  try { raw = localStorage.getItem('carvis_silo_pending'); } catch (e) { return; }
  if (raw == null) return;
  let pending = [];
  try { const v = JSON.parse(raw); if (Array.isArray(v)) pending = v.filter((x) => x && typeof x === 'object'); } catch (e) { /* junk key → just clear it */ }
  const list = getCustomers();
  const phones = new Set(list.map((c) => digits(c.phone)).filter(Boolean));
  const emails = new Set(list.map((c) => String(c.email || '').trim().toLowerCase()).filter(Boolean));
  let moved = 0;
  pending.forEach((p) => {
    const ph = digits(p.phone);
    const em = String(p.email || '').trim().toLowerCase();
    if (ph ? phones.has(ph) : (em && emails.has(em))) return; // already on file
    list.push(newCustomer({
      firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email,
      vehicle: p.vehicle, category: p.category,
    }));
    if (ph) phones.add(ph);
    if (em) emails.add(em);
    moved += 1;
  });
  if (moved) saveCustomers(list);
  try { localStorage.removeItem('carvis_silo_pending'); } catch (e) { /* noop */ }
  if (moved) toast(`Moved ${moved} legacy contact${moved === 1 ? '' : 's'} into the CRM`);
}

function init() {
  buildOverlay();
  drainSiloQueue();
  hookSync();
  hookEnterCustomer();
  // Wire the topbar button (added in index.html). Esc closes, matching CARVIS.
  const btn = document.getElementById('crmBtn');
  if (btn) btn.addEventListener('click', openReferrals);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cancelIntake(); closeReferrals(); } });
  window.openReferrals = openReferrals;       // let CARVIS command bar reach it
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/*
 * North Star Keep-In-Touch — cadence & selection engine (Agent 2)
 *
 * UMD. In Node: `const KIT = require('./lib/engine.js')`. In the browser
 * (inlined into index.html): `window.KIT`. Zero dependencies, no I/O.
 *
 * Every function is pure. The only place the wall clock is read is
 * todayChicago() / nowChicagoHour(), which use Intl with America/Chicago.
 * All date math is on 'YYYY-MM-DD' strings via Date.UTC so the machine's
 * local timezone can never leak into a schedule.
 *
 * See SPEC.md §4 for the contract and docs/02-cadence.md for the plain-English
 * explanation of the rules.
 *
 * Consent states (consentState): 'given' (normal cadence), 'ask' (no consent
 * recorded and never asked: the next touch is a one-time ASK, touch 0),
 * 'asked' (ask went out, still waiting: nextTouch is null, nothing drafts),
 * 'dnc'. Events sentAsk / consentGiven / consentDeclined / askSkipped move a
 * customer between them; consentGiven restarts the ladder at touch 1 = date + 90.
 *
 * render() placeholders: {first} {name} {vehicle} {year} {make} {model}
 * {phone} {sale_year} {season} {hook|fallback} {referred|fallback}.
 * {referred} is the first name of the person a customer sent in (REFERRAL_THANKS):
 * it comes from opts.referred (or opts.referredName), else from
 * customer.pendingThanks.referredName. Anything the engine cannot fill renders
 * as [key] and is listed in the returned `missing` array.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.KIT = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = '1.2.0';

  var SLOTS = [
    'ASK',                 // one-time consent ask (touch 0) for anyone with no consent recorded
    'THANKS',              // touch 0
    'THANKS_REPEAT',       // touch 0 of a repeat purchase
    'VALUE',               // odd touches
    'CHECKIN',             // touches 2, 6, 10 ...
    'REFERRAL',            // touches 4, 8, 12 ...
    'ANNIVERSARY_REFERRAL',// a REFERRAL that lands within ±30 days of a sale anniversary
    'BIRTHDAY',            // any touch ≥ 1 within ±14 days of the birthday (displaces, carries)
    'REFERRAL_THANKS',     // immediate, out-of-cadence, does not consume a touch number
    'GOODBYE'              // opt-out confirmation
  ];

  var TOUCH0_OFFSET_DAYS = 3;
  var CADENCE_DAYS = 90;
  var BIRTHDAY_WINDOW_DAYS = 14;
  var ANNIVERSARY_WINDOW_DAYS = 30;
  var DEFAULT_MIN_GAP_DAYS = 21;
  var ASK_SKIP_DAYS = 90;
  var MS_PER_DAY = 86400000;

  // ---------------------------------------------------------------- dates

  function isYmd(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseYmd(ymd) {
    if (!isYmd(ymd)) throw new Error('KIT: bad date "' + ymd + '" (want YYYY-MM-DD)');
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
    return Date.UTC(y, m - 1, d);
  }

  function formatUtc(ms) {
    var dt = new Date(ms);
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }

  function addDays(ymd, n) {
    return formatUtc(parseYmd(ymd) + Math.round(n) * MS_PER_DAY);
  }

  // diffDays(a, b) = b - a in whole days.
  function diffDays(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / MS_PER_DAY);
  }

  function maxYmd(a, b) {
    if (!isYmd(a)) return b;
    if (!isYmd(b)) return a;
    return a >= b ? a : b;
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  // Build a YYYY-MM-DD from a year and an 'MM-DD'. Feb 29 in a non-leap year
  // becomes Feb 28. Returns null for garbage.
  function ymdFromMonthDay(year, mmdd) {
    if (typeof mmdd !== 'string' || !/^\d{2}-\d{2}$/.test(mmdd)) return null;
    var m = +mmdd.slice(0, 2), d = +mmdd.slice(3, 5);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (m === 2 && d === 29 && !isLeapYear(year)) d = 28;
    var dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (d > dim) d = dim;
    return year + '-' + pad2(m) + '-' + pad2(d);
  }

  function todayChicago() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var o = {};
    for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
    return o.year + '-' + o.month + '-' + o.day;
  }

  function nowChicagoHour() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23'
    }).formatToParts(new Date());
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour') return (+parts[i].value) % 24;
    }
    return 0;
  }

  function seasonFor(ymd) {
    var m = +String(ymd).slice(5, 7);
    if (m === 12 || m === 1 || m === 2) return 'winter';
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    return 'fall';
  }

  // ------------------------------------------------------------- cadence

  // 0 THANKS, odd VALUE, n%4==2 CHECKIN, n%4==0 REFERRAL
  function baseSlot(n) {
    if (n === 0) return 'THANKS';
    if (n % 2 === 1) return 'VALUE';
    return n % 4 === 2 ? 'CHECKIN' : 'REFERRAL';
  }

  // Due date for touch n. n==0: saleDate + 3. Otherwise anchorDate +
  // 90 * (n - anchorTouchN). If a min-gap floor was stored by a late 'sent'
  // event it applies to the very next touch (n === nextTouchN) only.
  function touchDate(customer, n) {
    if (!customer || !isYmd(customer.saleDate)) return null;
    var computed;
    if (n === 0) {
      computed = addDays(customer.saleDate, TOUCH0_OFFSET_DAYS);
    } else {
      var anchorDate = isYmd(customer.anchorDate) ? customer.anchorDate : customer.saleDate;
      var anchorN = typeof customer.anchorTouchN === 'number' ? customer.anchorTouchN : 0;
      computed = addDays(anchorDate, CADENCE_DAYS * (n - anchorN));
    }
    var nextN = typeof customer.nextTouchN === 'number' ? customer.nextTouchN : 0;
    if (n === nextN && isYmd(customer.floorDate) && customer.floorDate > computed) {
      return customer.floorDate;
    }
    return computed;
  }

  // Nearest occurrence of an 'MM-DD' birthday to dueDate: consider the
  // occurrence in dueDate's year and the years either side; return the
  // smallest absolute distance in days, or null if no valid birthday.
  function daysToBirthday(birthday, dueDate) {
    if (!birthday || !isYmd(dueDate)) return null;
    var year = +dueDate.slice(0, 4);
    var best = null;
    for (var y = year - 1; y <= year + 1; y++) {
      var occ = ymdFromMonthDay(y, birthday);
      if (!occ) return null;
      var d = Math.abs(diffDays(occ, dueDate));
      if (best === null || d < best) best = d;
    }
    return best;
  }

  // Distance in days from dueDate to the nearest sale anniversary (year 1, 2,
  // 3 ...; never the sale date itself). Feb 29 anniversaries fall on Feb 28 in
  // non-leap years. Returns { days, year } or null.
  function nearestAnniversary(saleDate, dueDate) {
    if (!isYmd(saleDate) || !isYmd(dueDate)) return null;
    var saleYear = +saleDate.slice(0, 4);
    var mmdd = saleDate.slice(5);
    var approx = Math.floor(diffDays(saleDate, dueDate) / 365);
    var best = null;
    for (var k = approx - 1; k <= approx + 1; k++) {
      if (k < 1) continue;
      var occ = ymdFromMonthDay(saleYear + k, mmdd);
      var d = Math.abs(diffDays(occ, dueDate));
      if (best === null || d < best.days) best = { days: d, year: k };
    }
    return best;
  }

  // Decide the slot for touch n on dueDate. Returns
  // { slot, carried, base, viaCredit, anniversaryYear }.
  //   carried    = a birthday note displaced `base`; the caller bumps slotOffset
  //   viaCredit  = a REFERRAL became VALUE because of referralCredit
  function resolveSlot(customer, n, dueDate) {
    var out = { slot: null, carried: false, base: null, viaCredit: false, anniversaryYear: 0 };
    if (n === 0) {
      var repeat = Array.isArray(customer.purchases) && customer.purchases.length > 1;
      out.slot = out.base = repeat ? 'THANKS_REPEAT' : 'THANKS';
      return out;
    }
    var offset = typeof customer.slotOffset === 'number' ? customer.slotOffset : 0;
    var k = n - offset;
    if (k < 1) k = 1;
    var effective = baseSlot(k);
    var viaCredit = false;
    if (effective === 'REFERRAL' && customer.referralCredit) {
      effective = 'VALUE';
      viaCredit = true;
    }
    if (effective === 'REFERRAL') {
      var ann = nearestAnniversary(customer.saleDate, dueDate);
      if (ann && ann.days <= ANNIVERSARY_WINDOW_DAYS) {
        effective = 'ANNIVERSARY_REFERRAL';
        out.anniversaryYear = ann.year;
      }
    }
    out.base = effective;
    if (customer.birthday) {
      var d = daysToBirthday(customer.birthday, dueDate);
      if (d !== null && d <= BIRTHDAY_WINDOW_DAYS) {
        out.slot = 'BIRTHDAY';
        out.carried = true;
        return out;
      }
    }
    out.slot = effective;
    out.viaCredit = viaCredit;
    return out;
  }

  // The message goes out on max(dueDate, today), so that is the season that
  // should drive the seasonal VALUE pool ("don't send an ice-scraper tip in July").
  function sendSeason(dueDate, today) {
    return seasonFor(isYmd(today) && today > dueDate ? today : dueDate);
  }

  // ------------------------------------------------------------- consent

  function consentOn(block) {
    return !!(block && block.given === true);
  }

  // 'given' | 'ask' | 'asked' | 'dnc'
  //   given: email or SMS consent recorded -> normal cadence
  //   ask:   active, no consent, never asked -> next touch is the one-time ASK
  //   asked: the ask went out, no answer yet -> nothing drafts until a yes
  function consentState(customer) {
    if (!customer || customer.status === 'dnc') return 'dnc';
    if (consentOn(customer.emailConsent) || consentOn(customer.smsConsent)) return 'given';
    return customer.consentAskedAt ? 'asked' : 'ask';
  }

  // The day the customer was entered, as YYYY-MM-DD: createdDate if present,
  // else the date part of createdAt, else today.
  function createdDateOf(customer, today) {
    if (isYmd(customer.createdDate)) return customer.createdDate;
    var iso = String(customer.createdAt || '');
    if (isYmd(iso.slice(0, 10))) return iso.slice(0, 10);
    return today;
  }

  // The ASK is due at sale + 3, but never before the day the customer was
  // entered: a buyer from five years ago is due today, not "1,800 days late".
  function askDueDate(customer, today) {
    return maxYmd(addDays(customer.saleDate, TOUCH0_OFFSET_DAYS), createdDateOf(customer, today));
  }

  // Yes-detection for a reply to the ask. Deliberately narrow: a clear yes
  // word in the first 80 characters and no "no / not / don't / rather not"
  // next to it, and never an opt-out. Mick confirms in the app anyway; the
  // inbound function uses it to record an email reply of "yes" on its own.
  var YES_RE = /\b(yes|yep|yeah|sure|ok|okay|fine|sounds good|go ahead|absolutely|you bet|that works|please do)\b/i;
  var NO_RE = /\b(no|nope|not|dont|do not|rather not|no thanks)\b/i;

  function isYesText(str) {
    if (typeof str !== 'string') return false;
    var head = str.slice(0, 80).replace(/[’']/g, '');
    if (!head.trim() || isOptOutText(head)) return false;
    if (NO_RE.test(head)) return false;
    return YES_RE.test(head);
  }

  function nextTouch(customer, today) {
    if (!customer || customer.status === 'dnc') return null;
    if (!isYmd(customer.saleDate)) return null;
    today = isYmd(today) ? today : todayChicago();
    var state = consentState(customer);
    if (state === 'asked') return null;
    var snoozedUntil = isYmd(customer.snoozedUntil) ? customer.snoozedUntil : '';
    var snoozed = !!snoozedUntil && snoozedUntil > today;
    var n, dueDate, r;
    if (state === 'ask') {
      n = 0;
      dueDate = askDueDate(customer, today);
      r = { slot: 'ASK', carried: false, base: 'ASK', viaCredit: false, anniversaryYear: 0 };
    } else {
      n = typeof customer.nextTouchN === 'number' ? customer.nextTouchN : 0;
      dueDate = touchDate(customer, n);
      r = resolveSlot(customer, n, dueDate);
    }
    var isLate = dueDate < today;
    return {
      n: n,
      dueDate: dueDate,
      slot: r.slot,
      carried: r.carried,
      base: r.base,
      viaCredit: r.viaCredit,
      anniversaryYear: r.anniversaryYear,
      isDue: dueDate <= today && !snoozed,
      isLate: isLate,
      daysLate: isLate ? diffDays(dueDate, today) : 0,
      snoozed: snoozed,
      snoozedUntil: snoozedUntil,
      season: sendSeason(dueDate, today),
      ask: state === 'ask'
    };
  }

  // Simulate the next `count` touches from the customer's current state,
  // applying birthday carries, credit consumption and the min-gap floor as it
  // goes. Each simulated touch is "sent" on max(dueDate, today).
  function previewTouches(customer, count, today) {
    count = typeof count === 'number' && count > 0 ? count : 8;
    today = isYmd(today) ? today : todayChicago();
    var sim = clone(customer);
    var out = [];
    for (var i = 0; i < count; i++) {
      var nt = nextTouch(sim, today);
      if (!nt) break;
      out.push({ n: nt.n, dueDate: nt.dueDate, slot: nt.slot, carried: nt.carried, season: nt.season });
      var sentDate = maxYmd(nt.dueDate, today);
      if (nt.slot === 'ASK') {
        // Simulate "they say yes the day the ask goes out": touch 1 = that day + 90.
        sim = applyEvent(sim, { type: 'consentGiven', date: sentDate, channel: 'email', how: 'preview' }, today);
      } else {
        sim = applyEvent(sim, { type: 'sent', n: nt.n, dueDate: nt.dueDate, sentDate: sentDate, channels: [] }, today);
      }
    }
    return out;
  }

  function byDueThenName(a, b) {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    var an = String(a.customer.name || ''), bn = String(b.customer.name || '');
    return an < bn ? -1 : an > bn ? 1 : 0;
  }

  // One item per active customer whose next touch is due, oldest first.
  function buildQueue(customers, today) {
    today = isYmd(today) ? today : todayChicago();
    var items = [];
    (customers || []).forEach(function (c) {
      var nt = nextTouch(c, today);
      if (!nt || !nt.isDue) return;
      items.push({
        customer: c,
        n: nt.n,
        dueDate: nt.dueDate,
        slot: nt.slot,
        carried: nt.carried,
        isLate: nt.isLate,
        daysLate: nt.daysLate,
        season: nt.season
      });
    });
    items.sort(byDueThenName);
    return items;
  }

  // Out-of-cadence REFERRAL_THANKS items (customer.pendingThanks set by the
  // referralReceived event, cleared by sentExtra or skippedExtra).
  function extraQueueItems(customers, today) {
    today = isYmd(today) ? today : todayChicago();
    var items = [];
    (customers || []).forEach(function (c) {
      if (!c || c.status === 'dnc' || !c.pendingThanks) return;
      var p = c.pendingThanks;
      items.push({
        customer: c,
        slot: 'REFERRAL_THANKS',
        extra: true,
        dueDate: isYmd(p.date) ? p.date : today,
        referredName: p.referredName || '',
        season: seasonFor(today)
      });
    });
    items.sort(byDueThenName);
    return items;
  }

  // ------------------------------------------------------------ templates

  function templatePool(library, overrides, slot, season) {
    var all = Array.isArray(library) ? library : (library && library.templates) || [];
    overrides = overrides || {};
    var live = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (!t || t.slot !== slot) continue;
      var ov = overrides[t.id];
      if (ov && ov.retired) continue;
      if (ov) {
        var merged = {};
        for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) merged[k] = t[k];
        if (typeof ov.subject === 'string') merged.subject = ov.subject;
        if (typeof ov.emailBody === 'string') merged.emailBody = ov.emailBody;
        if (typeof ov.textBody === 'string') merged.textBody = ov.textBody;
        merged.overridden = true;
        live.push(merged);
      } else {
        live.push(t);
      }
    }
    if (slot !== 'VALUE' || !season || season === 'any') return live;
    var seasonal = live.filter(function (t) { return t.season === season; });
    var anyPool = live.filter(function (t) { return !t.season || t.season === 'any'; });
    if (seasonal.length) return seasonal.concat(anyPool);
    if (anyPool.length) return anyPool;
    return live;
  }

  // Least-recently-used pick. Never-used templates first; among the used, the
  // one whose last use is oldest (position in usedTemplateIds, chronological).
  // Ties (only possible among never-used) are broken by id sort, then rotated
  // by `seed` so two customers don't always start on the same template.
  function pickTemplate(pool, usedTemplateIds, seed) {
    if (!Array.isArray(pool) || pool.length === 0) return null;
    var used = Array.isArray(usedTemplateIds) ? usedTemplateIds : [];
    var s = 0;
    if (typeof seed === 'number' && isFinite(seed)) s = Math.abs(Math.floor(seed));
    else if (typeof seed === 'string') for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    var ranked = pool.map(function (t) {
      return { t: t, last: used.lastIndexOf(t.id) };
    });
    ranked.sort(function (a, b) {
      if (a.last !== b.last) return a.last - b.last;
      return a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0;
    });
    var best = ranked[0].last;
    var ties = ranked.filter(function (r) { return r.last === best; });
    return ties[s % ties.length].t;
  }

  // ---------------------------------------------------------------- render

  var SIGNOFF = {
    mick: '\n\nMick\nNorth Star Car Guy\n{phone}',
    ella: '\n\nElla, for Mick\nNorth Star Car Guy\n{phone}'
  };
  var STOP_LINE = ' Reply STOP to opt out.';

  function vehicleLabel(customer) {
    if (customer.vehicleLabel) return String(customer.vehicleLabel).trim();
    var v = customer.vehicle || {};
    return [v.year, v.model].filter(function (x) { return x !== undefined && x !== null && x !== ''; }).join(' ').trim();
  }

  function placeholderValues(customer, settings, opts) {
    customer = customer || {};
    settings = settings || {};
    opts = opts || {};
    var v = customer.vehicle || {};
    var name = String(customer.name || '').trim();
    var first = String(customer.first || '').trim() || name.split(/\s+/)[0] || '';
    var season = opts.season || seasonFor(isYmd(opts.date) ? opts.date : todayChicago());
    var referred = opts.referred || opts.referredName || (customer.pendingThanks && customer.pendingThanks.referredName) || '';
    return {
      first: first,
      name: name,
      vehicle: vehicleLabel(customer),
      year: v.year === undefined || v.year === null ? '' : String(v.year),
      make: v.make || '',
      model: v.model || '',
      hook: String(customer.hook || '').trim(),
      phone: settings.mickPhoneDisplay || settings.mickPhone || '',
      sale_year: isYmd(customer.saleDate) ? customer.saleDate.slice(0, 4) : '',
      season: season,
      referred: String(referred).trim()
    };
  }

  // {name} → value; {name|fallback} → value or fallback; anything the engine
  // cannot fill renders as [name] so it is visible before sending.
  function fill(str, values, missing) {
    return String(str || '').replace(/\{([a-z_]+)(?:\|([^}]*))?\}/g, function (m, key, fallback) {
      var known = Object.prototype.hasOwnProperty.call(values, key);
      var val = known ? values[key] : '';
      if (val) return val;
      if (fallback !== undefined) return fallback;
      if (missing.indexOf(key) === -1) missing.push(key);
      return '[' + key + ']';
    });
  }

  function render(template, customer, settings, opts) {
    template = template || {};
    settings = settings || {};
    opts = opts || {};
    var values = placeholderValues(customer, settings, opts);
    var missing = [];
    var subject = fill(template.subject, values, missing);
    var emailBody = fill(template.emailBody, values, missing);
    var textBody = fill(template.textBody, values, missing);
    var sender = opts.sender === 'ella' ? 'ella' : (opts.sender === 'mick' ? 'mick' : (settings.senderMode === 'ella' ? 'ella' : 'mick'));
    var signoff = fill(SIGNOFF[sender], values, missing);
    var emailFull = emailBody + signoff + (opts.footer ? '\n\n' + opts.footer : '');
    var textFull = textBody;
    if (opts.firstText && template.slot !== 'GOODBYE') textFull += STOP_LINE;
    return {
      subject: subject,
      emailBody: emailBody,
      textBody: textBody,
      emailFull: emailFull,
      textFull: textFull,
      sender: sender,
      missing: missing
    };
  }

  // ---------------------------------------------------------------- events

  function clone(obj) {
    return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
  }

  function pushUsed(c, templateId) {
    if (!templateId) return;
    if (!Array.isArray(c.usedTemplateIds)) c.usedTemplateIds = [];
    c.usedTemplateIds.push(templateId);
  }

  // After an actual send on sentDate: if the next touch computes earlier than
  // sentDate + minGapDays, store floorDate so it is never sooner than that.
  function applyFloor(c, sentDate, minGapDays) {
    c.floorDate = '';
    if (!isYmd(sentDate)) return;
    var gap = typeof minGapDays === 'number' && minGapDays >= 0 ? minGapDays : DEFAULT_MIN_GAP_DAYS;
    var floor = addDays(sentDate, gap);
    var nextDate = touchDate(c, c.nextTouchN);
    if (nextDate && nextDate < floor) c.floorDate = floor;
  }

  // Returns a NEW customer object; never mutates the input.
  function applyEvent(customer, event, today) {
    var c = clone(customer) || {};
    event = event || {};
    today = isYmd(today) ? today : (isYmd(event.today) ? event.today : todayChicago());
    var n, dueDate, r;
    switch (event.type) {
      case 'sent': {
        n = typeof event.n === 'number' ? event.n : (c.nextTouchN || 0);
        dueDate = isYmd(event.dueDate) ? event.dueDate : touchDate(c, n);
        r = resolveSlot(c, n, dueDate);
        var sentDate = isYmd(event.sentDate) ? event.sentDate : today;
        c.nextTouchN = n + 1;
        c.lastSentDate = sentDate;
        if (event.sentAt) c.lastSentAt = event.sentAt;
        c.snoozedUntil = '';
        pushUsed(c, event.templateId);
        if (r.carried) c.slotOffset = (c.slotOffset || 0) + 1;
        if (r.viaCredit) c.referralCredit = false;
        if (Array.isArray(event.channels) && event.channels.indexOf('sms') !== -1 && !c.firstTextSentAt) {
          c.firstTextSentAt = event.sentAt || sentDate;
        }
        applyFloor(c, sentDate, event.minGapDays);
        break;
      }
      case 'skipped': {
        n = typeof event.n === 'number' ? event.n : (c.nextTouchN || 0);
        dueDate = isYmd(event.dueDate) ? event.dueDate : touchDate(c, n);
        r = resolveSlot(c, n, dueDate);
        c.nextTouchN = n + 1;
        c.snoozedUntil = '';
        c.floorDate = '';
        if (r.carried) c.slotOffset = (c.slotOffset || 0) + 1;
        break;
      }
      case 'sentExtra': {
        // Out-of-cadence REFERRAL_THANKS actually went out: clear the pending
        // item, record the send, and apply the min-gap floor (it was a real note).
        c.pendingThanks = null;
        var xDate = isYmd(event.sentDate) ? event.sentDate : today;
        c.lastSentDate = xDate;
        if (event.sentAt) c.lastSentAt = event.sentAt;
        pushUsed(c, event.templateId);
        if (Array.isArray(event.channels) && event.channels.indexOf('sms') !== -1 && !c.firstTextSentAt) {
          c.firstTextSentAt = event.sentAt || xDate;
        }
        applyFloor(c, xDate, event.minGapDays);
        break;
      }
      case 'skippedExtra': {
        // Out-of-cadence REFERRAL_THANKS was skipped: clear the pending item.
        // Nothing went out, so no lastSentDate and no min-gap floor.
        c.pendingThanks = null;
        break;
      }
      case 'snoozed': {
        var from = isYmd(event.today) ? event.today : today;
        c.snoozedUntil = addDays(from, typeof event.days === 'number' ? event.days : 7);
        break;
      }
      case 'reply': {
        var date = isYmd(event.date) ? event.date : today;
        c.anchorDate = date;
        c.anchorTouchN = Math.max(0, (c.nextTouchN || 0) - 1);
        c.snoozedUntil = '';
        c.floorDate = '';
        c.lastReplyDate = date;
        if (event.at) c.lastReplyAt = event.at;
        break;
      }
      case 'referralReceived': {
        c.referralCredit = true;
        c.pendingThanks = {
          date: isYmd(event.date) ? event.date : today,
          referredName: event.referredName || ''
        };
        break;
      }
      case 'optOut': {
        c.status = 'dnc';
        c.dnc = {
          at: event.at || '',
          reason: event.reason || '',
          channel: event.channel || 'both'
        };
        c.snoozedUntil = '';
        c.pendingThanks = null;
        break;
      }
      case 'dncClear': {
        c.status = 'active';
        c.dnc = null;
        break;
      }
      case 'sentAsk': {
        // The one-time consent ask went out (touch 0, slot ASK). Nothing else
        // drafts until consentGiven (or consentDeclined) is applied.
        var askDate = isYmd(event.sentDate) ? event.sentDate : today;
        var askChannels = Array.isArray(event.channels) ? event.channels.slice() : [];
        c.consentAskedAt = event.sentAt || (askDate + 'T12:00:00.000Z');
        c.consentAskDate = askDate;
        c.consentAskChannels = askChannels;
        c.consentAskSkippedAt = '';
        c.lastSentDate = askDate;
        if (event.sentAt) c.lastSentAt = event.sentAt;
        c.snoozedUntil = '';
        pushUsed(c, event.templateId);
        if (askChannels.indexOf('sms') !== -1 && !c.firstTextSentAt) {
          c.firstTextSentAt = event.sentAt || askDate;
        }
        break;
      }
      case 'askSkipped': {
        // "Not now": hide the ask for 90 days. Nothing went out, nothing changes
        // on the ladder; the customer stays in the 'ask' state.
        var skipFrom = isYmd(event.today) ? event.today : today;
        c.consentAskSkippedAt = event.at || (skipFrom + 'T12:00:00.000Z');
        c.snoozedUntil = addDays(skipFrom, typeof event.days === 'number' ? event.days : ASK_SKIP_DAYS);
        break;
      }
      case 'consentGiven': {
        // They said yes (to the ask, or in person, or on the phone). Records
        // consent on the named channel(s) and restarts the ladder: the ask
        // served as touch 0, so touch 1 (VALUE) is due 90 days after the yes.
        var yesDate = isYmd(event.date) ? event.date : today;
        var yesAt = event.at || (yesDate + 'T12:00:00.000Z');
        var how = event.how || '';
        var chan = event.channel === 'sms' || event.channel === 'both' || event.channel === 'email' ? event.channel : 'email';
        if (chan === 'email' || chan === 'both') c.emailConsent = { given: true, at: yesAt, how: how };
        if (chan === 'sms' || chan === 'both') c.smsConsent = { given: true, at: yesAt, how: how };
        c.consentGivenDate = yesDate;
        c.anchorDate = yesDate;
        c.anchorTouchN = 0;
        c.nextTouchN = 1;
        c.floorDate = '';
        c.snoozedUntil = '';
        c.consentAskSkippedAt = '';
        break;
      }
      case 'consentDeclined': {
        // They said no to the ask: do-not-contact on both channels.
        c.status = 'dnc';
        c.dnc = {
          at: event.at || ((isYmd(event.date) ? event.date : today) + 'T12:00:00.000Z'),
          reason: event.reason || 'declined ask',
          channel: event.channel || 'both'
        };
        c.snoozedUntil = '';
        c.pendingThanks = null;
        break;
      }
      case 'repeatPurchase': {
        var sale = isYmd(event.saleDate) ? event.saleDate : today;
        var veh = event.vehicle || c.vehicle || {};
        var label = event.vehicleLabel || [veh.year, veh.model].filter(Boolean).join(' ');
        if (!Array.isArray(c.purchases)) c.purchases = [];
        if (c.purchases.length === 0 && isYmd(c.saleDate)) {
          c.purchases.push({ saleDate: c.saleDate, vehicle: c.vehicle || {}, vehicleLabel: c.vehicleLabel || '' });
        }
        c.purchases.push({ saleDate: sale, vehicle: veh, vehicleLabel: label });
        c.saleDate = sale;
        c.anchorDate = sale;
        c.anchorTouchN = 0;
        c.nextTouchN = 0;
        c.slotOffset = 0;
        c.vehicle = veh;
        c.vehicleLabel = label;
        c.status = 'active';
        c.dnc = null;
        c.snoozedUntil = '';
        c.floorDate = '';
        break;
      }
      default:
        throw new Error('KIT.applyEvent: unknown event type "' + event.type + '"');
    }
    return c;
  }

  // -------------------------------------------------------------- opt-out

  /*
   * isOptOutText rule (deliberately stricter than "keyword anywhere", because a
   * false positive silently loses a customer while a false negative just means
   * Mick reads the reply himself):
   *
   *   Look at the first 80 characters, case-insensitive.
   *   1. Any of these phrases anywhere → opt-out: unsubscribe, opt out / opt-out
   *      / optout, remove me, take me off, do not contact / don't contact,
   *      stop these / end these / cancel these, quit sending, stop all,
   *      do not text / don't text, do not email / don't email, stop texting /
   *      stop emailing / stop messaging / stop contacting, no more texts /
   *      emails / messages, leave me alone.
   *   2. The FIRST word is a keyword (stop, quit, cancel, end, unsubscribe) and
   *      it is followed by punctuation or the end of the message → opt-out.
   *      "STOP", "Stop!!", "Stop, I don't want these" match; "Stop by the lot
   *      Friday" and "End of the month works" do not.
   *   3. The message is three words or fewer, contains a keyword as a whole
   *      word, and every other word is filler (please, now, it, me, all, thanks,
   *      ok, texts, emails ...) → opt-out. "please stop", "stop it", "stop
   *      sending texts" match; "the stop sign" does not.
   *   Otherwise not an opt-out. "I stopped by the lot" never matches: 'stopped'
   *   is a different word.
   */
  var OPTOUT_PHRASES = [
    'unsubscribe', 'opt out', 'opt-out', 'optout', 'remove me', 'take me off',
    'do not contact', 'dont contact', 'do not text', 'dont text', 'do not email', 'dont email',
    'do not message', 'dont message', 'stop texting', 'stop emailing', 'stop messaging',
    'stop contacting', 'stop sending', 'no more texts', 'no more emails', 'no more messages',
    'leave me alone', 'stop these', 'end these', 'cancel these', 'quit sending', 'stop all',
    'stop the emails', 'stop the texts', 'end the emails', 'end the texts'
  ];
  var OPTOUT_KEYWORDS = ['stop', 'quit', 'cancel', 'end', 'unsubscribe'];
  var OPTOUT_FILLER = ['please', 'pls', 'plz', 'now', 'it', 'this', 'these', 'me', 'all', 'thanks',
    'thank', 'you', 'ok', 'okay', 'yes', 'just', 'texts', 'text', 'emails', 'email', 'messages',
    'msgs', 'sending', 'them', 'the', 'to', 'my', 'number', 'contacting', 'texting', 'emailing'];

  function isOptOutText(str) {
    if (typeof str !== 'string') return false;
    var head = str.slice(0, 80).toLowerCase().replace(/[’']/g, '');
    var norm = head.replace(/[^a-z]+/g, ' ').trim();
    if (!norm) return false;
    for (var i = 0; i < OPTOUT_PHRASES.length; i++) {
      var p = OPTOUT_PHRASES[i].replace(/[^a-z]+/g, ' ');
      if ((' ' + norm + ' ').indexOf(' ' + p + ' ') !== -1) return true;
    }
    // Rule 2: first word is a keyword, followed by end-of-message, a newline,
    // or punctuation (a bare space followed by another word does NOT count,
    // so "Stop by the lot Friday" is a visit, not an opt-out).
    var lead = head.trim().match(/^([a-z]+)([\s\S]*)$/);
    if (lead && OPTOUT_KEYWORDS.indexOf(lead[1]) !== -1 && /^(\s*$|[ \t]*[^a-z0-9\s]|[ \t]*\r?\n)/.test(lead[2])) return true;
    var words = norm.split(' ');
    if (words.length <= 3) {
      var hasKeyword = false, allFiller = true;
      for (var w = 0; w < words.length; w++) {
        if (OPTOUT_KEYWORDS.indexOf(words[w]) !== -1) hasKeyword = true;
        else if (OPTOUT_FILLER.indexOf(words[w]) === -1) allFiller = false;
      }
      if (hasKeyword && allFiller) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- export

  return {
    VERSION: VERSION,
    SLOTS: SLOTS,
    CADENCE_DAYS: CADENCE_DAYS,
    DEFAULT_MIN_GAP_DAYS: DEFAULT_MIN_GAP_DAYS,
    todayChicago: todayChicago,
    nowChicagoHour: nowChicagoHour,
    isYmd: isYmd,
    addDays: addDays,
    diffDays: diffDays,
    seasonFor: seasonFor,
    baseSlot: baseSlot,
    touchDate: touchDate,
    resolveSlot: resolveSlot,
    daysToBirthday: daysToBirthday,
    nearestAnniversary: nearestAnniversary,
    consentState: consentState,
    askDueDate: askDueDate,
    isYesText: isYesText,
    nextTouch: nextTouch,
    previewTouches: previewTouches,
    buildQueue: buildQueue,
    extraQueueItems: extraQueueItems,
    pickTemplate: pickTemplate,
    templatePool: templatePool,
    render: render,
    applyEvent: applyEvent,
    isOptOutText: isOptOutText
  };
});

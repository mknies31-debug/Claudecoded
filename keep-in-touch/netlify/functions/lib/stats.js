/*
 * stats.js — attribution math for North Star Keep-In-Touch (Agent 5).
 *
 * UMD: `const STATS = require('./lib/stats.js')` in Node, `window.STATS` when
 * inlined into index.html. Pure functions over plain arrays. No I/O, no
 * dependencies. Dates are YYYY-MM-DD strings (America/Chicago); record
 * timestamps (createdAt, receivedAt, ...) are ISO-8601 and are converted to a
 * Chicago calendar date before any comparison.
 *
 * Contract (SPEC §8):
 *   replyRateBySlot(touches, replies)       -> [{slot, sent, replied, rate}]
 *   replyRateByTemplate(touches, replies)   -> [{templateId, slot, sent, replied, rate, retire}]
 *   referralsByCustomer(customers)          -> [{customerId, name, referred:[{id,name,saleDate}]}] desc by count
 *   monthly(customers, touches, today)      -> [{month, referrals, repeats, sent}] last 12 months, oldest first
 *   referralsBySlot(customers, touches)     -> [{slot, referrals}] via attributedTouchId ("unattributed" when unknown)
 *   suggestAttributedTouch(referrerId, touches, today) -> touchId | ""  (latest sent to referrer within 60 days)
 *   attributeReply(reply, touches)          -> touch | null  (touchId match, else latest sent touch <= receivedDate within 45 days)
 *   summary(customers, touches, replies, today, opts) -> dashboard strip numbers
 *
 * Attribution windows: REPLY_WINDOW_DAYS = 45, REFERRAL_WINDOW_DAYS = 60.
 * Retire rule: a template with sent >= 8 and rate < 0.05 gets retire: true.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STATS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REPLY_WINDOW_DAYS = 45;
  var REFERRAL_WINDOW_DAYS = 60;
  var RETIRE_MIN_SENT = 8;
  var RETIRE_MAX_RATE = 0.05;
  var SLOT_ORDER = ['THANKS', 'THANKS_REPEAT', 'VALUE', 'CHECKIN', 'REFERRAL',
    'ANNIVERSARY_REFERRAL', 'BIRTHDAY', 'REFERRAL_THANKS', 'GOODBYE'];

  // ---------- date helpers (pure calendar math) ----------

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isYmd(s) {
    return typeof s === 'string' && YMD_RE.test(s);
  }

  // ISO timestamp -> YYYY-MM-DD in America/Chicago. Falls back to the first 10
  // chars if Intl is unavailable or the string is not parseable.
  function chicagoDate(iso) {
    if (isYmd(iso)) return iso;
    if (typeof iso !== 'string' || !iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return isYmd(iso.slice(0, 10)) ? iso.slice(0, 10) : '';
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);
      var o = {};
      for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
      return o.year + '-' + o.month + '-' + o.day;
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function dayNum(ymd) {
    var p = ymd.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }

  // b - a in days
  function diffDays(a, b) {
    return dayNum(b) - dayNum(a);
  }

  function monthOf(ymd) {
    return ymd ? ymd.slice(0, 7) : '';
  }

  function addMonths(yyyymm, n) {
    var y = +yyyymm.slice(0, 4);
    var m = +yyyymm.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1);
  }

  function todayFallback() {
    return chicagoDate(new Date().toISOString());
  }

  function arr(x) {
    return Array.isArray(x) ? x : [];
  }

  function touchIdOf(t) {
    return (t && (t.id || t.touchId)) || '';
  }

  function isSent(t) {
    return !!t && t.status === 'sent' && isYmd(t.sentDate);
  }

  function slotRank(slot) {
    var i = SLOT_ORDER.indexOf(slot);
    return i < 0 ? SLOT_ORDER.length : i;
  }

  // Latest sent touch (by sentDate, then sentAt) satisfying pred.
  function latestSent(touches, pred) {
    var best = null;
    for (var i = 0; i < touches.length; i++) {
      var t = touches[i];
      if (!isSent(t) || !pred(t)) continue;
      if (!best) { best = t; continue; }
      if (t.sentDate > best.sentDate ||
          (t.sentDate === best.sentDate && String(t.sentAt || '') > String(best.sentAt || ''))) {
        best = t;
      }
    }
    return best;
  }

  // ---------- attribution ----------

  // A reply belongs to the touch named by reply.touchId when that touch exists.
  // Otherwise: the customer's most recent SENT touch with sentDate <= receivedDate
  // and no more than REPLY_WINDOW_DAYS earlier. Returns the touch object or null.
  function attributeReply(reply, touches) {
    if (!reply) return null;
    var list = arr(touches);
    if (reply.touchId) {
      for (var i = 0; i < list.length; i++) {
        if (touchIdOf(list[i]) === reply.touchId) return list[i];
      }
    }
    var received = chicagoDate(reply.receivedDate || reply.receivedAt || '');
    if (!isYmd(received)) return null;
    var cid = reply.customerId || '';
    return latestSent(list, function (t) {
      if (cid && t.customerId !== cid) return false;
      var d = diffDays(t.sentDate, received);
      return d >= 0 && d <= REPLY_WINDOW_DAYS;
    });
  }

  // Set of touch ids that received at least one reply.
  function repliedTouchIds(touches, replies) {
    var set = {};
    var list = arr(replies);
    for (var i = 0; i < list.length; i++) {
      var t = attributeReply(list[i], touches);
      if (t) set[touchIdOf(t)] = true;
    }
    return set;
  }

  function rateRows(touches, replies, keyFn, decorate) {
    var sentList = arr(touches).filter(isSent);
    var replied = repliedTouchIds(sentList, replies);
    var groups = {};
    var order = [];
    for (var i = 0; i < sentList.length; i++) {
      var t = sentList[i];
      var key = keyFn(t);
      if (!groups[key]) { groups[key] = { sent: 0, replied: 0, sample: t }; order.push(key); }
      groups[key].sent += 1;
      if (replied[touchIdOf(t)]) groups[key].replied += 1;
    }
    return order.map(function (key) {
      var g = groups[key];
      var row = decorate(key, g.sample);
      row.sent = g.sent;
      row.replied = g.replied;
      row.rate = g.sent ? g.replied / g.sent : 0;
      return row;
    });
  }

  function replyRateBySlot(touches, replies) {
    var rows = rateRows(touches, replies,
      function (t) { return t.slot || ''; },
      function (key) { return { slot: key }; });
    rows.sort(function (a, b) {
      return slotRank(a.slot) - slotRank(b.slot) || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
    });
    return rows;
  }

  function replyRateByTemplate(touches, replies) {
    var rows = rateRows(touches, replies,
      function (t) { return t.templateId || ''; },
      function (key, sample) { return { templateId: key, slot: sample.slot || '' }; });
    for (var i = 0; i < rows.length; i++) {
      rows[i].retire = rows[i].sent >= RETIRE_MIN_SENT && rows[i].rate < RETIRE_MAX_RATE;
    }
    rows.sort(function (a, b) {
      return b.sent - a.sent || (a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0);
    });
    return rows;
  }

  // ---------- referrals ----------

  function customerIdOf(c) {
    return (c && (c.id || c.customerId)) || '';
  }

  function referralsByCustomer(customers) {
    var list = arr(customers);
    var byId = {};
    var i;
    for (i = 0; i < list.length; i++) byId[customerIdOf(list[i])] = list[i];
    var groups = {};
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.referredBy) continue;
      var ref = byId[c.referredBy];
      if (!groups[c.referredBy]) {
        groups[c.referredBy] = {
          customerId: c.referredBy,
          name: ref ? (ref.name || '') : (c.referredByName || ''),
          referred: []
        };
      }
      groups[c.referredBy].referred.push({
        id: customerIdOf(c),
        name: c.name || '',
        saleDate: c.saleDate || ''
      });
    }
    var rows = Object.keys(groups).map(function (k) { return groups[k]; });
    for (i = 0; i < rows.length; i++) {
      rows[i].referred.sort(function (a, b) { return a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0; });
    }
    rows.sort(function (a, b) {
      return b.referred.length - a.referred.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return rows;
  }

  function referredDate(c) {
    // Month a referral "came in" = when the referred customer was added.
    return chicagoDate(c.createdAt || '') || (isYmd(c.saleDate) ? c.saleDate : '');
  }

  // Repeat purchases = every purchase after the first.
  function repeatDates(c) {
    var out = [];
    var p = arr(c && c.purchases);
    for (var i = 1; i < p.length; i++) {
      if (p[i] && isYmd(p[i].saleDate)) out.push(p[i].saleDate);
    }
    return out;
  }

  function monthly(customers, touches, today) {
    var t = isYmd(today) ? today : todayFallback();
    var months = [];
    var index = {};
    var cur = monthOf(t);
    for (var k = 11; k >= 0; k--) {
      var m = addMonths(cur, -k);
      index[m] = months.length;
      months.push({ month: m, referrals: 0, repeats: 0, sent: 0 });
    }
    var i, j, m2;
    var cs = arr(customers);
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (!c) continue;
      if (c.referredBy) {
        m2 = monthOf(referredDate(c));
        if (index[m2] !== undefined) months[index[m2]].referrals += 1;
      }
      var reps = repeatDates(c);
      for (j = 0; j < reps.length; j++) {
        m2 = monthOf(reps[j]);
        if (index[m2] !== undefined) months[index[m2]].repeats += 1;
      }
    }
    var ts = arr(touches);
    for (i = 0; i < ts.length; i++) {
      if (!isSent(ts[i])) continue;
      m2 = monthOf(ts[i].sentDate);
      if (index[m2] !== undefined) months[index[m2]].sent += 1;
    }
    return months;
  }

  function referralsBySlot(customers, touches) {
    var slotOf = {};
    var ts = arr(touches);
    var i;
    for (i = 0; i < ts.length; i++) {
      var id = touchIdOf(ts[i]);
      if (id) slotOf[id] = ts[i].slot || '';
    }
    var counts = {};
    var cs = arr(customers);
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (!c || !c.referredBy) continue;
      var slot = (c.attributedTouchId && slotOf[c.attributedTouchId]) || 'unattributed';
      counts[slot] = (counts[slot] || 0) + 1;
    }
    var rows = Object.keys(counts).map(function (s) { return { slot: s, referrals: counts[s] }; });
    rows.sort(function (a, b) {
      if (a.slot === 'unattributed') return 1;
      if (b.slot === 'unattributed') return -1;
      return b.referrals - a.referrals || slotRank(a.slot) - slotRank(b.slot);
    });
    return rows;
  }

  // Most recent sent touch to the referrer within REFERRAL_WINDOW_DAYS before today.
  function suggestAttributedTouch(referrerId, touches, today) {
    if (!referrerId) return '';
    var t = isYmd(today) ? today : todayFallback();
    var best = latestSent(arr(touches), function (x) {
      if (x.customerId !== referrerId) return false;
      var d = diffDays(x.sentDate, t);
      return d >= 0 && d <= REFERRAL_WINDOW_DAYS;
    });
    return best ? touchIdOf(best) : '';
  }

  // ---------- dashboard strip ----------

  function withinLast(dateYmd, today, days) {
    if (!isYmd(dateYmd)) return false;
    var d = diffDays(dateYmd, today);
    return d >= 0 && d < days;
  }

  function resolveEngine(opts) {
    if (opts && opts.engine) return opts.engine;
    if (typeof KIT !== 'undefined' && KIT && typeof KIT.buildQueue === 'function') return KIT; // eslint-disable-line no-undef
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./engine.js'); } catch (e) { /* engine not present */ }
    }
    return null;
  }

  // opts.engine (KIT) or opts.dueToday can be supplied; otherwise the engine is
  // looked up (window.KIT / require('./engine.js')) and dueToday is 0 if absent.
  function summary(customers, touches, replies, today, opts) {
    var t = isYmd(today) ? today : todayFallback();
    var cs = arr(customers), ts = arr(touches), rs = arr(replies);
    var out = { active: 0, dnc: 0, dueToday: 0, sentLast30: 0, repliesLast30: 0, referralsLast90: 0, repeatsLast365: 0 };
    var i, j;
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (!c) continue;
      if (c.status === 'dnc') out.dnc += 1; else out.active += 1;
      if (c.referredBy && withinLast(referredDate(c), t, 90)) out.referralsLast90 += 1;
      var reps = repeatDates(c);
      for (j = 0; j < reps.length; j++) if (withinLast(reps[j], t, 365)) out.repeatsLast365 += 1;
    }
    for (i = 0; i < ts.length; i++) {
      if (isSent(ts[i]) && withinLast(ts[i].sentDate, t, 30)) out.sentLast30 += 1;
    }
    for (i = 0; i < rs.length; i++) {
      if (rs[i] && withinLast(chicagoDate(rs[i].receivedDate || rs[i].receivedAt || ''), t, 30)) out.repliesLast30 += 1;
    }
    if (opts && typeof opts.dueToday === 'number') {
      out.dueToday = opts.dueToday;
    } else {
      var engine = resolveEngine(opts);
      if (engine) {
        try {
          var q = engine.buildQueue(cs, t) || [];
          var extra = typeof engine.extraQueueItems === 'function' ? (engine.extraQueueItems(cs, t) || []) : [];
          out.dueToday = q.length + extra.length;
        } catch (e) { out.dueToday = 0; }
      }
    }
    return out;
  }

  return {
    REPLY_WINDOW_DAYS: REPLY_WINDOW_DAYS,
    REFERRAL_WINDOW_DAYS: REFERRAL_WINDOW_DAYS,
    RETIRE_MIN_SENT: RETIRE_MIN_SENT,
    RETIRE_MAX_RATE: RETIRE_MAX_RATE,
    SLOT_ORDER: SLOT_ORDER.slice(),
    chicagoDate: chicagoDate,
    diffDays: diffDays,
    attributeReply: attributeReply,
    replyRateBySlot: replyRateBySlot,
    replyRateByTemplate: replyRateByTemplate,
    referralsByCustomer: referralsByCustomer,
    monthly: monthly,
    referralsBySlot: referralsBySlot,
    suggestAttributedTouch: suggestAttributedTouch,
    summary: summary
  };
});

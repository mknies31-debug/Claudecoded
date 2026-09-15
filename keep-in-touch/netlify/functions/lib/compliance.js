/*
 * compliance.js — Keep-In-Touch (Agent 4 — Compliance)
 *
 * Footer / consent text + opt-out detection. UMD: CommonJS `module.exports`
 * in Node, `window.COMPLIANCE` in the browser when inlined. Pure functions,
 * no I/O, zero dependencies. Contract: SPEC.md §7.
 *
 * Customer-facing rules honored here (SPEC §0): sign-off is Mick / Mosaic
 * Autos; Mick is a salesperson, never the owner; no exclamation points; no
 * superlatives; the brand name never appears in customer-facing text.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.COMPLIANCE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Fixed strings                                                       */
  /* ------------------------------------------------------------------ */

  // Appended to the FIRST text only (engine: customer.firstTextSentAt empty).
  var smsOptOutLine = 'Reply STOP to opt out.';

  // Values for customer.emailConsent.how / smsConsent.how (SPEC §3).
  var consentHowOptions = ['in person at sale', 'phone', 'text', 'email', 'web form'];

  // Exact checkbox wording shown in Add Customer (docs/04-compliance.md §b).
  // Each is ≤ 25 words, plain, and matches what the customer is agreeing to.
  var consentLabels = {
    email: 'Okay for Mick at Mosaic Autos to email me a few times a year with tips and a hello. I can stop anytime.',
    sms: 'Okay for Mick to text me from his own phone now and then. Reply STOP to end texts. Message and data rates may apply.'
  };

  var OPT_OUT_RULE =
    'Look at the first 80 characters, case-insensitive. Opt-out is TRUE if (1) a clear ' +
    'phrase appears anywhere (unsubscribe, opt out, remove me, take me off, do not contact, ' +
    'do not text/email/message, stop texting/emailing/messaging/contacting/sending, no more ' +
    'texts/emails/messages, leave me alone); or (2) the FIRST word is stop, quit, cancel, end ' +
    'or unsubscribe and it is followed by punctuation, a line break or the end of the message ' +
    '("STOP", "Stop!!", "Stop, I do not want these" match; "Stop by the lot Friday" does not); ' +
    'or (3) the message is three words or fewer, contains one of those keywords as a whole ' +
    'word, and every other word is filler (please, it, now, texts...). Otherwise FALSE. ' +
    'A false positive silently loses a customer; a false negative means Mick reads the reply ' +
    'himself and taps do-not-contact. Same rule as engine.js, kept identical.';

  /* ------------------------------------------------------------------ */
  /* Email footer                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Plain-text footer appended to every email. ≤ 5 lines, starts with "--".
   * The physical address is ALWAYS printed, even when it is empty or still a
   * "[VERIFY]" placeholder — the app must never silently drop the address;
   * the Auditor / deploy checklist catches an unverified one.
   */
  function emailFooter(settings, unsubscribeUrl) {
    var s = settings || {};
    var address = String(s.businessAddress == null ? '' : s.businessAddress).trim();
    var url = String(unsubscribeUrl == null ? '' : unsubscribeUrl).trim();
    var lines = [
      '--',
      "You're getting this because you bought a vehicle from me, Mick, a salesperson at Mosaic Autos, " +
        'and said it was okay for me to keep in touch. These are my own words, written and approved by me ' +
        'ahead of time and sent on a schedule.',
      "Don't want these? One tap and you're off: " + url,
      'Mosaic Autos · ' + address
    ];
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Consent gates                                                       */
  /* ------------------------------------------------------------------ */

  function isActive(c) {
    return !!c && c.status === 'active';
  }

  function consentGiven(block) {
    return !!(block && block.given === true);
  }

  function hasEmail(c) {
    var e = c && typeof c.email === 'string' ? c.email.trim() : '';
    return e.length > 3 && e.indexOf('@') > 0;
  }

  function hasPhone(c) {
    var p = c && c.phone != null ? String(c.phone).replace(/\D/g, '') : '';
    return p.length >= 10;
  }

  /** active && emailConsent.given && email present */
  function canEmail(customer) {
    return isActive(customer) && consentGiven(customer.emailConsent) && hasEmail(customer);
  }

  /** active && smsConsent.given && phone present */
  function canText(customer) {
    return isActive(customer) && consentGiven(customer.smsConsent) && hasPhone(customer);
  }

  /* ------------------------------------------------------------------ */
  /* Consent summary                                                     */
  /* ------------------------------------------------------------------ */

  function ymd(iso) {
    var s = iso == null ? '' : String(iso);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }

  function describe(label, block) {
    if (!consentGiven(block)) return label + ': no';
    var parts = [];
    if (block.how) parts.push(String(block.how));
    var d = ymd(block.at);
    if (d) parts.push(d);
    return label + ': yes' + (parts.length ? ' (' + parts.join(', ') + ')' : '');
  }

  /**
   * "Email: yes (in person at sale, 2026-09-15) · SMS: no"
   * A do-not-contact customer gets a third segment so the timeline is honest:
   * " · Do not contact (STOP reply, 2026-09-20)".
   */
  function consentSummary(customer) {
    var c = customer || {};
    var out = describe('Email', c.emailConsent) + ' · ' + describe('SMS', c.smsConsent);
    if (c.status === 'dnc') {
      var d = c.dnc || {};
      var bits = [];
      if (d.reason) bits.push(String(d.reason));
      var when = ymd(d.at);
      if (when) bits.push(when);
      out += ' · Do not contact' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Opt-out detection                                                   */
  /* ------------------------------------------------------------------ */

  // ---- Opt-out detection: BYTE-FOR-BYTE COPY of engine.js isOptOutText ----
  // Single source of truth is netlify/functions/lib/engine.js. The Auditor
  // (test/audit.js) checks the two copies match. Do not edit here; edit engine.js
  // and re-copy.
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

  /**
   * Optional hint about which channel the person seems to be opting out of.
   * "" when the text is not an opt-out or gives no channel clue. The app
   * still flips BOTH channels to do-not-contact regardless of this hint.
   */
  function normalize(str) {
    return String(str == null ? '' : str).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function optOutReplyKind(str) {
    if (!isOptOutText(str)) return '';
    var s = ' ' + normalize(str) + ' ';
    if (/\b(email|emails|emailing|unsubscribe|mail)\b/.test(s)) return 'email';
    if (/\b(text|texts|texting|sms|message|messages)\b/.test(s)) return 'sms';
    if (/^ (stop|quit|cancel|end) $/.test(s)) return 'sms';   // bare keyword is the CTIA text convention
    return '';
  }

  return {
    VERSION: VERSION,
    OPT_OUT_RULE: OPT_OUT_RULE,
    emailFooter: emailFooter,
    smsOptOutLine: smsOptOutLine,
    consentHowOptions: consentHowOptions,
    consentLabels: consentLabels,
    canEmail: canEmail,
    canText: canText,
    consentSummary: consentSummary,
    isOptOutText: isOptOutText,
    optOutReplyKind: optOutReplyKind
  };
}));

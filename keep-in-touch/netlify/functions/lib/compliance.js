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
    'Normalize: lowercase, trim, strip punctuation, collapse spaces. ' +
    'Opt-out is TRUE if (a) the message contains any of: "unsubscribe", "opt out", ' +
    '"remove me", "do not contact", "don\'t contact", "stop texting", "stop emailing", ' +
    '"take me off" anywhere; or (b) the first word is one of stop, quit, cancel, end, ' +
    'unsubscribe; or (c) the message is 3 words or fewer and contains stop, quit, cancel ' +
    'or end as a whole word. Otherwise FALSE. ' +
    'Bias is deliberate: a false positive costs one customer Mick can reactivate with a ' +
    'tap; a false negative is a legal exposure.';

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

  var PHRASES = [
    'unsubscribe',
    'opt out',
    'remove me',
    'do not contact',
    "don't contact",
    'dont contact',
    'stop texting',
    'stop emailing',
    'take me off'
  ];
  var FIRST_WORDS = ['stop', 'quit', 'cancel', 'end', 'unsubscribe'];
  var SHORT_WORDS = ['stop', 'quit', 'cancel', 'end'];

  function normalize(str) {
    if (str == null) return '';
    var s = String(str).toLowerCase();
    s = s.replace(/[‘’ʼ]/g, "'");          // curly apostrophes → '
    s = s.replace(/[^a-z0-9'\s]/g, ' ');                   // strip punctuation (hyphen → space, so "opt-out" → "opt out")
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /**
   * True when a reply reads as an opt-out. See OPT_OUT_RULE. Identical to the
   * engine's rule (Agent 2) — if the two ever differ, this one wins for the
   * inbox and the engine must be brought in line.
   */
  function isOptOutText(str) {
    var s = normalize(str);
    if (!s) return false;
    var padded = ' ' + s + ' ';
    for (var i = 0; i < PHRASES.length; i++) {
      if (padded.indexOf(PHRASES[i]) !== -1) return true;
    }
    var words = s.split(' ');
    if (FIRST_WORDS.indexOf(words[0]) !== -1) return true;
    if (words.length <= 3) {
      for (var j = 0; j < words.length; j++) {
        if (SHORT_WORDS.indexOf(words[j]) !== -1) return true;
      }
    }
    return false;
  }

  /**
   * Optional hint about which channel the person seems to be opting out of.
   * "" when the text is not an opt-out or gives no channel clue. The app
   * still flips BOTH channels to do-not-contact regardless of this hint.
   */
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

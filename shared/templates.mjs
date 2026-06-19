// shared/templates.mjs — CLEAN API: the copy library.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  COPY PENDING — these are PLACEHOLDER drafts in Mick's plain, small-town   │
// │  voice. They are compliant (size + zero-value + tone) so the whole system  │
// │  works end-to-end and the test suite passes, but they are NOT final.       │
// │                                                                            │
// │  APPROVED stays `false` until Mick supplies real wording. While false the  │
// │  cron HOLDS every auto-email (logs it as 'held', sends nothing). Texts are  │
// │  always user-fired, so the dashboard still works for hands-on follow-up.   │
// │                                                                            │
// │  To go live: paste real copy below, then set APPROVED = true.              │
// └──────────────────────────────────────────────────────────────────────────┘

export const APPROVED = false;

export const VARIANTS = ['direct', 'softer', 'nepq'];
export const VARIANT_LABELS = { direct: 'Direct', softer: 'Softer', nepq: 'NEPQ' };

// One block per sequence key (see shared/sequences.mjs). Each has a text variant
// trio and an email variant trio ({ subject, body }). Tokens: {{first_name}} {{vehicle}}.
export const TEMPLATES = {
  welcome: {
    text: {
      direct: "Hey {{first_name}}, it's Mick. Wanted to make sure the {{vehicle}} got you home good. Holler if you need anything at all.",
      softer: "Hi {{first_name}}, it's Mick checking in. Hope the {{vehicle}} is treating you well so far. No rush, just glad you're set up.",
      nepq: "Hey {{first_name}}, it's Mick. How's the {{vehicle}} feeling now that you've had a day with it? Anything you wish you'd asked me before you left?",
    },
    email: {
      direct: { subject: "Checking in on the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. Just making sure the {{vehicle}} got you home without a hitch. If anything feels off, call me and we'll sort it. Glad to have you in it." },
      softer: { subject: "Hope you're settling into the {{vehicle}}", body: "Hi {{first_name}}, it's Mick. No need to reply, I just wanted you to know I'm here if the {{vehicle}} needs anything. Take your time getting to know it. I'm a phone call away whenever." },
      nepq: { subject: "Quick one about the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. Now that you've driven the {{vehicle}} a bit, is it doing what you hoped it would? If there's anything you're unsure about, I'd rather hear it now than later. Just reply and let me know." },
    },
  },
  checkin: {
    text: {
      direct: "Hey {{first_name}}, Mick here. Couple weeks in the {{vehicle}} now, everything running right? Let me know if anything popped up.",
      softer: "Hi {{first_name}}, it's Mick. Just thinking about you and the {{vehicle}} today. Hope it's been smooth, reach out if not.",
      nepq: "Hey {{first_name}}, Mick here. Now that the newness wore off, is the {{vehicle}} still feeling like the right call? Tell me straight.",
    },
    email: {
      direct: { subject: "Two weeks in the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. You've had the {{vehicle}} a couple weeks now, so I wanted to check it's running the way it should. If something came up, tell me and I'll take care of it. No question is too small." },
      softer: { subject: "How's the {{vehicle}} treating you?", body: "Hi {{first_name}}, Mick here. Just a quiet check-in to see how you and the {{vehicle}} are getting along. There's nothing you need to do. I'm only a call away if you ever want a hand." },
      nepq: { subject: "Still the right fit?", body: "Hey {{first_name}}, it's Mick. A couple weeks in, is the {{vehicle}} doing everything you needed it to? If there's any part that isn't sitting right, I'd like to know while it's easy to fix. Just hit reply and tell me." },
    },
  },
  referral: {
    text: {
      direct: "Hey {{first_name}}, Mick here. If you know anybody hunting for a vehicle, send them my way. I'll treat them like I treated you.",
      softer: "Hi {{first_name}}, it's Mick. Hope the {{vehicle}} is still making you happy. If a friend ever asks, I'd be grateful you thought of me.",
      nepq: "Hey {{first_name}}, Mick here. Who's the next person you know that's getting tired of their current ride? Happy to help them like I helped you.",
    },
    email: {
      direct: { subject: "A quick favor, {{first_name}}", body: "Hey {{first_name}}, it's Mick. You've had the {{vehicle}} a while now and I hope it's earned its keep. Most of my folks come from people like you passing my name along. If someone you know needs a vehicle, point them to me and I'll take good care of them." },
      softer: { subject: "Thinking of you and the {{vehicle}}", body: "Hi {{first_name}}, Mick here. No ask buried in this one, I mostly wanted to say I'm glad you're in the {{vehicle}}. If a friend or family member ever needs a hand finding something, I'd be honored you sent them. Either way, I'm here when you need me." },
      nepq: { subject: "Who comes to mind?", body: "Hey {{first_name}}, it's Mick. When you think about your people, who's the one driving something they've outgrown? If you sent them my way, I'd look after them the same way I looked after you. Just reply with a name and I'll take it from there." },
    },
  },
  service: {
    text: {
      direct: "Hey {{first_name}}, Mick here. The {{vehicle}} is due for a look-over soon. Want me to get you on the calendar?",
      softer: "Hi {{first_name}}, it's Mick. Just a friendly nudge that the {{vehicle}} is about ready for some routine care. No rush, whenever works for you.",
      nepq: "Hey {{first_name}}, Mick here. How's the {{vehicle}} been running lately, anything you've been meaning to mention? Might be a good time for a once-over.",
    },
    email: {
      direct: { subject: "Time for a look at the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. Your {{vehicle}} is coming up on the point where a little routine care keeps it solid for the long haul. I can get you set up whenever it's convenient. Just reply and we'll find a time." },
      softer: { subject: "A gentle reminder on the {{vehicle}}", body: "Hi {{first_name}}, Mick here. Nothing urgent, just a nudge that the {{vehicle}} is about due for some routine attention. Keeping up with it now saves headaches later. Let me know and I'll help you sort it out." },
      nepq: { subject: "How's it running, {{first_name}}?", body: "Hey {{first_name}}, it's Mick. Has the {{vehicle}} had any little quirks you've been meaning to get looked at? Now's a good window to stay ahead of it before it turns into something bigger. Reply and I'll help you line it up." },
    },
  },
  anniversary: {
    text: {
      direct: "Hey {{first_name}}, Mick here. Hard to believe it's been a year in the {{vehicle}}. Glad you trusted me with it.",
      softer: "Hi {{first_name}}, it's Mick. A whole year in the {{vehicle}} already. Hope it's still serving you well, I appreciate you.",
      nepq: "Hey {{first_name}}, Mick here. A year in, is the {{vehicle}} still the right fit for where life's at now? Always happy to talk if anything's changed.",
    },
    email: {
      direct: { subject: "One year in the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. It's been a full year since you drove off in the {{vehicle}}, and I wanted to say thanks for trusting me. If it's still doing right by you, that makes my day. And if life's changed and you're thinking ahead, you know where to find me." },
      softer: { subject: "A year already, {{first_name}}", body: "Hi {{first_name}}, Mick here. Somehow a year has gone by since you got the {{vehicle}}. I just wanted to check in and say I appreciate you. No agenda, only gratitude, and I'm here whenever you need anything." },
      nepq: { subject: "A year with the {{vehicle}}", body: "Hey {{first_name}}, it's Mick. Now that you've had a full year in the {{vehicle}}, is it still fitting the life you're living today? Sometimes a year changes what someone needs, and I'd rather you hear it from me than wonder. If anything's shifted, just reply and we'll talk it through." },
    },
  },
};

function safeVariant(v) {
  return VARIANTS.includes(v) ? v : 'direct';
}

/** Raw (un-hydrated) text template for a sequence + variant. */
export function getText(sequenceKey, variant = 'direct') {
  const blk = TEMPLATES[sequenceKey];
  return blk ? blk.text[safeVariant(variant)] : '';
}

/** Raw (un-hydrated) email template { subject, body } for a sequence + variant. */
export function getEmail(sequenceKey, variant = 'direct') {
  const blk = TEMPLATES[sequenceKey];
  return blk ? blk.email[safeVariant(variant)] : { subject: '', body: '' };
}

// shared/templates.mjs — CLEAN API: the copy library.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  LIVE COPY — adapted from Mick's own referral templates (the "North Star  │
// │  Lead Command" REF_TEMPLATES) into this engine's 5-window x 3-tone shape.  │
// │  His voice, kept inside the compliance guardrails: texts <= 3 sentences,   │
// │  emails <= 6, zero price/trade/credit language, no exclamation marks.      │
// │                                                                            │
// │  APPROVED = true → the cron sends the auto-emails. Texts are still always  │
// │  user-fired from the dashboard.                                            │
// │                                                                            │
// │  STILL PENDING from Mick: the Google-review ask from his post-delivery     │
// │  template needs his real review URL before it ships (no [link] placeholder │
// │  goes out). Hand me the URL and I'll wire a {{review_link}} token in.       │
// └──────────────────────────────────────────────────────────────────────────┘

export const APPROVED = true;

export const VARIANTS = ['direct', 'softer', 'nepq'];
export const VARIANT_LABELS = { direct: 'Direct', softer: 'Softer', nepq: 'NEPQ' };

// One block per sequence key (see shared/sequences.mjs). Each has a text variant
// trio and an email variant trio ({ subject, body }). Tokens: {{first_name}} {{vehicle}}.
export const TEMPLATES = {
  welcome: {
    text: {
      direct: "Hey {{first_name}} — Mick here. Just making sure the {{vehicle}} got you home good. Anything you need, you call me.",
      softer: "Hey {{first_name}} — hope the {{vehicle}} is treating you well so far. No need to reply, I just wanted you to know I'm here if anything comes up. Glad you're set up.",
      nepq: "Hey {{first_name}} — Mick here. Now that you've had a day in the {{vehicle}}, is it sitting right with you? If there's anything you wish you'd asked, just tell me.",
    },
    email: {
      direct: { subject: "Making sure the {{vehicle}} got you home", body: "Hey {{first_name}} — Mick here. Just making sure the {{vehicle}} got you home without a hitch. If anything feels off, call me and we'll sort it the same day. Glad to have you in it." },
      softer: { subject: "Settling into the {{vehicle}}", body: "Hey {{first_name}} — hope the {{vehicle}} is treating you well so far. No need to reply to this one. I just wanted you to know I'm here if it ever needs anything. Take your time getting to know it." },
      nepq: { subject: "Quick one, {{first_name}}", body: "Hey {{first_name}} — Mick here. Now that you've driven the {{vehicle}} a bit, is it doing what you hoped? If there's any part you're unsure about, I'd rather hear it now than later. Just hit reply and let me know." },
    },
  },
  checkin: {
    text: {
      direct: "Hey {{first_name}} — Mick here. Couple weeks in the {{vehicle}} now, everything running right? Let me know if anything came up.",
      softer: "Hey {{first_name}} — Mick here. Hope things are good and you're still loving the {{vehicle}}. No pressure, just wanted to stay on your radar.",
      nepq: "Hey {{first_name}} — Mick here. Now the newness has worn off, is the {{vehicle}} still feeling like the right call? Tell me straight.",
    },
    email: {
      direct: { subject: "Two weeks in the {{vehicle}}", body: "Hey {{first_name}} — Mick here. You've had the {{vehicle}} a couple weeks now, so I wanted to check it's running the way it should. If something came up, tell me and I'll take care of it. No question is too small." },
      softer: { subject: "How's the {{vehicle}} treating you?", body: "Hey {{first_name}} — Mick here, just a quiet check-in to see how you and the {{vehicle}} are getting along. There's nothing you need to do. I'm only a call away if you ever want a hand." },
      nepq: { subject: "Still the right fit?", body: "Hey {{first_name}} — Mick here. A couple weeks in, is the {{vehicle}} doing everything you needed it to? If there's any part that isn't sitting right, I'd like to know while it's easy to fix. Just hit reply and tell me." },
    },
  },
  referral: {
    text: {
      direct: "Hey {{first_name}} — Mick here. If anyone in your circle is looking for a vehicle, just send them my way. I'll take care of them the same way I took care of you.",
      softer: "Hey {{first_name}} — hope the {{vehicle}} is still treating you well. If you or anyone you know is ever in the market, I'm always here. No pressure, just wanted to stay on your radar.",
      nepq: "Hey {{first_name}} — Mick here. Who's the next person you know that's getting worn out by their current ride? Send them my way and I'll look after them like I looked after you.",
    },
    email: {
      direct: { subject: "A quick favor, {{first_name}}", body: "Hey {{first_name}} — Mick here. You've had the {{vehicle}} a while now, and I hope it's earned its keep. Most of my folks come from people like you passing my name along. If someone you know needs a vehicle, send them my way and I'll take care of them the same way I took care of you." },
      softer: { subject: "Thinking of you and the {{vehicle}}", body: "Hey {{first_name}} — hope the {{vehicle}} is still making you happy. There's no ask buried in this one. But if a friend or family member ever needs a hand finding the right vehicle, I'd be honored you sent them my way. Either way, I'm here when you need me." },
      nepq: { subject: "Who comes to mind?", body: "Hey {{first_name}} — Mick here. When you think about your people, who's the one driving something they've outgrown? If you sent them my way, I'd look after them the same way I looked after you. Just reply with a name and I'll take it from there." },
    },
  },
  service: {
    text: {
      direct: "Hey {{first_name}} — Mick here. The {{vehicle}} is about due for a look-over. Want me to get you on the calendar?",
      softer: "Hey {{first_name}} — just a friendly nudge that the {{vehicle}} is about ready for some routine care. No rush, whenever works for you. I'm here when you're ready.",
      nepq: "Hey {{first_name}} — Mick here. How's the {{vehicle}} been running, anything you've been meaning to mention? Might be a good time for a once-over before winter.",
    },
    email: {
      direct: { subject: "Time for a look at the {{vehicle}}", body: "Hey {{first_name}} — Mick here. Your {{vehicle}} is coming up on the point where a little routine care keeps it solid for the long haul. With Minnesota winter on the way, now's a smart time to stay ahead of it. I can get you set up whenever it's convenient, just reply and we'll find a time." },
      softer: { subject: "A gentle reminder on the {{vehicle}}", body: "Hey {{first_name}} — nothing urgent here, just a nudge that the {{vehicle}} is about due for some routine attention. Keeping up with it now saves headaches later, especially before the snow flies. Let me know and I'll help you sort it out." },
      nepq: { subject: "How's it running, {{first_name}}?", body: "Hey {{first_name}} — Mick here. Has the {{vehicle}} had any little quirks you've been meaning to get looked at? Now's a good window to stay ahead of it before winter turns it into something bigger. Reply and I'll help you line it up." },
    },
  },
  anniversary: {
    text: {
      direct: "Hey {{first_name}} — Mick here. Hard to believe it's been a year in the {{vehicle}} already. Thanks for trusting me with it.",
      softer: "Hey {{first_name}} — a whole year in the {{vehicle}} already. Hope it's still serving you well. I appreciate you, and I'm always here.",
      nepq: "Hey {{first_name}} — Mick here. A year in, is the {{vehicle}} still the right fit for where life's at now? Always happy to talk if anything's changed.",
    },
    email: {
      direct: { subject: "One year in the {{vehicle}}", body: "Hey {{first_name}} — Mick here. It's been a full year since you drove off in the {{vehicle}}, and I wanted to say thanks for trusting me. If it's still doing right by you, that makes my day. And if life's changed and you're thinking ahead, you know where to find me." },
      softer: { subject: "A year already, {{first_name}}", body: "Hey {{first_name}} — somehow a year has gone by since you got the {{vehicle}}. I just wanted to check in and say I appreciate you. No agenda, only thanks. I'm here whenever you need anything." },
      nepq: { subject: "A year with the {{vehicle}}", body: "Hey {{first_name}} — Mick here. Now you've had a full year in the {{vehicle}}, is it still fitting the life you're living today? Sometimes a year changes what someone needs, and I'd rather you hear it from me than wonder. If anything's shifted, just reply and we'll talk it through." },
    },
  },
};

// ── Recurring 90-day follow-up copy (evergreen, reused each cycle) ───────────
// The text touch pulls from FOLLOWUP_TEMPLATES.text, the email touch from
// .email. Call / video / gift use SCRIPTS — those are talking points for Mick,
// not sent to the customer, so they speak to him ("ask how…", "record a…").
export const FOLLOWUP_TEMPLATES = {
  text: {
    direct: "Hey {{first_name}} — Mick here, just checking in on the {{vehicle}}. Hope it's still treating you right. Holler if you ever need anything.",
    softer: "Hey {{first_name}} — thinking of you today. Hope all's well with the {{vehicle}} and the family. No reason for the message, just staying in touch.",
    nepq: "Hey {{first_name}} — Mick here. How's the {{vehicle}} holding up for what you need these days? I'm always here if anything's changed.",
  },
  email: {
    direct: { subject: "Checking in, {{first_name}}", body: "Hey {{first_name}} — Mick here. It's been a little while, so I wanted to see how the {{vehicle}} is treating you. I like to stay in touch with the people I've worked with, not just at the start. If there's ever anything you need, I'm a phone call away. And if someone you know is looking, send them my way and I'll take good care of them." },
    softer: { subject: "Thinking of you, {{first_name}}", body: "Hey {{first_name}} — Mick here, no agenda on this one. I just wanted to say I appreciate you and hope the {{vehicle}} is still serving you well. Life gets busy, so I figured I'd reach out and stay on your radar. You know where to find me whenever you need anything." },
    nepq: { subject: "How's the {{vehicle}} fitting these days?", body: "Hey {{first_name}} — Mick here. A lot can change in a few months, so I wanted to ask how the {{vehicle}} is fitting the life you're living now. If it's still right for you, that's great to hear. If anything has shifted, I'd rather you hear it from me than wonder. Just reply and we'll talk it through." },
  },
};

// Action scripts for the manual touches (read by Mick, not sent).
export const SCRIPTS = {
  call: "Quick call to {{first_name}}: ask how the {{vehicle}} is treating them and how the family is doing. Keep it short and personal, no pitch. Before you hang up, let them know you're always here and happy to help anyone they send your way.",
  video: "Record a short personal video for {{first_name}} — twenty seconds, one take. Say hi by name, mention the {{vehicle}}, and that you were thinking of them. Keep it casual and send it by text.",
  gift: "Send {{first_name}} a small gift or a handwritten card. A note that mentions the {{vehicle}} and thanks them for their trust goes a long way. Keep it personal, never promotional.",
};

// Keep-warm text drafts for prospects (sent by Mick from the dashboard). Compliant
// (<=3 sentences, no filler, no price talk), NEPQ-style, in Mick's voice.
export const PROSPECT_SCRIPTS = {
  hot: "Hey {{first_name}} — Mick here. Been turning over what you're after and I think I can line it up right. What has to be true for this to be an easy yes for you?",
  cold: "Hey {{first_name}} — Mick here from North Star. No agenda on this one, I just keep a short list of good people to help when the timing's right. When you picture your next vehicle, what matters most to you about it?",
};

/** Raw (un-hydrated) keep-warm draft for a prospect category (hot/cold). */
export function getProspectScript(category) {
  return PROSPECT_SCRIPTS[category] || '';
}

function safeVariant(v) {
  return VARIANTS.includes(v) ? v : 'direct';
}

/** Raw (un-hydrated) text template for a sequence + variant. */
export function getText(sequenceKey, variant = 'direct') {
  if (sequenceKey === 'followup_text') return FOLLOWUP_TEMPLATES.text[safeVariant(variant)];
  const blk = TEMPLATES[sequenceKey];
  return blk ? blk.text[safeVariant(variant)] : '';
}

/** Raw (un-hydrated) email template { subject, body } for a sequence + variant. */
export function getEmail(sequenceKey, variant = 'direct') {
  if (sequenceKey === 'followup_email') return FOLLOWUP_TEMPLATES.email[safeVariant(variant)];
  const blk = TEMPLATES[sequenceKey];
  return blk ? blk.email[safeVariant(variant)] : { subject: '', body: '' };
}

/** Raw (un-hydrated) action script for a manual follow-up type (call/video/gift). */
export function getScript(type) {
  return SCRIPTS[type] || '';
}

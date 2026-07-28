// CARVIS → Anthropic proxy (Netlify Function).
//
// Why this exists: the browser must NOT hold the Anthropic API key, and
// browsers can't call api.anthropic.com directly anyway (CORS). This function
// runs server-side, reads the key from the ANTHROPIC_API_KEY env var, and is
// the single source of Mick's voice (the system prompt below) + the model.
// The client (index.html) sends only the rolling conversation `messages`.
//
// Deploy: drag the carvis/ folder onto Netlify, then set ANTHROPIC_API_KEY in
//         Site settings → Environment variables. No build step.

// Model preference, best → most-available. CARVIS tries them in order and uses
// the first one this Anthropic account accepts, so the live brain works even if
// a newer model isn't enabled on the key. Override the top pick with CARVIS_MODEL.
const MODEL_CHAIN = [
  process.env.CARVIS_MODEL,
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
].filter((m, i, a) => m && a.indexOf(m) === i);
const MAX_TOKENS = 1000;

const SYSTEM_PROMPT = `You are CARVIS, the personal AI assistant for Mick Knies, who runs North Star Car Guy — an independent used-car operation INSIDE Mosaic Auto Group in Zumbrota, Minnesota. Mick is NOT the owner of Mosaic; he runs his own branded buy-side (acquiring from private sellers) and sell-side (retailing to customers) operation within it. His customer base is rural Minnesota; buyers often drive 30-90 minutes.

Think of yourself as Jarvis to his Iron Man: sharp, fast, capable, loyal, with a touch of dry wit. You address him as "Mick" or "sir" sparingly. You are confident and concise — you give him what he needs without padding.

HIS SALES METHOD: NEPQ (neuro-emotional persuasion questions) — consultative, question-first, never pushy. His brand is built on trust and relationship-first selling. He aims to be the most trusted car guy in the region, not just the highest volume. He has sold 1,000+ cars.

HIS VOICE (use it when writing anything customer-facing): warm, direct, small-town Minnesota authentic. Never corporate, never salesy, never AI-sounding. Short sentences. Real language.

CUSTOMER MESSAGE RULE: Any time Mick asks you to write a customer message, give exactly THREE options labeled:
- Option A (Direct)
- Option B (Softer)
- Option C (NEPQ style)
No preamble — just the three options.

HARD COMPLIANCE (never break — this keeps your drafts matching his CRM):
- TEXT messages: 3 sentences max. EMAILS: 6 sentences max.
- ZERO money/price/trade/credit/financing/payment language of any kind — no dollar amounts, trade-in values, rates, or deals.
- NO exclamation marks. No corporate jargon ("synergy," "circle back," "touch base"). No emoji in customer-facing copy.
- NO generic sales filler. Never lean on "just reaching out," "just following up," "just checking in," "wanted to reach out," or "touching base." Open with something specific and real — a genuine question, or a detail about them or their vehicle — the NEPQ way. If a line could come from any salesperson, rewrite it.
- When a value is unknown, use only these fill-ins: {{first_name}} or {{vehicle}}.

FOLLOW-UP & REFERRAL DUTY (your main job right now): Mick is loading his existing customers into a referral follow-up system to re-engage them for referrals and stay top of mind. Help him:
- Draft the outreach he sends — texts, emails, referral asks, thank-you notes, review requests, check-ins — in his voice.
- Plan cadence: suggest who to contact next and why.
- Tailor to any customer detail he pastes (name, vehicle, time since purchase).
Lead with the relationship, then open the door to a referral: "if anyone you know is looking, send them my way and I'll take care of them the same way I took care of you." No pressure, ever. Sign off simply as "— Mick" unless told otherwise.

MONEY RULE: Never give specific dollar figures for trade-in values, market prices, or OEM incentives without flagging them as estimates and recommending he verify on Perplexity or KBB before quoting a customer.

INVENTORY & CAR INFO RULE: The live inventory and all vehicle info come from mosaicautos.com (the lot's site — North Star operates inside Mosaic). For ANY question about a specific car, what's in stock, availability, specs, or pricing, ground your answer in mosaicautos.com and point to the listing there rather than generic web sources or other dealers. If you don't have the exact vehicle, send him (or the customer) to mosaicautos.com to see what's currently available.

His assistant Ella Bushey (brand: Ella B. Driven) also works the business and writes in Mick's voice.

He has agents he's building with Claude: a weekly Market Intel Agent (built) and a Follow-Up Sequencer (planned). When he asks for an agent prompt, hand him a clean paste-ready prompt for ChatGPT agent mode.

RESPONSE STYLE: Because Carvis talks out loud, keep spoken answers tight and natural — this is a conversation, not an essay. For customer messages give the three options clearly. Don't use markdown headers or bullets when speaking casually; just talk like a sharp right-hand man. Be useful, be quick, be Mick's guy.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set on the server. In Netlify: Site settings → Environment variables → add ANTHROPIC_API_KEY, then redeploy (Deploys → Trigger deploy → Clear cache and deploy).' }),
    };
  }

  let messages, context;
  try {
    ({ messages, context } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'messages must be a non-empty array.' }) };
  }

  // Jarvis awareness: the client sends a compact live snapshot of the shop
  // (pace, queued work, pipeline counts) with each ask. It rides the system
  // prompt so CARVIS answers like an assistant who can see the dashboard.
  // Length-capped and clearly fenced so it can't impersonate instructions.
  let system = SYSTEM_PROMPT;
  if (typeof context === 'string' && context.trim()) {
    system += '\n\nLIVE SHOP SNAPSHOT (auto-generated by the dashboard just now — treat as current fact, reference it naturally when relevant, never read it back verbatim as a list):\n' + context.trim().slice(0, 2000);
  }

  // Detects "this model isn't available on your key" so we can fall back to the
  // next candidate (vs. an auth/credit error, which would fail on every model).
  const isModelError = (status, text) => {
    if (status !== 400 && status !== 403 && status !== 404) return false;
    return /model/i.test(text) && /(not[_ ]?found|not.*exist|invalid|unknown|permission|access|do(es)? not have)/i.test(text);
  };

  let lastStatus = 502, lastText = '{"error":"No model could be reached."}';
  for (const model of MODEL_CHAIN) {
    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages }),
      });
    } catch (err) {
      lastStatus = 502;
      lastText = JSON.stringify({ error: 'Upstream request to Anthropic failed: ' + String(err && err.message ? err.message : err) });
      break; // network failure — retrying other models won't help
    }

    const text = await upstream.text();
    if (upstream.ok) {
      // Success — pass Anthropic's body through verbatim (client reads .content).
      return { statusCode: 200, headers: { 'content-type': 'application/json', 'x-carvis-model': model }, body: text };
    }
    lastStatus = upstream.status; lastText = text;
    if (!isModelError(upstream.status, text)) break; // auth/credit/other — stop, don't mask it
    // else: try the next model in the chain
  }

  return { statusCode: lastStatus, headers: { 'content-type': 'application/json' }, body: lastText };
};

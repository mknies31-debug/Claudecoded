// CARVIS → Anthropic proxy (Netlify Function).
//
// Why this exists: the browser must NOT hold the Anthropic API key, and
// browsers can't call api.anthropic.com directly anyway (CORS). This function
// runs server-side, reads the key from the ANTHROPIC_API_KEY env var, and is
// the single source of Mick's voice (the system prompt below) + the model.
// The client (index.html) sends the rolling conversation `messages` plus an
// optional `context` string (today's date, matched inventory) appended to the
// system prompt for that call.
//
// Optional hardening: set CARVIS_TOKEN in Netlify env vars and the function
// requires an X-Carvis-Token header — stops strangers who find the URL from
// burning the API key. Leave it unset and behavior is unchanged.
//
// Deploy: drag the carvis/ folder onto Netlify, then set ANTHROPIC_API_KEY in
//         Site settings → Environment variables. No build step.

// Model preference, best → most-available. CARVIS tries them in order and uses
// the first one this Anthropic account accepts. The winner is memoized for the
// life of the warm function, so only the first request pays for discovery.
// Override the top pick with CARVIS_MODEL.
const MODEL_CHAIN = [
  process.env.CARVIS_MODEL,
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
].filter((m, i, a) => m && a.indexOf(m) === i);

// 1000 was silently truncating the mandated three-option format (on Fable 5,
// always-on thinking also spends from this budget). max_tokens is a ceiling,
// not a target — raising it costs nothing until a reply actually needs it.
const MAX_TOKENS = 4096;

// Cap each upstream attempt so a slow hop fails fast instead of eating
// Netlify's 10s function budget and returning an opaque 502.
const ATTEMPT_TIMEOUT_MS = 8000;

let preferredModel = null; // memoized across warm invocations

const SYSTEM_PROMPT = `You are CARVIS, the personal AI assistant for Mick Knies, who runs North Star Car Guy — an independent used-car operation INSIDE Mosaic Auto Group in Zumbrota, Minnesota. Mick is NOT the owner of Mosaic; he runs his own branded buy-side (acquiring from private sellers) and sell-side (retailing to customers) operation within it. His customer base is rural Minnesota; buyers often drive 30-90 minutes.

Think of yourself as Jarvis to his Iron Man: sharp, fast, capable, loyal, with a touch of dry wit. You address him as "Mick" or "sir" sparingly. You are confident and concise — you give him what he needs without padding.

HIS SALES METHOD: NEPQ (neuro-emotional persuasion questions) — consultative, question-first, never pushy. His brand is built on trust and relationship-first selling. He aims to be the most trusted car guy in the region, not just the highest volume. He has sold 1,000+ cars.

HIS VOICE (use it when writing anything customer-facing): warm, direct, small-town Minnesota authentic. Never corporate, never salesy, never AI-sounding. Short sentences. Real language.

VOICE ANCHORS — real lines from Mick's script playbook; match this register exactly:
- Price: "We don't play games on price — these are priced under market, we do the homework so you don't have to. Reasonable offers get heard."
- NEPQ opener: "What's the main reason the truck caught your eye — or what would it do for you that you don't have right now?"
- Ghost recovery: "Ever wonder what your current ride is actually worth? Free same-day appraisal, no obligation."
- Appointment lock-in: "We'll pull it around, you take a look and a drive — totally low pressure, 20-30 minutes."
Always steer toward an in-person visit ("today or tomorrow?"). Never negotiate price over text.

FORMAT — your replies render as plain text and are often read aloud by text-to-speech. Never use markdown: no asterisks, hashes, bullets, or numbered lists, ever. Casual questions get one to three short sentences, like talking. Write customer messages ONLY when Mick asks you to write one — then use exactly this plain-text layout, nothing before it, nothing after it:
OPTION A — DIRECT:
<message>

OPTION B — SOFTER:
<message>

OPTION C — NEPQ:
<message>
Texts stay under 3 sentences; emails under 6. If Mick is asking ABOUT a message (strategy, tone, whether to send) rather than asking you to WRITE one, just answer — no options.

MONEY RULE — two cases. (1) Customer-facing drafts: never include a specific dollar figure for a trade value, market price, or incentive. Steer to a free same-day appraisal or an in-person conversation instead. (2) Talking to Mick: numbers are fine, but tag them once, briefly — "ballpark; check KBB before you quote it" — don't repeat the disclaimer on every figure.

WHAT YOU CANNOT SEE: You have no live access to Mick's inventory, prices, stock numbers, customer records, or today's date unless that context is included in the conversation. If he asks about a specific vehicle, price, or customer you don't have in front of you, say so and point him to the car lookup (type the year/make in the command bar) or his prospect list — then help with strategy or wording using whatever details he gives you. NEVER invent stock numbers, prices, mileage, availability, or customer history.

His assistant Ella Bushey (brand: Ella B. Driven) also works the business and writes in Mick's voice.

He has agents he's building with Claude: a weekly Market Intel Agent (built) and a Follow-Up Sequencer (planned). When he asks for an agent prompt, hand him a clean paste-ready prompt for ChatGPT agent mode.

RESPONSE STYLE: Because CARVIS talks out loud, keep spoken answers tight and natural — this is a conversation, not an essay. Be useful, be quick, be Mick's guy.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Optional shared secret — only enforced when CARVIS_TOKEN is set.
  const expected = process.env.CARVIS_TOKEN;
  if (expected) {
    const got = (event.headers && (event.headers['x-carvis-token'] || event.headers['X-Carvis-Token'])) || '';
    if (got !== expected) {
      return { statusCode: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'This CARVIS is locked. Enter the access token in ⇅ SYNC → Access token (same value as the CARVIS_TOKEN env var on Netlify).' }) };
    }
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

  // Per-call context from the client (today's date, matched inventory rows).
  // Bounded so a buggy client can't stuff the prompt.
  const system = (typeof context === 'string' && context.trim())
    ? SYSTEM_PROMPT + '\n\nLIVE CONTEXT FOR THIS CONVERSATION (real data from Mick\'s dashboard — you may quote it):\n' + context.trim().slice(0, 4000)
    : SYSTEM_PROMPT;

  // Detects "this model isn't available on your key" so we can fall back to the
  // next candidate (vs. an auth/credit error, which would fail on every model).
  const isModelError = (status, text) => {
    if (status !== 400 && status !== 403 && status !== 404) return false;
    return /model/i.test(text) && /(not[_ ]?found|not.*exist|invalid|unknown|permission|access|do(es)? not have)/i.test(text);
  };

  const callModel = async (model) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      return await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // Put the memoized winner first so warm invocations skip dead hops.
  const chain = preferredModel
    ? [preferredModel, ...MODEL_CHAIN.filter(m => m !== preferredModel)]
    : MODEL_CHAIN;

  let lastStatus = 502, lastText = '{"error":"No model could be reached."}';
  for (const model of chain) {
    let upstream;
    try {
      upstream = await callModel(model);
    } catch (err) {
      const timedOut = err && (err.name === 'AbortError' || /abort/i.test(String(err.message)));
      lastStatus = 502;
      lastText = JSON.stringify({ error: timedOut ? 'Anthropic took too long to answer — try again.' : ('Upstream request to Anthropic failed: ' + String(err && err.message ? err.message : err)) });
      if (timedOut && model !== chain[chain.length - 1]) continue; // slow model — try the next one
      break; // network failure — retrying other models won't help
    }

    const text = await upstream.text();
    if (upstream.ok) {
      preferredModel = model; // remember the winner for warm invocations
      // Success — pass Anthropic's body through verbatim (client reads .content
      // and .stop_reason; a max_tokens stop is surfaced client-side).
      return { statusCode: 200, headers: { 'content-type': 'application/json', 'x-carvis-model': model }, body: text };
    }
    lastStatus = upstream.status; lastText = text;
    if (!isModelError(upstream.status, text)) break; // auth/credit/other — stop, don't mask it
    // else: try the next model in the chain
  }

  return { statusCode: lastStatus, headers: { 'content-type': 'application/json' }, body: lastText };
};

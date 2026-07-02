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
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
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
Texts stay under 3 sentences. Emails stay under 6.

MONEY RULE: Never give specific dollar figures for trade-in values, market prices, or OEM incentives without flagging them as estimates and recommending he verify on Perplexity or KBB before quoting a customer.

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

  let messages, systemOverride, maxTokens;
  try {
    const b = JSON.parse(event.body || '{}');
    messages = b.messages;
    systemOverride = typeof b.system === 'string' && b.system.trim() ? b.system : null;
    maxTokens = Math.min(Math.max(parseInt(b.max_tokens, 10) || MAX_TOKENS, 1), 4096);
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'messages must be a non-empty array.' }) };
  }
  // Optional per-request system prompt (e.g. the Customer Upload Intake agent) —
  // messages pass through verbatim, so image/document blocks (vision) work too.
  const system = systemOverride || SYSTEM_PROMPT;

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
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
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

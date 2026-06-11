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

const MODEL = process.env.CARVIS_MODEL || 'claude-fable-5'; // override via CARVIS_MODEL env var if your account lacks Fable 5
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

  let messages;
  try {
    ({ messages } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'messages must be a non-empty array.' }) };
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    // Pass the Anthropic response through verbatim so the client parses
    // data.content exactly as it would a direct call.
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { 'content-type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream request to Anthropic failed: ' + String(err && err.message ? err.message : err) }),
    };
  }
};

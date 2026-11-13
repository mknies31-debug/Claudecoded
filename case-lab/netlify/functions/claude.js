// Case Lab → Anthropic proxy. Verifies the Firebase login, then calls the
// Messages API server-side so the key never reaches the browser.
//
// env: ANTHROPIC_API_KEY, ALLOWED_UID, FIREBASE_SERVICE_ACCOUNT (or FIREBASE_PROJECT_ID)
//      CLAUDE_MODEL (optional, default claude-sonnet-5-5)
import { requireMick, readBody } from '../lib/auth.js';

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export default async (req) => {
  const denied = await requireMick(req);
  if (denied) return denied;
  const [body, bad] = await readBody(req);
  if (bad) return bad;
  if (!process.env.ANTHROPIC_API_KEY) return new Response('Server not configured: ANTHROPIC_API_KEY is missing', { status: 500 });

  const model = (typeof body.model === 'string' && body.model.startsWith('claude-')) ? body.model
    : (process.env.CLAUDE_MODEL || 'claude-sonnet-5-5');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // If a safety classifier declines, the API re-runs the request on a fallback model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: body.maxTokens,
      system: body.system,
      messages: [{ role: 'user', content: body.prompt }],
      fallbacks: 'default',
      // Lower effort = faster replies, which matters under Netlify's function time limit.
      output_config: { effort: EFFORTS.has(body.effort) ? body.effort : 'medium' }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return new Response(`Anthropic ${r.status}: ${data.error?.message || 'request failed'}`, { status: 502 });
  if (data.stop_reason === 'refusal') return new Response('The model declined this request.', { status: 422 });
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return Response.json({ text, usage: data.usage, model: data.model, stopReason: data.stop_reason });
};

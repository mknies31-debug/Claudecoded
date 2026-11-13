// Case Lab → Gemini proxy. Same login check as claude.js.
//
// env: GEMINI_API_KEY, GEMINI_MODEL (required: check Google's docs for the current
//      model name), ALLOWED_UID, FIREBASE_SERVICE_ACCOUNT (or FIREBASE_PROJECT_ID)
import { requireMick, readBody } from '../lib/auth.js';

export default async (req) => {
  const denied = await requireMick(req);
  if (denied) return denied;
  const [body, bad] = await readBody(req);
  if (bad) return bad;
  const key = process.env.GEMINI_API_KEY;
  const model = (typeof body.model === 'string' && /^[\w.-]+$/.test(body.model) && body.model) || process.env.GEMINI_MODEL;
  if (!key || !model) return new Response('Server not configured: GEMINI_API_KEY and GEMINI_MODEL are required', { status: 500 });

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },   // header, so the key stays out of URL logs
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: body.system }] },
      contents: [{ role: 'user', parts: [{ text: body.prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: body.maxTokens }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return new Response(`Gemini ${r.status}: ${data.error?.message || 'request failed'}`, { status: 502 });
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return Response.json({ text, usage: data.usageMetadata, model });
};

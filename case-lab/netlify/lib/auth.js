// Shared login check for the AI proxies. Without it, anyone who finds the
// function URL can spend your API credits.
//
// env: ALLOWED_UID                 your Firebase uid (Firebase console → Authentication → Users)
//      FIREBASE_SERVICE_ACCOUNT    the service-account JSON, pasted whole (preferred)
//      FIREBASE_PROJECT_ID         or just the project id (enough to verify ID tokens)
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function init() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const sa = JSON.parse(raw);
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
  } else {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  }
}

// Returns null when the caller may proceed, or a Response to send back.
export async function requireMick(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!process.env.ALLOWED_UID) return new Response('Server not configured: ALLOWED_UID is missing', { status: 500 });
  try { init(); } catch (e) { return new Response('Server not configured: bad FIREBASE_SERVICE_ACCOUNT', { status: 500 }); }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await getAuth().verifyIdToken(token).catch(() => null) : null;
  if (!user || user.uid !== process.env.ALLOWED_UID) return new Response('Forbidden', { status: 403 });
  return null;
}

export async function readBody(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.prompt !== 'string' || !body.prompt) return [null, new Response('Bad request: "prompt" is required', { status: 400 })];
  const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 4000, 256), 16000);
  return [{ system: String(body.system || ''), prompt: body.prompt, model: body.model, maxTokens, effort: body.effort }, null];
}

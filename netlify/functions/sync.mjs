// CARVIS cloud sync (Netlify Function, ESM).
//
// Lets Mick run CARVIS at home AND at work with one shared, private "sync key".
// Both machines POST their full data snapshot (hot prospects, daily habits,
// contacts) here and GET it back — so the two stay in step without shuffling
// files around. The data is stored in Netlify Blobs, keyed by a SHA-256 hash
// of the sync key (the raw passphrase is never stored).
//
// ── Setup ──────────────────────────────────────────────────────────────────
//   Nothing to configure. Netlify Blobs is enabled automatically the first
//   time this function runs on a deployed site (and under `netlify dev`).
//   The only dependency, @netlify/blobs, is installed from package.json.
//
// Security note: anyone who knows the sync key can read/write that snapshot.
// It is a personal convenience store, not an auth system — keep the key private
// and make it long. No vehicle PII beyond what Mick types into his own lists.

import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const MIN_KEY = 6;
const blobKey = (k) => createHash('sha256').update(String(k)).digest('hex');

export const handler = async (event) => {
  try {
    const store = getStore('carvis-sync');

    if (event.httpMethod === 'GET') {
      const key = (event.queryStringParameters || {}).key || '';
      if (String(key).length < MIN_KEY) return resp(400, { error: `Sync key must be at least ${MIN_KEY} characters.` });
      const payload = await store.get(blobKey(key), { type: 'json' });
      return resp(200, { payload: payload || null });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Invalid JSON body.' }); }
      const { key, payload } = body;
      if (!key || String(key).length < MIN_KEY) return resp(400, { error: `Sync key must be at least ${MIN_KEY} characters.` });
      if (!payload || typeof payload !== 'object' || !payload.store) return resp(400, { error: 'Nothing to sync.' });
      await store.setJSON(blobKey(key), { store: payload.store, ts: payload.ts || new Date().toISOString() });
      return resp(200, { ok: true });
    }

    return resp(405, { error: 'Method Not Allowed' });
  } catch (err) {
    return resp(500, { error: 'Sync store unavailable: ' + (err && err.message ? err.message : String(err)) });
  }
};

function resp(statusCode, obj) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

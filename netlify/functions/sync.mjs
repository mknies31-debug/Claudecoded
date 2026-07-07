// CARVIS cloud sync (Netlify Function, ESM).
//
// Lets Mick run CARVIS at home AND at work with one shared, private "sync key".
// Both machines POST their full data snapshot (hot prospects, daily habits,
// contacts) here and GET it back — so the two stay in step without shuffling
// files around. The data is stored in Netlify Blobs, keyed by a SHA-256 hash
// of the sync key (the raw passphrase is never stored).
//
// Safety rails (added after audit):
//  • A POST whose data timestamp is OLDER than what's stored is rejected with
//    409 — a stale device can no longer silently clobber newer data.
//  • The first push of each day also lands in a dated backup blob; the last
//    14 days are kept. GET ?list=1 enumerates them, GET ?backup=YYYY-MM-DD
//    restores one. One bad sync is no longer the end of the business.
//  • Optional CARVIS_TOKEN env var: when set, every request must carry it in
//    X-Carvis-Token. The sync key alone was guessable; the token is the lock.
//
// Setup: nothing to configure for Blobs — it self-enables on first use.

import * as Blobs from '@netlify/blobs';
import { createHash } from 'node:crypto';

const MIN_KEY = 6;
const BACKUP_DAYS = 14;
const blobKey = (k) => createHash('sha256').update(String(k)).digest('hex');
const dayStamp = (d) => (d || new Date()).toISOString().slice(0, 10);

export const handler = async (event) => {
  try {
    const expected = process.env.CARVIS_TOKEN;
    if (expected) {
      const got = (event.headers && (event.headers['x-carvis-token'] || event.headers['X-Carvis-Token'])) || '';
      if (got !== expected) return resp(401, { error: 'This CARVIS is locked. Enter the access token in ⇅ SYNC → Access token (same value as the CARVIS_TOKEN env var on Netlify).' });
    }

    // Lambda-compat handlers must hand the Blobs library the request context
    // before getStore() works; without this getStore can throw
    // "environment has not been configured" on deployed Netlify.
    if (typeof Blobs.connectLambda === 'function') {
      try { Blobs.connectLambda(event); } catch { /* modern runtime already has context */ }
    }
    const store = Blobs.getStore('carvis-sync');

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const key = qs.key || '';
      if (String(key).length < MIN_KEY) return resp(400, { error: `Sync key must be at least ${MIN_KEY} characters.` });
      const base = blobKey(key);

      if (qs.list) {
        // Enumerate available daily restore points for this key.
        const days = [];
        for (let i = 0; i < BACKUP_DAYS; i++) {
          const d = new Date(Date.now() - i * 86400000);
          const b = await store.get(base + '-' + dayStamp(d), { type: 'json' });
          if (b) days.push({ day: dayStamp(d), ts: b.ts || null });
        }
        return resp(200, { backups: days });
      }
      if (qs.backup) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(qs.backup)) return resp(400, { error: 'backup must be YYYY-MM-DD.' });
        const payload = await store.get(base + '-' + qs.backup, { type: 'json' });
        return resp(200, { payload: payload || null });
      }

      const payload = await store.get(base, { type: 'json' });
      return resp(200, { payload: payload || null });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Invalid JSON body.' }); }
      const { key, payload } = body;
      if (!key || String(key).length < MIN_KEY) return resp(400, { error: `Sync key must be at least ${MIN_KEY} characters.` });
      if (!payload || typeof payload !== 'object' || !payload.store) return resp(400, { error: 'Nothing to sync.' });

      const base = blobKey(key);
      const incomingTs = payload.ts || new Date().toISOString();

      // Stale-clobber guard: refuse to overwrite newer data with older data.
      const current = await store.get(base, { type: 'json' });
      if (current && current.ts && incomingTs < current.ts) {
        return resp(409, { error: 'Cloud copy is newer than this device — pull first, then push.', cloudTs: current.ts });
      }

      const record = { store: payload.store, ts: incomingTs };
      await store.setJSON(base, record);

      // Daily backup: first push of the day wins (don't overwrite it later,
      // so the backup preserves the start-of-day state). Best-effort cleanup
      // of the backup that just aged out of the window.
      const todayKey = base + '-' + dayStamp();
      const existing = await store.get(todayKey, { type: 'json' });
      if (!existing) {
        await store.setJSON(todayKey, record);
        try { await store.delete(base + '-' + dayStamp(new Date(Date.now() - BACKUP_DAYS * 86400000))); } catch { /* best effort */ }
      }
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

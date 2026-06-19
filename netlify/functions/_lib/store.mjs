// netlify/functions/_lib/store.mjs — ISOLATED SERVICE: the data gateway.
//
// The CRM has no separate database. It reads and writes the SAME blob CARVIS's
// cloud sync already uses (store 'carvis-sync', key sha256(syncKey), payload
// { store: {carvis_*...}, ts }). The cron opens it server-side with CRM_SYNC_KEY.
//
// This gateway hides all of that behind getCustomers/getTouchLogs/save so the
// engine stays pure. To move to Firestore later, reimplement this one file —
// nothing else changes (see README "Swap the data store").

import * as Blobs from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { KEYS } from '../../../shared/schema.mjs';

const STORE_NAME = 'carvis-sync';
const blobKey = (k) => createHash('sha256').update(String(k)).digest('hex');

function parseArr(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}
function parseObj(raw) {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** Open the blob-backed snapshot for the configured sync key. */
export async function openStore(event, env = process.env) {
  const syncKey = env.CRM_SYNC_KEY;
  if (!syncKey || String(syncKey).length < 6) {
    return { ready: false, reason: 'CRM_SYNC_KEY is not set (or under 6 chars). The cron cannot find the data blob without it.' };
  }
  if (typeof Blobs.connectLambda === 'function') {
    try { Blobs.connectLambda(event); } catch { /* modern runtime already has context */ }
  }
  const blobs = Blobs.getStore(STORE_NAME);
  const id = blobKey(syncKey);
  const payload = (await blobs.get(id, { type: 'json' })) || { store: {}, ts: null };
  const snap = payload.store || {};

  return {
    ready: true,
    snapshot: snap,
    customers: parseArr(snap[KEYS.customers]),
    touchLogs: parseArr(snap[KEYS.touchLogs]),
    meta: parseObj(snap[KEYS.meta]),
    /** Persist mutated CRM arrays back into the shared snapshot. */
    async save({ customers, touchLogs, meta }) {
      const nextSnap = { ...snap };
      if (customers) nextSnap[KEYS.customers] = JSON.stringify(customers);
      if (touchLogs) nextSnap[KEYS.touchLogs] = JSON.stringify(touchLogs);
      if (meta) nextSnap[KEYS.meta] = JSON.stringify(meta);
      await blobs.setJSON(id, { store: nextSnap, ts: new Date().toISOString() });
    },
  };
}

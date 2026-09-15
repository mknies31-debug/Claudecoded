// Firestore REST client for Netlify Functions — zero npm dependencies.
// Authenticates as a Google service account: builds an RS256 JWT with Node's
// crypto, trades it for an OAuth access token, then calls the Firestore REST API
// with plain fetch. Used by daily.js and inbound.js (Tier 2 only).
// Env vars (read by the caller, passed in): FIREBASE_PROJECT_ID,
// FIREBASE_SERVICE_ACCOUNT (the service-account JSON, raw OR base64-encoded).

'use strict';

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const REFRESH_EARLY_MS = 5 * 60 * 1000; // get a new token 5 min before expiry

// Module-scope token cache. Netlify keeps a warm function alive between
// invocations for a while, so this saves a round-trip to Google most runs.
// Keyed by client_email so two service accounts never share a token.
const tokenCache = new Map(); // client_email -> { token, expiresAt }

// ---------------------------------------------------------------------------
// Codec: plain JS <-> Firestore's typed JSON ("fields" / "stringValue" etc.)
// The browser app copies these two functions verbatim, so keep them dependency
// free and boring.
// ---------------------------------------------------------------------------

// encode(obj) -> { fields: { key: <Value> } }   (a Firestore Document body)
function encode(obj) {
  return { fields: encodeMap(obj || {}) };
}

function encodeMap(obj) {
  const fields = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) continue; // Firestore has no "undefined"; drop it
    fields[key] = encodeValue(obj[key]);
  }
  return fields;
}

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    // Firestore's integerValue is a string in JSON. Whole numbers go there;
    // anything else (1.5, NaN, Infinity) is a double.
    if (Number.isInteger(v) && Number.isSafeInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { stringValue: v.toISOString() }; // we store ISO strings, not timestamps
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeMap(v) } };
  // Functions, symbols, bigints: not storable. Fail loudly rather than write junk.
  throw new Error('firestore.encode: cannot store a value of type ' + typeof v);
}

// decode(doc) -> plain object. Accepts a Document ({name, fields}) or a bare
// {fields} object. Returns {} for a document with no fields.
function decode(doc) {
  if (!doc) return null;
  const fields = doc.fields || {};
  return decodeMap(fields);
}

function decodeMap(fields) {
  const out = {};
  for (const key of Object.keys(fields || {})) out[key] = decodeValue(fields[key]);
  return out;
}

function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue; // ISO string, matches our convention
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue; // base64 string
  if ('geoPointValue' in v) return { latitude: v.geoPointValue.latitude, longitude: v.geoPointValue.longitude };
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
  if ('mapValue' in v) return decodeMap((v.mapValue && v.mapValue.fields) || {});
  return null;
}

// The document id is the last segment of the resource name.
function docId(doc) {
  if (!doc || !doc.name) return '';
  return doc.name.slice(doc.name.lastIndexOf('/') + 1);
}

// ---------------------------------------------------------------------------
// Service-account parsing. Mick may paste the JSON into the Netlify env var
// either raw (starts with "{") or base64-encoded. Accept both, plus an object.
// ---------------------------------------------------------------------------
function parseServiceAccount(input) {
  if (!input) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set. Netlify → Site configuration → Environment variables.');
  if (typeof input === 'object') return input;
  let text = String(input).trim();
  if (!text.startsWith('{')) {
    // Assume base64. Tolerate URL-safe alphabet and missing padding.
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    text = Buffer.from(b64, 'base64').toString('utf8').trim();
  }
  let sa;
  try { sa = JSON.parse(text); } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is neither valid JSON nor base64 of valid JSON.');
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key. Download a fresh key from Firebase console → Project settings → Service accounts.');
  }
  return sa;
}

// ---------------------------------------------------------------------------
// OAuth: self-signed JWT (RS256) -> access token.
// ---------------------------------------------------------------------------
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildJwt(sa, nowSec) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signingInput = header + '.' + claims;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  return signingInput + '.' + base64url(signature);
}

async function getAccessToken(sa, fetchImpl) {
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt - REFRESH_EARLY_MS > Date.now()) return cached.token;

  const nowSec = Math.floor(Date.now() / 1000);
  const assertion = buildJwt(sa, nowSec);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Google OAuth rejected the service account (' + r.status + '): ' + text.slice(0, 300));
  const json = JSON.parse(text);
  const token = json.access_token;
  const expiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  tokenCache.set(sa.client_email, { token, expiresAt });
  return token;
}

// ---------------------------------------------------------------------------
// The client.
//   makeClient({ projectId, serviceAccountB64 })   (raw JSON also accepted)
//   -> { get, set, update, delete, list, runQuery }
// Paths are relative document paths like "customers/abc123" or "settings/main".
// get()  -> data object or null when missing
// set()  -> replaces the whole document (creates if missing)
// update() -> merges the given top-level keys into the document
// list(collection) -> [{ id, data }]  (all pages)
// runQuery(collection, where, { limit }) -> [{ id, data }]
//   where = [ ['status', 'EQUAL', 'active'], ['dueDate', 'LESS_THAN_OR_EQUAL', '2026-09-15'] ]
// ---------------------------------------------------------------------------
function makeClient(opts) {
  opts = opts || {};
  const projectId = opts.projectId;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set. Netlify → Site configuration → Environment variables.');
  const sa = parseServiceAccount(opts.serviceAccount || opts.serviceAccountB64);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const base = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents';

  async function call(method, url, bodyObj) {
    const token = await getAccessToken(sa, fetchImpl);
    const r = await fetchImpl(url, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!r.ok) {
      const msg = (json && json.error && json.error.message) || text.slice(0, 300);
      const err = new Error('Firestore ' + method + ' ' + r.status + ': ' + msg);
      err.status = r.status;
      throw err;
    }
    return json;
  }

  function docUrl(path) {
    // Encode each segment separately so "settings/main" keeps its slash.
    return base + '/' + String(path).split('/').map(encodeURIComponent).join('/');
  }

  // Field paths in updateMask must be backtick-quoted unless they are simple
  // identifiers. Ours always are, but be safe.
  function fieldPath(key) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : '`' + key.replace(/`/g, '\\`') + '`';
  }

  return {
    async get(path) {
      try {
        const doc = await call('GET', docUrl(path));
        return decode(doc);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    async set(path, data) {
      // PATCH without an updateMask replaces every field (and creates the doc).
      const doc = await call('PATCH', docUrl(path), encode(data));
      return decode(doc);
    },

    async update(path, data) {
      const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
      if (!keys.length) return this.get(path);
      const mask = keys.map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(fieldPath(k))).join('&');
      const doc = await call('PATCH', docUrl(path) + '?' + mask, encode(data));
      return decode(doc);
    },

    async delete(path) {
      await call('DELETE', docUrl(path));
      return true;
    },

    async list(collection) {
      const out = [];
      let pageToken = '';
      do {
        const qs = 'pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const res = await call('GET', docUrl(collection) + '?' + qs);
        for (const doc of (res && res.documents) || []) out.push({ id: docId(doc), data: decode(doc) });
        pageToken = (res && res.nextPageToken) || '';
      } while (pageToken);
      return out;
    },

    // where: array of [field, op, value]. Ops are Firestore names:
    // EQUAL, NOT_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL, GREATER_THAN,
    // GREATER_THAN_OR_EQUAL, ARRAY_CONTAINS, IN.
    // Combining a range filter with an equality on another field needs a
    // composite index in Firestore; keep queries simple or filter in JS.
    async runQuery(collection, where, options) {
      // Also accept runQuery(collection, { where, limit }).
      if (where && !Array.isArray(where) && typeof where === 'object') {
        options = where;
        where = where.where;
      }
      where = where || [];
      options = options || {};
      const filters = where.map(([field, op, value]) => ({
        fieldFilter: { field: { fieldPath: field }, op, value: encodeValue(value) },
      }));
      const structuredQuery = { from: [{ collectionId: collection }] };
      if (filters.length === 1) structuredQuery.where = filters[0];
      else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
      if (options.limit) structuredQuery.limit = Number(options.limit);
      if (options.orderBy) {
        structuredQuery.orderBy = [{ field: { fieldPath: options.orderBy }, direction: options.direction === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
      }
      const rows = await call('POST', base + ':runQuery', { structuredQuery });
      const out = [];
      for (const row of rows || []) {
        if (row && row.document) out.push({ id: docId(row.document), data: decode(row.document) });
      }
      return out;
    },
  };
}

// Random 20-char document id, same alphabet Firestore uses for auto ids.
function newId(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len || 20);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

module.exports = {
  makeClient,
  encode,
  decode,
  encodeValue,
  decodeValue,
  docId,
  newId,
  parseServiceAccount,
  buildJwt,
  _tokenCache: tokenCache,
};

// shared/import.mjs — CLEAN API: bulk CSV import.
//
// Pure, isomorphic CSV → customer planning. The browser reads a file and hands
// the text here; this returns a reviewable plan (ready / duplicate / invalid per
// row) WITHOUT touching storage. crm.js shows the plan and only then saves.
//
// Two niceties that matter for a real book of business:
//   - flexible headers (First Name / Cell / Customer / Date all map correctly)
//   - a purchase-date column slots an old customer into the RIGHT stage so they
//     don't get blasted with the "welcome" sequence years after the sale.

import { validateCustomer, digits, toDateStr } from './schema.mjs';
import { daysSincePurchase, stageForElapsedDays } from './sequences.mjs';
import { parseFullName, extractPhone } from './intake.mjs';

/** Minimal, correct CSV parser (quotes, escaped quotes, commas, CRLF). */
export function parseCSV(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim().length));
}

// Header text → canonical field. Keys are normalized (lowercase, alnum only).
const HEADER_ALIASES = {
  firstname: 'firstName', first: 'firstName', fname: 'firstName', givenname: 'firstName',
  lastname: 'lastName', last: 'lastName', lname: 'lastName', surname: 'lastName',
  name: 'name', fullname: 'name', customer: 'name', customername: 'name', client: 'name', buyer: 'name',
  phone: 'phone', phonenumber: 'phone', cell: 'phone', cellphone: 'phone', mobile: 'phone', tel: 'phone', telephone: 'phone',
  email: 'email', emailaddress: 'email', mail: 'email',
  vehicle: 'vehicle', car: 'vehicle', unit: 'vehicle', auto: 'vehicle',
  address: 'address', addr: 'address', street: 'address', city: 'address', location: 'address',
  notes: 'notes', note: 'notes', comment: 'notes', comments: 'notes', memo: 'notes',
  purchasedate: 'purchaseDate', date: 'purchaseDate', dateofpurchase: 'purchaseDate', solddate: 'purchaseDate', purchased: 'purchaseDate', deliverydate: 'purchaseDate', dop: 'purchaseDate', saledate: 'purchaseDate',
};

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map a header row to canonical field names by column index. */
export function mapHeaders(headerRow) {
  return headerRow.map((h) => HEADER_ALIASES[norm(h)] || null);
}

/** Turn one data row (+ the mapped header) into a customer input object. */
export function rowToInput(cells, fields) {
  const get = (f) => { const i = fields.indexOf(f); return i >= 0 ? String(cells[i] || '').trim() : ''; };
  let firstName = get('firstName');
  let lastName = get('lastName');
  const full = get('name');
  if (!firstName && full) { const n = parseFullName(full); firstName = n.firstName; lastName = lastName || n.lastName; }
  const rawPhone = get('phone');
  const phone = rawPhone ? (extractPhone(rawPhone) || rawPhone) : '';
  return {
    firstName, lastName, phone,
    email: get('email'), vehicle: get('vehicle'), address: get('address'),
    // Normalize the date NOW (toDateStr tolerates MM/DD/YYYY, ISO, etc.) so the
    // stage-slotting below and daysSincePurchase get a clean YYYY-MM-DD, not a
    // raw spreadsheet string that would parse to NaN and mis-slot the customer.
    notes: get('notes'), purchaseDate: toDateStr(get('purchaseDate')),
  };
}

/**
 * Build a reviewable import plan from CSV text.
 * @returns {{ items: Array<{input, status, reason}>, counts, hasHeader }}
 *   status ∈ 'ready' | 'duplicate' | 'invalid'
 */
export function planImport(csvText, existing = [], today = new Date()) {
  const rows = parseCSV(csvText);
  if (!rows.length) return { items: [], counts: { total: 0, ready: 0, duplicate: 0, invalid: 0 }, hasHeader: false };

  const fields = mapHeaders(rows[0]);
  const hasHeader = fields.some(Boolean);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const useFields = hasHeader ? fields : ['firstName', 'lastName', 'phone', 'email', 'vehicle']; // positional fallback

  const seen = new Set(existing.map((c) => digits(c.phone)).filter(Boolean));
  const items = dataRows.map((cells) => {
    const input = rowToInput(cells, useFields);
    const v = validateCustomer(input);
    if (!v.ok) return { input, status: 'invalid', reason: Object.values(v.errors)[0] };
    const ph = digits(input.phone);
    if (ph && seen.has(ph)) return { input, status: 'duplicate', reason: 'phone already in your list' };
    if (ph) seen.add(ph);
    if (input.purchaseDate) {
      const days = daysSincePurchase({ purchaseDate: input.purchaseDate }, today);
      if (days > 0) input.stage = stageForElapsedDays(days); // slot into the timeline
    }
    return { input, status: 'ready' };
  });

  const counts = {
    total: items.length,
    ready: items.filter((x) => x.status === 'ready').length,
    duplicate: items.filter((x) => x.status === 'duplicate').length,
    invalid: items.filter((x) => x.status === 'invalid').length,
  };
  return { items, counts, hasHeader };
}

/** The columns the importer understands (for the UI hint / template). */
export const IMPORT_COLUMNS = ['First Name', 'Last Name', 'Phone', 'Email', 'Vehicle', 'Address', 'Notes', 'Purchase Date'];

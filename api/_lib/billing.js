// api/_lib/billing.js — Mercury wire billing. Squadron issues an invoice with
// a unique reference, the customer wires it to the Squadron account at
// Mercury, and a reconciler reads incoming transactions (read-only token) and
// marks the invoice paid when the amount matches and the reference appears.

import { sql } from './db.js';
import { ensureAuthSchema } from './auth.js';

const API = 'https://api.mercury.com/api/v1';

// Plan prices are the published $99 / $299 / $799. Packs are sold at a
// markup over their provider cost; the owner can change these numbers.
export const PRICES = {
  scout: { kind: 'plan', label: 'Scout plan, one month', cents: 9900 },
  commander: { kind: 'plan', label: 'Commander plan, one month', cents: 29900 },
  hq: { kind: 'plan', label: 'Command HQ plan, one month', cents: 79900 },
  minutes100: { kind: 'pack', label: '100 extra voice minutes', cents: 2500, minutes: 100 },
  chats500: { kind: 'pack', label: '500 extra chat conversations', cents: 1500, conversations: 500 },
};

export const BENEFICIARY = {
  name: process.env.MERCURY_BENEFICIARY_NAME || 'Island Global Company',
  address: process.env.MERCURY_BENEFICIARY_ADDRESS || '548 Market St PMB 35309, San Francisco, CA 94104',
  bank: 'Column N.A. (via Mercury)',
};

export async function ensureBillingSchema() {
  await ensureAuthSchema();
  await sql().query(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    item TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    mercury_tx_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    period_end TIMESTAMPTZ
  )`);
  await sql().query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paid_through TIMESTAMPTZ');
}

function headers() {
  const key = process.env.MERCURY_API_KEY;
  if (!key) throw new Error('MERCURY_API_KEY is not configured');
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

let _acct = null;
export async function receivingAccount() {
  if (_acct) return _acct;
  const id = process.env.MERCURY_ACCOUNT_ID;
  const r = await fetch(`${API}/account/${id}`, { headers: headers() });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mercury account lookup failed (${r.status}): ${text.slice(0, 200)}`);
  const a = JSON.parse(text);
  _acct = { routingNumber: a.routingNumber, accountNumber: a.accountNumber, name: a.name || a.nickname || 'Squadron' };
  return _acct;
}

export function newReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
  return 'SQ-' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function wireInstructions(invoice) {
  const acct = await receivingAccount();
  return {
    reference: invoice.reference,
    amount: invoice.amount_cents / 100,
    bank: BENEFICIARY.bank,
    routingNumber: acct.routingNumber,
    accountNumber: acct.accountNumber,
    beneficiaryName: BENEFICIARY.name,
    beneficiaryAddress: BENEFICIARY.address,
    memo: `${invoice.reference} ${invoice.label}`.slice(0, 140),
  };
}

// Reads recent incoming Mercury transactions and marks matching invoices paid.
export async function reconcile() {
  await ensureBillingSchema();
  const pending = await sql().query("SELECT * FROM invoices WHERE status = 'pending' AND created_at > now() - interval '60 days'");
  if (!pending.length) return { checked: 0, paid: [] };
  const since = new Date(Math.min(...pending.map((p) => new Date(p.created_at).getTime())) - 86400000).toISOString().slice(0, 10);
  const r = await fetch(`${API}/account/${process.env.MERCURY_ACCOUNT_ID}/transactions?limit=500&start=${since}`, { headers: headers() });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mercury transactions failed (${r.status}): ${text.slice(0, 200)}`);
  const txs = (JSON.parse(text).transactions || []).filter((t) => t.amount > 0 && t.status !== 'failed' && t.status !== 'cancelled');
  const paid = [];
  for (const inv of pending) {
    const ref = inv.reference.toUpperCase();
    const hit = txs.find((t) => {
      const hay = [t.externalMemo, t.note, t.bankDescription, t.counterpartyName, JSON.stringify(t.details || {})].join(' ').toUpperCase();
      return Math.round(t.amount * 100) === inv.amount_cents && hay.includes(ref);
    });
    if (!hit) continue;
    const used = await sql().query('SELECT 1 FROM invoices WHERE mercury_tx_id = $1', [hit.id]);
    if (used.length) continue;
    await markPaid(inv, hit.id);
    paid.push(inv.id);
  }
  return { checked: pending.length, paid };
}

export async function markPaid(inv, txId) {
  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  await sql().query("UPDATE invoices SET status = 'paid', paid_at = now(), mercury_tx_id = $2, period_end = $3 WHERE id = $1", [inv.id, txId, periodEnd]);
  if (inv.kind === 'plan') {
    await sql().query("UPDATE accounts SET plan = $2, paid_through = GREATEST(COALESCE(paid_through, now()), now()) + interval '30 days' WHERE id = $1", [inv.account_id, inv.item]);
  }
}

// Extra allowance from packs paid during the current month.
export async function packAllowance(accountId, periodStart) {
  if (!accountId) return { minutes: 0, conversations: 0 };
  await ensureBillingSchema();
  const rows = await sql().query("SELECT item FROM invoices WHERE account_id = $1 AND kind = 'pack' AND status = 'paid' AND paid_at >= $2", [accountId, periodStart]);
  let minutes = 0, conversations = 0;
  for (const r of rows) { const p = PRICES[r.item]; if (p) { minutes += p.minutes || 0; conversations += p.conversations || 0; } }
  return { minutes, conversations };
}

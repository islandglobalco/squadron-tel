// api/_lib/stripe.js — card payments through Stripe Checkout, alongside
// Mercury wires. Each checkout pays one Squadron invoice in full, up front,
// for one 30-day period; nothing renews automatically.
//
// No webhook secret is needed: a payment is only accepted after Squadron
// reads the Checkout Session back from the Stripe API with its own key, and
// confirms the invoice id, the amount and the paid status. The success
// redirect, the billing page and the every-minute sweep all run that check.
// Disputes and refunds end the paid period at once, so a clawed-back payment
// cannot keep funding usage.

import { sql } from './db.js';
import { ensureBillingSchema, createInvoice, markPaid, PRICES } from './billing.js';

const API = 'https://api.stripe.com/v1';
const ORIGIN = 'https://www.squadron.tel';

export function stripeEnabled() { return !!process.env.STRIPE_SECRET_KEY; }

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, { method = 'GET', body } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Card payments are not switched on yet. Please pay by bank transfer.');
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: body ? form(body).toString() : undefined,
  });
  const text = await r.text();
  const j = JSON.parse(text || '{}');
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${(j.error && j.error.message) || text.slice(0, 200)}`);
  return j;
}

async function ensureStripeSchema() {
  await ensureBillingSchema();
  await sql().query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_session TEXT');
  await sql().query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT');
}

// Creates (or reuses) the pending invoice and a Checkout Session for it.
export async function startCheckout(account, item, { returnTo } = {}) {
  await ensureStripeSchema();
  const p = PRICES[item];
  if (!p) throw new Error('Unknown item');
  const { invoice } = await createInvoice(account.id, item);
  const back = returnTo && returnTo.startsWith('/') ? returnTo : '/billing';
  const sep = back.includes('?') ? '&' : '?';
  const session = await stripe('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      client_reference_id: invoice.id,
      customer_email: account.email,
      success_url: `${ORIGIN}${back}${sep}stripe_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ORIGIN}${back}`,
      metadata: { invoice_id: invoice.id, reference: invoice.reference, account_id: account.id },
      payment_intent_data: { description: `Squadron ${invoice.reference}: ${invoice.label}`, metadata: { invoice_id: invoice.id, reference: invoice.reference } },
      line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: invoice.amount_cents, product_data: { name: `Squadron: ${invoice.label}` } } } },
    },
  });
  await sql().query('UPDATE invoices SET stripe_session = $2 WHERE id = $1', [invoice.id, session.id]);
  return { url: session.url, invoiceId: invoice.id };
}

// Reads a Checkout Session from Stripe and marks its invoice paid when, and
// only when, Stripe says it is paid for the exact amount of that invoice.
export async function confirmSession(sessionId) {
  await ensureStripeSchema();
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return { paid: false };
  const s = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.payment_status !== 'paid' || s.status !== 'complete') return { paid: false };
  const invId = s.client_reference_id || (s.metadata && s.metadata.invoice_id);
  const inv = (await sql().query('SELECT * FROM invoices WHERE id = $1', [invId]))[0];
  if (!inv || s.amount_total !== inv.amount_cents || s.currency !== 'usd') return { paid: false };
  if (inv.status === 'paid') return { paid: true, invoice: inv, already: true };
  if (inv.status !== 'pending') return { paid: false };
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent && s.payment_intent.id);
  await sql().query('UPDATE invoices SET stripe_payment_intent = $2 WHERE id = $1', [inv.id, pi]);
  const done = await markPaid(inv, `stripe:${pi}`);
  return { paid: !!done, invoice: inv };
}

// Every minute: confirms any open card checkouts, and ends the paid period of
// any invoice whose card payment was disputed or refunded.
export async function reconcileStripe() {
  if (!stripeEnabled()) return { enabled: false };
  await ensureStripeSchema();
  const open = await sql().query("SELECT stripe_session FROM invoices WHERE status = 'pending' AND stripe_session IS NOT NULL AND created_at > now() - interval '2 days'");
  let confirmed = 0;
  for (const o of open) { try { if ((await confirmSession(o.stripe_session)).paid) confirmed++; } catch (e) { console.error('[stripe confirm]', e.message); } }
  const since = Math.floor(Date.now() / 1000) - 3 * 86400;
  const lost = new Set();
  const disputes = await stripe(`/disputes?limit=100&created[gte]=${since}`);
  for (const d of disputes.data || []) if (d.payment_intent) lost.add(typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent.id);
  const refunds = await stripe(`/refunds?limit=100&created[gte]=${since}`);
  for (const r of refunds.data || []) if (r.payment_intent && r.status !== 'failed' && r.status !== 'canceled') lost.add(r.payment_intent);
  let revoked = 0;
  for (const pi of lost) {
    const inv = (await sql().query("SELECT * FROM invoices WHERE stripe_payment_intent = $1 AND status = 'paid'", [pi]))[0];
    if (!inv) continue;
    await sql().query("UPDATE invoices SET status = 'reversed', period_end = LEAST(COALESCE(period_end, now()), now()) WHERE id = $1", [inv.id]);
    if (inv.kind === 'plan') await sql().query('UPDATE accounts SET paid_through = LEAST(COALESCE(paid_through, now()), now()) WHERE id = $1', [inv.account_id]);
    revoked++;
  }
  return { enabled: true, confirmed, revoked };
}

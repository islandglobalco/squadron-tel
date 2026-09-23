// /api/billing — the signed-in owner's plan, prepaid balance, invoices and
// wire instructions. POST { action: 'invoice', item } creates an invoice;
// { action: 'check' } asks Mercury whether any pending wire has arrived.
// { action: 'card', item, returnTo } starts a Stripe Checkout for the item and
// returns its URL; { action: 'confirm', session } confirms a finished card
// payment by reading the session back from Stripe.
// Top-ups can only be bought for a running paid period.
import { sql, readJson, bad } from './_lib/db.js';
import { currentAccount, PLANS } from './_lib/auth.js';
import { ensureBillingSchema, PRICES, wireInstructions, reconcile, createInvoice } from './_lib/billing.js';
import { ledgerStatus } from './_lib/ledger.js';
import { sendEmail } from './_lib/email.js';
import { startCheckout, confirmSession, stripeEnabled } from './_lib/stripe.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureBillingSchema();
    const acc = await currentAccount(req);
    if (!acc) return bad(res, 401, 'Sign in first.');
    const body = req.method === 'POST' ? readJson(req) : {};
    let notice = null;
    let st = await ledgerStatus(acc.id);
    if (body.action === 'invoice') {
      const p = PRICES[body.item];
      if (!p) return bad(res, 400, 'Unknown item');
      if (p.kind === 'pack' && !st.active) return bad(res, 400, 'Extra minutes are added to a running paid plan. Choose and pay for a plan first.');
      const { invoice, created } = await createInvoice(acc.id, body.item);
      if (created) {
        const w = await wireInstructions(invoice);
        await sendEmail({ to: acc.email, subject: `Your Squadron invoice ${invoice.reference} ($${(invoice.amount_cents / 100).toFixed(2)})`, text: `Thank you for choosing Squadron. Squadron is prepaid, so your team starts as soon as this payment lands.\n\n${invoice.label}\nAmount: $${(invoice.amount_cents / 100).toFixed(2)}\nReference (put this in the wire or ACH memo): ${invoice.reference}\nBank: ${w.bank}\nRouting number: ${w.routingNumber}\nAccount number: ${w.accountNumber}\nBeneficiary: ${w.beneficiaryName}, ${w.beneficiaryAddress}\n\nWe email you as soon as the payment arrives. To pay by card instead, which switches your team on at once, open Billing: https://www.squadron.tel/billing` }).catch((e) => console.error('[billing email]', e.message));
      }
    } else if (body.action === 'card') {
      const p = PRICES[body.item];
      if (!p) return bad(res, 400, 'Unknown item');
      if (p.kind === 'pack' && !st.active) return bad(res, 400, 'Extra minutes are added to a running paid plan. Choose and pay for a plan first.');
      const out = await startCheckout(acc, body.item, { returnTo: String(body.returnTo || '/billing') });
      return res.status(200).json({ url: out.url });
    } else if (body.action === 'confirm') {
      const r = await confirmSession(String(body.session || ''));
      if (r.paid && r.invoice && r.invoice.account_id === acc.id) {
        notice = `Payment received: ${r.invoice.label}. Your team is switched on.`;
        if (!r.already) await sendEmail({ to: acc.email, subject: `Payment received: ${r.invoice.label}`, text: `Thank you. Your card payment for ${r.invoice.label} ($${(r.invoice.amount_cents / 100).toFixed(2)}, reference ${r.invoice.reference}) is received, and it is applied to your Squadron account.\n\nBilling: https://www.squadron.tel/billing` }).catch((e) => console.error('[billing email]', e.message));
      } else notice = 'The card payment is not complete yet. If you finished it, wait a moment and reload this page.';
      st = await ledgerStatus(acc.id);
    } else if (body.action === 'check') {
      const r = await reconcile();
      notice = r.paid.length ? `Payment received for ${r.paid.length} invoice${r.paid.length > 1 ? 's' : ''}.` : 'No matching wire has arrived yet. Wires usually land the same business day.';
      st = await ledgerStatus(acc.id);
    } else if (body.action === 'cancel' && body.id) {
      await sql().query("UPDATE invoices SET status = 'cancelled' WHERE id = $1 AND account_id = $2 AND status = 'pending'", [body.id, acc.id]);
    }
    const invoices = await sql().query('SELECT id, item, kind, label, amount_cents, reference, status, created_at, paid_at, period_start, period_end FROM invoices WHERE account_id = $1 AND status <> $2 ORDER BY created_at DESC LIMIT 50', [acc.id, 'cancelled']);
    const out = [];
    for (const inv of invoices) out.push(inv.status === 'pending' ? { ...inv, wire: await wireInstructions(inv) } : inv);
    return res.status(200).json({
      account: { email: acc.email },
      status: {
        active: st.active, plan: st.planKey, planInfo: st.plan, periodStart: st.periodStart, periodEnd: st.periodEnd,
        minutesIncluded: st.minutesIncluded, minutesUsed: st.minutesUsed, minutesRemaining: st.minutesRemaining,
        prepaidCents: st.prepaidCents, balancePercent: st.budgetCents ? Math.max(0, Math.round((st.remainingCents / st.budgetCents) * 100)) : 0,
      },
      plans: PLANS, prices: PRICES, invoices: out, notice, cards: stripeEnabled(),
    });
  } catch (e) {
    console.error('[billing]', e);
    return bad(res, 500, e.message);
  }
}

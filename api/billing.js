// /api/billing — the signed-in owner's plan, invoices and wire instructions.
// POST { action: 'invoice', item } creates an invoice; { action: 'check' }
// asks Mercury whether any pending wire has arrived.
import { sql, newId, readJson, bad } from './_lib/db.js';
import { currentAccount, PLANS } from './_lib/auth.js';
import { ensureBillingSchema, PRICES, newReference, wireInstructions, reconcile } from './_lib/billing.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureBillingSchema();
    const acc = await currentAccount(req);
    if (!acc) return bad(res, 401, 'Sign in first.');
    const body = req.method === 'POST' ? readJson(req) : {};
    let notice = null;
    if (body.action === 'invoice') {
      const p = PRICES[body.item];
      if (!p) return bad(res, 400, 'Unknown item');
      const open = await sql().query("SELECT id FROM invoices WHERE account_id = $1 AND item = $2 AND status = 'pending'", [acc.id, body.item]);
      if (!open.length) await sql().query('INSERT INTO invoices (id, account_id, item, kind, label, amount_cents, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)', [newId('inv'), acc.id, body.item, p.kind, p.label, p.cents, newReference()]);
    } else if (body.action === 'check') {
      const r = await reconcile();
      notice = r.paid.length ? `Payment received for ${r.paid.length} invoice${r.paid.length > 1 ? 's' : ''}.` : 'No matching wire has arrived yet. Wires usually land the same business day.';
    } else if (body.action === 'cancel' && body.id) {
      await sql().query("UPDATE invoices SET status = 'cancelled' WHERE id = $1 AND account_id = $2 AND status = 'pending'", [body.id, acc.id]);
    }
    const fresh = (await sql().query('SELECT plan, trial_ends_at, paid_through FROM accounts WHERE id = $1', [acc.id]))[0];
    const invoices = await sql().query('SELECT id, item, kind, label, amount_cents, reference, status, created_at, paid_at FROM invoices WHERE account_id = $1 AND status <> $2 ORDER BY created_at DESC LIMIT 50', [acc.id, 'cancelled']);
    const out = [];
    for (const inv of invoices) out.push(inv.status === 'pending' ? { ...inv, wire: await wireInstructions(inv) } : inv);
    return res.status(200).json({
      account: { email: acc.email, plan: fresh.plan, planInfo: PLANS[fresh.plan] || PLANS.trial, trialEndsAt: fresh.trial_ends_at, paidThrough: fresh.paid_through },
      prices: PRICES, invoices: out, notice,
    });
  } catch (e) {
    console.error('[billing]', e);
    return bad(res, 500, e.message);
  }
}

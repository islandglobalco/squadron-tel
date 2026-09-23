// /api/billing-cron — hourly reconciliation of incoming Mercury wires.
import { reconcile } from './_lib/billing.js';

export default async function handler(req, res) {
  const want = process.env.CRON_SECRET;
  if (!want || req.headers.authorization !== `Bearer ${want}`) return res.status(401).json({ error: 'unauthorized' });
  try { return res.status(200).json(await reconcile()); }
  catch (e) { console.error('[billing-cron]', e); return res.status(500).json({ error: e.message }); }
}

// /api/demo-number — assigns a pooled demo number to a business for fifteen
// minutes so the owner can call their team from a real phone.
import { sql, bad, loadBusiness, readJson } from './_lib/db.js';
import { ensureBridgeSchema } from './_lib/bridge.js';

const MINUTES = 15;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const token = req.method === 'GET' ? req.query?.token : body.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureBridgeSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const pool = await sql().query('SELECT number, business_id, expires_at FROM demo_numbers ORDER BY number');
    if (!pool.length) return res.status(200).json({ available: false, reason: 'No demo numbers are configured yet.' });
    const mine = pool.find((n) => n.business_id === biz.id && n.expires_at && new Date(n.expires_at) > new Date());
    if (req.method === 'GET') return res.status(200).json({ available: true, number: mine ? mine.number : null, expiresAt: mine ? mine.expires_at : null });
    if (mine) {
      await sql().query(`UPDATE demo_numbers SET expires_at = now() + interval '${MINUTES} minutes' WHERE number = $1`, [mine.number]);
      return res.status(200).json({ available: true, number: mine.number, expiresAt: new Date(Date.now() + MINUTES * 60000).toISOString() });
    }
    const free = pool.find((n) => !n.expires_at || new Date(n.expires_at) <= new Date());
    if (!free) return res.status(200).json({ available: false, reason: 'Every demo number is in use right now. Try again in a few minutes.' });
    await sql().query(`UPDATE demo_numbers SET business_id = $2, assigned_at = now(), expires_at = now() + interval '${MINUTES} minutes' WHERE number = $1`, [free.number, biz.id]);
    return res.status(200).json({ available: true, number: free.number, expiresAt: new Date(Date.now() + MINUTES * 60000).toISOString() });
  } catch (e) {
    console.error('[demo-number]', e);
    return bad(res, 500, e.message);
  }
}

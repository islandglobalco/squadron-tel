// /api/ingest/extract — turns the stored sources into the Business Profile.
import { ensureSchema, sql, loadBusiness, readJson, bad } from '../_lib/db.js';
import { buildProfile } from '../_lib/profile.js';
import { textCostCents, HOLD, PaymentRequired } from '../_lib/ledger.js';
import { fundSetup, recordSetupSpend } from '../_lib/setup.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const { token } = readJson(req);
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const docs = await sql().query('SELECT kind, url, title, content FROM sources WHERE business_id = $1 ORDER BY id', [biz.id]);
    if (!docs.length) return bad(res, 400, 'No sources to read yet.');
    // Free during setup (capped); a paid plan covers it once the team is live.
    const funding = await fundSetup({ biz, kind: 'profile', cents: HOLD.profile, req });
    const { profile, model, usage } = await buildProfile(docs);
    await recordSetupSpend(funding, { biz, kind: 'profile', cents: textCostCents(model, usage), req });
    await sql().query(
      `INSERT INTO profiles (business_id, profile, model) VALUES ($1, $2, $3)
       ON CONFLICT (business_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, updated_at = now()`,
      [biz.id, JSON.stringify(profile), model]);
    await sql().query("UPDATE businesses SET status = 'profiled', updated_at = now() WHERE id = $1", [biz.id]);
    return res.status(200).json({ ok: true, profile, model, usage: usage ? { input: usage.input_tokens, output: usage.output_tokens } : null });
  } catch (e) {
    if (e instanceof PaymentRequired) return res.status(402).json({ error: e.message, code: e.code });
    console.error('[extract]', e);
    return bad(res, 500, e.message);
  }
}

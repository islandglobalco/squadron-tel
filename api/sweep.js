// /api/sweep — every minute. A safety net for the prepaid limit: any browser
// voice session still open past its time limit is hung up and its hold is
// settled in full. Phone calls are ended by the bridge itself.
import { sql } from './_lib/db.js';
import { ensureLedgerSchema } from './_lib/ledger.js';
import { apiKey } from './_lib/openai.js';

export default async function handler(req, res) {
  const want = process.env.CRON_SECRET;
  if (!want || req.headers.authorization !== `Bearer ${want}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    await ensureLedgerSchema();
    const stale = await sql().query("SELECT id, ref FROM spend WHERE settled = false AND ref LIKE 'rt:%' AND created_at + (seconds + 20) * interval '1 second' < now()");
    for (const s of stale) {
      const callId = s.ref.slice(3);
      try { await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` } }); } catch (e) { console.error('[sweep]', e.message); }
      await sql().query('UPDATE spend SET settled = true WHERE id = $1', [s.id]);
    }
    return res.status(200).json({ swept: stale.length });
  } catch (e) {
    console.error('[sweep]', e);
    return res.status(500).json({ error: e.message });
  }
}

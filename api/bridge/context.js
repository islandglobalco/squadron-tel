// /api/bridge/context?number=+1... — tells the bridge which business answers
// an inbound number and what to say before the stream starts.
import { bad } from '../_lib/db.js';
import { loadProfile } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema, businessForNumber } from '../_lib/bridge.js';
import { applyCorrections } from '../_lib/profile.js';
import { usageFor } from '../_lib/usage.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  const number = String(req.query?.number || '');
  if (!number) return bad(res, 400, 'number required');
  try {
    await ensureBridgeSchema();
    const hit = await businessForNumber(number);
    if (!hit) return res.status(200).json({ ok: false, reason: 'unassigned' });
    const prow = await loadProfile(hit.biz.id);
    const profile = prow ? applyCorrections(prow.profile, prow.corrections) : null;
    const name = profile?.company?.name?.value || hit.biz.input_value;
    if (!hit.demo && !(hit.biz.channels && hit.biz.channels.phone && hit.biz.channels.phone.enabled)) return res.status(200).json({ ok: false, reason: 'phone channel off' });
    if (!hit.demo && (await usageFor(hit.biz.id)).paused) return res.status(200).json({ ok: false, reason: 'paused' });
    return res.status(200).json({ ok: true, businessId: hit.biz.id, businessName: name, demo: hit.demo });
  } catch (e) {
    console.error('[bridge/context]', e);
    return bad(res, 500, e.message);
  }
}

// /api/bridge/session?businessId=... — the Realtime session (instructions,
// voice, tools) for a business's phone line, plus settings the bridge needs.
import { sql, bad, loadProfile, loadTeam } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema } from '../_lib/bridge.js';
import { applyCorrections } from '../_lib/profile.js';
import { voiceSession } from '../_lib/voice.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  const businessId = String(req.query?.businessId || '');
  try {
    await ensureBridgeSchema();
    const rows = await sql().query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    const biz = rows[0];
    if (!biz) return bad(res, 404, 'Unknown business');
    const [prow, team] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id)]);
    if (!prow || !team) return bad(res, 400, 'No profile or team');
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    const business = { name: profile.company?.name?.value || biz.input_value };
    const session = voiceSession({ business, agents, profile, channel: 'phone', settings: biz.settings || null, recordingNotice: true, withLookup: true });
    return res.status(200).json({ ok: true, session, agent: { id: agents[0].id, persona: agents[0].persona, title: agents[0].title }, settings: biz.settings || {}, businessName: business.name });
  } catch (e) {
    console.error('[bridge/session]', e);
    return bad(res, 500, e.message);
  }
}

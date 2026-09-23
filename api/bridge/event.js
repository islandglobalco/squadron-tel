// /api/bridge/event — tool calls from a live phone call that need data:
// knowledge lookup today; more later.
import { bad, loadProfile, readJson } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema, searchChunks } from '../_lib/bridge.js';
import { applyCorrections } from '../_lib/profile.js';
import { knowledgeChunks } from '../_lib/answer.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  try {
    await ensureBridgeSchema();
    if (body.type === 'lookup') {
      const prow = await loadProfile(String(body.businessId || ''));
      if (!prow) return res.status(200).json({ results: [] });
      const { chunks } = knowledgeChunks(applyCorrections(prow.profile, prow.corrections));
      return res.status(200).json({ results: searchChunks(chunks, body.query).map((c) => c.text) });
    }
    return bad(res, 400, 'unknown event');
  } catch (e) {
    console.error('[bridge/event]', e);
    return bad(res, 500, e.message);
  }
}

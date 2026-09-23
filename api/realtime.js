// /api/realtime — opens a WebRTC voice session with a business's team for the
// browser test harness. The browser POSTs its SDP offer; the key stays here.
import { ensureSchema, loadBusiness, loadProfile, loadTeam, readJson, bad } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { apiKey } from './_lib/openai.js';
import { voiceSession } from './_lib/voice.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST an SDP offer');
  const body = readJson(req);
  const { token, sdp } = body;
  if (!token) return bad(res, 400, 'token required');
  if (!sdp || !sdp.startsWith('v=')) return bad(res, 400, 'sdp offer required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const [prow, team] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id)]);
    if (!prow || !team) return bad(res, 400, 'Build the profile and the team first.');
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    if (!agents.length) return bad(res, 400, 'Every agent is turned off.');
    const business = { name: profile.company?.name?.value || biz.input_value };
    const session = voiceSession({ business, agents, profile, channel: 'voice', settings: null, recordingNotice: false });
    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set('session', JSON.stringify(session));
    const r = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: fd });
    const text = await r.text();
    if (!r.ok) { console.error('[realtime]', r.status, text.slice(0, 400)); return bad(res, 502, `Voice session failed (${r.status}).`); }
    if (!text.startsWith('v=')) return bad(res, 502, 'Voice session returned no answer.');
    return res.status(200).json({ sdp: text, model: session.model, voice: session.audio.output.voice, agent: { id: agents[0].id, persona: agents[0].persona, title: agents[0].title, portrait: agents[0].portrait }, agents: agents.map((a) => ({ id: a.id, persona: a.persona, title: a.title, portrait: a.portrait })) });
  } catch (e) {
    console.error('[realtime]', e);
    return bad(res, 500, e.message);
  }
}

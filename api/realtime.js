// /api/realtime — opens a WebRTC voice session with a business's team for the
// browser test harness. The browser POSTs its SDP offer; the key stays here.
// Free during setup up to a per-business allowance, then the prepaid plan
// pays. A hold for the worst case is placed first, and Squadron hangs the call up itself at the time
// limit. { action: 'end', callId } ends it early and settles the hold on
// server-measured time.
import { ensureSchema, loadBusiness, loadProfile, loadTeam, readJson, bad } from './_lib/db.js';
import { applyCorrections } from './_lib/profile.js';
import { apiKey } from './_lib/openai.js';
import { voiceSession } from './_lib/voice.js';
import { waitUntil } from '@vercel/functions';
import { sql } from './_lib/db.js';
import { placeHold, settleHold, maxVoiceSeconds, ledgerStatus, HOLD, PaymentRequired } from './_lib/ledger.js';
import { fundSetup } from './_lib/setup.js';

const TEST_CAP_SECONDS = 240;

async function hangup(callId) {
  try { await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` } }); } catch (e) { console.error('[realtime hangup]', e.message); }
}

async function finish(ref, callId, startedAt) {
  await hangup(callId);
  const seconds = Math.max(1, (Date.now() - startedAt) / 1000);
  await settleHold(ref, { cents: (seconds / 60) * HOLD.voicePerMinute, seconds });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST an SDP offer');
  const body = readJson(req);
  const { token, sdp } = body;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    if (body.action === 'end') {
      const callId = String(body.callId || '');
      const row = (await sql().query('SELECT created_at FROM spend WHERE ref = $1 AND business_id = $2 AND settled = false', [`rt:${callId}`, biz.id]))[0];
      if (row) await finish(`rt:${callId}`, callId, new Date(row.created_at).getTime());
      return res.status(200).json({ ok: true });
    }
    if (!sdp || !sdp.startsWith('v=')) return bad(res, 400, 'sdp offer required');
    // Free during setup (capped per business); the plan pays once there is one.
    const funding = await fundSetup({ biz, kind: 'voice-test', cents: HOLD.voicePerMinute, req });
    const limit = funding.paid
      ? maxVoiceSeconds(funding.status, { capSeconds: TEST_CAP_SECONDS, countsMinutes: false })
      : Math.min(TEST_CAP_SECONDS, funding.voiceSecondsLeft);
    if (limit < (funding.paid ? 30 : 20)) return res.status(402).json({ error: 'Your prepaid balance for this period is too low for a test call. Add a top-up in Billing.', code: 'payment_required' });
    const [prow, team] = await Promise.all([loadProfile(biz.id), loadTeam(biz.id)]);
    if (!prow || !team) return bad(res, 400, 'Build the profile and the team first.');
    const profile = applyCorrections(prow.profile, prow.corrections);
    const agents = team.agents.agents.filter((a) => a.enabled !== false);
    if (!agents.length) return bad(res, 400, 'Every agent is turned off.');
    const business = { name: profile.company?.name?.value || biz.input_value };
    const session = voiceSession({ business, agents, profile, channel: 'voice', settings: null, recordingNotice: false });
    const fd = new FormData();
    fd.set('sdp', sdp);
    const { speaker, ...openaiSession } = session; // speaker is Squadron-only metadata
    fd.set('session', JSON.stringify(openaiSession));
    const r = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: fd });
    const text = await r.text();
    if (!r.ok) { console.error('[realtime]', r.status, text.slice(0, 400)); return bad(res, 502, `Voice session failed (${r.status}).`); }
    if (!text.startsWith('v=')) return bad(res, 502, 'Voice session returned no answer.');
    const callId = ((r.headers.get('location') || '').split('/').filter(Boolean).pop()) || '';
    // Without a call id Squadron could not end the call itself, so the answer
    // is withheld and the browser never connects (nothing is spent).
    if (!callId) { console.error('[realtime] no call id in Location header'); return bad(res, 502, 'Voice session could not be metered, so it was not started.'); }
    const ref = `rt:${callId}`;
    const startedAt = Date.now();
    await placeHold({ accountId: funding.accountId, businessId: biz.id, kind: 'voice-test', maxSeconds: limit, countsMinutes: false, ref });
    // A second session started at the same moment must not overdraw the budget.
    const after = funding.paid ? await ledgerStatus(biz.account_id) : null;
    if (after && after.spentCents > after.budgetCents) { await finish(ref, callId, startedAt); return res.status(402).json({ error: 'Your prepaid balance is fully reserved by calls in progress.', code: 'payment_required' }); }
    waitUntil(new Promise((ok) => setTimeout(ok, limit * 1000)).then(async () => {
      const open = await sql().query('SELECT 1 FROM spend WHERE ref = $1 AND settled = false', [ref]);
      if (open.length) await finish(ref, callId, startedAt);
    }));
    return res.status(200).json({ sdp: text, callId, limitSeconds: limit, model: session.model, voice: session.audio.output.voice, agent: { id: agents[0].id, persona: agents[0].persona, title: agents[0].title, portrait: agents[0].portrait }, agents: agents.map((a) => ({ id: a.id, persona: a.persona, title: a.title, portrait: a.portrait })) });
  } catch (e) {
    if (e instanceof PaymentRequired) return res.status(402).json({ error: e.message, code: e.code });
    console.error('[realtime]', e);
    return bad(res, 500, e.message);
  }
}

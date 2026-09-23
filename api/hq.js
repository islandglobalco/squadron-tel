// /api/hq — everything Squadron HQ shows: conversations, escalations, usage
// against the plan allowance, the knowledge queue, settings and channel
// status. ?export=csv returns the conversation log as a file.
import { sql, loadBusiness, bad } from './_lib/db.js';
import { ensureAuthSchema, currentAccount, PLANS } from './_lib/auth.js';
import { channelStatus } from './_lib/channels.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.query?.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureAuthSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const acc = await currentAccount(req);
    const plan = PLANS[(acc && acc.plan) || 'trial'] || PLANS.trial;
    const conversations = await sql().query(
      'SELECT id, channel, agent_name, outcome, summary, escalated, test, duration_s, recording_url, started_at, ended_at, jsonb_array_length(transcript) AS turns FROM conversations WHERE business_id = $1 ORDER BY started_at DESC LIMIT 500', [biz.id]);
    if (req.query.export === 'csv') {
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = ['id,started_at,channel,agent,outcome,escalated,test,duration_s,turns,summary'];
      for (const c of conversations) lines.push([c.id, c.started_at, c.channel, c.agent_name, c.outcome, c.escalated, c.test, c.duration_s, c.turns, c.summary].map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="squadron-conversations-${biz.id}.csv"`);
      return res.status(200).send(lines.join('\n'));
    }
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
    const usage = await sql().query(
      `SELECT COALESCE(SUM(CASE WHEN channel IN ('phone','voice-web') THEN duration_s ELSE 0 END),0)::int AS seconds,
              COUNT(*)::int AS conversations,
              COUNT(*) FILTER (WHERE escalated)::int AS escalations
         FROM conversations WHERE business_id = $1 AND test = false AND started_at >= $2`, [biz.id, since.toISOString()]);
    const tests = await sql().query('SELECT COUNT(*)::int AS n FROM conversations WHERE business_id = $1 AND test = true', [biz.id]);
    const gaps = await sql().query('SELECT id, conversation_id, question, proposed_answer, status, created_at FROM knowledge_gaps WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200', [biz.id]);
    const minutes = Math.round(usage[0].seconds / 60);
    const paused = (plan.minutes != null && minutes >= plan.minutes) || (plan.conversations != null && usage[0].conversations >= plan.conversations);
    return res.status(200).json({
      business: { id: biz.id, name: biz.input_value, status: biz.status, phone_number: biz.phone_number },
      account: acc ? { email: acc.email, plan: acc.plan, trialEndsAt: acc.trial_ends_at } : null,
      plan,
      usage: { periodStart: since.toISOString(), minutes, conversations: usage[0].conversations, escalations: usage[0].escalations, testConversations: tests[0].n, paused },
      conversations, gaps, settings: biz.settings || {}, channels: channelStatus(biz),
    });
  } catch (e) {
    console.error('[hq]', e);
    return bad(res, 500, e.message);
  }
}

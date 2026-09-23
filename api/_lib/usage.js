// api/_lib/usage.js — usage against the plan allowance, and the pause rule:
// when a business reaches its allowance, live channels stop taking new
// conversations until a pack is added. Test conversations never count.
import { sql } from './db.js';
import { PLANS } from './auth.js';

export async function usageFor(businessId) {
  const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
  const acc = await sql().query('SELECT a.plan FROM businesses b LEFT JOIN accounts a ON a.id = b.account_id WHERE b.id = $1', [businessId]);
  const plan = PLANS[(acc[0] && acc[0].plan) || 'trial'] || PLANS.trial;
  const u = await sql().query(
    `SELECT COALESCE(SUM(CASE WHEN channel IN ('phone','voice-web') THEN duration_s ELSE 0 END),0)::int AS seconds, COUNT(*)::int AS conversations
       FROM conversations WHERE business_id = $1 AND test = false AND started_at >= $2`, [businessId, since.toISOString()]);
  const minutes = Math.round(u[0].seconds / 60);
  const paused = (plan.minutes != null && minutes >= plan.minutes) || (plan.conversations != null && u[0].conversations >= plan.conversations);
  return { plan, minutes, conversations: u[0].conversations, paused, periodStart: since.toISOString() };
}

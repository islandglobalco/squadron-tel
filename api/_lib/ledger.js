// api/_lib/ledger.js — the prepaid ledger. Squadron never spends provider
// credit (OpenAI, Twilio) that a customer has not already paid for.
//
// How it works:
// - A paid plan invoice opens a 30-day paid period. Packs paid during that
//   period add to it. Nothing is active without a paid period.
// - The spend budget for a period is COST_SHARE of everything prepaid in it.
// - Every provider cost is written to the spend table. A call or voice session
//   first writes a hold for its worst-case cost, and the hold is settled to
//   the measured cost when it ends. An unsettled hold stays charged in full.
// - Nothing that costs money starts unless the remaining budget covers its
//   worst case, so spending can never pass what was prepaid.

import { sql } from './db.js';
import { ensureBillingSchema, PRICES } from './billing.js';
import { PLANS, planKey } from './auth.js';

export const COST_SHARE = Math.min(1, Math.max(0.1, Number(process.env.COST_SHARE || 0.95)));

// Worst-case provider cost, in cents, used for holds before work starts.
export const HOLD = {
  voicePerMinute: Number(process.env.HOLD_VOICE_CENTS_PER_MIN || 15), // realtime mini + Twilio, with margin
  chatTurn: 3,
  profile: 60,
  team: 25,
};

// Provider prices in US cents per 1M tokens (or per minute where noted),
// multiplied by SAFETY so recorded cost errs high.
const SAFETY = 1.15;
const TEXT = {
  'gpt-4.1': { in: 200, cached: 50, out: 800 },
  'gpt-4.1-mini': { in: 40, cached: 10, out: 160 },
  'gpt-4.1-nano': { in: 10, cached: 2.5, out: 40 },
};
const REALTIME = {
  'gpt-realtime-2.1': { textIn: 400, textCached: 40, audioIn: 3200, audioCached: 40, textOut: 2400, audioOut: 6400 },
  'gpt-realtime-2.1-mini': { textIn: 60, textCached: 6, audioIn: 1000, audioCached: 30, textOut: 240, audioOut: 2000 },
};
export const PER_MINUTE = {
  transcribe: 0.3, // gpt-4o-mini-transcribe, $0.003/min
  twilioInbound: 0.85, // local inbound voice, $0.0085/min
  twilioRecording: 0.25, // $0.0025/min
};

export function textCostCents(model, usage) {
  if (!usage) return HOLD.chatTurn;
  const p = TEXT[model] || TEXT['gpt-4.1'];
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const input = Math.max(0, (usage.input_tokens || 0) - cached);
  return ((input * p.in + cached * p.cached + (usage.output_tokens || 0) * p.out) / 1e6) * SAFETY;
}

// usage: summed Realtime response.done usage objects.
export function realtimeCostCents(model, usage) {
  const p = REALTIME[model] || REALTIME['gpt-realtime-2.1'];
  const i = usage.input_token_details || {};
  const o = usage.output_token_details || {};
  const cachedAudio = i.cached_tokens_details?.audio_tokens || 0;
  const cachedText = i.cached_tokens_details?.text_tokens || Math.max(0, (i.cached_tokens || 0) - cachedAudio);
  const audioIn = Math.max(0, (i.audio_tokens || 0) - cachedAudio);
  const textIn = Math.max(0, (i.text_tokens || 0) - cachedText);
  return ((textIn * p.textIn + cachedText * p.textCached + audioIn * p.audioIn + cachedAudio * p.audioCached + (o.text_tokens || 0) * p.textOut + (o.audio_tokens || 0) * p.audioOut) / 1e6) * SAFETY;
}

export class PaymentRequired extends Error {
  constructor(message, status) { super(message); this.code = 'payment_required'; this.status = status; }
}

export async function ensureLedgerSchema() {
  await ensureBillingSchema();
  await sql().query(`CREATE TABLE IF NOT EXISTS spend (
    id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL,
    business_id TEXT,
    kind TEXT NOT NULL,
    cents NUMERIC(12,4) NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    counts_minutes BOOLEAN NOT NULL DEFAULT false,
    settled BOOLEAN NOT NULL DEFAULT true,
    ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql().query('CREATE INDEX IF NOT EXISTS spend_account_idx ON spend(account_id, created_at)');
  await sql().query('CREATE INDEX IF NOT EXISTS spend_ref_idx ON spend(ref)');
}

// The account's current paid period, budget and usage.
export async function ledgerStatus(accountId) {
  await ensureLedgerSchema();
  const empty = { active: false, plan: PLANS.none, planKey: 'none', periodStart: null, periodEnd: null, prepaidCents: 0, budgetCents: 0, spentCents: 0, remainingCents: 0, minutesIncluded: 0, minutesUsed: 0, minutesRemaining: 0 };
  if (!accountId) return empty;
  const rows = await sql().query("SELECT * FROM invoices WHERE account_id = $1 AND kind = 'plan' AND status = 'paid' AND period_start <= now() AND period_end > now() ORDER BY period_start DESC LIMIT 1", [accountId]);
  const period = rows[0];
  if (!period) return empty;
  const key = planKey(period.item);
  const plan = PLANS[key] || PLANS.none;
  const packs = await sql().query("SELECT item, amount_cents FROM invoices WHERE account_id = $1 AND kind = 'pack' AND status = 'paid' AND period_start = $2", [accountId, period.period_start]);
  let prepaid = period.amount_cents, extraMin = 0;
  for (const p of packs) { prepaid += p.amount_cents; extraMin += (PRICES[p.item] && PRICES[p.item].minutes) || 0; }
  const s = await sql().query('SELECT COALESCE(SUM(cents),0)::float AS cents, COALESCE(SUM(seconds) FILTER (WHERE counts_minutes),0)::int AS seconds FROM spend WHERE account_id = $1 AND created_at >= $2', [accountId, period.period_start]);
  const budget = Math.floor(prepaid * COST_SHARE);
  const spent = s[0].cents;
  const minutesIncluded = plan.minutes + extraMin;
  const minutesUsed = Math.ceil(s[0].seconds / 60);
  return {
    active: true, plan, planKey: key, periodStart: period.period_start, periodEnd: period.period_end,
    prepaidCents: prepaid, budgetCents: budget, spentCents: Math.round(spent * 100) / 100,
    remainingCents: Math.max(0, budget - spent),
    minutesIncluded, minutesUsed, minutesRemaining: Math.max(0, minutesIncluded - minutesUsed),
  };
}

export async function accountForBusiness(businessId) {
  const r = await sql().query('SELECT account_id FROM businesses WHERE id = $1', [businessId]);
  return (r[0] && r[0].account_id) || null;
}

// Throws PaymentRequired unless the account has an active paid period with
// at least `cents` of prepaid budget left.
export async function requireFunds(accountId, cents, who = 'This business') {
  if (!accountId) throw new PaymentRequired(`${who} has no paid plan yet. Squadron works on prepaid plans, so choose a plan and pay first.`, 402);
  const st = await ledgerStatus(accountId);
  if (!st.active) throw new PaymentRequired(`${who} has no active paid plan. Squadron works on prepaid plans, so renew or choose a plan in Billing.`, 402);
  if (st.remainingCents < cents) throw new PaymentRequired(`${who} has used its prepaid balance for this period, so the team is paused until a top-up is paid in Billing.`, 402);
  return st;
}

export async function recordSpend({ accountId, businessId, kind, cents, seconds = 0, countsMinutes = false, ref = null }) {
  await ensureLedgerSchema();
  await sql().query('INSERT INTO spend (account_id, business_id, kind, cents, seconds, counts_minutes, settled, ref) VALUES ($1,$2,$3,$4,$5,$6,true,$7)',
    [accountId, businessId, kind, Math.max(0, cents), Math.max(0, Math.round(seconds)), countsMinutes, ref]);
}

// A hold reserves the worst case before a call or voice session starts.
export async function placeHold({ accountId, businessId, kind, maxSeconds, countsMinutes, ref }) {
  await ensureLedgerSchema();
  const cents = (maxSeconds / 60) * HOLD.voicePerMinute;
  await sql().query('INSERT INTO spend (account_id, business_id, kind, cents, seconds, counts_minutes, settled, ref) VALUES ($1,$2,$3,$4,$5,$6,false,$7)',
    [accountId, businessId, kind, cents, Math.round(maxSeconds), countsMinutes, ref]);
  return cents;
}

// Settles a hold to the measured cost. The settled amount never drops below
// the time-based floor, so a missing usage report cannot undercharge.
export async function settleHold(ref, { cents, seconds }) {
  await ensureLedgerSchema();
  const r = await sql().query('UPDATE spend SET cents = $2, seconds = $3, settled = true WHERE ref = $1 AND settled = false RETURNING id', [ref, Math.max(0, cents), Math.max(0, Math.round(seconds))]);
  return r.length > 0;
}

// Largest safe length for a new voice session, in seconds.
export function maxVoiceSeconds(st, { capSeconds, countsMinutes }) {
  let s = Math.floor((st.remainingCents / HOLD.voicePerMinute) * 60);
  if (countsMinutes) s = Math.min(s, st.minutesRemaining * 60);
  return Math.max(0, Math.min(capSeconds, s));
}

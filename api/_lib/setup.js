// api/_lib/setup.js — free setup. Building the Business Profile, generating
// the team and testing it by chat and in-browser voice cost the owner
// nothing; payment is asked for only when a channel goes live.
//
// Free setup spend is Squadron's own acquisition cost. It is written to the
// spend table under the SETUP_ACCOUNT id, so it never touches a customer's
// prepaid balance, and it is capped per business, per visitor (hashed IP) and
// per day across all of Squadron so it can never run away.
//
// Once the business belongs to an account with an active paid plan, the
// normal prepaid ledger is used instead.

import crypto from 'node:crypto';
import { sql } from './db.js';
import { ledgerStatus, requireFunds, recordSpend, ensureLedgerSchema, PaymentRequired } from './ledger.js';

export const SETUP_ACCOUNT = 'squadron-setup';

export const FREE = {
  profileBuilds: Number(process.env.FREE_PROFILE_BUILDS || 3), // per business
  teamBuilds: Number(process.env.FREE_TEAM_BUILDS || 4), // per business
  chatTurns: Number(process.env.FREE_CHAT_TURNS || 60), // per business
  voiceSeconds: Number(process.env.FREE_VOICE_SECONDS || 600), // per business, browser voice tests
  businessesPerVisitor: Number(process.env.FREE_BUSINESSES_PER_IP || 6), // per 24 hours
  dailyCents: Number(process.env.FREE_SETUP_DAILY_CENTS || 10000), // all of Squadron, per 24 hours
};

const LIMIT_MSG = {
  profile: 'You have rebuilt this profile the maximum number of times on free setup. Edit the fields directly, or go live to keep rebuilding.',
  team: 'You have regenerated this team the maximum number of times on free setup. Edit the agents directly, or go live to keep regenerating.',
  'chat-test': 'You have used the free test chats for this team. Go live to keep chatting with it.',
  'voice-test': 'You have used the free voice test time for this team. Go live to keep talking with it.',
  visitor: 'You have set up several businesses today. Come back tomorrow, or log in and go live with one of them.',
  daily: 'Free setup is very busy right now. Please try again in a little while, or log in and go live.',
};

export function visitorHash(req) {
  const ip = String(req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip'] || '').split(',')[0].trim();
  return crypto.createHash('sha256').update('setup:' + ip + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 24);
}

async function freeUsage(businessId, kind) {
  const r = await sql().query(
    `SELECT count(*)::int AS n, COALESCE(SUM(seconds),0)::int AS seconds FROM spend WHERE account_id = $1 AND business_id = $2 AND kind = $3`,
    [SETUP_ACCOUNT, businessId, kind]);
  return r[0];
}

// Decides who pays for a piece of setup work. Returns
// { paid: true, accountId, status } when the owner's plan covers it, or
// { paid: false, accountId: SETUP_ACCOUNT, ... } when free setup does.
// Throws PaymentRequired (402) when neither can.
export async function fundSetup({ biz, kind, cents, req }) {
  await ensureLedgerSchema();
  if (biz.account_id) {
    const st = await ledgerStatus(biz.account_id);
    if (st.active) {
      await requireFunds(biz.account_id, cents, 'This account');
      return { paid: true, accountId: biz.account_id, status: st };
    }
  }
  const day = await sql().query(`SELECT COALESCE(SUM(cents),0)::float AS c FROM spend WHERE account_id = $1 AND created_at > now() - interval '24 hours'`, [SETUP_ACCOUNT]);
  if (day[0].c + cents > FREE.dailyCents) throw new PaymentRequired(LIMIT_MSG.daily, 402);
  const used = await freeUsage(biz.id, kind);
  if (kind === 'profile') {
    if (used.n >= FREE.profileBuilds) throw new PaymentRequired(LIMIT_MSG.profile, 402);
    if (used.n === 0 && req) {
      const v = await sql().query(
        `SELECT count(DISTINCT business_id)::int AS n FROM spend WHERE account_id = $1 AND kind = 'profile' AND ref = $2 AND created_at > now() - interval '24 hours'`,
        [SETUP_ACCOUNT, 'ip:' + visitorHash(req)]);
      if (v[0].n >= FREE.businessesPerVisitor) throw new PaymentRequired(LIMIT_MSG.visitor, 402);
    }
  }
  if (kind === 'team' && used.n >= FREE.teamBuilds) throw new PaymentRequired(LIMIT_MSG.team, 402);
  if (kind === 'chat-test' && used.n >= FREE.chatTurns) throw new PaymentRequired(LIMIT_MSG['chat-test'], 402);
  const voiceSecondsLeft = Math.max(0, FREE.voiceSeconds - used.seconds);
  if (kind === 'voice-test' && voiceSecondsLeft < 20) throw new PaymentRequired(LIMIT_MSG['voice-test'], 402);
  return { paid: false, accountId: SETUP_ACCOUNT, voiceSecondsLeft };
}

export async function recordSetupSpend(funding, { biz, kind, cents, req, ref = null }) {
  const r = !funding.paid && kind === 'profile' && req ? 'ip:' + visitorHash(req) : ref;
  await recordSpend({ accountId: funding.accountId, businessId: biz.id, kind, cents, ref: r });
}

// What the setup screens show: whether the owner is on free setup and how
// much of it is left.
export async function setupAllowance(biz) {
  await ensureLedgerSchema();
  const st = biz.account_id ? await ledgerStatus(biz.account_id) : { active: false };
  if (st.active) return { free: false, live: true };
  const [c, v] = await Promise.all([freeUsage(biz.id, 'chat-test'), freeUsage(biz.id, 'voice-test')]);
  return {
    free: true, live: false,
    chatTurnsLeft: Math.max(0, FREE.chatTurns - c.n),
    voiceSecondsLeft: Math.max(0, FREE.voiceSeconds - v.seconds),
  };
}

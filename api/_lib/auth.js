// api/_lib/auth.js — accounts and sessions. Passwords are hashed with scrypt;
// the session is an HMAC-signed cookie. No third-party auth service is used.

import crypto from 'node:crypto';
import { sql, ensureSchema, newId } from './db.js';

const COOKIE = 'sq_session';
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not configured');
  return s;
}

export async function ensureAuthSchema() {
  await ensureSchema();
  const q = sql();
  await q.query(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_id TEXT`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone_number TEXT`);
  await q.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await q.query(`CREATE INDEX IF NOT EXISTS businesses_account_idx ON businesses(account_id)`);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function sessionCookie(accountId) {
  const exp = Date.now() + DAYS * 86400_000;
  const payload = `${accountId}.${exp}`;
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSession(req) {
  const raw = req.headers?.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const payload = `${id}.${exp}`;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  if (+exp < Date.now()) return null;
  return { accountId: id };
}

export async function currentAccount(req) {
  const s = readSession(req);
  if (!s) return null;
  await ensureAuthSchema();
  const rows = await sql().query('SELECT id, email, plan, trial_ends_at, created_at FROM accounts WHERE id = $1', [s.accountId]);
  return rows[0] || null;
}

export async function createAccount(email, password) {
  await ensureAuthSchema();
  const id = newId('acc');
  await sql().query('INSERT INTO accounts (id, email, pass_hash) VALUES ($1, $2, $3)', [id, email.toLowerCase(), hashPassword(password)]);
  return id;
}

export async function findAccount(email) {
  await ensureAuthSchema();
  const rows = await sql().query('SELECT * FROM accounts WHERE email = $1', [email.toLowerCase()]);
  return rows[0] || null;
}

// Plan allowances. The trial uses the Scout allowance. Paid allowances are
// applied when billing ships.
export const PLANS = {
  trial: { name: '14-day trial', price: 0, minutes: 250, conversations: 1000 },
  scout: { name: 'Scout', price: 99, minutes: 250, conversations: 1000 },
  commander: { name: 'Commander', price: 299, minutes: 1000, conversations: null },
  hq: { name: 'Command HQ', price: 799, minutes: null, conversations: null },
};

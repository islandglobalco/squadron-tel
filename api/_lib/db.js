// api/_lib/db.js — Neon Postgres access and the schema every function relies on.
// The schema is created lazily on first use so a fresh database needs no
// separate migration step.

import { neon } from '@neondatabase/serverless';

let _sql = null;
let _ready = null;

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    _sql = neon(url);
  }
  return _sql;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS businesses (
     id TEXT PRIMARY KEY,
     token TEXT NOT NULL UNIQUE,
     input_kind TEXT NOT NULL,
     input_value TEXT,
     status TEXT NOT NULL DEFAULT 'new',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sources (
     id BIGSERIAL PRIMARY KEY,
     business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     url TEXT,
     title TEXT,
     content TEXT NOT NULL,
     fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS sources_business_idx ON sources(business_id)`,
  `CREATE TABLE IF NOT EXISTS profiles (
     business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
     profile JSONB NOT NULL,
     corrections JSONB NOT NULL DEFAULT '{}'::jsonb,
     model TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
     agents JSONB NOT NULL,
     model TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS conversations (
     id TEXT PRIMARY KEY,
     business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
     channel TEXT NOT NULL,
     agent_id TEXT,
     agent_name TEXT,
     outcome TEXT,
     summary TEXT,
     transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
     sources JSONB NOT NULL DEFAULT '[]'::jsonb,
     recording_url TEXT,
     duration_s INTEGER,
     escalated BOOLEAN NOT NULL DEFAULT false,
     test BOOLEAN NOT NULL DEFAULT false,
     started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     ended_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS conversations_business_idx ON conversations(business_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS knowledge_gaps (
     id BIGSERIAL PRIMARY KEY,
     business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
     conversation_id TEXT,
     question TEXT NOT NULL,
     proposed_answer TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     resolved_at TIMESTAMPTZ
   )`,
];

export async function ensureSchema() {
  if (!_ready) {
    _ready = (async () => {
      const q = sql();
      for (const stmt of SCHEMA) await q.query(stmt);
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

export function newId(prefix) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

export function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function loadBusiness(token) {
  await ensureSchema();
  const rows = await sql().query('SELECT * FROM businesses WHERE token = $1', [token]);
  return rows[0] || null;
}

export async function loadProfile(businessId) {
  const rows = await sql().query('SELECT profile, corrections, model, updated_at FROM profiles WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

export async function loadTeam(businessId) {
  const rows = await sql().query('SELECT agents, model, updated_at FROM teams WHERE business_id = $1', [businessId]);
  return rows[0] || null;
}

export function readJson(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

export function bad(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

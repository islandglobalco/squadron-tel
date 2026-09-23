// api/_lib/bridge.js — shared helpers for the phone bridge endpoints.
import { sql, ensureSchema } from './db.js';
import { ensureAuthSchema } from './auth.js';

export function checkSecret(req) {
  const want = process.env.BRIDGE_SECRET;
  if (!want) return false;
  const got = req.headers['x-bridge-secret'] || req.query?.secret;
  return typeof got === 'string' && got.length === want.length && got === want;
}

export async function ensureBridgeSchema() {
  await ensureSchema();
  await ensureAuthSchema();
  await sql().query(`CREATE TABLE IF NOT EXISTS demo_numbers (
    number TEXT PRIMARY KEY,
    business_id TEXT,
    expires_at TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ
  )`);
  await sql().query(`CREATE TABLE IF NOT EXISTS calls (
    call_sid TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    conversation_id TEXT,
    from_number TEXT,
    demo BOOLEAN NOT NULL DEFAULT false,
    recording_sid TEXT,
    recording_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

// Resolves an inbound number to a business: a number owned by the business,
// or a pool number currently assigned for a demo.
export async function businessForNumber(number) {
  const owned = await sql().query('SELECT * FROM businesses WHERE phone_number = $1 LIMIT 1', [number]);
  if (owned[0]) return { biz: owned[0], demo: false };
  const pool = await sql().query('SELECT business_id FROM demo_numbers WHERE number = $1 AND expires_at > now()', [number]);
  if (pool[0] && pool[0].business_id) {
    const rows = await sql().query('SELECT * FROM businesses WHERE id = $1', [pool[0].business_id]);
    if (rows[0]) return { biz: rows[0], demo: true };
  }
  return null;
}

// Simple keyword retrieval over the knowledge chunks for the lookup tool.
export function searchChunks(chunks, query, limit = 5) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return chunks.slice(0, limit);
  return chunks
    .map((c) => ({ c, score: terms.reduce((s, t) => s + (c.text.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

// /api/support — Squadron's own support desk.
// POST { action: 'ticket', name, email, topic, message, page, transcript } opens
// a ticket: it is stored, the team is emailed, and the customer gets an email
// with the reference number. POST { action: 'helpful', id, yes } records a
// Help Center vote. Nothing here calls an AI model, so nothing costs credit.
import crypto from 'node:crypto';
import { ensureSchema, sql, readJson, bad } from './_lib/db.js';
import { sendEmail } from './_lib/email.js';

const TEAM = (process.env.SUPPORT_TO || 'info@squadron.tel,info@island.contact').split(',').map((s) => s.trim()).filter(Boolean);
const TOPICS = ['Setup', 'Testing', 'Going live', 'Billing', 'Something is broken', 'Sales question', 'Other'];

let ready = null;
async function ensureSupportSchema() {
  await ensureSchema();
  if (!ready) {
    ready = (async () => {
      await sql().query(`CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        topic TEXT,
        message TEXT NOT NULL,
        page TEXT,
        transcript JSONB,
        ip_hash TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at TIMESTAMPTZ
      )`);
      await sql().query(`CREATE TABLE IF NOT EXISTS help_votes (
        article TEXT NOT NULL,
        yes INTEGER NOT NULL DEFAULT 0,
        no INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (article)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function ref() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  return 'SQ-T-' + Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const body = readJson(req);
  try {
    await ensureSupportSchema();
    if (body.action === 'helpful') {
      const id = String(body.id || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!id) return bad(res, 400, 'id required');
      const col = body.yes ? 'yes' : 'no';
      await sql().query(`INSERT INTO help_votes (article, ${col}) VALUES ($1, 1) ON CONFLICT (article) DO UPDATE SET ${col} = help_votes.${col} + 1`, [id]);
      return res.status(200).json({ ok: true });
    }

    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);
    const name = String(body.name || '').trim().slice(0, 120);
    const topic = TOPICS.includes(body.topic) ? body.topic : 'Other';
    const page = String(body.page || '').slice(0, 300);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter the email address where you want the reply.');
    if (message.length < 5) return bad(res, 400, 'Tell us what you need help with.');
    if (body.website) return res.status(200).json({ ok: true, reference: ref() }); // honeypot

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ipHash = crypto.createHash('sha256').update(ip + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 24);
    const recent = await sql().query("SELECT count(*)::int AS n FROM support_tickets WHERE (ip_hash = $1 OR email = $2) AND created_at > now() - interval '1 hour'", [ipHash, email]);
    if (recent[0].n >= 5) return bad(res, 429, 'You have sent several requests in the last hour. We have them all, and a person will reply by email.');

    const id = ref();
    const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-30).map((t) => ({ role: t.role === 'user' ? 'user' : 'agent', text: String(t.text || '').slice(0, 1500) })) : null;
    await sql().query('INSERT INTO support_tickets (id, email, name, topic, message, page, transcript, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, email, name || null, topic, message, page || null, transcript ? JSON.stringify(transcript) : null, ipHash]);

    const convo = transcript && transcript.length ? `\n\nChat with Ace before this request:\n${transcript.map((t) => `${t.role === 'user' ? 'Customer' : 'Ace'}: ${t.text}`).join('\n')}` : '';
    const sent = { team: false, customer: false };
    for (const to of TEAM) {
      try { await sendEmail({ to, subject: `[${id}] ${topic}: ${message.slice(0, 60)}`, replyTo: email, text: `From: ${name || '(no name)'} <${email}>\nTopic: ${topic}\nPage: ${page || '(none)'}\n\n${message}${convo}\n\nReply to the customer at ${email} and keep ${id} in the subject.` }); sent.team = true; }
      catch (e) { console.error('[support team email]', to, e.message); }
    }
    try {
      await sendEmail({ to: email, replyTo: 'info@squadron.tel', subject: `We have your request (${id})`, text: `Hi${name ? ' ' + name : ''},\n\nSquadron received your request, and a person will reply to this address. Your reference is ${id}; keep it in the subject if you write again.\n\nWhat you sent:\n${message}\n\nMost answers are also in the Help Center: https://www.squadron.tel/help\n\nSquadron Support` });
      sent.customer = true;
    } catch (e) { console.error('[support customer email]', e.message); }

    return res.status(200).json({ ok: true, reference: id, emailed: sent });
  } catch (e) {
    console.error('[support]', e);
    return bad(res, 500, 'Your request could not be saved. Please email info@squadron.tel.');
  }
}

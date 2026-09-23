// /api/auth — signup, login, logout, "who am I", and password reset.
// A signup during onboarding attaches the current business (by token) to the
// new account. 'forgot' emails a one-hour reset link; 'reset' sets the new
// password. 'forgot' answers the same way whether or not the email exists.
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import crypto from 'node:crypto';
import { ensureAuthSchema, createAccount, findAccount, verifyPassword, hashPassword, sessionCookie, clearCookie, currentAccount } from './_lib/auth.js';
import { ledgerStatus } from './_lib/ledger.js';
import { sendEmail } from './_lib/email.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const action = req.method === 'GET' ? 'me' : body.action;
  try {
    await ensureAuthSchema();
    if (action === 'me') {
      const acc = await currentAccount(req);
      if (!acc) return res.status(200).json({ account: null });
      const businesses = await sql().query('SELECT id, token, input_kind, input_value, status, phone_number, channels, created_at FROM businesses WHERE account_id = $1 ORDER BY created_at DESC', [acc.id]);
      const st = await ledgerStatus(acc.id);
      return res.status(200).json({ account: { id: acc.id, email: acc.email, active: st.active, plan: st.planKey, planInfo: st.plan, paidThrough: st.periodEnd, minutesIncluded: st.minutesIncluded, minutesUsed: st.minutesUsed }, businesses });
    }
    if (action === 'claim') {
      // Attaches an onboarding business to the signed-in account (for owners
      // who were already logged in when they entered their website).
      const acc = await currentAccount(req);
      if (!acc) return bad(res, 401, 'Sign in first.');
      const biz = body.token ? await loadBusiness(body.token) : null;
      if (!biz) return bad(res, 404, 'Unknown business');
      if (biz.account_id && biz.account_id !== acc.id) return bad(res, 403, 'This team belongs to another account.');
      if (!biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1 AND account_id IS NULL', [biz.id, acc.id]);
      return res.status(200).json({ ok: true });
    }
    if (action === 'logout') { res.setHeader('Set-Cookie', clearCookie()); return res.status(200).json({ ok: true }); }
    await sql().query(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (action === 'reset') {
      const token = String(body.token || '');
      const password = String(body.password || '');
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      const rows = await sql().query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING account_id', [sha(token)]);
      if (!rows.length) return bad(res, 400, 'This reset link has expired or was already used. Ask for a new one.');
      await sql().query('UPDATE accounts SET pass_hash = $2 WHERE id = $1', [rows[0].account_id, hashPassword(password)]);
      await sql().query('UPDATE password_resets SET used_at = now() WHERE account_id = $1 AND used_at IS NULL', [rows[0].account_id]);
      res.setHeader('Set-Cookie', sessionCookie(rows[0].account_id));
      return res.status(200).json({ ok: true });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter a valid email address.');
    if (action === 'forgot') {
      const acc = await findAccount(email);
      if (acc) {
        const recent = await sql().query("SELECT COUNT(*)::int AS n FROM password_resets WHERE account_id = $1 AND created_at > now() - interval '1 hour'", [acc.id]);
        if (recent[0].n < 5) {
          const token = crypto.randomBytes(32).toString('base64url');
          await sql().query("INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [sha(token), acc.id]);
          await sendEmail({ to: acc.email, subject: 'Reset your Squadron password', text: `Someone asked to reset the password for your Squadron account. To choose a new password, open this link within one hour:\n\nhttps://www.squadron.tel/reset?token=${token}\n\nIf you did not ask for this, you can ignore this email, and your password will stay the same.` });
        }
      }
      return res.status(200).json({ ok: true, message: 'If that email has a Squadron account, a reset link is on its way. It works for one hour.' });
    }
    if (action === 'signup') {
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      if (body.terms !== true) return bad(res, 400, 'Please agree to the Terms of Service and Privacy Policy to create your account.');
      if (await findAccount(email)) return bad(res, 409, 'An account with that email already exists. Log in instead.');
      const id = await createAccount(email, password);
      await sql().query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
      await sql().query("UPDATE accounts SET terms_accepted_at = now() WHERE id = $1", [id]);
      if (body.token) { const biz = await loadBusiness(body.token); if (biz && !biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1', [biz.id, id]); }
      res.setHeader('Set-Cookie', sessionCookie(id));
      return res.status(200).json({ ok: true, accountId: id });
    }
    if (action === 'login') {
      const acc = await findAccount(email);
      if (!acc || !verifyPassword(password, acc.pass_hash)) return bad(res, 401, 'That email and password do not match.');
      if (body.token) { const biz = await loadBusiness(body.token); if (biz && !biz.account_id) await sql().query('UPDATE businesses SET account_id = $2 WHERE id = $1', [biz.id, acc.id]); }
      res.setHeader('Set-Cookie', sessionCookie(acc.id));
      return res.status(200).json({ ok: true, accountId: acc.id });
    }
    return bad(res, 400, 'Unknown action');
  } catch (e) {
    console.error('[auth]', e);
    return bad(res, 500, e.message);
  }
}

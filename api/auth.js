// /api/auth — signup, login, logout and "who am I". A signup during onboarding
// attaches the current business (by token) to the new account.
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import { ensureAuthSchema, createAccount, findAccount, verifyPassword, sessionCookie, clearCookie, currentAccount, PLANS } from './_lib/auth.js';

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
      return res.status(200).json({ account: { id: acc.id, email: acc.email, plan: acc.plan, planInfo: PLANS[acc.plan] || PLANS.trial, trialEndsAt: acc.trial_ends_at }, businesses });
    }
    if (action === 'logout') { res.setHeader('Set-Cookie', clearCookie()); return res.status(200).json({ ok: true }); }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter a valid email address.');
    if (action === 'signup') {
      if (password.length < 8) return bad(res, 400, 'Use a password of at least 8 characters.');
      if (await findAccount(email)) return bad(res, 409, 'An account with that email already exists. Log in instead.');
      const id = await createAccount(email, password);
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

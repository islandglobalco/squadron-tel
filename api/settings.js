// /api/settings — business settings (on-call contact, business hours,
// notification email) and channel deployment state, with honest per-channel
// status. GET reads; POST updates.
import { sql, loadBusiness, readJson, bad } from './_lib/db.js';
import { ensureAuthSchema } from './_lib/auth.js';
import { channelStatus } from './_lib/channels.js';
import { HUMAN_MODES } from './_lib/human.js';
import { ledgerStatus } from './_lib/ledger.js';
import { setupAllowance } from './_lib/setup.js';
import { normalizePhone, normalizeEmail } from './_lib/inputs.js';


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'GET' ? {} : readJson(req);
  const token = req.method === 'GET' ? req.query?.token : body.token;
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureAuthSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    if (req.method === 'POST') {
      const settings = { ...(biz.settings || {}) };
      const s = body.settings || {};
      if ('on_call_phone' in s) settings.on_call_phone = normalizePhone(s.on_call_phone) || String(s.on_call_phone || '').trim().slice(0, 40);
      if ('on_call_name' in s) settings.on_call_name = String(s.on_call_name || '').slice(0, 80);
      if ('notify_email' in s) settings.notify_email = normalizeEmail(s.notify_email) || String(s.notify_email || '').trim().slice(0, 200);
      if ('hours' in s) settings.hours = String(s.hours || '').slice(0, 400);
      if ('human_mode' in s) settings.human_mode = HUMAN_MODES[s.human_mode] ? s.human_mode : 'ai_first';
      if ('after_hours' in s) settings.after_hours = ['message', 'answer'].includes(s.after_hours) ? s.after_hours : 'answer';
      const channels = { ...(biz.channels || {}) };
      if (body.channels && typeof body.channels === 'object') {
        // The paywall sits here, at the end of setup: going live needs an
        // account with an active prepaid plan. Turning a channel off never does.
        const turningOn = ['chat', 'phone'].some((k) => body.channels[k] && body.channels[k].enabled === true);
        if (turningOn && !(biz.account_id && (await ledgerStatus(biz.account_id)).active)) {
          return res.status(402).json({ error: biz.account_id ? 'Choose a plan to go live. Your team is built and tested; paying switches it on.' : 'Create your account and choose a plan to go live.', code: 'payment_required' });
        }
        for (const k of ['chat', 'phone']) if (body.channels[k] && typeof body.channels[k].enabled === 'boolean') channels[k] = { ...(channels[k] || {}), enabled: body.channels[k].enabled, changed_at: new Date().toISOString() };
      }
      await sql().query('UPDATE businesses SET settings = $2, channels = $3, updated_at = now() WHERE id = $1', [biz.id, JSON.stringify(settings), JSON.stringify(channels)]);
      biz.settings = settings; biz.channels = channels;
    }
    return res.status(200).json({ business: { id: biz.id, status: biz.status, phone_number: biz.phone_number }, settings: biz.settings || {}, channels: biz.channels || {}, status: channelStatus(biz), humanModes: HUMAN_MODES, setup: await setupAllowance(biz) });
  } catch (e) {
    console.error('[settings]', e);
    return bad(res, 500, e.message);
  }
}

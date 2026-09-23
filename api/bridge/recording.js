// /api/bridge/recording — Twilio's recording status callback. Copies the
// finished recording into Vercel Blob storage and attaches it to the call's
// conversation. Twilio posts form data.
import { sql, bad } from '../_lib/db.js';
import { checkSecret, ensureBridgeSchema } from '../_lib/bridge.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  try {
    await ensureBridgeSchema();
    let form = req.body;
    if (typeof form === 'string') form = Object.fromEntries(new URLSearchParams(form));
    form = form || {};
    const callSid = form.CallSid, recordingSid = form.RecordingSid, status = form.RecordingStatus;
    if (!callSid || !recordingSid) return bad(res, 400, 'CallSid and RecordingSid required');
    const businessId = String(req.query?.businessId || '');
    let url = null;
    if (status === 'completed' && process.env.BLOB_READ_WRITE_TOKEN && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const src = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
      const r = await fetch(src, { headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') } });
      if (r.ok) {
        const { put } = await import('@vercel/blob');
        const blob = await put(`recordings/${businessId}/${recordingSid}.mp3`, await r.arrayBuffer(), { access: 'private', contentType: 'audio/mpeg', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: true });
        url = blob.url;
      } else console.error('[recording] fetch failed', r.status);
    }
    await sql().query(`INSERT INTO calls (call_sid, business_id, recording_sid, recording_url) VALUES ($1,$2,$3,$4)
      ON CONFLICT (call_sid) DO UPDATE SET recording_sid = EXCLUDED.recording_sid, recording_url = COALESCE(EXCLUDED.recording_url, calls.recording_url)`, [callSid, businessId, recordingSid, url]);
    if (url) await sql().query('UPDATE conversations SET recording_url = $2 WHERE id = (SELECT conversation_id FROM calls WHERE call_sid = $1)', [callSid, url]);
    return res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('[bridge/recording]', e);
    return bad(res, 500, e.message);
  }
}

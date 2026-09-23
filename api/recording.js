// /api/recording?token=...&id=cnv_... — streams a private call recording to
// the business owner. The blob token never leaves the server.
import { sql, bad, loadBusiness } from './_lib/db.js';

export default async function handler(req, res) {
  const { token, id } = req.query || {};
  if (!token || !id) return bad(res, 400, 'token and id required');
  try {
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const rows = await sql().query('SELECT recording_url FROM conversations WHERE id = $1 AND business_id = $2', [id, biz.id]);
    const url = rows[0] && rows[0].recording_url;
    if (!url) return bad(res, 404, 'No recording for this conversation');
    const { get } = await import('@vercel/blob');
    const r = await get(url, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!r || !r.stream) return bad(res, 404, 'Recording not found');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const reader = r.stream.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
    return res.end();
  } catch (e) {
    console.error('[recording]', e);
    return bad(res, 500, e.message);
  }
}

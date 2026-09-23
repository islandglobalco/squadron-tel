// /portraits/<id>.webp — agent portraits hosted by Squadron. The originals on
// the Midjourney CDN are about 8 MB each and refuse server-side fetches, so a
// resized WebP of each is stored in Vercel Blob and served from here with a
// long CDN cache. POST (bridge secret required) stores one portrait.
import { bad, readJson } from './_lib/db.js';
import { checkSecret } from './_lib/bridge.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function handler(req, res) {
  const blob = await import('@vercel/blob');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    if (req.method === 'POST') {
      if (!checkSecret(req)) return bad(res, 401, 'unauthorized');
      const { id, data } = readJson(req);
      if (!ID.test(String(id)) || !data) return bad(res, 400, 'id and data required');
      const out = await blob.put(`portraits/${id}.webp`, Buffer.from(data, 'base64'), { access: 'private', contentType: 'image/webp', addRandomSuffix: false, allowOverwrite: true, token });
      return res.status(200).json({ ok: true, pathname: out.pathname });
    }
    const id = String(req.query?.id || '');
    if (!ID.test(id)) return bad(res, 400, 'bad id');
    const found = await blob.list({ prefix: `portraits/${id}.webp`, limit: 1, token });
    const item = found.blobs && found.blobs[0];
    if (!item) return bad(res, 404, 'Portrait not found');
    const r = await blob.get(item.url, { access: 'private', token });
    if (!r || !r.stream) return bad(res, 404, 'Portrait not found');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    const reader = r.stream.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
    return res.end();
  } catch (e) {
    console.error('[portrait]', e);
    return bad(res, 500, e.message);
  }
}

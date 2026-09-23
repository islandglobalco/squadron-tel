// /api/ingest/crawl — reads the business website or App Store listing and
// stores every page as a source document.
import { ensureSchema, sql, loadBusiness, readJson, bad } from '../_lib/db.js';
import { crawlSite, fetchAppStore, normalizeUrl } from '../_lib/crawl.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  const { token } = readJson(req);
  if (!token) return bad(res, 400, 'token required');
  try {
    await ensureSchema();
    const biz = await loadBusiness(token);
    if (!biz) return bad(res, 404, 'Unknown business');
    const log = [];
    let pages = [];
    if (biz.input_kind === 'appstore') {
      const listing = await fetchAppStore(biz.input_value, (m) => log.push(m));
      pages.push(listing);
      // The seller's own site usually holds the support details the listing lacks.
      const site = normalizeUrl(listing.meta.supportUrl || listing.meta.sellerUrl);
      if (site) {
        try { pages = pages.concat((await crawlSite(site, (m) => log.push(m))).slice(0, 8)); }
        catch (e) { log.push(`Could not read ${site}: ${e.message}`); }
      }
    } else if (biz.input_kind === 'url') {
      pages = await crawlSite(biz.input_value, (m) => log.push(m));
    }
    await sql().query('DELETE FROM sources WHERE business_id = $1 AND kind IN ($2,$3)', [biz.id, 'web', 'appstore']);
    for (const p of pages) {
      await sql().query('INSERT INTO sources (business_id, kind, url, title, content) VALUES ($1,$2,$3,$4,$5)', [biz.id, p.kind, p.url, p.title, p.content]);
    }
    await sql().query("UPDATE businesses SET status = 'crawled', updated_at = now() WHERE id = $1", [biz.id]);
    const rows = await sql().query('SELECT kind, url, title, length(content) AS chars FROM sources WHERE business_id = $1 ORDER BY id', [biz.id]);
    return res.status(200).json({ ok: true, log, sources: rows });
  } catch (e) {
    console.error('[crawl]', e);
    return bad(res, 500, e.message);
  }
}

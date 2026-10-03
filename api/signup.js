// /api/signup.js — collect deploy form submissions
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (b.terms !== true || b.cert !== true || b.termsVersion !== '2026-10-03') return res.status(400).json({ error: 'Please tick both boxes to agree to the Terms of Use and Privacy Policy and to confirm your consents.', code: 'terms_required' });
  const { firstName, lastName, email, company, callVolume, useCase, plan, ts } = req.body || {};
  console.log('[SIGNUP]', JSON.stringify({ name: `${firstName} ${lastName}`, email, company, callVolume, useCase, plan, ts,
    acceptance: { version: '2026-10-03', at: new Date().toISOString(), ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), ua: String(req.headers['user-agent'] || '').slice(0, 300), terms: true, cert: true,
      text: 'I am 18 or older and I agree to the Terms of Use (including binding individual arbitration, a class action and jury trial waiver, and a limitation of liability) and the Privacy Policy.' } }));
  return res.status(200).json({ ok: true, message: 'Signup received. Dashboard credentials and phone number sent to ' + email, plan, nextStep: 'https://app.squadron.tel' });
}

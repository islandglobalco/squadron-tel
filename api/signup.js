// /api/signup.js — collect deploy form submissions
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { firstName, lastName, email, company, callVolume, useCase, plan, ts } = req.body || {};
  console.log('[SIGNUP]', JSON.stringify({ name: `${firstName} ${lastName}`, email, company, callVolume, useCase, plan, ts }));
  return res.status(200).json({ ok: true, message: 'Request received for ' + email, plan });
}

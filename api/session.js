// /api/session.js — the homepage live voice demo is switched off. Squadron
// spends no OpenAI credit that a customer has not prepaid, and an open,
// anonymous voice demo would spend unpaid credit on every visit.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'The live voice demo is switched off. Build your own team at squadron.tel/start.' });
}

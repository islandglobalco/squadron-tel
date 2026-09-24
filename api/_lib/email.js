// api/_lib/email.js — transactional email through Resend (password reset,
// message alerts, pause and billing notices). Without RESEND_API_KEY the
// message is logged and { sent: false } is returned, so nothing breaks.
import { sql } from './db.js';

const FROM = process.env.EMAIL_FROM || 'Squadron <alerts@squadron.tel>';

export async function sendEmail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('[email] RESEND_API_KEY is not set; not sent:', subject, '→', to); return { sent: false }; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html: html || textToHtml(text), ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body.slice(0, 300)}`);
  return { sent: true, id: JSON.parse(body).id };
}

function textToHtml(text) {
  const esc = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linked = esc.replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#0b1a33">${linked.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}<p style="color:#44506a;font-size:15px">Squadron · squadron.tel</p></div>`;
}

export async function accountEmail(accountId) {
  const r = await sql().query('SELECT email FROM accounts WHERE id = $1', [accountId]);
  return r[0] ? r[0].email : null;
}

export async function notifyOwner(businessId, { subject, text }) {
  const r = await sql().query("SELECT a.email, b.settings->>'notify_email' AS notify FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.id = $1", [businessId]);
  if (!r[0]) return { sent: false };
  const to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r[0].notify || '') ? r[0].notify : r[0].email;
  return sendEmail({ to, subject, text });
}

// Sends a notice at most once per key (for example one pause notice per
// period), recorded in accounts.notices.
export async function noticeOnce(accountId, key, { subject, text }) {
  const r = await sql().query("UPDATE accounts SET notices = notices || jsonb_build_object($2::text, now()) WHERE id = $1 AND NOT (notices ? $2) RETURNING email", [accountId, key]);
  if (!r[0]) return { sent: false, already: true };
  return sendEmail({ to: r[0].email, subject, text });
}

// api/_lib/inputs.js — forgiving parsers for what people type. Each returns
// the clean value, or null when there is nothing usable. /smart-inputs.js does
// the same in the browser so fields tidy themselves as people type.

// "(555) 555-0123", "555.555.0123", "1 555 555 0123", "+44 20 7946 0958"
// -> E.164. Ten digits are read as a US/Canada number.
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const plus = /^\s*(\+|00)/.test(raw);
  let d = raw.replace(/(ext|x|#).*$/i, '').replace(/\D/g, '');
  if (raw.trim().startsWith('00')) d = d.slice(2);
  if (plus) return d.length >= 8 && d.length <= 15 ? '+' + d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

const DOMAIN_FIXES = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'outlok.com': 'outlook.com', 'iclod.com': 'icloud.com' };

// " Mailto:Jo@Acme.COM. " -> "jo@acme.com", with common domain typos fixed.
export function normalizeEmail(input) {
  let s = String(input || '').trim().replace(/^mailto:/i, '').replace(/^[<("']+|[>)"'.,;:]+$/g, '').toLowerCase();
  s = s.replace(/\s+/g, '').replace(/\.con$/, '.com').replace(/,com$/, '.com');
  const m = s.match(/^([^@]+)@(.+)$/);
  if (!m) return null;
  const domain = DOMAIN_FIXES[m[2]] || m[2];
  const out = `${m[1]}@${domain}`;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(out) ? out : null;
}

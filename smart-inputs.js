// smart-inputs.js — forgiving inputs. Nobody has to type "https://", "www",
// a country code or perfect capitals. Mirrors api/_lib/crawl.js normalizeUrl
// and api/_lib/inputs.js, which the server applies again.
//
//   <input data-smart="url">    acme.com, www.acme.com, "Acme.com/ ", hello@acme.com
//   <input data-smart="phone">  (555) 555-0123, 555.555.0123, +44 20 7946 0958
//   <input data-smart="email">  " Jo@Acme.COM ", jo@gmial.com
//
// window.smart.url(text) / .phone(text) / .email(text) return the clean value
// or null. Fields tidy themselves when they lose focus, and a quiet hint under
// the field shows what Squadron understood.
(function () {
  function url(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    if (/\s/.test(s)) s = (s.match(/\S*[a-z0-9-]\.[a-z]{2,}\S*/i) || [''])[0];
    s = s.replace(/^[<("'[]+|[>)"'\].,;:!?]+$/g, '');
    if (/^[^@/:]+@[^@/]+\.[a-z]{2,}$/i.test(s)) s = s.split('@')[1];
    var http = /^http:\/\//i.test(s);
    s = s.replace(/^h?t+p+s?(:\/*|\/+)/i, '').replace(/^\/+/, '');
    if (!s) return null;
    try {
      var u = new URL((http ? 'http://' : 'https://') + s);
      var host = u.hostname.toLowerCase().replace(/\.+$/, '');
      if (!/^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/.test(host)) return null;
      u.hostname = host; u.hash = '';
      return u.toString();
    } catch (e) { return null; }
  }
  function phone(input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    var plus = /^\s*(\+|00)/.test(raw);
    var d = raw.replace(/(ext|x|#).*$/i, '').replace(/\D/g, '');
    if (raw.indexOf('00') === 0) d = d.slice(2);
    if (plus) return d.length >= 8 && d.length <= 15 ? '+' + d : null;
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return null;
  }
  var FIX = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'outlok.com': 'outlook.com', 'iclod.com': 'icloud.com' };
  function email(input) {
    var s = String(input || '').trim().replace(/^mailto:/i, '').replace(/^[<("']+|[>)"'.,;:]+$/g, '').toLowerCase();
    s = s.replace(/\s+/g, '').replace(/\.con$/, '.com').replace(/,com$/, '.com');
    var m = s.match(/^([^@]+)@(.+)$/);
    if (!m) return null;
    var out = m[1] + '@' + (FIX[m[2]] || m[2]);
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(out) ? out : null;
  }
  function prettyPhone(e164) {
    var m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : e164;
  }
  function shortUrl(u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); }

  var fns = { url: url, phone: phone, email: email };
  window.smart = { url: url, phone: phone, email: email, prettyPhone: prettyPhone, shortUrl: shortUrl };

  function hintFor(el) {
    var id = el.id ? el.id + '__hint' : null;
    var h = id && document.getElementById(id);
    if (!h) {
      h = document.createElement('div');
      if (id) h.id = id;
      h.className = 'smart-hint';
      h.setAttribute('aria-live', 'polite');
      var box = el.closest('.hero-form, .cta-form') || (el.parentElement && el.parentElement.classList.contains('field') ? el.parentElement : el);
      box.insertAdjacentElement('afterend', h);
    }
    return h;
  }
  function describe(kind, v) {
    if (kind === 'url') return /apps\.apple\.com/.test(v) ? 'App Store listing found' : 'We will read ' + shortUrl(v);
    if (kind === 'phone') return 'Saved as ' + prettyPhone(v);
    return '';
  }
  function wire(el) {
    if (el.__smart) return; el.__smart = true;
    var kind = el.getAttribute('data-smart');
    var fn = fns[kind]; if (!fn) return;
    // Never let the browser reject "acme.com" for lacking https://.
    if (el.type === 'url' || el.type === 'email') el.type = 'text';
    el.setAttribute('autocapitalize', 'off'); el.setAttribute('autocorrect', 'off'); el.setAttribute('spellcheck', 'false');
    if (kind === 'url') el.setAttribute('inputmode', 'url');
    if (kind === 'email') el.setAttribute('inputmode', 'email');
    if (kind === 'phone') el.setAttribute('inputmode', 'tel');
    if (el.form) el.form.setAttribute('novalidate', '');
    var show = function (final) {
      var raw = el.value.trim(), v = fn(raw), h = hintFor(el);
      if (!raw) { h.textContent = ''; h.classList.remove('bad'); return; }
      if (v) {
        h.textContent = describe(kind, v); h.classList.remove('bad');
        if (final) el.value = kind === 'url' ? shortUrl(v) : kind === 'phone' ? prettyPhone(v) : v;
      } else if (final) {
        h.textContent = kind === 'url' ? 'Add the ending, like acme.com' : kind === 'phone' ? 'Include the area code' : 'Check the address, like you@company.com';
        h.classList.add('bad');
      }
    };
    el.addEventListener('input', function () { show(false); });
    el.addEventListener('blur', function () { show(true); });
  }
  function scan() { document.querySelectorAll('[data-smart]').forEach(wire); }
  var st = document.createElement('style');
  st.textContent = '.smart-hint{font-size:14px;line-height:1.4;margin-top:6px;min-height:0;color:#3D7A4E;font-weight:600}.smart-hint:empty{display:none}.smart-hint.bad{color:#B42318}';
  document.head.appendChild(st);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();

// Inline the flight-helmet SVGs so the callsign decals render in the site's own font.
(function () {
  var cache = {};
  function load(n) {
    if (!cache[n]) cache[n] = fetch('/helmets/' + n + '.svg').then(function (r) { return r.ok ? r.text() : ''; });
    return cache[n];
  }
  var els = document.querySelectorAll('[data-helmet]');
  function fill(el) {
    var n = el.getAttribute('data-helmet');
    load(n).then(function (svg) {
      if (!svg) return;
      el.innerHTML = svg;
      var s = el.querySelector('svg');
      if (s) { s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); }
    });
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); } });
    }, { rootMargin: '400px' });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(fill);
  }
})();

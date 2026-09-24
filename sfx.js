// Squadron hover sound effects, loosely Air Force: radar pings, jet flybys,
// cockpit switches and radio squelch. Sound is on by default; browsers only
// allow audio after the visitor's first click, tap or key press, so the audio
// engine unlocks on that first gesture. A small toggle lets visitors mute.
(function () {
  var KEY = 'sq-sound';
  var muted = false;
  try { muted = localStorage.getItem(KEY) === 'off'; } catch (e) {}
  window.sqMuted = muted;

  var ctx = null;
  function ac() {
    if (window.sqMuted) return null;
    if (typeof window.getAudio === 'function') { try { return window.getAudio(); } catch (e) {} }
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function unlock() {
    var c = ac(); if (c && c.state === 'suspended') c.resume();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { once: true, passive: true });
  });

  function noise(c, secs) {
    var b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = c.createBufferSource(); s.buffer = b; return s;
  }
  function env(c, g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  var SFX = {
    // Soft radar ping with a faint echo (nav and footer links)
    ping: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      [0, 0.16].forEach(function (off, i) {
        var o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(740, t + off);
        o.frequency.exponentialRampToValueAtTime(660, t + off + 0.3);
        var g = c.createGain(); env(c, g, t + off, i ? 0.018 : 0.045, 0.005, 0.35);
        o.connect(g); g.connect(c.destination); o.start(t + off); o.stop(t + off + 0.4);
      });
    },
    // Short jet flyby: filtered noise sweeping past with a Doppler drop (main buttons)
    jet: function () {
      var c = ac(); if (!c) return; var t = c.currentTime, d = 0.7;
      var n = noise(c, d);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(420, t + d);
      var pan = c.createStereoPanner ? c.createStereoPanner() : null;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.22); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      n.connect(bp);
      if (pan) { pan.pan.setValueAtTime(-0.8, t); pan.pan.linearRampToValueAtTime(0.8, t + d); bp.connect(pan); pan.connect(g); } else { bp.connect(g); }
      g.connect(c.destination); n.start(t); n.stop(t + d);
    },
    // Cockpit toggle switch (cards and questions)
    switch: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var n = noise(c, 0.03);
      var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      var g = c.createGain(); env(c, g, t, 0.12, 0.002, 0.03);
      n.connect(hp); hp.connect(g); g.connect(c.destination); n.start(t); n.stop(t + 0.04);
      var o = c.createOscillator(); o.type = 'square'; o.frequency.value = 180;
      var g2 = c.createGain(); env(c, g2, t, 0.03, 0.002, 0.04);
      o.connect(g2); g2.connect(c.destination); o.start(t); o.stop(t + 0.06);
    },
    // Full plane flyby for the logo: a jet roar that swells, pans across and
    // drops in pitch as it passes (Doppler), with a low engine rumble under it.
    flyby: function () {
      var c = ac(); if (!c) return; var t = c.currentTime, d = 2.4;
      var out = c.createGain(); out.gain.value = 0.9;
      var pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) { pan.pan.setValueAtTime(-0.9, t); pan.pan.linearRampToValueAtTime(0.9, t + d); out.connect(pan); pan.connect(c.destination); } else { out.connect(c.destination); }
      var swell = c.createGain();
      swell.gain.setValueAtTime(0.0001, t);
      swell.gain.exponentialRampToValueAtTime(0.22, t + d * 0.45);
      swell.gain.exponentialRampToValueAtTime(0.0001, t + d);
      swell.connect(out);
      var n = noise(c, d);
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2600, t + d * 0.45); lp.frequency.exponentialRampToValueAtTime(380, t + d);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(1400, t); bp.frequency.linearRampToValueAtTime(1700, t + d * 0.45); bp.frequency.exponentialRampToValueAtTime(520, t + d);
      var bpg = c.createGain(); bpg.gain.value = 0.35;
      n.connect(lp); lp.connect(swell); n.connect(bp); bp.connect(bpg); bpg.connect(swell);
      var o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(110, t + d * 0.45); o.frequency.exponentialRampToValueAtTime(62, t + d);
      var olp = c.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 240;
      var og = c.createGain(); og.gain.value = 0.25;
      o.connect(olp); olp.connect(og); og.connect(swell);
      n.start(t); n.stop(t + d); o.start(t); o.stop(t + d);
    },
    // Afterburner light-off: a low thump and a short roar (main button clicks)
    afterburner: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      var og = c.createGain(); env(c, og, t, 0.35, 0.01, 0.35); o.connect(og); og.connect(c.destination); o.start(t); o.stop(t + 0.4);
      var n = noise(c, 0.9);
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2200, t + 0.25); lp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
      var g = c.createGain(); env(c, g, t + 0.02, 0.2, 0.12, 0.75);
      n.connect(lp); lp.connect(g); g.connect(c.destination); n.start(t); n.stop(t + 0.9);
    },
    // Radar sweep: a soft rising tone with a faint return blip (sections scrolling in)
    sweep: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.5);
      var g = c.createGain(); env(c, g, t, 0.025, 0.2, 0.4); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.65);
      var b = c.createOscillator(); b.type = 'sine'; b.frequency.value = 660;
      var bg = c.createGain(); env(c, bg, t + 0.55, 0.03, 0.005, 0.25); b.connect(bg); bg.connect(c.destination); b.start(t + 0.55); b.stop(t + 0.85);
    },
    // Radio chatter: squelch, two short comm tones, squelch out (chat opens)
    chatter: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      [0, 0.42].forEach(function (off) {
        var n = noise(c, 0.1); var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.9;
        var g = c.createGain(); env(c, g, t + off, 0.06, 0.004, 0.09); n.connect(bp); bp.connect(g); g.connect(c.destination); n.start(t + off); n.stop(t + off + 0.12);
      });
      [[560, 0.14], [700, 0.26]].forEach(function (p) {
        var o = c.createOscillator(); o.type = 'square'; o.frequency.value = p[0];
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        var g = c.createGain(); env(c, g, t + p[1], 0.03, 0.004, 0.08); o.connect(lp); lp.connect(g); g.connect(c.destination); o.start(t + p[1]); o.stop(t + p[1] + 0.1);
      });
    },
    // Cockpit keypad tick (typing in the URL fields)
    key: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var n = noise(c, 0.015); var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 2;
      var g = c.createGain(); env(c, g, t, 0.05, 0.001, 0.015); n.connect(bp); bp.connect(g); g.connect(c.destination); n.start(t); n.stop(t + 0.02);
    },
    // Hydraulic hiss (FAQ answers opening), played after a switch click
    hiss: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var n = noise(c, 0.45); var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(3000, t); hp.frequency.linearRampToValueAtTime(1500, t + 0.45);
      var g = c.createGain(); env(c, g, t, 0.035, 0.05, 0.38); n.connect(hp); hp.connect(g); g.connect(c.destination); n.start(t); n.stop(t + 0.45);
    },
    // Radio "roger" beep: two quick tones (crew cards)
    radio: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      [[620, 0], [830, 0.075]].forEach(function (p) {
        var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = p[0];
        var g = c.createGain(); env(c, g, t + p[1], 0.05, 0.004, 0.07);
        o.connect(g); g.connect(c.destination); o.start(t + p[1]); o.stop(t + p[1] + 0.09);
      });
    },
    // Radio squelch: a burst of band-limited static (chat button)
    squelch: function () {
      var c = ac(); if (!c) return; var t = c.currentTime;
      var n = noise(c, 0.18);
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      var g = c.createGain(); env(c, g, t, 0.07, 0.004, 0.16);
      n.connect(bp); bp.connect(g); g.connect(c.destination); n.start(t); n.stop(t + 0.2);
    }
  };
  window.sqSfx = SFX;

  var last = new WeakMap();
  function bind(sel, name, gap) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        var now = Date.now(); if (now - (last.get(el) || 0) < (gap || 400)) return;
        last.set(el, now); SFX[name]();
      });
    });
  }
  var fine = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  if (fine) {
    bind('.nav-links a, .footer-links a, .cta-alt', 'ping');
    bind('.btn-primary, .nav-cta, .price-btn', 'jet', 900);
    bind('.step-card, .price-card, .faq-q', 'switch');
    bind('.portrait-card', 'radio', 600);
    bind('#sqChatBtn', 'squelch', 800);
  }

  // Clicks and other moments (these count as the visitor's first gesture, so they also unlock audio)
  document.querySelectorAll('.btn-primary, .nav-cta, .price-btn').forEach(function (el) {
    el.addEventListener('click', function () { SFX.afterburner(); });
  });
  var chatBtn = document.getElementById('sqChatBtn');
  if (chatBtn) chatBtn.addEventListener('click', function () {
    var w = document.getElementById('sqChatWindow');
    setTimeout(function () { if (w && w.classList.contains('open')) SFX.chatter(); }, 30);
  });
  document.querySelectorAll('details.faq-item').forEach(function (d) {
    d.addEventListener('toggle', function () { if (d.open) { SFX.switch(); setTimeout(SFX.hiss, 60); } });
  });
  var lastKey = 0;
  document.querySelectorAll('.hero-url, .cta-email, #sqChatInput').forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key.length !== 1 && e.key !== 'Backspace') return; var n = Date.now(); if (n - lastKey < 45) return; lastKey = n; SFX.key(); });
  });
  if ('IntersectionObserver' in window) {
    var swept = new WeakSet(), lastSweep = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || swept.has(e.target)) return;
        swept.add(e.target); var n = Date.now(); if (n - lastSweep < 1200) return; lastSweep = n; SFX.sweep();
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('.squad-section, .how-section, .pricing-section, .faq-section, .cta-strip').forEach(function (s) { io.observe(s); });
  }

  // Sound toggle, on by default
  var b = document.createElement('button');
  b.id = 'sqSoundToggle'; b.type = 'button';
  function paint() {
    b.setAttribute('aria-pressed', String(!window.sqMuted));
    b.setAttribute('aria-label', window.sqMuted ? 'Turn sound on' : 'Turn sound off');
    b.innerHTML = window.sqMuted
      ? '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none"/></svg><span>Sound off</span>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none"/></svg><span>Sound on</span>';
  }
  b.addEventListener('click', function () {
    window.sqMuted = !window.sqMuted;
    try { localStorage.setItem(KEY, window.sqMuted ? 'off' : 'on'); } catch (e) {}
    paint(); if (!window.sqMuted) SFX.radio();
  });
  paint();
  document.body.appendChild(b);
})();

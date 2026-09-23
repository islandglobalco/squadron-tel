// Squadron chat widget. Include on any page:
// <script src="https://squadron.tel/widget.js" data-business="biz_..." async></script>
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var business = script && script.getAttribute('data-business');
  if (!business) return;
  // squadron.tel redirects to www, and a redirected preflight fails, so the API is always called on www.
  var origin = ((script.src || '').replace(/\/widget\.js.*$/, '') || 'https://www.squadron.tel').replace('https://squadron.tel', 'https://www.squadron.tel');
  var accent = script.getAttribute('data-color') || '#CEEB00';
  var conversationId = null, open = false, busy = false, agent = null;

  var css = '\
.sqw-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;background:' + accent + ';box-shadow:0 8px 28px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center}\
.sqw-btn svg{width:30px;height:30px;fill:#07102B}\
.sqw-box{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);background:#07102B;color:#fff;border-radius:22px;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif}\
.sqw-box.open{display:flex}\
.sqw-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.1)}\
.sqw-head img{width:40px;height:40px;border-radius:10px;object-fit:cover;background:#0E1A3F}\
.sqw-head b{display:block;font-size:18px;font-weight:800}\
.sqw-head small{font-size:14px;color:#D2D8EA;font-weight:600}\
.sqw-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}\
.sqw-m{max-width:88%;padding:11px 14px;border-radius:16px;font-size:17px;line-height:1.45;background:rgba(255,255,255,0.09);white-space:pre-wrap;word-break:break-word}\
.sqw-m.me{align-self:flex-end;background:' + accent + ';color:#07102B;font-weight:600}\
.sqw-m.note{background:rgba(254,188,46,0.15);border:1px solid rgba(254,188,46,0.5);font-size:15px}\
.sqw-form{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,0.1)}\
.sqw-form input{flex:1;font:inherit;font-size:17px;padding:12px 14px;border-radius:999px;border:2px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.06);color:#fff;outline:none}\
.sqw-form button{font:inherit;font-weight:800;font-size:16px;padding:0 18px;border-radius:999px;border:none;background:' + accent + ';color:#07102B;cursor:pointer}\
.sqw-foot{font-size:13px;color:#C3CAE0;text-align:center;padding:0 12px 10px}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button'); btn.className = 'sqw-btn'; btn.setAttribute('aria-label', 'Chat with us');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
  var box = document.createElement('div'); box.className = 'sqw-box';
  box.innerHTML = '<div class="sqw-head"><img alt="" id="sqw-avatar"><div><b id="sqw-name">Customer service</b><small>AI agent · answers from what this business publishes</small></div></div><div class="sqw-msgs" id="sqw-msgs"></div><form class="sqw-form" id="sqw-form"><input id="sqw-in" placeholder="Ask a question" autocomplete="off"><button type="submit">Send</button></form><div class="sqw-foot">Powered by Squadron. You are chatting with an AI agent.</div>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var msgs = box.querySelector('#sqw-msgs'), input = box.querySelector('#sqw-in');

  function add(text, cls) { var d = document.createElement('div'); d.className = 'sqw-m ' + (cls || ''); d.textContent = text; msgs.appendChild(d); msgs.scrollTop = 1e9; return d; }
  function send(text, silent) {
    if (!text || busy) return;
    busy = true; if (!silent) add(text, 'me'); input.value = '';
    var typing = add('…');
    fetch(origin + '/api/converse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: business, conversationId: conversationId, message: text, channel: 'chat' }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        typing.remove();
        if (!x.ok) { add(x.j.error || 'Something went wrong. Please try again.', 'note'); return; }
        conversationId = x.j.conversationId;
        if (x.j.agent) { agent = x.j.agent; box.querySelector('#sqw-name').textContent = agent.persona + ' · ' + agent.title; if (agent.portrait) box.querySelector('#sqw-avatar').src = (/cdn\.midjourney\.com\/([0-9a-f-]{36})\//.test(agent.portrait) ? origin + '/portraits/' + RegExp.$1 + '.webp' : agent.portrait); }
        add(x.j.reply);
        if (x.j.replyType === 'transfer') add('A person will follow up with you.', 'note');
      })
      .catch(function () { typing.remove(); add('Could not reach the team. Please try again.', 'note'); })
      .then(function () { busy = false; });
  }
  btn.addEventListener('click', function () { open = !open; box.classList.toggle('open', open); if (open) { input.focus(); if (!msgs.children.length) send('Hello', true); } });
  box.querySelector('#sqw-form').addEventListener('submit', function (e) { e.preventDefault(); send(input.value.trim()); });
})();

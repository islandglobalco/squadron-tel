// Squadron phone bridge for Cloudflare Workers (free plan).
// The Worker answers Twilio's voice webhook; each call's media stream is
// handled by a Durable Object so every audio event gets its own CPU budget.
// Behaviour matches server.js (the Node version): AI and recording notice
// before the stream, barge-in, and tools for knowledge lookup, messages,
// gaps and transfer.

function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

async function vercel(env, path, body) {
  const origin = (env.SQUADRON_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
  const r = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-bridge-secret': env.BRIDGE_SECRET }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function twilio(env, path, params) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new Error('Twilio credentials are not configured');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Twilio ${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, runtime: 'cloudflare-workers' });
    if (url.pathname === '/twilio/voice' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      const to = form.get('To'), from = form.get('From'), callSid = form.get('CallSid');
      let ctx = null;
      try { ctx = await vercel(env, `/api/bridge/context?number=${encodeURIComponent(to)}`); } catch (e) { console.log('context failed', e.message); }
      const headers = { 'Content-Type': 'text/xml' };
      if (!ctx || !ctx.ok) {
        const why = ctx && ctx.reason === 'paused' ? 'This business has reached its plan allowance, so its assistant is paused right now. Please try again later.' : 'This number is not assigned to a business right now. Goodbye.';
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(why)}</Say><Hangup/></Response>`, { headers });
      }
      const notice = `This call is answered by an A I agent for ${ctx.businessName}. It is recorded for quality.`;
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(notice)}</Say><Connect><Stream url="wss://${url.host}/media"><Parameter name="businessId" value="${xml(ctx.businessId)}"/><Parameter name="callSid" value="${xml(callSid)}"/><Parameter name="from" value="${xml(from)}"/><Parameter name="to" value="${xml(to)}"/><Parameter name="demo" value="${ctx.demo ? '1' : '0'}"/></Stream></Connect></Response>`, { headers });
    }
    if (url.pathname === '/media') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const id = env.CALLS.newUniqueId();
      return env.CALLS.get(id).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};

export class CallSession {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, tw] = Object.values(pair);
    tw.accept();
    this.run(tw).catch((e) => console.log('call error', e.message));
    return new Response(null, { status: 101, webSocket: client });
  }

  async run(tw) {
    const env = this.env;
    const model = env.REALTIME_MODEL || 'gpt-realtime-2.1';
    let streamSid = null, callSid = null, businessId = null, demo = false, ctx = null, oai = null, oaiReady = false, closed = false;
    const transcript = [], gaps = [], messages = [];
    let transferRequested = false;
    const startedAt = Date.now();
    let lastAssistantItem = null, responseStartTs = null, latestMediaTs = 0;
    const sendTw = (o) => { try { tw.send(JSON.stringify(o)); } catch {} };
    const sendOai = (o) => { if (oai && oaiReady) try { oai.send(JSON.stringify(o)); } catch {} };

    const openOpenAI = async () => {
      ctx = await vercel(env, `/api/bridge/session?businessId=${encodeURIComponent(businessId)}&model=${encodeURIComponent(model)}`);
      // Squadron issues a short-lived key per call; a worker-held OPENAI_API_KEY is only a fallback.
      const key = ctx.clientSecret || env.OPENAI_API_KEY;
      const resp = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${key}` } });
      oai = resp.webSocket;
      if (!oai) throw new Error(`OpenAI did not accept the WebSocket (${resp.status})`);
      oai.accept();
      oaiReady = true;
      sendOai({ type: 'session.update', session: { type: 'realtime', instructions: ctx.session.instructions, tools: ctx.session.tools, tool_choice: 'auto', audio: { input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', interrupt_response: true } }, output: { format: { type: 'audio/pcmu' }, voice: ctx.session.audio.output.voice } } } });
      sendOai({ type: 'response.create' });
      oai.addEventListener('message', (m) => {
        let ev; try { ev = JSON.parse(typeof m.data === 'string' ? m.data : new TextDecoder().decode(m.data)); } catch { return; }
        switch (ev.type) {
          case 'response.output_audio.delta':
            if (streamSid) { sendTw({ event: 'media', streamSid, media: { payload: ev.delta } }); if (responseStartTs == null) responseStartTs = latestMediaTs; if (ev.item_id) lastAssistantItem = ev.item_id; }
            break;
          case 'response.output_audio_transcript.done':
            if (ev.transcript) transcript.push({ role: 'agent', text: ev.transcript, agent_id: ctx.agent.id, agent_name: `${ctx.agent.persona} · ${ctx.agent.title}`, at: new Date().toISOString() });
            break;
          case 'conversation.item.input_audio_transcription.completed':
            if (ev.transcript && ev.transcript.trim()) transcript.push({ role: 'customer', text: ev.transcript.trim(), at: new Date().toISOString() });
            break;
          case 'input_audio_buffer.speech_started':
            if (lastAssistantItem && responseStartTs != null) sendOai({ type: 'conversation.item.truncate', item_id: lastAssistantItem, content_index: 0, audio_end_ms: Math.max(0, latestMediaTs - responseStartTs) });
            if (streamSid) sendTw({ event: 'clear', streamSid });
            lastAssistantItem = null; responseStartTs = null;
            break;
          case 'response.function_call_arguments.done':
            this.state.waitUntil(handleTool(ev).catch((e) => console.log('tool error', e.message)));
            break;
          case 'error':
            console.log('openai error', JSON.stringify(ev.error || ev).slice(0, 300));
            break;
        }
      });
      oai.addEventListener('close', () => { oaiReady = false; });
    };

    const handleTool = async (ev) => {
      let args = {}; try { args = JSON.parse(ev.arguments || '{}'); } catch {}
      let output = { ok: true };
      if (ev.name === 'lookup_knowledge') {
        try { const r = await vercel(env, '/api/bridge/event', { businessId, callSid, type: 'lookup', query: args.query }); output = { ok: true, results: r.results }; } catch (e) { output = { ok: false, note: e.message }; }
      } else if (ev.name === 'take_message') {
        messages.push({ message: args.message, contact: args.contact }); if (args.question) gaps.push(args.question);
        output = { ok: true, note: 'The message is recorded. Tell the caller a person will follow up.' };
      } else if (ev.name === 'log_gap') {
        if (args.question) gaps.push(args.question);
      } else if (ev.name === 'request_transfer') {
        transferRequested = true;
        const target = ctx.settings && ctx.settings.on_call_phone;
        if (target && !demo) {
          output = { ok: true, note: 'Say one short sentence that you are transferring now, then stop speaking.' };
          setTimeout(() => twilio(env, `/Calls/${callSid}.json`, { Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial>${xml(target)}</Dial></Response>` }).catch((e) => console.log('transfer failed', e.message)), 4000);
        } else {
          output = { ok: false, note: demo ? 'This is a demo call, so no transfer is possible. Say so and offer to take a message.' : 'No on-call number is set for this business. Say that no one is available to transfer to right now and offer to take a message.' };
        }
      }
      sendOai({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) } });
      sendOai({ type: 'response.create' });
    };

    const finish = async () => {
      if (closed) return; closed = true;
      try { if (oai) oai.close(); } catch {}
      try {
        await vercel(env, '/api/bridge/call-ended', { businessId, callSid, from: ctx && ctx.from, demo, transcript, gaps, messages, transferRequested, durationS: Math.round((Date.now() - startedAt) / 1000), agentId: ctx && ctx.agent.id, agentName: ctx && `${ctx.agent.persona} · ${ctx.agent.title}` });
      } catch (e) { console.log('call-ended failed', e.message); }
    };

    tw.addEventListener('message', (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        const p = msg.start.customParameters || {};
        businessId = p.businessId; callSid = p.callSid || msg.start.callSid; demo = p.demo === '1';
        this.state.waitUntil(openOpenAI().then(() => {
          ctx.from = p.from; ctx.to = p.to;
          const origin = (env.SQUADRON_ORIGIN || 'https://www.squadron.tel').replace(/\/$/, '');
          return twilio(env, `/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: `${origin}/api/bridge/recording?secret=${encodeURIComponent(env.BRIDGE_SECRET)}&businessId=${encodeURIComponent(businessId)}`, RecordingStatusCallbackEvent: 'completed', RecordingChannels: 'dual' }).catch((e) => console.log('recording failed', e.message));
        }).catch((e) => { console.log('session failed', e.message); try { tw.close(1011, 'session failed'); } catch {} }));
      } else if (msg.event === 'media') {
        latestMediaTs = Number(msg.media.timestamp) || latestMediaTs;
        sendOai({ type: 'input_audio_buffer.append', audio: msg.media.payload });
      } else if (msg.event === 'stop') {
        this.state.waitUntil(finish());
      }
    });
    tw.addEventListener('close', () => this.state.waitUntil(finish()));
  }
}

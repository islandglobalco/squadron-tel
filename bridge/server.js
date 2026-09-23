// Squadron phone bridge.
// Twilio sends an inbound call here; the caller hears the AI notice and the
// recording notice, then the call audio is streamed to an OpenAI Realtime
// session built from the business's profile and team (fetched from Vercel).
// The session can look up knowledge, take a message, log a gap, and ask for a
// transfer; the bridge executes those against Vercel and Twilio.

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;
const ORIGIN = (process.env.SQUADRON_ORIGIN || 'https://squadron.tel').replace(/\/$/, '');
const SECRET = process.env.BRIDGE_SECRET;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const PUBLIC_HOST = process.env.PUBLIC_HOST; // e.g. squadron-bridge.up.railway.app
const MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1';

for (const [k, v] of Object.entries({ BRIDGE_SECRET: SECRET, OPENAI_API_KEY: OPENAI_KEY })) if (!v) console.error(`Missing ${k}`);

function log(...a) { console.log(new Date().toISOString(), ...a); }
function xml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

async function vercel(path, body) {
  const r = await fetch(`${ORIGIN}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-bridge-secret': SECRET }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function twilio(path, params) {
  if (!TW_SID || !TW_TOKEN) throw new Error('Twilio credentials are not configured');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Twilio ${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); });
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, model: MODEL })); }
  if (url.pathname === '/twilio/voice' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const to = form.get('To'), from = form.get('From'), callSid = form.get('CallSid');
    let ctx = null;
    try { ctx = await vercel(`/api/bridge/context?number=${encodeURIComponent(to)}`); } catch (e) { log('context failed', e.message); }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    if (!ctx || !ctx.ok) {
      const why = ctx && ctx.reason === 'paused' ? 'This business has reached its plan allowance, so its assistant is paused right now. Please try again later.' : 'This number is not assigned to a business right now. Goodbye.';
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(why)}</Say><Hangup/></Response>`);
    }
    const host = PUBLIC_HOST || req.headers.host;
    const notice = `This call is answered by an A I agent for ${ctx.businessName}. It is recorded for quality.`;
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(notice)}</Say><Connect><Stream url="wss://${host}/media"><Parameter name="businessId" value="${xml(ctx.businessId)}"/><Parameter name="callSid" value="${xml(callSid)}"/><Parameter name="from" value="${xml(from)}"/><Parameter name="to" value="${xml(to)}"/><Parameter name="demo" value="${ctx.demo ? '1' : '0'}"/></Stream></Connect></Response>`);
  }
  if (url.pathname === '/twilio/status' && req.method === 'POST') { await readBody(req); res.writeHead(200); return res.end(); }
  res.writeHead(404); res.end('Not found');
});

// ---------------------------------------------------------------- Media
const wss = new WebSocketServer({ server, path: '/media' });

wss.on('connection', (tw) => {
  let streamSid = null, callSid = null, businessId = null, demo = false, ctx = null;
  let oai = null, oaiReady = false, closed = false;
  const transcript = [];
  const gaps = [], messages = [];
  let transferRequested = false, recordingStarted = false;
  const startedAt = Date.now();
  let lastAssistantItem = null, responseStartTs = null, latestMediaTs = 0;

  const sendTw = (obj) => { if (tw.readyState === WebSocket.OPEN) tw.send(JSON.stringify(obj)); };
  const sendOai = (obj) => { if (oai && oai.readyState === WebSocket.OPEN) oai.send(JSON.stringify(obj)); };

  async function openOpenAI() {
    ctx = await vercel(`/api/bridge/session?businessId=${encodeURIComponent(businessId)}`);
    oai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`, { headers: { Authorization: `Bearer ${OPENAI_KEY}` } });
    oai.on('open', () => {
      sendOai({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: ctx.session.instructions,
          tools: ctx.session.tools,
          tool_choice: 'auto',
          audio: {
            input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', interrupt_response: true } },
            output: { format: { type: 'audio/pcmu' }, voice: ctx.session.audio.output.voice },
          },
        },
      });
      oaiReady = true;
      sendOai({ type: 'response.create' });
      log('openai session up', callSid, businessId);
    });
    oai.on('message', (raw) => {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      switch (ev.type) {
        case 'response.output_audio.delta':
          if (streamSid) {
            sendTw({ event: 'media', streamSid, media: { payload: ev.delta } });
            if (responseStartTs == null) responseStartTs = latestMediaTs;
            if (ev.item_id) lastAssistantItem = ev.item_id;
            sendTw({ event: 'mark', streamSid, mark: { name: 'r' } });
          }
          break;
        case 'response.output_audio_transcript.done':
          if (ev.transcript) transcript.push({ role: 'agent', text: ev.transcript, agent_id: ctx.agent.id, agent_name: `${ctx.agent.persona} · ${ctx.agent.title}`, at: new Date().toISOString() });
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (ev.transcript && ev.transcript.trim()) transcript.push({ role: 'customer', text: ev.transcript.trim(), at: new Date().toISOString() });
          break;
        case 'input_audio_buffer.speech_started':
          // Barge-in: stop playing what is queued and truncate the assistant item.
          if (lastAssistantItem && responseStartTs != null) {
            const elapsed = Math.max(0, latestMediaTs - responseStartTs);
            sendOai({ type: 'conversation.item.truncate', item_id: lastAssistantItem, content_index: 0, audio_end_ms: elapsed });
          }
          if (streamSid) sendTw({ event: 'clear', streamSid });
          lastAssistantItem = null; responseStartTs = null;
          break;
        case 'response.function_call_arguments.done':
          handleTool(ev).catch((e) => log('tool error', e.message));
          break;
        case 'error':
          log('openai error', JSON.stringify(ev.error || ev).slice(0, 300));
          break;
      }
    });
    oai.on('close', () => { oaiReady = false; log('openai closed', callSid); });
    oai.on('error', (e) => log('openai ws error', e.message));
  }

  async function handleTool(ev) {
    let args = {}; try { args = JSON.parse(ev.arguments || '{}'); } catch {}
    let output = { ok: true };
    if (ev.name === 'lookup_knowledge') {
      try { const r = await vercel('/api/bridge/event', { businessId, callSid, type: 'lookup', query: args.query }); output = { ok: true, results: r.results }; } catch (e) { output = { ok: false, note: e.message }; }
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
        setTimeout(() => transfer(target).catch((e) => log('transfer failed', e.message)), 4000);
      } else {
        output = { ok: false, note: demo ? 'This is a demo call, so no transfer is possible. Say so and offer to take a message.' : 'No on-call number is set for this business. Say that no one is available to transfer to right now and offer to take a message.' };
      }
    }
    sendOai({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) } });
    sendOai({ type: 'response.create' });
  }

  async function transfer(target) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial callerId="${xml(ctx.to || '')}">${xml(target)}</Dial></Response>`;
    await twilio(`/Calls/${callSid}.json`, { Twiml: twiml });
    log('transferred', callSid, 'to', target);
  }

  async function startRecording() {
    if (recordingStarted || !callSid || !TW_SID) return;
    recordingStarted = true;
    try {
      await twilio(`/Calls/${callSid}/Recordings.json`, { RecordingStatusCallback: `${ORIGIN}/api/bridge/recording?secret=${encodeURIComponent(SECRET)}&businessId=${encodeURIComponent(businessId)}`, RecordingStatusCallbackEvent: 'completed', RecordingChannels: 'dual' });
    } catch (e) { log('recording failed', e.message); }
  }

  async function finish() {
    if (closed) return; closed = true;
    try { if (oai) oai.close(); } catch {}
    const durationS = Math.round((Date.now() - startedAt) / 1000);
    try {
      await vercel('/api/bridge/call-ended', { businessId, callSid, from: ctx && ctx.from, demo, transcript, gaps, messages, transferRequested, durationS, agentId: ctx && ctx.agent.id, agentName: ctx && `${ctx.agent.persona} · ${ctx.agent.title}` });
    } catch (e) { log('call-ended failed', e.message); }
    log('call finished', callSid, durationS + 's');
  }

  tw.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.event) {
      case 'start': {
        streamSid = msg.start.streamSid;
        const p = msg.start.customParameters || {};
        businessId = p.businessId; callSid = p.callSid || msg.start.callSid; demo = p.demo === '1';
        openOpenAI().then(() => { ctx.from = p.from; ctx.to = p.to; startRecording(); }).catch((e) => { log('session failed', e.message); tw.close(); });
        break;
      }
      case 'media':
        latestMediaTs = Number(msg.media.timestamp) || latestMediaTs;
        if (oaiReady) sendOai({ type: 'input_audio_buffer.append', audio: msg.media.payload });
        break;
      case 'stop':
        finish(); break;
    }
  });
  tw.on('close', finish);
  tw.on('error', (e) => { log('twilio ws error', e.message); finish(); });
});

server.listen(PORT, () => log(`Squadron bridge listening on ${PORT}`));

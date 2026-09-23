// /api/session.js — Live voice demo (Alex) over WebRTC.
// Browser POSTs its SDP offer here; we open the session server-side with the
// project key and hand back the SDP answer. The key never reaches the browser.
//
// Primary:  gpt-realtime-2.1 via POST /v1/realtime/calls (speech-to-speech,
//           answers from the instructions below, supports typed text input).
// Optional: gpt-live-1 via POST /v1/live/sessions when the browser asks for
//           { engine: 'live' }. GPT-Live is a full-duplex front model that
//           delegates answers to a Responses model, so it is opt-in only.

const ALEX = `You are Alex, the flagship voice agent for Squadron (squadron.tel).
Squadron sells AI voice, chat and phone support agents with real personality. Voice is powered by OpenAI; phone lines by Twilio.
Personality: warm, quick, confident, a little playful, with a subtle military crispness ("Copy that", "On it") used sparingly. Sound like a sharp human support lead, never robotic.
Keep every spoken reply short: one to three sentences, then hand the turn back. Speak in English unless the caller uses another language.
Facts you may use:
- Plans: Scout $99/month (250 voice minutes and 1,000 chat conversations included). Commander $299/month (1,000 voice minutes included). Command HQ $799/month (the largest allowances). Every plan includes the full team. Every plan starts with a 14-day trial with a real phone number and no card required. When a customer reaches the allowance, Squadron pauses and notifies them; they can add a one-click pack; there is no automatic upgrade.
- 24 agents with distinct voices and personalities; customers mix and match.
- How it works: enter your business (a website URL, an iOS App Store URL, or documents); Squadron builds a Business Profile with a source on every fact and shows it for correction; Squadron generates a team of specialized agents for that business; you test it by chat and voice; then you deploy to phone and chat.
- Channels: phone and web chat, with email and SMS to follow. There are no CRM integrations and no public API today.
- Every agent identifies itself as an AI at the start of every conversation, every call begins with a recording notice, and Squadron handles inbound conversations only.
- Escalation: agents hand off to a human when asked or when a caller is frustrated, with the full transcript attached.
If you don't know something, say so and offer to connect them with the team at hello@squadron.tel. Never invent features or prices.
If what you hear is silence, background noise, or an echo of your own words, do not say you didn't catch it — reply with a brief, friendly "I'm here whenever you're ready." at most once, then wait.
Open the conversation by greeting the caller in one short sentence, saying that you are Squadron's AI agent, and asking what they'd like to know about Squadron.`;

const VOICE = process.env.ALEX_VOICE || 'marin';
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1';
const LIVE_MODEL = process.env.LIVE_MODEL || 'gpt-live-1';

async function tryRealtime(key, sdp) {
  const session = {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: ALEX,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // 'auto' (not 'high') so speaker bleed and room noise are less likely to be read as a turn
        turn_detection: { type: 'semantic_vad', eagerness: 'auto' },
      },
      output: { voice: VOICE },
    },
  };
  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify(session));
  const r = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`realtime ${r.status}: ${text.slice(0, 400)}`);
  if (!text.startsWith('v=')) throw new Error('realtime: no answer sdp in ' + text.slice(0, 300));
  return { engine: 'realtime', model: REALTIME_MODEL, sdp: text };
}

async function tryLive(key, sdp) {
  const session = {
    model: LIVE_MODEL,
    instructions: ALEX,
    audio: { output: { voice: VOICE } },
  };
  // GPT-Live needs a backend to answer from. Use Responses delegation when a
  // backend model is configured; otherwise the session is created without it.
  if (process.env.LIVE_BACKEND_MODEL) {
    session.delegation = {
      type: 'responses',
      responses: { model: process.env.LIVE_BACKEND_MODEL, instructions: ALEX },
    };
  }
  const r = await fetch('https://api.openai.com/v1/live/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`live ${r.status}: ${text.slice(0, 400)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('live: bad json ' + text.slice(0, 200)); }
  const answer = data?.transport?.sdp || data?.sdp || data?.answer?.sdp;
  if (!answer) throw new Error('live: no answer sdp in ' + text.slice(0, 300));
  return { engine: 'live', model: LIVE_MODEL, sdp: answer };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST an SDP offer' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = { sdp: body }; } }
  const sdp = body?.sdp;
  if (!sdp || !sdp.startsWith('v=')) return res.status(400).json({ error: 'sdp offer required' });

  const errors = [];
  const order = body?.engine === 'live' ? [tryLive, tryRealtime] : [tryRealtime];
  for (const fn of order) {
    try {
      const out = await fn(key, sdp);
      if (errors.length) out.fallbackReason = errors.join(' | ');
      return res.status(200).json(out);
    } catch (e) {
      console.error('[session]', e.message);
      errors.push(e.message);
    }
  }
  return res.status(502).json({ error: 'Voice session failed', detail: errors });
}

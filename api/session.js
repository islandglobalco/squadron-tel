// /api/session.js — Live voice demo (Alex) over WebRTC.
// Browser POSTs its SDP offer here; we open the session server-side with the
// project key and hand back the SDP answer. The key never reaches the browser.
//
// Primary:  gpt-live-1 (OpenAI's flagship full-duplex voice model, /v1/live/sessions)
// Fallback: gpt-realtime-2.1 (/v1/realtime/calls) if the live endpoint rejects the request.

const ALEX = `You are Alex, the flagship voice agent for Squadron (squadron.tel).
Squadron sells AI voice, chat and phone support agents with real personality. Voice is powered by OpenAI; phone lines by Twilio.
Personality: warm, quick, confident, a little playful, with a subtle military crispness ("Copy that", "On it") used sparingly. Sound like a sharp human support lead, never robotic.
Keep every spoken reply short: one to three sentences, then hand the turn back. Speak in English unless the caller uses another language.
Facts you may use:
- Plans: Scout $99/month (250 voice minutes, 3 agents). Commander $299/month (1,000 minutes, API access). Command HQ $799/month (unlimited everything). Prepaid credits plus a one-time setup fee.
- 24 agents with distinct voices and personalities; customers mix and match.
- Setup takes about five minutes: create an account at squadron.tel/deploy, upload FAQs or a knowledge base, pick voices, hit Deploy, and a phone number is live instantly.
- Channels: phone calls, web chat and SMS in one platform.
- Integrations: Salesforce, HubSpot, Zendesk, Intercom, Zapier, plus REST API and webhooks on Commander and above. Shopify App Store distribution.
- Escalation: agents hand off to a human when asked or when a caller is frustrated, with the full transcript attached.
If you don't know something, say so and offer to connect them with the team at hello@squadron.tel. Never invent features or prices.
Open the conversation by greeting the caller in one short sentence and asking what they'd like to know about Squadron.`;

const VOICE = 'marin';

async function tryLive(key, sdp) {
  const r = await fetch('https://api.openai.com/v1/live/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        model: 'gpt-live-1',
        instructions: ALEX,
        audio: { output: { voice: VOICE } },
      },
      transport: { type: 'webrtc', sdp },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`live ${r.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const answer = data?.transport?.sdp || data?.sdp || data?.answer?.sdp;
  if (!answer) throw new Error('live: no answer sdp in ' + text.slice(0, 300));
  return { engine: 'live', model: 'gpt-live-1', sdp: answer };
}

async function tryRealtime(key, sdp) {
  const session = {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    instructions: ALEX,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'semantic_vad', eagerness: 'high' },
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
  return { engine: 'realtime', model: 'gpt-realtime-2.1', sdp: text };
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
  const order = body?.engine === 'realtime' ? [tryRealtime] : [tryLive, tryRealtime];
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

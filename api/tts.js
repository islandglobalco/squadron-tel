// /api/tts.js — OpenAI TTS voice preview for Squadron AI agents
// Uses gpt-4o-mini-tts (OpenAI's newest, steerable TTS) with per-agent voice + delivery direction.
// Output is lossless WAV (24 kHz PCM) so previews never carry MP3 compression artifacts.

const AGENTS = [
  { name: 'Nighthawk', voice: 'coral', tone: 'Calm and unhurried, steady under pressure; plain words, no fuss.', text: "I'm Nighthawk, an AI agent. I take the difficult conversations, usually late, and I stay with them until there's a clear next step." },
  { name: 'Relay', voice: 'sage', tone: 'Quiet, clear and precise; says what matters and stops.', text: "I'm Relay. I handle live chat: short, accurate answers, and a person when you need one." },
  { name: 'Ricochet', voice: 'marin', tone: 'Even and matter-of-fact about policy, never apologetic for effect.', text: "I'm Ricochet. Returns and refunds. I'll tell you what the policy allows and what happens next." },
  { name: 'Torque', voice: 'cedar', tone: 'Low, calm and exact; explains technical detail plainly.', text: "I'm Torque. Technical questions. I'll walk through it step by step, and I'll say so when something needs an engineer." },
  { name: 'Sparrow', voice: 'verse', tone: 'Brisk but relaxed; answers directly without selling.', text: "I'm Sparrow. The common questions, like hours, prices and where things are. Quick, straight answers." },
  { name: 'Flightline', voice: 'shimmer', tone: 'Patient and composed; explains one step at a time.', text: "I'm Flightline. I help new customers get set up, one step at a time, at whatever pace suits them." },
  { name: 'Scramble', voice: 'onyx', tone: 'Composed and direct; sorts out the problem quickly without drama.', text: "I'm Scramble. I work out what you need and get you to the right place, quickly." },
  { name: 'Locksmith', voice: 'nova', tone: 'Measured and reassuring without being sugary.', text: "I'm Locksmith. Locked out, lost password, wrong email on file. We'll sort it out carefully." },
  { name: 'Ledger', voice: 'ash', tone: 'Relaxed and knowledgeable; plain about numbers.', text: "I'm Ledger. Billing and payments. I'll tell you what you were charged and why, in plain terms." },
  { name: 'Briefer', voice: 'coral', tone: 'Thoughtful and clear, like a colleague who knows the product well.', text: "I'm Briefer. I explain how things work, in as much or as little detail as you want." },
  { name: 'Boomerang', voice: 'ballad', tone: 'Easygoing and steady; keeps the context, no sales patter.', text: "I'm Boomerang. I look after returning customers and pick up where your last conversation left off." },
  { name: 'Brass', voice: 'marin', tone: 'Precise, calm and understated, like a senior account lead.', text: "I'm Brass. I work with larger accounts, where the questions need a careful answer." },
  { name: 'Tower', voice: 'cedar', tone: 'Grounded and orderly; confirms details without chatter.', text: "I'm Tower. Scheduling and bookings. I'll find a time that works and confirm it back to you." },
  { name: 'Archive', voice: 'sage', tone: 'Thoughtful and articulate; says what is written down and nothing more.', text: "I'm Archive. If it's written down somewhere, I'll find it and tell you where it came from." },
  { name: 'Rosetta', voice: 'shimmer', tone: 'Soft-spoken, attentive and unhurried.', text: "I'm Rosetta. I speak with customers in their own language, clearly and without rushing." },
  { name: 'Medic', voice: 'echo', tone: 'Calm, level and sincere; listens more than he talks.', text: "I'm Medic. When something has gone wrong, I listen first, then tell you honestly what can be done." },
  { name: 'Wingman', voice: 'nova', tone: 'Relaxed and genuine; recommends only what fits and never pushes.', text: "I'm Wingman. If there's a better option for you, I'll mention it once, and I won't push." },
  { name: 'Gavel', voice: 'onyx', tone: 'Concise, even-handed and serious.', text: "I'm Gavel. Disputes and complicated cases. I'll lay out the facts and what can happen next." },
  { name: 'Afterburner', voice: 'verse', tone: 'Quick and efficient but calm; no hype.', text: "I'm Afterburner. When it gets busy, I keep answers fast and accurate so nobody waits long." },
  { name: 'Redeye', voice: 'ash', tone: 'Low-key and steady, a calm night-shift voice.', text: "I'm Redeye. I cover the overnight hours. The same answers you'd get during the day, just quieter." },
  { name: 'Envoy', voice: 'coral', tone: 'Discreet, polished and quietly attentive.', text: "I'm Envoy. I look after your most important customers, quietly and carefully." },
  { name: 'Ace', voice: 'marin', tone: 'Calm, natural and self-assured; the first voice customers hear.', text: "I'm Ace, an AI agent. I answer first, handle what I can, and bring in the right person when it's needed." },
  { name: 'Throttle', voice: 'ballad', tone: 'Easygoing and matter-of-fact.', text: "I'm Throttle. Orders and deliveries. I'll tell you where it is and when it should arrive." },
  { name: 'Doc', voice: 'alloy', tone: 'Even-keeled, knowledgeable and plainspoken.', text: "I'm Doc. The detailed product questions. If I know, I'll tell you plainly, and if I don't, I'll say so." },
];

// Each preview is generated once, stored in Vercel Blob, and served from
// there forever after, so visitors never cause new OpenAI spend.
const VERSION = 'v4';

async function stream(res, r, agent) {
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.setHeader('X-Agent-Name', agent.name);
  const reader = r.stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
  res.end();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  const idx = Math.max(0, Math.min(AGENTS.length - 1, parseInt(req.query.agent || '0', 10) || 0));
  const agent = AGENTS[idx];
  const blob = await import('@vercel/blob');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const path = `voices/agent-${idx}-${VERSION}.wav`;
  try {
    let r = null;
    try { r = await blob.get(path, { access: 'private', token }); } catch (e) { if (!(e instanceof blob.BlobNotFoundError)) throw e; }
    if (r && r.stream) return stream(res, r, agent);
    // First request for this voice ever: generate it once and keep it.
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: agent.voice,
        input: agent.text,
        instructions: `Voice direction: ${agent.tone} Speak like a calm, knowledgeable person talking to one other person: relaxed and unhurried, even pitch, plain delivery, no performed enthusiasm and no sales energy. This is a short self-introduction.`,
        response_format: 'wav',
        speed: 1.0,
      }),
    });
    if (!ttsRes.ok) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: 'Voice preview is unavailable right now.' }); return; }
    const buf = Buffer.from(await ttsRes.arrayBuffer());
    await blob.put(path, buf, { access: 'private', contentType: 'audio/wav', addRandomSuffix: false, allowOverwrite: false, token }).catch((e) => console.error('[tts store]', e.message));
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(buf);
  } catch (err) {
    console.error('[tts]', err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Internal error' });
  }
}

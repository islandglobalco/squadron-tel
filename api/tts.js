// /api/tts.js — OpenAI TTS voice preview for Squadron AI agents
// Uses gpt-4o-mini-tts with the marin and cedar voices (the ones live calls use)
// plus per-agent delivery direction, so a preview sounds like the real agent.
// Output is lossless WAV (24 kHz PCM) so previews never carry MP3 compression artifacts.

const AGENTS = [
  { name: 'Nighthawk', voice: 'marin', tone: 'Calm and unhurried, steady under pressure; plain words, no fuss.', text: "Hey, I'm Nighthawk. I'm usually the one who picks up late at night, when something's gone sideways. We'll sort it out together." },
  { name: 'Relay', voice: 'marin', tone: 'Quiet, clear and precise; says what matters and stops.', text: "Hi, I'm Relay. I'm on chat, so ask me anything and I'll keep it quick. If you'd rather talk to a person, just say so." },
  { name: 'Ricochet', voice: 'marin', tone: 'Even and matter-of-fact about policy, never apologetic for effect.', text: "Hi there, I'm Ricochet. I handle returns and refunds, so tell me what happened and I'll walk you through exactly what's possible." },
  { name: 'Torque', voice: 'cedar', tone: 'Low, calm and exact; explains technical detail plainly.', text: "Hey, I'm Torque. Technical stuff is my thing. We'll go step by step, and if it needs an engineer, I'll get you one." },
  { name: 'Sparrow', voice: 'marin', tone: 'Relaxed and direct; answers plainly without selling.', text: "Hi! I'm Sparrow. Hours, prices, where to find things. Ask away, I'll give you a straight answer." },
  { name: 'Flightline', voice: 'marin', tone: 'Patient and composed; explains one step at a time.', text: "Hi, I'm Flightline. I help new customers get set up. No rush at all, we'll do it one step at a time." },
  { name: 'Scramble', voice: 'cedar', tone: 'Composed and direct; sorts out the problem without drama.', text: "Hey, I'm Scramble. Tell me what you need, and I'll get you to the right place, fast." },
  { name: 'Locksmith', voice: 'cedar', tone: 'Measured and reassuring without being sugary.', text: "Hi, I'm Locksmith. Locked out, forgot a password, old email on file? Happens all the time. Let's get you back in." },
  { name: 'Ledger', voice: 'cedar', tone: 'Relaxed and knowledgeable; plain about numbers.', text: "Hey, I'm Ledger. Billing questions come to me. I'll tell you exactly what you were charged and why, no jargon." },
  { name: 'Briefer', voice: 'marin', tone: 'Thoughtful and clear, like a colleague who knows the product well.', text: "Hi, I'm Briefer. I explain how things work, as much or as little detail as you like." },
  { name: 'Boomerang', voice: 'cedar', tone: 'Easygoing and steady; keeps the context, no sales patter.', text: "Hey, welcome back. I'm Boomerang. I'll pick up right where your last conversation left off." },
  { name: 'Brass', voice: 'marin', tone: 'Precise, calm and understated, like a senior account lead.', text: "Hello, I'm Brass. I look after larger accounts, so if it needs a careful answer, you're in the right place." },
  { name: 'Tower', voice: 'cedar', tone: 'Grounded and orderly; confirms details without chatter.', text: "Hi, I'm Tower. I do scheduling. Let's find a time that works for you, and I'll confirm it back." },
  { name: 'Archive', voice: 'marin', tone: 'Thoughtful and articulate; says what is written down and nothing more.', text: "Hi, I'm Archive. If it's written down anywhere, I'll find it, and I'll tell you where it came from." },
  { name: 'Rosetta', voice: 'cedar', tone: 'Soft-spoken, attentive and unhurried.', text: "Hello, I'm Rosetta. I can help in your language, so speak whichever one's easiest for you." },
  { name: 'Medic', voice: 'cedar', tone: 'Calm, level and sincere; listens more than he talks.', text: "Hi, I'm Medic. Sounds like something went wrong. Tell me what happened; I'm listening." },
  { name: 'Wingman', voice: 'marin', tone: 'Relaxed and genuine; recommends only what fits and never pushes.', text: "Hey, I'm Wingman. If there's a better option for you, I'll mention it once. No pressure, promise." },
  { name: 'Gavel', voice: 'cedar', tone: 'Concise, even-handed and serious.', text: "Hello, I'm Gavel. I handle disputes and the complicated cases. I'll lay out the facts and your options clearly." },
  { name: 'Afterburner', voice: 'cedar', tone: 'Calm and efficient; unhurried even when it is busy.', text: "Hey, I'm Afterburner. When it's busy, I make sure nobody's left waiting. What can I do for you?" },
  { name: 'Redeye', voice: 'cedar', tone: 'Low-key and steady, a calm night-shift voice.', text: "Hey there, I'm Redeye. I cover the overnight shift. Same answers you'd get during the day, just a little quieter." },
  { name: 'Envoy', voice: 'marin', tone: 'Discreet, polished and quietly attentive.', text: "Hello, I'm Envoy. I take care of our most important customers, so let me know how I can help today." },
  { name: 'Ace', voice: 'marin', tone: 'Calm, natural and self-assured; the first voice customers hear.', text: "Hey, I'm Ace, the AI assistant. I'm usually the first voice you'll hear. I'll help with whatever I can, and get you a person whenever you want one." },
  { name: 'Throttle', voice: 'cedar', tone: 'Easygoing and matter-of-fact.', text: "Hi, I'm Throttle. Orders and deliveries. Give me your order number and I'll tell you where it is." },
  { name: 'Doc', voice: 'marin', tone: 'Even-keeled, knowledgeable and plainspoken.', text: "Hi, I'm Doc. Detailed product questions are my thing. If I know, I'll tell you plainly. If I don't, I'll say so." },
];

// Each preview is generated once, stored in Vercel Blob, and served from
// there forever after, so visitors never cause new OpenAI spend.
const VERSION = 'v6';

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
        instructions: `Voice direction: ${agent.tone} This is a real person on a good support team saying hello: warm, relaxed and natural, like talking to someone you like helping. Conversational pace with natural rhythm and small natural pauses, a hint of a smile, contractions, no announcer voice, no sales energy, nothing robotic.`,
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

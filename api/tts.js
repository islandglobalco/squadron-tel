// /api/tts.js — OpenAI TTS voice preview for Squadron AI agents
// Uses gpt-4o-mini-tts (OpenAI's newest, steerable TTS) with per-agent voice + delivery direction.
// Output is lossless WAV (24 kHz PCM) so previews never carry MP3 compression artifacts.

const AGENTS = [
  { name: 'Luna', voice: 'coral', tone: 'Warm, welcoming and upbeat, like a friendly onboarding specialist smiling while she talks.', text: "Hi, I'm Luna. I specialize in customer onboarding — making sure every new user gets set up fast and feels supported from their very first interaction." },
  { name: 'Wren', voice: 'sage', tone: 'Bright, quick and clever, a confident technical problem-solver.', text: "Hey there, I'm Wren. I handle technical support and troubleshooting. Give me your toughest problems — I'm wired to solve them." },
  { name: 'Vera', voice: 'marin', tone: 'Smooth, polished and reassuring, a trusted account manager.', text: "Hello, I'm Vera. I focus on account management and retention. I build lasting relationships and make sure customers stay happy long-term." },
  { name: 'Atlas', voice: 'cedar', tone: 'Deep, calm and steady, an authoritative enterprise engineer.', text: "I'm Atlas. Enterprise integrations and complex deployments are my domain. I connect your stack and keep everything running at scale." },
  { name: 'Echo', voice: 'verse', tone: 'Energetic, fast and charismatic, an enthusiastic sales rep.', text: "Hey! I'm Echo. I'm your sales development rep — fast, personable, and great at qualifying leads and booking demos in real time." },
  { name: 'Lyra', voice: 'shimmer', tone: 'Clear, gentle and patient, explaining billing without friction.', text: "Hi, I'm Lyra. I handle billing and subscription questions with clarity and care. No confusion, no friction — just clear answers." },
  { name: 'Rex', voice: 'onyx', tone: 'Firm, commanding and composed, taking charge of a critical escalation.', text: "I'm Rex. I'm built for high-stakes support escalations. When the situation is critical, I take charge and deliver results." },
  { name: 'Iris', voice: 'nova', tone: 'Sunny, proactive and encouraging, a customer success lead.', text: "Hi there, I'm Iris. I specialize in customer success — proactively reaching out to ensure your team gets maximum value from Squadron." },
  { name: 'Leo', voice: 'ash', tone: 'Relaxed, knowledgeable and friendly, a product expert.', text: "I'm Leo. I handle product questions and feature guidance. Ask me anything about how Squadron works — I know every detail." },
  { name: 'Nova', voice: 'coral', tone: 'Upbeat and alert, a cheerful late-night agent who never gets tired.', text: "Hey, I'm Nova. I'm your 24/7 after-hours agent — always on, always ready, making sure no customer inquiry ever goes unanswered." },
  { name: 'Cruz', voice: 'ballad', tone: 'Easygoing, smooth and persuasive, a laid-back outbound closer.', text: "What's up, I'm Cruz. I run outbound campaigns and follow-ups. I keep your pipeline warm and your prospects engaged." },
  { name: 'Jade', voice: 'marin', tone: 'Precise, calm and trustworthy, a compliance specialist.', text: "Hi, I'm Jade. I handle compliance and security questions. I make sure your team has the accurate answers they need to stay protected." },
  { name: 'Orion', voice: 'cedar', tone: 'Focused, technical and grounded, a seasoned DevOps lead.', text: "I'm Orion. I manage infrastructure and DevOps support — deployment questions, uptime concerns, and technical deep dives are my specialty." },
  { name: 'Sage', voice: 'sage', tone: 'Thoughtful, articulate and helpful, a knowledge-base librarian.', text: "Hello, I'm Sage. I'm a knowledge-base specialist. I surface exactly the right documentation and help your team self-serve faster." },
  { name: 'River', voice: 'shimmer', tone: 'Soft, curious and attentive, a great listener.', text: "Hi, I'm River. I focus on customer feedback loops — capturing insights, routing them to the right teams, and closing the loop quickly." },
  { name: 'Felix', voice: 'echo', tone: 'Friendly, collegial and dependable, a partner manager.', text: "Hey, I'm Felix. I handle partner and reseller support — onboarding your channel partners and making sure they have everything they need." },
  { name: 'Zoe', voice: 'nova', tone: 'Playful, bubbly and personable, genuinely excited to help.', text: "Hi! I'm Zoe. I'm a lead engagement specialist — personalized, conversational, and great at turning curious visitors into qualified opportunities." },
  { name: 'Marcus', voice: 'onyx', tone: 'Concise, executive and authoritative, speaking to C-level leaders.', text: "I'm Marcus. I'm your executive support agent — concise, authoritative, and built to handle C-level inquiries with precision." },
  { name: 'Blaze', voice: 'verse', tone: 'Rapid-fire, punchy and high-energy, clearing a busy queue.', text: "Hey, I'm Blaze. I handle high-volume support queues with speed and accuracy. Fast response, every time, at any scale." },
  { name: 'Kai', voice: 'ash', tone: 'Organized, friendly and efficient, a scheduling pro.', text: "Hi, I'm Kai. I manage scheduling and appointment setting — coordinating demos, calls, and follow-ups so your team can focus on closing." },
  { name: 'Priya', voice: 'coral', tone: 'Warm, clear and encouraging, a patient teacher.', text: "Hello, I'm Priya. I run customer education and training — helping users master Squadron's features so they get full value, fast." },
  { name: 'Alex', voice: 'marin', tone: 'Confident, warm and natural, the flagship support agent making a great first impression.', text: "Hey, I'm Alex. I'm your general support agent — the first voice your customers hear, and I make sure that first impression counts." },
  { name: 'Maya', voice: 'ballad', tone: 'Empathetic, sincere and persuasive, winning back a customer.', text: "Hi, I'm Maya. I specialize in win-back campaigns and churn prevention — identifying at-risk accounts and re-engaging them before it's too late." },
  { name: 'Sam', voice: 'alloy', tone: 'Versatile, even-keeled and reliable, an all-round utility player.', text: "Hey there, I'm Sam. I'm your all-around utility agent — handling overflow, special requests, and anything that needs a versatile, reliable hand." },
];

// Each preview is generated once, stored in Vercel Blob, and served from
// there forever after, so visitors never cause new OpenAI spend.
const VERSION = 'v2';

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
        instructions: `Voice direction: ${agent.tone} Natural, human, conversational pacing with real warmth; smooth, even delivery with steady pitch and no rushed or clipped words. This is a short self-introduction for a customer-support product demo.`,
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

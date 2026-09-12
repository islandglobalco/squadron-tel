// /api/tts.js — OpenAI TTS voice preview for Squadron AI agents
// Uses tts-1-hd model with 6 distinct voices cycled across 24 agents

const AGENTS = [
  { name: 'Luna',   voice: 'nova',    text: "Hi, I'm Luna. I specialize in customer onboarding — making sure every new user gets set up fast and feels supported from their very first interaction." },
  { name: 'Wren',   voice: 'shimmer', text: "Hey there, I'm Wren. I handle technical support and troubleshooting. Give me your toughest problems — I'm wired to solve them." },
  { name: 'Vera',   voice: 'alloy',   text: "Hello, I'm Vera. I focus on account management and retention. I build lasting relationships and make sure customers stay happy long-term." },
  { name: 'Atlas',  voice: 'onyx',    text: "I'm Atlas. Enterprise integrations and complex deployments are my domain. I connect your stack and keep everything running at scale." },
  { name: 'Echo',   voice: 'fable',   text: "Hey! I'm Echo. I'm your sales development rep — fast, personable, and great at qualifying leads and booking demos in real time." },
  { name: 'Lyra',   voice: 'nova',    text: "Hi, I'm Lyra. I handle billing and subscription questions with clarity and care. No confusion, no friction — just clear answers." },
  { name: 'Rex',    voice: 'onyx',    text: "I'm Rex. I'm built for high-stakes support escalations. When the situation is critical, I take charge and deliver results." },
  { name: 'Iris',   voice: 'shimmer', text: "Hi there, I'm Iris. I specialize in customer success — proactively reaching out to ensure your team gets maximum value from Squadron." },
  { name: 'Leo',    voice: 'echo',    text: "I'm Leo. I handle product questions and feature guidance. Ask me anything about how Squadron works — I know every detail." },
  { name: 'Nova',   voice: 'nova',    text: "Hey, I'm Nova. I'm your 24/7 after-hours agent — always on, always ready, making sure no customer inquiry ever goes unanswered." },
  { name: 'Cruz',   voice: 'fable',   text: "What's up, I'm Cruz. I run outbound campaigns and follow-ups. I keep your pipeline warm and your prospects engaged." },
  { name: 'Jade',   voice: 'alloy',   text: "Hi, I'm Jade. I handle compliance and security questions. I make sure your team has the accurate answers they need to stay protected." },
  { name: 'Orion',  voice: 'onyx',    text: "I'm Orion. I manage infrastructure and DevOps support — deployment questions, uptime concerns, and technical deep dives are my specialty." },
  { name: 'Sage',   voice: 'shimmer', text: "Hello, I'm Sage. I'm a knowledge-base specialist. I surface exactly the right documentation and help your team self-serve faster." },
  { name: 'River',  voice: 'nova',    text: "Hi, I'm River. I focus on customer feedback loops — capturing insights, routing them to the right teams, and closing the loop quickly." },
  { name: 'Felix',  voice: 'echo',    text: "Hey, I'm Felix. I handle partner and reseller support — onboarding your channel partners and making sure they have everything they need." },
  { name: 'Zoe',    voice: 'fable',   text: "Hi! I'm Zoe. I'm a lead engagement specialist — personalized, conversational, and great at turning curious visitors into qualified opportunities." },
  { name: 'Marcus', voice: 'onyx',    text: "I'm Marcus. I'm your executive support agent — concise, authoritative, and built to handle C-level inquiries with precision." },
  { name: 'Blaze',  voice: 'shimmer', text: "Hey, I'm Blaze. I handle high-volume support queues with speed and accuracy. Fast response, every time, at any scale." },
  { name: 'Kai',    voice: 'alloy',   text: "Hi, I'm Kai. I manage scheduling and appointment setting — coordinating demos, calls, and follow-ups so your team can focus on closing." },
  { name: 'Priya',  voice: 'nova',    text: "Hello, I'm Priya. I run customer education and training — helping users master Squadron's features so they get full value, fast." },
  { name: 'Alex',   voice: 'echo',    text: "Hey, I'm Alex. I'm your general support agent — the first voice your customers hear, and I make sure that first impression counts." },
  { name: 'Maya',   voice: 'shimmer', text: "Hi, I'm Maya. I specialize in win-back campaigns and churn prevention — identifying at-risk accounts and re-engaging them before it's too late." },
  { name: 'Sam',    voice: 'fable',   text: "Hey there, I'm Sam. I'm your all-around utility agent — handling overflow, special requests, and anything that needs a versatile, reliable hand." },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const idx = Math.max(0, Math.min(23, parseInt(req.query.agent || '0', 10)));
  const agent = AGENTS[idx];

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    return;
  }

  try {
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        voice: agent.voice,
        input: agent.text,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      console.error('OpenAI TTS error:', err);
      res.status(502).json({ error: 'TTS upstream error' });
      return;
    }

    const buffer = await ttsRes.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('X-Agent-Name', agent.name);
    res.setHeader('X-Agent-Voice', agent.voice);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('TTS handler error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

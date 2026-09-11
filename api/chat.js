// /api/chat.js — Squadron live chat API
const AGENT = { name: 'Alex', title: 'Squadron AI Support' };
const KB = [
  { match: /price|cost|plan|how much|billing|invoice|pay|subscription/, reply: `Our plans start at **$99/month** (Scout — 250 voice minutes, 3 agents). Commander is **$299/month** with 1,000 minutes and API access. Command HQ is **$799/month** — unlimited everything. Need help picking the right plan?` },
  { match: /setup|start|how do i|get started|deploy|install|begin|launch/, reply: `Getting live takes about 5 minutes:\n1. Create your account at squadron.tel/deploy\n2. Upload your FAQs or knowledge base\n3. Choose your agent voices\n4. Hit Deploy — your number is ready instantly\n\nWant me to walk you through any step?` },
  { match: /agent|voice|personality|24|how many|choose|demo/, reply: `Squadron has **24 AI agents** — each with a distinct voice and personality. You can preview any of them on the homepage. Mix and match for your support stack.` },
  { match: /phone|number|twilio|call|inbound|route|forward/, reply: `Phone support is powered by **Twilio** under the hood. You get a real phone number with your plan — calls route instantly when you deploy.` },
  { match: /human|escalat|transfer|real person|manager|speak to/, reply: `Squadron agents escalate automatically when a customer asks for a human, expresses frustration, or hits an out-of-scope question. The handoff includes the full call transcript so your team has context.` },
  { match: /cancel|quit|stop|close account/, reply: `I'd hate to see you go. Before anything, is there something specific that's not working? Our team can offer plan adjustments, extra credits, or a strategy call.` },
  { match: /integrat|crm|salesforce|hubspot|zapier|webhook|api/, reply: `Squadron integrates out of the box with **Salesforce, HubSpot, Zendesk, Intercom**, and **Zapier**. Full REST API + webhooks on Commander and above.` },
  { match: /latency|fast|slow|lag|delay|response time/, reply: `Our average response latency is **0.4 seconds** end-to-end. We run on Vercel Edge close to your callers.` },
  { match: /trial|free|demo|try|test/, reply: `The **Scout plan ships with 250 free voice minutes** — enough to handle real calls. No credit card required to start.` },
  { match: /secure|gdpr|soc|compliance|data|privacy/, reply: `Squadron is **SOC 2 Type II** compliant and GDPR-ready. All calls are encrypted in transit and at rest.` },
];
const GREETING = `Hey! I'm **Alex**, your Squadron AI assistant. I can help with pricing, setup, agent voices, integrations, and anything else about Squadron. What's on your mind?`;
const FALLBACK_REPLIES = [
  `Great question. Let me get you the right answer — can you share a bit more about what you're trying to do?`,
  `I want to make sure I give you accurate info. Could you tell me more about your use case?`,
  `Happy to help with that! To point you in the right direction, are you asking about setup, pricing, or something else?`
];
let fallbackIdx = 0;
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { message, sessionId } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const sid = sessionId || Math.random().toString(36).slice(2);
  if (!message.trim() || /^(hi|hello|hey|howdy|sup|yo|start)$/i.test(message.trim())) {
    return res.status(200).json({ reply: GREETING, sessionId: sid, agent: AGENT });
  }
  const lower = message.toLowerCase();
  for (const item of KB) {
    if (item.match.test(lower)) return res.status(200).json({ reply: item.reply, sessionId: sid, agent: AGENT });
  }
  const fallback = FALLBACK_REPLIES[fallbackIdx % FALLBACK_REPLIES.length];
  fallbackIdx++;
  return res.status(200).json({ reply: fallback, sessionId: sid, agent: AGENT });
}

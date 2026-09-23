// /api/chat.js — Squadron live chat API
const AGENT = { name: 'Alex', title: 'Squadron AI Support' };
const KB = [
  { match: /price|cost|plan|how much|billing|invoice|pay|subscription/, reply: `Plans are **Scout at $99/month** (250 voice minutes and 1,000 chat conversations included), **Commander at $299/month** (1,000 voice minutes included), and **Command HQ at $799/month** (the largest allowances). Every plan includes the full team, and every plan starts with a 14-day trial with no card required. When you reach your allowance, Squadron pauses and notifies you; there is no automatic upgrade.` },
  { match: /setup|start|how do i|get started|deploy|install|begin|launch/, reply: `Here is how it works:\n1. Enter your business: a website URL, an iOS App Store URL, or your documents\n2. Review the Business Profile Squadron builds, with a source on every fact\n3. Review the team Squadron generates for your business\n4. Test it by chat and voice, then deploy to phone and chat\n\nWant me to walk you through any step?` },
  { match: /agent|voice|personality|24|how many|choose|demo/, reply: `Squadron has **24 AI agents** — each with a distinct voice and personality. You can preview any of them on the homepage. Mix and match for your support stack.` },
  { match: /phone|number|twilio|call|inbound|route|forward/, reply: `You get a real phone number with your plan, including during the trial. Publish it directly or forward your existing business line to it.` },
  { match: /human|escalat|transfer|real person|manager|speak to/, reply: `Squadron agents answer only from your Business Profile. When a question falls outside it, or a customer asks for a person, the agent says so, takes a message or transfers to your on-call contact, and logs the conversation in Squadron HQ.` },
  { match: /cancel|quit|stop|close account/, reply: `I'd hate to see you go. Before anything, is there something specific that's not working? Our team can offer plan adjustments, extra credits, or a strategy call.` },
  { match: /integrat|crm|salesforce|hubspot|zapier|webhook|api/, reply: `Squadron does not offer CRM integrations or a public API today. Every conversation, transcript and recording is available in Squadron HQ, and you can export them.` },
  { match: /latency|fast|slow|lag|delay|response time/, reply: `The fastest way to judge it is to try it: click **Talk to Alex live** on the homepage and have a conversation.` },
  { match: /trial|free|demo|try|test/, reply: `Every plan starts with a **14-day trial** that includes a real phone number. No card is required to start.` },
  { match: /secure|gdpr|soc|compliance|data|privacy/, reply: `Every Squadron agent identifies itself as an AI at the start of every conversation, every call begins with an audible recording notice, and Squadron answers inbound conversations only. For anything else about data handling, email hello@squadron.tel.` },
];
const GREETING = `Hey! I'm **Alex**, your Squadron AI assistant. I can help with pricing, setup, agent voices, and anything else about Squadron. What's on your mind?`;
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

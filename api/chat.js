// /api/chat.js — Squadron live chat API
const AGENT = { name: 'Alex', title: 'Squadron AI Support' };
// Rule: every reply answers the question with facts and never ends in a
// question. A follow-up question, when useful, goes in followUp and is shown
// as a separate second message.
const KB = [
  { match: /who (is|are)|what (is|are|does) squadron|about squadron|what do you do|^squadron\??$|tell me about/, reply: `Squadron builds an AI customer-service team for your business from your website, App Store listing or documents. The agents answer your customers by web chat today, with phone lines opening soon, using only facts from your business with a source on every fact. They hand off to a person when they cannot answer. Plans start at $39 for 30 days, prepaid.`, followUp: `Would you like to see what Squadron would build from your website?` },
  { match: /price|cost|plan|how much|billing|invoice|pay|subscription/, reply: `Plans are prepaid for 30 days: **Basic at $39** (250 AI voice minutes), **Pro at $79** (650 minutes) and **Command Center at $199** (2,000 minutes). Every plan includes the full team and unlimited web chat, and extra minutes are 25¢ each, prepaid in blocks of 100. You pay by card or by bank wire or ACH, and Squadron never bills you after the fact.` },
  { match: /setup|start|how do i|get started|deploy|install|begin|launch|sign ?up/, reply: `Here is how it works:\n1. Enter your business: a website URL, an iOS App Store URL, or your documents.\n2. Choose a plan and prepay 30 days.\n3. Review the Business Profile Squadron builds, with a source on every fact.\n4. Review the team Squadron generates for your business.\n5. Test it by chat and voice, then add the chat widget to your site with one line of code.\n\nStart at squadron.tel/start.` },
  { match: /agent|voice|personality|24|how many|choose/, reply: `Squadron has **24 AI agents**, each with a distinct voice and personality, and it assigns them to the roles your business needs. You can hear any of them with the play button on its portrait on the homepage.` },
  { match: /phone|number|twilio|call|inbound|route|forward/, reply: `Web chat is live today. Phone lines are opening soon; when they do, you will get a number to publish directly or to forward your existing business line to.` },
  { match: /human|escalat|transfer|real person|manager|speak to/, reply: `Squadron agents answer only from your Business Profile. When a question falls outside it, or a customer asks for a person, the agent says so, takes a message or transfers to your on-call contact, and logs the conversation in Squadron HQ.` },
  { match: /cancel|quit|stop|close account/, reply: `Squadron has no contract, so there is nothing to cancel: plans are prepaid for 30 days and never renew automatically. If you do not pay for the next 30 days, your team simply stops at the end of the current period.` },
  { match: /integrat|crm|salesforce|hubspot|zapier|webhook|api/, reply: `Squadron does not offer CRM integrations or a public API today. Every conversation, transcript and recording is available in Squadron HQ, and you can export them.` },
  { match: /latency|fast|slow|lag|delay|response time/, reply: `Chat replies usually arrive within a few seconds. The best way to judge it is to build your own team and test it by chat and voice before you add it to your site.` },
  { match: /trial|free|demo|try|test/, reply: `There is no free trial. Squadron is prepaid instead, with no contract: pay for 30 days from $39, test your team by chat and voice, and simply do not renew if it is not for you.` },
  { match: /secure|gdpr|soc|compliance|data|privacy/, reply: `Every Squadron agent identifies itself as an AI at the start of every conversation, every call begins with an audible recording notice, and Squadron answers inbound conversations only. For anything else about data handling, email info@squadron.tel.` },
];
const GREETING = `Hey! I'm **Alex**, Squadron's AI assistant. I answer questions about Squadron's pricing, setup, agents and channels.`;
const FALLBACK = { reply: `I don't have a specific answer to that. Here is what Squadron is: it builds an AI customer-service team for your business from your website, answers your customers by web chat today with phone lines opening soon, and costs from $39 for 30 days, prepaid. For anything else, email info@squadron.tel and a person will reply.`, followUp: `You can ask me about pricing, setup, the agents or phone lines.` };
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
  const lower = message.toLowerCase().trim();
  for (const item of KB) {
    if (item.match.test(lower)) return res.status(200).json({ reply: item.reply, followUp: item.followUp || null, sessionId: sid, agent: AGENT });
  }
  return res.status(200).json({ reply: FALLBACK.reply, followUp: FALLBACK.followUp, sessionId: sid, agent: AGENT });
}

// /api/gather.js — handles speech input from <Gather>
const VOICE = 'Polly.Joanna-Generative';

const RESPONSES = {
  billing: { match: /bill|charge|invoice|payment|refund|cost|price|subscription|pay|credit/i, say: `For billing questions, your current plan details are in your Squadron dashboard at app dot squadron dot tel. Refunds process within 5 business days. Is there a specific charge you want to look into?` },
  setup: { match: /setup|install|deploy|start|configure|connect|integrate|phone number|get started/i, say: `Setup is about five minutes. Log into your dashboard, upload your knowledge base, pick an agent voice, and hit Deploy. Your phone number is assigned instantly. Do you need help with a specific step?` },
  agents: { match: /agent|voice|personality|alex|maya|choose|switch|change agent/i, say: `Squadron has 24 agents — each with a distinct voice and personality. You can preview all of them in the dashboard under Agent Settings. Would you like recommendations based on your industry?` },
  escalate: { match: /human|person|real|transfer|manager|supervisor|speak to someone/i, say: `Of course. Connecting you with a team member now.` },
  cancel: { match: /cancel|quit|stop|end|close account/i, say: `I'm sorry to hear you're considering leaving. Our retention team can offer plan adjustments or credits. Let me connect you with them.` },
  hours: { match: /hour|open|available|when|schedule/i, say: `Squadron AI agents run 24-7 with no downtime. For human support, our team is available Monday through Friday, 9am to 6pm Eastern.` },
  pricing: { match: /price|plan|tier|scout|commander|enterprise/i, say: `Scout is $99 a month — 250 voice minutes and 3 agents. Commander is $299 a month with 1,000 minutes and API access. Command HQ is $799 a month — unlimited everything, including white-label. Want me to walk you through which fits your volume?` },
  trial: { match: /trial|free|try|test|demo/i, say: `The Scout plan includes 250 free voice minutes — enough to run real calls. No credit card required. You can deploy at squadron dot tel slash deploy and be live in minutes.` }
};

const FOLLOWUP = `Anything else I can help with?`;
const FALLBACK = `Got it. Let me connect you with a specialist who can go deeper on this.`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');
  const body = req.body || {};
  const speech = (body.SpeechResult || req.query?.SpeechResult || '').toLowerCase();
  const confidence = parseFloat(body.Confidence || req.query?.Confidence || '0');

  let responseText = null;
  let shouldEscalate = false;

  for (const [key, rule] of Object.entries(RESPONSES)) {
    if (rule.match.test(speech)) {
      responseText = rule.say;
      if (key === 'escalate' || key === 'cancel') shouldEscalate = true;
      break;
    }
  }

  if (!responseText || confidence < 0.3) { responseText = FALLBACK; shouldEscalate = true; }

  let twiml;
  if (shouldEscalate) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}">${responseText}</Say><Say voice="${VOICE}">Please hold for just a moment.</Say><Play digits="wwwww"/><Dial><Number>+1${process.env.ESCALATION_PHONE || '8005551234'}</Number></Dial></Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${VOICE}">${responseText}</Say><Gather input="speech" action="/api/gather" speechTimeout="auto" language="en-US"><Say voice="${VOICE}">${FOLLOWUP}</Say></Gather><Say voice="${VOICE}">Thanks for calling Squadron. Have a great day!</Say><Hangup/></Response>`;
  }

  res.status(200).send(twiml);
}

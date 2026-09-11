// /api/voice.js — Twilio inbound voice webhook
// Uses Amazon Polly Generative voices — the most realistic voices available on Twilio.

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/xml');

  const VOICE = 'Polly.Joanna-Generative';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">
    Hey there, you've reached Squadron support. I'm Alex — an AI support agent.
    I can help you right now with billing, setup, agent voices, integrations, or anything else on your mind.
    Go ahead and tell me what you need.
  </Say>
  <Gather input="speech" action="/api/gather" speechTimeout="auto" language="en-US"
    hints="billing, setup, agents, pricing, cancel, help, support, account, trial, integrate, Twilio, deploy, phone number, escalate, human">
    <Say voice="${VOICE}">I'm listening.</Say>
  </Gather>
  <Say voice="${VOICE}">I didn't catch that — let me get someone from our team for you.</Say>
  <Dial>
    <Number>+1${process.env.ESCALATION_PHONE || '8005551234'}</Number>
  </Dial>
</Response>`;

  res.status(200).send(twiml);
}

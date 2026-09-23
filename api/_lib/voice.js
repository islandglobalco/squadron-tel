// api/_lib/voice.js — builds the OpenAI Realtime session for a business's
// team: grounded instructions, the Front Desk voice, and the tools the
// session may call (message taking, transfer requests, gap logging).

import { knowledgeChunks, buildInstructions } from './answer.js';

export const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1-mini';

export const VOICE_TOOLS = [
  {
    type: 'function', name: 'take_message',
    description: 'Record a message for the business when the customer wants a person to follow up, or when the team cannot answer. Call it after the customer has given the message and a way to reach them.',
    parameters: { type: 'object', properties: { message: { type: 'string' }, contact: { type: 'string', description: 'Name and phone number or email the customer gave, or "not given".' }, question: { type: 'string', description: 'The question the profile could not answer, if any.' } }, required: ['message', 'contact'] },
  },
  {
    type: 'function', name: 'request_transfer',
    description: 'Ask to transfer the call to a person at the business. Use it when the customer asks for a person, is upset, describes an emergency, or the escalation rule says so.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
  {
    type: 'function', name: 'log_gap',
    description: 'Record a customer question that the knowledge does not answer, so the business can add the answer later.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
];

export const LOOKUP_TOOL = {
  type: 'function', name: 'lookup_knowledge',
  description: 'Search the business knowledge for a topic before answering a detailed question (prices, hours, policies, procedures). Returns matching facts.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

export function voiceSession({ business, agents, profile, channel, settings, recordingNotice, withLookup = false }) {
  const { chunks, voice } = knowledgeChunks(profile);
  const front = agents[0];
  const base = buildInstructions({ business, agents, chunks, voice, channel, settings });
  const instructions = `${base}

VOICE RULES (this is a spoken ${channel} conversation):
- You speak with one voice for the whole team. When you hand off, say it out loud in one short sentence ("Let me bring in ${agents[1] ? agents[1].persona + ', our ' + agents[1].title : 'a specialist'}") and continue as that agent.
- Open the conversation with exactly this greeting${recordingNotice ? ', after the recording notice' : ''}: "${front.greeting}"
- Always answer with an answer, never with a question: first give the caller the answer to what they asked, using the facts you have. Ask a follow-up question only after the answer, as its own separate sentence.
- Keep every turn to one or two complete sentences, then stop and listen. Speak numbers, prices and hours slowly and clearly.
- When the knowledge does not answer a question, say so plainly, call log_gap, and offer to take a message. When the customer gives a message, call take_message. When a transfer is warranted, say what you are doing and call request_transfer.
- Never claim to be human. If asked, say you are an AI agent for ${business.name || 'the business'}.
- If you hear silence, noise or an echo of your own words, wait; do not say you did not catch that.`;
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions,
    tools: withLookup ? VOICE_TOOLS.concat([LOOKUP_TOOL]) : VOICE_TOOLS,
    tool_choice: 'auto',
    audio: {
      input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto' } },
      output: { voice: front.voice || 'marin' },
    },
  };
}

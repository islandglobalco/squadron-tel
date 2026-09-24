// api/_lib/voice.js — builds the OpenAI Realtime session for a business's
// team: grounded instructions, the Front Desk voice, and the tools the
// session may call (message taking, transfer requests, gap logging).

import { knowledgeChunks, buildInstructions } from './answer.js';
import { withoutManager, managerize } from './personas.js';
import { voiceHumanRules, allowsTransfer } from './human.js';

// The full model (not mini): noticeably more natural timing and intonation.
export const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-2.1';

// marin and cedar are the voices built for realtime speech and sound the most
// human, so every persona speaks with one of them.
export function liveVoice(v) { return v === 'cedar' || v === 'marin' ? v : (['onyx', 'ash', 'echo', 'ballad', 'verse'].includes(v) ? 'cedar' : 'marin'); }

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

export function voiceSession({ business, agents, profile, channel, settings, recordingNotice, withLookup = false, as = 'front' }) {
  agents = managerize(withoutManager(agents));
  const { chunks, voice } = knowledgeChunks(profile);
  const front = agents[0];
  const base = buildInstructions({ business, agents, chunks, voice, channel, settings });
  const instructions = `${base}

VOICE RULES (this is a live spoken ${channel} conversation; these override the chat rules above where they differ):
- You are ${front.persona}, and you handle the whole conversation yourself with everything the team knows. Do not hand the caller between agents or announce departments; just help.
- Open with one short, natural line${recordingNotice ? ' (after the recording notice)' : ''} along the lines of: "${front.greeting}" Say it in your own words, then stop and let the caller talk.
- Talk like a friendly, capable person on the phone: relaxed, warm and conversational, with contractions and everyday words. Let your tone follow the caller's: lighter when they are chatty, calmer and slower when they are stressed.
- Keep turns short: usually one or two sentences, then let the caller respond. Short acknowledgements like "sure", "got it" or "okay, so" are fine when natural; don't overuse them and never repeat the same phrase twice in a row.
- Answer the question first. A quick clarifying question is fine when you genuinely need it.
- Say numbers, prices, times and addresses the way a person would ("nine to five", "forty-nine ninety-nine"), and slow down a touch for them. Never read lists, ids, URLs character by character, or formatting aloud; summarize instead.
- If the caller interrupts, stop and listen. If you hear silence, background noise or an echo of your own voice, simply wait; don't say you didn't catch that.
- Settle problems using only the knowledge, and never promise a refund, credit or exception the knowledge does not support.
${voiceHumanRules(settings, business.name || 'the business')}
- When the knowledge does not answer a question, say so honestly in a few words, call log_gap, and offer to take a message. When the caller leaves a message, call take_message.
- You are an AI assistant. You said so in your greeting; don't keep repeating it. If asked, say plainly that you're an AI assistant for ${business.name || 'the business'}, and never claim to be human.`;
  let tools = withLookup ? VOICE_TOOLS.concat([LOOKUP_TOOL]) : VOICE_TOOLS.slice();
  if (!allowsTransfer(settings)) tools = tools.filter((t) => t.name !== 'request_transfer');
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions,
    tools,
    speaker: { id: front.id, persona: front.persona, title: front.title },
    tool_choice: 'auto',
    audio: {
      input: { transcription: { model: 'gpt-4o-mini-transcribe' }, noise_reduction: { type: 'near_field' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', interrupt_response: true } },
      output: { voice: liveVoice(front.voice) },
    },
  };
}

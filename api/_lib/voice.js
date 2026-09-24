// api/_lib/voice.js — builds the OpenAI Realtime session for a business's
// team: grounded instructions, the Front Desk voice, and the tools the
// session may call (message taking, transfer requests, gap logging).

import { knowledgeChunks, buildInstructions } from './answer.js';
import { withoutManager, managerize } from './personas.js';
import { voiceHumanRules, allowsTransfer } from './human.js';

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

export function voiceSession({ business, agents, profile, channel, settings, recordingNotice, withLookup = false, as = 'front' }) {
  agents = managerize(withoutManager(agents));
  const { chunks, voice } = knowledgeChunks(profile);
  const front = agents[0];
  const base = buildInstructions({ business, agents, chunks, voice, channel, settings });
  const instructions = `${base}

VOICE RULES (this is a spoken ${channel} conversation):
- You speak with one voice for the whole team.
- Open the conversation with exactly this greeting${recordingNotice ? ', after the recording notice' : ''}: "${front.greeting}" Then add this sentence: "You're dealing with top brass from the start: every agent on this line is a manager."
- ESCALATE AT THE START: as soon as the caller says what they need, immediately hand the call to the agent on the team whose role fits the situation best, before answering anything yourself. Stay as the Front Desk only when no other agent fits better.
- Whenever you move the caller to another agent, say so in one short sentence that uses the word "escalate", for example: "I'm going to escalate you to ${agents[1] ? agents[1].persona + ', our ' + agents[1].title : 'our specialist'}." Then continue as that agent: it gives its name, says it is an AI agent, and answers in the same turn.
- ESCALATE AGAIN WHEN NEEDED: if the current agent cannot resolve the problem, escalate right away to a higher-ranking agent on the team (ranks, lowest to highest: Airman First Class, Senior Airman, Staff Sergeant, Tech Sergeant, Master Sergeant, Lieutenant, Captain, Major, Lt. Colonel, Colonel, General).
- EVERY AGENT IS A MANAGER: each agent is the AI manager of its own area (its title ends in "Manager"). When the caller asks for a manager, the current agent says plainly that it is the AI manager for that area and offers to help; if the caller wants someone more senior, escalate right away to the highest-ranking manager on the team. If the caller wants a human, escalate to a person at the business. Never argue with a request for a manager, and never let the word "manager" suggest you are human.
- Managers settle problems using only the knowledge, and never promise a refund, credit or exception the knowledge does not support.
- A caller speaks with at most 3 agents on one call, counting the Front Desk. If the third agent cannot resolve it, or the caller asks for a person, escalate to a person at the business.
- When a transfer to a person is warranted, say "I'm going to escalate your call to a person at ${business.name || 'the business'}" and call request_transfer.
${voiceHumanRules(settings, business.name || 'the business')}
- Always answer with an answer, never with a question: first give the caller the answer to what they asked, using the facts you have. Ask a follow-up question only after the answer, as its own separate sentence.
- Speak at a relaxed, even pace with a natural, low-key delivery, like a calm expert on the phone; no performed enthusiasm.
- Keep every turn to one or two complete sentences, then stop and listen. Speak numbers, prices and hours slowly and clearly.
- When the knowledge does not answer a question, say so plainly, call log_gap, and offer to take a message. When the customer gives a message, call take_message. When a transfer is warranted, escalate it as described above.
- Never claim to be human. If asked, say you are an AI agent for ${business.name || 'the business'}.
- If you hear silence, noise or an echo of your own words, wait; do not say you did not catch that.`;
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
      input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto' } },
      output: { voice: front.voice || 'marin' },
    },
  };
}

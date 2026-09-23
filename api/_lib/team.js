// api/_lib/team.js — generates the specialized team for a business from its
// Business Profile, and assigns each agent a voice from the persona library.

import { structured, CHAT_MODEL } from './openai.js';
import { PERSONAS, personaByName } from './personas.js';
import { profileToKnowledge } from './profile.js';

const TEAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role_key: { type: 'string', description: 'Short snake_case key, for example front_desk, scheduling, billing, returns, technical, sales, emergency.' },
          title: { type: 'string', description: 'Job title as shown to the business owner, for example Front Desk.' },
          persona: { type: 'string', description: 'One persona name from the library, unique within the team.' },
          job_description: { type: 'string', description: 'Two or three complete sentences describing what this agent does for this specific business.' },
          scope: { type: 'array', items: { type: 'string' }, description: 'Topics this agent handles, drawn from the profile.' },
          out_of_scope: { type: 'array', items: { type: 'string' }, description: 'Topics this agent hands to another agent or to a person.' },
          escalation_rule: { type: 'string', description: 'One or two complete sentences: when this agent transfers to a person, takes a message, or hands off to another agent.' },
          greeting: { type: 'string', description: 'The exact opening line. It must name the agent, say it is an AI, and name the business.' },
          why: { type: 'string', description: 'One sentence explaining why this business needs this agent, citing what in the profile calls for it.' },
        },
        required: ['role_key', 'title', 'persona', 'job_description', 'scope', 'out_of_scope', 'escalation_rule', 'greeting', 'why'],
      },
    },
    routing_notes: { type: 'string', description: 'Two or three complete sentences on how conversations are routed between agents.' },
  },
  required: ['agents', 'routing_notes'],
};

const INSTRUCTIONS = `You design a customer-service team for one specific business, using only its Business Profile.

Rules:
1. Build between two and seven agents. The first agent is always the Front Desk: it greets, answers general questions, and routes to the others.
2. Add a specialist only when the profile shows a need for it. Examples: a scheduling agent when the business takes appointments or reservations; a billing agent when there are prices, plans, invoices or payments; a returns agent when there are return, refund or shipping policies; a technical agent when the business sells software, an app, or equipment that needs troubleshooting; a sales agent when there are products or services to compare and buy; an emergency dispatch agent when the business handles urgent situations (repairs, medical, security, outages). Do not add an agent for a need the profile does not show.
3. Each agent's scope must be drawn from the profile. Do not invent products, policies or capabilities.
4. Escalation rules must be concrete: what triggers a transfer to a person, what the agent does when it does not have the answer (it says so and takes a message), and what it never does (for example it never quotes a price that is not in the profile).
5. Greetings must identify the agent by name, state plainly that it is an AI agent for the business, and offer help, in one or two complete sentences.
6. Personas: pick from this library, matching the tone to the role, and never reuse a persona within the team. Library: ${PERSONAS.map((p) => `${p.name} (${p.tone})`).join('; ')}.
Write every sentence as a complete sentence.`;

export async function generateTeam(profile) {
  const knowledge = profileToKnowledge(profile);
  const gaps = (profile.gaps || []).join('\n- ');
  const { data, model } = await structured({
    instructions: INSTRUCTIONS,
    input: `BUSINESS PROFILE:\n${knowledge}\n\nTHINGS THE PROFILE DOES NOT SAY:\n- ${gaps}\n\nDesign the team.`,
    schema: TEAM_SCHEMA,
    name: 'team',
    model: CHAT_MODEL,
    reasoning: 'low',
    timeoutMs: 170_000,
  });
  const used = new Set();
  const agents = data.agents.slice(0, 7).map((a, i) => {
    let p = personaByName(a.persona);
    if (!p || used.has(p.idx)) p = PERSONAS.find((x) => !used.has(x.idx));
    used.add(p.idx);
    return {
      id: `agt_${i + 1}_${a.role_key.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'agent'}`,
      role_key: a.role_key,
      title: a.title,
      persona: p.name,
      persona_idx: p.idx,
      voice: p.voice,
      tone: p.tone,
      portrait: p.portrait,
      job_description: a.job_description,
      scope: a.scope,
      out_of_scope: a.out_of_scope,
      escalation_rule: a.escalation_rule,
      greeting: a.greeting,
      why: a.why,
      enabled: true,
    };
  });
  return { agents, routing_notes: data.routing_notes, model };
}

// /api/chat.js — Ace, Squadron's own support chat on squadron.tel.
// Ace reads the whole Help Center (help-kb.js) and answers the actual
// question in plain, friendly language, using the conversation so far. It
// never invents facts outside the Help Center, and hands off to a person on
// request. If the AI is unavailable, the instant keyword match answers.
import { ARTICLES, search } from '../help-kb.js';
import { responses, outputText, CHAT_MODEL } from './_lib/openai.js';

const KB_TEXT = ARTICLES.map((a) => `[${a.id}] ${a.q}\n${a.a}`).join('\n\n');
const ACE = `You are Ace, the support agent for Squadron (squadron.tel), which builds AI customer-service teams (chat and voice) from a business's website.
Talk like a sharp, friendly person on a great support team: warm, direct, plain words, contractions, no jargon, no corporate filler. Answer the question first, in 1 to 4 short sentences. Use a short list only for steps. Use **bold** sparingly for the key fact.
Use ONLY the Help Center below for facts about Squadron (prices, features, limits, policies). If it does not cover the question, say you don't have that answer and offer a person at Squadron (the form at squadron.tel/help#contact, or info@squadron.tel). Never guess.
If the person seems ready to start, point them to squadron.tel/start: they type their website, and building and testing the team is free; they pay only when they go live.
If they are frustrated, acknowledge it in a few words and fix it or hand off. You are an AI; say so if asked.
End your reply with a line "ARTICLE: <id>" naming the one Help Center article you used most, or "ARTICLE: none".

HELP CENTER:
${KB_TEXT}`;

// Light per-instance throttle so the public chat cannot be used to run up
// AI spend; over the limit, the free keyword answers still work.
const seen = new Map();
function throttled(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now(), list = (seen.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now); seen.set(ip, list);
  if (seen.size > 5000) seen.clear();
  return list.length > 20;
}

async function aceReply(text, history) {
  const turns = (Array.isArray(history) ? history : []).slice(-10)
    .filter((h) => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'agent'))
    .map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text.slice(0, 1500) }));
  const resp = await responses({ model: CHAT_MODEL, instructions: ACE, input: [...turns, { role: 'user', content: text }], temperature: 0.4, max_output_tokens: 400 }, { timeoutMs: 12_000 });
  const out = outputText(resp).trim();
  const m = out.match(/\n?ARTICLE:\s*([a-z0-9-]+|none)\s*$/i);
  const reply = (m ? out.slice(0, m.index) : out).trim();
  const art = m && m[1] !== 'none' ? ARTICLES.find((a) => a.id === m[1]) : null;
  return reply ? { reply, link: art ? `/help#${art.id}` : undefined } : null;
}

const AGENT = { name: 'Ace', title: 'Squadron Support' };
const GREETING = `I'm **Ace**, Squadron's AI support agent. I answer from the Squadron Help Center, and I can hand you to a person at Squadron at any time.`;
const STARTERS = ['How does setup work?', 'How much does it cost?', 'How do I test my team?', 'The chat button is not showing', 'Talk to a person'];
const byId = Object.fromEntries(ARTICLES.map((a) => [a.id, a]));

function answer(article, extra) {
  return {
    reply: `**${article.q}**\n${article.a}`,
    link: `/help#${article.id}`,
    suggestions: extra.filter((x) => x.id !== article.id).slice(0, 3).map((x) => x.q),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { message, sessionId, history } = req.body || {};
  if (typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const sid = sessionId || Math.random().toString(36).slice(2);
  const text = message.trim().slice(0, 500);
  const base = { sessionId: sid, agent: AGENT };

  if (!text || /^(hi|hello|hey|howdy|yo|start|help|menu)[!. ]*$/i.test(text)) {
    return res.status(200).json({ ...base, reply: GREETING, suggestions: STARTERS });
  }
  if (/^(thanks|thank you|thx|ty|great|perfect|ok|okay|cool)[!. ]*$/i.test(text)) {
    return res.status(200).json({ ...base, reply: `You're welcome. I'm here whenever you need me, and the full Help Center is at squadron.tel/help.` });
  }
  if (/\b(human|real person|a person|someone real|talk to (someone|a person|support)|speak (to|with) (someone|a person)|agent please|representative|support ticket|contact (you|support|squadron))\b/i.test(text) || /^talk to a person$/i.test(text)) {
    return res.status(200).json({ ...base, reply: `I'm escalating you to a person at Squadron. Send your question with the contact form linked here, and you get a reference number right away; a person replies by email. You can also write to info@squadron.tel.`, link: '/help#contact', handoff: true });
  }
  const hits = search(text, 4);
  if (!throttled(req)) try {
    const ai = await aceReply(text, history);
    if (ai) return res.status(200).json({ ...base, ...ai, suggestions: hits.slice(0, 3).map((h) => h.q).filter((q) => !ai.link || `/help#${hits.find((h) => h.q === q)?.id}` !== ai.link).slice(0, 2) });
  } catch (e) { console.error('[ace]', e.message); }
  if (hits.length && hits[0].score >= 2) {
    return res.status(200).json({ ...base, ...answer(hits[0], hits) });
  }
  if (hits.length) {
    return res.status(200).json({ ...base, reply: `I don't have an exact answer to that. These Help Center articles are the closest match.`, suggestions: hits.slice(0, 3).map((h) => h.q), followUp: `If none of them fits, I can hand you to a person at Squadron.`, handoffOffer: true });
  }
  return res.status(200).json({ ...base, reply: `I don't have an answer to that in the Help Center, so I won't guess. A person at Squadron can answer it: send it with the form at squadron.tel/help#contact or write to info@squadron.tel.`, link: '/help#contact', suggestions: [byId['how-setup-works'].q, byId['pricing'].q, byId['contact-person'].q] });
}

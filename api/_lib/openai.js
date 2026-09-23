// api/_lib/openai.js — thin helpers around the OpenAI Responses API.

export const PROFILE_MODEL = process.env.PROFILE_MODEL || 'gpt-5-mini';
export const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-5-mini';

export function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  return key;
}

export async function responses(body, { timeoutMs = 110_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

export function outputText(resp) {
  if (resp.output_text) return resp.output_text;
  const parts = [];
  for (const item of resp.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) if (c.type === 'output_text') parts.push(c.text);
  }
  return parts.join('');
}

// Structured JSON output with a strict schema. Falls back to a second model
// name if the first is not available on this account.
export async function structured({ instructions, input, schema, name, model = PROFILE_MODEL, fallback = 'gpt-4.1-mini', reasoning = 'low', timeoutMs }) {
  const body = (m) => ({
    model: m,
    instructions,
    input,
    text: { format: { type: 'json_schema', name, strict: true, schema } },
    ...(m.startsWith('gpt-5') ? { reasoning: { effort: reasoning } } : { temperature: 0.2 }),
  });
  let resp;
  try {
    resp = await responses(body(model), { timeoutMs });
  } catch (e) {
    if (/model|not found|does not exist|unsupported|invalid_request/i.test(e.message) && fallback && fallback !== model) {
      console.warn('[openai] falling back to', fallback, 'because', e.message.slice(0, 300));
      resp = await responses(body(fallback), { timeoutMs });
      resp._model = fallback;
    } else throw e;
  }
  const text = outputText(resp);
  return { data: JSON.parse(text), model: resp._model || model, usage: resp.usage };
}

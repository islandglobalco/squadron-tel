// api/_lib/profile.js — builds the Business Profile from source documents.
// Every field carries a source (the document it came from and a verbatim
// quote). Fields with no evidence stay empty; nothing is invented.

import { structured } from './openai.js';

const sourced = (valueType = 'string') => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: [valueType, 'null'] },
    source: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        doc: { type: 'integer', description: 'Index of the source document this came from.' },
        quote: { type: 'string', description: 'Short verbatim excerpt (under 200 characters) that supports the value.' },
      },
      required: ['doc', 'quote'],
    },
  },
  required: ['value', 'source'],
});

const listOf = (props) => ({
  type: 'array',
  items: { type: 'object', additionalProperties: false, properties: props, required: Object.keys(props) },
});

export const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company: {
      type: 'object', additionalProperties: false,
      properties: {
        name: sourced(), tagline: sourced(), description: sourced(), industry: sourced(), website: sourced(),
      },
      required: ['name', 'tagline', 'description', 'industry', 'website'],
    },
    products: listOf({ name: sourced(), description: sourced(), price: sourced() }),
    services: listOf({ name: sourced(), description: sourced(), price: sourced() }),
    pricing: listOf({ item: sourced(), price: sourced(), notes: sourced() }),
    faqs: listOf({ question: sourced(), answer: sourced() }),
    policies: listOf({ name: sourced(), text: sourced() }),
    hours: listOf({ days: sourced(), open: sourced(), close: sourced(), notes: sourced() }),
    locations: listOf({ name: sourced(), address: sourced(), phone: sourced(), email: sourced() }),
    contact: {
      type: 'object', additionalProperties: false,
      properties: { phone: sourced(), email: sourced(), support_url: sourced(), booking_url: sourced() },
      required: ['phone', 'email', 'support_url', 'booking_url'],
    },
    support_procedures: listOf({ situation: sourced(), procedure: sourced() }),
    brand_voice: {
      type: 'object', additionalProperties: false,
      properties: { tone: sourced(), vocabulary: sourced(), avoid: sourced() },
      required: ['tone', 'vocabulary', 'avoid'],
    },
    app_store: {
      type: 'object', additionalProperties: false,
      properties: { app_name: sourced(), seller: sourced(), price: sourced(), version: sourced(), rating: sourced(), url: sourced(), platform_notes: sourced() },
      required: ['app_name', 'seller', 'price', 'version', 'rating', 'url', 'platform_notes'],
    },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Things a customer-service team would need that the sources do not state.' },
  },
  required: ['company', 'products', 'services', 'pricing', 'faqs', 'policies', 'hours', 'locations', 'contact', 'support_procedures', 'brand_voice', 'app_store', 'gaps'],
};

const INSTRUCTIONS = `You build a Business Profile for a customer-service team from the source documents provided.

Rules that must never be broken:
1. Every value must be supported by a verbatim quote from one of the documents. Put the document index in "doc" and the exact excerpt in "quote". If you cannot quote support for a value, set value to null and source to null.
2. Never invent, guess, round, or generalize. Do not add products, prices, hours, addresses, phone numbers, emails, or policies that are not in the documents. Do not fill a field because it is "probably" true.
3. Copy prices, hours, phone numbers, emails and addresses exactly as written.
4. Brand voice: describe only what the documents demonstrate (for example formal or casual wording, specific recurring phrases). Quote an example. If there is not enough text to judge, leave it null.
5. Support procedures: only record procedures the documents describe (for example "to request a refund, email ... within 30 days").
6. app_store: fill only from an App Store listing document; otherwise leave every value null.
7. "gaps": list, in plain sentences, the things a customer-service agent would be asked about that the documents do not answer (for example "No business hours are stated."). Keep it to the most important ten.
Write every sentence you produce as a complete sentence.`;

export async function buildProfile(docs) {
  const input = docs.map((d, i) => `=== DOCUMENT ${i} (${d.kind}) ${d.url || d.title || ''} ===\n${d.content}`).join('\n\n');
  const { data, model, usage } = await structured({
    instructions: INSTRUCTIONS,
    input: `Source documents follow. Build the profile.\n\n${input}`,
    schema: PROFILE_SCHEMA,
    name: 'business_profile',
    reasoning: 'low',
    timeoutMs: 280_000,
  });
  // Resolve document indexes to URLs so the UI can show where each fact came from.
  const resolve = (node) => {
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === 'object') {
      if ('value' in node && 'source' in node) {
        if (node.source && typeof node.source.doc === 'number') {
          const d = docs[node.source.doc];
          node.source = d ? { doc: node.source.doc, url: d.url || null, title: d.title || null, kind: d.kind, quote: node.source.quote } : null;
        }
        if (node.value === null) node.source = null;
        return node;
      }
      for (const k of Object.keys(node)) node[k] = resolve(node[k]);
    }
    return node;
  };
  return { profile: resolve(data), model, usage };
}

// Turns a stored profile (with the customer's corrections applied) into the
// plain-text knowledge base that agents answer from.
export function profileToKnowledge(profile) {
  const v = (f) => (f && f.value != null && String(f.value).trim() !== '' ? String(f.value).trim() : null);
  const lines = [];
  const c = profile.company || {};
  if (v(c.name)) lines.push(`Company: ${v(c.name)}`);
  if (v(c.tagline)) lines.push(`Tagline: ${v(c.tagline)}`);
  if (v(c.description)) lines.push(`About: ${v(c.description)}`);
  if (v(c.industry)) lines.push(`Industry: ${v(c.industry)}`);
  if (v(c.website)) lines.push(`Website: ${v(c.website)}`);
  const section = (title, rows, fmt) => {
    const out = (rows || []).map(fmt).filter(Boolean);
    if (out.length) lines.push('', `## ${title}`, ...out);
  };
  section('Products', profile.products, (p) => v(p.name) && `- ${v(p.name)}${v(p.price) ? ` — ${v(p.price)}` : ''}${v(p.description) ? `: ${v(p.description)}` : ''}`);
  section('Services', profile.services, (p) => v(p.name) && `- ${v(p.name)}${v(p.price) ? ` — ${v(p.price)}` : ''}${v(p.description) ? `: ${v(p.description)}` : ''}`);
  section('Pricing', profile.pricing, (p) => v(p.item) && `- ${v(p.item)}: ${v(p.price) || 'price not stated'}${v(p.notes) ? ` (${v(p.notes)})` : ''}`);
  section('Hours', profile.hours, (h) => (v(h.days) || v(h.open)) && `- ${v(h.days) || ''}: ${v(h.open) || '?'} to ${v(h.close) || '?'}${v(h.notes) ? ` (${v(h.notes)})` : ''}`);
  section('Locations', profile.locations, (l) => (v(l.name) || v(l.address)) && `- ${[v(l.name), v(l.address), v(l.phone), v(l.email)].filter(Boolean).join(' · ')}`);
  const ct = profile.contact || {};
  section('Contact', [ct], (x) => [v(x.phone) && `Phone: ${v(x.phone)}`, v(x.email) && `Email: ${v(x.email)}`, v(x.support_url) && `Support: ${v(x.support_url)}`, v(x.booking_url) && `Booking: ${v(x.booking_url)}`].filter(Boolean).join('\n') || null);
  section('Policies', profile.policies, (p) => v(p.name) && `- ${v(p.name)}: ${v(p.text) || ''}`);
  section('Support procedures', profile.support_procedures, (p) => v(p.situation) && `- ${v(p.situation)}: ${v(p.procedure) || ''}`);
  section('FAQ', profile.faqs, (f) => v(f.question) && `Q: ${v(f.question)}\nA: ${v(f.answer) || 'not stated'}`);
  const bv = profile.brand_voice || {};
  section('Brand voice', [bv], (x) => [v(x.tone) && `Tone: ${v(x.tone)}`, v(x.vocabulary) && `Vocabulary: ${v(x.vocabulary)}`, v(x.avoid) && `Avoid: ${v(x.avoid)}`].filter(Boolean).join('\n') || null);
  const as = profile.app_store || {};
  section('App Store', [as], (x) => [v(x.app_name) && `App: ${v(x.app_name)}`, v(x.seller) && `Seller: ${v(x.seller)}`, v(x.price) && `Price: ${v(x.price)}`, v(x.version) && `Version: ${v(x.version)}`, v(x.rating) && `Rating: ${v(x.rating)}`, v(x.url) && `URL: ${v(x.url)}`, v(x.platform_notes) && `Notes: ${v(x.platform_notes)}`].filter(Boolean).join('\n') || null);
  return lines.join('\n');
}

// Applies customer corrections (a map of dotted paths to new values) on top of
// the extracted profile. A corrected field's source becomes "Corrected by you".
export function applyCorrections(profile, corrections) {
  const out = JSON.parse(JSON.stringify(profile));
  for (const [path, value] of Object.entries(corrections || {})) {
    const parts = path.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = /^\d+$/.test(parts[i]) ? +parts[i] : parts[i];
      if (node[k] == null) node[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      node = node[k];
    }
    const last = /^\d+$/.test(parts.at(-1)) ? +parts.at(-1) : parts.at(-1);
    node[last] = { value: value === '' ? null : value, source: value === '' ? null : { kind: 'owner', quote: 'Corrected by the business owner.' } };
  }
  return out;
}

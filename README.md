# Squadron

Squadron (squadron.tel) builds a customer-service team from a business's website, App Store listing, or documents, lets the owner test it by chat, voice and phone, and deploys it to phone and chat with honest per-channel status. Everything the team says comes from the Business Profile, with a source on every field.

## Layout

- `index.html` — homepage. `start.html`, `team.html`, `test.html`, `deploy.html`, `hq.html` — the onboarding flow and Squadron HQ. `onboard.css` — shared styles. `widget.js` — the public chat widget.
- `api/` — Vercel functions. `api/_lib/` holds shared code (database, crawling, profile extraction, team generation, the grounded answering engine, voice session builder, auth, usage).
- `api/bridge/` — endpoints the phone bridge calls (number lookup, session, tool events, call storage, recording callback).
- `bridge/` — the phone bridge service (Twilio Media Streams to OpenAI Realtime). It runs on an always-on host, not on Vercel, and is excluded from the Vercel deploy by `.vercelignore`.

## Environment (Vercel project `squadron-tel`)

`OPENAI_API_KEY`, `DATABASE_URL` (Neon), `SESSION_SECRET`, `BRIDGE_SECRET`, `BLOB_READ_WRITE_TOKEN`, and for phone: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Optional: `PROFILE_MODEL`, `CHAT_MODEL`, `REALTIME_MODEL`, `PUBLIC_ORIGIN`.

## Phone bridge

Deploy `bridge/` as a Node service with these variables: `OPENAI_API_KEY`, `BRIDGE_SECRET` (same value as Vercel), `SQUADRON_ORIGIN=https://squadron.tel`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `PUBLIC_HOST` (the service's public hostname). Point each Twilio number's voice webhook at `https://<PUBLIC_HOST>/twilio/voice` (POST). Pool numbers for demos go into the `demo_numbers` table (`INSERT INTO demo_numbers (number) VALUES ('+1...')`).

## Compliance defaults

The AI identifies itself at the start of every conversation, every call starts with an audible recording notice, and Squadron answers inbound conversations only.

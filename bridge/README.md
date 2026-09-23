# Squadron phone bridge

This Cloudflare Worker (squadron-bridge) connects Twilio Media Streams to the OpenAI Realtime API.

Cloudflare Workers Builds deploys it from the main branch of relic-earth/squadron-tel, with /bridge as the root directory. The deploy command is `npx wrangler deploy`, which reads wrangler.toml in this folder.

Secrets are stored in the worker settings: BRIDGE_SECRET, TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. The worker needs no OpenAI key, because /api/bridge/session on squadron.tel issues a short-lived key for each call.

Health check: GET /health returns ok.

Twilio voice webhook: POST /twilio/voice.

# agency-app — AI Receptionist Dashboard + Retell AI integration

A self-contained Node/Express app for the AI-receptionist agency (med-spa niche):

- **Client ROI dashboard** — calls handled, after-hours saves, appointments booked, $ recovered. Your sales asset *and* your retention tool.
- **Retell AI webhook receiver** — captures `call_started` / `call_ended` / `call_analyzed` events.
- **Provisioning scripts** — create a med-spa voice agent on Retell and fire a test call.

> Built and verified on Linux (no Xcode needed). The web dashboard is mobile-friendly so it works on phones today; a native iOS app can wrap/extend it later on your Mac.

## Quick start (see it working with mock data — no Retell key needed)

```bash
cd agency-app
npm install
npm run seed          # generates ~50 realistic demo calls
npm start             # http://localhost:3000
```

Open http://localhost:3000 — the dashboard populates with demo data.
(For a zero-setup peek, open `demo-dashboard.html` directly in any browser.)

## Telephony setup (inbound only)

We run **inbound voice only** and **forward the client's existing number** to the
Retell agent — no number porting, no carrier/SMS registration. See
[`TELEPHONY-SETUP.md`](./TELEPHONY-SETUP.md) for the per-client, do-it-in-order
guide (overflow vs. full forwarding, verification, and the SMS/EIN note for later).

## Go live with Retell AI

1. `cp .env.example .env` and fill in `RETELL_API_KEY` (from the Retell dashboard).
2. Expose your server so Retell can reach the webhook (local dev):
   ```bash
   npx localtunnel --port 3000     # or ngrok http 3000
   ```
   Put the public URL in `.env` as `PUBLIC_WEBHOOK_URL`.
3. Create the agent:
   ```bash
   npm run create-agent            # prints an agent_id -> paste into .env
   ```
4. Assign a phone number to the agent in the Retell dashboard (or import one),
   set `RETELL_FROM_NUMBER` + `TEST_TO_NUMBER` (your own phone), then:
   ```bash
   npm run test-call               # the agent calls your phone
   ```
5. Real calls now flow into the dashboard via the webhook.

## How "bookings" / "$ recovered" are computed

- The agent's **post-call analysis** sets a boolean `appointment_booked`
  (the create-agent script configures this). The dashboard reads it from
  `call_analysis.custom_analysis_data.appointment_booked`.
- **$ recovered** = bookings × the client's `avgJobValue` (per client; default $450).
  Set it via `POST /api/client` `{ "id": "...", "avgJobValue": 600 }`.
- **After-hours** = calls outside Mon–Sat 9am–6pm in the client's timezone.

## Multi-client

Each call is tagged with a `client_id` (from agent metadata or dynamic variables).
View a specific client: `http://localhost:3000/?client=<id>`.

## ⚠️ Important caveats

- **Retell API endpoints/fields may have changed** since this was written —
  verify against https://docs.retellai.com/api-references. Every API call lives
  in `retell.js`, so a moved path is a one-line fix.
- **Legal:** `test-call` is for consented numbers only (your phone, a client who
  asked for a demo). Do **not** cold-call prospects with an AI voice — that
  violates the US TCPA. The agent is an *inbound* receptionist for your clients.
- The JSON-file store is fine for the first handful of clients; move to SQLite/
  Postgres as volume grows.

## Deploy

Any Node host (Railway, Render, Fly.io, a small VPS). Set the env vars there and
point each Retell agent's `webhook_url` at `https://yourhost/webhook/retell`.

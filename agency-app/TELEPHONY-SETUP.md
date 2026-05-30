# Telephony & Compliance — Inbound-Only Setup

The simplest, lowest-risk way to get a med-spa client live: **inbound voice only**, by
**forwarding the client's existing phone number** to a Retell AI agent. No number
porting, no carrier registration, no SMS paperwork. This is the day-one playbook.

---

## Why this setup (the compliance logic)

- **Inbound voice is the low-risk lane.** The scary US telecom regulation
  (TCPA, robocall rules, prior-express-consent) targets **outbound** calling and
  **SMS**. An AI that *answers* calls a customer chose to make is inbound — almost
  none of that applies.
- **No number provisioning.** The client keeps their existing business number;
  customers see no change. You just receive forwarded calls.
- **No A2P 10DLC.** That's an SMS rule. Inbound voice doesn't trigger it. (If you
  add text confirmations later, see "Adding SMS later" below — and note the
  Norwegian-AS EIN wrinkle.)
- **STIR/SHAKEN** (caller-ID authentication) is handled by the carrier/Retell at
  the network level — it is not paperwork you file.

> The one thing to disclose for good practice (and some US state laws require it):
> have the agent identify itself as a virtual/AI assistant in its greeting. The
> med-spa agent prompt already opens as "the front desk"; consider an explicit
> "...our virtual assistant" if you operate in a disclosure state. Low effort,
> keeps you clean.

---

## The two forwarding modes (offer overflow first)

| Mode | What forwards to the AI | Pitch | Best for |
|---|---|---|---|
| **Overflow ⭐** | Calls the front desk doesn't pick up (no-answer / busy / after-hours) | *"Keep your front desk — the AI just catches what they miss."* | Easiest first sale; least disruptive |
| **Full** | Every inbound call | *"The AI is your front desk, 24/7."* | Spas with no/overwhelmed reception |

**Lead with overflow.** It's a lower-stakes "yes" — the spa risks nothing about
their current setup, the AI only handles calls that were already being lost. That's
the exact revenue you're claiming to recover, so the value shows up cleanly.

---

## Per-client setup (do this in order)

### 1. Create the agent (you, before the call)
```bash
cd agency-app
npm run create-agent          # configures an inbound med-spa receptionist
```
Customize the dynamic variables for this spa (name, hours, address, services) so
the agent speaks as *their* front desk. This doubles as your demo.

### 2. Get a Retell number for the agent
Provision a phone number **inside the Retell dashboard** and assign it to the agent.
Retell manages it for you — no Twilio account needed at this stage. (~$1–2/mo;
passed through in your retainer.)

> Twilio "bring-your-own-number" is only worth it later if you want more control or
> better per-minute rates at volume. Skip it now.

### 3. Set up forwarding on the client's line
The client (or their phone provider) points their existing number at the Retell
number. This is a setting on **their** phone system, not something you buy:

- **Conditional / overflow forwarding** (recommended): forward on no-answer and
  busy. On most US carriers/VoIP this is *Call Forwarding – No Answer* and
  *– Busy*, or star codes (e.g. `*92<number>` / `*90<number>` on some carriers —
  confirm with their provider). VoIP systems (RingCentral, Vonage, OpenPhone,
  Google Voice, etc.) have it in settings.
- **Full forwarding**: forward all calls (often `*72<number>`).

You don't need access to their account — walk them through it on the onboarding
call, or have their provider's support flip it. Keep a note of which mode per client.

### 4. Verify end-to-end
- Call the client's number → confirm it reaches the agent under the chosen mode
  (for overflow, let it ring past the front desk / call after hours).
- Confirm the call lands in the dashboard (webhook firing). See `README.md`.
- Run `npm run test-call` to your own phone to hear the agent live.

### 5. Hand off
Show the client the dashboard URL (`/?client=<their-id>`). That's their proof and
your retention tool.

---

## Minutes / cost (so forwarding volume doesn't surprise you)

- Inbound minutes cost you **~$0.10/min all-in** on Retell.
- A typical single-location spa runs **~1,000–1,500 min/month**.
- **Overflow mode uses fewer minutes than full** (only the missed calls forward) —
  another reason to start there: lower cost to serve *and* easier sale.
- Stay on Retell **pay-as-you-go** until ~8–10 clients; only then evaluate a
  bulk-minutes pool. Pricing tiers/buckets are in the strategy doc.

---

## Adding SMS later (not now — and the 🇳🇴 wrinkle)

If you later want the agent to text appointment confirmations/reminders:

- **A2P 10DLC registration becomes mandatory** (carriers block 100% of
  unregistered SMS). You register a Brand + Campaign via The Campaign Registry
  (through Twilio/Retell).
- **Brand registration normally requires a US EIN**, which a Norwegian AS doesn't
  have. There's an international registration path, but it's slower, pricier, and
  throughput-throttled. **Verify the current process with Twilio/Retell support
  before committing** — this is the part most likely to have changed.
- **Cleanest workaround:** register the SMS campaign under the **client's** business
  identity (they have the US EIN), or skip agent-sent texts entirely and just
  capture leads into the dashboard for the spa's team to follow up.

**For now: inbound voice only. No SMS, no outbound, no registration. Ship it.**

# Answerspot — Product & Build Plan

*AI answer scout for local service businesses competing block by block.*

> Status: planning draft. This document turns the one-pager into an MVP scope,
> architecture, data model, and phased roadmap. It is written to reuse the
> existing Node/Express + Stripe + auth code already in this repo and to add a
> Postgres-backed scout/report engine on top.

---

## 1. The thesis in one paragraph

AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google AI Overviews) increasingly
answer "best roofer near me" with a short, named shortlist instead of ten blue links.
For a local service business, *being one of the three names returned* is now a distinct
channel from classic local SEO — and almost no one measures it. Answerspot measures it:
it asks the AI platforms the category queries a customer would ask in a given city,
records which businesses get named and cited, tracks how that shortlist changes
week over week, and hands the owner a short list of concrete fixes. Sold at $99/mo as a
layer on top of the ~$1,000/mo they already spend on SEO and reviews.

## 2. What we are actually selling (and what we are not)

**Selling:** *visibility intelligence* — "here is what the AI says about your category
in your city, here is where you rank, here is what moved, here is what to fix this week."

**Not selling (yet):** done-for-you fixes, review generation, or guaranteed ranking.
Those are expansion phases. The wedge is measurement + a prioritized action list, because
that is cheap to deliver manually for 10 beta customers and is the thing we can validate.

**The one success metric for the beta:** a user acts on at least one recommended fix
within 7 days of receiving a report. Everything in the MVP is in service of that metric.
If owners read the report and do nothing, the product is wrong regardless of how good the
data pipeline is.

## 3. The hard part, named up front (feasibility risk)

The single biggest risk is **how we obtain AI answers durably and legally.** There are two
sources, and they are not equal:

| Source | Durable? | Legal posture | Coverage |
|---|---|---|---|
| Official APIs (OpenAI, Perplexity Sonar, Google AI grounding, Gemini) | Yes | Clean (ToS-permitted) | Growing, but not identical to the consumer UI |
| Scripted/headless checks of consumer chat UIs | No — brittle, breaks on UI changes, bot-detected | Against most platforms' ToS | Matches what a real user sees |

The one-pager already hedges this correctly ("official APIs where offered, scheduled
scripted checks everywhere else"). The plan's stance:

1. **Build the engine API-first.** Every result is normalized into the same schema
   regardless of source, so we can swap sources without touching reporting.
2. **Treat scripted UI checks as a clearly-labeled, best-effort signal**, isolated behind
   one adapter, never the core of the product, and never resold as a guarantee. Assume any
   given UI adapter has a half-life of weeks.
3. **Be honest in the report about which engine each result came from.** "Perplexity Sonar
   API named you #2" is a defensible claim; "ChatGPT will show you #2" is not.

This is a feasibility constraint, not a blocker — but it shapes the whole architecture
(source-agnostic normalization) and the sales claims. We should not pretend a scraped
answer is ground truth.

A secondary risk: **AI answers are non-deterministic.** The same query returns different
shortlists across runs. The product must run each query N times (e.g. 3–5) and report a
*frequency of appearance* ("named in 4 of 5 runs"), not a single brittle rank. This is core
to making week-over-week diffs meaningful rather than noise.

## 4. MVP scope (the 10-customer manual beta)

The beta is deliberately **human-in-the-loop**. We do not automate the pipeline before we
know what drives action. Concretely, the MVP is:

**Owner-facing**
- A signup + single business profile (name, category, city, optional website).
- A dashboard showing the latest report: the AI shortlist for their category/city, where
  they rank (frequency of appearance), which competitors appear, and what signals look
  missing (reviews, citations, schema markup).
- A week-over-week diff: position shifts, new entrants, dropped names, and the citation
  changes behind them.
- A short, prioritized fix list per report (review-volume target, citations to claim,
  markup corrections).
- A "live lookup" button (and a browser extension) to trigger an on-demand check between
  weekly reports.

**Operator-facing (us, manually for 10 customers)**
- A small internal tool/CLI to: define the query set for a business, run the checks across
  available engines, parse the structured result, and store it in Postgres.
- A report-generation step that produces the dashboard data + the fix list. In the beta
  this can be operator-reviewed before it goes live to the customer.

**Explicitly out of MVP:** automated scheduling, multi-business accounts, agency white-label,
automated fix implementation, billing dunning logic. Stub the surfaces, don't build them.

## 5. Architecture

Reuse the existing stack; add Postgres and a worker.

```
                       ┌─────────────────────────────┐
                       │  Owner dashboard (public/)   │
                       │  + browser extension         │
                       └──────────────┬──────────────┘
                                      │ HTTPS (Express API)
                       ┌──────────────▼──────────────┐
                       │   Express app (server.js)    │
                       │  auth (Passport) · Stripe     │
                       │  /api/report  /api/lookup     │
                       └──────────────┬──────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
        ┌───────▼──────┐     ┌────────▼────────┐    ┌───────▼────────┐
        │   Postgres   │     │  Scout engine    │    │  Report engine │
        │ (businesses, │◄────┤  (query runner + │───►│ (diff + fixes) │
        │  runs, diffs)│     │   normalizer)    │    │                │
        └──────────────┘     └────────┬─────────┘    └────────────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
              ┌─────▼─────┐    ┌──────▼──────┐     ┌──────▼──────┐
              │ OpenAI    │    │ Perplexity  │     │ Scripted UI │
              │ adapter   │    │ Sonar       │     │ adapter     │
              │ (API)     │    │ adapter(API)│     │ (best-effort)│
              └───────────┘    └─────────────┘     └─────────────┘
```

**Engine adapter contract.** Each adapter, given `{category, city, queryText}`, returns a
normalized `ScoutResult`: `{ engine, query, rawAnswer, namedBusinesses[], citations[],
runAt }`. The runner calls it N times and aggregates. The rest of the system never knows or
cares which engine produced a result.

**Parsing/extraction.** Turning a free-text AI answer into `namedBusinesses[]` and
`citations[]` is itself an LLM task: feed the raw answer to a Claude/GPT extraction call with
a strict JSON schema (business name, rank/order, the cited source URL/domain). This reuses
the "call an LLM, parse structured output" pattern the repo already uses for `rephraseAnswer`.
Default to the latest Claude model for extraction (`claude-fable-5` / current Opus) for
reliable structured output; keep the model behind one config constant so it's swappable.

**Why Postgres.** The one-pager specifies it, and the diff feature genuinely needs it:
historical runs, aggregations, and week-over-week comparisons are relational queries.
Supabase is a fast path here (managed Postgres + auth + row-level security) and is available
in this environment if we want it; plain Postgres works equally well.

## 6. Data model (first cut)

```sql
-- A customer's business profile
businesses (
  id            uuid pk,
  owner_user_id uuid,            -- links to auth user
  name          text,
  category      text,            -- "roofer", "dentist", "HVAC", "auto shop"
  city          text,
  website       text null,
  created_at    timestamptz
)

-- The category queries we run for a business ("best roofer in <city>", etc.)
queries (
  id          uuid pk,
  business_id uuid fk,
  text        text,              -- the actual prompt sent to engines
  active      boolean default true
)

-- One execution of one query against one engine (we run each query N times)
scout_runs (
  id          uuid pk,
  query_id    uuid fk,
  engine      text,              -- 'openai' | 'perplexity' | 'gemini' | 'scripted:chatgpt'
  raw_answer  text,
  run_at      timestamptz,
  batch_id    uuid               -- groups the N runs + all engines for one report cycle
)

-- Businesses named in a given run, in order
run_mentions (
  id           uuid pk,
  scout_run_id uuid fk,
  business_name text,
  rank          int,             -- order of appearance in the answer
  is_subject    boolean          -- true if this is the customer's own business
)

-- Citations found in a given run
run_citations (
  id           uuid pk,
  scout_run_id uuid fk,
  url          text,
  domain       text
)

-- A generated weekly report (the deliverable)
reports (
  id          uuid pk,
  business_id uuid fk,
  batch_id    uuid,
  summary     jsonb,             -- aggregated shortlist + frequency-of-appearance
  diff        jsonb,             -- vs previous report: entrants, drops, moves
  fixes       jsonb,             -- prioritized action list
  created_at  timestamptz,
  delivered   boolean
)
```

Aggregation ("named in 4 of 5 runs, avg rank 2.3") is computed from `run_mentions` grouped
by `batch_id`. The diff compares the current `reports.summary` to the previous one for the
same business.

## 7. The report — the actual product

A report is three sections, in priority order:

1. **Where you stand.** For each tracked query: your frequency of appearance and average
   rank, the full named shortlist, and which engine(s) it came from. Plain language:
   *"Gemini named you in 4 of 5 runs at average position 2; Perplexity did not name you at all."*
2. **What changed.** Versus last week: new competitors that entered the shortlist, names that
   dropped, position moves, and — where we can attribute it — the citation change behind it
   (*"Competitor X now cited from a new Yelp listing with 40 reviews"*).
3. **What to fix this week.** 1–3 concrete, checkable actions ranked by likely impact:
   a review-volume target, a specific citation source to claim, or a schema-markup correction.
   Each fix is phrased so we can later verify whether the owner did it (this is how we measure
   the 7-day success metric).

Keep it to one screen. Owners of roofing companies will not read a dashboard with 30 widgets.

## 8. Reusing what's already in this repo

| Existing piece (`server.js`) | Reuse for Answerspot |
|---|---|
| Express + static `public/` | Dashboard + API host |
| Passport local auth + sessions | Owner accounts (move user store from in-memory array to Postgres) |
| Stripe checkout (subscription mode) | $99/mo billing — already wired, just new price ID |
| `rephraseAnswer` / GPT call pattern | Becomes the structured-extraction call (answer → JSON) |
| `nodemailer` bug report | Becomes report-ready email notifications |
| `axios` external calls | Engine adapters |

**Required upgrades before beta:** the in-memory `users` array must move to Postgres (it
loses all accounts on restart), and secrets must be real env vars. These are MVP blockers,
not nice-to-haves.

## 9. Go-to-market (from the one-pager, sequenced)

- **Beta (now):** 10 hand-picked local operators across the named categories (roofer,
  dentist, HVAC, auto shop). Manual delivery. Goal = validate the 7-day action metric and
  learn which fixes owners actually act on.
- **Self-serve ($99/mo):** automate the pipeline once beta proves the report drives action.
  Distribution via SEO-focused Facebook groups and YouTube creators covering AI discovery.
- **Agency white-label:** the strongest near-term wedge. Agencies need a *fresh monthly
  deliverable* now that clients ask "what replaces SEO?" An Answerspot report fits that slot
  exactly. Agency tier = multi-business dashboard + co-branded PDF export.
- **Expansion:** automated fix implementation (review requests, citation submission, schema
  patches) and agency-tier reporting.

## 10. Phased roadmap

**Phase 0 — Foundations (week 1)**
- Stand up Postgres; create schema above. Move auth user store to Postgres.
- One working engine adapter (OpenAI or Perplexity Sonar API) + the LLM extraction step.
- Internal CLI: `run-scout <businessId>` → writes `scout_runs` + mentions + citations.

**Phase 1 — Manual beta loop (weeks 2–3)**
- Second engine adapter. Run each query N times; aggregate frequency-of-appearance.
- Report generator: summary + fixes (diff is trivial until there's a second week).
- Minimal dashboard reading `reports`. Onboard first 2–3 beta businesses by hand.

**Phase 2 — Diffs + live lookup (weeks 4–5)**
- Week-over-week diff once two report cycles exist per business.
- `/api/lookup` on-demand check + browser extension that calls it.
- Onboard the full 10. Track the 7-day action metric per customer.

**Phase 3 — Automate (only after the metric holds)**
- Scheduled weekly runs (cron/worker). Stripe self-serve signup live.
- Email delivery of "your new report is ready."

**Phase 4 — Scale the wedge**
- Agency multi-business view + white-label PDF export.
- Begin automated-fix experiments.

## 11. Open questions to resolve with the user

1. **Engine priority:** which AI platform's answers matter most to your target customers —
   ChatGPT, Perplexity, Gemini, or Google AI Overviews? This decides which adapter we build
   first and which API budget we need.
2. **Build-on-this-repo vs fresh service:** reuse this Express app, or start a clean
   Answerspot codebase and lift the useful pieces over?
3. **Postgres host:** managed Supabase (fastest, available here) vs self-hosted Postgres.
4. **Scripted UI checks:** in or out for the beta? They match what users see but are brittle
   and ToS-risky. Recommendation: API-only for the beta, label everything by source.
5. **Fix verification:** how do we confirm an owner acted within 7 days — self-report in the
   dashboard, or do we re-scan for the signal change? Affects how we instrument the metric.

---

*This is a plan, not a commitment to scope. The recommended next concrete step is Phase 0:
schema + one API adapter + the extraction step, so we can produce one real report for one
real business and see if it lands.*

# Autonomous SDR — Backend

Backend for the **Autonomous SDR Control Plane** (Inter Guild Buildathon 2026, Tech Contingent
× DronaHQ). Implements the campaign / prospect / decision / approval / agent / settings API the
frontend's `src/services/api.js` currently mocks, plus the real logic behind it: autonomous
agent orchestration (PS Section 4), campaign lifecycle and operational controls, prompt/harness
versioning, cross-campaign conflict detection, and campaign-scoped RAG (PS Section 3 & 4).

## 1. Tech stack

- **Node.js + Express** — REST API, matches the frontend's own plain-JS/ESM style.
- **Postgres (Neon), real tables** — when `DATABASE_URL` is set, every campaign / prospect /
  decision / approval / agent / setting is a row in a real relational table in your Neon project
  (see Section 3a). This is the default for the deployed/demo build.
- **JSON file datastore** (`data/state.json`) — the zero-setup fallback when `DATABASE_URL` is
  *not* set: a direct backend-side port of the frontend's own mock store (`src/services/store.js`
  + `src/data/seed.js`), same shape and seed data, just persisted to disk instead of
  `sessionStorage`. Handy for offline demoing or a laptop with no network.
  Either way, every route/service file (`src/services/data.js`, `scheduler.js`, `conflict.js`,
  `rag.js`, `agentEngine/*`) is completely unaware of which store is active — they only ever call
  `getState()`/`withState()` from `src/db/index.js`, which dispatches to Postgres or the JSON file.
- **TF-IDF retrieval** (`src/services/rag.js`) over campaign-scoped knowledge documents
  (`data/knowledge/*.txt`) — real retrieval-before-decision, no external embeddings API key
  required. Swappable for pgvector/OpenAI/Voyage embeddings behind the same `retrieve()` call.
- **Anthropic API** (`@anthropic-ai/sdk`), optional — real LLM-driven agent reasoning when
  `AGENT_ENGINE=llm` and `ANTHROPIC_API_KEY` is set. Defaults to a deterministic rule engine
  (`src/services/agentEngine/ruleEngine.js`) that needs no API key at all, so the backend runs
  end to end immediately after `npm install`.

## 2. Setup & run

```bash
npm install
cp .env.example .env      # optional — every value has a working default
npm start                 # http://localhost:8080
```

The server seeds itself on first boot with the same 3 campaigns / prospects / agents / decisions
the wireframes and frontend were built against (`src/db/seed.js`), and starts an autonomous
scheduler (`src/services/scheduler.js`) that advances Live campaigns every 12 seconds — this is
what makes the system "autonomous" rather than only reactive to clicks in the UI.

If `DATABASE_URL` is set (see 3a below), that first-boot seed goes into your real Postgres tables
instead of a local file — this repo's Neon project already has it seeded, so a normal `npm start`
against it will find the 3 campaigns already there and just load them.

To reset back to the seed data at any time: `npm run reset-data` (or, in JSON-file mode only, just
delete `data/state.json` and restart).

### 3a. Postgres (Neon) — real tables

`.env` already has `DATABASE_URL` filled in, pointing at this project's Neon database. When that
variable is set, `src/db/index.js` uses `src/db/postgresAdapter.js` instead of the JSON file, and
every mutation (`withState()` — the same function every route already calls) is written straight
into 13 real tables:

```
campaigns, campaign_sources, prospects, events, decisions, approvals,
agents, agent_versions, agent_overrides, channels, suppression, integrations, app_settings
```

The schema is a normal normalized relational design (foreign keys with `ON DELETE CASCADE`,
indexes on every FK) — scalar/queryable fields are real typed columns, small repeated lists
(geography, personas, tech stack, evidence, etc.) are native Postgres `text[]` columns, and only
genuinely nested/variable-shape data (a prospect's message history and conversation transcript)
is `jsonb`. `campaign_sources.id` is scoped per-campaign (its primary key is the composite
`(campaign_id, id)`, not `id` alone), because source ids like `s1`/`s2` are reused across
campaigns in the seed data.

These 13 tables have already been created in this project's Neon database and seeded with the
same demo data described above — you can open the Neon console (or any Postgres client) and see
3 campaigns, 12 prospects, 7 decisions, 5 approvals, and so on, right now, without running the
server at all.

**What I could verify from here vs. what needs your own quick check:** I created the tables and
seeded them directly against your Neon project via SQL (verified with `SELECT count(*)` on every
table, plus spot-checks confirming array and JSON fields came back correctly typed) — that part is
confirmed working. What I could *not* do from my own sandbox is boot the actual Node server against
Neon end-to-end: this environment's network policy blocks raw TCP database connections (Postgres
isn't HTTP), so `pg`'s connection from `src/db/pg.js` can't be exercised here. The code path itself
is the standard, well-established `pg` `Pool`/parameterized-query pattern, and I did verify the
JSON-file fallback mode boots and round-trips writes correctly end-to-end (same `withState()` call
path, different persistence target) — but the very first thing to do after unzipping is:

```bash
npm install
npm start
```

...and confirm the log line reads `Datastore: Postgres (Neon)` (not "local JSON file") and that
`GET http://localhost:8080/api/command-center` returns the 3 seeded campaigns. If anything looks
off, tell me the exact error and I'll fix it immediately.

Removing `DATABASE_URL` from `.env` (or setting it blank) switches straight back to the zero-setup
JSON-file mode with no other changes needed — useful if you ever want to demo offline.

### Turning on real LLM-driven agents

By default `AGENT_ENGINE=rule` — zero cost, zero setup, and every agent decision is still real
(it reads the campaign's actual ICP/personas/criteria and the prospect's actual fields; nothing
is hardcoded or random-only). To use real Anthropic-powered reasoning per PS Section 4 instead:

```
AGENT_ENGINE=llm
ANTHROPIC_API_KEY=sk-ant-...
```

If the LLM call ever fails (bad key, rate limit, network), the engine automatically falls back to
the rule engine for that one decision and logs a warning — the system never crashes or stalls
because of it.

## 3. Wiring up the frontend

The frontend's own `src/services/api.js` already documents the seam: *"Backend swap: reimplement
functions in `src/services/api.js` with `fetch()`; keep names and return shapes."* That's exactly
what `frontend-integration/api.js` in this repo is — copy it over the frontend's
`src/services/api.js`, then in the frontend project add a `.env`:

```
VITE_API_BASE_URL=http://localhost:8080/api
```

No screen, hook, or component changes are needed — every function name and return shape matches
the mock exactly.

## 4. Architecture overview

```
Frontend (React/Vite)  →  REST API (src/routes)  →  Services (src/services)  →  JSON store (src/db)
                                                            │
                                                            ├─ agentEngine/  → rule engine (default) or Anthropic API (llm mode)
                                                            ├─ rag.js        → campaign-scoped knowledge retrieval
                                                            ├─ conflict.js   → cross-campaign duplicate/suppression checks
                                                            └─ scheduler.js  → autonomous tick driving all of the above
```

Every meaningful autonomous action — a qualification, a drafted message, a blocked conflict, a
booked meeting — is written to the Decision Journal (`decisions` in the store) with the agent
name, the active prompt/harness version, the evidence used, and the knowledge actually retrieved,
so "why did the agent behave this way" and "which configuration produced this outcome" (PS
Section 3) are always answerable from real data, not seeded text.

### Guardrail order (checked before any autonomous action)

1. Global kill switch (`settings.killSwitch.active`) — stops everything immediately.
2. Campaign status (`live` only — Draft/Paused/Completed/Archived never progress).
3. Per-agent enable/disable (`agents[].enabled`).
4. Per-channel enable/disable (`channels[].enabled`).
5. Cross-campaign conflict / suppression-list check (`src/services/conflict.js`), specifically
   before first contact.

Pausing one campaign only calls `transition()` on that campaign's own record — every other
campaign's scheduler loop is unaffected, satisfying the PS's required demonstration.

## 5. API reference

All routes are mounted under `/api`. Request/response bodies mirror the frontend's
`src/data/types.js` JSDoc typedefs exactly.

| Method | Path | Mirrors `api.js` function |
|---|---|---|
| GET | `/shell` | `getShellState` |
| GET | `/command-center` | `getCommandCenter` |
| GET | `/campaigns/defaults` | `getCampaignDefaults` |
| POST | `/campaigns` `{values, launch}` | `createCampaign` |
| GET | `/campaigns/:id` | `getCampaign` |
| POST | `/campaigns/:id/pause` | `pauseCampaign` |
| POST | `/campaigns/:id/resume` | `resumeCampaign` |
| POST | `/campaigns/:id/launch` | `launchCampaign` |
| POST | `/campaigns/:id/complete` | `completeCampaign` |
| POST | `/campaigns/:id/archive` | `archiveCampaign` |
| GET | `/prospects` | `getProspects` |
| GET | `/prospects/:id` | `getProspect` |
| GET | `/decisions?limit=` | `getDecisions` |
| GET | `/decisions/for-prospect/:prospectId` | `getDecisionForProspect` |
| GET | `/approvals` | `getApprovals` |
| GET | `/approvals/:id` | `getApproval` |
| POST | `/approvals/:id/decide` `{action, reason}` | `decideApproval` |
| PATCH | `/approvals/:id` `{draftBody?, nextActionText?}` | `editApproval` |
| GET | `/agents` | `getAgents` |
| GET | `/agents/:id` | `getAgent` |
| POST | `/agents/:id/versions` `{text}` | `savePromptVersion` |
| POST | `/agents/:id/versions/:version/activate` | `activatePromptVersion` |
| POST | `/agents/:id/compare` | `requestPromptCompare` (stub, matches frontend) |
| POST | `/agents/:id/rollback` | `requestPromptRollback` (stub, matches frontend) |
| POST | `/agents/:id/enabled` `{enabled}` | `setAgentEnabled` |
| GET | `/settings` | `getSettings` |
| POST | `/settings/kill-switch` `{active}` | `setKillSwitch` |
| POST | `/settings/channels/:key` `{enabled}` | `setChannelEnabled` |
| POST | `/settings/suppression` `{contact, reason}` | `addSuppression` |
| GET | `/health` | — (liveness + which agent engine is active) |

## 6. File / folder structure

```
src/
  server.js                 Express app entrypoint, CORS, error handling, starts the scheduler
  config.js                 All env-driven configuration in one place
  db/
    index.js                getState/withState/resetState/persistState — dispatches to Postgres
                             or the JSON file depending on DATABASE_URL; every route/service only
                             ever calls this file, never Postgres or the filesystem directly
    pg.js                   Postgres connection pool + transaction helper (node-postgres)
    postgresAdapter.js      Maps the in-memory state object to/from the 13 real Neon tables
    seed.js                 Seed data — ported from the frontend's src/data/seed.js
  services/
    data.js                 Every function src/services/api.js mocks, for real (campaigns, prospects,
                             decisions, approvals, agents/prompts, settings)
    logic.js                Lifecycle/scoping rules — ported from the frontend's src/services/logic.js
    constants.js            Stage/channel/lifecycle constants — ported from the frontend
    conflict.js             Cross-campaign conflict + suppression-list detection (PS Section 3)
    rag.js                  Campaign-scoped knowledge chunking + TF-IDF retrieval (PS Section 4)
    prospectGenerator.js    Synthetic lead discovery (stand-in for Apollo/equivalent)
    scheduler.js            The autonomous tick — the only place that drives agents end to end
    agentEngine/
      index.js               Dispatches to llmEngine or ruleEngine; attaches prompt/harness/RAG context
      ruleEngine.js           Deterministic default — real heuristics over real campaign/prospect fields
      llmEngine.js            Real Anthropic tool-calling per agent, structured JSON output
  routes/index.js            REST routes — thin wrappers over services/data.js
  middleware/errors.js       Uniform error responses + async route wrapper
  utils/                     validation.js, format.js — ported from the frontend
data/
  knowledge/*.txt            Real knowledge base content (product one-pager, case study, objections)
  state.json                 Generated at runtime — the live datastore (gitignored)
frontend-integration/api.js  Drop-in replacement for the frontend's src/services/api.js
```

## 7. What this deliberately does not include

Scoped to the problem statement's Sections 3 and 4 plus the Engineering Expectations in Section
5 — nothing beyond what the frontend and PS actually call for:

- No real Gmail/Twilio/Apollo network calls. Sends and calls are logged as real state changes
  (`outreach` counters, `conversation` entries, Decision Journal rows) exactly as the approved
  frontend mock already modeled them; LinkedIn and Voice remain explicitly simulated channels,
  matching the frontend's own `(sim.)` labeling. Swapping in real providers is a matter of
  replacing the two or three lines in `scheduler.js` that currently just mutate state, with an
  actual API call — the campaign/approval/kill-switch gating around them does not change.
- No authentication system — the PS does not ask for one, and the frontend has no sign-in screen.
- No separate vector database — the TF-IDF retriever in `rag.js` is a real, working retrieval
  mechanism that needs no external service; it's flagged above as the first thing to upgrade if
  pgvector/embeddings become worth the setup time.

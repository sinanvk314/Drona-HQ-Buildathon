# Autonomous SDR — Backend

Backend for the **Autonomous SDR Control Plane** (Inter Guild Buildathon 2026, Tech Contingent
× DronaHQ). Implements the campaign / prospect / decision / approval / agent / settings API the
frontend's `src/services/api.js` currently mocks, plus the real logic behind it: autonomous
agent orchestration (PS Section 4), campaign lifecycle and operational controls, prompt/harness
versioning, cross-campaign conflict detection, and campaign-scoped RAG (PS Section 3 & 4).

## 1. Tech stack

- **Node.js + Express** — REST API, plain ESM JavaScript.
- **JSON file datastore** (`data/state.json`, gitignored) — the default and the tested path. Created and seeded on
  first start; each clone gets its own copy.
- **Postgres / Neon (optional)** — set `DATABASE_URL` and `src/db/postgresAdapter.js` stores the whole state as one JSON
  row in a table called `sdr_app_state` (created automatically). For hosts with no persistent disk.
- **Local embeddings** (`fastembed`, `BAAI/bge-small-en-v1.5`, in-process ONNX, no API key) for knowledge retrieval
  (`src/services/rag.js`) and reply routing (`src/services/replyRouter.js`). TF-IDF is the fallback if the model
  cannot load.
- **Agent engines** — Google Gemini (default LLM), optional DronaHQ webhooks and Anthropic, and a deterministic rule
  engine that is always the last fallback (`src/services/agentEngine/`).

## 2. Setup & run

```bash
npm install
cp .env.example .env      # Windows CMD: copy .env.example .env
npm start                 # http://localhost:8080
```

The full guide, including the Gemini key, every environment variable, deployment and running as a team, is in the
[root README](../README.md). Short version:

- No key needed to start: it runs on the rule engine.
- For Gemini, put `AGENT_ENGINE=gemini` and `GEMINI_API_KEY=...` in `.env` and restart.
- The first start seeds three campaigns and starts the scheduler, which advances Live campaigns every 12 seconds.
- To reset, delete `data/state.json` and restart. **That deletes all campaigns you created.**

## 3. Architecture overview

```
Frontend (React/Vite)  →  REST API (src/routes)  →  Services (src/services)  →  JSON store (src/db)
                                                            │
                                                            ├─ agentEngine/  → gemini / dronahq / anthropic, then the rule engine
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

### Matching vs judgment, cost control and approval levels

Decisions are split into **matching** (geometry, free) and **judgment** (an LLM):

- **Clear-cut ICP rejections** skip the LLM (`ICP_SHORTCUT_MARGIN`). Qualifications always get the LLM's read.
- **Reply routing** (`services/replyRouter.js`): unsubscribe, hostile and out-of-office replies are matched by
  embedding similarity to canonical examples in `data/knowledge/reply-examples.json` and handled with no LLM call
  (opt-outs go onto the global suppression list). Anything ambiguous goes to the Conversation Agent.
- **Retrieval** (`services/rag.js`): knowledge chunks are embedded locally (`services/embeddings.js`, bge-small via
  `fastembed`, no API key; model cached in `data/.embedding-cache` after the first download) and ranked by cosine
  similarity, with TF-IDF as the fallback if the model cannot load. Retrieval only searches the campaign's own sources.
- **Daily LLM cap** (`LLM_DAILY_CALL_CAP`, default 300, 0 = off): every provider request is counted in
  `data/usage.json`; past the cap the rule engine decides. The Command Center's "AI Efficiency" panel and `/health`
  show calls made, decisions with no LLM call, and the estimated cost saved.
- **Approval levels** per campaign (`approvals.level`): `manual` (toggled actions wait for a human), `assisted`
  (auto-approve at fit >= `autoMinScore` after `autoAfterApproved` human approvals of that action), `autonomous`.
  Escalated objections always need a human.
- **Outreach strategy and follow-up.** `agentEngine/index.js` `planOutreach` (Outreach Strategy agent) plans each qualified prospect's
  channel sequence; `draftFollowUp` (Follow-up agent) writes later touches. `services/scheduler.js` runs
  `runStrategy` and `runFollowUp` as stages. Every touch goes through `services/outreach.js` `recordTouch`, and
  `services/limits.js` gates working hours, the daily limit and the contact-frequency cap on the simulated clock in
  `services/simTime.js`.
- **Grounding check** (`services/grounding.js`): figures, compliance claims, prices and meeting times in a draft are checked
  against the retrieved knowledge and the prospect's data; a failing draft is rewritten once, and never auto-sent.
- **Additive migration** (`db/migrate.js`): on every start, saved state gains any new agents and fields without removing or
  overwriting anything, so upgrades never wipe campaigns.
- **Knowledge sources** are per campaign: either a shipped document (`docId` -> `data/knowledge/<docId>.txt`) or text
  added in the UI (`content`). Add and remove from the campaign page (`POST /campaigns/:id/sources`,
  `DELETE /campaigns/:id/sources/:sourceId`).

## 4. API reference

All routes are mounted under `/api`. Request/response bodies mirror the frontend's
`src/data/types.js` JSDoc typedefs exactly.

| Method | Path | Mirrors `api.js` function |
|---|---|---|
| GET | `/shell` | `getShellState` |
| GET | `/command-center` | `getCommandCenter` |
| GET | `/campaigns/defaults` | `getCampaignDefaults` |
| POST | `/campaigns` `{values, launch}` | `createCampaign` |
| GET | `/campaigns/:id` | `getCampaign` |
| GET | `/campaigns/:id/config` | `getCampaignConfig` (settings for the edit form) |
| PUT | `/campaigns/:id` `{values}` | `updateCampaign` (not for completed/archived) |
| POST | `/campaigns/:id/duplicate` | `duplicateCampaign` (new Draft with the same setup) |
| POST | `/campaigns/:id/sources` `{name, category, content}` | `addCampaignSource` |
| DELETE | `/campaigns/:id/sources/:sourceId` | `removeCampaignSource` |
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

## 5. File / folder structure

```
src/
  server.js                 Express app entrypoint, CORS, error handling, starts the scheduler
  config.js                 All env-driven configuration in one place
  db/
    index.js                getState/withState/resetState/persistState — dispatches to Postgres
                             or the JSON file depending on DATABASE_URL; every route/service only
                             ever calls this file, never Postgres or the filesystem directly
    pg.js                   Postgres connection pool + transaction helper (node-postgres)
    postgresAdapter.js      Stores the whole state as one JSON row in Postgres (table sdr_app_state)
    seed.js                 Seed data — ported from the frontend's src/data/seed.js
  services/
    data.js                 Every function src/services/api.js mocks, for real (campaigns, prospects,
                             decisions, approvals, agents/prompts, settings)
    logic.js                Lifecycle/scoping rules — ported from the frontend's src/services/logic.js
    constants.js            Stage/channel/lifecycle constants — ported from the frontend
    conflict.js             Cross-campaign conflict + suppression-list detection (PS Section 3)
    rag.js                  Campaign-scoped knowledge chunking + semantic retrieval (TF-IDF fallback)
    embeddings.js           Local bge-small embeddings (fastembed)
    replyRouter.js          Embedding-based routing of opt-out / hostile / out-of-office replies
    usage.js                Daily LLM call cap, counters and cost estimate
    prospectGenerator.js    Synthetic lead discovery (stand-in for Apollo/equivalent)
    scheduler.js            The autonomous tick — the only place that drives agents end to end
    agentEngine/
      index.js               Dispatches to llmEngine or ruleEngine; attaches prompt/harness/RAG context
      ruleEngine.js           Deterministic default — real heuristics over real campaign/prospect fields
      llmEngine.js            Real Anthropic tool-calling per agent, structured JSON output
      geminiEngine.js         Google Gemini with structured JSON, retries and model fallback
      dronahqEngine.js        DronaHQ agents through their Webhook Triggers
  routes/index.js            REST routes — thin wrappers over services/data.js
  middleware/errors.js       Uniform error responses + async route wrapper
  utils/                     validation.js, format.js — ported from the frontend
data/
  knowledge/*.txt            Knowledge base documents, referenced per campaign by docId
  knowledge/reply-examples.json  Canonical replies used by the reply router
  state.json                 Generated at runtime — the live datastore (gitignored)
```

## 6. What this deliberately does not include

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

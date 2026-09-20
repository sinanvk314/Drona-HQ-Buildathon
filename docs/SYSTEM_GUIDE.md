# System guide: how everything works

Written in plain words for a developer who has just joined. Read it top to bottom once (about 25 minutes) and you will know
where everything lives and why. What is **not** built yet is in [ROADMAP.md](ROADMAP.md).

Contents

1. [What this product is](#1-what-this-product-is)
2. [The words we use](#2-the-words-we-use)
3. [The big picture](#3-the-big-picture)
4. [A prospect's journey, step by step](#4-a-prospects-journey-step-by-step)
5. [The agents](#5-the-agents)
6. [Rules that no agent can break](#6-rules-that-no-agent-can-break)
7. [Matching vs judgment, and keeping costs down](#7-matching-vs-judgment-and-keeping-costs-down)
8. [Knowledge and retrieval](#8-knowledge-and-retrieval)
9. [Prompts and versions](#9-prompts-and-versions)
10. [Approvals](#10-approvals)
11. [Representatives](#11-representatives)
12. [Sign-in](#12-sign-in)
13. [The data: where it lives and its shape](#13-the-data-where-it-lives-and-its-shape)
14. [Backend map, file by file](#14-backend-map-file-by-file)
15. [Frontend map](#15-frontend-map)
16. [Configuration](#16-configuration)
17. [Testing](#17-testing)
18. [Running it and deploying it](#18-running-it-and-deploying-it)
19. [Recipes: how to add things](#19-recipes-how-to-add-things)
20. [Decisions and gotchas](#20-decisions-and-gotchas)
21. [What is simulated and what is real](#21-what-is-simulated-and-what-is-real)
22. [How a campaign, a person and a meeting fit together](#22-how-a-campaign-a-person-and-a-meeting-fit-together)

---

## 1. What this product is

A manager runs **campaigns**. Each campaign is a sales program aimed at one kind of buyer (for example "CTOs of US software
companies"). Software agents do the daily work: they find people, decide who is a good fit, plan how to contact them, write
the messages, read the replies and follow up. The manager stays in control: they can pause anything, approve what is sent,
and see *why* every decision was made.

It was built for a 51-hour hackathon (Tech Contingent, IIT Madras with DronaHQ). The brief asked for one system with two
halves that work as one product:

- the **control plane**: the screens a human uses to create, launch, pause, watch and steer campaigns;
- the **intelligence layer**: the agents that do the selling work inside those campaigns.

The fictional product being sold is **NimbusGuard** (a cloud cost and security tool). It only exists so the demo has something
to sell. The knowledge documents, case studies (Fleetwise, Kaveri Finserv, Voxwell) and prices are invented.

## 2. The words we use

| Word | Meaning |
|---|---|
| **Campaign** | A sales program with its own target, prompts, channels, knowledge, approval rules, reps and results. Status: Draft, Live, Paused, Completed or Archived. |
| **Prospect** | One person at one company that a campaign is working on. |
| **Stage** | Where a prospect is: `discovered`, `researched`, `qualified`, `contacted`, `engaged`, `meeting`, `opportunity`, or `rejected`. |
| **Agent** | One specialised worker (ICP Fitment, Outreach Strategy, and so on). Each has a prompt. |
| **Engine** | *What* runs an agent's decision: Gemini (an LLM), or the rule engine (plain code). |
| **Judgment / matching** | Judgment needs an LLM ("is this person a good fit, and why?"). Matching is just comparing things with maths or rules ("how alike are these two texts?"). Matching is free. |
| **Decision Journal** | The log of every meaningful decision an agent made, with the evidence, the knowledge it used, the prompt version, and which engine decided. |
| **Approval** | A message or action waiting for a human to approve, edit or reject. |
| **Touch** | One message that went out to a prospect (the opening message counts as touch 1). |
| **Plan / sequence** | The Outreach Strategy agent's plan for a prospect: which channels, in what order, and how long to wait. |
| **Follow-up** | A later touch sent because the prospect stayed silent. |
| **Harness** | The exact prompt setup behind a decision: the agent's prompt version plus the campaign prompt version. Shown on every journal entry. |
| **Pin** | A campaign is *pinned* to one library version of each agent's prompt, so edits elsewhere cannot change it. |
| **Rep** | A human sales representative. Touches are sent *as* a rep. |
| **Grounding check** | A check that a draft only claims things the knowledge or the prospect's data supports. |
| **Simulated clock** | A fast clock used for follow-up waits, working hours and daily limits, because sending is simulated. |
| **Kill switch** | One switch that stops all autonomous activity for every campaign. |

## 3. The big picture

```
 Browser (React app, frontend/)
        │  HTTPS, JSON, signed-in session
        ▼
 Express API (backend/src/routes) ──► services/data.js  (every read and write a screen needs)
                                             │
                                             ▼
                                  In-memory state object  ◄──── saved after every change to
                                  (campaigns, prospects, …)       a JSON file, or one row in Postgres (Neon)
                                             ▲
                                             │ reads and writes the same state
 Scheduler (services/scheduler.js), ticks every 12 seconds, for each LIVE campaign, one campaign at a time:
    Lead Research → ICP Fitment → Outreach Strategy → Personalisation → Conversation → Follow-up
                    every decision goes through  agentEngine/index.js :
                        1. get the campaign's knowledge  (rag.js + embeddings.js)
                        2. build the campaign's prompt   (prompts.js)
                        3. try Gemini, else fall back to the rule engine   (agentEngine/*)
                        4. check the draft is grounded   (grounding.js)
                    then the scheduler applies the rules  (limits.js, reps.js, conflict.js, approvals)
                    and writes a Decision Journal entry.
```

Everything runs in **one Node process**: the API, the scheduler and the built web app. There is one copy of the state in memory.
That is simple and fast, and it is why you must not run two copies against the same data (see section 20).

## 4. A prospect's journey, step by step

All of this is in `backend/src/services/scheduler.js`. Each step is a function called once per tick per Live campaign.

1. **Lead Research** (`runLeadResearch`). Creates new *synthetic* prospects (fake but realistic, biased to fit the campaign's
   target) using `prospectGenerator.js`, and bumps the funnel counters so the dashboard looks like a busy campaign. There is no
   real discovery yet. Stage: `researched`.
2. **ICP Fitment** (`runIcpFitment`). Scores each researched prospect 0 to 100 against the campaign's ideal customer profile and
   decides Qualified or Rejected. First a cheap rule check runs: a clearly poor fit with no buying signal is rejected *without*
   an LLM call. Everyone else goes to the engine chain. Stage becomes `qualified` or `rejected`.
3. **Outreach Strategy** (`runStrategy`). For each qualified prospect, plans the touches: for example `email → linkedin → email`,
   with a wait between them. It only uses channels that are switched on right now, and no more touches than the campaign allows.
4. **Personalisation** (`runPersonalisation`). Writes the opening message for the first channel in the plan, using the
   campaign's knowledge. Before writing, it checks the hard limits. After writing, the **grounding check** runs. Then either the
   draft goes to the **Approvals queue** (a human decides) or, if the campaign's approval level allows and the check passed, it
   is sent automatically. Sending is recorded by `recordTouch` (`outreach.js`). Stage becomes `contacted`.
5. **Conversation** (`runConversation`). Replies are **simulated** for now: each tick, a contacted prospect who has not replied
   has a small chance (`SIM_REPLY_CHANCE`) of replying. A clear opt-out, hostile message or out-of-office is handled by the
   **reply router** with no LLM (opt-outs go on the global suppression list). Anything else goes to the Conversation agent,
   which decides: `meeting`, `escalate` (a human must answer) or `followup`, and drafts the reply.
6. **Follow-up** (`runFollowUp`). For contacted prospects who have not replied and whose wait is over, the Follow-up agent writes
   the next touch on the next channel in the plan. It stops when a prospect replies, opts out, or reaches the touch limit, and
   records why.

Funnel counters, the prospect's `stage`, the Decision Journal and the activity feed are updated as this happens. Nothing
leaves the server: sends and replies are simulated (section 21).

## 5. The agents

| Agent | Job | Decided by | Where its instructions live |
|---|---|---|---|
| **Lead Research & Enrichment** | Finds and enriches prospects | Synthetic generator plus rules (not an LLM yet) | `prospectGenerator.js`, `agentEngine/ruleEngine.js` `ruleEnrich` |
| **ICP Fitment** | Qualify or reject | Rule shortcut for clear rejections; otherwise Gemini; rule engine as fallback | Fixed rules: `geminiEngine.js` `ICP_SYSTEM`. Editable prompt: seed in `db/seed.js` |
| **Outreach Strategy** | Plan channels, order and waits | Gemini, rule fallback | `STRATEGY_SYSTEM` in `geminiEngine.js`; `ruleStrategy` in `ruleEngine.js` |
| **Personalisation** | Write the opening message | Gemini, rule fallback | `PERSONALISATION_SYSTEM`; `ruleDraftOutreach` |
| **Conversation** | Decide what a reply needs, draft the answer | Reply router first (no LLM), then Gemini, rule fallback | `CONVERSATION_SYSTEM`; `ruleHandleConversation` |
| **Follow-up** | Write later touches | Gemini, rule fallback | `FOLLOWUP_SYSTEM`; `ruleFollowUp` |
| **Voice SDR** | Phone calls | **Not built** (listed in the UI only) | n/a |

Two layers of instructions: the **fixed system prompts** in `geminiEngine.js` hold the guardrails (never invent facts, output
shape, etc.); the **editable prompts** (Agents & Prompts screen, and per campaign) are versioned and can be changed by a manager
without touching code. The model receives both.

**Engines** (`backend/src/services/agentEngine/`):

- `geminiEngine.js`: Google Gemini with a strict JSON schema, retries, a list of models to fall back across when one's quota is
  used up, a request-rate throttle, and token and latency tracking.
- `ruleEngine.js`: the always-available fallback. Plain code that reads the same fields. It never fails and costs nothing.
- `dronahqEngine.js`: calls DronaHQ agents through their webhook. The webhook currently returns no output (see section 20), so
  this engine is off unless you put `dronahq` in `AGENT_ENGINE`.
- `llmEngine.js`: an older Anthropic (Claude) engine for three of the agents. Unused by default; it does not cover Strategy or
  Follow-up.
- `index.js`: the one place the rest of the app calls. It picks the engine chain from `AGENT_ENGINE` (for example `gemini`),
  tries each in order, and always ends with the rule engine, so a decision is always made. The result says which engine decided.

## 6. Rules that no agent can break

Agents *propose*; these rules *decide*. They are plain code, checked before an action:

1. **Kill switch** on: nothing runs.
2. **Campaign status**: only `live` campaigns run. Pausing one campaign only changes that campaign.
3. **Agent switch**: an agent runs in a campaign only if it is on for the platform *and* for that campaign.
4. **Channel switch**: a paused channel is never used; the Strategy agent cannot even choose it.
5. **Conflict and suppression** (`conflict.js`): a person contacted by another campaign in the last 14 days is not contacted;
   anyone on the global suppression list (an email, a whole domain, or `*@domain`) is never contacted, and this is re-checked
   before every follow-up.
6. **Hard limits** (`limits.js`): working hours, the campaign's daily limit, and a per-person contact-frequency cap across all
   campaigns. When they hold outreach back, no LLM call is made and one journal entry explains why.
7. **Reps** (`reps.js`): if a campaign has reps, a touch needs an available one (section 11).
8. **Grounding check** (`grounding.js`): a draft with an unsupported figure, a compliance claim the knowledge does not make, a
   quoted price or a specific meeting time is never auto-sent (section 10).
9. **Escalations always go to a human**, whatever the approval level.

## 7. Matching vs judgment, and keeping costs down

The core design idea: do not spend an LLM call on something a rule or a similarity check can settle. Where this is used:

- **Clear ICP rejections** are settled by a rule score with no LLM call (`agentEngine/index.js`). Qualifications always get an LLM.
- **Reply routing** (`replyRouter.js`): a reply is turned into a vector (`embeddings.js`) and compared to canonical examples in
  `backend/data/knowledge/reply-examples.json`. Clear opt-outs, hostile messages and out-of-office replies are handled directly.
  Ambiguous replies (a question, an objection, interest) go to the Conversation agent.
- **Knowledge retrieval** is also vector matching, free and local.
- **Daily LLM cap** (`LLM_DAILY_CALL_CAP`, `usage.js`): every request to the LLM is counted. Past the cap the rule engine
  decides, so a free quota cannot be burned dry.
- **Measurement**: `usage.js` tracks calls, tokens, latency and decisions made without an LLM, per agent and per campaign. The
  Command Center's "AI Efficiency" panel and the Compare screen show them, with estimated cost per prospect, per qualified
  lead and per conversation. Prices are estimates you set in `.env`.

## 8. Knowledge and retrieval

Each campaign has its own **knowledge sources**: either a document file (`backend/data/knowledge/<docId>.txt`) or text a manager
pasted or uploaded in the UI (stored inside the campaign as `content`). Before an agent decides or writes anything, `rag.js`:

1. splits the campaign's sources into paragraph-sized chunks (blank line = new chunk);
2. turns the chunks and the question into vectors (`embeddings.js`: the `bge-small-en-v1.5` model, run inside Node by the
   `fastembed` package, no API key; downloaded once, about 130 MB, into `backend/data/.embedding-cache`);
3. returns the most similar chunks. If the model cannot load, it falls back to keyword matching, so retrieval never fails.

Retrieval only ever searches the *current campaign's* sources, so knowledge cannot leak between campaigns. The names of the
sources used are written into the Decision Journal.

## 9. Prompts and versions

The rule: **a change to one campaign's prompts must never silently change another's.** Code: `services/prompts.js`.

- The **library** (`state.agents[].versions`) holds shared prompt templates for each agent, with one "default" version. Saving or
  activating a library version only changes what *new* campaigns start from.
- Each **campaign** is **pinned** to one library version per agent (`campaign.promptPins`). It also has its own **system
  prompt** (`campaign.systemPrompt`, versioned, with roll-back) and optional per-agent **overrides**.
- What an agent is actually given is built by `composePrompt`: the campaign system prompt, then the pinned agent prompt, plus the
  campaign's override. The label `v3.2 + campaign prompt v2` is written on every decision.
- Every change is logged on the campaign (`promptLog`) with who, what and when.
- UI: the Agents & Prompts screen manages the library and compares versions; the campaign page manages that campaign's pins,
  system prompt and overrides.

## 10. Approvals

Each campaign has an **approval level** plus three toggles (first outreach, meeting time, escalate on objections):

- **Manual**: every toggled action waits in the Approvals queue.
- **Assisted**: once the manager has approved a few of that action type (`autoAfterApproved`), a draft with a fit score of at
  least `autoMinScore` goes out on its own.
- **Autonomous**: first outreach and meetings are sent without waiting.

Always, at every level: an **escalated objection** needs a human, and a draft that **fails the grounding check** is queued with
the issues listed, not sent. Approving records the touch through `recordTouch`; rejecting an opening message sends it back for a
redraft; rejecting a follow-up stops that prospect's sequence. Code: `autoApproval` in `scheduler.js`, `decideApproval` in
`data.js`.

## 11. Representatives

A rep (`state.reps`) has channels, working hours, a daily limit and a status (`active` or `offboarded`). A campaign lists the
reps assigned to it (`campaign.repIds`). Every touch is recorded with the rep who sent it: the least-loaded assigned rep who is
active, works that channel, is inside their hours and under their limit; a prospect keeps the same rep across touches. If no
assigned rep can send, outreach is held with the reason. If a campaign has no reps assigned, it behaves as before.

**Offboarding** stops a rep at once, lists every campaign that used them, flags any campaign left with no active rep on the
dashboard, and an admin can **reassign** the rep's campaigns and prospects to someone else. Code: `reps.js`, `data.js`.

## 12. Sign-in

`backend/src/services/auth.js`. The login page asks for a name (default `JD`). If the server has `APP_ACCESS_CODE` set, it also
asks for the code, and the API refuses anyone without a valid session. A session is a signed, expiring token
(`AUTH_SECRET` signs it). The name is who approvals, pauses, prompt changes and the kill switch are recorded under.

If `APP_ACCESS_CODE` is **not** set, the API is open and the login only records a name. **Set it on any public deployment.**
This is a shared code with a display name, not separate accounts or roles.

## 13. The data: where it lives and its shape

**Where.** One JavaScript object, `state`, held in memory, saved after every change:

- default: a JSON file, `backend/data/state.json` (ignored by git, so each developer has their own);
- with `DATABASE_URL` set: one row in a Postgres table called `sdr_app_state` (used on hosts with no disk, such as free tiers).

Code: `backend/src/db/index.js` (load, save, `getState`, `withState`), `postgresAdapter.js` (the Postgres version).

**Shape.** Top-level keys of `state`:

| Key | What it holds |
|---|---|
| `version` | Schema version (see the migration rule below) |
| `seq` | A counter used to make ids |
| `killSwitch` | `{ active, at }` |
| `campaigns` | The campaigns (below) |
| `reps` | Representatives |
| `prospects` | Every prospect in every campaign (below) |
| `decisions` | The Decision Journal (newest first, capped at 500) |
| `events` | The activity feed (capped at 300) |
| `approvals` | Items waiting for or already decided by a human |
| `agents` | Agents, each with `versions` (the prompt library), `overrides`, and `enabled` |
| `channels` | Email, LinkedIn, SMS, voice: on or off platform-wide |
| `suppression` | The global do-not-contact list |
| `integrations` | The list shown in Settings (only Gemini and local embeddings show as connected) |

A **campaign** has: identity (`name`, `owner`, `status`, dates), targeting (`icpText`, `geography`, `personas`,
`companyCriteria`, `exclusionCriteria`), `channels`, `qualificationPrompt`, `dailyLimit`, `workingHours`, `cadence`
(`maxTouches`, `waitHours`), `approvals` (toggles plus `level`), `sources` (knowledge), `funnel` and `outreach` counters,
`outcomes` (reply split), `failures`, `promptPins`, `systemPrompt`, `promptLog`, `agentsEnabled`, `repIds`, and `copiedFrom`.

A **prospect** has: who (`name`, `title`, `company`, `email`, `industry`, `size`, `funding`, `tech`, `city`), `campaignId`, `stage`,
`fit` score and `qual` (the qualification decision), `history` and `conversation`, `plan`, `touches` (each with channel, time and
the rep), `nextTouchTs` (when the next follow-up is due), `repId`, and display fields (`lastAction`, `nextStep`).

A **decision** has: `kind`, `agent`, `harness`, `engine` (which engine decided), `headline`, `summary`, `evidence`, `retrieved`
(knowledge used), `instruction`, `finalAction`, and the campaign and prospect it is about.

### The migration rule (most important rule for developers)

Saved state from an older version must never be wiped. There are two ways the code handles a change:

- **Additive change** (a new field, a new agent): add it to `backend/src/db/seed.js` *and* to `backend/src/db/migrate.js`.
  `migrate` runs on every start, adds only what is missing, and never removes or overwrites anything. Existing campaigns keep
  everything. This is the normal way.
- **Breaking change** (renaming or removing something): bump `SCHEMA_VERSION` in `seed.js`. On start, an old state is copied to a
  backup (a `.backup-v…json` file, or a `backup-…` row in Postgres) and the app reseeds. Use sparingly, and warn everyone.

The frontend has no copy of this data; it only calls the API.

## 14. Backend map, file by file

`backend/` is Node (ES modules) with Express.

| File | Plain-words purpose |
|---|---|
| `src/server.js` | Starts the app: CORS, `/health`, the API under `/api`, serves the built web app, starts the scheduler. |
| `src/config.js` | Every setting, read from environment variables, each with a safe default. Start here to learn what can be tuned. |
| `src/routes/index.js` | The API endpoints. Thin: each one calls a function in `services/data.js`. |
| `src/middleware/errors.js` | Turns thrown errors into JSON `{ error }` responses. |
| `src/db/index.js` | Loads and saves the state; the only file the rest of the app uses to reach storage. |
| `src/db/seed.js` | The starting data (3 campaigns, reps, agents, prompts, prospects). `SCHEMA_VERSION` lives here. |
| `src/db/migrate.js` | Additive upgrades of saved state (section 13). |
| `src/db/postgresAdapter.js`, `pg.js` | Storing the state as one row in Postgres. |
| `src/services/data.js` | All the business logic behind the screens: reading views, creating and editing campaigns, approvals, prompts, reps, comparison, launch review. The biggest file. |
| `src/services/scheduler.js` | The autonomous loop and each pipeline stage (section 4). |
| `src/services/agentEngine/*` | Deciding: the engine chain, Gemini, rules, DronaHQ, Anthropic (section 5). |
| `src/services/prompts.js` | Prompt pins, campaign system prompt, composing what an agent is given. |
| `src/services/rag.js`, `embeddings.js` | Knowledge chunking and vector search (section 8). |
| `src/services/replyRouter.js` | Vector routing of clear-cut replies with no LLM. |
| `src/services/grounding.js` | The check that a draft only says supported things. |
| `src/services/limits.js`, `simTime.js` | Hard limits and the simulated clock. |
| `src/services/reps.js` | Choosing the rep for a touch, and offboarding helpers. |
| `src/services/outreach.js` | `recordTouch`: the one place a sent message is recorded. |
| `src/services/conflict.js` | The 14-day rule and the suppression list. |
| `src/services/usage.js` | LLM call counting, the daily cap, tokens, cost estimates. |
| `src/services/auth.js` | Sign-in, tokens, and "who did this". |
| `src/services/logic.js`, `constants.js` | Campaign lifecycle rules and shared constants (stage names, channel keys). |
| `src/services/prospectGenerator.js` | Creates the synthetic prospects (the free generator). |
| `src/services/prospects.js` | `newProspect`: the one factory for a prospect (people at organisations, free-form attributes, where they came from). |
| `src/services/dossier.js` | The shared Prospect Dossier: facts, hand-off notes, hooks and gaps. |
| `src/services/sdrSteps.js` | The SDR defined once: the pipeline steps in order, with purpose, reads and writes. The scheduler and the Blueprint screen both use it. |
| `src/services/meetings.js` | Offering real meeting times, reading the answer, booking, and the `.ics` invite. |
| `src/services/dev.js` | The Dev tab: judge sandbox, search playground, real-data tests, runtime view. |
| `src/services/performance.js` | Agent success rates by campaign and prompt version, and the campaign health verdict. |
| `src/services/knowledge.js` | The knowledge library across campaigns and the retrieval tester. |
| `src/utils/*` | Validation and formatting helpers. |
| `data/knowledge/` | The knowledge documents and `reply-examples.json`. |
| `eval/` | The golden set for ICP scoring and the runner. |
| `scripts/` | Helper scripts: `smoke.mjs`, `eval-icp.mjs`, `try-*.mjs`, `gemini-models.mjs`, `dronahq-probe.mjs`. |
| `test/` | The automated tests (section 17). |

There is also `matching-service/` at the repo root: a standalone Python service from earlier in the project. **It is not used by
the running app.** Its reply routing and retrieval were re-built inside the Node backend. It is kept as reference.

## 15. Frontend map

`frontend/` is React with Vite. There is no routing library: `App.jsx` keeps the current screen in memory and in
`sessionStorage`, and `NavContext` gives screens a `navigate(name, params)` function.

| Path | Purpose |
|---|---|
| `src/App.jsx` | Chooses the screen; shows the login page if there is no session. |
| `src/services/api.js` | **Every** call to the backend, one exported function each. Add new calls here. |
| `src/services/session.js`, `hooks/useSession.js` | The signed-in session. |
| `src/hooks/useApi.js` | Loads data and refreshes it after any write and every 30 seconds. |
| `src/screens/` | Login, CommandCenter (also used for the Campaigns list), CampaignDetail, CreateCampaign (also edits), Approvals, DecisionJournal, Prospects, ProspectDetail, AgentsPrompts, Knowledge, Reps, Compare (analytics), Dev, Settings. |
| `src/components/dev/` | The four Dev tabs: judge sandbox, search playground, real-data tests, runtime. |
| `src/components/analytics/` | Campaign health and per-agent success by prompt version. |
| `src/components/shell/` | Sidebar, top bar (with the kill switch), page frame. |
| `src/components/campaign/` | The panels on a campaign page: knowledge, prompts, agents, reps, activity, launch review, prompt diff. |
| `src/components/features/`, `ui/` | Reusable pieces: campaign cards, efficiency panel, tables, badges, modals, toggles. |
| `src/data/` | `constants.js` (channel names and labels) and `types.js` (JSDoc descriptions of the data shapes the API returns). |
| `src/utils/` | Formatting, validation, colours, the word-by-word diff. |

## 16. Configuration

All settings are environment variables read in `backend/src/config.js`. The full annotated list is in
`backend/.env.example`; the important ones are described in the root README. Three ideas to know:

- `AGENT_ENGINE` chooses who decides (`rule` by default; `gemini` for the LLM). The rule engine is always the last fallback.
- `LLM_DAILY_CALL_CAP` limits LLM calls per day. Once reached, everything continues on the rule engine.
- `SIM_MS_PER_HOUR` sets the simulated clock. `3000` means a simulated day lasts 72 real seconds, so a 72-hour follow-up wait
  passes in about 3.6 minutes. `3600000` is real time.

## 17. Testing

`cd backend && npm test` runs about 120 tests with Node's built-in runner (no extra tools). They use no real APIs and no network.

- Each test file uses its own throwaway data file and usage file (in the OS temp folder), so **tests never touch your real data**.
  Test files that do not set their own environment import `test/_setup.js` first for this reason. Keep that convention.
- The Gemini and DronaHQ tests use a fake local server that returns real response shapes.
- `scheduler.test.js` drives the real scheduler tick on a temporary state. `prompts.test.js`, `reps.test.js`, `campaigns.test.js`
  test the service layer directly. `goldenIcp.test.js` guards the rule engine's accuracy on the golden set.
- `node backend/scripts/eval-icp.mjs gemini` scores the *real* model on the golden set (about 16 requests of quota).
- `node backend/scripts/smoke.mjs <url>` checks a running deployment, including that pausing one campaign stops only that one.
- There are no browser tests. The frontend is checked by `npm run build` and by hand.

## 18. Running it and deploying it

Local: see the root README, sections 4 and 5. Deployed: it is **one service**: the backend also serves the built web app, so there
is one URL. The `Dockerfile` builds both. For a host with no persistent disk, store the data in Neon Postgres (`DATABASE_URL`).
A free host sleeps when idle, which stops the scheduler, so a free pinger is used to keep it awake. Full steps: README section 8.

## 19. Recipes: how to add things

**Add a field to campaigns.** Add it to the seed campaigns in `db/seed.js`; add a default in `db/migrate.js` (so old saved state
gets it); read or write it in `services/data.js` (`createCampaign`, `updateCampaign`, `formValues`); show it in the form
(`CreateCampaign.jsx`). Add a test.

**Add an API endpoint and a screen.** Write the function in `services/data.js`, add the route in `routes/index.js`, add the call
in `frontend/src/services/api.js`, then the screen or panel. Copy an existing pair such as `getReps` / `Reps.jsx`.

**Add an agent.** Add it to `agents` in `db/seed.js` (with a first prompt version) and in `db/migrate.js` (`insertAfter`). Write a
system prompt, a JSON schema and a function in `geminiEngine.js`; a rule fallback in `ruleEngine.js`; a function in
`agentEngine/index.js` that calls `withFallback`; a stage in `scheduler.js` and add it to the `STAGES` list. Campaigns pick up
its prompt pin automatically. Add tests with the fake Gemini server (see `agentPlans.test.js`).

**Add a channel.** Add its key to `CHANNEL_KEYS` in `services/constants.js`, add it to `channels` in the seed and migrate, and
handle it in `outreach.js` (`recordTouch` counters) and in `ruleStrategy`. A real integration is described in the roadmap.

**Add a knowledge document.** Put a `.txt` file in `backend/data/knowledge/` and add a source with its `docId` (the file name
without `.txt`) to the campaign in the seed, or paste it on the campaign page.

**Add a check to the grounding filter.** Edit `services/grounding.js` and add a case to `test/grounding.test.js`.

**Add a setting.** Read it in `config.js` with a safe default, document it in `backend/.env.example` and the README table.

## 20. Decisions and gotchas

- **One process, one copy of the state.** The scheduler and the API share memory. Do not run two copies against the same
  database or file: each keeps the whole state and the last one to save wins. To scale out, the roadmap has a job queue item.
- **The scheduler stops when the process sleeps.** On a free host use a pinger, or expect the autonomous loop to pause.
- **Everything that "sends" is simulated** (section 21).
- **Why one JSON row in Postgres.** The first version mapped the state to 13 tables, but it needed tables that were not in the
  repo, wiped them on every save, and missed newer fields. One row is complete and simple. A future version can go relational.
- **DronaHQ.** The UI was built in DronaHQ Studio. We also built and published agents on DronaHQ's agent platform and wrote an
  adapter that calls them through their webhook trigger. The webhook runs the agent and reports success but its `response` is
  always `null`, even for a brand-new trivial agent and in DronaHQ's own Test button. We asked DronaHQ and had no answer at the
  time of writing. Notes and the schemas we tried are in `docs/dronahq/`. Decisions therefore come from Gemini and the rule engine.
- **Gemini free-tier quota** is per Google project and per model, and resets daily. Two things protect you: a list of models in
  `GEMINI_MODEL`, and the daily cap. A second key from the *same* project does not add quota.
- **Windows.** The project was built on Windows; use forward slashes in imports and quote paths with spaces.
- **`SIM_MS_PER_HOUR` and tests.** Tests that depend on "today" set it to real time so a simulated day does not roll over mid-test.
- **The dashboard funnel numbers** (discovered, researched) are bumped randomly each tick to look like a busy campaign; named
  prospects are the real, traceable ones. Remove this when real discovery exists.

## 21. What is simulated and what is real

| Real | Simulated |
|---|---|
| Gemini decisions, strict JSON output, retries, quota fallback | Prospect discovery (an AI imitating a people search, or made-up companies) |
| Local embeddings, retrieval, reply routing | Sending email, LinkedIn or SMS (state changes only) |
| Campaign lifecycle, pause, agent and channel pause, kill switch | Replies (a fixed mix of sample messages) |
| Conflict, suppression, working hours, daily limits, reps | Calendar (a booked meeting is a record and an `.ics` file, not a live calendar entry) |
| Approvals, approval levels, grounding check | The `opportunity` stage (only seeded data reaches it) |
| Prompt versions, pins, roll-back, change log | Voice calls (not built) |
| Decision Journal, cost and token tracking, evaluation | |
| Sign-in, storage in JSON or Postgres, one-service deploy | |

## 22. How a campaign, a person and a meeting fit together

**Two kinds of campaign.** A campaign is either aimed at *an audience* (`mode: "bulk"`: the SDR finds people matching an ICP, judges who qualifies and works each) or at *one specific person* (`mode: "single"`: the person is entered by hand and becomes the campaign's only prospect; there is no ICP to score, so the ICP step qualifies them by policy). Both use the same pipeline.

**Where prospects come from.** `sourcing: "simulated-search"` asks Gemini to act as a people-search tool and return realistic *fictional* people for any audience (student leaders, founders, anyone); `"synthetic"` is the free made-up-company generator. Both are clearly marked as simulated on each prospect (`source: { provider, real, note }`). A real provider only has to return the same candidate shape (see `normalizeCandidates` in `geminiEngine.js`) and be called from `runDiscovery` in `scheduler.js`.

**One shared memory.** Every agent reads the whole dossier (`dossierFor`) and leaves a hand-off note (`addNote`). The note also records the prompt version the agent ran with (its *harness*, for example `v1.2 + campaign prompt v3`), which is how `performance.js` can say which prompt handled which prospect.

**Meetings.** On an interested reply, `processReply` (`scheduler.js`) asks `proposeSlots` for up to three free times on different weekdays inside the rep's hours, offers exactly those, and reads the answer with `resolveMeetingReply` (Gemini, with a rule fallback, `readReplyRule`). A pick books the slot (`bookMeeting`), a decline closes it, and a counter-offer gets other times once before a human is asked. If the campaign requires approval for meeting times, the times wait in the Approvals queue first. The invite is built by `buildIcs` and downloaded from `/api/prospects/:id/meeting.ics`.

**Sandboxes.** A Dev-tab test run is a real campaign with `sandbox: true`, one prospect flagged `sandboxHuman` (so the simulated reply generator never answers for the person), and it ignores the simulated clock's working hours because a person is testing in real time. Sandboxes are filtered out of the dashboard, approvals, journal and comparisons by `isSandbox` in `data.js`.

**Measuring prompts.** `performance.js` defines what success means for each agent (for example: personalisation succeeds when the opening message gets a reply; conversation when a reply ends in a meeting) and splits it by campaign, agent prompt version and campaign prompt version. `health()` turns a campaign's numbers into a verdict (`new`, `healthy`, `watch`, `struggling`) with reasons and a suggestion. Small samples move a lot, so the screen says so. Saving a campaign prompt requires a message; `inspectPrompt` rebuilds the prompt an agent ran with from a harness label (library and campaign prompt versions are never overwritten; a campaign's extra instruction is shown as it is today).

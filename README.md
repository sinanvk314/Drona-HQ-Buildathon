# Autonomous SDR — control plane + agent intelligence layer

Built for the 51-hour Inter Guild Buildathon (Tech Contingent IIT Madras × DronaHQ).

An autonomous, multi-channel SDR system in two halves that work as one product:

- **Control plane** (React UI + Node API): a human creates, launches, pauses and monitors several
  concurrent campaigns, approves what agents want to send, edits prompts, and can stop everything
  with a global kill switch.
- **Intelligence layer** (agents + retrieval + matching): agents research, qualify, personalise,
  contact and follow up with prospects inside those campaigns, grounded in each campaign's own
  knowledge base, with every decision written to a Decision Journal.

## Contents

1. [How it works](#1-how-it-works)
2. [Repository layout](#2-repository-layout)
3. [What you need installed](#3-what-you-need-installed)
4. [Run it locally](#4-run-it-locally)
5. [Set up the Gemini API key](#5-set-up-the-gemini-api-key)
6. [Environment variables](#6-environment-variables)
7. [Avoiding Gemini quota problems](#7-avoiding-gemini-quota-problems)
8. [Deploy it (live URL)](#8-deploy-it-live-url)
9. [Data, and working as a team](#9-data-and-working-as-a-team)
10. [Tests and helper scripts](#10-tests-and-helper-scripts)
11. [What works, what is simulated, known limitations](#11-what-works-what-is-simulated-known-limitations)

---

## 1. How it works

```
 Browser  ──►  React + Vite UI (frontend/)  ──►  REST API (backend/src/routes)
                                                       │
                                            services/data.js  (campaigns, approvals, prompts, controls)
                                                       │
   scheduler.js ──── every 12s, for each LIVE campaign ────┐
   (autonomous loop)                                       ▼
        gates: kill switch → campaign live → agent enabled → channel enabled → conflict/suppression
                                                       │
     Lead Research → ICP Fitment → Personalisation → Approvals queue (human) → Conversation
                          │               │                                          │
                 agentEngine/index.js: retrieve knowledge first (rag.js), then decide
                          │
        engine chain  ──►  gemini  →  (dronahq / anthropic, optional)  →  rule engine (always last)
```

**Matching vs judgment.** Every decision is one of two kinds, and only one needs an LLM:

| Kind | Question | Handled by | Cost |
|---|---|---|---|
| Matching | How alike are two things? | Local embeddings + rules | Free, no API key |
| Judgment | Given evidence, what is the right call, and why? | An LLM (Gemini by default) | One API call |

What that means in the running system:

- Clear-cut ICP rejections are settled by the rule engine, with no LLM call. Qualifications always get the LLM's read.
- Replies that are clearly an unsubscribe, hostile, or an out-of-office auto-reply are routed by embedding
  similarity to canonical examples (`backend/data/knowledge/reply-examples.json`). Opt-outs go on the global
  suppression list. Anything ambiguous (an objection, a question, interest) goes to the Conversation Agent.
- Knowledge retrieval is semantic (bge-small embeddings, run in-process) and searches only the campaign's own sources.
- A daily cap on LLM calls (`LLM_DAILY_CALL_CAP`) makes the rule engine take over, so a demo cannot burn the quota.
- The Command Center's **AI Efficiency** panel shows calls made, decisions with no LLM call, and estimated saving.

**Approval levels** (per campaign): *Manual* (every toggled action waits in the Approvals queue), *Assisted*
(auto-approves at a chosen fit score after you have approved a few of that action yourself) and *Autonomous*.
An escalated objection always needs a human, at every level.

**Campaign isolation.** Each campaign has its own ICP, prompts, channels, knowledge sources, approval policy and
status. Pausing one only changes that campaign's record; the others keep running. A cross-campaign conflict check
blocks contacting the same person from two campaigns within 14 days, and the suppression list is global.

## 2. Repository layout

```
frontend/            React + Vite control-plane UI (built in DronaHQ Studio, then extended)
  src/screens/         Command Center, Campaign detail, Create campaign, Approvals, Decision Journal,
                       Prospects, Agents & Prompts, Settings
  src/components/      shell, ui primitives, campaign (knowledge panel, approval level), features
  src/services/api.js  every call to the backend, in one file
backend/             Node + Express API and the autonomous scheduler
  src/routes/          REST routes (thin wrappers)
  src/services/        data.js (business logic), scheduler.js, rag.js, embeddings.js, replyRouter.js,
                       usage.js (cost cap + counters), conflict.js, agentEngine/ (gemini, dronahq,
                       anthropic, rule)
  src/db/              datastore: local JSON file by default, optional Postgres; seed data
  data/knowledge/      knowledge base documents, per campaign, plus reply-examples.json
  scripts/             try-icp.mjs, try-agents.mjs, gemini-models.mjs
  test/                node:test suites
matching-service/    REFERENCE CODE, not used by the running app. A standalone Python/FastAPI service (triage, contact
                     match, reply classify) plus a Python orchestrator. Its reply routing and embedding retrieval now
                     run inside the Node backend; the rest is kept as a tested reference for sourcing at scale.
docs/dronahq/        The DronaHQ ICP agent's instructions and the response schemas we tried against its webhook
```

Detailed per-folder notes and the API table are in [`backend/README.md`](backend/README.md).

## 3. What you need installed

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 or newer (tested on 24) | runs the backend and the frontend build |
| npm | comes with Node | installs packages |
| Git | any recent | clone and push |
| Internet, first run only | about 130 MB | downloads the embedding model once; it is cached and works offline afterwards |

Python is **not** needed to run the app. It is only for the optional `matching-service/`.

## 4. Run it locally

Use two terminal windows (Command Prompt, PowerShell, or any shell). Replace the path with wherever you cloned it.

**Window 1: backend**
```
cd Drona-HQ-Buildathon/backend
npm install
copy .env.example .env        (macOS/Linux: cp .env.example .env)
npm start
```
It listens on http://localhost:8080. Check http://localhost:8080/health — you should see `"ok":true`.
With no key set it runs entirely on the rule engine, which needs no setup.

**Window 2: frontend**
```
cd Drona-HQ-Buildathon/frontend
npm install
npm run dev
```
Open http://localhost:5173. The frontend talks to `http://localhost:8080/api` by default; to point it elsewhere
create `frontend/.env` containing `VITE_API_BASE_URL=http://your-backend/api`.

The first backend start seeds three campaigns (US SaaS CTO, India BFSI CIO, AI Startup Founders) and the
scheduler starts advancing the Live ones. Press `Ctrl+C` in a window to stop it.

## 5. Set up the Gemini API key

Gemini makes the agents' decisions when configured. The free tier is enough for a demo.

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it.
3. Open `backend/.env` (created in step 4) and set these two lines:
   ```
   AGENT_ENGINE=gemini
   GEMINI_API_KEY=paste-your-key-here
   ```
4. Restart the backend. Check http://localhost:8080/health: `agentEngine` should read `gemini > rule` and
   `geminiKeyConfigured` should be `true`.
5. Confirm which models your key can use (Google retires models often, so a default can start returning "404"):
   ```
   cd backend
   node scripts/gemini-models.mjs
   ```
   Put a current Flash model in `GEMINI_MODEL` (comma-separate several, first choice first).
6. Optional smoke tests that call Gemini for real: `node scripts/try-icp.mjs gemini` and `node scripts/try-agents.mjs`.

Rules for the key:
- It goes **only** in `backend/.env`, which is gitignored. Never put it in chat, in code, or in a commit.
- If a key is ever pasted somewhere public, delete it in AI Studio and create a new one.
- On the free tier Google may use prompts to improve its products, and the demo prompts are synthetic. Do not send real customer data.
- If the key is missing or Gemini fails, the backend keeps working on the rule engine; you just lose the LLM reasoning.

## 6. Environment variables

All go in `backend/.env`. Every one has a working default. See `backend/.env.example` for the full annotated list.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | API port (hosting platforms set this for you) |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated frontend URLs allowed to call the API. **Set to your deployed frontend URL.** |
| `AGENT_ENGINE` | `rule` | `rule`, `gemini`, `llm` (Anthropic), `dronahq`, or a chain such as `gemini` (rule is always the last fallback) |
| `GEMINI_API_KEY` | empty | Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite,gemini-3.6-flash` | Models tried in order; quotas are per model |
| `GEMINI_RPM` | `12` | Client-side requests-per-minute throttle |
| `LLM_DAILY_CALL_CAP` | `300` | Max LLM requests per day, retries included. Past it the rule engine decides. `0` disables. |
| `ICP_SHORTCUT_MARGIN` | `20` | Clear ICP rejections this far below threshold skip the LLM. `0` = always ask the LLM. |
| `REPLY_ROUTING` | `on` | Route opt-out / hostile / out-of-office replies by embeddings. `off` disables. |
| `SCHEDULER_INTERVAL_MS` | `12000` | How often the autonomous loop ticks |
| `SCHEDULER_BATCH_SIZE` | `3` | Prospects advanced per campaign per tick |
| `DATA_FILE` | `./data/state.json` | Where the JSON datastore lives (point at a persistent disk when deploying) |
| `USAGE_FILE` | `./data/usage.json` | Where the LLM call counters live |
| `EMBEDDING_CACHE_DIR` | `./data/.embedding-cache` | Where the embedding model is cached |
| `DATABASE_URL` | empty | Postgres (Neon) connection string. If set, the state is stored there instead of the JSON file (section 9) |
| `EMBEDDINGS` | `on` | `off` never loads the embedding model (saves ~300MB RAM on small hosts) |
| `ANTHROPIC_API_KEY` | empty | Only if `AGENT_ENGINE` includes `llm` |
| `DRONAHQ_*` | empty | Only if `AGENT_ENGINE` includes `dronahq` (see `backend/.env.example`) |

Frontend: `VITE_API_BASE_URL` (set at **build** time) is optional. Unset, a production build calls the same origin's `/api`, and `npm run dev` calls `http://localhost:8080/api`.

## 7. Avoiding Gemini quota problems

- Stop the backend, or pause every campaign / use the kill switch, when you are not demoing. An idle Live campaign still ticks.
- Use `SCHEDULER_INTERVAL_MS=30000` and `SCHEDULER_BATCH_SIZE=1` while developing.
- Develop with `AGENT_ENGINE=rule` (no calls at all) and switch to `gemini` shortly before a demo.
- Keep `LLM_DAILY_CALL_CAP` set. The dashboard's AI Efficiency panel shows how much of it is used.
- List two or more models in `GEMINI_MODEL`: free-tier quotas are per model, so the second keeps you running.
- Quotas are per Google project, so a second key from the same project does not add capacity.
- If you need more headroom, enable billing in AI Studio. The lite models are inexpensive.

## 8. Deploy it (live URL)

The submission needs a URL judges can open. The backend can serve the built UI itself, so this is **one service
with one URL**: no CORS setup, no separate frontend site, no build-time API URL. It must be a host that keeps a Node
process running, because the autonomous scheduler runs inside it.

### Option A: Docker (works on Render, Railway, Fly.io, a VPS)

The root `Dockerfile` builds the UI, installs the backend and starts everything on port 8080.

1. Push the repo to GitHub.
2. Create a new **Web Service** from the repo on your host, using the Dockerfile at the repo root.
3. Attach a **persistent volume/disk mounted at `/data`** (datastore, usage counters and the embedding-model cache
   live there; without it, campaigns reset on every restart).
4. Set the environment variables:
   ```
   AGENT_ENGINE=gemini
   GEMINI_API_KEY=your key
   LLM_DAILY_CALL_CAP=300
   ```
   (`PORT` is usually provided by the host; the container listens on 8080 by default.)
5. Deploy, then open `https://your-service/health` (expect `"ok":true`) and `https://your-service/` (the app).

### Option B: no Docker (any host with a Node build step)

- Build command: `npm --prefix frontend install && npm --prefix frontend run build && npm --prefix backend install`
- Start command: `npm --prefix backend start`
- Same environment variables. If the host has a persistent disk, mount it and set `DATA_FILE`, `USAGE_FILE` and
  `EMBEDDING_CACHE_DIR` to paths on it.

### Zero-cost setup (Render free + Neon free + UptimeRobot free)

Free hosts have no persistent disk and sleep when idle, so this path uses a free Postgres for storage and a free pinger.

1. **Neon** (neon.tech): create a **new project** just for this app (not a database used by anything else). Copy its
   connection string (it starts with `postgresql://`). The app creates one table, `sdr_app_state`, by itself.
2. **Render** (render.com): New → Web Service → your repo → language **Docker** → instance type **Free**. Skip the disk.
   Environment variables:
   ```
   DATABASE_URL=<the Neon connection string>
   AGENT_ENGINE=gemini
   GEMINI_API_KEY=<your key>
   LLM_DAILY_CALL_CAP=300
   EMBEDDINGS=off        # free instances have ~512MB RAM; remove this line if the model loads fine
   ```
3. Open `https://<name>.onrender.com/health`. The log should say `Datastore: Postgres (Neon)`.
4. **UptimeRobot** (uptimerobot.com): add an HTTP(s) monitor for `https://<name>.onrender.com/health`, every 5 minutes.
   This keeps the free service awake so the scheduler keeps running.

With `EMBEDDINGS=off`, retrieval uses keyword search and every reply goes to the Conversation Agent (reply routing is
the part that needs the model). If the free instance has enough memory, leave `EMBEDDINGS` unset.

### Things to get right
- **It must not sleep.** Some free tiers stop an idle service, which also stops the scheduler. Use a plan that stays
  awake, or open the app just before the demo.
- **Keep the data across restarts.** Hosts with an ephemeral disk lose `state.json` on every redeploy and the app
  reseeds. Use a persistent volume (above), or Neon Postgres (the zero-cost setup above).
- **Memory.** The embedding model needs a few hundred MB of RAM. If it cannot load, the app still runs: retrieval falls
  back to keyword search and reply routing hands everything to the agent. The first request that needs it downloads
  about 130 MB, so warm it up before the demo (start a campaign once).
- **No login.** The API has no authentication, so anyone with the URL can operate the campaigns. Share the URL only
  with judges and teammates.
- **Separate frontend host (optional).** If you prefer one, build the frontend with
  `VITE_API_BASE_URL=https://your-backend/api` and add its URL to `ALLOWED_ORIGINS` on the backend.

### Checklist before the demo
- `/health` shows `agentEngine` as `gemini > rule` and `geminiKeyConfigured: true`.
- Command Center loads, three campaigns are visible, and pausing one leaves the others running.
- Keep one campaign in each state (Live, Paused, Draft) to show the lifecycle.
- Note the Docker path has not been run on a real host by the authors; the Node path (build, then start) was tested
  locally against the built UI.

## 9. Data, and working as a team

The datastore is `backend/data/state.json`, created on first start. It is gitignored, so **every person who
clones the repo gets their own separate, freshly seeded copy**. Campaigns, prospects and approvals on one machine
never appear on another, and there is nothing to merge. `data/usage.json` (LLM call counters) and
`data/.embedding-cache/` are local too.

To reset to the seed data, delete `backend/data/state.json` and restart. **This deletes every campaign you created.**

**Postgres (Neon) is optional.** The JSON file is the default and is fine for one server with a persistent disk. Set
`DATABASE_URL` when the host has no persistent disk (most free tiers). The whole state is then stored as one JSON row in a
table called `sdr_app_state`, created automatically; nothing else in that database is touched, so use a database that is
only for this app. Do not point two running copies at the same `DATABASE_URL`: each keeps the state in memory and
overwrites the row, so the last writer wins.

**Schema changes never delete your campaigns.** If the saved state came from an older seed schema, it is copied to a backup
(a `state.backup-v<N>-<time>.json` file next to the JSON file, or a `backup-...` row in `sdr_app_state`) before the app
reseeds.

## 10. Tests and helper scripts

```
cd backend
npm test                       # unit tests (the first run downloads the embedding model)
                               # note: the Postgres store is tested against an in-memory fake, not a live Neon database
node scripts/gemini-models.mjs # which Gemini models your key can use
node scripts/try-icp.mjs       # ICP scoring on 4 sample prospects (add "gemini" to use the real model)
node scripts/try-agents.mjs    # personalisation + conversation samples
```

## 11. What works, what is simulated, known limitations

**Works end to end**
- Multiple concurrent campaigns with independent Live / Paused / Draft state, dashboards and decision history.
- Pause a campaign, pause an agent, pause a channel, or the global kill switch. Each stops exactly its own scope.
- Autonomous loop: research → ICP fit → personalisation → approvals queue → conversation, gated at every step.
- Per-campaign knowledge base with add/remove in the UI, semantic retrieval before every decision, and the retrieved sources shown in the Decision Journal.
- Prompt versioning per agent (save, activate an older version), with the active version recorded on each decision.
- Approval levels, cross-campaign conflict detection, a global suppression list, cost cap and an efficiency panel.
- Failure handling: bad or empty model output, HTTP errors and quota exhaustion fall back to the rule engine without stopping the loop.

**Simulated (no real network calls)**
- Prospect discovery generates synthetic companies (stand-in for Apollo).
- Sending email / LinkedIn / SMS and receiving replies change state only; replies are generated from a fixed mix of
  sample messages. Meeting booking is a state change, not a calendar invite.
- Voice SDR agent and follow-up cadence are not built. Follow-up and escalation draft text is templated, not generated.

**DronaHQ.** The control-plane UI was built in DronaHQ Studio. The backend also contains an adapter for DronaHQ agents
called through their Webhook Triggers (`AGENT_ENGINE=dronahq`). In our testing the webhook reply did not carry the
agent's output (the run trace showed it, the HTTP response did not), so agent decisions currently run on Gemini and the
rule engine instead.

**Other limitations**
- No authentication or user accounts; the "JD" user is hard-coded.
- Prompt compare and one-click rollback are stubs (activating an older version works).
- `dailyLimit` and `workingHours` are stored and shown but not enforced by the scheduler.

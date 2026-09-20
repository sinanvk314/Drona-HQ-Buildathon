# Autonomous SDR: project report

**Inter Guild Buildathon 2026 · Tech Contingent, IIT Madras × DronaHQ**

| | |
|---|---|
| **Live application** | https://drona-hq-buildathon.onrender.com/ |
| **Repository** | https://github.com/sinanvk314/Drona-HQ-Buildathon |
| **Team** | Shubh Gupta (control-plane UI and the first backend), Mohammed Sinan (agents and prompts, knowledge and retrieval, matching and cost control, real channels, measurement, deployment), with product planning and wireframes by a third teammate |
| **Build window** | 51 hours, Fri 18 Sep 2026, 9:00 PM to Sun 20 Sep 2026, 11:59 PM |

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [How this report maps to the judging rubric](#2-how-this-report-maps-to-the-judging-rubric)
3. [Problem and approach](#3-problem-and-approach)
4. [System architecture](#4-system-architecture)
5. [Control plane: every requirement in Section 3 of the brief](#5-control-plane-every-requirement-in-section-3-of-the-brief)
6. [Intelligence layer: every requirement in Section 4 of the brief](#6-intelligence-layer-every-requirement-in-section-4-of-the-brief)
7. [How DronaHQ is used](#7-how-dronahq-is-used)
8. [Beyond the brief: the extras we built](#8-beyond-the-brief-the-extras-we-built)
9. [One SDR across channels](#9-one-sdr-across-channels)
10. [Context and personalisation without hallucination](#10-context-and-personalisation-without-hallucination)
11. [End-to-end SDR capability](#11-end-to-end-sdr-capability)
12. [Product and user experience](#12-product-and-user-experience)
13. [Engineering quality](#13-engineering-quality)
14. [Measurement and optimisation](#14-measurement-and-optimisation)
15. [Cost and performance](#15-cost-and-performance)
16. [What works, what is partial, what was skipped](#16-what-works-what-is-partial-what-was-skipped)
17. [Known limitations and trade-offs](#17-known-limitations-and-trade-offs)
18. [How a judge can verify every claim](#18-how-a-judge-can-verify-every-claim)
19. [Team, process and timeline](#19-team-process-and-timeline)
20. [Appendices](#20-appendices)

---

## 1. Executive summary

We built **one autonomous SDR system in two halves that behave as one product**: a **control plane** where a human manager creates, launches, pauses and monitors several concurrent campaigns, and an **intelligence layer** of agents that discover, research, qualify, personalise, contact, follow up with and respond to prospects inside those campaigns. It is deployed as a single live service (one URL) and the code is a single repository.

Three ideas run through everything:

1. **Matching versus judgment.** Every decision is either *matching* ("how alike are two things?", settled by local embeddings and rules, free) or *judgment* ("given the evidence, what is the right call and why?", which needs an LLM). Only judgments spend model calls. This is our answer to cost, and to correctness: a hard rule such as "50 to 500 employees" or an opt-out must never be blurred into a similarity score.
2. **One SDR, not seven bots.** Every agent reads the same **Prospect Dossier** before acting and writes a plain-language **hand-off note** after acting, so the system behaves like a single salesperson who remembers everything.
3. **The manager is always in control, and the system is honest.** Pause at four levels, approval levels that decide when a human must approve, hard limits no agent can override, and a clear separation between what is *real* and what is *simulated* on every screen.

**By the numbers (from the repository at submission):**

| | |
|---|---|
| Commits | 60, on one shared `main` |
| Backend source | about 7,300 lines of Node, in `services/`, `routes/`, `db/`, `middleware/` |
| Frontend source | about 6,000 lines of React, 14 screens |
| Automated tests | **187 tests in 21 files**, all passing, plus 13 Python tests for the standalone matching service |
| API | 79 endpoints |
| Agents | 8 (Lead Research, Research, ICP Fitment, Outreach Strategy, Personalisation, Conversation, Follow-up, Voice SDR), each with versioned prompts |
| Documentation | README, a 23-section system guide, a roadmap, a demo script (about 15,000 words) |
| LLM spending | a hard daily cap on model calls, per-campaign token and cost accounting, and a live efficiency panel; the free Gemini tier means near-zero marginal cost |

**What is fully working:** three concurrent campaigns with independent state; campaign, agent, channel and global pause; the full autonomous loop from discovery to a booked meeting; prompt versioning with the active version recorded on every decision; per-campaign RAG; approval levels; conflict and suppression handling; real email through the Gmail API with human approval; measurement of every agent by prompt version; and a **judge sandbox** where a real person plays the prospect and the SDR has to earn a meeting.

**What is partial or skipped, stated plainly:** discovery uses an AI-imitated people search (simulated) or hand-entered real contacts, not Apollo; LinkedIn is simulated; SMS and voice are built and tested against fake Twilio servers but were not run against live Twilio; the DronaHQ agent path exists but the platform's webhook returned no output to our backend in our tests, so decisions run on Gemini with a deterministic rule engine as the safety net. Section 16 gives the full table.

---

## 2. How this report maps to the judging rubric

The brief scores eight categories. This table says where each one is answered and what the strongest evidence is.

| Category (points) | What it asks | Where in this report | Strongest evidence |
|---|---|---|---|
| **Multi-Channel SDR Intelligence (25)** | Does it coordinate LinkedIn, email, SMS and voice like one SDR rather than five bots? | §9, §8 (extras E5, E12, E13) | A per-prospect plan chosen by the Strategy agent, one shared dossier, one cadence policy with hard limits, real Gmail and Twilio adapters behind one `dispatch` function |
| **DronaHQ Usage (15)** | Is DronaHQ meaningfully core, not a UI wrapper? | §7 | Control-plane UI started in DronaHQ Studio; agents designed, instructed, given knowledge and variables, published and tested on the Agentic AI platform; a tested adapter; an honest account of the platform limit we hit |
| **Context and Personalisation (15)** | Do agents understand the prospect before acting, without hallucinating? | §10, §8 (E4, E5, E6) | Dossier, Research agent that never invents, grounding check on every draft, retrieval before every important decision |
| **End-to-End SDR Capability (15)** | Find, research, qualify, contact, follow up, respond, book or escalate: how much really works? | §11 | The judge sandbox: a real person replies, the SDR proposes real times, books one, and produces a calendar invite |
| **Product and User Experience (10)** | Could a real sales team pick it up? | §12 | 14 screens, launch review, approval queue, decision journal, agents and prompts editor, knowledge library |
| **Software and Engineering Quality (10)** | Architecture, modularity, reliability, error handling, security | §13 | 187 tests, failure containment per stage, signed webhooks, secrets out of Git, additive migrations with backups |
| **Measurement and Optimisation (5)** | Can you measure and improve the system's own performance? | §14, §15 | Success rate of every agent by campaign and prompt version, campaign health with suggestions, cost per prospect and per qualified lead, golden-set evaluation |
| **Innovation / Extra Thinking (5)** | Ideas beyond the obvious | §8 | Twenty-plus extras, led by the LLM-as-search-tool, the judge sandbox and the real/simulated switch |

---

## 3. Problem and approach

### 3.1 The problem as we read it

Sales development is manual, repetitive and inconsistent: reps research prospects, personalise outreach, chase replies across four channels and log everything by hand. The brief asks for a system where AI agents do this autonomously while a human manager stays fully in control, and it says one question will keep coming back: *"How close is this to a real SDR working autonomously across multiple channels?"*

We turned that into four questions we could test ourselves against:

1. **Can a manager understand and stop everything, quickly?** (control plane)
2. **Does each agent know the prospect before it acts, and can it explain why?** (context, evidence, journal)
3. **Does it keep going when things fail, and stay affordable?** (reliability, cost)
4. **Does the loop close?** A prospect is found, researched, qualified, contacted, replies, and a meeting is booked, with a human only where a human should be.

### 3.2 Design principles

| Principle | What it means in the product | Why we chose it |
|---|---|---|
| **Matching before judgment** | Embeddings and rules answer "how alike?" and "does this hard rule apply?"; the LLM answers "what is the right call, given evidence?" | Cost, speed, and correctness: numeric thresholds do not survive being turned into an embedding |
| **One SDR, one memory** | A shared dossier read by every agent, a hand-off note written by every agent | Prevents five disconnected bots stapling reports together, which the brief warns about |
| **Humans decide what matters** | Approval levels, escalation that always needs a human, four levels of pause, a global kill switch | The brief's core requirement, and what makes a real team trust it |
| **Nothing is hidden** | Every decision records the agent, prompt version, evidence, retrieved sources and which engine decided; every fallback says why | Managers must be able to answer "why did the agent do that?" |
| **Fail soft, never fail silent** | Malformed model output, quota exhaustion and outages end in a deterministic decision or a visible hold, and the reason is recorded | The brief: "handle malformed model output, failed API calls and empty states without crashing" |
| **Honest about real versus simulated** | Every prospect says where it came from; every message says whether it was really sent | A demo that quietly fakes things cannot be trusted; a judge can check every claim on the live site |

### 3.3 What we did first, and what changed

- **Hour 0 to 6:** decided the matching/judgment split, defined the shared JSON output contract every agent uses, and built and tested a standalone Python matching service (three endpoints: rank candidate companies against an ICP, pick the best contact, classify replies) with 13 tests. The first embedding provider was OpenAI; with no budget for API billing we moved to **fastembed with `BAAI/bge-small-en-v1.5`**, which runs on the CPU in-process and needs no key and no billing.
- **In parallel:** the control-plane UI and a first backend were built by Shubh (a DronaHQ Studio app talking to a Node API with a scheduler that advances prospects on its own).
- **Integration:** the matching logic was re-implemented inside the Node backend (one process, one deployment, no cross-service latency), the agents were given a common engine interface, and a chain of engines (DronaHQ, Gemini, rules) was added.
- **Hardening:** grounding, hard limits, reps, approvals, prompt versioning, sign-in and deployment, then the intelligence and measurement extras, then real channels.

The standalone Python service is kept in the repository as tested reference code; the running application does not call it (Section 17 explains that trade-off).

---

## 4. System architecture

### 4.1 The picture

```
                                   MANAGER'S BROWSER
                                          |
                    +---------------------v----------------------+
                    |   React + Vite control plane (14 screens)   |
                    |  Command Center · Campaigns · Prospects ·   |
                    |  Approvals · Decision Journal · Agents &    |
                    |  Prompts · Knowledge · Representatives ·    |
                    |  Compare/Analytics · Dev · Settings         |
                    +---------------------+----------------------+
                                          | REST (79 endpoints, signed session)
    TWILIO (SMS, voice) ---signed---+     |
    webhooks                        v     v
                    +------------------------------------------------+
                    |               NODE + EXPRESS BACKEND            |
                    |  routes -> services (campaigns, approvals,      |
                    |  prompts, reps, knowledge, analytics, dev)      |
                    +---------------------+--------------------------+
                                          |
   +--------------------------------------v-----------------------------------------+
   | AUTONOMOUS SCHEDULER: every 12 s, for EACH Live campaign independently         |
   |                                                                                 |
   |  GATES  kill switch -> campaign Live -> agent enabled (platform + campaign)     |
   |         -> channel enabled -> conflict / suppression -> hard limits             |
   |                                                                                 |
   |  1 Discovery -> 2 Research -> 3 ICP Fitment -> 4 Outreach Strategy ->           |
   |  5 Personalisation -> [Approvals queue: human] -> send ->                       |
   |  6 Conversation (reply router first) -> 7 Follow-up -> (Voice SDR, real only)   |
   +-------+-------------------------------------+-----------------------------------+
           |                                     |
           |  every important decision           |  every outbound message
           v                                     v
   +---------------------------+      +---------------------------------------------+
   | RETRIEVE (per campaign)   |      | dispatch (real campaigns only)               |
   | local embeddings, cosine  |      | Gmail API · Twilio SMS · Twilio Voice        |
   | over that campaign's own  |      | + human approval + allow-list + real switch  |
   | knowledge sources         |      | replies come back via inbox polling / signed |
   +-------------+-------------+      | webhooks and re-enter the loop               |
                 |                    +---------------------------------------------+
                 v
   +----------------------------------------------------------------------+
   | DECIDE: engine chain   dronahq > gemini > rule   (rule always last)  |
   |  structured JSON output · grounding check · one rewrite retry        |
   |  every fallback records WHY it happened                              |
   +---------------------------+------------------------------------------+
                               v
   +----------------------------------------------------------------------+
   | RECORD: Decision Journal (agent, prompt version, evidence, sources,  |
   | engine) · Prospect Dossier (facts + hand-off notes) · usage and cost |
   +---------------------------+------------------------------------------+
                               v
   +----------------------------------------------------------------------+
   | STATE: one JSON document (file locally, one row in Neon Postgres in   |
   | production) · additive migrations · automatic backups                 |
   +----------------------------------------------------------------------+
```

### 4.2 Components and what each is responsible for

| Component | Location | Responsibility |
|---|---|---|
| **Control-plane UI** | `frontend/` | 14 screens; every backend call is one function in `services/api.js`; a session-token layer; error boundaries and load states so no screen is ever blank |
| **API** | `backend/src/routes/` | Thin: each endpoint calls a service function. Auth middleware in front; Twilio webhooks are separate and verified by signature |
| **Services** | `backend/src/services/` | The business logic: campaigns and lifecycle, approvals, prompts, reps, knowledge, analytics, dev tools, meetings, limits, conflict handling, grounding |
| **Scheduler** | `services/scheduler.js`, `sdrSteps.js` | The autonomous loop. `sdrSteps.js` defines the pipeline once; the scheduler runs it and the UI's SDR Blueprint shows the same list |
| **Agent engines** | `services/agentEngine/` | One interface, four implementations: DronaHQ webhook adapter, Google Gemini, Anthropic (optional), and the deterministic rule engine. `index.js` walks the chain |
| **Retrieval** | `services/rag.js`, `embeddings.js` | Chunking, local embeddings, cosine ranking scoped to one campaign; keyword fallback if the model cannot load |
| **Reply router** | `services/replyRouter.js` | Embedding similarity to canonical example replies decides clear-cut opt-outs, hostility and out-of-office with no LLM call |
| **Channels** | `services/channels/` | Gmail API client, Twilio client, the Voice SDR turn-by-turn loop, and `dispatch`, the single place a recorded message becomes a real one |
| **Storage** | `backend/src/db/` | One state document, persisted to a JSON file or to Neon Postgres; additive migrations; backups |
| **Standalone matching service** | `matching-service/` | The original Python/FastAPI prototype of the matching logic, with tests; kept as reference |

### 4.3 The data model in plain words

- **Campaign:** identity, mode (an audience, or one named person), data mode (real or simulated), audience kind (organisations or individuals), targeting, channels, limits, cadence, approval policy, reps, knowledge sources, a versioned system prompt, prompt pins, per-agent overrides, persona (tone and sign-off), funnel and outcome counters, failures.
- **Prospect:** a person at an organisation (or an individual), free-form attributes, where they came from and whether that is real, stage, ICP fit and reasoning, plan, touches, conversation, meeting, and the **dossier**.
- **Dossier:** facts (each with its source), reasons to reach out ("hooks"), gaps (what is not known), and one **hand-off note** per agent action that records the agent, the prompt version, the engine and, when the rules answered because the model did not, the reason.
- **Decision:** one Decision Journal entry per meaningful action, with evidence, retrieved knowledge and the prompt version.
- **Approval:** a draft or a meeting proposal waiting for a human, with the grounding result.

### 4.4 Deployment

The backend serves the API, the scheduler and the built UI from **one Render web service on one URL**. State lives in **Neon Postgres** (Render's free tier has no persistent disk) as a single JSON document, chosen for speed of delivery under a 51-hour clock. A free UptimeRobot monitor pings `/health` to keep the free host awake. A Dockerfile is provided for any container host. `backend/scripts/smoke.mjs` checks a live deployment, including the required "pausing one campaign does not stop the others" demonstration.

---

## 5. Control plane: every requirement in Section 3 of the brief

This section walks through the brief's "Campaign Management and Control Plane" requirements one by one, says what we built, and says why we built it that way.

### 5.1 Multiple concurrent campaigns

**What the brief asks:** several campaigns at once, each aimed at its own ICP, with its own objectives, agents, prompts, policies and channel configuration, all sharing platform infrastructure.

**What we built:** the scheduler treats every Live campaign as an independent unit of work. On each 12-second tick it visits each Live campaign in turn and runs the seven pipeline steps inside its own error boundary, so a failure or a slow model call in one campaign cannot stop another. Each campaign carries its own targeting, channels, cadence, limits, approval policy, knowledge sources, system prompt, prompt pins, agent overrides, persona and reps. What is deliberately shared is the platform: the agents' library prompts, the integrations, the global suppression list, the global controls and the model quota.

**Why:** the brief calls for "each campaign operates independently while sharing common infrastructure". Per-campaign loops with per-stage error containment is the simplest design that makes independence true rather than claimed.

### 5.2 Campaign as a first-class object

| Brief requires | What a campaign carries in our system |
|---|---|
| **Identity:** name, description, owner, status, created and last-modified dates | All of them; the owner defaults to the signed-in user; every edit updates the modified date; status is one of Draft, Live, Paused, Completed, Archived |
| **Targeting:** ICP, geography, roles, company criteria, exclusion criteria, reference profiles | ICP text, geography, target personas, company criteria, exclusion criteria, and knowledge sources. Reference profiles are covered by knowledge sources and by the Dev tab's real-data tests, not by a dedicated field |
| **Agent configuration:** which agents are enabled, responsibilities, tools, policies, decision thresholds, escalation rules | Per-campaign agent switches; each agent's purpose, inputs and outputs shown on the campaign's SDR Blueprint; qualification criteria with a score threshold; approval level with its thresholds; an escalation rule that always requires a human; cadence and hard limits |
| **System prompts and harness:** a campaign-level prompt plus agent prompts for qualification, research, personalisation, outreach, follow-up, response handling, guardrails and escalation | A versioned **campaign system prompt** (written on the create form as the "campaign brief"), plus each agent's library prompt version pinned to the campaign, plus an optional per-campaign extra instruction per agent. The fixed guardrails are visible on the Agents page |

Two additions the brief did not ask for but a real team needs: **what we offer** (each campaign defines its own offer, so agents may only make claims that appear in it or in the knowledge base) and a **persona** (tone and sign-off).

### 5.3 Campaign lifecycle

```
   Draft ---> Live <---> Paused ---> Completed ---> Archived
     |                      |                            ^
     +----------------------+----------------------------+
```

| State | What the system does | How it is enforced |
|---|---|---|
| **Draft** | Being configured. Never sends. | The scheduler only visits campaigns whose status is Live |
| **Live** | Agents discover, research, qualify and contact per configuration | Every step passes the gates in section 4.1 |
| **Paused** | All autonomous execution stops. Prospect and conversation data are kept. Can be resumed | The scheduler skips the campaign. A campaign records a "last worked on" timestamp on every tick, and a paused one stops updating it, which is how we prove it stopped |
| **Completed / Archived** | No longer active; history, decisions and analytics stay available | Completing withdraws pending approvals (nothing more may be sent from a finished campaign); archiving removes it from the dashboard, feed and journal while keeping the data |

Illegal transitions are refused by one function (`canTransition`), so a UI bug cannot put a campaign into an impossible state.

### 5.4 Campaign control

An authorised user can **create, edit, launch, pause, resume, complete, archive and duplicate** a campaign, and view its configuration, activity and performance. A prominent Pause/Resume control sits on the campaign dashboard and on each campaign card, and the state of every campaign is visible at a glance by colour: Live is blue, Paused is grey, Completed is green.

**What a manager sees before activating (a design question in the brief):** a **launch review** that lists blocking problems, warnings and passes: settings complete, the offer stated, the kill switch, channels enabled, knowledge present, agents enabled, overlap with other running campaigns (same roles in the same region), reps assigned, the approval policy, and, for real campaigns, whether real sending is ready. A blocking item prevents launch; a warning lets a manager proceed knowingly.

### 5.5 Campaign isolation and conflict handling

**Isolation.** A campaign's ICP, prompts, agent configuration, policies, targeting, activity, metrics and decision history are separate. In particular a change to one campaign's prompts cannot change another's: the campaign system prompt is per campaign; a campaign is **pinned** to a specific library version of each agent's prompt, so publishing a new library version changes nothing that is running; and overrides are stored per campaign. Retrieval only ever searches the given campaign's own knowledge sources.

**Conflicts the brief lists, and how each is handled:**

| Conflict | Mechanism |
|---|---|
| **Duplicate outreach** | Every prospect is checked against every other campaign before first contact; an identical email cannot be contacted twice |
| **Two campaigns targeting the same prospect** | A **14-day rule**: one campaign per prospect within 14 days. The second campaign is blocked, the block is written to the Decision Journal by a "Conflict Resolution" step, and the prospect is not contacted |
| **Conflicting instructions** | The launch review warns when a new campaign overlaps a running one (same roles in the same region), so a manager resolves it before launch |
| **Excessive contact frequency** | A **frequency cap**: at most 4 touches to one person in any 7 days across all campaigns |
| **Do-not-contact** | A **global suppression list** checked before first contact and again before every follow-up (someone may be added mid-campaign). An opt-out in a reply, or on a phone call, is added automatically |

**The resolution mechanism** is deliberately simple and visible: the blocked action never happens, the reason is recorded in the journal, and the manager can see it and act (for example by removing someone from a list or changing a campaign's targeting).

### 5.6 Campaign dashboard

Each campaign has its own operational dashboard, covering every item in the brief:

| Brief item | On the dashboard |
|---|---|
| **Status:** Live/Paused/Draft, owner, ICP, active channels, active reps | Status badge, owner, ICP summary, channels, assigned reps, working hours, a prominent Pause/Resume |
| **Prospect funnel** | Discovered, Researched, Qualified, Contacted, Engaged, Meeting. **Opportunity** exists in the data model but is not shown: nothing the SDR does produces one (a meeting is the last step it reaches), so the column was always empty and told a manager nothing |
| **Outreach activity** | Emails, LinkedIn actions, follow-ups, replies |
| **Agent activity** | Workflows in flight, workflows completed (each is a Decision Journal entry), **failed** workflows (contained and counted), pending approvals and escalations |
| **Outcomes** | Positive, negative and neutral responses, meetings booked, and conversion rates (qualify rate, reply rate, meeting rate) |

The campaign page also carries the panels a manager needs to change the campaign: the **SDR Blueprint** (the whole pipeline in one place), prompts and harness, agents, reps, knowledge, and an activity timeline.

### 5.7 Global versus campaign-level configuration

| Global (platform-wide) | Where |
|---|---|
| Authentication | Sign-in with a name and an optional access code; signed session tokens |
| Integration credentials | Environment variables only, never in the repository or the UI; Settings shows what is really connected, read from the running configuration |
| Available models and tools | Engine chain and Gemini model list in configuration; shown on Dev, Runtime |
| Org and security policies | Global controls (kill switch, agent and channel switches), the daily LLM cap |
| Common knowledge base | The knowledge **library** (one place to see every source and give it to any campaign) |
| Global suppression / do-not-contact list | Settings |
| Platform-level guardrails | The fixed system prompt of every agent, and the grounding check |

| Campaign-level | Where |
|---|---|
| ICP, geography, personas, objective, offer | Create/Edit form |
| Prompts and agent instructions | Prompts and Harness panel |
| Outreach and follow-up strategy | Cadence (touches and wait), per-prospect plan by the Strategy agent |
| Qualification criteria | The qualification prompt and threshold |
| Campaign-specific knowledge | Knowledge panel |
| Channel configuration, daily limits, working hours | Channels and Limits card |
| Human-approval rules | Approval level, meeting-time approval, escalation |

### 5.8 Prompt and harness management

The brief wants "a dedicated interface where an authorised user can view the campaign system prompt and per-agent prompts, edit them, save a new version, compare versions, activate a version, roll back, and see who changed what and when", and it wants the version recorded whenever an agent acts.

| Requirement | What we built |
|---|---|
| View the campaign prompt and per-agent prompts | The campaign page's Prompts and Harness panel; the Agents and Prompts screen shows each agent's role, what it reads and writes, its **fixed built-in instruction**, and the **assembled prompt** an agent would receive for a chosen campaign |
| Edit and save a new version | Editing saves a **new version**, never overwrites. Saving a campaign prompt requires a **message** ("what did you change, and why?"), like a commit message |
| Compare versions | A word-level diff between any two versions |
| Activate and roll back | Making an earlier version active restores it without deleting anything newer |
| Who changed what and when | A change log per campaign and an author and time on every version |
| Record the version on every action | Every Decision Journal entry and every hand-off note carries the harness label (for example `v3.2 + campaign prompt v2`) |
| Answer "why did the agent do that?" | **View prompt** on any hand-off note **rebuilds the exact prompt versions that agent ran with**, from the label, because versions are never overwritten |
| Answer "which configuration produced this outcome?" | The analytics screen splits every agent's success rate **by campaign and by prompt version** (section 14) |

**Should prompt changes need approval? (a design question)** We chose an audit trail over a gate: every change is a versioned, attributed, revertable commit with a message, and it applies only to that campaign. An approval step is on the roadmap.

### 5.9 Levels of operational control

| Level | What it stops | Where |
|---|---|---|
| **Campaign pause** | One campaign; the others keep running | Campaign page, campaign cards |
| **Agent pause** | One agent, in one campaign or across the platform; the rest continues where appropriate | Campaign page (per campaign) and Settings (platform-wide) |
| **Channel pause** | One channel across every campaign (for example email, if it starts bouncing) | Settings, Channel controls |
| **Global kill switch** | All autonomous external action across the platform, at once | Top bar, always visible; every campaign keeps its own status underneath, so switching it off restores exactly what was running |

**What happens if a campaign is paused mid-execution? (a design question)** No new step starts. A model call already in flight may finish and its result is recorded, but nothing new fires, and nothing is sent. The campaign's "last worked on" timestamp stops advancing, which our smoke test uses to prove it. **How can an operator safely stop autonomous activity in a hurry?** The kill switch, with a confirmation dialog that explains what it does and that data is preserved.

### 5.10 Duplication and experimentation (stretch, built)

A campaign can be **duplicated** into a new Draft with the same targeting, knowledge, approval policy and per-campaign prompt. A manager changes one thing in the copy (a prompt, the channel mix, the qualification criteria), launches both, and compares them on the **Compare** screen: prospects, qualify rate, reply rate, meeting rate, positive and negative share, cost today, cost per prospect scored and per qualified lead, share of decisions made with no LLM call, and failed steps. Beyond the brief, the analytics screen also shows each agent's success rate by prompt version, so a prompt change can be judged over time on the same campaign (section 14).

### 5.11 Representative assignment

| Brief requires | Built |
|---|---|
| Assign reps to one or more campaigns | Reps are assigned per campaign, several per campaign |
| Whose identity is used for outreach | Messages are sent **as** the assigned rep (name on the message and on real email); the same rep is kept across a prospect's touches while they can still send |
| Daily activity limits, working hours, channel availability | Each rep has a daily limit, working hours and the channels they may use; a rep who cannot send right now does not send |
| If a rep is offboarded, surface every affected campaign and let an admin reassign | Offboarding shows the affected campaigns immediately; a campaign with no active rep is **held** (not silently failing) and flagged on the dashboard until an admin reassigns it |

### 5.12 The required demonstration

The final product demonstrates **three concurrent campaigns, each with a different ICP, different instructions, a different audience and independent state, dashboards, execution and analytics**, and shows that pausing one does not stop the others. The three demo campaigns on the live site:

| Campaign | Audience | Channels | Approval level | Why it is different |
|---|---|---|---|---|
| **SaaS Cloud Cost Reviews: US CTOs** | CTOs and VPs of Engineering at 50 to 500 employee US software companies | Email and LinkedIn | Manual | The classic B2B case; every draft waits for a human |
| **Campus Innovation Workshops: India** | Faculty advisors and student club leaders at engineering colleges | Email and LinkedIn | Assisted | A non-company audience; drafts go out on their own only after a human has approved a few |
| **Tech Summit Speakers: Founders and Creators** | Well-known founders, creators and authors (individuals and public figures) | Email | Manual, plus approval before proposing meeting times | Individuals rather than organisations; honest about an unpaid invitation |

Each has its own offer, its own standing instructions, two knowledge sources, its own tone and its own reps. They are created by a repeatable script (`backend/scripts/demo-campaigns.mjs`). The earlier seeded campaigns (US SaaS CTO, India BFSI CIO, AI Startup Founders) demonstrate the same requirement and remain in the data.

**Proof that pausing one does not stop the others:** `backend/scripts/smoke.mjs` pauses one Live campaign against the deployed site, waits for any in-flight work to finish, and then checks two things: the paused campaign's "last worked on" time does not change, and at least one other Live campaign's does. It passes locally and is how we verify the live deployment.

### 5.13 The brief's product design questions, answered

| Question | Our answer |
|---|---|
| How does a manager understand all campaigns at a glance? | The Command Center: a card per campaign with status, ICP, prospects, outreach and meetings; a portfolio funnel; KPIs; an agent activity feed; the AI efficiency panel; and one place for the kill switch |
| How are Live and Paused visually differentiated? | Colour-coded badges (Live blue with a dot, Paused grey), the action button changes (Pause versus Resume), and the state is always in the top bar of the campaign |
| What happens if a campaign is paused mid-execution? | Section 5.9 |
| How do configuration changes propagate? | An edit applies from the next agent run, and the form says so; prompt changes are versioned and apply to that campaign only |
| Should prompt changes need approval? | Section 5.8: an attributed, revertable audit trail now, an approval gate on the roadmap |
| How are conflicting campaigns on the same prospect handled? | Section 5.5: the 14-day rule, the frequency cap, the launch-time overlap warning, the journal entry |
| How do managers compare performance across campaigns? | The Compare screen and the analytics screen (section 5.10, section 14) |
| What should a manager see before activating a campaign? | The launch review (section 5.4) |
| How can an operator safely stop autonomous activity in a hurry? | The kill switch (section 5.9) |

---

## 6. Intelligence layer: every requirement in Section 4 of the brief

### 6.1 The agents

The brief lists seven agents. We built all seven, plus one more (Research) that we split out of "Lead Research and Enrichment" because discovering people and turning what is known about them into a brief are different jobs with different failure modes.

The pipeline is defined **once**, in `backend/src/services/sdrSteps.js`. The scheduler runs that list and the campaign page's SDR Blueprint displays the same list, so what a manager reads is what actually runs.

| # | Agent | Job | Reads | Writes | How it decides |
|---|---|---|---|---|---|
| 1 | **Lead Research** (discovery) | Finds the people a campaign is aimed at | Campaign target, knowledge | New prospects, each labelled with where it came from and whether that is real | Real contacts ranked by match to the audience; or the AI-imitated people search; or a free generator only when no model is configured |
| 2 | **Research** | Turns what is known about a prospect into a brief | The dossier, offer, knowledge | Facts, reasons to reach out, gaps, a hand-off note | Gemini with a strict "use only the input" rule; the rule engine restates what is known and lists what is not |
| 3 | **ICP Fitment** | Qualifies or rejects against the campaign's criteria | The whole dossier, criteria, exclusion criteria | Qualified or Rejected, a 0 to 100 score, evidence, a hand-off note | Clear rejections by rules (no LLM call); qualifications always get the model's read; if the model is down and the rules cannot judge, the prospect waits instead of being rejected |
| 4 | **Outreach Strategy** | Decides whether, when, where and how to contact | The dossier, enabled channels, touch limit | The prospect's plan: channels in order, wait between touches | Gemini; the rule fallback orders channels by seniority. Hard constraints (enabled channels, limits) are enforced in code, not left to the model |
| 5 | **Personalisation** | Drafts the first message | The dossier, plan, offer, knowledge, persona | A draft, always routed through the approval policy, and a hand-off note | Gemini grounded in retrieved knowledge; every draft is checked (section 10) |
| 6 | **Conversation** | Reads a reply and decides the next action | The conversation, dossier, knowledge | Escalate, propose a meeting, or answer; a hand-off note | Reply router first (no LLM), then Gemini; meeting replies are read by a dedicated step |
| 7 | **Follow-up** | Decides when and how to follow up, or when to stop | Prospect state, plan, cadence, suppression list | A follow-up draft with one new fact, or closure | **When** is policy (touch limit, wait, working hours, opt-outs); **how** is the agent's call |
| 8 | **Voice SDR** | Conducts a call, qualifies, handles objections, escalates | The dossier, the call so far | A transcript, an outcome, a hand-off note | Turn-by-turn through the same engine chain; real campaigns only |

**Why the ICP agent is split between rules and the model:** hard numeric criteria ("50 to 500 employees") are exactly what embeddings and language models handle badly and what rules handle perfectly. A clear rejection (the score is far below the threshold and no research note carries a buying signal) is settled by rules for free. A qualification starts real outreach, so it always gets the model's read. The rule engine tells us whether it *can* judge an audience (does it have a numeric size to compare?), and if it cannot and the model is down, the prospect waits.

**A worked example of "how do the agents collaborate":**

1. Lead Research adds "Dr. Meera Nair, Director of a startup hub" with two entered facts.
2. Research writes a brief: two facts, one reason to reach out, and the gaps ("not known: whether she decides on partnerships"), and a hand-off note.
3. ICP Fitment reads the *whole dossier* (including that note), scores 84, cites the two facts, and writes its own note.
4. Strategy reads the dossier and both notes and plans "email, then LinkedIn after three days".
5. Personalisation reads all of it, retrieves two knowledge passages, drafts a short email that uses one real fact, and the grounding check passes.
6. The draft lands in Approvals. A human approves. The message is sent as the assigned rep.
7. She replies "sounds interesting, can we talk?". The reply router finds it is not a clear-cut case; the Conversation agent proposes three real times inside the rep's working hours; she picks one; the meeting is booked and an invite is produced.

Every step wrote a Decision Journal entry and a hand-off note carrying the prompt version it ran with.

### 6.2 RAG and knowledge

**What the brief asks:** campaign- and product-specific knowledge bases (product and company information, case studies, sales playbooks, ICP definitions, objection handling, example messages, voice scripts), and agents that **retrieve before an important decision or before anything customer-facing**, rather than hallucinate from the base model.

| Element | What we built |
|---|---|
| **Knowledge content shipped** | Product one-pager; three customer case studies; three objection-handling guides; three sales playbooks (one per audience); 51 canonical example replies in seven categories (unsubscribe, hostile, out of office, positive, objection, question, other). ICP definitions live on the campaign. Voice scripts are the Voice SDR's instruction and rules, not separate documents |
| **Per-campaign sources** | Each campaign has its own sources. Managers add them by pasting or uploading text and can remove them. The **knowledge library** shows every source across campaigns, which campaigns use it, and lets a manager give a source to more campaigns |
| **Chunking** | Paragraph-sized chunks: small enough to cite one, large enough to carry meaning |
| **Embeddings** | `BAAI/bge-small-en-v1.5` (384 dimensions) via `fastembed`, run **in-process on the CPU**. No API key, no per-call cost, cached after the first download. Vectors are cached by text so nothing is embedded twice |
| **Retrieval** | Cosine similarity between the query and the chunks, top-k (two for most decisions). If the model cannot load (small hosts), retrieval falls back to keyword TF-IDF so agents always get grounded context |
| **When it happens** | Before ICP scoring, research, strategy, drafting and replying. The retrieved source names are recorded on the decision and shown in the Decision Journal ("Retrieved knowledge") |
| **Isolation** | Retrieval only ever searches the given campaign's own sources, so one campaign can never draw on another's material |
| **A retrieval tester** | On the Knowledge screen a manager asks a question the way a prospect might and sees exactly which passages an agent would be shown |

The vector store is **in-process cosine search over a few hundred chunks**, not a separate vector database. For this scale it is faster, free, and one fewer moving part; Section 17 discusses when we would move to pgvector.

### 6.3 Prompting, guardrails and evaluation

The brief lists topics to explore. For each one, what we did:

| Topic in the brief | What we did |
|---|---|
| **Campaign-specific system prompts and agent harnesses** | A versioned campaign system prompt per campaign, plus each agent's library prompt pinned per campaign, plus per-campaign overrides and a persona. The assembled prompt is inspectable |
| **Structured outputs** | Gemini's structured-output mode: the API itself returns JSON in our exact schema (a per-agent response schema, and for drafts the channel is restricted to the campaign's enabled channels in the schema *and* re-checked after parsing). Every agent also shares one output contract (agent, harness version, decision, score, evidence, retrieved knowledge, campaign instruction excerpt, conflict check, final action, hand-off note) that feeds the Decision Journal |
| **Tool calling** | Not used. Retrieval and channel actions are performed by the orchestrator around the model call, which keeps every action gated and auditable. Tool calling and MCP are on the roadmap |
| **Guardrails and hallucination prevention** | Fixed system prompts ("use only facts in the input, never invent numbers, customers or claims, no prices, no security or compliance commitments, no specific meeting times unless supplied"); a **grounding check** on every draft (section 10); escalation for anything the agents cannot safely answer; hard limits in code |
| **Human-in-the-loop escalation** | Pricing, security, compliance and legal questions, hostile replies, and anything ungroundable always create an approval for a human, at every approval level |
| **Prompt and version management** | Section 5.8 |
| **Golden datasets and AI evaluation** | `backend/eval/icp-golden.json`: **19 hand-labelled prospects** across the three seeded campaigns (16 scored, 3 borderline that are reported but not scored), covering strong fits, wrong role, wrong size, wrong industry, wrong region, and a competitor named only in the research notes. On our last run the rule engine agreed 12 of 16 (75%) and Gemini 16 of 16. The rule engine's misses are exactly the cases that need judgment, which is why qualifications go to the model. We call 16 of 16 "no regressions on known cases", not a measured accuracy, because the set is small and we labelled it. A regression test guards the rule engine's score on it. **The Dev tab's real-data tests** let a manager enter their own labelled people and see how often a campaign's ICP agent agrees |
| **LLM-as-judge or human evaluation** | **Human evaluation is built**: in the judge sandbox a real person plays the prospect, and a scorecard plus a 1 to 5 rating and notes record the result. LLM-as-judge is on the roadmap |
| **Model selection and routing** | An **engine chain** (DronaHQ, then Gemini, then the rule engine, always last); a **model list** inside Gemini tried in order (a small fast model first; free-tier quota is per model, so a second model keeps the demo alive); the rule engine and reply router for what does not need a model |
| **Fine-tuning** | Deliberately not done: at this scale retrieval and prompts already give the behaviour, and there was no data to justify it |

### 6.4 Cost and performance

**What the brief asks:** design for production-scale usage: token consumption, model cost, latency, context optimisation, RAG optimisation, caching, smaller models for simpler tasks, and cost per prospect, per qualified lead and per conversation.

| Concern | What we built |
|---|---|
| **Token consumption** | Every Gemini call records tokens in and out, per agent and per campaign |
| **Model cost** | A configurable price per million tokens turns tokens into an estimated cost; when the provider reports no tokens, a flat per-call estimate is used |
| **Latency** | Average latency per agent, from the calls behind each decision |
| **Cost per prospect, per qualified lead, per conversation** | Computed and shown on the Command Center's **AI Efficiency** panel and per campaign on the Compare screen |
| **Smaller models for simpler tasks** | The fast lite model first; rules and embeddings for whatever does not need a model at all |
| **Context optimisation** | Top-k retrieval instead of whole documents; the dossier is bounded (a maximum number of facts and notes, each note clipped); the prompt carries only what the step needs |
| **RAG optimisation** | Local embeddings (free), cached vectors, per-campaign scoping so a search covers only what is relevant |
| **Caching** | Embedding vectors are cached. A decision cache is on the roadmap |
| **Decisions with no LLM call** | Clear-cut ICP rejections (the shortcut), reply routing by embeddings, and the cap fallback. The panel shows how many decisions needed no model at all |
| **A hard budget** | Every provider request is counted (retries included). Past `LLM_DAILY_CALL_CAP` the rule engine decides, so the free quota cannot be exhausted mid-demo. A client-side rate limit keeps requests under the provider's per-minute quota |

### 6.5 The suggested tools, and what we used

The brief says the goal is not to use every tool but a "modular, cost-efficient, measurable AI system". This is our position on each row.

| Area | Suggested | What we did |
|---|---|---|
| **GTM platform** | DronaHQ Agentic AI and Vibe Coding | Used for the control-plane UI's origin and for designing, instructing, equipping and testing the agents (section 7) |
| **Lead discovery and enrichment** | Apollo or equivalent | Not connected. We built two substitutes: hand-entered **real contacts** (used for real sending) and an **LLM acting as a people-search tool** (used for simulated campaigns). The rest of the system only sees a candidate shape, so a real provider is an adapter, not a rewrite |
| **LinkedIn** | Browser automation or a third-party service | Simulated: the channel is planned, approved and recorded, but nothing is sent. LinkedIn has no sanctioned sending API, and we chose not to automate a browser against its terms |
| **Email** | Gmail or the Gmail API | **Gmail API, real**: OAuth refresh-token authentication, threaded sends, inbox reading, bounce and auto-reply detection, calendar invites as attachments |
| **SMS and telephony** | Twilio | Built (SMS send, signed reply webhook) and **tested against a fake Twilio server**; not run against live Twilio |
| **Voice AI** | Twilio plus a voice AI platform, or a custom stack | A **custom stack**: Twilio does speech-to-text and text-to-speech and places the call; our Voice SDR decides each turn through the engine chain. Tested against fakes; not run live |
| **Knowledge and RAG** | pgvector, Pinecone, Qdrant or equivalent | An equivalent: in-process cosine search over local embeddings. The matching prototype used Neon with pgvector |
| **Agent tools** | MCP and tool calling | Not used (section 6.3) |
| **Multi-agent communication** | A2A or an orchestration framework | A custom orchestrator (the scheduler) plus a **shared dossier**: agents communicate through a durable, inspectable record, not through message passing |
| **CRM** | Salesforce, HubSpot, Google Sheets | Not built; the Decision Journal and prospect records are the system of record |

---

## 7. How DronaHQ is used

The brief requires that DronaHQ is used "meaningfully in your core solution", and warns that it should not be "a wrapper dashboard bolted onto a system built entirely elsewhere", while also saying judges expect real, engineer-authored code underneath. Our position is the one the brief describes: **DronaHQ is a genuine part of the system, and the system is not only DronaHQ.** This section says exactly where DronaHQ sits, what we did on it, what worked, and the platform limit we hit, so a judge can check every sentence.

### 7.1 DronaHQ at a glance

| DronaHQ capability | What we did with it | Status |
|---|---|---|
| **Studio (control-plane UI)** | The control plane began as a DronaHQ Studio application (React and Vite export, eight screens on a mock service), then was extended by us into the current 14-screen application wired to the real backend | Used |
| **Agentic AI: agent definition** | Built the **ICP Fitment agent** by hand on agents.dronahq.com: a role-and-rules instruction, an explicit scoring rubric, an output contract, and the exclusion rule that overrides any score | Used, tested |
| **Agentic AI: variables** | Configured campaign-level variables `{{GUARDRAILS}}` and `{{ESCALATION_RULES}}` so the same guardrail text is injected into every agent instead of being retyped per agent, and `{{body}}` for the webhook payload | Used |
| **Agentic AI: knowledge base** | Attached a knowledge base to the ICP agent; retrieved passages are cited in the agent's evidence | Used |
| **Agentic AI: structured output** | Defined a structured output (`result`, an object of ten string properties matching our shared output contract) and linked it to the agent | Used |
| **Agentic AI: versioning** | Published the agent as versions up to **v1.0.3**, with rollback through the platform's versioning menu | Used |
| **Agentic AI: Playground** | Ran the agent in the Playground with real payloads, including the test that shows the agent **reads the dossier before judging** (below) | Used, tested |
| **Agentic AI: Artisan** | Created five further agents (Lead Research, Outreach Strategy, Personalisation, Conversation, Follow-up) through Artisan by giving it the full instruction text, with variables set | Created; not individually verified in the Playground the way ICP Fitment was |
| **Agentic AI: webhook trigger** | Added a webhook trigger with API-key authentication and built a backend adapter that calls it | Called successfully; the platform's reply carried no agent output (section 7.4) |
| **Traces** | Used to debug every run: the run's input, the two LLM calls behind it, and the credit cost (about 14 to 21 credits per run; the "Standard" response mode doubles the LLM calls) | Used |
| **Vibe Coding** | Not used | Not used |

### 7.2 What we designed on DronaHQ, and why it matters

**A shared output contract.** Every DronaHQ agent, and every one of our own engines, returns the same JSON shape: agent name, harness version, decision, fit score, evidence, retrieved knowledge, the campaign instruction excerpt, the conflict check, the final action and a hand-off note. That single contract is what feeds the Decision Journal and the Prospect Detail screen, and it is why swapping the engine behind an agent never changes anything the manager sees. We designed it on the DronaHQ agent and then built the whole application to speak it.

**Guardrails as variables, not copy-paste.** All agents obey the same `{{GUARDRAILS}}` and `{{ESCALATION_RULES}}`, injected at campaign level. A change to a guardrail is one edit that reaches every agent. Our own prompt composition mirrors this: a campaign prompt and persona are placed in front of each agent's library prompt at run time.

**Proof that the agent reads the dossier.** In the Playground we ran the ICP Fitment agent twice on the same prospect: once with an empty dossier, once with a dossier entry written by the Lead Research agent. The fit score moved from **78 to 91**, and the evidence and retrieved knowledge visibly changed to lean on the dossier entry rather than the raw fields. That is the behaviour the brief calls "agents understand the prospect before acting", verified on the platform rather than assumed.

**A bug found by testing, not by reading.** Our early notes wrote variables as `//VARIABLE//`; DronaHQ's syntax is `{{VARIABLE}}`. DronaHQ silently left the literal text in the prompt instead of substituting values. We found it by inspecting a run, fixed the ICP agent, and audited the others for the same mistake.

**The agent model is our vocabulary.** Each part of our agent layer corresponds to a DronaHQ concept, which is why the two fit together:

| DronaHQ concept | Our equivalent |
|---|---|
| Agent Instructions | A versioned agent prompt in the library, pinned per campaign |
| Variables | Campaign-level prompt, persona, guardrails and escalation rules injected at run time |
| Knowledge Base | Per-campaign RAG, retrieved before every important decision |
| Structured Output | The shared output contract and Gemini's response schemas |
| Versions and rollback | Prompt versions with messages, diff, compare and roll back |
| Trigger (webhook) | The engine adapter (`dronahqEngine.js`) |
| Traces | The Decision Journal, with the prompt version and retrieved sources on every entry |

### 7.3 The engineering around DronaHQ

DronaHQ is required, not sufficient, so the code around it is ours:

- **`dronahqEngine.js`** is a complete adapter: it builds the payload from the prospect, campaign and dossier; calls each agent's webhook with the API-key header; parses whatever comes back (JSON in a fenced block, a bare object, or a prose answer, all detected and handled); validates and normalises the result (for example a drafted channel must be one the campaign has enabled); and enforces a timeout.
- **A fallback policy** that is explicit rather than hidden: by default a failed DronaHQ call falls through to the next engine for that one decision; in strict mode it throws so nothing masks a failure while integrating.
- **The engine chain** (`AGENT_ENGINE=dronahq,gemini` or `dronahq`) makes DronaHQ a first-class engine beside Gemini and the rule engine.
- **Tests:** the adapter is covered by unit tests against a fake webhook server, including a test built from the **exact body the live agent returned when it answered in prose**.
- **Scripts:** `backend/scripts/try-icp.mjs` and `dronahq-probe.mjs` call a real agent for diagnosis.

### 7.4 What we found: the webhook returns no output

We integrated DronaHQ agents into the decision path and then investigated a platform behaviour in depth, so it is worth reporting in full.

**Symptom.** POSTing a prospect to an agent's webhook trigger runs the agent and reports success, but the reply's `response` field is always `null` (with "Response: Standard"), or "started in background" with no output (with "Response: None"). The very same agent and payload run in the Playground **do** show the JSON output. In Traces, the run's LLM calls both contain our correct JSON, but the run's Overview says "No output data available".

**What we tried, in order:**

1. Response set to Standard with each of five response schemas (a loose one, the original accepted one, the loosest, a trivial single-field test, and one wrapping the result in an object) and DronaHQ's own "Text Response" template.
2. Response set to None.
3. Defining a **Structured Output** on the agent, linking it, and republishing (v1.0.3).
4. Re-calling with `thread_id`, which starts a *new* run in the same conversation rather than fetching the old result, so it is for multi-turn chat, not for retrieving a run.
5. Searching the documentation, which says nothing about sync versus async, timeouts or how output maps to the Standard response.

**What we did about it.** We posted the question to DronaHQ (how does a webhook caller receive an agent's output?) and had no answer by submission time. Because the brief warns that "a smaller feature set that works end to end beats a larger one that only works in the demo path", we did not let this block the build:

- The engine chain puts **Gemini** in the decision path today, with the deterministic rule engine always last, so the loop is complete and reliable.
- The DronaHQ engine is **fully built, tested and selectable**. If the platform returns the output (or if the agent is given a REST tool that posts its result back to us, our documented alternative), one environment variable puts DronaHQ agents into the decision path with **no code change**, because every engine speaks the same contract.

**What we would say to a judge:** DronaHQ shaped our agent design and contract, hosted the agents we built and tested, and originated the control-plane UI; the runtime output path from a webhook is the one thing we could not get working on the platform in 51 hours, and we designed the system so that it does not depend on it.

### 7.5 Why this is not a wrapper

| Concern in the brief | Our answer |
|---|---|
| "Not a wrapper dashboard bolted onto a system built elsewhere" | DronaHQ is at the *judgment seam* (the agents) and the origin of the UI; the orchestration, data model, limits, approvals, retrieval, channels and measurement are all our own code |
| "Real, engineer-authored code underneath" | About 7,300 lines of backend and 6,000 lines of frontend, 187 tests, written and committed by the team |
| "Custom services, integrations, data models and orchestration logic that you designed" | The scheduler and its gates, the dossier, the matching layer, the engine chain, the Gmail and Twilio integrations, the analytics, the migrations |
| "DronaHQ as a genuine part of the system rather than the whole of it" | Exactly that: one of three engines in a chain, with a deliberate fallback |

---

## 8. Beyond the brief: the extras we built

The problem statement lists what to build. This section lists what we built **in addition**, because each one either closes a gap a real sales team would hit on day one, or makes a claim in this report verifiable. Each extra says what it is, why we built it, how it works, and where a judge can see it. The rubric's "Innovation / Extra Thinking" category and its cost, measurement, reliability and end-to-end categories are all served by this list.

**The extras at a glance**

| # | Extra | Group | Rubric categories it helps |
|---|---|---|---|
| E1 | Matching versus judgment, with free local embeddings | Cost and intelligence | Multi-channel intelligence, Measurement, Innovation |
| E2 | Decisions with no LLM call: the ICP shortcut and the embedding reply router | Cost and intelligence | Measurement, Engineering |
| E3 | Cost governance: a hard daily cap, rate limits, model fallback, per-campaign usage | Cost and intelligence | Measurement, Engineering |
| E4 | A grounding check that blocks unsupported claims from going out | Cost and intelligence | Context and personalisation |
| E5 | The Prospect Dossier, hand-off notes and the SDR Blueprint | Cost and intelligence | Multi-channel intelligence, Context |
| E6 | A Research agent that only restates what is known | Cost and intelligence | Context and personalisation |
| E7 | **The LLM as a people-search tool** (clever simulated data for any audience) | Realistic data | Innovation, End-to-end |
| E8 | Individuals and public figures as an audience, not just people at companies | Realistic data | Innovation |
| E9 | One-person campaigns | Realistic data | End-to-end |
| E10 | A real-versus-simulated switch per campaign, and real contacts | Realistic data | Innovation, End-to-end |
| E11 | **The judge sandbox**: a real person plays the prospect | Testing with humans | Innovation, End-to-end, Measurement |
| E12 | Search playground, real-data tests, a runtime view and "Ask Gemini" | Testing with humans | Engineering, Measurement |
| E13 | Meeting scheduling that books real times and sends an invite | End-to-end | End-to-end |
| E14 | Approval levels, including meeting-time approval | Human control | Product, Engineering |
| E15 | **Real email through the Gmail API** | Real channels | Multi-channel, End-to-end |
| E16 | Real SMS through Twilio, with signed webhooks | Real channels | Multi-channel |
| E17 | **A Voice SDR** that holds a real call turn by turn | Real channels | Multi-channel |
| E18 | Safety for real sending | Real channels | Engineering |
| E19 | Professional emails, not templates | Real channels | Context and personalisation |
| E20 | Prompt management like Git, and a prompt inspector | Manager tooling | Measurement, Product |
| E21 | Analytics: every agent's success rate by prompt version, and campaign health | Manager tooling | Measurement, Innovation |
| E22 | A knowledge library with a retrieval tester, and a full Agents and Prompts screen | Manager tooling | Product |
| E23 | A simulated clock with real hard limits, and representative controls | Manager tooling | Engineering, Product |
| E24 | A designed interface: type scale, one colour per status, no blank screens | Manager tooling | Product |
| E25 | Honest failure handling: hold, do not reject; say why | Reliability | Engineering |
| E26 | Operations: migrations, backups, sign-in, one-service deploy, smoke test, demo script | Reliability | Engineering |
| E27 | 187 tests, fake servers for every provider, and the bugs that using it found | Reliability | Engineering |
| E28 | Documentation that a new engineer can follow | Reliability | Engineering |

---

### Group 1: Cost and intelligence

#### E1. Matching versus judgment, with free local embeddings

**What.** Every decision in the pipeline is classified as *matching* or *judgment*, and only judgments spend model calls.

**Why.** The brief asks for cost efficiency ("smaller models for simpler tasks", "cost per qualified lead") and for reliability. A cosine check settles "does this reply look like an unsubscribe?" as well as a model does, at zero cost and in milliseconds; and a hard rule such as "50 to 500 employees" cannot survive being turned into an embedding at all. Deciding *up front* which kind each decision is gave us the cost story and the correctness story from one idea.

**How.** The matching prototype (three endpoints: rank companies against an ICP, pick the best contact, classify a reply) was built and tested first. Its embeddings were first planned on OpenAI; with no budget for API billing we moved them to **`fastembed` with `BAAI/bge-small-en-v1.5`** (384 dimensions), which runs in-process on the CPU with no key and no billing and works offline after a one-time model download. The same embeddings now power knowledge retrieval and reply routing inside the Node backend.

**See it.** `backend/src/services/embeddings.js`, `rag.js`, `replyRouter.js`; the matching prototype in `matching-service/` with its 13 tests.

#### E2. Decisions with no LLM call

**What.** Two places where a model is deliberately not asked.

1. **The ICP shortcut.** When the rule engine's score is far below the threshold, or a hard exclusion fired, and the research notes hold no buying signal ("hiring", "raised", "announced"), the prospect is rejected by rules, with no model call. Qualifications always go to the model, because a qualification starts real outreach.
2. **The reply router.** A reply is compared with canonical examples (51 of them in seven categories). If it is clearly an unsubscribe, hostile, or an out-of-office auto-reply, with high similarity *and* a clear margin over the nearest category that needs judgment, it is routed **deterministically**: opt-outs go on the global suppression list, out-of-office pauses follow-ups, and the Conversation agent is never called. Ambiguous replies (an objection, a question, interest) always reach the agent.

**Why.** These are the highest-volume, lowest-value decisions in an SDR system. Sending them to a model wastes money and adds a failure point in the place a mistake costs most (an ignored opt-out).

**Measured.** The AI Efficiency panel counts "decisions made with no LLM call" and their estimated saving, per day and per campaign.

#### E3. Cost governance

**What.** A set of controls so that the free quota cannot be exhausted and cost is visible.

- A **hard daily cap** on model calls (`LLM_DAILY_CALL_CAP`); every provider request counts, retries included; past the cap the rule engine decides. The counters are persisted, so a restart mid-demo does not reset the cap.
- A **client-side rate limit** (requests per minute) that stays under the provider's per-minute quota.
- **Retries with growing pauses** for temporary errors (rate limits, "high demand"), honouring the provider's `Retry-After`.
- A **model list**: the fast small model first, and a second model tried when the first's quota is used up, because free-tier quota is per model.
- **Usage by campaign and by agent**: calls, tokens in and out, latency, estimated cost, and decisions settled with no model. These are shown on the dashboard and on the Compare screen.

**Why.** A demo that dies at the first quota error, or a system that silently spends, would fail the brief's reliability and cost expectations.

#### E4. A grounding check on every customer-facing draft

**What.** After a model writes a draft, a deterministic checker (no LLM) compares it with what the agent was actually given: the retrieved knowledge, the prospect's own data and the campaign's offer. It fails a draft that contains:

- a **figure** (a percentage, a price, "60 days") that appears in none of those sources;
- a **compliance or certification claim** (SOC 2, ISO 27001, HIPAA, GDPR, "RBI compliant", "certified", "guaranteed") that the knowledge does not make;
- a **price** at all (pricing always goes through a human);
- a **specific meeting time** in a message that is not confirming a meeting.

**Then.** The agent gets **one rewrite** with the problems named, and the better of the two drafts is kept. A draft that still fails **cannot be auto-sent at any approval level**: it lands in the Approvals queue with a red "Grounding check failed" banner listing the issues, so a human edits or rejects it.

**Why.** The brief's "hallucination prevention" is usually a prompt instruction. A prompt instruction is a request; this is a check that it held. It targets exactly the kinds of claim that do damage when made up.

#### E5. The Prospect Dossier, hand-off notes and the SDR Blueprint

**What.** One record per prospect, read by every agent before it acts:

- **Facts**, each with its source ("entered by a person", "research", "imitated search");
- **Reasons to reach out** ("hooks") and **gaps** (what is *not* known);
- **A hand-off note from each agent**: one or two plain sentences, with the agent, the prompt version and the engine that produced it.

Every agent receives the whole dossier, so the ICP agent sees what Research found, Strategy sees both, and Personalisation sees all three. The campaign page's **SDR Blueprint** shows the whole SDR as one entity: its mission (objective, offer, brief, persona), the steps in order with what each reads and writes, and the shared rules.

**Why.** The brief's central warning is "it should feel like one SDR working across channels, not five disconnected bots". The dossier is the mechanism that makes that true rather than claimed.

#### E6. A Research agent that only restates what is known

**What.** A dedicated agent that turns the known facts into a brief: facts, reasons to reach out, gaps. Its rule is strict: it **uses only the input and never invents**. After it runs, every fact it produced is passed through the grounding check and a fact with figures or claims not in the prospect's own data is **dropped, not stored**.

**Why.** Research is where hallucination quietly enters a pipeline, because everything downstream trusts it. We treat it as the place to be most conservative.

---

### Group 2: Realistic data

#### E7. The LLM as a people-search tool (clever simulated data for any audience)

**What.** There is no budget for Apollo and no way to fetch real people at hackathon scale, so we made the model *imitate* a lead-search tool. Given a campaign's ICP, personas, geography, company and exclusion criteria, plus the names already returned, it returns candidate people: a name, a title, an organisation, a size, a location, two to four plausible facts and free-form attributes.

- It works for **any audience**, not only companies: student club leaders come back with a college, a year and a club; doctors come back with a clinic.
- It returns **near misses on purpose** (a different seniority, size or region), as a real search would, so the ICP agent has something to reject.
- Results are **fictional and labelled**: every prospect records `source: imitated search (AI, fictional people)` and `real: false`, and every email ends in the reserved `.example` domain so it can never belong to a real person.
- The output is schema-constrained and normalised (duplicates and already-found names dropped, addresses forced onto `.example`).

**Why.** It gave us realistic, campaign-specific, varied data for three different audiences with zero integration cost, and it is a drop-in: the rest of the system sees only a candidate shape, so Apollo would be an adapter, not a rewrite. It is also what makes the required three-campaign demonstration believable.

**Safeguards.** If the model is down, the search **adds nobody and reports why**, rather than filling a campaign with people from name lists that the rules would then reject (E25). The free name-list generator is used only when no model is configured at all.

#### E8. Individuals and public figures as an audience

**What.** A campaign chooses whether it targets *people at organisations* or *individuals, including famous people and public figures*. For individuals no organisation is needed, and the search prompt is different: it may name well-known public figures, using only widely known public facts, and is told never to invent private details or contact details, and never to return a private individual.

**Why.** Real outreach is not always to employees of companies: speakers, creators, authors, candidates for a panel. The third demo campaign, **Tech Summit Speakers**, uses this.

**Honesty.** A famous person in a *simulated* campaign is the model's recollection and is unverified; every email is still a made-up `.example` address. A famous person in a *real* campaign is someone a human typed in, with the address they actually have.

#### E9. One-person campaigns

**What.** A campaign can be aimed at *one specific person*. The person is entered by hand (name, role, organisation, email and phone if real, and a few facts), becomes the campaign's only prospect, and the ICP step qualifies them by policy because there is nothing to score. The SDR researches them, plans, writes, and works only on them until they reply or a meeting is booked.

**Why.** It is the smallest possible SDR task, which makes it the best unit for testing, for demonstrating, and for a manager who wants to work one important account.

#### E10. A real-versus-simulated switch per campaign, and real contacts

**What.** Every campaign chooses **Simulated (AI)** or **Real**. Simulated campaigns use made-up people and simulated replies and can never send anything. Real campaigns use only **real contacts**: people a human entered in the Dev tab with real emails and phone numbers, ranked against the audience. Only a real campaign can email, text or call, and it does so under the safeguards in E18.

**Why.** A system that only ever simulates cannot prove it works; a system that can send for real by accident is dangerous. Making the choice explicit, per campaign, with one function (`isRealCampaign`) deciding everything downstream, gives both.

---

### Group 3: Testing with humans

#### E11. The judge sandbox

**What.** In **Dev, Judge sandbox** a person enters a real person's details (or their own), what the SDR should achieve and what is being offered, and presses **Run the SDR**. The SDR researches, plans and writes the first message. Then **the judge plays the prospect**: they read what the SDR sent and type real replies in their own words. They can ask a question, ask for another time, or say no. The SDR proposes real meeting times inside the rep's working hours, reads the judge's answer, books one, and produces a downloadable calendar invite.

A **scorecard** built from what actually happened (no model asked) reports:

- whether the SDR wrote to the person;
- whether a meeting was booked, and inside the rep's working hours;
- whether it clashes with another meeting;
- whether any draft with an unsupported claim was sent;
- whether it needed a human to step in;
- turns from each side, LLM decisions versus decisions with none, and estimated cost.

The judge also gives a 1 to 5 rating and notes.

**Why.** The brief's judging question is "how close is this to a real SDR?". A judge who can *talk to it* and watch it book a meeting answers that in two minutes. It is also our **human evaluation**, and it worked as a bug-finder: running it against a live server showed that the rep's simulated working hours were holding the first message, which the unit tests had not caught (sandboxes now ignore the simulated clock).

**Isolation.** Sandbox runs never appear in the dashboard, approvals, journal or comparisons, and a sandbox **never sends anything for real**, even with real details typed in.

#### E12. Search playground, real-data tests, runtime view and "Ask Gemini"

**What.** Four more tools on the Dev tab.

- **Search playground:** try the imitated search on any audience and judge how believable the people are. Nothing is saved.
- **Real-data tests:** enter real people with the answer you expect ("should this person qualify?"), pick a campaign, and see how often its ICP agent agrees, with its reasoning. This is how a manager measures whether their criteria and prompt do their job.
- **Runtime:** what is in force right now: engines, key, models, calls today against the cap, tokens, cost, the simulated clock, the meeting time zone, and the **last model error**.
- **Ask Gemini:** a button that asks the model a trivial question now and reports exactly what came back, so a failing key, model or quota is never a mystery.

#### E13. Meeting scheduling that books real times

**What.** When a prospect is interested, the SDR proposes up to **three real times** on different weekdays, inside the assigned rep's working hours, at least about a day out, in the meeting time zone (default IST), for a configurable length (default 30 minutes). It then **reads the answer**: a pick ("the second one", or a named day, or a day and time), a decline, a counter-offer ("Friday at 5"), or unclear. A pick books the slot and builds a calendar invite (`.ics`, with organiser and attendee); a decline closes politely; a counter-offer gets other times once, then goes to a human.

**Guarantees.** Two prospects are never booked into the same slot on a rep's calendar. If the campaign requires approval for meeting times, the proposal waits in Approvals first. Reading the reply uses Gemini with a deterministic fallback.

**Why.** "Book or escalate" is the last step of the brief's end-to-end chain, and it is where many systems stop at "meeting requested". This one produces an actual meeting.

#### E14. Approval levels

**What.** Each campaign chooses how much a human must approve.

| Level | Behaviour |
|---|---|
| **Manual** | Every first message and every follow-up waits for a human |
| **Assisted** | Drafts wait until a human has approved a chosen number of the same kind, then a draft whose fit is above a chosen score goes out on its own |
| **Autonomous** | Drafts go out on their own |

**At every level:** an escalation (pricing, security, compliance, legal, hostile, unclear) always needs a human, and a draft that fails the grounding check is never auto-sent. Meeting times have their own switch. For **real** people the campaign's level is overridden: a human approves every message unless `REAL_AUTO_SEND` is explicitly turned on.

---

### Group 4: Real channels

#### E15. Real email through the Gmail API

**What.** A complete Gmail integration, written by us, with no email library:

- **Authentication** by OAuth refresh token, with the access token cached until shortly before it expires.
- **Sending** a properly formed message (encoded headers, UTF-8 body, optional attachments) in the right **thread**, as the assigned rep's name, with a **`List-Unsubscribe`** header.
- **Reading replies** by polling each contacted person's thread, keeping only the person's new words (the quoted earlier message is cut however their mail program marks it, and HTML-only replies are read).
- **Recognising who wrote a message** by the ids of messages *we* sent, not by the From address, so a person testing on the same Gmail account as the sender still has their reply read.
- **Bounces and automatic replies**: a bounce marks the address as not working and stops; an out-of-office is noted and never answered.
- **Calendar invites** attached to the first email after a meeting is booked.

**Why.** The brief suggests Gmail and says "take real actions". Real email is the one channel a judge can verify from their own inbox.

**Verified.** Sending was **used for real by the team**: a test email sent from the deployed site reached a real inbox. Threading, reply reading, bounce and auto-reply handling and approved replies are covered end to end against a fake Gmail server; an end-to-end reply exchange against live Gmail is not yet in the test suite (section 16.2).

#### E16. Real SMS through Twilio

**What.** Sending a text and receiving replies through a **signed webhook**: the endpoint sits outside sign-in (Twilio cannot sign in) and every request must carry a valid Twilio signature, rebuilt from the public URL, so an unsigned or forged request is refused. A signed text from a real person is matched to them by phone number and handled as their reply.

**Status.** Built and tested against a fake Twilio server (including the forged-signature cases); not yet run against live Twilio (section 16).

#### E17. A Voice SDR that holds a real call

**What.** The brief's seventh agent. Twilio places the call and does the speech-to-text and text-to-speech; our Voice SDR decides what to say **one turn at a time** through the same engine chain (Gemini with a plain rule fallback). It introduces itself and asks if now is a good time, listens, answers from the offer and knowledge only, handles "not now" and "not interested", ends the call politely, and stops after at most six turns. Afterwards the transcript joins the conversation, and the outcome is acted on: **someone who asks not to be called is added to the do-not-contact list; someone who wants more is handed to a human to book the meeting.**

**Rules.** Real campaigns only, and only when Twilio and the platform's Voice channel and agent are switched on.

**Status.** Built and tested against fakes (the turn loop, the opt-out, the hand-off); not run against a live phone call.

#### E18. Safety for real sending

Real messages reach real people, so this is where we were most careful.

| Safeguard | Effect |
|---|---|
| **Master switch** `REAL_SENDING` | Off by default. Off means nothing is ever sent for real, whatever else is set |
| **Human approval** | Every message to a real person waits in Approvals. Only an explicit `REAL_AUTO_SEND` changes that |
| **Recipient allow-list** `REAL_SEND_ALLOWLIST` | Optional: real messages go only to the addresses or numbers listed. Tolerant of quotes, spaces and capitals |
| **Real campaigns only** | A simulated campaign or a sandbox can never send, even with a real-looking address (and the launch review warns when someone types a real address into a simulated campaign) |
| **Made-up addresses refused** | A real contact cannot have an `.example` address, and a real send to one is blocked |
| **Truthful delivery** | A message shows *sending*, *sent* (with the provider's id) or **NOT DELIVERED with the reason**; a failure is never shown as sent, and it appears on the prospect and in the event feed |
| **Opt-out** | Every real email ends with an opt-out line and carries a `List-Unsubscribe` header; a reply of "unsubscribe" or "stop" puts the person on the global list |
| **No LinkedIn** | LinkedIn cannot be sent for real, so a real campaign cannot plan it |
| **Launch review** | Blocks a real campaign with no channel that can really send, and warns about the rest |

#### E19. Professional emails, not templates

**What.** After trying real sending we found our first drafts were too short and read like templates (the prompts capped an email at 90 words, and the rule fallback wrote one-liners). We rewrote drafting so a first email is a proper business email of about 110 to 170 words with a fixed shape: a greeting line using the person's name and title, a paragraph on *why this person* built on one real fact, a paragraph on what is offered and why it could matter, and one low-pressure ask. Follow-ups and replies follow the same shape at a shorter length. The signature is added once at send time ("Best regards", the campaign's sign-off or the rep's name, and the opt-out line), and the campaign **persona** (tone and sign-off) is part of every prompt.

**Why.** "Context and personalisation" is 15 points, and a real recipient decides in two seconds. We changed this because *using* the system showed us it was wrong.

---

### Group 5: Manager tooling

#### E20. Prompt management like Git, and a prompt inspector

**What.** Beyond versions and rollback (section 5.8): saving a campaign prompt **requires a message** that says what changed and why; each version shows its author, time, message and **how well it performed** (share of opening messages that got a reply); a struggling campaign shows a banner that points at the brief; and **View prompt** on any hand-off note rebuilds the exact prompt versions that agent ran with.

**Why.** The brief asks managers to be able to answer "which configuration produced this outcome?". A message per change and a performance figure per version turn a prompt history into an experiment log.

#### E21. Analytics that explain the prompts

**What.** For every agent, a **success rate defined per agent**, measured from what actually happened to each prospect and split **by campaign and by the prompt version the agent ran with**:

| Agent | What counts as success |
|---|---|
| Research | It found at least one specific reason to get in touch |
| ICP Fitment | Its qualified prospects, once contacted, replied |
| Outreach Strategy | Its plan led to a message actually being sent |
| Personalisation | Its opening message got a reply |
| Conversation | A reply it handled ended in a booked meeting |
| Follow-up | A follow-up got a reply |

A **campaign health** verdict (new, healthy, watch, struggling) with the reasons ("only 3 of 40 prospects qualified", "no replies from 12 people contacted", "people rejected 60% of drafts") and **what to try** ("loosen the qualification criteria", "change the brief"), with a link to the place to change it. Small samples are labelled as small.

**Why.** "Can you measure and improve the system's own performance?" is a rubric category. The brief's stretch idea (duplicate a campaign and compare) tells you *that* a variant did better; this tells you *which agent and which prompt version* made the difference.

#### E22. A knowledge library and a full Agents and Prompts screen

**What.** The **Knowledge** screen lists every source across campaigns, which campaigns use it, lets a manager give it to more campaigns or take it away from one, and lets them **test retrieval**: ask a question and see exactly which passages an agent in that campaign would be shown. The **Agents and Prompts** screen shows for each agent what it does in the SDR, what it reads and writes, its **fixed built-in instruction** (so nothing an agent is told is hidden), its versions, and a preview of the assembled prompt for any campaign.

#### E23. A simulated clock with real hard limits

**What.** Follow-up waits, working hours, the daily limit and the contact-frequency cap are **hard limits that no agent can override**: an agent may propose a touch, and a separate function decides whether it may go out now. Because a real 72-hour follow-up wait cannot be shown in a demo, these run on a **simulated clock** (one simulated hour lasts three seconds by default, so a day lasts 72 seconds), which a setting changes to real time. Representatives add their own limits: a daily limit, working hours and channels per rep.

**Why.** It shows the limits *working* in a demo without waiting days, and one setting makes them real.

#### E24. A designed interface

**What.** A consistent visual language: a **centred page heading** and a type scale (page heading, section heading, small-caps label, field label, body, supporting text); **one colour per status, the same everywhere** (rejected red, meeting green, contacted blue, qualified purple, engaged amber, discovered grey); readable secondary text; no em dashes; every screen has a loading state, an error state and an empty state, and an error boundary means a bug in one screen cannot blank the app. The Reject action asks for its reason only when rejecting, and says why it is asked.

---

### Group 6: Reliability and operations

#### E25. Honest failure handling: hold, do not reject, and say why

**What.** The brief asks that the system "handle malformed model output, failed API calls and empty states without crashing". We went further and made the *result of a failure* correct and visible:

- **Every stage runs in its own error boundary**, per campaign; a failure is counted, shown on the campaign as a failed workflow, and retried, and never stops another campaign.
- **Malformed or empty model output, HTTP errors, retries, model fallback and quota exhaustion** all end in a deterministic decision, never a crash.
- **When the model is down, the system does not guess.** The imitated search adds nobody rather than inventing people. A prospect that the rules cannot judge **waits and is retried** every minute rather than being rejected. Real messages are never sent because a step degraded.
- **Every fallback says why.** When the rules answered because the model did not, the Decision Journal entry, the prospect's own log and the dossier hand-off note all record: *"The AI did not respond (the actual error), so the rule engine decided this step."* Managers can see how many decisions were made without the model and why.
- **You can see why the model failed:** the last model error is on Dev, Runtime, the Gemini card in Settings shows *Failing* with the reason, and the **Ask Gemini** button tests it on demand.

**Why this is an extra.** We learned it the hard way: on our live site Gemini stopped answering, the free name-list generator filled three campaigns with junk, and the rule engine rejected all 21 of them. A judge would have seen "everything rejected". The fix is the policy above.

#### E26. Operations

- **Storage:** one state document, kept in a JSON file locally or as one row in Neon Postgres; **additive migrations** that never wipe saved data; and an automatic **backup** before any reseed. (An early schema bump wiped a campaign we had built; that led directly to this design and to the rule that campaigns are never deleted.)
- **Sign-in:** signed session tokens, an optional access code, and "who did this" recorded on approvals, pauses and edits.
- **One-service deployment:** Docker, Render and Neon, with UptimeRobot keeping the free host awake.
- **A smoke test** for any running deployment that checks the pause-isolation demonstration using a per-campaign "last worked on" proof-of-life timestamp (it replaced a fragile prospect-count check that produced false failures on the live site).
- **A repeatable demo setup script** that archives the current campaigns and launches three demo-ready ones.
- **Archived campaigns** disappear from the dashboard, feed, journal, approvals and prospects list while their data is kept.

#### E27. Tests, fake providers, and the bugs that using it found

**What.** 187 automated tests in 21 files, all passing. The AI and channel providers are tested against **fake HTTP servers we wrote** (Gemini, DronaHQ, Gmail, Twilio), so the tests run offline and cover failure cases (429 quota errors, malformed output, forged signatures, bounces) that a real provider will not produce on demand.

**Bugs found by using the system, not by reading it** (each has a regression test):

| Bug | How it was found | Fix |
|---|---|---|
| A reply from the same Gmail account that sends (a test on yourself) was thrown away as "our own message" | Real email use | Messages are ours only if we sent them through the API, never by From address |
| Approving a drafted reply to a real person recorded it but **never emailed it** | Reviewing the approval path after real use | Approval of any reply to a real person now sends through `dispatch` |
| Emails were too short and templated | Reading the first real email | New drafting shape (E19) |
| A bounce or out-of-office could be answered as if the person had replied | Testing the reply path | Detected by headers and subject; a bounce stops, an auto-reply is noted |
| Quoted text wrapped over two lines leaked into replies; HTML-only replies were unreadable | Testing real reply shapes | Robust quote stripping and an HTML fallback |
| The sandbox's first message was held by the simulated working-hours clock | Running the sandbox against a live server | Sandboxes ignore the simulated clock |
| Completed campaigns still showed their approvals and prospects | Using the live site | Completing withdraws pending approvals; closed campaigns are hidden by default |
| The integrations list said "Connected" for everything | A review of the Settings screen | It is now computed from the running configuration |
| All prospects rejected when the model was down | The live site | Hold, do not reject (E25) |
| Intermittent test timeouts under load | Repeated full runs | The engine test files no longer load the embedding model |

#### E28. Documentation a new engineer can follow

A README with setup, environment variables, deployment (including the zero-cost path) and limitations; a **23-section system guide** (what the product is, the words we use, the pipeline, every agent, the rules no agent can break, the data model, a file-by-file map, recipes for adding things, decisions and gotchas, and what is simulated versus real); a **roadmap** of what is not built, with sizes; and a **demo script** with a fallback table. Together about 15,000 words.

---

## 9. One SDR across channels

**The rubric asks (25 points):** does it intelligently coordinate LinkedIn, email, SMS and voice, like one SDR rather than five bots?

**Our answer is that coordination is done by policy and shared memory, not by five independent senders.**

### 9.1 What makes it one SDR

| Mechanism | How it works | Why it matters |
|---|---|---|
| **One plan per prospect** | The Outreach Strategy agent chooses an ordered sequence of channels and the wait between touches, from the prospect's role and seniority and the campaign's enabled channels | A founder is reachable on LinkedIn first; a CTO or a risk leader expects a considered email; a regulated-industry leader prefers email to SMS. The plan is the SDR's judgment about *this person* |
| **Channel rules in code, not in the model** | SMS is never the first touch and is only a later nudge; voice, if allowed, is the last touch; every planned channel must be one the campaign has enabled; the model's choice is re-validated after parsing | The model advises; the platform enforces |
| **One memory** | The dossier and hand-off notes are shared across all channels. A reply on email is visible to the follow-up that would have gone on LinkedIn | The prospect never gets a message that ignores what they already said |
| **One cadence policy** | A campaign has a maximum number of touches (1 to 6) and a wait between them (24 to 168 hours). A reply ends the sequence. An opt-out on any channel stops all channels. The Follow-up agent re-checks the suppression list before each follow-up | The system stops when it should: on a reply, an opt-out, the touch limit, or a limit breach |
| **One set of hard limits** | Working hours, a daily limit, a contact-frequency cap (at most 4 touches to one person in 7 days across all campaigns), and per-rep limits apply to every channel | No channel can bypass a limit another respects |
| **One sender identity** | A prospect is contacted as the same assigned rep across channels while that rep can still send | It reads as one person |
| **One place a message becomes real** | `recordTouch` and `recordReply` record every message; `dispatch` turns it into a real send for real campaigns only | Every channel takes the same path through the same safeguards |
| **Channel-level control** | A manager can pause one channel across all campaigns without touching anything else | Bounce spike on email? Pause email, keep everything else running |

### 9.2 Channel status, honestly

| Channel | Simulated campaigns | Real campaigns |
|---|---|---|
| **Email** | Planned, approved, recorded; nothing sent | **Real**, through the Gmail API, with replies read from the thread |
| **LinkedIn** | Planned, approved, recorded; nothing sent | Not available (no sanctioned sending API; the channel is blocked in real mode) |
| **SMS** | Planned, approved, recorded; nothing sent | Built on Twilio with a signed reply webhook; tested against a fake Twilio, not run live |
| **Voice** | Never used (the Voice SDR only calls real people) | Built on Twilio with a turn-by-turn Voice SDR; tested against fakes, not run live |

---

## 10. Context and personalisation without hallucination

**The rubric asks (15 points):** do agents actually understand the prospect before acting, without hallucinating?

### 10.1 What the agents know before they act

Every agent receives a structured bundle: the **person and organisation**, their **attributes**, the **campaign** (objective, offer, ICP, personas, criteria, approval policy), the **whole dossier** (facts with sources, reasons to reach out, gaps, and every earlier agent's hand-off note), the **retrieved knowledge**, the **conversation so far**, and the **campaign's prompts and persona**. Nothing is guessed from the model's general knowledge when it can be retrieved or read.

### 10.2 Seven layers between the model and a false claim

We treat hallucination as something to defend against in depth, not with a single prompt line.

| Layer | What it does |
|---|---|
| 1. **Input-only prompts** | Every agent's fixed instruction says to use only facts in the input, never invent numbers, customers, titles or news, and to say when something is unknown |
| 2. **Retrieval before decisions** | Agents retrieve campaign knowledge before an important decision or a customer-facing draft, and the sources are recorded |
| 3. **Structured output** | The API itself constrains the response to our schema, so malformed output is rare and is handled when it happens |
| 4. **Research drops ungrounded facts** | Any research fact whose figures or claims are not in the prospect's own data is dropped, never stored |
| 5. **The grounding check** | A deterministic check on every draft for unsupported figures, certification claims, prices and meeting times; one rewrite; a hard block on auto-send |
| 6. **Human approval** | Drafts wait for a human under Manual and Assisted levels, and always for anything real (unless explicitly overridden) |
| 7. **Honest data labels** | Every prospect says where it came from and whether it is real; fictional emails use the reserved `.example` domain |

### 10.3 Personalisation

- **One real fact per message.** The Personalisation agent references exactly one fact that appears in the input, so a message is specific without inventing anything.
- **A voice per campaign.** A persona (tone and sign-off) is part of every prompt: "calm, specific and brief, one engineer writing to another" for the SaaS campaign; "warm, respectful of academic titles" for the campus campaign; "respectful, precise and honest" for the summit campaign.
- **Channel-appropriate.** An email is a proper business email; an SMS is at most 300 characters; a LinkedIn message is short. Titles are respected ("Hello Professor Rao").
- **Follow-ups add something new.** The Follow-up agent must add one new relevant fact and must not repeat the opening, apologise for writing or say "just checking in". A last touch closes the loop politely.
- **Replies answer what was said.** The Conversation agent's reply addresses the actual message and offers a next step.

---

## 11. End-to-end SDR capability

**The rubric asks (15 points):** find, research, qualify, contact, follow up, respond, book or escalate: how much of that chain really works?

| Step | What happens | Real or simulated | Evidence |
|---|---|---|---|
| **Find** | Real contacts ranked by match, or the imitated search, or a named person | Real (hand-entered) or simulated | Real contacts tab; search playground |
| **Research** | A brief of facts, reasons to reach out and gaps | Real logic over the data it has | Prospect page dossier |
| **Qualify** | A score, evidence and a decision against the criteria and exclusions | Real (rules plus Gemini) | Decision Journal; golden set; real-data tests |
| **Plan and draft** | A channel sequence and a grounded draft | Real | Approvals queue; grounding banner |
| **Approve** | A human approves, edits or rejects, with a reason | Real | Approvals screen |
| **Contact** | The message is sent | **Real for email** on real campaigns; simulated otherwise | Real email tab; delivery status on each message |
| **Follow up** | A cadence follow-up after silence, stopping on reply, opt-out or the touch limit | Real logic, simulated clock | Prospect page; smoke test |
| **Respond** | A reply is routed (opt-out, hostile, out-of-office by embeddings; the rest by the Conversation agent) | Real logic; replies are real for real email and for the judge sandbox, simulated otherwise | Judge sandbox; reply router tests |
| **Book** | Real times inside the rep's hours, the answer read, the slot booked without a clash, an invite produced | Real logic; the invite is a file, not a live calendar entry | Judge sandbox scorecard |
| **Escalate** | Pricing, security, compliance, legal, hostile or unclear replies go to a human with a recommended action | Real | Approvals screen |

**The strongest single demonstration** is the judge sandbox: a person who has never seen the system types a reply and the SDR books a meeting with an invite, with a scorecard that says whether it stayed inside the rep's hours, avoided a clash and made no unsupported claim.

---

## 12. Product and user experience

**The rubric asks (10 points):** could a real sales team pick this up and use it?

### 12.1 The screens

| Screen | Purpose |
|---|---|
| **Command Center** | Every campaign at a glance; a portfolio funnel; KPIs; a live agent feed; the AI efficiency panel; the kill switch |
| **Campaigns / Create and Edit** | A blank form whose hints say what each field is *for* (no example values to overwrite); a choice of an audience or one person; a choice of real or simulated data; the campaign brief (the initial prompt) |
| **Campaign detail** | Status and Pause/Resume; the funnel; outreach and agent activity; outcomes; the SDR Blueprint; prompts and harness; agents; reps; knowledge; the launch review |
| **Prospects** | All prospects across active campaigns, sortable, with a stage colour |
| **Prospect detail** | The dossier, plan, conversation with delivery status, meeting, hand-off notes with "View prompt", and the recommended next action |
| **Approvals** | A queue with the draft, the AI's recommendation, the grounding result, Edit, Approve and Send, and Reject with a reason |
| **Decision Journal** | Every decision with its agent, prompt version, evidence, retrieved sources and the engine that decided |
| **Agents and Prompts** | The agent library: role, reads, writes, the fixed instruction, versions, compare, and the assembled prompt |
| **Knowledge** | The cross-campaign library and the retrieval tester |
| **Representatives** | Reps, their limits and hours, offboarding and reassignment |
| **Compare (Analytics)** | Campaigns side by side, campaign health, and each agent's success by prompt version |
| **Dev** | Judge sandbox, real contacts, real email, search playground, real-data tests, runtime |
| **Settings** | Kill switch, agent and channel controls, the suppression list |
| **Login** | Sign-in |

### 12.2 Design decisions that came from thinking about a real manager

- **Say what a field is for, not an example.** The create form has hints, not pre-filled example values, so nobody launches a campaign with someone else's example text.
- **A launch review before going Live**, in the manager's language.
- **Nothing surprising happens to a person.** Real sending is behind a switch, an allow-list and a human approval; a real address typed into a simulated campaign is flagged.
- **The reason a human rejects is asked at the moment they reject**, and it is saved in the Decision Journal so the team can see why.
- **Colour means one thing.** Status colours are identical on the Prospects page, the funnel and the badges.
- **No blank screens.** Every screen has a loading state, an error state naming what failed, and an empty state saying what to do next.
- **Keyboard and screen-reader basics.** Labelled inputs, focus outlines, `aria-pressed` on toggles and chips, and table rows that open with Enter.

---

## 13. Engineering quality

**The rubric asks (10 points):** architecture, modularity, reliability, error handling, security.

### 13.1 Codebase and repository

- **One shared repository, 60 commits**, from the whole team, with descriptive messages that say what changed and why.
- **A clear structure that separates agents, services, data and frontend:**

```
backend/
  src/
    routes/        thin HTTP layer (API and the signed Twilio webhooks)
    services/      business logic: campaigns, scheduler, approvals, prompts, reps,
                   knowledge, analytics, meetings, limits, conflict, grounding, dev tools
      agentEngine/ the agents: DronaHQ adapter, Gemini, Anthropic, rules, the chain
      channels/    Gmail, Twilio, the Voice SDR, and dispatch
    db/            storage adapters, seed data, additive migrations
    middleware/    error handling
    utils/         validation and formatting
  data/knowledge/  the knowledge documents and canonical reply examples
  eval/            the ICP golden set and its runner
  scripts/         smoke test, demo setup, diagnostics, Gemini model listing
  test/            187 tests in 21 files
frontend/src/
  screens/         14 screens
  components/      shell, campaign panels, analytics, dev tools, ui primitives
  services/        api.js: every backend call in one place
  utils/           formatting, validation, diff
matching-service/  the standalone Python prototype of the matching logic, with tests
docs/              system guide, roadmap, demo script, this report
```

- **Secrets stay out of version control:** every credential is an environment variable; `.env` files are ignored; `.env.example` documents every setting; the UI never shows a secret; Settings shows *whether* something is connected, not its value.
- **A README** with an overview, setup and run steps, every environment variable, the tech stack, an architecture overview, and a file and folder map; a deeper system guide beside it.
- **No half-finished paths:** features that are not built are listed on the roadmap and marked in the UI ("Not built"), not left as dead code. The one deliberate exception is the standalone matching service, kept as tested reference and stated as such.

### 13.2 Modularity

- **One interface, four engines.** Every agent has one function with one contract, and `agentEngine/index.js` walks the chain. Adding an engine or changing the order is configuration.
- **The pipeline is defined once** (`sdrSteps.js`) and used by both the scheduler and the UI.
- **One place a prospect is created** (`prospects.js`), **one place a touch is recorded** (`outreach.js`), **one place a message becomes real** (`dispatch.js`), **one place limits are decided** (`limits.js`), **one place a campaign becomes "real"** (`realMode.js`). Each cross-cutting rule has one implementation.
- **The UI talks to the backend through one file** (`api.js`), so a screen never builds a URL.

### 13.3 Reliability and error handling

| Failure | Behaviour |
|---|---|
| Malformed, empty or off-schema model output | Detected, retried within limits, and ends in a rule-engine decision |
| Provider errors and rate limits | Retried with growing pauses, honouring `Retry-After`; the next model in the list is tried; then the rule engine |
| Provider quota exhausted | The daily cap and the fallback keep the loop running; where the rules cannot judge, the prospect waits |
| A step throws | Contained in that campaign's stage; counted and shown as a failed workflow; the next campaign still runs |
| A campaign with no active rep | Held with a plain reason and flagged, not silently failing |
| A real message that cannot be delivered | Shown as not delivered with the reason; the prospect is not advanced as if it had been |
| Bad input from the UI | Validated server-side with field-level errors (sizes, formats, required fields) |
| Deploy or restart | State reloads from Neon or the JSON file; usage counters persist |
| Schema changes | Additive migrations only; a backup before any reseed |

### 13.4 Security

- **Authentication:** signed session tokens (HMAC), an optional access code, a session lifetime, and the acting user recorded on every consequential action.
- **The public webhooks** (Twilio) sit outside sign-in and are protected by signature verification with a timing-safe comparison; a request without a valid signature is refused.
- **Real-send safeguards** (E18): a master switch, an allow-list, mandatory human approval, and a block on made-up addresses.
- **Input limits:** a request body limit, a maximum size for knowledge sources, clamped numeric settings, and an allowed-origins list for cross-origin calls.
- **Data hygiene:** a real contact cannot carry a made-up address; the suppression list supports exact addresses and domain wildcards.
- **Known gap:** sign-in is a shared access code with a display name, not individual accounts with roles (section 17).

### 13.5 Testing

- **187 tests** in `node:test`, running in about a minute, covering: the engine adapters and their failure modes; the golden ICP set; cost and cap behaviour; storage and migrations; campaign lifecycle and isolation; the scheduler and cadence; agent plans; grounding; sign-in; prompts and versions; representatives; the blueprint; research and imitated search; meeting scheduling; the Dev sandbox; analytics; the knowledge library; real sending against fake Gmail and Twilio; and model-outage behaviour.
- **Provider fakes** mean the suite is offline and deterministic.
- **Test-suite hygiene:** test files use throwaway data files and usage counters, so running tests can never touch real data.

---

## 14. Measurement and optimisation

**The rubric asks (5 points):** can you measure and improve the system's own performance?

We built a measure, diagnose, change, compare loop, all inside the product.

| Question | Where it is answered |
|---|---|
| **How much does the AI cost, and per what?** | The AI Efficiency panel: model calls against the daily cap, tokens, estimated cost, decisions made with no LLM call, and unit costs per prospect scored, per qualified lead and per conversation |
| **How do campaigns compare?** | The Compare screen: prospects, qualify, reply and meeting rates, positive and negative share, cost, decisions with no LLM call, failed steps |
| **Is this campaign working, and what should I try?** | Campaign health: a verdict, the reasons in numbers, and a suggested change with a link to it |
| **Is each agent doing its job?** | Each agent's success rate (defined in E21), and its result split by campaign and by the prompt version it ran with |
| **Did my prompt change help?** | Each campaign-prompt version shows the share of opening messages that got a reply; the by-version table compares before and after |
| **Are the criteria right?** | The real-data tests (agreement with your own labelled people) and the golden set (16 scored cases) |
| **Can a human judge the whole SDR?** | The judge sandbox scorecard and rating |
| **Why did the agent do that?** | The Decision Journal and View prompt (the exact prompt versions rebuilt) |
| **How often did the AI fail?** | Failed workflows per campaign, decisions made by the rules because the model did not (with the reason), and the last model error |

**How the loop closes.** A campaign is flagged as struggling because too few replies came back; the manager opens the campaign, edits the brief with a message, and saves a new version; the analytics show that version's reply rate beside the previous one; and if it is worse, one click restores the earlier version.

**Honest about the statistics.** Small samples move a lot, so the screens say so ("small sample") and the report does not claim measured accuracy from a 16-case set.

---

## 15. Cost and performance

The design choices are in sections 6.4 and E1 to E3; this is the summary a judge can check.

| Lever | Effect |
|---|---|
| Local embeddings | Retrieval and reply routing cost nothing and need no key |
| ICP shortcut and reply router | The highest-volume decisions need no model call |
| Fast small model first, second model as fallback | Lower latency and cost; quota is per model, so the demo survives a spent quota |
| Hard daily cap and rate limit | Spend and quota cannot run away |
| Retrieval scope and top-k | Small prompts; only one campaign's sources are searched |
| Bounded dossier | Context does not grow with a prospect's history |
| Persisted usage counters | The cap survives a restart |
| Free hosting path | Render free, Neon free and UptimeRobot free make a live deployment cost nothing |

**Performance:** the scheduler is a single process that handles a small batch of prospects per campaign per tick. It is comfortable at demo scale; Section 17 says what would change at production scale (a queue and workers, and a relational schema).

---

## 16. What works, what is partial, what was skipped

The brief asks for this distinction explicitly. We would rather a judge trust a shorter list that is true.

### 16.1 Fully working (verified by tests, by the live site, or both)

| Capability | Evidence |
|---|---|
| Three or more concurrent campaigns with independent Live, Paused and Draft state, dashboards, execution and analytics | Live site; `smoke.mjs` |
| Pausing one campaign does not stop the others; campaign, agent and channel pause and the global kill switch each stop exactly their own scope | Scheduler and lifecycle tests; smoke test |
| Create, edit, launch, pause, resume, complete, archive and duplicate a campaign, with a launch review | UI; campaign tests |
| The autonomous loop: discovery, research, ICP fitment, strategy, personalisation, approval, conversation, follow-up, each in its own error boundary | Scheduler tests; live site |
| Per-campaign knowledge with local embeddings, retrieval before decisions, and the retrieved sources in the journal | Retrieval tests; Decision Journal |
| Prompt versioning with messages, diff, compare, activate, roll back, pins and overrides; the version recorded on every decision; the prompt inspector | Prompt tests; UI |
| Approval levels (Manual, Assisted, Autonomous), meeting-time approval, escalation that always needs a human | Scheduler and campaign tests |
| Conflict handling (14-day rule, frequency cap, suppression list), hard limits, representatives with offboarding and reassignment | Conflict, limits and reps tests |
| The grounding check with one rewrite and a hard block on auto-send | Grounding tests |
| The reply router (opt-out, hostile, out-of-office without an LLM) | Router tests |
| Meeting scheduling: real times in the rep's hours, reading the answer, no double-booking, a calendar invite | Meetings tests; judge sandbox |
| The judge sandbox, search playground, real-data tests, runtime view, real contacts and the real-email panel | Dev tests; UI |
| The AI Efficiency panel, the Compare screen, campaign health and per-agent success by prompt version | Analytics tests; UI |
| **Real email sending through the Gmail API**, with human approval, an allow-list, truthful delivery status and a professional format | A real test email reached a real inbox; the sending path is covered against a fake Gmail |
| Sign-in, storage in JSON or Postgres with additive migrations and backups, one-service deployment on a live URL | Deployed site; storage tests |
| Model-outage behaviour: hold instead of reject, no invented people, every fallback recorded with its reason | Model-outage tests |

### 16.2 Partial

| Capability | What exists | What is missing |
|---|---|---|
| **DronaHQ agents in the decision path** | The agents are built and tested on the platform; the adapter is complete and tested against a fake webhook | The platform's webhook returned no agent output to our backend (section 7.4), so decisions run on Gemini with the rule engine as fallback |
| **Lead discovery** | Hand-entered real contacts, and an AI-imitated people search for simulated campaigns | Apollo or an equivalent live data provider |
| **Real email: the reply loop** | Sending is proven live. Reading replies, threading, bounce and auto-reply detection and approved replies are covered against a fake Gmail | An end-to-end reply exchange against live Gmail has not been recorded in the test suite |
| **SMS** | Twilio send and a signed reply webhook, tested against a fake Twilio | Not run against live Twilio |
| **Voice SDR** | The full turn-by-turn loop, opt-out handling and the human hand-off, tested against fakes | Not run on a live phone call; needs Twilio and a public URL |
| **LinkedIn** | Planned, approved and recorded | No sending; it is simulated by design |
| **Meetings** | Real times, a read answer, a booked slot and a calendar invite file | Reading the rep's real free and busy time, and writing to a live calendar. The only busy time known is the meetings the SDR booked itself |
| **The clock** | Hard limits work on a simulated clock (a day lasts 72 seconds by default) | Real-time operation is one setting away but is not what the demo runs on |
| **Knowledge coverage** | Product, case studies, playbooks, objection guides and canonical replies | Separate example-email and voice-script documents |
| **Prompt change control** | Attributed, versioned, revertable commits with messages | An approval gate before a prompt change goes live |
| **Embeddings on the free host** | Run fully in development and on hosts with memory | On the smallest free host the model can be switched off to fit memory, in which case retrieval falls back to keyword search and reply routing is not used |

### 16.3 Skipped, on purpose

| Item | Why |
|---|---|
| CRM sync (Salesforce, HubSpot, Sheets) | The Decision Journal and prospect records are the system of record; sync is a clean adapter on the roadmap |
| MCP and tool calling | Actions are performed by the orchestrator around the model, which keeps every action gated and auditable |
| A2A or an agent framework | The scheduler plus the shared dossier does the coordination in a way that can be inspected |
| LLM-as-judge evaluation | Human evaluation (the sandbox) and a golden set were higher value in 51 hours; on the roadmap |
| Fine-tuning | Not demonstrably worth it at this scale |
| A decision cache | Roadmap; embedding vectors are cached |
| Individual accounts and roles | A shared access code with a display name was enough for the demo; on the roadmap |
| A relational schema and a job queue | One state document was chosen for speed under the 51-hour clock (section 17) |
| Unsubscribe links | A reply of "unsubscribe" or "stop" works, and a `List-Unsubscribe` header is sent |
| Per-recipient time zones | Meeting times are in one configured time zone |

---

## 17. Known limitations and trade-offs

Every item below was a conscious choice under the 51-hour clock.

| Limitation | Why we accepted it | What we would do next |
|---|---|---|
| **State is one JSON document** (a file locally, one row in Neon) | Fastest path to a complete, deployable system; every feature could change the model without a migration | A relational schema with pgvector for embeddings; the additive-migration rule already protects data meanwhile |
| **A single scheduler process** | Simple, deterministic, easy to explain and test | A job queue with workers, and per-campaign leases |
| **Retrieval is in-process, not a vector database** | Free, fast at a few hundred chunks, one fewer service | pgvector on the existing Neon database when the corpus grows |
| **Embeddings can be off on the smallest free host** | The free tier's memory is small | A larger instance, or a hosted embedding endpoint |
| **The matching service is not called by the running app** | Its logic was re-implemented inside the Node backend to keep one deployment and avoid cross-service latency | Extract it again as a service if a second consumer appears; it is kept as tested reference |
| **Simulated prospects and replies in simulated campaigns** | No data provider and no budget; the imitated search still exercises every path | Apollo behind the same candidate shape |
| **Imitated data is unverified** | It is a model's imagination (or, for public figures, its recollection) | Real providers only for real campaigns; they are already separate |
| **A shared access code, not accounts** | Enough to protect a public demo and to record who acted | Individual accounts, roles and an audit log |
| **Library prompts are shared, campaigns are pinned** | Publishing a library version must never change a running campaign, so campaigns pin their version | An approval gate for library changes |
| **Free-tier Gemini and free hosting** | Zero cost | A paid key and a paid instance; the cap, rate limits and fallbacks are already in place |
| **The Gmail refresh token expires every 7 days in "Testing" mode** | Google's rule for unverified apps | A verified app or a service-side token refresh flow |
| **"Sent" means accepted by the provider** | Delivery tracking needs provider webhooks | Delivery and open tracking beyond the API's response |
| **Golden-set results are on 16 scored cases labelled by us** | It is a regression guard, not a benchmark | A larger, independently labelled set and an LLM-as-judge run |

**Trade-offs we would defend:** a working operable subset over breadth; local embeddings over a hosted vector database; a rule-engine safety net and a visible hold over failing or guessing when the model is unavailable; human approval for every real message over more autonomy; and telling the truth about what is simulated over a smoother demo.

---

## 18. How a judge can verify every claim

The brief says a working deployed link and a clean repository are how judges verify everything the report claims. This is a route through both.

### 18.1 On the live site

Open **https://drona-hq-buildathon.onrender.com/** (it may take up to a minute to wake).

1. **Command Center.** Three campaigns are Live, each with a different audience. Note the portfolio funnel, the KPIs and the **AI Efficiency** panel.
2. **Pause one campaign** from its card. Its numbers stop moving; the other two keep moving. Resume it.
3. **Open a campaign.** See the status, funnel, activity, the **SDR Blueprint**, prompts and harness, agents, reps and knowledge. Try **Launch review** on a draft.
4. **Open a prospect.** See the dossier, the plan, the conversation and the **hand-off notes**. Click **View prompt** on a note to see the exact prompt versions that agent ran with.
5. **Approvals.** Open a draft, read the recommendation and the grounding result. Approve one, or reject one and note that it asks for a reason.
6. **Decision Journal.** Open a decision: the agent, prompt version, evidence, retrieved sources and engine.
7. **Agents and Prompts.** Open an agent: its role, its fixed instruction, its versions; compare two; assemble a prompt for a campaign.
8. **Knowledge.** See the library; test retrieval with a question.
9. **Compare.** See campaigns side by side, campaign health, and each agent's success by prompt version.
10. **Dev, Judge sandbox.** Create a run (your own name works), press **Run the SDR**, then reply as the prospect. Ask for a time, then pick one. See the meeting, download the invite and read the scorecard.
11. **Dev, Real email and Runtime.** See what is really connected and what the last model error was.
12. **Settings.** Try the channel and agent switches and read the suppression list. The **kill switch** is in the top bar.

### 18.2 In the repository

```
git clone https://github.com/sinanvk314/Drona-HQ-Buildathon
cd Drona-HQ-Buildathon/backend && npm install && npm test        # 187 tests, offline
node scripts/smoke.mjs https://drona-hq-buildathon.onrender.com/ 40   # the pause-isolation demonstration
node scripts/eval-icp.mjs                                          # the ICP golden set (rule engine)
```

Read, in this order: `README.md`, `docs/SYSTEM_GUIDE.md`, `backend/src/services/sdrSteps.js` (the pipeline), `scheduler.js` (the loop and its gates), `agentEngine/index.js` (the chain), `grounding.js`, `channels/dispatch.js`, `test/`.

### 18.3 An index from claims to evidence

| Claim | Where to see it |
|---|---|
| Independent campaigns, pause isolation | Live site; `scripts/smoke.mjs`; `test/scheduler.test.js` |
| Matching versus judgment; no-LLM decisions | `services/agentEngine/index.js` (shortcut); `replyRouter.js`; `rag.js` |
| Grounding | `services/grounding.js`; `test/grounding.test.js` |
| Prompt versions and the inspector | `services/prompts.js`, `data.js` (`inspectPrompt`); `test/prompts.test.js` |
| Cost controls and usage | `services/usage.js`; `test/costControl.test.js` |
| Meetings | `services/meetings.js`; `test/meetings.test.js` |
| Real email | `services/channels/gmail.js`, `dispatch.js`; `test/real.test.js` |
| Voice SDR | `services/channels/voice.js`; `test/real.test.js` |
| Model-outage policy | `services/scheduler.js`; `test/llmdown.test.js` |
| Analytics by prompt version | `services/performance.js`; `test/performance.test.js` |
| DronaHQ adapter | `services/agentEngine/dronahqEngine.js`; `test/dronahqEngine.test.js`; `docs/dronahq/` |
| Storage and migrations | `db/`; `test/storage.test.js` |

---

## 19. Team, process and timeline

### 19.1 Who did what

| Person | Focus |
|---|---|
| **Shubh Gupta** | The control-plane UI (the DronaHQ Studio application) and the first backend: the API, the scheduler that advances prospects on its own, and the campaign lifecycle |
| **Mohammed Sinan** | The intelligence layer: the matching and reply-routing logic, the agents and their prompts, retrieval, the engine chain (DronaHQ, Gemini, rules), cost control, the DronaHQ integration and its investigation, the extension of the control plane (prompt management, reps, analytics, the Dev tab), real channels (Gmail, Twilio, Voice), deployment, documentation and testing |
| **A third teammate** | Product planning and the wireframes that shaped the screens |

### 19.2 How the build unfolded

| Phase | What happened |
|---|---|
| **1. Foundations** | The matching-versus-judgment split was decided; the shared agent output contract was written; a standalone matching service was built and tested (three endpoints, 13 tests); the control-plane UI and a first backend took shape in parallel |
| **2. Integration** | The two halves were brought together on one branch; a decision was made that the **Node backend and its scheduler are the system of record** (two orchestrators existed), and the matching logic was moved inside it; the DronaHQ engine was added; the agent in DronaHQ was built and tested in the Playground |
| **3. The DronaHQ investigation** | The webhook output problem was diagnosed in depth through Postman-style probes, the platform's Traces and the Structured Output tooling (section 7.4); Gemini was added as an engine so the loop did not wait on it |
| **4. Hardening** | Hard limits, representatives, approval levels, prompt versioning with pins, grounding, sign-in, conflict handling, the launch review, per-campaign agent pause; and cost control and the efficiency panel |
| **5. Deployment** | Docker, Render, Neon, UptimeRobot; additive migrations and backups after an early reseed wiped a campaign; the README and the system guide |
| **6. Intelligence and realism** | The Research agent, the SDR Blueprint and dossier, the imitated people search, one-person campaigns, meeting scheduling, the judge sandbox and the Dev tab |
| **7. Measurement** | Per-agent success by prompt version, campaign health, the knowledge library, prompt commits and the inspector, the Agents and Prompts screen |
| **8. Real channels** | Real versus simulated per campaign, real contacts, Gmail, Twilio, the Voice SDR, and the safeguards; then fixes from using it (section 8, E27) |
| **9. Polish and submission** | The interface pass, model-outage behaviour, the demo campaigns and demo script, this report |

### 19.3 What we learned

- **Decide the seams early.** The engine interface and the shared output contract let three people work in parallel and let us swap DronaHQ, Gemini and the rules without touching the screens.
- **Use the thing you built.** The most valuable bugs (a reply thrown away, an approved reply never sent, emails that read like templates, everything rejected when the model was down) were found by using the system, not by reading it.
- **Make failure a first-class state.** "Held, because the model did not answer" is a better product than "rejected" or "crashed".
- **Say what is simulated.** The honest label cost us nothing and made everything else believable.

---

## 20. Appendices

### Appendix A. Environment variables (the ones that matter)

Every variable has a working default; `backend/.env.example` is the full annotated list.

| Variable | Purpose |
|---|---|
| `AGENT_ENGINE` | The engine chain, for example `gemini`, `dronahq,gemini`, or `rule`; the rule engine is always last |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Google Gemini access and the ordered list of models |
| `GEMINI_RPM`, `LLM_DAILY_CALL_CAP` | The per-minute rate limit and the hard daily cap on model calls |
| `ICP_SHORTCUT_MARGIN` | How far below the threshold a score must be for a clear rejection without a model |
| `EMBEDDINGS`, `REPLY_ROUTING` | Turn local embeddings and reply routing on or off |
| `DATABASE_URL` | Neon Postgres; if unset, a local JSON file is used |
| `APP_ACCESS_CODE`, `AUTH_SECRET` | Sign-in and the session-signing secret |
| `ALLOWED_ORIGINS`, `PORT` | CORS and the port |
| `SIM_MS_PER_HOUR`, `ENFORCE_LIMITS`, `SIM_REPLY_CHANCE` | The simulated clock, hard limits, and the simulated reply rate |
| `SCHEDULER_INTERVAL_MS`, `SCHEDULER_BATCH_SIZE` | How often the loop runs and how many prospects per campaign per tick |
| `MEETING_TIMEZONE`, `MEETING_MINUTES` | Meeting time zone and length |
| `REAL_SENDING`, `REAL_AUTO_SEND`, `REAL_SEND_ALLOWLIST`, `PUBLIC_URL` | The real-sending master switch, the human-approval override, the recipient allow-list and the public address |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, `GMAIL_POLL_MS` | Gmail API credentials and the inbox polling interval |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_VOICE_FROM` | Twilio credentials and numbers |
| `DRONAHQ_*` | The DronaHQ webhook URLs and keys, only if the chain includes `dronahq` |

### Appendix B. The API by area (79 endpoints, plus 4 signed webhooks)

| Area | What it covers |
|---|---|
| **Auth** | Sign-in configuration, login, current user |
| **Campaigns** | Create, read, update, duplicate; launch, pause, resume, complete, archive; the launch review; the blueprint; persona; reps; knowledge sources |
| **Prompts and agents** | Library agents and versions; activate a version; per-campaign pins, campaign system prompt versions, overrides; the prompt inspector |
| **Prospects and approvals** | Prospects and their detail; the approvals queue, edit, and decide; the meeting invite download |
| **Journal and analytics** | Decisions; comparison; per-agent performance and campaign health |
| **Knowledge** | The cross-campaign library, add, attach, detach, retrieval test |
| **Representatives** | List, create, update, offboard, reassign |
| **Settings** | Kill switch, agent and channel switches, the suppression list, integrations status |
| **Dev** | Sandboxes (create, run, reply, feedback, delete), search, real-data tests, real contacts, real email diagnostics, Gemini test, runtime |
| **Webhooks (signed)** | Twilio SMS replies and the three voice callbacks |

### Appendix C. Glossary

| Term | Meaning |
|---|---|
| **ICP** | Ideal Customer Profile: who a campaign is aimed at |
| **Matching** | A decision about how alike two things are; settled by embeddings or rules |
| **Judgment** | A decision that needs evidence and reasoning; made by a model |
| **Engine** | Something that can decide for an agent: DronaHQ, Gemini, Anthropic or the rule engine |
| **Engine chain** | The order engines are tried in; the rule engine is always last |
| **Dossier** | The shared record of facts, reasons to reach out, gaps and hand-off notes for one prospect |
| **Hand-off note** | One or two sentences an agent writes after acting, for the next agent |
| **Harness / harness label** | The prompt versions an agent ran with, for example `v3.2 + campaign prompt v2` |
| **Pin** | A campaign's fixed choice of which library prompt version each agent uses |
| **Grounding check** | A deterministic check that a draft makes no claim its sources do not support |
| **Reply router** | The embedding-based settling of clear-cut replies with no model |
| **Imitated search** | The model acting as a people-search tool to produce fictional prospects |
| **Real / simulated** | Whether a campaign's people and messages are real (entered by hand, really sent) or invented and never sent |
| **Sandbox** | A test run in which a real person plays the prospect |
| **Approval level** | Manual, Assisted or Autonomous: how much a human must approve |
| **Kill switch** | The global control that stops all autonomous external action |

### Appendix D. Key decisions and the alternatives we rejected

| Decision | Alternative | Why we chose this |
|---|---|---|
| Split every decision into matching and judgment | Ask the model everything | Cost, speed, and correctness of hard rules |
| Local embeddings (`bge-small`) | OpenAI embeddings | No budget for billing; no key; works offline; fast enough |
| The Node scheduler as the system of record | Two orchestrators (Node and Python) | The UI already spoke the Node API; one orchestration to explain and test |
| Re-implement matching inside Node | Call the Python service | One deployment, no cross-service latency |
| An engine chain ending in a rule engine | One provider | The loop never stalls; failures degrade visibly |
| Gemini in the decision path | Waiting on the DronaHQ webhook | The brief prefers a working end-to-end system over one blocked on a platform behaviour |
| A shared dossier | Message passing between agents | Durable, inspectable and one memory for all channels |
| Hold, do not reject, when the model is down | Fall back to rules for everything | A guess that rejects a real prospect is worse than a delay |
| A human approves every real message | Trust the approval level | Real people are involved; the cost of a wrong send is high |
| An LLM imitating a people search | Random name lists; waiting for Apollo | Realistic, campaign-specific data at no integration cost, behind a drop-in shape |
| One state document | A relational schema | Speed under a 51-hour clock; additive migrations protect the data |
| An audit trail for prompt changes | An approval gate | Faster iteration with full accountability; a gate is on the roadmap |

# Roadmap: what is not built yet

Everything below is **not implemented**. It is ordered by how much it moves the product toward a real autonomous SDR. For how the
current system works, read [SYSTEM_GUIDE.md](SYSTEM_GUIDE.md) first; the "where to start" hints refer to files described there.

Effort guide: **S** = a few hours, **M** = about a day, **L** = several days.

## Contents

1. [Make it real: sending, replies and discovery](#1-make-it-real-sending-replies-and-discovery)
2. [Agents still to build](#2-agents-still-to-build)
3. [DronaHQ](#3-dronahq)
4. [Platform and security](#4-platform-and-security)
5. [Product features](#5-product-features)
6. [Quality and operations](#6-quality-and-operations)
7. [Checklist before sending to real people](#7-checklist-before-sending-to-real-people)
8. [Housekeeping](#8-housekeeping)

---

## 1. Make it real: sending, replies and discovery

Today nothing leaves the server: sends and replies are simulated, and prospects are made up.

### 1.1 Real email sending and replies (M to L)
- **What:** send an approved message from the rep's mailbox, and receive replies into the conversation.
- **How:** Gmail API (OAuth per rep) or SMTP for sending. For replies, poll the mailbox or use a push notification, match the
  reply to a prospect by thread or address, and call the same path the simulator uses.
- **Where to start:** the one place a message is "sent" is `recordTouch` in `services/outreach.js`. Put the real send behind it
  (behind a `SEND_MODE=live` switch, default off). For replies, replace `simulateReply` in `services/scheduler.js` with a function
  that reads real inbound messages and calls the existing routing (`replyRouter.js`, then the Conversation agent).
- **Done when:** an approved email arrives in a test inbox from the rep's address, a reply appears in the prospect's conversation, and an unsubscribe reply suppresses the person.
- **Read section 7 first.**

### 1.2 SMS (S to M)
- Twilio (a trial account only sends to verified numbers). Same place as email: `recordTouch`. Add inbound webhook for replies.

### 1.3 LinkedIn (L, and a policy question)
- LinkedIn has no official API for messaging prospects, and automating it can break its terms. Options: a third-party service you
  are allowed to use, or keep LinkedIn as a *task for a human* (the agent drafts, the rep sends manually). Decide before building.

### 1.4 Real prospect discovery (M)
- **What:** replace the synthetic generator with real companies and people.
- **How:** an Apollo (or similar) API adapter, and/or a **CSV import** so the team can load real leads.
- **Where to start:** `services/prospectGenerator.js` is the only place prospects are created; keep its return shape. Add a CSV upload endpoint (`routes/index.js`, `data.js`) and a button on the campaign page. Remove the random funnel bumps in `runLeadResearch`.

### 1.5 Booking a meeting for real (S to M)
- Today a meeting is a state change. Add: propose times from the rep's calendar (Google Calendar API), send an `.ics` invite, store the meeting on the prospect, and produce the `opportunity` stage (which only seeded data reaches now).
- **Where to start:** the `meeting` branch in `runConversation` (`scheduler.js`) and `decideApproval` in `data.js`.

### 1.6 CRM sync (M)
- Push contacts, touches, meetings and outcomes to HubSpot, Salesforce or a Google Sheet. Start with a one-way push from `recordTouch` and the meeting booking.

## 2. Agents still to build

### 2.1 Voice SDR agent (L)
- **What:** conducts a call, qualifies, handles objections, escalates.
- **How:** DronaHQ has a voice agent platform with an outbound dispatch API (`voice/outbound/dispatch`, documented under Developer
  and API keys); or Twilio plus a voice AI service. A first version can be a scripted call *simulation* that produces a transcript,
  an outcome and an escalation, clearly labelled as simulated.
- **Where to start:** the `voice` agent already exists in the seed (switched off). Add a schema and prompt in `geminiEngine.js`, a
  function in `agentEngine/index.js`, and let the Strategy agent's plan use `voice` as the last touch (it already can).

### 2.2 Lead Research as a real agent (M)
- **What:** given a company and person, produce structured, cited research (funding, hiring, tech, recent news) into the dossier.
- **How:** Gemini with Google Search grounding, or another search API, with a schema for the result and source links.
- **Where to start:** `ruleEnrich` in `ruleEngine.js` is today's stand-in. Add a `researchProspect` function next to `scoreICP` in `agentEngine/index.js`, and store citations in `prospect.evidence`.

### 2.3 LLM-as-judge for drafts (S to M)
- Score drafts for personalisation and grounding with a second model call, offline, on a fixed set. Extends `eval/` (add `eval/drafts-golden.json` and a runner beside `eval/icpEval.js`). Do not put it in the live path (it doubles cost).

### 2.4 Decision cache (S)
- Do not re-ask the LLM the same question. Key on prompt version + campaign config + prospect facts. Put it in `agentEngine/index.js` around `withFallback`; count hits in `usage.js`.

### 2.5 Golden sets and evaluation for the other agents (M)
- Only ICP has a golden set. Add sets for reply handling (`replyRouter.js` precision and recall on labelled replies), strategy and follow-up.

### 2.6 Tool calling, MCP, agent-to-agent (M to L)
- The brief mentions them as options. Today agents return structured JSON; none call tools. If you add one, start with a "look up this company" tool for the research agent.

## 3. DronaHQ

### 3.1 Get the agent output back from the webhook (blocked on DronaHQ)
- **Problem:** the webhook trigger runs the agent and returns `success: true` but `response: null`, even with Response = Standard, for
  a brand-new agent, and in DronaHQ's own Test button. Notes: `docs/dronahq/`, `backend/scripts/dronahq-probe.mjs`.
- **Options:** (a) an answer from DronaHQ; (b) an **Automation** that calls the agent and returns its output in the automation's own
  response; (c) have the agent post its JSON to a URL on our backend (needs an HTTP or code tool in the agent builder) and make the
  backend wait for it.
- **Where to start:** `services/agentEngine/dronahqEngine.js` (`callWebhook`, `parseAgentOutput`) and the `AGENT_ENGINE` chain.
- **Done when:** with `AGENT_ENGINE=dronahq,gemini`, a decision made by a DronaHQ agent shows `engine: dronahq` in the journal.

### 3.2 Make DronaHQ central, not decorative (M)
- The judging brief wants DronaHQ used meaningfully. Beyond 3.1, options: run the Follow-up or Lead Research agent on DronaHQ, or use DronaHQ Automations for workflows, or its voice agent for calls.

## 4. Platform and security

### 4.1 Real accounts, roles and an audit log (M to L)
- Today: a shared access code plus a display name. Add per-user accounts (email login or single sign-on), roles (admin, manager,
  viewer), and an audit log of who did what (the `promptLog`, events and `decidedBy` fields are a start).
- **Where to start:** `services/auth.js` (tokens), `db` (a `users` collection), and permission checks in `routes/index.js`.

### 4.2 Approval for prompt changes (S)
- The brief lists it as a design question. Add a "pending" state to a campaign prompt version that a second person must activate. Code: `services/prompts.js` and `data.js` prompt functions.

### 4.3 Security hardening (S to M)
- Security headers (helmet), rate limiting on the whole API (only login attempts are limited now), input size limits per route, dependency audit, secrets in a secret manager, HTTPS-only cookies if you move the token to cookies.

### 4.4 Relational database (M to L)
- Move from one JSON row to proper tables (campaigns, prospects, touches, decisions, approvals, reps) so data can be queried,
  reported on, and shared. Use `pgvector` for the knowledge vectors. Keep `getState`/`withState` as the seam (`db/index.js`) or replace them with queries per operation.

### 4.5 Scale beyond one process (L)
- The scheduler and state live in one process. To run more than one copy, move the loop to a job queue with per-campaign
  locks, store state in the database (4.4), and let the API be stateless. Until then, run exactly one instance.

### 4.6 Time zones (S to M)
- Working hours are on the simulated clock. For real use, work in the prospect's or the rep's local time (`services/simTime.js`, `limits.js`, `reps.js`).

## 5. Product features

- **Analytics over time (M):** charts of funnel, reply rate and cost by day and by campaign. Needs stored daily snapshots (`usage.js` keeps only today).
- **Experiment statistics (M):** significance for a campaign against its variant (the Compare screen shows numbers, not confidence).
- **Notifications (S):** email or Slack when an escalation arrives or a campaign has no active rep.
- **Upload real documents (M):** PDF and DOCX text extraction for knowledge sources (today: paste text or upload `.txt`/`.md`).
- **Bulk approvals (S):** approve many drafts at once, with the grounding warnings visible.
- **Prospect page controls (S):** manually pause one prospect, reassign the rep, move the stage.
- **Templates (S):** start a campaign from a template (ICP, prompts, knowledge) instead of a copy of an existing one.
- **Mobile layout (M):** the app is built for desktop (minimum width 1200px).
- **Voice and SMS example messages (S):** more content in `data/knowledge/`.

## 6. Quality and operations

- **CI (S):** a GitHub Action that runs `npm test` and `npm run build` on every push.
- **Browser tests (M):** Playwright for the main flows (login, launch, pause one campaign and check the others, approve a draft).
- **Type checking or linting (S):** at least ESLint; consider TypeScript for `data.js`, which is large (about 1,000 lines) and worth splitting by area (campaigns, prompts, reps, approvals).
- **Monitoring (S):** structured logs and an error tracker; alert when the scheduler stops ticking or when the LLM cap is hit.
- **Backups (S):** scheduled export of the state row.
- **Load test (S):** how many campaigns and prospects one process handles; the state is saved in full after each change.

## 7. Checklist before sending to real people

Do not turn on real sending until all of these exist:

- [ ] An **unsubscribe** path on every message, and inbound opt-outs suppress the person everywhere (the router already adds them to the suppression list; verify with real mail).
- [ ] A lawful basis and rules per region (for example consent rules for cold outreach in some countries), agreed with whoever owns compliance.
- [ ] **Bounce and complaint handling**: stop sending to addresses that bounce or complain.
- [ ] **Sending limits and warm-up** per mailbox, so a rep's domain is not damaged.
- [ ] A **test mode**: send only to an allowlist of team addresses (`SEND_MODE=allowlist`) before anything reaches a real prospect.
- [ ] Every real send goes through the Approvals queue at first (keep campaigns on the Manual level until reviewed).
- [ ] Real accounts and an audit log (section 4.1).
- [ ] The grounding check tuned on real drafts; add checks for anything a human reviewer keeps correcting.

## 8. Housekeeping

- `matching-service/` is reference code that the running app does not use. Either delete it or wire in its triage and contact-matching once discovery is real.
- `agentEngine/llmEngine.js` (Anthropic) is unused by default and does not cover the Strategy and Follow-up agents. Extend it or delete it.
- `data.js` is too large; split it by area.
- The seeded demo data (three campaigns, NimbusGuard) is for demos. Provide a clean "empty workspace" option for real use.
- `docs/dronahq/` holds the DronaHQ agent instructions and the schemas that were tried; remove them if DronaHQ is dropped.

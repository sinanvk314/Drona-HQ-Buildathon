# Drona-HQ-Buildathon — project context for Claude Code

Read this fully before making changes. This is a 51-hour hackathon build
(Tech Contingent IIT Madras × DronaHQ). Team: Dev 1 (control plane/backend,
Postgres/Neon), Dev 2 (integrations/channels/approvals UI/deployment),
Sinan (me — AI/ML: all agents + matching service). A separate teammate
did product planning (wireframes).

## The one-line pitch
An autonomous, multi-channel SDR system with two halves that must work as
one product: a control plane (human manages campaigns) and an intelligence
layer (AI agents research/qualify/personalize/contact/follow-up). Built
primarily on DronaHQ's Agentic AI platform (agents.dronahq.com), but
judges require real, team-authored code underneath it — not just a
DronaHQ wrapper.

## The core architectural decision: matching vs. judgment
Every decision in the pipeline is one of two kinds:
- **Matching** — how alike are two things? Pure geometry (cosine
  similarity on embeddings), no LLM needed. Handled by `matching-service/`
  (this repo, standalone Python/FastAPI).
- **Judgment** — given evidence, what's the right call, and can I explain
  why? Needs an LLM with reasoning. Handled by DronaHQ agents.

This split exists for two reasons: cost (don't burn an LLM call on
something a cosine check settles) and correctness (numeric thresholds
like "200-2000 employees" or a hard disqualifier don't survive being
turned into an embedding — similarity should never make that call).

## The full pipeline, in order
1. **Similarity Triage** (matching-service, NOT an agent) — before any
   agent touches a raw sourced company (from Apollo/equivalent), rank it
   against the campaign's ICP by embedding similarity. Only top-N become
   real prospects. Nothing reasons here.
2. **Lead Research & Enrichment Agent** (DronaHQ) — first agent to touch
   a prospect. Reads the ICP checklist (same fields as Fitment uses,
   but as a verification checklist, not a scoring rubric). Calls
   matching-service's `/match/contact` to get a pre-selected best-guess
   contact at the company, then VERIFIES that guess using the Knowledge
   Base — the embedding match is a starting point, never a decision the
   agent blindly trusts. Also runs the ONE-TIME conflict_check and
   suppression-list check for this prospect (cached in the Dossier so
   nobody re-checks it later). Writes the first Prospect Dossier entry.
3. **ICP Fitment Agent** (DronaHQ, already built and tested) — reads the
   WHOLE Dossier (not raw prospect fields), judges fit against ICP,
   checks disqualifiers, decides Qualified / Rejected / Escalate. Never
   re-runs conflict_check — reads it from the dossier.
4. **Outreach Strategy Agent** — decides channel/timing within campaign
   config (daily limits, enabled channels are hard constraints, not
   agent decisions). Doesn't write anything customer-facing.
5. **Personalisation/Email Agent** — drafts the message using Dossier +
   Knowledge Base. Never sends directly — always lands in the Approvals
   queue first.
6. **Approvals Queue** (control plane, human) — approve/edit/reject.
   Only approval triggers an actual send.
7. **Conversation Agent** — reads replies. Before it runs, matching-
   service's `/classify/reply` checks if the reply is a clean-cut case
   (unsubscribe/hostile/out-of-office) via embedding similarity against
   canonical example replies from the Knowledge Base — those route
   DETERMINISTICALLY, no LLM call. Only genuinely ambiguous replies
   (objection, question, positive) reach the full Conversation Agent.
8. **Follow-up Agent** — mostly cadence policy (days-since-last-contact
   vs. campaign touch limits), not really a judgment call. Re-checks
   suppression list too, in case someone was added mid-campaign.
9. **Voice SDR Agent** (stretch) — off to the side, reachable from
   Strategy (if channel=voice) or Conversation (escalate a hot lead).

## The Prospect Dossier — the thing that makes this feel like ONE SDR
Every agent reads the WHOLE dossier before acting and writes a
`handoff_note` (1-2 sentences, plain SDR voice) after acting. This is
what prevents the system from feeling like five disconnected bots
stapling reports together. Lives in Dev 1's Postgres as JSONB, one row
per prospect.

## Shared JSON output shape (every DronaHQ agent uses this)
```json
{
  "agent_name": "...", "harness_version": "...",
  "decision": "...", "fit_score": 0-100 or null,
  "evidence": ["..."], "retrieved_knowledge": ["..."],
  "campaign_instruction_excerpt": "...", "conflict_check": "...",
  "final_action": "...", "handoff_note": "..."
}
```
Feeds the Decision Journal and Prospect Detail screens. Every agent
obeys the same injected `//GUARDRAILS//` and `//ESCALATION_RULES//`
campaign-level variables (never re-typed per agent).

## The Orchestrator (custom code, NOT decided yet who owns it)
Sits outside DronaHQ entirely. Before invoking any agent, checks 4 gates:
campaign Live?, agent enabled?, channel enabled?, global kill switch off?
Then loads campaign config, calls the DronaHQ agent API with `//VARIABLE//`
overrides + current Dossier, appends the result to `dossier_entries`, logs
to `decision_journal`, advances funnel status. NOT YET BUILT. Natural
overlap between Dev 1 (owns lifecycle/Postgres) and this repo (owns agent
contracts) — needs explicit assignment.

## matching-service/ — what's actually in this repo
Standalone FastAPI service, fully separate from DronaHQ. Three jobs:
- `/triage/rank-companies` — ranks candidate companies against campaign ICP
- `/match/contact` — best-matching contact at a company for target persona
- `/classify/reply` — routes clean-cut replies without an LLM call

**Embeddings run 100% locally via `fastembed`** (ONNX-based, model
`BAAI/bge-small-en-v1.5`, 384-dim) — NOT OpenAI. We deliberately moved
off OpenAI because there's no budget for API billing. No API key needed
at all, just `DATABASE_URL` in `.env`. First real use downloads the model
(~130MB) from huggingface.co, then it's cached and offline after that.

Status: all 13 mock-based tests pass (`pytest tests/`). Real semantic
test (`tests/test_real_embeddings.py`) is written but needs to actually
run on a machine with real internet access to huggingface.co to confirm.
`/triage/rank-companies` needs Dev 1's real `campaigns` table to exist
with matching column names (see comment in `sql/schema.sql`) before it's
testable — `/match/contact` and `/classify/reply` don't depend on that.

## Database
Neon Postgres (pgvector extension enabled). `candidate_companies` table
already created via Neon's SQL Editor (see `sql/schema.sql`). Real
`campaigns`/`prospects`/`decision_journal`/`approvals_queue`/
`suppression_list` tables are Dev 1's responsibility — not yet confirmed
built as of this handoff.

## Hackathon rubric context (why some choices were made)
DronaHQ Usage is mandatory but judges explicitly want real engineer-
authored code underneath it — this matching-service is the clearest
answer to that. Measurement & Optimisation and cost-efficiency are
scored categories — the matching/judgment split and the free local
embeddings are both direct answers to "how do you keep cost down."
Required demo: 3+ concurrent campaigns, prove pausing one doesn't stop
others (this is what the Orchestrator's gate-checks exist to guarantee).

## Working style notes
Sinan is working through this largely via Windows CMD, not deeply
experienced with git yet (has been manually re-uploading zips to GitHub
via the web UI rather than using git commands — worth fixing with real
git once things stabilize). Prefers concrete, exact commands over
abstract explanations. Treat any credential appearing in chat/screenshot
history as already rotated — don't reuse old key/password values seen
in past context.

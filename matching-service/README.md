# SDR Matching Service

> **Status: reference code, not used by the running app.** The deployed system is the Node backend in `backend/`.
> Its reply routing (`backend/src/services/replyRouter.js`) and embedding retrieval (`backend/src/services/rag.js`)
> are ports of this service's `/classify/reply` and retrieval logic, using the same model. Candidate-company triage and
> contact matching (`/triage/rank-companies`, `/match/contact`) are not wired in, because prospect discovery is
> simulated. This folder is kept as the tested reference for sourcing at scale.

The custom, non-DronaHQ layer that handles every *similarity* decision in
the pipeline — as opposed to every *judgment* decision, which stays inside
DronaHQ agents. This is a deliberate split:

| Decision | Why it lives here, not in an LLM agent |
|---|---|
| Which sourced companies are worth researching (**triage**) | Ranking by fit is a geometric nearest-neighbor problem, not reasoning. Filtering before an LLM ever runs is also what keeps cost per prospect down. |
| Which contact at a company matches the target persona (**contact match**) | Same reason — picking the closest title match doesn't need reasoning, only verifying the pick does (that stays in the Research agent). |
| Whether an inbound reply is a clean unsubscribe/hostile/out-of-office case (**reply classify**) | These need a deterministic, auditable routing decision, not a probabilistic LLM judgment call. Ambiguous replies (objections, questions, positive) are intentionally *not* short-circuited here — they still go to the full Conversation Agent, which needs to reason and draft a response. |

## Where this fits in the pipeline

```
Apollo/sourcing → [THIS SERVICE: triage] → Research & Enrichment (LLM)
                                              ↑ uses [THIS SERVICE: contact match]
                                              ↓
                                          ICP Fitment (LLM) → ... → Send
                                              ↓
                                       inbound reply → [THIS SERVICE: classify]
                                              ↓                    ↓
                                    deterministic?          ambiguous?
                                    (auto-route,             Conversation
                                     no LLM call)            Agent (LLM)
```

The Orchestrator (Dev 1/Dev 2's side) calls this service's endpoints at
each of those points, then calls the relevant DronaHQ agent with the
result attached to the prospect's Dossier.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env    # fill in DATABASE_URL; embeddings need no API key
```

Run the pgvector schema against the same Neon database the rest of the
team uses (adjust table/column names in `sql/schema.sql` and `app/db.py`
if Dev 1's actual `campaigns` table differs from what's assumed here):

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

Start the service:

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive API docs then live at `http://localhost:8000/docs`.

## Testing — two tiers

**Tier 1 — no credentials needed, run this first:**

```bash
pytest tests/ -v
```

13 tests cover the actual ranking/matching/classification logic using a
deterministic mock embedder (`embed_text_mock`) instead of a real API call.
These prove the *plumbing* is correct — sorting, thresholds, the "no
confident match" and "ambiguous stays non-deterministic" cases — without
needing `OPENAI_API_KEY` or `DATABASE_URL` set at all.

**Tier 2 — once you have a Neon connection (no API key needed):**

```bash
curl -X POST http://localhost:8000/match/contact \
  -H "Content-Type: application/json" \
  -d '{
    "target_persona": "VP of Supply Chain",
    "contacts": [
      {"id": "c1", "name": "Priya Raghavan", "title": "VP of Supply Chain"},
      {"id": "c2", "name": "Sam T", "title": "Marketing Intern"}
    ]
  }'
```

should return `c1` with a high score. This is the point to sanity-check
that *real* embeddings separate genuinely similar and dissimilar text —
the mock embedder intentionally can't prove that, only real embedding calls
can. The first real call downloads the model (~130MB) from huggingface.co;
after that it's cached and runs fully offline.

`/triage/rank-companies` additionally needs rows in `candidate_companies`
and a real `campaigns` row to read ICP fields from — wire this up once
Dev 1's campaign table has real data in it.

## Endpoints

- `GET /health`
- `POST /triage/rank-companies` — `{campaign_id, top_n?}` → ranked companies above similarity threshold, embedding any unembedded candidates first
- `POST /match/contact` — `{target_persona, contacts: [...]}` → best-matching contact, or `null` if nothing clears `CONTACT_MATCH_MIN_SCORE`
- `POST /classify/reply` — `{reply_text, categories: {name: [examples]}}` → `{category, score, deterministic}`

## Tuning

All thresholds live in `app/config.py`, overridable via `.env`:

- `TRIAGE_TOP_N_DEFAULT` — how many companies triage keeps per run
- `CONTACT_MATCH_MIN_SCORE` — below this, no match is returned (Research marks persona "unknown" rather than guessing)
- `REPLY_HIGH_CONFIDENCE_SCORE` + `DETERMINISTIC_CATEGORIES` — controls how conservative the no-LLM-call routing is

None of these are guesses that should ship untouched — once you have real
embeddings running against real data, pull actual score distributions and
re-tune. Starting values here are reasonable defaults, not calibrated ones.

## Folder structure

```
app/
  main.py                    FastAPI routes
  config.py                  every tunable threshold, env-driven
  embeddings.py               local fastembed wrapper + mock embedder for testing
  similarity.py               pure cosine-similarity math (no deps beyond numpy)
  db.py                       Postgres/pgvector queries
  schemas.py                  request/response models
  services/
    triage.py                 company ranking against campaign ICP
    contact_match.py          best-contact selection at a company
    reply_classify.py         reply routing (deterministic vs. needs-LLM)
sql/schema.sql                pgvector tables/columns to add to Dev 1's DB
tests/
  test_similarity.py           pure math tests, no credentials needed
  test_services_with_mock.py  service-layer tests using the mock embedder
```

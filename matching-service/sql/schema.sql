-- pgvector setup for the Matching Service, plus a `campaigns` table.
-- Run this against the SAME Neon database Dev 1 uses for campaigns/prospects.
--
-- campaigns does NOT exist yet in Neon as of this writing (confirmed via
-- to_regclass('campaigns') = NULL), so it's defined here for real rather
-- than as a comment, to unblock /triage/rank-companies. This is Dev 1's
-- table long-term — they own campaign lifecycle/control-plane logic, so
-- treat this as a proposal: if they already have a design in progress,
-- reconcile column names with app/db.py's fetch_campaign_icp_text()
-- instead of forcing them to match this file.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per campaign. Fields below cover: the ICP checklist every agent
-- reads (target_* / must_have_signals / disqualifiers), two of the
-- Orchestrator's four gate checks (campaign Live?, agent enabled?, channel
-- enabled? — the fourth, the global kill switch, is system-wide, not
-- per-campaign, and belongs in its own settings table, not here), and the
-- //GUARDRAILS// / //ESCALATION_RULES// variables injected into every
-- DronaHQ agent call.
CREATE TABLE IF NOT EXISTS campaigns (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'live', 'paused', 'archived')),

    -- ICP checklist — read by matching-service's triage AND re-verified
    -- (not re-scored) by every downstream agent.
    target_industry     TEXT,
    company_size_min    INTEGER,
    company_size_max    INTEGER,
    target_persona      TEXT,
    target_geography    TEXT,
    must_have_signals   TEXT,
    disqualifiers       TEXT,             -- hard disqualifier rules, checked by ICP Fitment Agent

    -- Orchestrator gate checks + Outreach Strategy hard constraints.
    enabled_agents      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"research": true, "fitment": true, ...}
    enabled_channels    TEXT[] NOT NULL DEFAULT '{}',        -- e.g. {email,voice} — hard constraint, not an agent decision
    daily_send_limit    INTEGER NOT NULL DEFAULT 50,

    -- Injected verbatim into every agent's //GUARDRAILS// / //ESCALATION_RULES//
    -- so they never need re-typing per agent.
    guardrails          TEXT,
    escalation_rules    TEXT,

    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);

-- Raw sourced companies, pre-triage. Nothing has reasoned about these yet.
CREATE TABLE IF NOT EXISTS candidate_companies (
    id              SERIAL PRIMARY KEY,
    campaign_id     INTEGER REFERENCES campaigns(id),  -- nullable: a shared pool sourced once, filtered per campaign
    name            TEXT NOT NULL,
    industry        TEXT,
    employee_count  INTEGER,
    description     TEXT,
    raw_data        JSONB,                -- full payload from Apollo/whatever source
    embedding       vector(384),          -- filled in lazily by triage.py on first run (fastembed bge-small)
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for fast approximate nearest-neighbor search at scale.
-- Cosine distance to match the <=> operator used in db.py.
CREATE INDEX IF NOT EXISTS candidate_companies_embedding_idx
    ON candidate_companies USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS candidate_companies_campaign_idx
    ON candidate_companies (campaign_id);

-- If candidate_companies was already created against the old OpenAI
-- dimension (1536), migrate it before running triage against fastembed
-- (safe to skip if the column is already vector(384) — check first with
-- \d candidate_companies):
--   ALTER TABLE candidate_companies ALTER COLUMN embedding TYPE vector(384);
--   UPDATE candidate_companies SET embedding = NULL;  -- old vectors are the wrong dimension AND wrong model, must re-embed

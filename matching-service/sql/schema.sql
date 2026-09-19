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
    location        TEXT,                 -- free text, matched against campaigns.target_geography by triage's hard filter
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

-- For databases where candidate_companies already existed before `location`:
ALTER TABLE candidate_companies ADD COLUMN IF NOT EXISTS location TEXT;

-- ---------------------------------------------------------------------------
-- Orchestrator tables. Dev 1 hasn't delivered these, so they're built here.
-- Design: `prospects` holds CURRENT state (cheap dashboard reads);
-- `dossier_entries` is append-only, one row per agent action, and is both
-- the per-prospect Dossier (query by prospect_id) and the Decision Journal
-- (query across prospects) — one table, not two concepts.
-- ---------------------------------------------------------------------------

-- Global settings; gate 4 of the Orchestrator ("global kill switch off?").
CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now()
);
INSERT INTO system_settings (key, value) VALUES ('kill_switch', 'false'::jsonb)
    ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS prospects (
    id                    SERIAL PRIMARY KEY,
    campaign_id           INTEGER NOT NULL REFERENCES campaigns(id),
    candidate_company_id  INTEGER REFERENCES candidate_companies(id),
    company_name          TEXT NOT NULL,
    contact_name          TEXT,
    contact_title         TEXT,
    contact_email         TEXT,
    -- Where the prospect is in the pipeline; the Orchestrator maps this to
    -- the next agent. Values: sourced, researched, qualified, rejected,
    -- escalated, strategy_set, drafted, pending_approval, approved, sent,
    -- replied, closed. Not a CHECK constraint so the pipeline can evolve.
    funnel_status         TEXT NOT NULL DEFAULT 'sourced',
    latest_decision       TEXT,
    latest_fit_score      INTEGER,
    last_agent            TEXT,
    last_contact_at       TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospects_campaign_status_idx ON prospects (campaign_id, funnel_status);

-- Append-only. Columns mirror the shared agent output JSON; only what gets
-- filtered/sorted is a real column, the array-shaped evidence stays JSONB.
CREATE TABLE IF NOT EXISTS dossier_entries (
    id                           SERIAL PRIMARY KEY,
    prospect_id                  INTEGER NOT NULL REFERENCES prospects(id),
    campaign_id                  INTEGER NOT NULL REFERENCES campaigns(id),  -- denormalised for journal queries
    agent_name                   TEXT NOT NULL,
    harness_version              TEXT,
    decision                     TEXT NOT NULL,
    fit_score                    INTEGER,            -- 0-100 or NULL
    evidence                     JSONB NOT NULL DEFAULT '[]'::jsonb,
    retrieved_knowledge          JSONB NOT NULL DEFAULT '[]'::jsonb,
    campaign_instruction_excerpt TEXT,
    conflict_check               TEXT,
    final_action                 TEXT,
    handoff_note                 TEXT,
    raw_response                 JSONB,              -- untouched agent output, for debugging bad JSON
    latency_ms                   INTEGER,
    created_at                   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dossier_entries_prospect_idx ON dossier_entries (prospect_id, created_at);
CREATE INDEX IF NOT EXISTS dossier_entries_campaign_idx ON dossier_entries (campaign_id, created_at);

-- Human-in-the-loop: nothing customer-facing sends until a row here is approved.
CREATE TABLE IF NOT EXISTS approvals_queue (
    id            SERIAL PRIMARY KEY,
    prospect_id   INTEGER NOT NULL REFERENCES prospects(id),
    campaign_id   INTEGER NOT NULL REFERENCES campaigns(id),
    channel       TEXT NOT NULL,
    subject       TEXT,
    body          TEXT NOT NULL,
    edited_body   TEXT,                              -- set when a human edits before approving
    status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_at    TIMESTAMPTZ,
    sent_at       TIMESTAMPTZ,                       -- simulated sends still stamp this
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_queue_status_idx ON approvals_queue (status, created_at);

-- Email addresses or whole domains that must never be contacted.
-- campaign_id NULL = global suppression.
CREATE TABLE IF NOT EXISTS suppression_list (
    id           SERIAL PRIMARY KEY,
    identifier   TEXT NOT NULL,                      -- 'a@b.com' or 'b.com'
    campaign_id  INTEGER REFERENCES campaigns(id),
    reason       TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);
-- COALESCE because NULLs are distinct in a plain UNIQUE constraint, which
-- would allow duplicate global entries.
CREATE UNIQUE INDEX IF NOT EXISTS suppression_list_identifier_idx
    ON suppression_list (lower(identifier), COALESCE(campaign_id, 0));

-- If candidate_companies was already created against the old OpenAI
-- dimension (1536), migrate it before running triage against fastembed
-- (safe to skip if the column is already vector(384) — check first with
-- \d candidate_companies):
--   ALTER TABLE candidate_companies ALTER COLUMN embedding TYPE vector(384);
--   UPDATE candidate_companies SET embedding = NULL;  -- old vectors are the wrong dimension AND wrong model, must re-embed

-- pgvector setup for the Matching Service.
-- Run this against the SAME Neon database Dev 1 uses for campaigns/prospects.
-- These are additive: if candidate_companies or campaigns already exist
-- with different columns, adjust names here (and in app/db.py) to match
-- rather than creating duplicates.

CREATE EXTENSION IF NOT EXISTS vector;

-- Raw sourced companies, pre-triage. Nothing has reasoned about these yet.
CREATE TABLE IF NOT EXISTS candidate_companies (
    id              SERIAL PRIMARY KEY,
    campaign_id     INTEGER,              -- nullable: a shared pool sourced once, filtered per campaign
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
-- dimension (1536), migrate it before running triage against fastembed:
--   ALTER TABLE candidate_companies ALTER COLUMN embedding TYPE vector(384);
--   UPDATE candidate_companies SET embedding = NULL;  -- old vectors are the wrong dimension AND wrong model, must re-embed

-- Minimal columns this service reads off Dev 1's campaigns table.
-- Included here as documentation of the contract, NOT to be run if
-- campaigns already exists with these columns under different names —
-- update app/db.py's fetch_campaign_icp_text() to match instead.
--
-- CREATE TABLE campaigns (
--     id                  SERIAL PRIMARY KEY,
--     target_industry     TEXT,
--     company_size_min    INTEGER,
--     company_size_max    INTEGER,
--     target_persona      TEXT,
--     target_geography    TEXT,
--     must_have_signals   TEXT,
--     ...
-- );

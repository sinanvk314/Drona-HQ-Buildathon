"""
One-off migration: candidate_companies.embedding was created as vector(1536)
(old OpenAI dimension). fastembed's bge-small-en-v1.5 produces 384-dim
vectors, so the column type must change. Safe to run even with existing
rows — any previously-stored embeddings are the wrong dimension AND wrong
model anyway, so they're wiped and must be re-embedded by triage.py on the
next run.

Run from the matching-service/ directory:
    python scripts/migrate_embedding_dim.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg

from app import config

conn = psycopg.connect(config.DATABASE_URL, connect_timeout=15, autocommit=True)
cur = conn.cursor()

cur.execute("SELECT count(*) FROM candidate_companies")
print(f"candidate_companies rows before migration: {cur.fetchone()[0]}")

cur.execute("ALTER TABLE candidate_companies ALTER COLUMN embedding TYPE vector(384)")
cur.execute("UPDATE candidate_companies SET embedding = NULL")

cur.execute(
    "SELECT atttypmod FROM pg_attribute "
    "WHERE attrelid = 'candidate_companies'::regclass AND attname = 'embedding'"
)
print(f"embedding column dimension is now: {cur.fetchone()[0]}")

conn.close()
print("Migration complete.")

"""
Postgres connection + pgvector helpers.

Assumes this runs against the SAME Neon database as Dev 1's campaign/
prospect tables — this service only needs the `vector` extension enabled
and the tables/columns in sql/schema.sql added alongside the existing
schema. Adjust column names below if Dev 1's actual campaigns table
differs from what's assumed here.
"""
import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector

from . import config


def get_connection():
    conn = psycopg.connect(config.DATABASE_URL, autocommit=True)
    register_vector(conn)
    return conn


def fetch_campaign_icp_text(conn, campaign_id: int) -> str:
    """Builds one text blob from a campaign's ICP fields, for embedding."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT target_industry, company_size_min, company_size_max,
                   target_persona, target_geography, must_have_signals
            FROM campaigns WHERE id = %s
            """,
            (campaign_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"No campaign with id {campaign_id}")
    industry, size_min, size_max, persona, geo, signals = row
    return (
        f"Target industry: {industry}. "
        f"Company size: {size_min}-{size_max} employees. "
        f"Target persona: {persona}. "
        f"Geography: {geo}. "
        f"Buying signals: {signals}."
    )


def fetch_unembedded_candidates(conn, campaign_id: int | None = None):
    """Companies added since the last triage run that don't have a vector yet."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, industry, employee_count, description
            FROM candidate_companies
            WHERE embedding IS NULL
              AND (%s IS NULL OR campaign_id = %s)
            """,
            (campaign_id, campaign_id),
        )
        return cur.fetchall()


def store_embedding(conn, company_id: int, embedding: list[float]):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE candidate_companies SET embedding = %s WHERE id = %s",
            (Vector(embedding), company_id),
        )


def rank_companies_pgvector(conn, campaign_id, query_embedding: list[float], top_n: int):
    """
    Uses pgvector's <=> cosine-distance operator directly in SQL. This is
    what scales to a large candidate list — similarity.py's in-memory
    ranking is only for small sets (one company's contacts, a handful of
    reply-category examples).
    """
    vec = Vector(query_embedding)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, 1 - (embedding <=> %s) AS score
            FROM candidate_companies
            WHERE embedding IS NOT NULL
              AND (%s IS NULL OR campaign_id = %s)
            ORDER BY embedding <=> %s
            LIMIT %s
            """,
            (vec, campaign_id, campaign_id, vec, top_n),
        )
        return cur.fetchall()

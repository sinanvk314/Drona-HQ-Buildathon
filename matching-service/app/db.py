"""
Postgres connection + pgvector helpers.

Assumes this runs against the SAME Neon database as Dev 1's campaign/
prospect tables — this service only needs the `vector` extension enabled
and the tables/columns in sql/schema.sql added alongside the existing
schema. Adjust column names below if Dev 1's actual campaigns table
differs from what's assumed here.
"""
import re

import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector

from . import config

# Hard rules that similarity must never decide (see CLAUDE.md: "200-2000
# employees" doesn't survive being turned into an embedding). Applied in SQL
# BEFORE embedding or ranking, so failing companies are never embedded.
#
# Unknown data passes: a NULL employee_count or location can't disqualify a
# company, and the Research agent verifies the ICP checklist downstream.
_HARD_FILTER_SQL = """
    (%(campaign_id)s::int IS NULL OR campaign_id = %(campaign_id)s::int)
    AND (%(size_min)s::int IS NULL OR employee_count IS NULL OR employee_count >= %(size_min)s::int)
    AND (%(size_max)s::int IS NULL OR employee_count IS NULL OR employee_count <= %(size_max)s::int)
    AND (%(geo)s::text[] IS NULL OR location IS NULL OR location ILIKE ANY(%(geo)s::text[]))
"""


def get_connection():
    conn = psycopg.connect(config.DATABASE_URL, autocommit=True)
    register_vector(conn)
    return conn


def geo_patterns(target_geography: str | None) -> list[str] | None:
    """
    'United States, Canada' -> ['%United States%', '%Canada%'] for ILIKE ANY.
    Free-text matching: 'USA' will not match 'United States' — normalise
    location values at sourcing time. Returns None (no filter) if blank.
    """
    if not target_geography:
        return None
    terms = [t.strip() for t in re.split(r"[,;/]", target_geography) if t.strip()]
    return [f"%{t}%" for t in terms] or None


def fetch_campaign(conn, campaign_id: int) -> dict:
    """The campaign fields triage needs: ICP text inputs + hard-filter bounds."""
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
    return {
        "id": campaign_id,
        "industry": industry,
        "size_min": size_min,
        "size_max": size_max,
        "persona": persona,
        "geography": geo,
        "signals": signals,
    }


def icp_text(campaign: dict) -> str:
    """Builds one text blob from a campaign's ICP fields, for embedding."""
    return (
        f"Target industry: {campaign['industry']}. "
        f"Company size: {campaign['size_min']}-{campaign['size_max']} employees. "
        f"Target persona: {campaign['persona']}. "
        f"Geography: {campaign['geography']}. "
        f"Buying signals: {campaign['signals']}."
    )


def fetch_campaign_icp_text(conn, campaign_id: int) -> str:
    return icp_text(fetch_campaign(conn, campaign_id))


def _filter_params(campaign: dict) -> dict:
    return {
        "campaign_id": campaign["id"],
        "size_min": campaign["size_min"],
        "size_max": campaign["size_max"],
        "geo": geo_patterns(campaign["geography"]),
    }


def fetch_unembedded_candidates(conn, campaign: dict):
    """
    Companies added since the last triage run that don't have a vector yet
    AND pass the campaign's hard filters (no point embedding the rest).
    """
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, industry, employee_count, description
            FROM candidate_companies
            WHERE embedding IS NULL AND {_HARD_FILTER_SQL}
            """,
            _filter_params(campaign),
        )
        return cur.fetchall()


def store_embedding(conn, company_id: int, embedding: list[float]):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE candidate_companies SET embedding = %s WHERE id = %s",
            (Vector(embedding), company_id),
        )


def rank_companies_pgvector(conn, campaign: dict, query_embedding: list[float], top_n: int):
    """
    Uses pgvector's <=> cosine-distance operator directly in SQL. This is
    what scales to a large candidate list — similarity.py's in-memory
    ranking is only for small sets (one company's contacts, a handful of
    reply-category examples). Hard filters run first; only survivors are
    ranked.
    """
    params = {**_filter_params(campaign), "vec": Vector(query_embedding), "top_n": top_n}
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, 1 - (embedding <=> %(vec)s) AS score
            FROM candidate_companies
            WHERE embedding IS NOT NULL AND {_HARD_FILTER_SQL}
            ORDER BY embedding <=> %(vec)s
            LIMIT %(top_n)s
            """,
            params,
        )
        return cur.fetchall()

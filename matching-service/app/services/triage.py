"""
Similarity Triage — the layer that runs BEFORE Lead Research & Enrichment.
Filters raw sourced companies down to the ones worth spending an LLM call
on, using embeddings only. No reasoning happens here.
"""
from .. import config, embeddings
from .. import db as dbmod


def rank_candidate_companies(campaign_id: int, top_n: int | None = None) -> list[dict]:
    top_n = top_n or config.TRIAGE_TOP_N_DEFAULT
    conn = dbmod.get_connection()
    try:
        # Embed any newly-sourced candidates that don't have a vector yet.
        unembedded = dbmod.fetch_unembedded_candidates(conn, campaign_id)
        for company_id, name, industry, size, desc in unembedded:
            text = f"{name}. Industry: {industry}. Size: {size} employees. {desc or ''}"
            vec = embeddings.embed_text(text)
            dbmod.store_embedding(conn, company_id, vec)

        icp_text = dbmod.fetch_campaign_icp_text(conn, campaign_id)
        icp_vec = embeddings.embed_text(icp_text)

        rows = dbmod.rank_companies_pgvector(conn, campaign_id, icp_vec, top_n)
        return [{"company_id": r[0], "name": r[1], "score": float(r[2])} for r in rows]
    finally:
        conn.close()

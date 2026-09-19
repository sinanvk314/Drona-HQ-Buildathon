"""
Similarity Triage — the layer that runs BEFORE Lead Research & Enrichment.
Filters raw sourced companies down to the ones worth spending an LLM call
on. Two stages, in this order:

1. Hard filters (employee range, geography) in SQL — rules that similarity
   must never decide. Companies failing these are never embedded.
2. Embedding similarity against the campaign ICP — nothing reasons here.
"""
from .. import config, embeddings
from .. import db as dbmod


def rank_candidate_companies(campaign_id: int, top_n: int | None = None) -> list[dict]:
    top_n = top_n or config.TRIAGE_TOP_N_DEFAULT
    conn = dbmod.get_connection()
    try:
        campaign = dbmod.fetch_campaign(conn, campaign_id)

        # Embed any newly-sourced candidates that pass the hard filters and
        # don't have a vector yet.
        unembedded = dbmod.fetch_unembedded_candidates(conn, campaign)
        for company_id, name, industry, size, desc in unembedded:
            text = f"{name}. Industry: {industry}. Size: {size} employees. {desc or ''}"
            dbmod.store_embedding(conn, company_id, embeddings.embed_text(text))

        icp_vec = embeddings.embed_text(dbmod.icp_text(campaign))

        rows = dbmod.rank_companies_pgvector(conn, campaign, icp_vec, top_n)
        return [{"company_id": r[0], "name": r[1], "score": float(r[2])} for r in rows]
    finally:
        conn.close()

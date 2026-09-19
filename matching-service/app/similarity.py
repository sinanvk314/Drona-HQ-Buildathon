"""
Pure cosine-similarity math. No DB, no API calls — this is what makes it
testable without any credentials.

Used directly (in-memory) for small candidate sets: contact matching within
one company's contact list, reply classification against a handful of
example categories. For triage's much larger candidate-company list, the
same metric is computed at the database layer instead (see db.py's
rank_companies_pgvector, using pgvector's <=> operator) so the ranking
scales without pulling every embedding into Python memory.
"""
import numpy as np


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a), np.array(b)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    if denom == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / denom)


def rank_by_similarity(
    query_vec: list[float],
    candidates: list[tuple[str, list[float]]],
    top_n: int | None = None,
) -> list[tuple[str, float]]:
    """
    candidates: list of (id_or_label, vector) pairs.
    Returns [(id_or_label, score), ...] sorted by similarity, descending.
    """
    scored = [(cid, cosine_similarity(query_vec, vec)) for cid, vec in candidates]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:top_n] if top_n else scored

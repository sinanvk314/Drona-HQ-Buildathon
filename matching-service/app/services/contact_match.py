"""
Picks which contact at a triaged company matches the campaign's target
persona, so Lead Research & Enrichment verifies a pre-selected person
instead of reasoning over a whole employee list.
"""
from .. import config, embeddings
from ..similarity import rank_by_similarity


def match_best_contact(target_persona: str, contacts: list[dict]) -> dict | None:
    """
    contacts: [{"id": "...", "name": "...", "title": "..."}, ...] — one
    company's contact list. Small enough that in-memory ranking (no
    pgvector) is the right call here.

    Returns None if nothing clears CONTACT_MATCH_MIN_SCORE — Research
    should then mark persona as "unknown" rather than guess.
    """
    if not contacts:
        return None

    persona_vec = embeddings.embed_text(target_persona)
    titles = [c["title"] for c in contacts]
    title_vecs = embeddings.embed_texts(titles)

    candidates = [(c["id"], vec) for c, vec in zip(contacts, title_vecs)]
    ranked = rank_by_similarity(persona_vec, candidates, top_n=1)
    if not ranked:
        return None

    best_id, score = ranked[0]
    if score < config.CONTACT_MATCH_MIN_SCORE:
        return None

    best = next(c for c in contacts if c["id"] == best_id)
    return {**best, "score": score}

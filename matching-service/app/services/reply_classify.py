"""
Classifies an inbound reply against a small set of example categories
(sourced from the campaign's Knowledge Base "example replies" docs) so
unsubscribe/hostile/out-of-office replies can be routed WITHOUT calling the
full Conversation Agent. Ambiguous categories (objection, question,
positive) still go to the full agent — this only short-circuits the
clear-cut cases.
"""
from .. import config, embeddings
from ..similarity import rank_by_similarity


def classify_reply(reply_text: str, categories: dict[str, list[str]]) -> dict:
    """
    categories: {"unsubscribe": ["please remove me from this list", ...],
                 "hostile": [...], "positive": [...], "objection": [...], ...}
    """
    reply_vec = embeddings.embed_text(reply_text)

    # One centroid vector per category, averaged from its example replies.
    category_vecs = []
    for category, examples in categories.items():
        vecs = embeddings.embed_texts(examples)
        centroid = [sum(dim_values) / len(dim_values) for dim_values in zip(*vecs)]
        category_vecs.append((category, centroid))

    ranked = rank_by_similarity(reply_vec, category_vecs)
    best_category, best_score = ranked[0]

    deterministic = (
        best_score >= config.REPLY_HIGH_CONFIDENCE_SCORE
        and best_category in config.DETERMINISTIC_CATEGORIES
    )
    return {"category": best_category, "score": best_score, "deterministic": deterministic}

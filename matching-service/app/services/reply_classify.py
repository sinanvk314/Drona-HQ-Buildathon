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

    # Margin over the runner-up catches replies that sit between two
    # categories, which an absolute score alone can't (e.g. "please stop
    # calling my assistant and email me" scores 0.817 as hostile but only
    # 0.008 ahead of unsubscribe). With a single category there is no
    # runner-up, so the margin check is vacuous.
    margin = best_score - ranked[1][1] if len(ranked) > 1 else 1.0

    deterministic = (
        best_score >= config.REPLY_HIGH_CONFIDENCE_SCORE
        and margin >= config.REPLY_MIN_MARGIN
        and best_category in config.DETERMINISTIC_CATEGORIES
    )
    return {
        "category": best_category,
        "score": best_score,
        "margin": margin,
        "deterministic": deterministic,
    }

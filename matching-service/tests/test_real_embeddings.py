"""
Proves the real fastembed model produces semantically meaningful vectors —
tests/test_similarity.py only proves the ranking plumbing with a mock
embedder that is deliberately NOT semantically meaningful.

First run downloads the model (~130MB) from huggingface.co and caches it;
needs real internet access once. No API key required.

Run: pytest tests/test_real_embeddings.py -v
"""
from app.embeddings import embed_text
from app.similarity import cosine_similarity


def test_real_embedding_dimension_matches_config():
    from app import config

    vec = embed_text("VP of Supply Chain at a mid-market manufacturer")
    assert len(vec) == config.EMBEDDING_DIM


def test_real_embeddings_rank_similar_text_closer_than_unrelated_text():
    icp = embed_text("mid-market manufacturing VP supply chain SAP ECC")
    on_icp = embed_text("supply chain leader at a manufacturing company using SAP")
    off_icp = embed_text("early-stage consumer app marketing intern")

    assert cosine_similarity(icp, on_icp) > cosine_similarity(icp, off_icp)


def test_real_embeddings_identical_text_scores_near_one():
    text = "VP of Supply Chain"
    assert cosine_similarity(embed_text(text), embed_text(text)) > 0.999

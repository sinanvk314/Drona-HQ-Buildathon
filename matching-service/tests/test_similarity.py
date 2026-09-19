"""
Tests the ranking logic itself — no OPENAI_API_KEY or DATABASE_URL needed.
Run: pytest tests/test_similarity.py -v

These prove the plumbing (sorting, thresholds) is correct. They do NOT
prove the embeddings are semantically good — that only happens with a real
OPENAI_API_KEY. See the "close" / "far" test below for what a real
embedding call should preserve.
"""
import numpy as np

from app.embeddings import embed_text_mock
from app.similarity import cosine_similarity, rank_by_similarity


def test_cosine_similarity_identical_vectors():
    v = [1.0, 2.0, 3.0]
    assert abs(cosine_similarity(v, v) - 1.0) < 1e-9


def test_cosine_similarity_orthogonal_vectors():
    assert abs(cosine_similarity([1.0, 0.0], [0.0, 1.0])) < 1e-9


def test_cosine_similarity_opposite_vectors():
    assert abs(cosine_similarity([1.0, 0.0], [-1.0, 0.0]) - (-1.0)) < 1e-9


def test_rank_by_similarity_orders_correctly():
    query = [1.0, 0.0, 0.0]
    candidates = [
        ("far", [0.0, 1.0, 0.0]),          # orthogonal -> ~0.0
        ("close", [0.9, 0.1, 0.0]),        # nearly aligned -> high
        ("opposite", [-1.0, 0.0, 0.0]),    # opposite -> -1.0
    ]
    ranked = rank_by_similarity(query, candidates)
    assert [label for label, _ in ranked] == ["close", "far", "opposite"]


def test_rank_by_similarity_respects_top_n():
    query = [1.0, 0.0]
    candidates = [(str(i), [np.cos(i), np.sin(i)]) for i in range(10)]
    ranked = rank_by_similarity(query, candidates, top_n=3)
    assert len(ranked) == 3


def test_mock_embedding_is_deterministic():
    """Same text -> same vector, every time (needed for reproducible tests)."""
    a = embed_text_mock("VP of Supply Chain at a manufacturer")
    b = embed_text_mock("VP of Supply Chain at a manufacturer")
    assert a == b


def test_mock_embedding_differs_for_different_text():
    a = embed_text_mock("VP of Supply Chain")
    b = embed_text_mock("Marketing Intern")
    assert a != b


def test_triage_ranking_plumbing_end_to_end():
    """
    Simulates a triage pass with mock embeddings: identical text should
    rank itself first. This only proves the ranking pipeline is wired
    correctly — real semantic ranking (a genuinely similar-but-not-identical
    company scoring higher) requires a real OPENAI_API_KEY, since the mock
    embedding is intentionally NOT semantically meaningful.
    """
    icp_text = "mid-market manufacturing VP supply chain SAP ECC"
    icp_vec = embed_text_mock(icp_text)

    on_icp_vec = embed_text_mock(icp_text)  # identical text -> should rank #1
    off_icp_vec = embed_text_mock("early-stage consumer app marketing intern")

    candidates = [("on_icp", on_icp_vec), ("off_icp", off_icp_vec)]
    ranked = rank_by_similarity(icp_vec, candidates)
    assert ranked[0][0] == "on_icp"

"""
Margin check for reply classification: a reply that scores high but sits
almost equally close to two categories must NOT be routed deterministically.
Uses hand-built vectors so the geometry is exact. Run: pytest tests/test_reply_margin.py -v
"""
from app import embeddings
from app.services import reply_classify

VECTORS = {
    "reply-clear": [1.0, 0.0, 0.0],
    "reply-between": [1.0, 0.0, 0.0],
    "unsub-example": [1.0, 0.0, 0.0],
    "hostile-far": [0.0, 1.0, 0.0],
    "unsub-near": [1.0, 0.1, 0.0],
    "hostile-near": [1.0, -0.1, 0.0],
}


def _patch(monkeypatch):
    monkeypatch.setattr(embeddings, "embed_text", lambda t: VECTORS[t])
    monkeypatch.setattr(embeddings, "embed_texts", lambda ts: [VECTORS[t] for t in ts])


def test_clear_win_with_large_margin_is_deterministic(monkeypatch):
    _patch(monkeypatch)
    result = reply_classify.classify_reply(
        "reply-clear", {"unsubscribe": ["unsub-example"], "hostile": ["hostile-far"]}
    )
    assert result["category"] == "unsubscribe"
    assert result["margin"] > 0.9
    assert result["deterministic"] is True


def test_high_score_but_tiny_margin_is_not_deterministic(monkeypatch):
    """Both categories score ~0.995, so the absolute score passes but the
    reply is effectively between unsubscribe and hostile."""
    _patch(monkeypatch)
    result = reply_classify.classify_reply(
        "reply-between", {"unsubscribe": ["unsub-near"], "hostile": ["hostile-near"]}
    )
    assert result["score"] > 0.9
    assert result["margin"] < 0.03
    assert result["deterministic"] is False


def test_single_category_has_no_runner_up_so_margin_is_vacuous(monkeypatch):
    _patch(monkeypatch)
    result = reply_classify.classify_reply("reply-clear", {"unsubscribe": ["unsub-example"]})
    assert result["margin"] == 1.0
    assert result["deterministic"] is True

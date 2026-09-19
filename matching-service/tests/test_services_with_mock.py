"""
Exercises the actual service functions (not just the raw similarity math)
by substituting the mock embedder for the real OpenAI one. Proves the
plumbing in contact_match.py and reply_classify.py is wired correctly.

Run: pytest tests/test_services_with_mock.py -v
"""
from app import embeddings
from app.services import contact_match, reply_classify


def test_contact_match_picks_identical_title_over_others(monkeypatch):
    monkeypatch.setattr(embeddings, "embed_text", embeddings.embed_text_mock)
    monkeypatch.setattr(
        embeddings, "embed_texts", lambda texts: [embeddings.embed_text_mock(t) for t in texts]
    )

    target_persona = "VP of Supply Chain"
    contacts = [
        {"id": "c1", "name": "Priya R", "title": "VP of Supply Chain"},  # exact match text
        {"id": "c2", "name": "Sam T", "title": "Marketing Intern"},
        {"id": "c3", "name": "Alex K", "title": "Warehouse Associate"},
    ]

    result = contact_match.match_best_contact(target_persona, contacts)
    assert result is not None
    assert result["id"] == "c1"


def test_contact_match_returns_none_when_no_contacts():
    assert contact_match.match_best_contact("VP of Supply Chain", []) is None


def test_contact_match_returns_none_below_threshold(monkeypatch):
    """
    With mock embeddings, unrelated text scores near zero — below
    CONTACT_MATCH_MIN_SCORE — so this should correctly return no match
    rather than force a low-confidence pick.
    """
    monkeypatch.setattr(embeddings, "embed_text", embeddings.embed_text_mock)
    monkeypatch.setattr(
        embeddings, "embed_texts", lambda texts: [embeddings.embed_text_mock(t) for t in texts]
    )
    contacts = [{"id": "c1", "name": "Random Person", "title": "Completely Unrelated Role Xyz"}]
    result = contact_match.match_best_contact("VP of Supply Chain", contacts)
    assert result is None


def test_reply_classify_routes_exact_category_match(monkeypatch):
    monkeypatch.setattr(embeddings, "embed_text", embeddings.embed_text_mock)
    monkeypatch.setattr(
        embeddings, "embed_texts", lambda texts: [embeddings.embed_text_mock(t) for t in texts]
    )

    reply_text = "please unsubscribe me"
    categories = {
        "unsubscribe": ["please unsubscribe me"],  # identical text -> perfect centroid match
        "positive": ["sounds great, let's book a call"],
        "hostile": ["stop contacting me or I will report this"],
    }

    result = reply_classify.classify_reply(reply_text, categories)
    assert result["category"] == "unsubscribe"
    assert result["deterministic"] is True  # unsubscribe is in DETERMINISTIC_CATEGORIES


def test_reply_classify_ambiguous_category_not_deterministic(monkeypatch):
    """
    Even a confident match on a non-deterministic category (e.g. "positive")
    must NOT be flagged deterministic — those still need the full
    Conversation Agent to draft an actual response.
    """
    monkeypatch.setattr(embeddings, "embed_text", embeddings.embed_text_mock)
    monkeypatch.setattr(
        embeddings, "embed_texts", lambda texts: [embeddings.embed_text_mock(t) for t in texts]
    )

    reply_text = "sounds great, let's book a call"
    categories = {
        "positive": ["sounds great, let's book a call"],  # identical -> high confidence
        "unsubscribe": ["please remove me from this list"],
    }

    result = reply_classify.classify_reply(reply_text, categories)
    assert result["category"] == "positive"
    assert result["deterministic"] is False

"""
Thin wrapper around the embedding provider. Only this file needs to change
if you swap providers later — nothing else in the service calls fastembed
directly.

Embeddings run 100% locally via fastembed (ONNX runtime, no GPU needed).
First call downloads the model (~130MB) from huggingface.co and caches it
under ~/.cache/fastembed; every call after that is fully offline. No API
key, no billing.
"""
import hashlib

import numpy as np
from fastembed import TextEmbedding

from . import config

_model: TextEmbedding | None = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def embed_text(text: str) -> list[float]:
    """Returns a real embedding vector for one string."""
    cleaned = text.replace("\n", " ").strip()
    return next(_get_model().embed([cleaned])).tolist()


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch version — cheaper than calling embed_text in a loop."""
    cleaned = [t.replace("\n", " ").strip() for t in texts]
    return [vec.tolist() for vec in _get_model().embed(cleaned)]


def embed_text_mock(text: str, dim: int = config.EMBEDDING_DIM) -> list[float]:
    """
    Deterministic fake embedding for tests and local dev without downloading
    the model. Same input text always produces the same vector, and
    DIFFERENT text produces UNRELATED vectors (it is not semantically
    meaningful — it proves the ranking plumbing works, not that the matching
    is smart). Swap in embed_text() for anything that needs real semantic
    similarity.
    """
    seed = int(hashlib.sha256(text.encode()).hexdigest(), 16) % (2**32)
    rng = np.random.default_rng(seed)
    vec = rng.normal(size=dim)
    return (vec / np.linalg.norm(vec)).tolist()

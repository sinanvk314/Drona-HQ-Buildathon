"""
Thin wrapper around the embedding provider. Only this file needs to change
if you swap providers later — nothing else in the service calls OpenAI
directly.
"""
import hashlib

import numpy as np
from openai import OpenAI

from . import config

_client = OpenAI(api_key=config.OPENAI_API_KEY) if config.OPENAI_API_KEY else None


def embed_text(text: str) -> list[float]:
    """Returns a real embedding vector for one string. Requires OPENAI_API_KEY."""
    if _client is None:
        raise RuntimeError(
            "OPENAI_API_KEY not set (see .env.example). "
            "For local testing without a key, use embed_text_mock instead."
        )
    cleaned = text.replace("\n", " ").strip()
    response = _client.embeddings.create(model=config.EMBEDDING_MODEL, input=cleaned)
    return response.data[0].embedding


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch version — cheaper than calling embed_text in a loop. Requires OPENAI_API_KEY."""
    if _client is None:
        raise RuntimeError("OPENAI_API_KEY not set (see .env.example).")
    cleaned = [t.replace("\n", " ").strip() for t in texts]
    response = _client.embeddings.create(model=config.EMBEDDING_MODEL, input=cleaned)
    return [d.embedding for d in response.data]


def embed_text_mock(text: str, dim: int = config.EMBEDDING_DIM) -> list[float]:
    """
    Deterministic fake embedding for tests and local dev without an API key.
    Same input text always produces the same vector, and DIFFERENT text
    produces UNRELATED vectors (it is not semantically meaningful — it
    proves the ranking plumbing works, not that the matching is smart).
    Swap in embed_text() for anything that needs real semantic similarity.
    """
    seed = int(hashlib.sha256(text.encode()).hexdigest(), 16) % (2**32)
    rng = np.random.default_rng(seed)
    vec = rng.normal(size=dim)
    return (vec / np.linalg.norm(vec)).tolist()

"""
Central config — every tunable knob lives here, not scattered through the
codebase. Thresholds below are starting points; tune them once you have
real embeddings and can see actual score distributions.
"""
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1536"))

# How many companies triage keeps per sourcing run, by default.
# Overridable per-request via the API's top_n param.
TRIAGE_TOP_N_DEFAULT = int(os.getenv("TRIAGE_TOP_N_DEFAULT", "25"))

# Below this cosine score, contact-matching returns no match at all
# (Research should then mark persona as "unknown" rather than guess).
CONTACT_MATCH_MIN_SCORE = float(os.getenv("CONTACT_MATCH_MIN_SCORE", "0.55"))

# Above this score, a reply classification is trusted enough to route
# WITHOUT calling the full Conversation Agent LLM.
REPLY_HIGH_CONFIDENCE_SCORE = float(os.getenv("REPLY_HIGH_CONFIDENCE_SCORE", "0.80"))

# Categories that are safe to route deterministically (no LLM call) when
# classification confidence is high. Ambiguous categories like "objection"
# or "question" always go to the full Conversation Agent, regardless of
# score, because they need an actual drafted response.
DETERMINISTIC_CATEGORIES = {"unsubscribe", "hostile", "out_of_office"}

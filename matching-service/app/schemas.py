from pydantic import BaseModel


class TriageRequest(BaseModel):
    campaign_id: int
    top_n: int | None = None  # falls back to config.TRIAGE_TOP_N_DEFAULT


class TriageResult(BaseModel):
    company_id: int
    name: str
    score: float


class ContactMatchRequest(BaseModel):
    target_persona: str
    contacts: list[dict]  # [{"id": "...", "name": "...", "title": "..."}, ...]


class ContactMatchResult(BaseModel):
    id: str
    name: str
    title: str
    score: float


class ReplyClassifyRequest(BaseModel):
    reply_text: str
    categories: dict[str, list[str]]  # {"unsubscribe": ["please remove me", ...], ...}


class ReplyClassifyResult(BaseModel):
    category: str
    score: float
    margin: float  # lead over the runner-up category; 1.0 if only one category
    deterministic: bool

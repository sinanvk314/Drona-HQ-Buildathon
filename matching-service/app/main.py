"""
SDR Matching Service — the custom, non-DronaHQ layer that does every
similarity-based decision in the pipeline: which sourced companies are
worth researching, which contact at a company matches the target persona,
and which inbound replies can be routed without an LLM call.

Run: uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException

from . import schemas
from .services import contact_match, reply_classify, triage

app = FastAPI(title="SDR Matching Service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/triage/rank-companies", response_model=list[schemas.TriageResult])
def rank_companies(req: schemas.TriageRequest):
    try:
        return triage.rank_candidate_companies(req.campaign_id, req.top_n)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/match/contact", response_model=schemas.ContactMatchResult | None)
def match_contact(req: schemas.ContactMatchRequest):
    return contact_match.match_best_contact(req.target_persona, req.contacts)


@app.post("/classify/reply", response_model=schemas.ReplyClassifyResult)
def classify_reply(req: schemas.ReplyClassifyRequest):
    return reply_classify.classify_reply(req.reply_text, req.categories)

"""
HTTP-level smoke test for /match/contact and /classify/reply using the real
fastembed model (no mocks, no DB needed). Goes through the actual FastAPI
app via TestClient, so request/response schemas are exercised too.

Run from the matching-service/ directory:
    python scripts/smoke_test_endpoints.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

print("== /health ==")
print(client.get("/health").json())

print("\n== /match/contact (expect Priya, VP of Supply Chain) ==")
r = client.post("/match/contact", json={
    "target_persona": "VP of Supply Chain",
    "contacts": [
        {"id": "c1", "name": "Priya Raghavan", "title": "Vice President, Supply Chain Operations"},
        {"id": "c2", "name": "Sam T", "title": "Marketing Intern"},
        {"id": "c3", "name": "Alex K", "title": "Warehouse Associate"},
    ],
})
print(r.status_code, r.json())

print("\n== /match/contact (expect null: nobody is close) ==")
r = client.post("/match/contact", json={
    "target_persona": "VP of Supply Chain",
    "contacts": [
        {"id": "c1", "name": "Sam T", "title": "Marketing Intern"},
        {"id": "c2", "name": "Jo P", "title": "Graphic Designer"},
    ],
})
print(r.status_code, r.json())

CATEGORIES = {
    "unsubscribe": ["please remove me from your list", "unsubscribe me", "stop emailing me"],
    "hostile": ["stop contacting me or I will report you", "this is spam, leave me alone"],
    "out_of_office": ["I am out of the office until Monday with limited access to email",
                      "automatic reply: I am on vacation"],
    "positive": ["sounds interesting, let's book a call", "yes I'd like to learn more"],
    "objection": ["we already use a competitor", "not the right time, budget is tight"],
}

for reply in [
    "Please take me off your mailing list.",
    "I'm away on leave until the 3rd and will reply when I'm back.",
    "Sounds good, can we talk Thursday?",
    "We're locked into a contract with another vendor for now.",
]:
    print(f"\n== /classify/reply: {reply!r} ==")
    r = client.post("/classify/reply", json={"reply_text": reply, "categories": CATEGORIES})
    print(r.status_code, r.json())

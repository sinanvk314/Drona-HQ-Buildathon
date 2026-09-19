"""
End-to-end smoke test for /triage/rank-companies against the real Neon DB
and real fastembed embeddings. Inserts one throwaway campaign + five
candidate companies (clearly prefixed "TEST -"), runs the actual triage
service function (same code the API endpoint calls), prints the ranking,
then deletes everything it inserted so it doesn't pollute the shared DB.

Run from the matching-service/ directory:
    python scripts/smoke_test_triage.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db as dbmod
from app.services import triage

CAMPAIGN_NAME = "TEST - SDR Pipeline Smoke Test"

CANDIDATES = [
    ("Acme Manufacturing Corp", "Manufacturing", 800,
     "Mid-market industrial manufacturer running SAP ECC, expanding its "
     "distribution network across the US."),
    ("Rustbelt Steel Works", "Manufacturing", 1200,
     "Steel fabrication company modernizing supply chain operations, "
     "uses SAP for inventory management."),
    ("Bright Sprout Foods", "Consumer Packaged Goods", 150,
     "Organic snack food startup selling direct to consumer."),
    ("Tiny Marketing Studio", "Marketing", 12,
     "Boutique digital marketing agency serving local businesses."),
    ("GlobalTech Software", "SaaS", 5000,
     "Enterprise software company building HR management tools."),
]

conn = dbmod.get_connection()
cur = conn.cursor()

cur.execute(
    """
    INSERT INTO campaigns
        (name, status, target_industry, company_size_min, company_size_max,
         target_persona, target_geography, must_have_signals)
    VALUES (%s, 'live', 'Manufacturing', 200, 2000,
            'VP of Supply Chain', 'United States',
            'Uses SAP ECC, expanding warehouse footprint')
    RETURNING id
    """,
    (CAMPAIGN_NAME,),
)
campaign_id = cur.fetchone()[0]
print(f"Inserted test campaign id={campaign_id}")

candidate_ids = []
for name, industry, size, desc in CANDIDATES:
    cur.execute(
        """
        INSERT INTO candidate_companies (campaign_id, name, industry, employee_count, description)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (campaign_id, name, industry, size, desc),
    )
    candidate_ids.append(cur.fetchone()[0])
print(f"Inserted {len(candidate_ids)} test candidate companies")

try:
    print("\nRunning triage.rank_candidate_companies (real fastembed embeddings + pgvector)...\n")
    results = triage.rank_candidate_companies(campaign_id, top_n=5)
    for r in results:
        print(f"  {r['score']:.4f}  {r['name']}")
finally:
    cur.execute("DELETE FROM candidate_companies WHERE campaign_id = %s", (campaign_id,))
    cur.execute("DELETE FROM campaigns WHERE id = %s", (campaign_id,))
    print("\nCleaned up test campaign + candidates.")
    conn.close()

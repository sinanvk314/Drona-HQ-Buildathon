"""
End-to-end smoke test for /triage/rank-companies against the real Neon DB
and real fastembed embeddings. Inserts one throwaway campaign + candidate
companies (clearly prefixed "TEST -"), runs the actual triage service
function (same code the API endpoint calls), checks the result, then
deletes everything it inserted so it doesn't pollute the shared DB.

Includes DECOYS: companies whose text reads exactly like the ICP but that
fail a hard rule (too big, wrong country). They must be excluded by the
pre-filter, not merely ranked lower — that is the whole point of filtering
before similarity.

Run from the matching-service/ directory:
    python scripts/smoke_test_triage.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db as dbmod
from app.services import triage

CAMPAIGN_NAME = "TEST - SDR Pipeline Smoke Test"

# (name, industry, employees, location, description, should_survive_filter)
CANDIDATES = [
    ("Acme Manufacturing Corp", "Manufacturing", 800, "Ohio, United States",
     "Mid-market industrial manufacturer running SAP ECC, expanding its "
     "distribution network across the US.", True),
    ("Rustbelt Steel Works", "Manufacturing", 1200, "Pennsylvania, United States",
     "Steel fabrication company modernizing supply chain operations, "
     "uses SAP for inventory management.", True),
    ("Bright Sprout Foods", "Consumer Packaged Goods", 250, "California, United States",
     "Organic snack food startup selling direct to consumer.", True),
    ("GlobalTech Software", "SaaS", 1500, "Texas, United States",
     "Enterprise software company building HR management tools.", True),
    ("Unknown-Size Fabrication", "Manufacturing", None, None,
     "Industrial manufacturer running SAP ECC. Size and location not yet enriched.", True),
    # Decoys: read exactly like the ICP but fail a hard rule.
    ("Megacorp Industrial Holdings", "Manufacturing", 45000, "Ohio, United States",
     "Mid-market industrial manufacturer running SAP ECC, expanding its "
     "distribution network across the US.", False),
    ("Bavaria Precision GmbH", "Manufacturing", 900, "Munich, Germany",
     "Mid-market industrial manufacturer running SAP ECC, expanding its "
     "distribution network.", False),
    ("Tiny Marketing Studio", "Marketing", 12, "Ohio, United States",
     "Boutique digital marketing agency serving local businesses.", False),
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

for name, industry, size, location, desc, _ in CANDIDATES:
    cur.execute(
        """
        INSERT INTO candidate_companies
            (campaign_id, name, industry, employee_count, location, description)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (campaign_id, name, industry, size, location, desc),
    )
print(f"Inserted {len(CANDIDATES)} test candidate companies\n")

failed = False
try:
    results = triage.rank_candidate_companies(campaign_id, top_n=20)
    print("Ranked results (real fastembed embeddings + pgvector):")
    for r in results:
        print(f"  {r['score']:.4f}  {r['name']}")

    returned = {r["name"] for r in results}
    print()
    for name, *_, should_survive in CANDIDATES:
        ok = (name in returned) == should_survive
        failed |= not ok
        expect = "kept" if should_survive else "EXCLUDED"
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: expected {expect}")

    # Decoys must not just rank low, they must never have been embedded.
    cur.execute(
        "SELECT name FROM candidate_companies WHERE campaign_id = %s AND embedding IS NOT NULL",
        (campaign_id,),
    )
    embedded = {row[0] for row in cur.fetchall()}
    leaked = embedded & {n for n, *_, keep in CANDIDATES if not keep}
    print(f"\n  [{'FAIL' if leaked else 'PASS'}] decoys were never embedded"
          + (f" (leaked: {sorted(leaked)})" if leaked else ""))
    failed |= bool(leaked)
finally:
    cur.execute("DELETE FROM candidate_companies WHERE campaign_id = %s", (campaign_id,))
    cur.execute("DELETE FROM campaigns WHERE id = %s", (campaign_id,))
    print("\nCleaned up test campaign + candidates.")
    conn.close()

sys.exit(1 if failed else 0)

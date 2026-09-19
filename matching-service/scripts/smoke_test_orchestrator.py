"""
Proves the demo requirement against the real Neon DB: THREE concurrent
campaigns, pause one mid-flight, the other two keep advancing while the
paused one does not. Also exercises the global kill switch, the human
approval step, simulated sending, and the suppression list.

Uses the fake agent backend (no DronaHQ calls). Every row it creates is
prefixed "TEST -" and deleted at the end; the kill switch is always
restored to off.

Run from the matching-service/ directory:
    python scripts/smoke_test_orchestrator.py
"""
import os
import sys
from pathlib import Path

os.environ["AGENT_MODE"] = "fake"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from psycopg.types.json import Jsonb

from app import db as dbmod
from orchestrator import engine, store

conn = dbmod.get_connection()
cur = conn.cursor()
failures = []


def check(label, ok):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    if not ok:
        failures.append(label)


def statuses(campaign_id):
    cur.execute("SELECT funnel_status, count(*) FROM prospects WHERE campaign_id = %s GROUP BY 1", (campaign_id,))
    return dict(cur.fetchall())


def status_of(name):
    cur.execute("SELECT funnel_status FROM prospects WHERE company_name = %s", (name,))
    return cur.fetchone()[0]


def contacts(prefix):
    return [
        {"id": "c1", "name": f"{prefix} Buyer", "title": "VP of Supply Chain", "email": f"buyer@{prefix.lower()}.test"},
        {"id": "c2", "name": f"{prefix} Intern", "title": "Marketing Intern", "email": f"intern@{prefix.lower()}.test"},
    ]


campaign_ids = []
try:
    # --- Seed: 3 campaigns, 3 companies each ------------------------------
    names = {}
    for label in ("A", "B", "C"):
        cur.execute(
            """
            INSERT INTO campaigns (name, status, target_industry, company_size_min, company_size_max,
                                   target_persona, target_geography, must_have_signals,
                                   enabled_agents, enabled_channels)
            VALUES (%s, 'live', 'Manufacturing', 200, 2000, 'VP of Supply Chain', 'United States',
                    'Uses SAP', %s, %s) RETURNING id
            """,
            (f"TEST - Campaign {label}",
             Jsonb({"research": True, "fitment": True, "strategy": True, "personalisation": True}),
             ["email"]),
        )
        cid = cur.fetchone()[0]
        campaign_ids.append(cid)
        names[cid] = []
        for i in range(3):
            company = f"TEST {label}{i} Manufacturing"
            names[cid].append(company)
            cur.execute(
                """
                INSERT INTO candidate_companies (campaign_id, name, industry, employee_count, location,
                                                 description, raw_data)
                VALUES (%s, %s, 'Manufacturing', 800, 'Ohio, United States',
                        'Industrial manufacturer running SAP', %s)
                """,
                (cid, company, Jsonb({"contacts": contacts(f"{label}{i}")})),
            )
    a, b, c = campaign_ids

    print("Promoting triage survivors to prospects...")
    for cid in campaign_ids:
        engine.promote_from_triage(conn, cid, top_n=3)
    check("each campaign got 3 prospects", all(sum(statuses(cid).values()) == 3 for cid in campaign_ids))

    # --- Round-robin: one prospect per campaign per pass -------------------
    print("\nPass 1 (all three campaigns live):")
    events = engine.run_pass(conn)
    mine = [e for e in events if e["campaign_id"] in campaign_ids]
    check("exactly one prospect advanced per campaign", sorted(e["campaign_id"] for e in mine) == sorted(campaign_ids))
    for e in mine:
        print(f"    campaign {e['campaign_id']}: {e['action']}")

    # --- Pause B mid-flight ------------------------------------------------
    print("\nPausing campaign B, then running 12 passes:")
    before_b = statuses(b)
    cur.execute("UPDATE campaigns SET status = 'paused' WHERE id = %s", (b,))
    blocked_seen = False
    for _ in range(12):
        for e in engine.run_pass(conn):
            if e["campaign_id"] == b and e["action"] == "blocked":
                blocked_seen = True
    check("paused campaign B did not advance at all", statuses(b) == before_b)
    check("B's skips were logged as blocked (paused)", blocked_seen)
    st_a, st_c = statuses(a), statuses(c)
    check("campaign A kept advancing (drafts waiting on human approval)", st_a.get("pending_approval", 0) >= 1)
    check("campaign C kept advancing (drafts waiting on human approval)", st_c.get("pending_approval", 0) >= 1)
    print(f"    A={st_a}\n    B={statuses(b)} (frozen)\n    C={st_c}")

    # --- Human approval + simulated send -----------------------------------
    print("\nHuman approves A's drafts; kill switch flipped on for one pass:")
    cur.execute("UPDATE approvals_queue SET status = 'approved' WHERE campaign_id = %s", (a,))
    cur.execute("UPDATE system_settings SET value = 'true'::jsonb WHERE key = 'kill_switch'")
    sent_before = statuses(a).get("sent", 0)
    events = engine.run_pass(conn)
    check("kill switch stopped every campaign", not any(e["action"] in ("sent",) or "->" in e["action"] for e in events
                                                          if e["campaign_id"] in campaign_ids))
    check("nothing was sent while kill switch was on", statuses(a).get("sent", 0) == sent_before)
    cur.execute("UPDATE system_settings SET value = 'false'::jsonb WHERE key = 'kill_switch'")
    for _ in range(6):
        engine.run_pass(conn)
    check("after the kill switch cleared, approved drafts were sent (simulated)", statuses(a).get("sent", 0) >= 1)
    check("C's undecided drafts were NOT sent without approval", statuses(c).get("sent", 0) == 0)

    # --- Resume B ------------------------------------------------------------
    print("\nResuming campaign B:")
    cur.execute("UPDATE campaigns SET status = 'live' WHERE id = %s", (b,))
    for _ in range(8):
        engine.run_pass(conn)
    check("B resumed and advanced", statuses(b) != before_b)

    # --- Suppression ---------------------------------------------------------
    print("\nSuppression list:")
    cur.execute(
        "INSERT INTO campaigns (name, status, target_industry, company_size_min, company_size_max, target_persona,"
        " enabled_agents, enabled_channels) VALUES ('TEST - Campaign S', 'live', 'Manufacturing', 200, 2000,"
        " 'VP of Supply Chain', %s, %s) RETURNING id",
        (Jsonb({"research": True}), ["email"]),
    )
    sid = cur.fetchone()[0]
    campaign_ids.append(sid)
    cur.execute(
        "INSERT INTO candidate_companies (campaign_id, name, industry, employee_count, description, raw_data)"
        " VALUES (%s, 'TEST S0 Manufacturing', 'Manufacturing', 800, 'x', %s)",
        (sid, Jsonb({"contacts": contacts("S0")})),
    )
    cur.execute("INSERT INTO suppression_list (identifier, campaign_id, reason) VALUES ('s0.test', NULL, 'TEST domain')")
    engine.promote_from_triage(conn, sid, top_n=3)
    engine.run_pass(conn)
    check("prospect whose domain is suppressed was closed without outreach", status_of("TEST S0 Manufacturing") == "closed")

    # --- Journal -------------------------------------------------------------
    cur.execute("SELECT count(*) FROM dossier_entries WHERE campaign_id = ANY(%s)", (campaign_ids,))
    n = cur.fetchone()[0]
    check(f"decision journal captured every agent action ({n} entries)", n > 10)
finally:
    cur.execute("UPDATE system_settings SET value = 'false'::jsonb WHERE key = 'kill_switch'")
    cur.execute("DELETE FROM suppression_list WHERE reason = 'TEST domain'")
    if campaign_ids:
        for table in ("approvals_queue", "dossier_entries", "prospects", "candidate_companies"):
            cur.execute(f"DELETE FROM {table} WHERE campaign_id = ANY(%s)", (campaign_ids,))
        cur.execute("DELETE FROM campaigns WHERE id = ANY(%s)", (campaign_ids,))
    conn.close()
    print("\nCleaned up test data; kill switch restored to off.")

print("\nRESULT:", "ALL PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)

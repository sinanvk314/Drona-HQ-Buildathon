"""All Postgres reads/writes for the Orchestrator, in one place."""
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Funnel statuses the Orchestrator can act on. Everything else is either
# terminal (rejected, sent, closed), waiting on a human (pending_approval,
# escalated), or waiting on a reply.
ACTIONABLE = ("sourced", "researched", "qualified", "strategy_set", "approved")


def _rows(conn, sql, params=()):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def kill_switch_on(conn) -> bool:
    rows = _rows(conn, "SELECT value FROM system_settings WHERE key = 'kill_switch'")
    return bool(rows and rows[0]["value"] is True)


def campaigns_in_play(conn) -> list[dict]:
    """Live AND paused: paused ones are still visited so the skip is logged."""
    return _rows(conn, "SELECT * FROM campaigns WHERE status IN ('live', 'paused') ORDER BY id")


def sync_approvals(conn) -> None:
    """Moves prospects along once a human has decided their draft in approvals_queue."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE prospects p SET funnel_status = 'approved', updated_at = now()
            FROM approvals_queue a
            WHERE a.prospect_id = p.id AND p.funnel_status = 'pending_approval'
              AND a.status = 'approved' AND a.sent_at IS NULL
            """
        )
        cur.execute(
            """
            UPDATE prospects p SET funnel_status = 'rejected', latest_decision = 'Draft rejected by human',
                   updated_at = now()
            FROM approvals_queue a
            WHERE a.prospect_id = p.id AND p.funnel_status = 'pending_approval' AND a.status = 'rejected'
            """
        )


def next_prospect(conn, campaign_id: int) -> dict | None:
    rows = _rows(
        conn,
        """
        SELECT * FROM prospects
        WHERE campaign_id = %s AND funnel_status = ANY(%s)
        ORDER BY updated_at, id LIMIT 1
        """,
        (campaign_id, list(ACTIONABLE)),
    )
    return rows[0] if rows else None


def dossier(conn, prospect_id: int) -> list[dict]:
    return _rows(
        conn,
        "SELECT * FROM dossier_entries WHERE prospect_id = %s ORDER BY created_at, id",
        (prospect_id,),
    )


def add_entry(conn, prospect: dict, result: dict, latency_ms: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO dossier_entries
                (prospect_id, campaign_id, agent_name, harness_version, decision, fit_score,
                 evidence, retrieved_knowledge, campaign_instruction_excerpt, conflict_check,
                 final_action, handoff_note, raw_response, latency_ms)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                prospect["id"], prospect["campaign_id"], result["agent_name"],
                result.get("harness_version"), result["decision"], result.get("fit_score"),
                Jsonb(result.get("evidence") or []), Jsonb(result.get("retrieved_knowledge") or []),
                result.get("campaign_instruction_excerpt"), result.get("conflict_check"),
                result.get("final_action"), result.get("handoff_note"), Jsonb(result), latency_ms,
            ),
        )


def update_prospect(conn, prospect_id: int, **fields) -> None:
    cols = ", ".join(f"{k} = %s" for k in fields)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE prospects SET {cols}, updated_at = now() WHERE id = %s",
            (*fields.values(), prospect_id),
        )


def candidate_contacts(conn, candidate_company_id: int | None) -> list[dict]:
    """Contacts for a company, from candidate_companies.raw_data['contacts']."""
    if candidate_company_id is None:
        return []
    rows = _rows(conn, "SELECT raw_data FROM candidate_companies WHERE id = %s", (candidate_company_id,))
    raw = rows[0]["raw_data"] if rows else None
    return (raw or {}).get("contacts", [])


def is_suppressed(conn, email: str | None, campaign_id: int) -> bool:
    if not email:
        return False
    domain = email.split("@")[-1].lower()
    rows = _rows(
        conn,
        """
        SELECT 1 FROM suppression_list
        WHERE lower(identifier) IN (%s, %s) AND (campaign_id IS NULL OR campaign_id = %s)
        LIMIT 1
        """,
        (email.lower(), domain, campaign_id),
    )
    return bool(rows)


def create_approval(conn, prospect: dict, channel: str, draft: dict) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO approvals_queue (prospect_id, campaign_id, channel, subject, body)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
            """,
            (prospect["id"], prospect["campaign_id"], channel, draft.get("subject"), draft["body"]),
        )
        return cur.fetchone()[0]


def approved_unsent(conn, prospect_id: int) -> dict | None:
    rows = _rows(
        conn,
        """
        SELECT * FROM approvals_queue
        WHERE prospect_id = %s AND status = 'approved' AND sent_at IS NULL
        ORDER BY id LIMIT 1
        """,
        (prospect_id,),
    )
    return rows[0] if rows else None


def mark_sent(conn, approval_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE approvals_queue SET sent_at = now() WHERE id = %s", (approval_id,))


def existing_prospect_candidates(conn, campaign_id: int) -> set[int]:
    rows = _rows(
        conn,
        "SELECT candidate_company_id FROM prospects WHERE campaign_id = %s",
        (campaign_id,),
    )
    return {r["candidate_company_id"] for r in rows}


def create_prospect(conn, campaign_id: int, candidate_company_id: int, company_name: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO prospects (campaign_id, candidate_company_id, company_name)
            VALUES (%s, %s, %s) RETURNING id
            """,
            (campaign_id, candidate_company_id, company_name),
        )
        return cur.fetchone()[0]

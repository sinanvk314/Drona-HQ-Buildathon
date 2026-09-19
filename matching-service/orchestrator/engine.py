"""
The pipeline engine. One `run_pass` visits every live/paused campaign once
and advances at most ONE prospect in each, so campaigns progress in
lock-step and one campaign being paused, blocked or erroring cannot stop
the others (no threads needed to show that).

funnel_status -> next step:
  sourced      -> research agent        -> researched
  researched   -> fitment agent         -> qualified | rejected | escalated
  qualified    -> strategy agent        -> strategy_set
  strategy_set -> personalisation agent -> pending_approval (row in approvals_queue)
  approved     -> simulated send        -> sent
Human approval (approvals_queue.status) is what moves pending_approval on.
"""
from datetime import datetime, timezone

from app import db as dbmod
from app.services import contact_match, triage

from . import store
from .agents import invoke_agent
from .gates import check_gates

AGENT_STEPS = {
    "sourced": "research",
    "researched": "fitment",
    "qualified": "strategy",
    "strategy_set": "personalisation",
}


def _icp(campaign: dict) -> str:
    return dbmod.icp_text({
        "industry": campaign["target_industry"], "size_min": campaign["company_size_min"],
        "size_max": campaign["company_size_max"], "persona": campaign["target_persona"],
        "geography": campaign["target_geography"], "signals": campaign["must_have_signals"],
    })


def _event(campaign, prospect, action, detail=""):
    return {"campaign_id": campaign["id"], "prospect_id": prospect["id"], "action": action, "detail": detail}


def _strategy_channel(entries: list[dict]) -> str | None:
    for entry in reversed(entries):
        if entry["agent_name"] == "strategy":
            return (entry["raw_response"] or {}).get("channel")
    return None


def promote_from_triage(conn, campaign_id: int, top_n: int | None = None) -> list[int]:
    """Runs similarity triage and turns the survivors into prospects (once each)."""
    ranked = triage.rank_candidate_companies(campaign_id, top_n)
    already = store.existing_prospect_candidates(conn, campaign_id)
    return [
        store.create_prospect(conn, campaign_id, r["company_id"], r["name"])
        for r in ranked if r["company_id"] not in already
    ]


def run_pass(conn) -> list[dict]:
    store.sync_approvals(conn)
    kill = store.kill_switch_on(conn)
    events = []
    for campaign in store.campaigns_in_play(conn):
        prospect = store.next_prospect(conn, campaign["id"])
        if prospect is None:
            continue
        try:
            events.append(_step(conn, campaign, prospect, kill))
        except Exception as e:  # noqa: BLE001 - one campaign's bug must not stop the others
            events.append(_event(campaign, prospect, "error", f"{type(e).__name__}: {e}"))
    return events


def _step(conn, campaign: dict, prospect: dict, kill: bool) -> dict:
    status = prospect["funnel_status"]
    if status == "approved":
        return _send(conn, campaign, prospect, kill)

    agent = AGENT_STEPS[status]
    entries = store.dossier(conn, prospect["id"])

    channel = _strategy_channel(entries) if agent == "personalisation" else None
    allowed, reason = check_gates(kill, campaign, agent, channel)
    if allowed and agent == "strategy" and not campaign["enabled_channels"]:
        allowed, reason = False, "no channels are enabled for this campaign"
    if not allowed:
        return _event(campaign, prospect, "blocked", reason)

    variables = {
        "GUARDRAILS": campaign["guardrails"],
        "ESCALATION_RULES": campaign["escalation_rules"],
        "CAMPAIGN_ICP": _icp(campaign),
        "ENABLED_CHANNELS": campaign["enabled_channels"],
        "PROSPECT": {k: prospect[k] for k in
                     ("id", "company_name", "contact_name", "contact_title", "contact_email", "funnel_status")},
    }

    if agent == "research":
        contacts = store.candidate_contacts(conn, prospect["candidate_company_id"])
        matched = None
        if campaign["target_persona"]:
            matched = contact_match.match_best_contact(campaign["target_persona"], contacts)
        if matched:
            store.update_prospect(conn, prospect["id"], contact_name=matched.get("name"),
                                  contact_title=matched.get("title"), contact_email=matched.get("email"))
            if store.is_suppressed(conn, matched.get("email"), campaign["id"]):
                return _suppressed(conn, campaign, prospect)
        variables["MATCHED_CONTACT"] = matched

    result, latency_ms, failed = invoke_agent(agent, variables, entries)
    store.add_entry(conn, prospect, result, latency_ms)
    return _apply(conn, campaign, prospect, agent, result, failed)


def _apply(conn, campaign, prospect, agent, result, failed) -> dict:
    decision = result["decision"]
    detail = decision

    if failed:
        status = "escalated"
    elif agent == "research":
        status = "researched"
    elif agent == "fitment":
        d = decision.lower()
        status = "qualified" if d.startswith("qualified") else "rejected" if d.startswith("rejected") else "escalated"
    elif agent == "strategy":
        # Enabled channels are a hard constraint, not an agent decision.
        if result.get("channel") in (campaign["enabled_channels"] or []):
            status = "strategy_set"
        else:
            status, detail = "escalated", f"{decision}: channel {result.get('channel')!r} not enabled"
    else:  # personalisation
        draft = result.get("draft")
        channel = _strategy_channel(store.dossier(conn, prospect["id"]))
        if draft and draft.get("body") and channel:
            store.create_approval(conn, prospect, channel, draft)
            status = "pending_approval"
        else:
            status, detail = "escalated", f"{decision}: no usable draft"

    fields = {"funnel_status": status, "latest_decision": decision, "last_agent": agent}
    if result.get("fit_score") is not None:
        fields["latest_fit_score"] = result["fit_score"]
    store.update_prospect(conn, prospect["id"], **fields)
    return _event(campaign, prospect, f"{agent}: {prospect['funnel_status']} -> {status}", detail)


def _suppressed(conn, campaign, prospect) -> dict:
    result = {
        "agent_name": "orchestrator", "decision": "Suppressed",
        "final_action": "close_prospect",
        "evidence": ["Contact is on the suppression list"],
        "handoff_note": "Contact is on the suppression list, so this prospect is closed without outreach.",
    }
    store.add_entry(conn, prospect, result, 0)
    store.update_prospect(conn, prospect["id"], funnel_status="closed",
                          latest_decision="Suppressed", last_agent="orchestrator")
    return _event(campaign, prospect, "suppressed", "contact on suppression list")


def _send(conn, campaign, prospect, kill) -> dict:
    approval = store.approved_unsent(conn, prospect["id"])
    if approval is None:
        return _event(campaign, prospect, "blocked", "approved prospect has no unsent approved draft")
    allowed, reason = check_gates(kill, campaign, None, approval["channel"])
    if not allowed:
        return _event(campaign, prospect, "blocked", reason)
    # Suppression is re-checked at the last moment: someone may have been added since research.
    if store.is_suppressed(conn, prospect["contact_email"], campaign["id"]):
        return _suppressed(conn, campaign, prospect)

    store.mark_sent(conn, approval["id"])
    result = {
        "agent_name": "sender", "decision": "Sent (simulated)",
        "final_action": "simulated_send", "evidence": [f"channel={approval['channel']}"],
        "handoff_note": f"Message to {prospect['company_name']} was approved and sent (simulated, nothing left the system).",
    }
    store.add_entry(conn, prospect, result, 0)
    store.update_prospect(conn, prospect["id"], funnel_status="sent", latest_decision="Sent (simulated)",
                          last_agent="sender", last_contact_at=datetime.now(timezone.utc))
    return _event(campaign, prospect, "sent", "simulated")

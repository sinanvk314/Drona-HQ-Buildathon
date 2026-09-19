"""
Agent invocation, behind one swappable seam (same pattern as embeddings.py).

`invoke_agent` is the only thing the engine calls. It owns timeout/retry and
turns every failure — exception, timeout, malformed JSON — into a normal
"Escalate — agent call failed" result, so a bad agent call becomes a
dossier entry a human can see instead of crashing the loop.

Backends:
  fake    (default) deterministic canned outputs in the shared agent JSON
          shape; instant, free, used for local iteration and tests.
  dronahq the real DronaHQ agents. NOT WIRED YET — see DronaHQBackend.
"""
import os
import time

AGENT_MODE = os.getenv("AGENT_MODE", "fake")
AGENT_TIMEOUT_SECONDS = float(os.getenv("AGENT_TIMEOUT_SECONDS", "30"))
AGENT_RETRIES = int(os.getenv("AGENT_RETRIES", "1"))

# Keys every agent must return (subset of the shared output shape that the
# engine itself depends on; the rest are stored if present).
REQUIRED_KEYS = {"agent_name", "decision", "final_action", "handoff_note"}


class AgentError(Exception):
    pass


class FakeBackend:
    """Deterministic stand-in. Rejects any prospect whose company name contains 'DISQ'."""

    def call(self, agent: str, variables: dict, dossier: list[dict], timeout: float) -> dict:
        prospect = variables.get("PROSPECT", {})
        name = prospect.get("company_name", "?")
        base = {
            "agent_name": agent,
            "harness_version": "fake-0",
            "fit_score": None,
            "evidence": [],
            "retrieved_knowledge": [],
            "campaign_instruction_excerpt": (variables.get("GUARDRAILS") or "")[:120],
            "conflict_check": "none found",
        }
        if agent == "research":
            contact = variables.get("MATCHED_CONTACT")
            return {**base,
                    "decision": "Researched" if contact else "Researched — no contact match",
                    "evidence": [f"Matched contact: {contact['name']} ({contact['title']})"] if contact else [],
                    "final_action": "verified_contact" if contact else "persona_unknown",
                    "handoff_note": f"Looked into {name}; "
                                    + ("found a plausible buyer." if contact else "no clear buyer found.")}
        if agent == "fitment":
            if "DISQ" in name:
                return {**base, "decision": "Rejected", "fit_score": 20,
                        "evidence": ["Hit a hard disqualifier"], "final_action": "close_prospect",
                        "handoff_note": f"{name} hit a disqualifier, not pursuing."}
            return {**base, "decision": "Qualified", "fit_score": 82,
                    "evidence": ["Matches ICP size, industry and persona"],
                    "final_action": "advance_to_strategy",
                    "handoff_note": f"{name} looks like a strong fit; passing to outreach."}
        if agent == "strategy":
            channels = variables.get("ENABLED_CHANNELS") or []
            return {**base, "decision": "Channel selected", "channel": channels[0] if channels else None,
                    "final_action": "advance_to_personalisation",
                    "handoff_note": f"Reach {name} by {channels[0] if channels else 'no channel'}."}
        if agent == "personalisation":
            return {**base, "decision": "Draft ready",
                    "draft": {"subject": f"Quick question, {name}",
                              "body": f"Hi, saw {name} is growing. Worth a short chat?"},
                    "final_action": "queue_for_approval",
                    "handoff_note": f"Drafted a short note to {name}; waiting on approval."}
        raise AgentError(f"unknown agent {agent!r}")


class DronaHQBackend:
    """
    NOT WIRED. Before implementing, hit the real ICP Fitment agent once by
    hand with one //VARIABLE// override and record:
      1. endpoint URL + auth header
      2. request body shape (how variables and the Dossier are passed)
      3. sync response, or job-ID-and-poll? (this changes the design)
      4. response shape vs REQUIRED_KEYS
    Then implement call() and set AGENT_MODE=dronahq.
    """

    def call(self, agent: str, variables: dict, dossier: list[dict], timeout: float) -> dict:
        raise NotImplementedError("DronaHQ backend not wired yet — see class docstring")


def _backend():
    return DronaHQBackend() if AGENT_MODE == "dronahq" else FakeBackend()


def _failure(agent: str, error: Exception) -> dict:
    return {
        "agent_name": agent,
        "harness_version": None,
        "decision": "Escalate — agent call failed",
        "fit_score": None,
        "evidence": [f"{type(error).__name__}: {error}"],
        "retrieved_knowledge": [],
        "final_action": "escalate_to_human",
        "handoff_note": f"The {agent} agent call failed, so a human needs to look at this prospect.",
    }


def invoke_agent(agent: str, variables: dict, dossier: list[dict]) -> tuple[dict, int, bool]:
    """Returns (result, latency_ms, failed). Never raises."""
    backend = _backend()
    last_error: Exception | None = None
    start = time.monotonic()
    for _ in range(AGENT_RETRIES + 1):
        try:
            result = backend.call(agent, variables, dossier, AGENT_TIMEOUT_SECONDS)
            missing = REQUIRED_KEYS - set(result)
            if missing:
                raise AgentError(f"malformed response, missing {sorted(missing)}")
            return result, int((time.monotonic() - start) * 1000), False
        except Exception as e:  # noqa: BLE001 - every failure must become an escalation, not a crash
            last_error = e
    return _failure(agent, last_error), int((time.monotonic() - start) * 1000), True

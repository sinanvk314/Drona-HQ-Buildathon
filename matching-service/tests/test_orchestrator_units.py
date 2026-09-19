"""Gates and agent-failure handling. No DB. Run: pytest tests/test_orchestrator_units.py -v"""
from orchestrator import agents
from orchestrator.gates import check_gates

LIVE = {"status": "live", "enabled_agents": {"research": True}, "enabled_channels": ["email"]}


def test_all_gates_open():
    assert check_gates(False, LIVE, "research", "email") == (True, "ok")


def test_kill_switch_blocks_even_a_fully_enabled_campaign():
    allowed, reason = check_gates(True, LIVE, "research", None)
    assert not allowed and "kill switch" in reason


def test_paused_campaign_blocked():
    allowed, reason = check_gates(False, {**LIVE, "status": "paused"}, "research", None)
    assert not allowed and "paused" in reason


def test_disabled_agent_blocked():
    allowed, reason = check_gates(False, LIVE, "fitment", None)
    assert not allowed and "fitment" in reason


def test_disabled_channel_blocked():
    allowed, reason = check_gates(False, LIVE, None, "voice")
    assert not allowed and "voice" in reason


def test_null_enabled_agents_and_channels_are_treated_as_empty():
    campaign = {"status": "live", "enabled_agents": None, "enabled_channels": None}
    assert not check_gates(False, campaign, "research", None)[0]
    assert not check_gates(False, campaign, None, "email")[0]


class _Backend:
    def __init__(self, behaviour):
        self.behaviour, self.calls = behaviour, 0

    def call(self, agent, variables, dossier, timeout):
        self.calls += 1
        return self.behaviour(self.calls)


def _use(monkeypatch, backend):
    monkeypatch.setattr(agents, "_backend", lambda: backend)
    monkeypatch.setattr(agents, "AGENT_RETRIES", 1)


GOOD = {"agent_name": "fitment", "decision": "Qualified", "final_action": "x", "handoff_note": "y"}


def test_success_passes_through(monkeypatch):
    _use(monkeypatch, _Backend(lambda n: GOOD))
    result, _, failed = agents.invoke_agent("fitment", {}, [])
    assert not failed and result["decision"] == "Qualified"


def test_retries_once_then_succeeds(monkeypatch):
    def flaky(n):
        if n == 1:
            raise TimeoutError("slow")
        return GOOD

    backend = _Backend(flaky)
    _use(monkeypatch, backend)
    _, _, failed = agents.invoke_agent("fitment", {}, [])
    assert not failed and backend.calls == 2


def test_persistent_failure_becomes_escalation_not_exception(monkeypatch):
    def boom(n):
        raise TimeoutError("agent hung")

    backend = _Backend(boom)
    _use(monkeypatch, backend)
    result, _, failed = agents.invoke_agent("fitment", {}, [])
    assert failed and backend.calls == 2
    assert result["decision"] == "Escalate — agent call failed"
    assert "TimeoutError" in result["evidence"][0]


def test_malformed_response_becomes_escalation(monkeypatch):
    _use(monkeypatch, _Backend(lambda n: {"decision": "Qualified"}))
    result, _, failed = agents.invoke_agent("fitment", {}, [])
    assert failed and result["final_action"] == "escalate_to_human"
    assert "missing" in result["evidence"][0]

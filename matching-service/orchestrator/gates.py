"""
The four gates. Checked HERE, before an agent fires, never inside an agent
(an agent that is already running can't be trusted to stop itself).
"""


def check_gates(kill_switch_on: bool, campaign: dict, agent: str | None, channel: str | None):
    """
    Returns (allowed, reason). `agent` is None for non-agent steps (the
    simulated send); `channel` is None where no channel is involved yet.
    Order matters only for the reported reason: global first, then campaign.
    """
    if kill_switch_on:
        return False, "global kill switch is on"
    if campaign["status"] != "live":
        return False, f"campaign is {campaign['status']}"
    if agent is not None and not (campaign["enabled_agents"] or {}).get(agent):
        return False, f"agent '{agent}' is not enabled for this campaign"
    if channel is not None and channel not in (campaign["enabled_channels"] or []):
        return False, f"channel '{channel}' is not enabled for this campaign"
    return True, "ok"

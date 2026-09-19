"""
The Orchestrator: custom code outside DronaHQ that decides WHEN an agent
may run and records what it did. Before any agent fires it checks four
gates (campaign Live, agent enabled, channel enabled, global kill switch
off). One prospect per campaign per pass, round-robin, so a paused or
stuck campaign can never starve or stop the others.

Run:  python -m orchestrator --once        (single pass)
      python -m orchestrator --interval 5  (poll loop)
"""

"""python -m orchestrator --once | --interval SECONDS"""
import argparse
import time

from app import db as dbmod

from . import agents
from .engine import run_pass


def main() -> None:
    parser = argparse.ArgumentParser(prog="orchestrator")
    parser.add_argument("--once", action="store_true", help="run a single pass and exit")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between passes")
    args = parser.parse_args()

    print(f"orchestrator starting (agent mode: {agents.AGENT_MODE})")
    conn = dbmod.get_connection()
    try:
        while True:
            for e in run_pass(conn):
                print(f"[campaign {e['campaign_id']}] prospect {e['prospect_id']}: {e['action']} {e['detail']}")
            if args.once:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

"""Pregame slot scan: build 3/5/8-leg parlays one hour before each puck drop.

Games sharing a scheduled start time form one SLOT and are scanned together.

  .venv/bin/python ml/slot_scan.py --due            scan every slot starting 45–75 min from now that
                                                    has not been scanned yet (run from cron every 10 min)
  .venv/bin/python ml/slot_scan.py --slot 2026-11-08T00:00:00Z   scan one slot now (manual)
  .venv/bin/python ml/slot_scan.py --list           print today's slots and scan status

Each scan (no LLM involved):
  1. incremental ingest of newly final games + fresh schedule + point-in-time features
  2. champion inference (serving bundle if AutoGluon artifacts are absent) + export
  3. starting-goalie check: if the NHL boxscore already flags a starter, force pStart = 1
  4. Polymarket US quote refresh
  5. 3/5/8-leg SGP research for the slot's games  → reports/slots/<date>/slot-<HHMM>Z.{md,json}
State: data/history/slot_scans.json (prevents double scans).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import BASE, ROOT, _get, upcoming  # noqa: E402

PY = os.path.join(ROOT, ".venv", "bin", "python")
STATE = os.path.join(ROOT, "data", "history", "slot_scans.json")


def slots(days: int = 2) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for g in upcoming(days):
        out.setdefault(g["start_utc"], []).append(g)
    return dict(sorted(out.items()))


def load_state() -> dict:
    return json.load(open(STATE)) if os.path.exists(STATE) else {"scans": {}}


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def confirm_goalies(game_ids: list[int]) -> dict:
    """Use NHL-flagged starters when the boxscore already has them (usually close to puck drop)."""
    path = os.path.join(ROOT, "data", "artifacts", "slate.js")
    head, body = open(path).read().split("window.NQ_SLATE = ", 1)
    slate = json.loads(body.rstrip().rstrip(";"))
    report = {}
    for g in slate["games"]:
        if g["game_id"] not in game_ids:
            continue
        box = _get(f"{BASE}/gamecenter/{g['game_id']}/boxscore") or {}
        pbg = box.get("playerByGameStats") or {}
        for side, key in (("home", "homeTeam"), ("away", "awayTeam")):
            flagged = [x["playerId"] for x in (pbg.get(key) or {}).get("goalies", []) if x.get("starter")]
            if flagged:
                for k in g[side]["goalies"]:
                    k["pStart"] = 1.0 if k["id"] == flagged[0] else 0.0
                report[f"{g[side]['abbr']}"] = {"confirmed": flagged[0]}
            else:
                report[f"{g[side]['abbr']}"] = {"confirmed": None, "probs": {k["name"]: round(k["pStart"], 2) for k in g[side]["goalies"]}}
    open(path, "w").write(head + "window.NQ_SLATE = " + json.dumps(slate, separators=(",", ":")) + ";\n")
    return report


def scan(slot: str, games: list[dict], sims: int) -> str:
    t0 = datetime.now(timezone.utc)
    run([PY, "ml/build_all.py", "--days", "3"])
    run([PY, "ml/predict.py"])
    run([PY, "ml/export.py"])
    ids = [g["game_id"] for g in games]
    goalies = confirm_goalies(ids)
    run([PY, "ml/polymarket.py"])
    st = datetime.fromisoformat(slot.replace("Z", "+00:00"))
    out = f"reports/slots/{st.date()}/slot-{st.strftime('%H%M')}Z"
    run(["node", "pipeline/tonight.js", "--games", ",".join(map(str, ids)), "--sims", str(sims), "--per", "2", "--out", out])
    # prepend the goalie status to the report
    md_path = os.path.join(ROOT, out + ".md")
    md = open(md_path).read()
    gl = "\n".join(f"- {team}: " + (f"**confirmed starter id {v['confirmed']}**" if v["confirmed"] else "not yet confirmed — model start probabilities " + ", ".join(f"{n} {int(100 * p)}%" for n, p in v["probs"].items())) for team, v in goalies.items())
    open(md_path, "w").write(md.replace("**How to use:**", f"**Slot {slot}** · games: {', '.join(g['away'] + '@' + g['home'] for g in games)} · scanned {t0.isoformat()[:16]}Z\n\n**Starting goalies at scan time:**\n{gl}\n\n**How to use:**", 1))
    state = load_state()
    state["scans"][slot] = {"scanned_at": t0.isoformat(), "games": ids, "report": out + ".md", "seconds": (datetime.now(timezone.utc) - t0).total_seconds()}
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(state, open(STATE, "w"), indent=1)
    return out + ".md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--due", action="store_true")
    ap.add_argument("--slot")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--sims", type=int, default=50000)
    ap.add_argument("--lead", type=int, default=60, help="minutes before puck drop")
    a = ap.parse_args()
    S, state = slots(), load_state()
    now = datetime.now(timezone.utc)
    if a.list:
        for k, v in S.items():
            t = datetime.fromisoformat(k.replace("Z", "+00:00"))
            print(k, f"scan at {(t - timedelta(minutes=a.lead)).strftime('%Y-%m-%dT%H:%MZ')}", [g["away"] + "@" + g["home"] for g in v], "SCANNED" if k in state["scans"] else "")
        return
    if a.slot:
        if a.slot not in S:
            raise SystemExit(f"no upcoming slot {a.slot}; use --list")
        print("report:", scan(a.slot, S[a.slot], a.sims))
        return
    if a.due:
        due = [k for k in S if k not in state["scans"] and timedelta(minutes=a.lead - 15) <= datetime.fromisoformat(k.replace("Z", "+00:00")) - now <= timedelta(minutes=a.lead + 15)]
        if not due:
            print("no slot due")
        for k in due:
            print("report:", scan(k, S[k], a.sims))


if __name__ == "__main__":
    main()

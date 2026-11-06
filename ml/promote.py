"""Model governance: champion/challenger promotion and rollback.

  .venv/bin/python ml/promote.py              promote latest candidate if justified
  .venv/bin/python ml/promote.py --rollback V make version V the champion again
  .venv/bin/python ml/promote.py --status     print registry

Promotion rule (held-out evidence only): the candidate's per-target SELECT-window
metric must not be worse than the champion's by more than 2% on any target and
must be no worse on average. The first candidate is promoted by default.
The TEST window is reported, never used for promotion.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402

REG = os.path.join(ROOT, "models", "registry.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rollback")
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()
    reg = json.load(open(REG))
    by = {v["version"]: v for v in reg["versions"]}
    now = datetime.now(timezone.utc).isoformat()
    if a.status:
        print(json.dumps({"champion": reg["champion"], "versions": [(v["version"], v["status"]) for v in reg["versions"]]}, indent=1))
        return
    if a.rollback:
        if a.rollback not in by:
            raise SystemExit(f"unknown version {a.rollback}")
        for v in reg["versions"]:
            v["status"] = "champion" if v["version"] == a.rollback else ("retired" if v["status"] == "champion" else v["status"])
        reg["history"].append({"ts": now, "action": "rollback", "to": a.rollback, "from": reg["champion"]})
        reg["champion"] = a.rollback
    else:
        cand = [v for v in reg["versions"] if v["status"] == "candidate"][-1]
        champ = by.get(reg["champion"])
        decision, detail = "promote", {}
        if champ:
            rel = {}
            for t, m in cand["targets"].items():
                if t in champ["targets"]:
                    old = champ["targets"][t]["select"]
                    rel[t] = (m["select"] - old) / abs(old) if old else 0.0
            worst = max(rel.values()) if rel else 0.0
            mean = sum(rel.values()) / max(1, len(rel))
            detail = {"relative_change": rel, "worst": worst, "mean": mean}
            if worst > 0.02 or mean > 0:
                decision = "reject"
        if decision == "promote":
            for v in reg["versions"]:
                if v["status"] == "champion":
                    v["status"] = "retired"
            cand["status"] = "champion"
            reg["champion"] = cand["version"]
        else:
            cand["status"] = "rejected"
        reg["history"].append({"ts": now, "action": decision, "version": cand["version"], **detail})
        print(decision, cand["version"], json.dumps(detail)[:400])
    json.dump(reg, open(REG, "w"), indent=1)


if __name__ == "__main__":
    main()

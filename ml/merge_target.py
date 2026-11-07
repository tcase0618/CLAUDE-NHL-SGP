"""Champion/challenger for a single retrained target.

  .venv/bin/python ml/train.py --targets g_start      # trains into a new version vNEW (that target only)
  .venv/bin/python ml/merge_target.py vNEW g_start    # swap into the champion version iff better on SELECT

The challenger replaces the champion's target only when its SELECT-window metric is
lower (better). TEST is reported, never used. Registry history records the decision.
"""
import json
import os
import shutil
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402

new, tid = sys.argv[1], sys.argv[2]
REG = os.path.join(ROOT, "models", "registry.json")
reg = json.load(open(REG))
champ = reg["champion"]
A = os.path.join(ROOT, "models", "artifacts")
rn, rc = json.load(open(os.path.join(A, new, "report.json"))), json.load(open(os.path.join(A, champ, "report.json")))
tn, tc = rn["targets"][tid], rc["targets"][tid]
sel_new, sel_old = tn["leaderboard"][tn["champion"]]["select"], tc["leaderboard"][tc["champion"]]["select"]
decision = "promote" if sel_new < sel_old else "reject"
print(f"{tid}: challenger {tn['champion']} select {sel_new:.4f} test {tn['leaderboard'][tn['champion']]['test']:.4f} | "
      f"champion {tc['champion']} select {sel_old:.4f} test {tc['leaderboard'][tc['champion']]['test']:.4f} -> {decision}")
if decision == "promote":
    for sub in ("models/artifacts", "models/serving"):
        dst = os.path.join(ROOT, sub, champ, tid)
        src = os.path.join(A, new, tid)
        if sub == "models/serving":
            for m in ("baseline", "xgboost"):
                if os.path.isdir(os.path.join(src, m)):
                    shutil.rmtree(os.path.join(dst, m), ignore_errors=True)
                    shutil.copytree(os.path.join(src, m), os.path.join(dst, m))
        else:
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
    rc["targets"][tid] = tn
    rc.setdefault("patched_targets", {})[tid] = {"from": new, "at": datetime.now(timezone.utc).isoformat()}
    for d in ("models/artifacts", "models/serving"):
        json.dump(rc, open(os.path.join(ROOT, d, champ, "report.json"), "w"), indent=1, default=float)
    v = next(x for x in reg["versions"] if x["version"] == champ)
    v["targets"][tid] = {"champion_model": tn["champion"], "select": sel_new, "test": tn["leaderboard"][tn["champion"]]["test"]}
reg["versions"] = [x for x in reg["versions"] if x["version"] != new]
reg["history"].append({"ts": datetime.now(timezone.utc).isoformat(), "action": f"target-{decision}", "target": tid, "challenger": new,
                       "select_new": sel_new, "select_old": sel_old})
json.dump(reg, open(REG, "w"), indent=1)

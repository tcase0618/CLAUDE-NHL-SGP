"""Inference only (no training): score the upcoming slate with the CHAMPION version.

  .venv/bin/python ml/build_all.py      # refresh data + schedule + features
  .venv/bin/python ml/predict.py        # champion models -> upcoming predictions
  .venv/bin/python ml/export.py         # artifacts for the terminal

Loads persisted artifacts from models/artifacts/<champion>/<target>/<model>.
"""
import json
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from nqml.build import BUILD  # noqa: E402
from nqml.ingest import ROOT  # noqa: E402
from nqml.models import FEATURES, AutoGluonModel, Baseline, XGBSpecialist  # noqa: E402
from train import FRAME, load_frames  # noqa: E402

ART = os.path.join(ROOT, "models", "artifacts")


def main():
    reg = json.load(open(os.path.join(ROOT, "models", "registry.json")))
    ver = reg["champion"] or reg["versions"][-1]["version"]
    targets = {t["id"]: t for t in json.load(open(os.path.join(ROOT, "contracts", "targets.json")))["targets"] if t["status"] == "enabled"}
    frames = load_frames()
    t0 = time.time()
    keys = {"skater": ["game_id", "player_id"], "team": ["game_id", "team"], "goalie_candidate": ["game_id", "team", "player_id"]}
    for tid, t in targets.items():
        ent = t["entity"]
        if ent not in keys:
            continue
        df = frames[ent]
        up = df[df["upcoming"].fillna(0) == 1]
        if up.empty:
            continue
        base = os.path.join(ART, ver, tid)
        mus = {}
        mus["baseline"] = Baseline.load(os.path.join(base, "baseline"), t).predict(up)
        mus["xgboost"] = XGBSpecialist.load(os.path.join(base, "xgboost"), t).predict(up)
        if os.path.isdir(os.path.join(base, "autogluon")):
            mus["autogluon"] = AutoGluonModel.load(os.path.join(base, "autogluon"), t, FEATURES[ent]).predict(up)
            mus["blend"] = 0.5 * mus["xgboost"] + 0.5 * mus["autogluon"]
        champ = reg_champ_model(reg, ver, tid)
        out = up[keys[ent] + [c for c in ("name", "team", "opp", "pos", "is_d", "home") if c in up.columns and c not in keys[ent]]].copy()
        for k, v in mus.items():
            out["mu_" + k] = v
        out["mu"] = mus.get(champ, mus["baseline"])
        out.to_parquet(os.path.join(BUILD, f"upcoming_{tid}.parquet"), index=False)
        print(f"{tid}: {len(out)} rows, champion={champ}")
    print(f"inference {time.time() - t0:.1f}s with version {ver}")


def reg_champ_model(reg, ver, tid):
    v = next(x for x in reg["versions"] if x["version"] == ver)
    return v["targets"].get(tid, {}).get("champion_model", "baseline")


if __name__ == "__main__":
    main()

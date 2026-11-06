"""Rebuild conservative-bound tables + test coverage for a trained version from its
saved SELECT / TEST predictions (no retraining). Uses adaptive bin counts
(>= dist.MIN_BIN rows per bin) so thin calibration windows are not split into
noisy 20-row bins.

Usage: .venv/bin/python ml/recalibrate.py [--version vYYYYMMDD-HHMMSS]
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from nqml import dist  # noqa: E402
from nqml.build import BUILD  # noqa: E402
from nqml.ingest import ROOT  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--version")
a = ap.parse_args()
reg = json.load(open(os.path.join(ROOT, "models", "registry.json")))
ver = a.version or reg["champion"]
path = os.path.join(ROOT, "models", "artifacts", ver, "report.json")
rep = json.load(open(path))
for tid, t in rep["targets"].items():
    sp, tp = os.path.join(BUILD, f"sel_{tid}.parquet"), os.path.join(BUILD, f"test_{tid}.parquet")
    if not (os.path.exists(sp) and os.path.exists(tp)):
        continue
    se, te = pd.read_parquet(sp), pd.read_parquet(tp)
    if "thresholds" in t:
        fam = t["dist"][t["champion"]]
        for k, v in t["thresholds"].items():
            k_ = int(k)
            p_se = dist.sf_ge(se.mu.to_numpy(), k_, fam["family"], fam["alpha"])
            p_te = dist.sf_ge(te.mu.to_numpy(), k_, fam["family"], fam["alpha"])
            lb = dist.lower_bound_table(p_se, (se.y.to_numpy() >= k_).astype(float))
            v["lower_table"] = lb
            v["coverage"] = dist.coverage(dist.apply_lower(p_te, lb), (te.y.to_numpy() >= k_).astype(float))
    elif "binary" in t:
        lb = dist.lower_bound_table(se.mu.to_numpy(), se.y.to_numpy())
        t["binary"]["lower_table"] = lb
        t["binary"]["coverage"] = dist.coverage(dist.apply_lower(te.mu.to_numpy(), lb), te.y.to_numpy())
        print(tid, "bins", len(lb), "mean haircut", round(float(np.mean([r["adj"] for r in lb])), 4), "coverage", t["binary"]["coverage"])
rep["recalibrated"] = {"min_bin": dist.MIN_BIN}
json.dump(rep, open(path, "w"), indent=1, default=float)
cov = [(tid, k, v["coverage"]["rate"]) for tid, t in rep["targets"].items() if "thresholds" in t for k, v in t["thresholds"].items()]
print("threshold bound coverage on TEST (share of bins realised >= p_lower):")
for c in cov:
    print(f"  {c[0]:<16} >= {c[1]:<3} {c[2]:.2f}")

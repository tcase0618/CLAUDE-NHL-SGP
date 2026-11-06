"""Ingest (incremental) + schedule + tables + point-in-time features.

Usage: .venv/bin/python ml/build_all.py [--skip-ingest] [--days 7]
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from nqml import ingest  # noqa: E402
from nqml.build import BUILD, build_features, build_tables  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--skip-ingest", action="store_true")
ap.add_argument("--days", type=int, default=7)
a = ap.parse_args()
t0 = time.time()
if not a.skip_ingest:
    print(ingest.ingest(seasons=ingest.SEASONS[-1:]))  # incremental: current season only
up = ingest.upcoming(a.days)
os.makedirs(BUILD, exist_ok=True)
json.dump(up, open(os.path.join(BUILD, "upcoming.json"), "w"), indent=1)
t1 = time.time()
tabs = build_tables()
f = build_features(tabs, up)
print({k: v.shape for k, v in f.items()}, "upcoming games", len(up))
print(f"timing: ingest+schedule {t1 - t0:.1f}s, build {time.time() - t1:.1f}s")

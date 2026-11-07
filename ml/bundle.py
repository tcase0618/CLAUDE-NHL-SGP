"""Copy the champion's portable serving bundle (report + baseline + XGBoost per target,
~11 MB) into models/serving/<version>/ so scheduled scans work in a fresh container
without the 2.9 GB AutoGluon artifacts. Where the champion is AutoGluon/blend and its
artifacts are absent, ml/predict.py serves XGBoost and records `served`."""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402

reg = json.load(open(os.path.join(ROOT, "models", "registry.json")))
ver = reg["champion"]
src, dst = os.path.join(ROOT, "models", "artifacts", ver), os.path.join(ROOT, "models", "serving", ver)
os.makedirs(dst, exist_ok=True)
shutil.copy(os.path.join(src, "report.json"), os.path.join(dst, "report.json"))
for tid in os.listdir(src):
    for m in ("baseline", "xgboost"):
        p = os.path.join(src, tid, m)
        if os.path.isdir(p):
            shutil.copytree(p, os.path.join(dst, tid, m), dirs_exist_ok=True)
print("bundle", dst)

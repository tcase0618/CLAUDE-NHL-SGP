#!/usr/bin/env bash
# Weekly retrain + governance + historical SGP validation.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY ml/build_all.py
$PY ml/train.py --ag-time "${AG_TIME:-60}"
$PY ml/promote.py              # promotes only if held-out evidence justifies it
$PY ml/predict.py
$PY ml/export.py
$PY ml/final_scores.py
node pipeline/validate_sgp.js --sims "${SGP_SIMS:-4000}"
node pipeline/bench.js
node --test tests/engine.test.js tests/cv_sgp.test.js
$PY -m pytest ml/tests -q

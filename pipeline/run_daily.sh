#!/usr/bin/env bash
# Daily production cycle (no LLM involved). Inference only — training is weekly.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY ml/build_all.py            # incremental ingest + schedule + point-in-time features
$PY ml/predict.py              # champion models -> upcoming predictions
$PY ml/export.py               # slate / report artifacts + prediction history
if [[ -n "${ODDS_API_KEY:-}" ]]; then $PY ml/odds.py; fi   # authorised odds feed (optional)

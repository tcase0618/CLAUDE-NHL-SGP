#!/usr/bin/env bash
# Cron entry point: */10 * * * * /path/to/repo/pipeline/slot_scan.sh --due
# Scans every puck-drop slot ~60 min before start (games with the same start time are grouped).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv && .venv/bin/pip install -q -r requirements-serve.txt; fi
.venv/bin/python ml/slot_scan.py "${@:---due}"

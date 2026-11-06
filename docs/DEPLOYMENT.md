# Deployment & Operations

Production runs **without any LLM**: it's plain Python, Node and static files.

## One-time setup
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # AutoGluon tabular + XGBoost, CPU-only (~2 GB)
```

## Full build (first run, ~15 min ingest + ~60 min training on 4 vCPU)
```bash
.venv/bin/python -c "import sys; sys.path.insert(0,'ml'); from nqml.ingest import ingest; ingest()"  # all seasons
.venv/bin/python ml/build_all.py --skip-ingest       # tables + point-in-time features + 7-day schedule
.venv/bin/python ml/train.py --ag-time 60            # baseline / XGBoost / AutoGluon per target
.venv/bin/python ml/promote.py                       # champion/challenger decision
.venv/bin/python ml/export.py                        # artifacts for the terminal
node pipeline/validate_sgp.js --sims 4000            # historical 3/5/8-leg joint validation
python3 -m http.server 8080                          # serve the terminal → #/cv
```

## Schedules (cron, UTC)
```
# daily inference: refresh data, score slate, export (no training)
15 15 * * *  /path/to/repo/pipeline/run_daily.sh  >> /var/log/nq_daily.log 2>&1
# weekly retrain + promotion + validation + tests
40 9 * * 1   /path/to/repo/pipeline/run_weekly.sh >> /var/log/nq_weekly.log 2>&1
# optional odds refresh every 10 min on game days (needs ODDS_API_KEY; mind the quota)
*/10 16-23 * * *  ODDS_API_KEY=... /path/to/repo/.venv/bin/python /path/to/repo/ml/odds.py
```
Training (expensive) is kept separate from inference (`ml/predict.py`, seconds).

## Model governance
- `models/registry.json` records every version: training time, data hash, per-target champion model, SELECT and TEST metrics, and status (candidate / champion / retired / rejected), plus an action history.
- `ml/promote.py` promotes a candidate only if no target's selection metric gets worse by more than 2% and the average doesn't get worse. Rollback: `ml/promote.py --rollback vYYYYMMDD-HHMMSS`.
- Model files live in `models/artifacts/<version>/<target>/<model>/` (git-ignored, reproducible from the training command and data hash).
- Prediction history: `data/history/predictions.jsonl` (append-only, timestamped, model-versioned). Odds snapshots: `data/history/odds_snapshots.jsonl`.

## Restart / recovery
Every stage is idempotent and file-based:
- Ingestion skips games it has already cached.
- Features are rebuilt from the raw cache.
- Training writes a new version without touching the champion.
- Export reads the champion version.
- A crashed run can simply be re-run.

## Data freshness
The terminal shows "data through" and flags it **stale** after 36 h. CV Confidence also drops a criterion when data is older than 36 h.

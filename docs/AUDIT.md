# Repository Audit — Case Capital NHL Quantitative Terminal

Audit performed before this phase's changes. "Verified" means checked by running code or commands in this environment, not inferred.

| # | Area | Finding (pre-existing) | Action this phase |
|---|---|---|---|
| 1 | Backend architecture | **None.** Static, zero-dependency browser app (vanilla JS, classic `<script>` modules attached to `globalThis.NQ`). No server or API. | Added a **Python ML subsystem** (`ml/`) behind a file/process boundary. Python writes versioned artifacts (`data/artifacts/*.js`, `models/`) that the browser reads. The app was not rewritten. |
| 2 | Frontend & design system | Dark terminal theme on CSS custom properties (`css/terminal.css`), hand-rolled SVG charts (`js/views/charts.js`), component helpers (`js/views/components.js`), hash router (`js/app.js`). | Reused as is. New section `js/views/cv.js`. |
| 3 | Database / storage | None. All state is in memory, plus `localStorage` for UI preferences. | Parquet tables in `data/build/` (generated), a JSON registry (`models/registry.json`), append-only JSONL history (`data/history/`). No DB server needed at this scale. |
| 4 | NHL API integrations | **None.** All data was synthetic. | `ml/nqml/ingest.py`: public `api-web.nhle.com` boxscore, landing (scoring summary) and schedule endpoints. Verified reachable; 2,885 games ingested. |
| 5 | Historical datasets | None (synthetic season only). | 2024-25 (1,312 games), 2025-26 (1,312), 2026-27 to date (261). Regular season only. |
| 6 | Statistical models | Synthetic event simulator, an analytic Poisson layer and a talent estimator, all **on synthetic data**. | Kept, still labelled DEMO. New real-data models live separately. |
| 7 | 80-metric skater profiles | Implemented, but computed from synthetic simulation. About 40% are `TRK` (modelled tracking proxies). | Not reused for real data. Public boxscores lack the tracking events most of these need, so they are **not claimed for real players**. |
| 8 | 60-metric goalie profiles | Same: synthetic. | Real goalie features limited to boxscore-derivable stats (SV%, SA/GP, starts, rest). |
| 9 | 200-metric team profiles | Same: synthetic. | Real team context limited to GF/GA/SF/SA/penalties/wins rolling windows, rest, schedule. |
| 10 | Positional modules | Synthetic only. | Not available on real data (no line or zone data). |
| 11 | Lineup / matchup models | Synthetic line chemistry. | Real track: projected lineup = team's most recent dressed lineup (no confirmed-lineup source). Line combinations need shift charts and are **unsupported**. |
| 12 | Prediction algorithms | Synthetic Monte Carlo and analytic Poisson. | Real track: baseline, XGBoost specialists and AutoGluon ensembles per target, plus distribution layer, joint game simulator and SGP engine. |
| 13 | Odds providers | **None**, and no prices anywhere. | Normalized interface (`js/engine/odds.js`, `contracts/odds_schema.json`), The Odds API adapter (`ml/odds.py`, needs `ODDS_API_KEY`), manual/JSON entry in the Odds Desk. The Odds API answered **401 without a key**; no key is available here. |
| 14 | Scheduled services | None. | Batch scripts with a documented cron schedule (`docs/DEPLOYMENT.md`). No daemon. |
| 15 | Compute (verified) | 4 vCPU, 15 GB RAM, no GPU, 252 GB disk (30 GB free). | CPU-only by design. AutoGluon tabular installed **without PyTorch** (its "torch not found" warnings are expected). |
| 16 | Deployment | Static files plus `python3 -m http.server`. | Unchanged for the UI. The ML pipeline runs offline in `.venv`. |
| 17 | Tests | `tests/engine.test.js`: 8 synthetic-engine tests. | Added `tests/cv_sgp.test.js` (18 tests) and `ml/tests/test_core.py` (9 tests). |
| 18 | Security / dependencies | No runtime dependencies. Google Fonts CSS only. | Python deps pinned in `requirements.txt`; venv is git-ignored. No secrets in the repo; the API key is read from the environment only. |

## Verified versions
Python 3.13.18 · XGBoost 3.3.0 (xgboost-cpu build installed by AutoGluon's extra; a separately installed 3.4.1 was shadowed) · AutoGluon 1.6.3 (tabular: LightGBM, XGBoost, RandomForest, ExtraTrees, linear) · LightGBM 4.7.0 · scikit-learn 1.9.1 · pandas / pyarrow · Node 22.

## Two worlds, clearly separated
- **Synthetic research terminal** (all pre-existing pages). Labelled DEMO. Used for method development and as a sandbox where the true talent is known.
- **Case Value — real NHL** (`#/cv/*`). Only real ingested data and real model outputs. Nothing is synthesised when artifacts or quotes are missing.

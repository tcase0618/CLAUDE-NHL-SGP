# Case Capital NHL Quant Intelligence Platform

Two systems in one terminal:

1. **Case Value — real NHL** (`#/cv`). Built on real NHL box scores (2024-25 → today):
   - per-target baseline / XGBoost / AutoGluon models with chronological validation;
   - calibrated prop distributions and conservative bounds;
   - a correlation-aware joint game simulator and a 3/5/8-leg SGP research engine;
   - **live Polymarket US team-moneyline prices** (free public API, fee-adjusted), all ranked by **Case Value (CV%)**.
2. **Synthetic research terminal** (all other pages, labelled DEMO): a simulated universe used for method development.

## Case Value quick start
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python ml/build_all.py           # ingest + schedule + point-in-time features
.venv/bin/python ml/train.py               # ~47 min on 4 vCPU (or use the committed champion)
.venv/bin/python ml/promote.py && .venv/bin/python ml/export.py
.venv/bin/python ml/polymarket.py          # live Polymarket US NHL moneylines (no key)
node pipeline/validate_sgp.js              # historical 3/5/8-leg joint validation
python3 -m http.server 8080                # open http://localhost:8080/#/cv
```
- **Exact formulas:**
  - CV% = 100 × [p_lower × D − 1]
  - push markets: 100 × [p_win_lower × (D − 1) − p_loss_upper]
  - SGP: 100 × [P_joint_lower × D_SGP − 1], **only with an actual combined quote**.
- **Docs:** `docs/AUDIT.md`, `docs/BENCHMARKS.md` (measured results), `docs/DEPLOYMENT.md`, `docs/LIMITATIONS.md`.
- **Contracts:** `contracts/targets.json`, `contracts/features.json`, `contracts/odds_schema.json`.
- **Tests:** `node --test tests/engine.test.js tests/cv_sgp.test.js` and `.venv/bin/python -m pytest ml/tests -q`.

---

# Synthetic research terminal

An institutional-style hockey analytics and prediction terminal. It has no dependencies and no build step: plain HTML, CSS and JavaScript, with every chart drawn as hand-written SVG.

> **All data is synthetic.** Players, ratings, statistics and forecasts are produced by the terminal's own simulator, for illustration only. Franchise names are labels only. This is not betting advice.

## Run it

```bash
npm start            # or: python3 -m http.server 8080
open http://localhost:8080
npm test             # engine regression suite (node ≥ 18)
```

Startup takes a few seconds: the browser generates the league, simulates the season event by event, fits every metric and runs the backtests.

## The core idea: one engine for everything

```
league.js   → 32 teams · 640 players, each with a hidden latent talent vector
sim.js      → shift/event-level game simulator (40 s segments, penalties, PP release,
              score effects, goalie pulls & hooks, 3v3 OT, shootout)
season.js   → 82-game schedule; first 48 rounds simulated → ~92k shot events
metrics.js  → 80 universal skater + 4×30 positional + 60 goalie + 200 team metrics
chem.js     → line/pair chemistry = Σ individual impact + shrunk interaction term
estimate.js → talent re-estimated from MEASURED stats (forecaster never sees truth)
predict.js  → Monte Carlo on the estimated league + analytic Poisson layer + SGP pricer
audit.js    → forward-only backtests, calibration, xG diagnostics, data-quality checks
```

The historical season and every forecast come from the same event engine. That keeps the numbers consistent with each other: in every simulation, skater goals add up to the team's score, saves equal shots against minus goals against, and every assist belongs to a teammate who was on the ice. The Model Audit page checks these rules live.

Metrics are tagged by source:
- **PBP**: measured from simulated play-by-play.
- **TRK**: tracking or charting equivalents (entries, exits, gaps). These are modelled from skills plus noise that depends on sample size.
- **MDL**: model outputs.

## Workspaces

| Route | What it shows |
|---|---|
| `#/home` | Dashboard for the focus team: skater, goalie and team cards, xG trend, shot map, zone play, line and pair chemistry, matchup matrix, next-game projections, calibration |
| `#/player/:id` | Profiles for all 576 skaters: 80 metrics, positional module(s), usage splits, shot map, trends, comparable players, Monte Carlo projection with the reasons behind it |
| `#/goalie/:id` | All 64 goalies: 60-metric profile, GSAx, net save map, danger splits, game log, next-start projection |
| `#/team[/:abbr]` | League table you can rank by any of the 200 metrics, plus all 32 team profiles (20 categories × 10 metrics with ranks), roster and schedule |
| `#/lines/:abbr` | Lines, pairs, PP and PK units, chemistry breakdown with confidence intervals, line builder |
| `#/matchup/:a/:b` | What drives the win probability, line-vs-line and pair-vs-line matrices, category clash, style insights, goalie matchup |
| `#/predict/:home/:away` | Scenario simulator (goalie, rest, scratches), score grid, totals, strength splits, full projected box score, **same-game parlay builder** with joint probability, correlation lift, fair odds, EV and Kelly |
| `#/audit` | Backtests against baselines, calibration, projection error, feature importance, custom xG model, talent recovery, data quality, model library, versions |
| `#/explorer`, `#/leaders`, `#/library` | Shot and event explorer, league leaderboards, feature store (all 460 metric definitions) |

## Honest modelling notes
- The backtest predicts each game in date order using only information available before that game. With seed `20260127` it beats the coin-flip and home-ice baselines (Brier ≈ 0.244), but the calibration slope is above 1. The analytic layer is under-confident and could take less shrinkage.
- Finishing talent, PP skill and line chemistry are recovered poorly after 48 games (r ≈ 0.3–0.4). That is why they are shrunk hard.
- Goalie starts are probability-weighted unless a starter is pinned in the scenario controls.

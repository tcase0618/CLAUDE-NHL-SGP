# NHL Quant Intelligence Platform

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

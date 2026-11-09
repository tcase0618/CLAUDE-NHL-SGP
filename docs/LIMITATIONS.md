# Unsupported Capabilities & Unresolved Limitations

Stated plainly so that nothing in the terminal is mistaken for something it isn't.

## Data
- **Regular season only.** Playoff targets are registered but disabled: the OT rules differ (no shootout) and there are too few games to validate.
- **No play-by-play, shift charts or tracking.** These real targets are **disabled**:
  - shot attempts (Corsi);
  - power-play TOI;
  - xG for real players;
  - zone entries/exits;
  - line combinations;
  - most of the synthetic terminal's 80/60/200-metric profiles.
  Those profiles remain synthetic and DEMO-labelled.
- **No confirmed lineups or starting goalies.** The projected lineup is the team's most recent dressed lineup. Goalie starts come from a start-probability model. Late scratches and goalie changes are not seen until data is refreshed.
- **No injury feed.** Injury adjustments only show up when a player stops appearing in lineups.
- **Empty-net goals** count toward team SOG but not goalie shots against. The joint simulator does not model EN situations, which biases simulated saves slightly.

## Markets & prices
- **Polymarket US (live, free):** `ml/polymarket.py` reads the public gateway (`gateway.polymarket.us/v1`, no key; the authenticated trading API is never used).
  - It lists **only NHL full-game winner markets and futures**: no player props, no totals. So it prices the `t_win` target and cannot price player-prop SGPs.
  - Its Combos/RFQ product sits behind the authenticated trading API and is not used.
  - Net odds use the documented taker fee Θ·p·(1−p) (Tier 1 Θ = 0.095 by default; set `--tier`). Per-fill $0.01 banker's rounding is ignored, which is slightly optimistic for very small orders.
  - Futures are fetched but not modelled.
- **No odds are bundled and none are fabricated.** CV% exists only next to a real quote, from `ml/odds.py` (needs `ODDS_API_KEY`) or entered manually.
- **The Odds API does not provide combined SGP prices.** SGP CV% therefore requires the user to type in the sportsbook's quoted combined price for the exact combination.
- **No historical sportsbook prices.** Historical single-prop and SGP **returns are not reported**. Backtests measure probability calibration only.
- **Settlement rules modelled:** half-point lines (no push), integer lines (push), goalie legs conditional on starting, shootout excluded.
- **Not modelled:** book-specific SGP repricing when a leg voids (a player doesn't dress), alternate-line ladders, "to score 2+" variants beyond integer thresholds. Combinations exposed to these are marked unsupported.

## Models
- **AutoGluon** runs tabular models only (LightGBM, XGBoost, RandomForest, ExtraTrees, linear) under a 60 s per-target budget. No neural nets (no PyTorch, no GPU) and no TimeSeriesPredictor: daily per-player counts are better served by rolling-window tabular features.
- **Count targets** use a predicted mean plus a Poisson/NB2 distribution chosen on the selection window. Hurdle, zero-inflated and quantile models were not needed: NB2 handled the overdispersion. This is a judgment, not an exhaustive comparison.
- **Points vs goals + assists** are modelled as separate targets. Their means need not add up exactly. The joint simulator enforces points = goals + assists in every simulated game, and reconciliation pulls its marginals toward the ML means.
- **Conservative bounds** are empirical: calibration bias plus 1.645 × the bin standard error on the selection window. Coverage on test is reported per threshold, and it is not guaranteed out of sample.
- **Champion selection** uses a 7,151-row selection window that spans the 2026 Olympic break, which is thin for rare thresholds (e.g. 3+ goals).

## Joint / SGP engine
- **Dependence comes from shared structure:** pace, team offense, finishing, usage, shots→goals→assists, opponent shots→blocks and saves. Parameters are estimated by moments on the selection window.
- **Residual correlations not captured by that structure** (true line chemistry, PP-unit composition, coaching game script) are absent. Real line data would be required.
- **Search is a beam search, not exhaustive.** The number of combinations evaluated is reported on every run.
- **Rare 8-leg events:** importance sampling was not implemented. Instead the engine:
  - requires at least 80 simulated hits and relative error ≤ 15%;
  - offers 50k-sim runs;
  - marks everything else **unverified**.
- **Joint calibration tables** come from realised outcomes on held-out games (random and search-selected combinations). Coverage is checked on a later window. The sample for 8-leg is small, so treat its bounds as provisional.

## Platform
- The real-data section requires a browser to load generated `data/artifacts/*.js`.
- Odds you enter are stored in that browser's `localStorage` only (export/import JSON to move them).
- No automated wagering exists or is planned. Nothing here is a guarantee of profit.

## Team markets in SGPs (added 2026-11-08)
- Moneyline, puck line (±1.5), team totals (o/u 2.5, 3.5) and game totals (o/u 5.5, 6.5) are SGP legs, priced by the
  same joint simulation as the player props and settled on the FINAL score (a shootout counts as one goal, as at books).
- Final score = regulation goals + late-game score effects (late equalizer `eqP`, empty-netter `enP`, fitted on the FIT
  window only — `pipeline/fit_scoreline.js`) + OT/shootout winner (home share `otHome`). Values: `contracts/sim_calibration.json`.
- Held-out calibration (635 games): regulation ties 21.8% predicted vs 22.8% actual; PL −1.5 29.8% vs 29.6%; game over 6.5
  45.8% vs 47.4%; team total over 2.5 61.1% vs 60.7%. Game-script families: 5F 461 hits vs 439.9 expected (independence
  350.9); 8G 222 vs 214.5 (independence 136.2).
- Player props ignore OT goals (slightly conservative for overs). **First goal scorer is NOT supported**: the simulator does
  not order goals in time, so it is never offered.
- Hits are simulated (for pace/blocks) but never offered as legs — not a bettable market for this user.

## Card contract (hard-coded, 2026-11-09)
- `pipeline/tonight.js` CARD = {3: 3, 5: 3, 8: 3}: every game always publishes exactly 3 three-leg, 3 five-leg and 3 eight-leg
  parlays; the script fails loudly (exit 1) if any game would ship fewer. Not configurable.
- Diversity: a single leg appears in at most 3 of a game's 9 parlays (2026-11-08 audit: one 0-block leg sank 6 parlays).
  When the cap binds, the search re-runs without saturated legs instead of reusing them. Exposure is relaxed only as a last
  resort, and any combo below the simulation-precision bar is flagged "unverified" rather than hidden or dropped.
- Build order 3 → 5 → 8: the shortest (most bettable) parlays get the strongest legs. On 10 upcoming games this lifted the
  average best 3-leg from 42.5% to 56.4% and 5-leg from 32.9% to 36.8%, at the cost of the best 8-leg (18.9% → 14.4%).

# Post-mortem — Friday 2026-11-06 slate (17 parlays, 3 games graded)

Graded against official NHL box scores. Model v20261106-224110. Card built 00:39Z from data through 2026-11-06 02:30Z.

## Results
| | Result | Model expected |
|---|---|---|
| Parlays (settled) | **7 W – 9 L**, 1 void (44%) | 6.17 wins |
| Unique legs | **30 – 7** (81.1%) | 29.0 |
| $2/parlay at fair price | +$7.75 (+22.8%) on $34 | — (book prices unavailable) |
| Joint vs independence (Brier / log loss) | **0.238 / 0.669** vs 0.242 / 0.687 | joint better |

## What went right
1. **Prop probabilities are calibrated.** Every priced player in all 3 games, 14 markets × 102 player-games. Every market's Brier score beat a constant-rate baseline. Mean-stat bias: SOG −0.02, goals +0.02, assists +0.05, points +0.06, hits +0.02 per player.
2. **Parlay win count matched the model:** 7 actual vs 6.17 expected.
3. **The joint simulator beat the independence assumption** on both Brier and log loss.
4. **Correlation captured where it mattered:** the SJS@MIN 8-leg C (MIN offense + Celebrini, lift 1.42×) cashed at a +576 fair price.
5. **Lineup projection:** every leg's player dressed. Overall 6 of 108 projected skater slots differed from the actual lineup; none was in a parlay.
6. **Pipeline:** card built, settled and audited end to end with no manual data handling.

## What went wrong
1. **Goalie starts.** The model favoured the wrong goalie in 2 of 6 starts (SJS Nedeljkovic 61% → Askarov started; CGY Cooley 49% → Wolf, rated 21%, started).
   - Held-out 2026-27: the top pick starts **62.5%** of the time; **78.8%** when ≥70% confident; **53.9%** when below.
   - Cost: 1 void leg, 2 affected parlays.
2. **Portfolio concentration.** The same legs were reused across many parlays:
   - Carlsson 2+ SOG (68%, finished 1 short) sank **4** parlays.
   - Malott 1+ hit (88%, 0 hits) sank **3**.
   - Two leg misses produced 7 of the 9 losses.
3. **No real prices.** No sportsbook SGP quotes, so no true P&L. The fair-price result is a ceiling, not an outcome. Below ~70% of fair profit, the night loses money.
4. **Settlement bug (fixed):** live box scores leave the goalie `starter` flag empty, which would have voided every goalie leg. Starter is now inferred from TOI.

## Watch list (not yet actionable at n = 1 night)
- **Underpriced tails?** High thresholds ran slightly under-predicted (blocks 2+: 19.5% pred vs 23.5% actual; SOG 3+: 22.2% vs 27.5%; PPP 1+: 8.6% vs 12.7%). This matches the historical finding that selected combos hit more than predicted. Monitor across nights before changing anything.
- **Team shot environment** missed in 3 of 6 teams (BUF 37 vs 28.0 expected; CGY 21 vs 26.5; SJS 24 vs 28.1). Normal variance at n = 6; keep tracking.
- **0.5-hit legs** are 12 of 38 unique legs. Confirm books offer those lines at sane prices.

## Tweaks applied (live in the scheduled scans)
| Tweak | Why |
|---|---|
| Goalie legs only if starter confirmed or model ≥ 85% (`sgp.GOALIE_MIN_START`) | Start model is ~coin-flip below 70% |
| A leg can appear in at most 2 parlays per game (`sgp.MAX_LEG_EXPOSURE`) | One leg miss sank up to 4 parlays |
| Goalie `starter` inferred from TOI in settlement | Prevents false voids |

## Tweaks recommended (need data or a retrain)
1. **Retrain the goalie start model** with recency features (last-5 start share, back-to-back pattern, consecutive starts) and a confirmed-starter feed. Biggest single source of avoidable error.
2. **Real SGP prices** for every published parlay, so CV% and P&L are real.
3. **Accumulate ≥ 10 nights** of settled parlays before recalibrating the tail probabilities.

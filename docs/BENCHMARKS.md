# Benchmarks & Measured Results

All figures were measured in this environment (4 vCPU, 15 GB RAM, no GPU, Python 3.13, Node 22). Nothing here is estimated.

## Pipeline timings
| Stage | Measured |
|---|---|
| Ingest 2,885 games (boxscore + landing, 4 workers, polite pacing) | ~16 min (first run; incremental re-runs only fetch new games) |
| Tables + point-in-time features (107,344 skater rows, 169 features) | 9.5–10.7 s |
| Full training, 15 targets (XGBoost 8-config grid + AutoGluon 60 s budget each) | ~47 min (per target below) |
| Inference only (champion models reloaded, 97-game slate) | 7.6 s |
| Export (joint-parameter fit + artifacts) | 16.7 s |
| Polymarket US feed (31 markets, BBO + book each) | ~55 s |
| Historical SGP validation (635 games, 2 × 4,000 sims each, 24,535 combos, 28.6 M beam evaluations) | 497 s |

## Joint simulator & SGP engine (Node, `pipeline/bench.js`)
| Metric | Value |
|---|---|
| Simulated games / s (n = 5k / 20k / 50k) | 11,996 / 29,299 / 33,335 |
| 3-leg research (all families, 20k sims) | 787 ms · 12,965 candidates |
| 5-leg research | 587 ms · 17,571 candidates |
| 8-leg research | 732 ms · 19,199 candidates |
| 1,000,000 CV% calculations | 10.5 ms |
| Peak RSS (bench) | 243 MB |

## Storage
- 23M data/raw
- 2.9G models/artifacts
- 46M data/build

## Model results — held-out TEST window (≥ 2026-03-01, never used for any decision)
Metric: mean Poisson deviance (counts), log loss (binary), RMSE (TOI). Lower is better. The champion was selected on the SELECT window.

| Target | Family | Train / test rows | Baseline | XGBoost | AutoGluon | Champion | vs baseline | Train s |
|---|---|---|---|---|---|---|---|---|
| sk_sog | count | 57,089 / 22,478 | 1.2318 | 1.2165 | 1.2209 | **xgboost** 1.2165 | +1.2% | 230.3 |
| sk_goals | count | 57,089 / 22,478 | 0.6299 | 0.5938 | 0.5972 | **xgboost** 0.5938 | +5.7% | 287.5 |
| sk_assists | count | 57,089 / 22,478 | 0.8035 | 0.7720 | 0.7745 | **autogluon** 0.7745 | +3.6% | 247.9 |
| sk_points | count | 57,089 / 22,478 | 0.9496 | 0.9193 | 0.9240 | **blend** 0.9202 | +3.1% | 236.3 |
| sk_blocks | count | 57,089 / 22,478 | 1.1059 | 1.0911 | 1.0942 | **xgboost** 1.0911 | +1.3% | 248.7 |
| sk_hits | count | 57,089 / 22,478 | 1.2019 | 1.1881 | 1.1942 | **xgboost** 1.1881 | +1.2% | 221.2 |
| sk_ppp | count | 57,089 / 22,478 | 0.3922 | 0.3755 | 0.3805 | **xgboost** 0.3755 | +4.3% | 233.7 |
| sk_toi | continuous | 57,089 / 22,478 | 2.6320 | 2.4604 | 2.4602 | **xgboost** 2.4604 | +6.5% | 213.3 |
| g_saves | count | 3,315 / 1,267 | 2.1320 | 2.0008 | 1.9787 | **autogluon** 1.9787 | +7.2% | 9.1 |
| g_shots_against | count | 3,315 / 1,267 | 1.9152 | 1.7950 | 1.7528 | **autogluon** 1.7528 | +8.5% | 9.1 |
| g_goals_against | count | 3,315 / 1,267 | 0.9975 | 0.9628 | 0.9528 | **autogluon** 0.9528 | +4.5% | 9.8 |
| g_start | binary | 9,743 / 3,787 | 0.5759 | 0.4484 | 0.4476 | **blend** 0.4466 | +22.5% | 5.0 |
| t_goals | count | 3,242 / 1,174 | 1.0363 | 1.0354 | 1.0574 | **baseline** 1.0363 | +0.0% | 8.1 |
| t_shots | count | 3,242 / 1,174 | 1.3538 | 1.3491 | 1.3284 | **blend** 1.3356 | +1.3% | 9.7 |
| t_win | binary | 1,619 / 587 | 0.6743 | 0.6845 | 0.6897 | **baseline** 0.6743 | +0.0% | 3.7 |

ML improvements over the simple historical baseline are real but modest. Two team targets (t_goals, t_win) kept the baseline because no ML model beat it on the selection window.

## SGP joint-probability validation (real held-out games, `pipeline/validate_sgp.js`)
Brier score (joint model / independence product). Bounds fit before 2026-07-01, evaluated after.

| Size | Stream | Window | n | Actual hit | Joint P | Independent P | Brier joint | Brier indep | Bound coverage |
|---|---|---|---|---|---|---|---|---|---|
| 3 | random | fit | 2,179 | 16.2% | 15.8% | 15.6% | 0.1300 | 0.1301 | 5/5 |
| 3 | random | eval | 1,525 | 16.1% | 16.1% | 16.0% | 0.1272 | 0.1273 | 4/5 |
| 3 | searched | fit | 2,761 | 52.9% | 49.3% | 47.8% | 0.2338 | 0.2344 | 5/5 |
| 3 | searched | eval | 1,861 | 53.0% | 48.9% | 47.4% | 0.2253 | 0.2263 | 5/5 |
| 5 | random | fit | 2,122 | 8.4% | 9.4% | 9.2% | 0.0759 | 0.0759 | 3/5 |
| 5 | random | eval | 1,477 | 9.1% | 9.6% | 9.3% | 0.0823 | 0.0822 | 4/5 |
| 5 | searched | fit | 2,846 | 34.5% | 30.7% | 29.4% | 0.2087 | 0.2107 | 5/5 |
| 5 | searched | eval | 1,980 | 34.7% | 30.6% | 29.1% | 0.2066 | 0.2087 | 5/5 |
| 8 | random | fit | 2,051 | 5.2% | 5.6% | 5.3% | 0.0488 | 0.0489 | 3/3 |
| 8 | random | eval | 1,470 | 6.6% | 5.7% | 5.5% | 0.0611 | 0.0612 | 3/3 |
| 8 | searched | fit | 2,536 | 16.1% | 15.5% | 14.3% | 0.1188 | 0.1189 | 3/3 |
| 8 | searched | eval | 1,727 | 17.0% | 15.2% | 14.0% | 0.1242 | 0.1248 | 3/3 |

**Reading:**
- **Random combinations:** the joint model is well calibrated, and it ties independence because unrelated legs carry little dependence.
- **Search-selected combinations:** the joint model beats independence on Brier and log loss at every size and in both windows. Both models still under-predict the realised hit rate. The simulator captures roughly a third of the missing positive dependence, most plausibly line chemistry, which needs shift data.
- **Returns:** no historical SGP quotes exist, so no historical CV% or return is claimed.

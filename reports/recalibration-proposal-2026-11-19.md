# Recalibration proposal — 10 settled nights (2026-11-19) — NOT APPLIED

Ledger: 520 graded parlays, 170 wins vs 150.9 expected (+19.1, z ≈ 2.0 assuming independence;
parlays within a game share legs, so true significance is lower).

| Band | n | Predicted | Actual | Gap | ~SE |
|---|---|---|---|---|---|
| 0–10% | 99 | 6.1% | 8.1% | +2.0 | 2.4 |
| 10–25% | 136 | 16.0% | 20.6% | +4.6 | 3.1 |
| 25–40% | 133 | 32.7% | 36.1% | +3.4 | 4.1 |
| 40–60% | 142 | 51.5% | 57.7% | +6.2 | 4.2 |
| 60–100% | 10 | 65.9% | 40.0% | −25.9 | 15 |

## Finding
The joint model is consistently **under-confident in 0–60%** (every band runs hot, none individually
significant). This matches the 635-game held-out validation (search-selected combos beat prediction).
The 60%+ band has only 10 parlays — no inference possible.

## Proposal (requires user approval)
1. **Display-only calibrated %** alongside raw joint %: shrinkage-weighted band ratio,
   p_cal = p · (1 + w·(r_band − 1)), w = n/(n+400) → ~+3–5% relative uplift today.
   Raw joint % and break-even remain the official numbers.
2. **Do not change pick selection** — calibration is monotone within bands, so ranking is unchanged.
3. **Cap at 60%** (no uplift above the band with n < 50).
4. Re-evaluate at 20 nights; promote calibrated % to official break-even only if the gap persists
   at z ≥ 2 with per-game clustering accounted for.

Rationale for not applying now: tightening break-even prices on a ~2σ, clustered signal risks
recommending bets at prices that are only fair under an optimistic model. Conservative is the safe error.

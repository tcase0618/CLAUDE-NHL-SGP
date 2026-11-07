# Roadmap — what runs automatically, what's next

## Running automatically
| When | What |
|---|---|
| 60 min before every puck drop (simultaneous games grouped) | `ml/slot_scan.py`: incremental ingest → champion inference → goalie check → Polymarket → 3/5/8-leg card → ledger update → republish terminal → message with the picks |
| 5:47 AM ET daily | Planner: settle last night, update `reports/ledger.md`, schedule the day's slot scans, report |

## Next, ordered by expected impact
1. **Real SGP prices (highest leverage).** Paste your book's quoted price for each parlay (Odds Desk or chat) before the slot. Then the system:
   - bets only parlays priced above break-even (positive CV%);
   - settles at the true price;
   - turns the ledger P&L from a fair-price ceiling into real results.
2. **Rolling training windows.** Train/tune/select dates are fixed today, so a weekly retrain changes little. Make the windows relative (e.g. select = last 45 days) and retrain weekly, with promotion gated as now.
3. **Confirmed lineups & starters.** Add a confirmed-starter source and re-scan T-15 when a starter is announced. Goalie legs are gated at ≥ 85% (right 94% of the time on this season's held-out games) until then.
4. **Tail calibration (after ≥ 10 nights).** One night showed high thresholds (blocks 2+, SOG 3+, PPP) hitting slightly more than predicted, consistent with the historical validation. Recalibrate only when the ledger has the sample.
5. **Line chemistry from shift data.** The biggest remaining gap in the joint model: search-selected parlays hit more than predicted because same-line dependence isn't modelled.
6. **Bet-sizing layer** (only after 2): fractional Kelly on CV%-positive parlays, with exposure caps per game and per player.

## Guardrails (unchanged)
- No fabricated prices.
- No automated wagering.
- Champion/challenger promotion on the selection window only.
- Every card is settled and kept in the ledger.

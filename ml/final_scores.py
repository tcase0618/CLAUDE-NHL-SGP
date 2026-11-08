"""Final scores for held-out games → data/build/final_scores.json (used by pipeline/validate_sgp.js
to settle moneyline / puck line / team & game totals). Also reports the OT/shootout home-win rate
in the FIT window (before 2026-07-01), which the joint simulator uses for tied regulation games."""
import json, os, sys
import pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402

g = pd.read_parquet(os.path.join(ROOT, "data", "base", "games.parquet"))
out = {str(r.game_id): {"home": int(r.home_score), "away": int(r.away_score), "outcome": r.outcome} for r in g.itertuples()}
fit = g[(pd.to_datetime(g.start_utc, utc=True) < "2026-07-01") & g.outcome.isin(["OT", "SO"])]
ot_home = float((fit.home_score > fit.away_score).mean())
tot = g[pd.to_datetime(g.start_utc, utc=True) < "2026-07-01"]
json.dump({"scores": out, "otHome": ot_home, "otGames": int(len(fit)), "otShare": float(len(fit) / max(1, len(tot)))},
          open(os.path.join(ROOT, "data", "build", "final_scores.json"), "w"))
print(f"games {len(out)} · OT/SO games in fit window {len(fit)} ({100 * len(fit) / len(tot):.1f}%) · home win in OT/SO {100 * ot_home:.1f}%")

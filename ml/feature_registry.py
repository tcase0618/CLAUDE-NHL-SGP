"""Generate contracts/features.json — the feature registry (source, unit,
point-in-time availability rule, missing-data policy, definition) for every
model input, derived from nqml.models.FEATURES."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402
from nqml.models import FEATURES  # noqa: E402

STAT = {"goals": "goals", "assists": "assists", "points": "points", "sog": "shots on goal", "hits": "hits", "blocks": "blocked shots", "ppp": "power-play points",
        "toi": "time on ice (min)", "gf": "team goals for", "ga": "team goals against", "sf": "team shots for", "sa": "team shots against",
        "pen": "penalties taken", "pen_drawn": "penalties drawn (opponent penalties)", "win": "wins"}
WIN = {"l5": "last 5", "l10": "last 10", "l20": "last 20", "l30": "last 30", "l82": "last 82"}
PIT = "Aggregates only games whose scheduled start is strictly before this game's start (groupby().shift(1) before rolling)."


def describe(f: str, ent: str) -> dict:
    d = {"name": f, "entity": ent, "source": "api-web.nhle.com boxscore + landing", "availability": PIT, "missing": "NaN passed to model (native missing handling); rows with < 5 prior games excluded from training (skaters).", "unit": "count"}
    m = re.match(r"^(o?)t_(\w+?)_pg_(l\d+)$", f)
    if m:
        who = "opponent" if m.group(1) else "own team"
        d.update(definition=f"{who} {STAT.get(m.group(2), m.group(2))} per game, {WIN[m.group(3)]} games", unit="per game")
        return d
    m = re.match(r"^(\w+?)_(pg|p60)_(l\d+)$", f)
    if m:
        d.update(definition=f"player {STAT.get(m.group(1), m.group(1))} {'per game' if m.group(2) == 'pg' else 'per 60 minutes TOI'}, {WIN[m.group(3)]} games", unit=m.group(2))
        return d
    m = re.match(r"^g_(svpct|sa_pg)_(l\d+)$", f)
    if m:
        d.update(definition=f"goalie {'save percentage' if m.group(1) == 'svpct' else 'shots against per game'}, {WIN[m.group(2)]} appearances", unit="ratio" if m.group(1) == "svpct" else "per game")
        return d
    fixed = {
        "home": ("1 if home team", "binary", "schedule"), "is_d": ("1 if defenseman", "binary", "boxscore roster group"),
        "pos_c": ("1 if center", "binary", "boxscore"), "pos_w": ("1 if winger", "binary", "boxscore"),
        "gp_prior": ("player games in dataset before this game", "count", None), "g_gp_prior": ("goalie appearances before this game", "count", None),
        "fo_prior": ("expanding mean faceoff win % before this game", "ratio", None), "toi_rank": ("rank of prior l20 TOI/GP within the game's team lineup", "rank", None),
        "ppp_share_rank": ("rank of prior l82 PPP/GP within team lineup", "rank", None), "rest_days": ("days since team's previous game (capped 5)", "days", "schedule"),
        "b2b": ("1 if team played the previous day", "binary", "schedule"), "opp_rest": ("opponent rest days", "days", "schedule"), "opp_b2b": ("opponent back-to-back", "binary", "schedule"),
        "team_gp_prior": ("team games this season before this game", "count", None), "opp_gp_prior": ("opponent games this season before this game", "count", None),
        "starter_l10": ("starts in goalie's last 10 appearances", "count", None), "share_l10": ("share of team's last 10 games started by this goalie", "ratio", None),
        "days_since_start": ("days since goalie's last start (cap 30)", "days", None), "started_prev": ("1 if goalie started team's previous game", "binary", None),
    }
    if f in fixed:
        dfn, unit, src = fixed[f]
        d.update(definition=dfn, unit=unit)
        if src:
            d["source"] = "api-web.nhle.com " + src
            if src == "schedule":
                d["availability"] = "Known from the published schedule before the game."
    return d


reg = {"version": "1.0.0", "point_in_time_rule": PIT, "features": [describe(f, e) for e, fs in FEATURES.items() for f in fs]}
json.dump(reg, open(os.path.join(ROOT, "contracts", "features.json"), "w"), indent=1)
print(len(reg["features"]), "features registered;", sum(1 for f in reg["features"] if "definition" not in f), "missing definitions")

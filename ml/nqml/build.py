"""Raw NHL JSON -> normalized tables -> point-in-time feature matrices.

Tables (data/build/):
  games.parquet          one row per game
  skater_games.parquet   one row per skater appearance
  goalie_games.parquet   one row per goalie appearance
  team_games.parquet     one row per team per game
Feature matrices (data/build/):
  feat_skater.parquet, feat_goalie.parquet, feat_team.parquet, feat_gstart.parquet

POINT-IN-TIME RULE: every feature for a row with start time t aggregates only
rows with start time < t (implemented with groupby().shift(1) before rolling,
after a strict chronological sort). Same-day doubleheaders do not occur in
the NHL regular season, so start-time ordering is a total order per entity.
"""
from __future__ import annotations

import glob
import os

import numpy as np
import pandas as pd

from .ingest import RAW, ROOT, load_raw

BUILD = os.path.join(ROOT, "data", "build")


def _toi(s: str | None) -> float:
    if not s or ":" not in s:
        return 0.0
    m, sec = s.split(":")
    return int(m) * 60 + int(sec)


def build_tables() -> dict[str, pd.DataFrame]:
    gids = sorted({int(os.path.basename(p).split("_")[0]) for p in glob.glob(os.path.join(RAW, "*_box.json.gz"))})
    games, sk, gk = [], [], []
    for gid in gids:
        try:
            box, land = load_raw(gid)
        except Exception:
            continue
        if box.get("gameType") != 2:
            continue
        h, a = box["homeTeam"], box["awayTeam"]
        last = (box.get("gameOutcome") or {}).get("lastPeriodType", "REG")
        start = box["startTimeUTC"]
        # PP points & empty-net goals from the scoring summary (shootout excluded)
        ppp, eng = {}, {"H": 0, "A": 0}
        for per in (land.get("summary") or {}).get("scoring", []):
            if (per.get("periodDescriptor") or {}).get("periodType") == "SO":
                continue
            for gl in per.get("goals", []):
                ids = [gl.get("playerId")] + [x.get("playerId") for x in gl.get("assists", [])]
                if gl.get("strength") == "pp":
                    for pid in ids:
                        ppp[pid] = ppp.get(pid, 0) + 1
                if gl.get("goalModifier") == "empty-net":
                    eng["H" if gl.get("isHome") else "A"] += 1
        pens = {"H": 0, "A": 0}
        for per in (land.get("summary") or {}).get("penalties", []):
            for p in per.get("penalties", []):
                if p.get("type") in ("MIN", "MAJ", "BEN"):
                    side = "H" if (p.get("teamAbbrev") or {}).get("default") == h["abbrev"] else "A"
                    pens[side] += 1
        games.append(dict(game_id=gid, season=str(box["season"]), start_utc=start, home=h["abbrev"], away=a["abbrev"],
                          home_score=h.get("score", 0), away_score=a.get("score", 0), home_sog=h.get("sog", 0), away_sog=a.get("sog", 0),
                          outcome=last, home_pen=pens["H"], away_pen=pens["A"], home_eng=eng["H"], away_eng=eng["A"]))
        pbg = box.get("playerByGameStats", {})
        for side, team, opp, is_home in (("homeTeam", h["abbrev"], a["abbrev"], 1), ("awayTeam", a["abbrev"], h["abbrev"], 0)):
            t = pbg.get(side, {})
            for grp in ("forwards", "defense"):
                for p in t.get(grp, []):
                    sk.append(dict(game_id=gid, start_utc=start, season=str(box["season"]), player_id=p["playerId"],
                                   name=p["name"]["default"], team=team, opp=opp, home=is_home, pos=p.get("position", "F"),
                                   is_d=int(grp == "defense"), toi=_toi(p.get("toi")), goals=p.get("goals", 0), assists=p.get("assists", 0),
                                   points=p.get("points", 0), sog=p.get("sog", 0), hits=p.get("hits", 0), blocks=p.get("blockedShots", 0),
                                   pim=p.get("pim", 0), ppg=p.get("powerPlayGoals", 0), ppp=ppp.get(p["playerId"], 0), shifts=p.get("shifts", 0),
                                   fo_pct=p.get("faceoffWinningPctg", np.nan) if p.get("faceoffWinningPctg") is not None else np.nan,
                                   giveaways=p.get("giveaways", 0), takeaways=p.get("takeaways", 0), plus_minus=p.get("plusMinus", 0)))
            for p in t.get("goalies", []):
                gk.append(dict(game_id=gid, start_utc=start, season=str(box["season"]), player_id=p["playerId"], name=p["name"]["default"],
                               team=team, opp=opp, home=is_home, starter=int(bool(p.get("starter"))), toi=_toi(p.get("toi")),
                               shots_against=p.get("shotsAgainst", 0) or 0, saves=p.get("saves", 0) or 0, goals_against=p.get("goalsAgainst", 0) or 0,
                               decision=p.get("decision") or ""))
    G = pd.DataFrame(games)
    G["start_utc"] = pd.to_datetime(G["start_utc"], utc=True)
    S = pd.DataFrame(sk); S["start_utc"] = pd.to_datetime(S["start_utc"], utc=True)
    K = pd.DataFrame(gk); K["start_utc"] = pd.to_datetime(K["start_utc"], utc=True)
    rows = []
    for _, g in G.iterrows():
        for side in ("home", "away"):
            o = "away" if side == "home" else "home"
            rows.append(dict(game_id=g.game_id, start_utc=g.start_utc, season=g.season, team=g[side], opp=g[o], home=int(side == "home"),
                             gf=g[f"{side}_score"], ga=g[f"{o}_score"], sf=g[f"{side}_sog"], sa=g[f"{o}_sog"], pen=g[f"{side}_pen"],
                             pen_drawn=g[f"{o}_pen"], outcome=g.outcome, win=int(g[f"{side}_score"] > g[f"{o}_score"])))
    TG = pd.DataFrame(rows)
    os.makedirs(BUILD, exist_ok=True)
    for name, df in (("games", G), ("skater_games", S), ("goalie_games", K), ("team_games", TG)):
        df.to_parquet(os.path.join(BUILD, f"{name}.parquet"), index=False)
    return {"games": G, "skater_games": S, "goalie_games": K, "team_games": TG}


# ------------------------------------------------------------------ features
def _roll(df: pd.DataFrame, key: str, cols: list[str], windows: dict[str, int]) -> pd.DataFrame:
    """Prior-only rolling sums per entity: shift(1) then rolling(w, min_periods=1)."""
    out = {}
    g = df.groupby(key, sort=False)
    for c in cols:
        prior = g[c].shift(1)
        for tag, w in windows.items():
            out[f"{c}_{tag}"] = prior.groupby(df[key], sort=False).rolling(w, min_periods=1).sum().reset_index(level=0, drop=True)
    return pd.DataFrame(out, index=df.index)


def _team_context(TG: pd.DataFrame) -> pd.DataFrame:
    TG = TG.sort_values(["start_utc", "game_id"]).reset_index(drop=True)
    TG["n"] = 1 - TG.get("upcoming", 0)  # future games must not enter denominators
    r = _roll(TG, "team", ["gf", "ga", "sf", "sa", "pen", "pen_drawn", "win", "n"], {"l20": 20, "l82": 82})
    T = pd.concat([TG, r], axis=1)
    for w in ("l20", "l82"):
        n = T[f"n_{w}"].replace(0, np.nan)
        for c in ("gf", "ga", "sf", "sa", "pen", "pen_drawn", "win"):
            T[f"t_{c}_pg_{w}"] = T[f"{c}_{w}"] / n
    T["prev_start"] = T.groupby("team")["start_utc"].shift(1)
    T["rest_days"] = ((T["start_utc"] - T["prev_start"]).dt.total_seconds() / 86400).clip(upper=5).fillna(5)
    T["b2b"] = (T["rest_days"] < 1.5).astype(int)
    T["team_gp_prior"] = T.groupby(["team", "season"]).cumcount()
    keep = ["game_id", "team", "rest_days", "b2b", "team_gp_prior"] + [c for c in T.columns if c.startswith("t_")]
    return T[keep]


def build_features(tables: dict[str, pd.DataFrame] | None = None, upcoming: list[dict] | None = None) -> dict[str, pd.DataFrame]:
    if tables is None:
        tables = {k: pd.read_parquet(os.path.join(BUILD, f"{k}.parquet")) for k in ("games", "skater_games", "goalie_games", "team_games")}
    S, K, TG = tables["skater_games"].copy(), tables["goalie_games"].copy(), tables["team_games"].copy()
    # ---- append upcoming games as target-less rows so they receive identical features
    up_sk, up_tg = [], []
    if upcoming:
        last_lineup = S.sort_values("start_utc").groupby("team").apply(lambda d: d[d.game_id == d.game_id.iloc[-1]], include_groups=False).reset_index(level=0)
        for g in upcoming:
            t0 = pd.Timestamp(g["start_utc"])
            for team, opp, home in ((g["home"], g["away"], 1), (g["away"], g["home"], 0)):
                up_tg.append(dict(game_id=g["game_id"], start_utc=t0, season=g["season"], team=team, opp=opp, home=home))
                for _, p in last_lineup[last_lineup.team == team].iterrows():
                    up_sk.append(dict(game_id=g["game_id"], start_utc=t0, season=g["season"], player_id=p.player_id, name=p["name"], team=team,
                                      opp=opp, home=home, pos=p.pos, is_d=p.is_d, upcoming=1))
    if up_sk:
        S = pd.concat([S, pd.DataFrame(up_sk)], ignore_index=True)
        TG = pd.concat([TG, pd.DataFrame(up_tg)], ignore_index=True)
    S["upcoming"] = S.get("upcoming", 0)
    S["upcoming"] = S["upcoming"].fillna(0).astype(int)
    TG["upcoming"] = TG["game_id"].isin([g["game_id"] for g in (upcoming or [])]).astype(int)

    tctx = _team_context(TG)
    # opponent context: rename team features as opp_*
    octx = tctx.rename(columns={c: "o" + c for c in tctx.columns if c.startswith("t_")} | {"team": "opp", "rest_days": "opp_rest", "b2b": "opp_b2b", "team_gp_prior": "opp_gp_prior"})

    # ---- skaters
    S = S.sort_values(["start_utc", "game_id"]).reset_index(drop=True)
    S["n"] = 1 - S["upcoming"]  # future games must not enter denominators
    S["toi_min"] = S["toi"] / 60.0
    stat = ["goals", "assists", "points", "sog", "hits", "blocks", "ppp", "toi_min", "pim", "shifts", "takeaways", "giveaways", "n"]
    r = _roll(S, "player_id", stat, {"l5": 5, "l20": 20, "l82": 82})
    F = pd.concat([S, r], axis=1)
    for w in ("l5", "l20", "l82"):
        n = F[f"n_{w}"].replace(0, np.nan)
        toi = F[f"toi_min_{w}"].replace(0, np.nan)
        F[f"toi_pg_{w}"] = F[f"toi_min_{w}"] / n
        for c in ("goals", "assists", "points", "sog", "hits", "blocks", "ppp"):
            F[f"{c}_pg_{w}"] = F[f"{c}_{w}"] / n
            F[f"{c}_p60_{w}"] = 60 * F[f"{c}_{w}"] / toi
    F["gp_prior"] = F.groupby("player_id").cumcount()
    F["fo_prior"] = F.groupby("player_id")["fo_pct"].transform(lambda s: s.shift(1).expanding().mean())
    F["pos_c"] = (F["pos"] == "C").astype(int)
    F["pos_w"] = F["pos"].isin(["L", "R"]).astype(int)
    # team-relative usage rank (prior TOI rank within team over l20) — computed per game across the lineup
    F["toi_rank"] = F.groupby(["game_id", "team"])["toi_pg_l20"].rank(ascending=False, method="first")
    F["ppp_share_rank"] = F.groupby(["game_id", "team"])["ppp_pg_l82"].rank(ascending=False, method="first")
    F = F.merge(tctx, on=["game_id", "team"], how="left").merge(octx, on=["game_id", "opp"], how="left")
    # ---- goalies (starters only for workload targets)
    K = K.sort_values(["start_utc", "game_id"]).reset_index(drop=True)
    K["n"] = 1
    rk = _roll(K, "player_id", ["saves", "shots_against", "goals_against", "starter", "n"], {"l10": 10, "l30": 30})
    GK = pd.concat([K, rk], axis=1)
    for w in ("l10", "l30"):
        GK[f"g_svpct_{w}"] = GK[f"saves_{w}"] / GK[f"shots_against_{w}"].replace(0, np.nan)
        GK[f"g_sa_pg_{w}"] = GK[f"shots_against_{w}"] / GK[f"n_{w}"].replace(0, np.nan)
    GK["g_gp_prior"] = GK.groupby("player_id").cumcount()
    GK = GK.merge(tctx, on=["game_id", "team"], how="left").merge(octx, on=["game_id", "opp"], how="left")
    # ---- teams
    TF = TG.merge(tctx, on=["game_id", "team"], how="left").merge(octx, on=["game_id", "opp"], how="left")
    GS = goalie_start_frame(tables["goalie_games"], TG, tctx)
    os.makedirs(BUILD, exist_ok=True)
    GS.to_parquet(os.path.join(BUILD, "feat_gstart.parquet"), index=False)
    F.to_parquet(os.path.join(BUILD, "feat_skater.parquet"), index=False)
    GK.to_parquet(os.path.join(BUILD, "feat_goalie.parquet"), index=False)
    TF.to_parquet(os.path.join(BUILD, "feat_team.parquet"), index=False)
    return {"skater": F, "goalie": GK, "team": TF, "gstart": GS}


def goalie_start_frame(K: pd.DataFrame, TG: pd.DataFrame, tctx: pd.DataFrame) -> pd.DataFrame:
    """One row per (team-game, candidate goalie). Candidates = goalies who appeared
    for the team in its previous 20 games. Target `started` is missing for upcoming games."""
    K = K.sort_values("start_utc")
    starts = K[K.starter == 1][["game_id", "team", "player_id"]]
    start_by_game = {(r.game_id, r.team): r.player_id for r in starts.itertuples()}
    gk_hist: dict[int, list] = {}
    for r in K.itertuples():
        gk_hist.setdefault(r.player_id, []).append((r.start_utc, r.starter, r.saves, r.shots_against, r.name))
    rows = []
    TG = TG.sort_values("start_utc").merge(tctx, on=["game_id", "team"], how="left")
    for team, grp in TG.groupby("team", sort=False):
        hist = []  # list of (game_id, start_utc, starter_id, appeared ids)
        app = K[K.team == team].groupby("game_id")["player_id"].apply(list).to_dict()
        for r in grp.itertuples():
            prev = hist[-20:]
            cands = sorted({pid for h in prev for pid in h[3]})
            last10 = [h[2] for h in hist[-10:]]
            for pid in cands:
                gh = [x for x in gk_hist.get(pid, []) if x[0] < r.start_utc]
                st = [x for x in gh if x[1] == 1]
                l30 = gh[-30:]
                sa = sum(x[3] for x in l30); sv = sum(x[2] for x in l30)
                rows.append(dict(game_id=r.game_id, start_utc=r.start_utc, season=r.season, team=team, player_id=pid,
                                 name=gh[-1][4] if gh else "", home=r.home, b2b=r.b2b, rest_days=r.rest_days, team_gp_prior=r.team_gp_prior,
                                 share_l10=(sum(1 for x in last10 if x == pid) / len(last10)) if last10 else np.nan,
                                 days_since_start=min(30.0, (r.start_utc - st[-1][0]).total_seconds() / 86400) if st else 30.0,
                                 started_prev=int(bool(hist) and hist[-1][2] == pid), g_gp_prior=len(gh), g_svpct_l30=(sv / sa) if sa else np.nan,
                                 started=(int(start_by_game.get((r.game_id, team)) == pid) if (r.game_id, team) in start_by_game else np.nan),
                                 upcoming=int(getattr(r, "upcoming", 0) or 0)))
            hist.append((r.game_id, r.start_utc, start_by_game.get((r.game_id, team)), app.get(r.game_id, [])))
    return pd.DataFrame(rows)

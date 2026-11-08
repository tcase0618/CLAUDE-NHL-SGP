"""Fit joint-dependence parameters and export browser artifacts.

Writes:
  data/artifacts/ml_report.js   window.NQ_ML    — leaderboards, calibration, importances
  data/artifacts/slate.js       window.NQ_SLATE — upcoming real games: per-player model means,
                                                  distributions, lower-bound tables, joint params
  data/build/test_games.json    held-out games (pregame means + realised outcomes) for
                                pipeline/validate_sgp.js (joint-probability backtest)
  data/history/predictions.jsonl append-only, timestamped prediction log (auditable)
"""
from __future__ import annotations

import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from nqml.build import BUILD  # noqa: E402
from nqml.ingest import ROOT, load_raw  # noqa: E402
from train import T_SEL, T_TUNE  # noqa: E402

ART = os.path.join(ROOT, "data", "artifacts")
SK = {"SOG": "sk_sog", "G": "sk_goals", "A": "sk_assists", "PTS": "sk_points", "BLK": "sk_blocks", "HIT": "sk_hits", "PPP": "sk_ppp", "TOI": "sk_toi"}


def latest_report() -> dict:
    """Report of the registry CHAMPION version (falls back to the newest version)."""
    reg_p = os.path.join(ROOT, "models", "registry.json")
    if os.path.exists(reg_p):
        reg = json.load(open(reg_p))
        if reg.get("champion"):
            for d in ("artifacts", "serving"):
                rp = os.path.join(ROOT, "models", d, reg["champion"], "report.json")
                if os.path.exists(rp):
                    return json.load(open(rp))
    vs = sorted(glob.glob(os.path.join(ROOT, "models", "artifacts", "v*", "report.json")))
    return json.load(open(vs[-1]))


def _read(prefix: str, tid: str) -> pd.DataFrame | None:
    p = os.path.join(BUILD, f"{prefix}_{tid}.parquet")
    return pd.read_parquet(p) if os.path.exists(p) else None


def assemble(prefix: str, with_outcome: bool) -> list[dict]:
    """Build per-game structures from champion predictions in `prefix` frames."""
    frames = {k: _read(prefix, t) for k, t in SK.items()}
    base = frames["SOG"][["game_id", "player_id"]].copy()
    for k, f in frames.items():
        if f is None:
            continue
        base = base.merge(f[["game_id", "player_id", "mu"] + (["y"] if with_outcome else [])].rename(columns={"mu": "mu_" + k, "y": "y_" + k}), on=["game_id", "player_id"], how="left")
    feat = pd.read_parquet(os.path.join(BUILD, "feat_skater.parquet"), columns=["game_id", "player_id", "name", "team", "opp", "home", "pos", "is_d", "gp_prior", "start_utc"])
    base = base.merge(feat, on=["game_id", "player_id"], how="left")
    gs = _read(prefix, "g_start")
    sv = _read(prefix, "g_saves")
    gfeat = pd.read_parquet(os.path.join(BUILD, "feat_gstart.parquet"), columns=["game_id", "team", "player_id", "name"])
    gk = pd.read_parquet(os.path.join(BUILD, "goalie_games.parquet"), columns=["game_id", "player_id", "starter", "saves", "shots_against", "goals_against"])
    games = []
    for gid, d in base.groupby("game_id"):
        sides = {}
        for home in (1, 0):
            t = d[d.home == home].copy()
            if t.empty:
                continue
            t["toiRank"] = t["mu_TOI"].rank(ascending=False, method="first")
            players = []
            for r in t.itertuples():
                mu = {k: float(getattr(r, "mu_" + k)) if pd.notna(getattr(r, "mu_" + k, np.nan)) else 0.0 for k in SK}
                pl = {"id": int(r.player_id), "name": r.name, "pos": r.pos, "isD": int(r.is_d), "toiRank": int(r.toiRank), "gpPrior": int(r.gp_prior), "mu": mu}
                if with_outcome:
                    pl["y"] = {k: (int(getattr(r, "y_" + k)) if k != "TOI" and pd.notna(getattr(r, "y_" + k, np.nan)) else None) for k in SK if k != "TOI"}
                players.append(pl)
            team = t.team.iloc[0]
            goalies = []
            if gs is not None:
                c = gs[(gs.game_id == gid) & (gs.team == team)]
                if "name" not in c.columns:
                    c = c.merge(gfeat, on=["game_id", "team", "player_id"], how="left")
                tot = c.mu.sum()
                for r in c.itertuples():
                    g = {"id": int(r.player_id), "name": r.name, "pStart": float(r.mu / tot) if tot > 0 else 0.0}
                    if with_outcome:
                        a = gk[(gk.game_id == gid) & (gk.player_id == r.player_id)]
                        g["y"] = {"started": int(a.starter.iloc[0]) if len(a) else 0, "SV": int(a.saves.iloc[0]) if len(a) else None}
                    goalies.append(g)
            sides["home" if home else "away"] = {"abbr": team, "muS": float(sum(p["mu"]["SOG"] for p in players)),
                                                  "muG": float(sum(p["mu"]["G"] for p in players)), "players": players, "goalies": goalies}
        if len(sides) == 2:
            games.append({"game_id": int(gid), "start_utc": str(d.start_utc.iloc[0]), **sides})
    return games


def fit_joint(report: dict) -> dict:
    """Moment estimates of dependence parameters on the SELECT window."""
    games = assemble("sel", with_outcome=True)
    rh, ra, inv, gq, gb, gd, zn, zb, zd, blk_x, blk_y = [], [], [], [], [], [], [], [], [], [], []
    for g in games:
        r = {}
        for s in ("home", "away"):
            t = g[s]
            sf = sum(p["y"]["SOG"] or 0 for p in t["players"])
            gf = sum(p["y"]["G"] or 0 for p in t["players"])
            mus = max(1.0, t["muS"]); q = t["muG"] / mus
            r[s] = sf / mus - 1; inv.append(1 / mus)
            gq.append((gf - q * sf) ** 2); gb.append(sf * q * (1 - q)); gd.append((q * sf) ** 2)
            for p in t["players"]:
                sh = p["mu"]["SOG"] / mus; e = sf * sh
                zn.append((p["y"]["SOG"] - e) ** 2); zb.append(sf * sh * (1 - sh)); zd.append(e * e)
            t["_sf"] = sf
        rh.append(r["home"]); ra.append(r["away"])
        for s, o in (("home", "away"), ("away", "home")):
            mb = sum(p["mu"]["BLK"] for p in g[s]["players"]); yb = sum(p["y"]["BLK"] or 0 for p in g[s]["players"])
            if mb > 0 and yb > 0 and g[o]["_sf"] > 0:
                blk_x.append(np.log(g[o]["_sf"] / max(1, g[o]["muS"]))); blk_y.append(np.log(yb / mb))
    rh, ra = np.array(rh), np.array(ra)
    sigE2 = max(0.0, float(np.cov(rh, ra)[0, 1]))
    var_r = float(np.var(np.concatenate([rh, ra])))
    sigO2 = max(0.0, var_r - float(np.mean(inv)) - sigE2)
    sigW2 = max(0.0, (np.mean(gq) - np.mean(gb)) / np.mean(gd))
    sigZ2 = max(0.0, (np.mean(zn) - np.mean(zb)) / np.mean(zd))
    blkK = float(np.polyfit(blk_x, blk_y, 1)[0]) if len(blk_x) > 30 else 0.8
    # assist-count distribution from TRAIN+TUNE scoring summaries (structural constant)
    cnt = np.zeros(3)
    gm = pd.read_parquet(os.path.join(BUILD, "games.parquet"), columns=["game_id", "start_utc"])
    for gid in gm[gm.start_utc < T_SEL].game_id.sample(min(600, len(gm)), random_state=1):
        try:
            _, land = load_raw(int(gid))
        except Exception:
            continue
        for per in (land.get("summary") or {}).get("scoring", []):
            if (per.get("periodDescriptor") or {}).get("periodType") == "SO":
                continue
            for gl in per.get("goals", []):
                cnt[min(2, len(gl.get("assists", [])))] += 1
    assist = (cnt / cnt.sum()).tolist()
    T = report["targets"]
    alpha = lambda tid: T[tid]["dist"][T[tid]["champion"]]["alpha"] if tid in T and "dist" in T[tid] else 0.3
    return {"sigE": float(np.sqrt(sigE2)), "sigO": float(np.sqrt(sigO2)), "sigW": float(np.sqrt(sigW2)), "sigZ": float(np.sqrt(sigZ2)),
            "assist": assist, "alphaH": alpha("sk_hits"), "alphaB": alpha("sk_blocks"), "blkK": round(min(1.5, max(0.0, blkK)), 3),
            "fit": {"games": len(games), "window": f"{T_TUNE.date()}..{T_SEL.date()}", "goals_counted": int(cnt.sum())}}


def lower_tables(report: dict) -> dict:
    out = {}
    for tid, t in report["targets"].items():
        if "thresholds" in t:
            out[tid] = {k: [{"hi": r["hi"], "adj": r["adj"]} for r in v["lower_table"]] for k, v in t["thresholds"].items()}
        elif "binary" in t:
            out[tid] = {"p": [{"hi": r["hi"], "adj": r["adj"]} for r in t["binary"]["lower_table"]]}
    return out


def slim_report(report: dict) -> dict:
    r = {k: report[k] for k in ("version", "trained_at", "data_hash", "libs", "windows", "timing")}
    r["targets"] = {}
    for tid, t in report["targets"].items():
        s = {k: t[k] for k in ("entity", "family", "champion", "leaderboard", "n", "xgb_gain", "seconds") if k in t}
        for k in ("shap", "ag_leaderboard", "ag_importance", "dist", "binary", "continuous", "xgb_search", "xgb_rounds"):
            if k in t:
                s[k] = t[k]
        if "thresholds" in t:
            s["thresholds"] = {k: {kk: v[kk] for kk in ("test_rate", "models", "reliability", "coverage")} for k, v in t["thresholds"].items()}
        r["targets"][tid] = s
    return r


def write_js(path: str, var: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(f"/* generated {datetime.now(timezone.utc).isoformat()} — do not edit */\nwindow.{var} = ")
        json.dump(obj, f, default=lambda x: float(x) if isinstance(x, (np.floating,)) else int(x) if isinstance(x, np.integer) else str(x), separators=(",", ":"))
        f.write(";\n")


def main():
    report = latest_report()
    serve_dir = os.path.join(ROOT, "models", "serving", report["version"])
    if os.path.exists(os.path.join(BUILD, "sel_sk_sog.parquet")):
        params = fit_joint(report)
        os.makedirs(serve_dir, exist_ok=True)
        json.dump(params, open(os.path.join(serve_dir, "joint_params.json"), "w"), indent=1)
    else:  # serve-only container: reuse the dependence parameters fitted at training time
        params = json.load(open(os.path.join(serve_dir, "joint_params.json")))
    # committed, validated simulator calibration (pace shock, late-game score effects, OT home share)
    cal = os.path.join(ROOT, "contracts", "sim_calibration.json")
    if os.path.exists(cal):
        params.update(json.load(open(cal))["params"])
    print("joint params", json.dumps(params))
    games_meta = pd.read_parquet(os.path.join(BUILD, "games.parquet"), columns=["start_utc"])
    data_through = str(games_meta.start_utc.max())
    dists = {tid: t["dist"][t["champion"]] for tid, t in report["targets"].items() if "dist" in t}
    slate = {"generated_at": datetime.now(timezone.utc).isoformat(), "model_version": report["version"], "data_through": data_through,
             "games": assemble("upcoming", with_outcome=False), "params": params, "dist": dists, "lower": lower_tables(report),
             "champions": {tid: t["champion"] for tid, t in report["targets"].items()},
             "coverage": {**{tid: {k: v["coverage"]["rate"] for k, v in t["thresholds"].items()} for tid, t in report["targets"].items() if "thresholds" in t},
                          **{tid: {"p": t["binary"]["coverage"]["rate"]} for tid, t in report["targets"].items() if "binary" in t}},
             "testN": {tid: t["n"]["test"] for tid, t in report["targets"].items()},
             "beatsBaseline": {tid: t["champion"] != "baseline" and t["leaderboard"][t["champion"]]["select"] < t["leaderboard"]["baseline"]["select"] for tid, t in report["targets"].items()}}
    # model comparison per player for the slate (xgb / ag / baseline means)
    comp = {}
    for k, tid in SK.items():
        f = _read("upcoming", tid)
        if f is None:
            continue
        for r in f.itertuples():
            key = f"{r.game_id}:{r.player_id}"
            comp.setdefault(key, {})[k] = {m: float(getattr(r, "mu_" + m)) for m in ("baseline", "xgboost", "autogluon", "blend") if hasattr(r, "mu_" + m)}
    slate["models"] = comp
    # team moneyline: t_win champion is trained on HOME rows → P(home wins incl. OT/SO)
    tw = _read("upcoming", "t_win")
    if tw is not None:
        home = tw[tw.home == 1]
        by = {int(r.game_id): r for r in home.itertuples()}
        for g in slate["games"]:
            r = by.get(g["game_id"])
            if r is not None:
                g["teamWin"] = {"pHome": float(r.mu), "models": {m: float(getattr(r, "mu_" + m)) for m in ("baseline", "xgboost", "autogluon", "blend") if hasattr(r, "mu_" + m)}}
    # last-10 real game lines for every slate player (player-intelligence links)
    sg = pd.read_parquet(os.path.join(BUILD, "skater_games.parquet"), columns=["player_id", "start_utc", "opp", "home", "toi", "goals", "assists", "sog", "blocks", "hits", "ppp"])
    ids = {p["id"] for g in slate["games"] for s in ("home", "away") for p in g[s]["players"]}
    sg = sg[sg.player_id.isin(ids)].sort_values("start_utc")
    slate["recent"] = {int(pid): [[str(r.start_utc.date()), r.opp, int(r.home), round(r.toi / 60, 1), int(r.goals), int(r.assists), int(r.sog), int(r.blocks), int(r.hits), int(r.ppp)]
                                  for r in d.tail(10).itertuples()] for pid, d in sg.groupby("player_id")}
    write_js(os.path.join(ART, "slate.js"), "NQ_SLATE", slate)
    write_js(os.path.join(ART, "ml_report.js"), "NQ_ML", slim_report(report))
    test = assemble("test", with_outcome=True) if os.path.exists(os.path.join(BUILD, "test_sk_sog.parquet")) else []
    if test:
        json.dump({"params": params, "games": test, "model_version": report["version"]}, open(os.path.join(BUILD, "test_games.json"), "w"))
    # append-only prediction history
    hist = os.path.join(ROOT, "data", "history")
    os.makedirs(hist, exist_ok=True)
    with open(os.path.join(hist, "predictions.jsonl"), "a") as f:
        for g in slate["games"]:
            for s in ("home", "away"):
                for p in g[s]["players"]:
                    f.write(json.dumps({"ts": slate["generated_at"], "model_version": report["version"], "game_id": g["game_id"], "player_id": p["id"], "mu": p["mu"]}) + "\n")
    print(f"slate games {len(slate['games'])}, test games {len(test)}")


if __name__ == "__main__":
    main()

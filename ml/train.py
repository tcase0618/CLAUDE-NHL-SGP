"""Train, select, calibrate and persist every enabled target.

Usage:  .venv/bin/python ml/train.py [--ag-time 60] [--no-ag] [--targets sk_sog,sk_points]

Chronological windows (see contracts/targets.json):
  TRAIN  start <  2025-12-01
  TUNE   2025-12-01 .. 2026-01-15   early stopping (XGB) / tuning_data (AutoGluon)
  SELECT 2026-01-16 .. 2026-02-28   champion selection, distribution fit, lower-bound tables
  TEST   start >= 2026-03-01         held out — reported, never used for any decision
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from nqml import dist  # noqa: E402
from nqml.build import BUILD  # noqa: E402
from nqml.ingest import ROOT  # noqa: E402
from nqml.models import FEATURES, AutoGluonModel, Baseline, XGBSpecialist  # noqa: E402

T_TRAIN = pd.Timestamp("2025-12-01", tz="UTC")
T_TUNE = pd.Timestamp("2026-01-16", tz="UTC")
T_SEL = pd.Timestamp("2026-03-01", tz="UTC")
ART = os.path.join(ROOT, "models", "artifacts")
REG = os.path.join(ROOT, "models", "registry.json")
FRAME = {"skater": "feat_skater", "goalie": "feat_goalie", "team": "feat_team", "goalie_candidate": "feat_gstart"}


def load_frames() -> dict[str, pd.DataFrame]:
    out = {k: pd.read_parquet(os.path.join(BUILD, f"{v}.parquet")) for k, v in FRAME.items()}
    sk = out["skater"]
    sk["toi_min"] = sk["toi"] / 60.0
    return out


def eligible(entity: str, df: pd.DataFrame, target: dict) -> pd.DataFrame:
    hist = df[df.get("upcoming", 0).fillna(0) == 0] if "upcoming" in df else df
    if entity == "skater":
        hist = hist[(hist.gp_prior >= 5) & (hist.toi > 0)]
    elif entity == "goalie":
        hist = hist[(hist.starter == 1) & (hist.g_gp_prior >= 3)]
    elif entity == "team":
        hist = hist[hist.team_gp_prior >= 3]
        if target["id"] == "t_win":
            hist = hist[hist.home == 1]
    elif entity == "goalie_candidate":
        hist = hist[hist.started.notna() & (hist.g_gp_prior >= 1)]
    return hist[hist[target["column"]].notna()]


def windows(df: pd.DataFrame):
    t = df.start_utc
    return df[t < T_TRAIN], df[(t >= T_TRAIN) & (t < T_TUNE)], df[(t >= T_TUNE) & (t < T_SEL)], df[t >= T_SEL]


def sel_metric(target: dict, y: np.ndarray, p: np.ndarray) -> float:
    fam = target["family"]
    if fam == "count":
        p = np.clip(p, 1e-6, None)
        with np.errstate(divide="ignore", invalid="ignore"):
            term = np.where(y > 0, y * np.log(y / p), 0.0) - (y - p)
        return float(2 * np.mean(term))  # mean Poisson deviance
    if fam == "binary":
        return dist.logloss(p, y)
    return float(np.sqrt(np.mean((y - p) ** 2)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ag-time", type=int, default=60)
    ap.add_argument("--no-ag", action="store_true")
    ap.add_argument("--targets", default="")
    args = ap.parse_args()

    reg_targets = json.load(open(os.path.join(ROOT, "contracts", "targets.json")))["targets"]
    targets = [t for t in reg_targets if t["status"] == "enabled" and (not args.targets or t["id"] in args.targets.split(","))]
    frames = load_frames()
    version = datetime.now(timezone.utc).strftime("v%Y%m%d-%H%M%S")
    data_hash = hashlib.sha1(b"".join(open(os.path.join(BUILD, f"{v}.parquet"), "rb").read()[:2_000_000] for v in FRAME.values())).hexdigest()[:12]
    import xgboost, autogluon.tabular as agt  # noqa: E401
    report = {"version": version, "trained_at": datetime.now(timezone.utc).isoformat(), "data_hash": data_hash,
              "libs": {"xgboost": xgboost.__version__, "autogluon": agt.__version__, "python": sys.version.split()[0]},
              "windows": {"train_end": str(T_TRAIN.date()), "tune_end": str(T_TUNE.date()), "select_end": str(T_SEL.date())},
              "targets": {}, "timing": {}}
    test_preds = {}
    upcoming_preds = {}
    for t in targets:
        ent, col = t["entity"], t["column"]
        feats = FEATURES[ent]
        df = frames[ent]
        hist = eligible(ent, df, t)
        tr, tu, se, te = windows(hist)
        up = df[df.get("upcoming", 0).fillna(0) == 1] if "upcoming" in df else df.iloc[0:0]
        if ent == "goalie":  # upcoming goalie rows come from the start-candidate frame (conditional on starting)
            up = pd.DataFrame()
        print(f"[{t['id']}] train {len(tr)} tune {len(tu)} select {len(se)} test {len(te)} upcoming {len(up)}", flush=True)
        t0 = time.time()
        models = {"baseline": Baseline(t).fit(tr, tu)}
        models["xgboost"] = XGBSpecialist(t, feats).fit(tr, tu)
        t_xgb = time.time() - t0
        if not args.no_ag:
            models["autogluon"] = AutoGluonModel(t, feats, args.ag_time).fit(tr, tu, os.path.join(ART, version, t["id"], "autogluon"))
        preds = {k: {"se": m.predict(se), "te": m.predict(te), "up": m.predict(up) if len(up) else np.array([])} for k, m in models.items()}
        if "autogluon" in preds:
            preds["blend"] = {w: 0.5 * preds["xgboost"][w] + 0.5 * preds["autogluon"][w] for w in ("se", "te", "up")}
        ys, yt = se[col].to_numpy(float), te[col].to_numpy(float)
        board = {}
        for k, p in preds.items():
            board[k] = {"select": sel_metric(t, ys, p["se"]), "test": sel_metric(t, yt, p["te"]),
                        "test_mae": float(np.mean(np.abs(yt - p["te"]))) if t["family"] != "binary" else None}
        champ = min(board, key=lambda k: board[k]["select"])
        # baseline must be beaten on SELECT to deploy an ML model
        if champ != "baseline" and board[champ]["select"] >= board["baseline"]["select"]:
            champ = "baseline"
        info = {"entity": ent, "family": t["family"], "champion": champ, "leaderboard": board,
                "n": {"train": len(tr), "tune": len(tu), "select": len(se), "test": len(te)}, "xgb_search": models["xgboost"].search,
                "xgb_rounds": models["xgboost"].best_iteration, "seconds": {"xgb_grid": round(t_xgb, 1)}}
        if "autogluon" in models:
            info["seconds"]["autogluon"] = round(models["autogluon"].fit_seconds, 1)
            info["ag_leaderboard"] = models["autogluon"].leaderboard(te)
            info["ag_importance"] = models["autogluon"].importance(se)
        # feature importance (XGB gain + mean |SHAP| on test)
        g = models["xgboost"].gain()
        info["xgb_gain"] = dict(sorted(g.items(), key=lambda x: -x[1])[:15])
        if len(te):
            sv = models["xgboost"].contributions(te.sample(min(4000, len(te)), random_state=3))
            ms = np.abs(sv[:, :-1]).mean(axis=0)
            order = np.argsort(-ms)[:15]
            info["shap"] = {feats[i]: float(ms[i]) for i in order}
        # distribution layer + thresholds
        if t["family"] == "count":
            fams = {k: dist.fit_family(ys, p["se"]) for k, p in preds.items()}
            info["dist"] = fams
            fam = fams[champ]
            thr = {}
            for k_ in t["thresholds"]:
                p_se = dist.sf_ge(preds[champ]["se"], k_, fam["family"], fam["alpha"])
                p_te = dist.sf_ge(preds[champ]["te"], k_, fam["family"], fam["alpha"])
                lb = dist.lower_bound_table(p_se, (ys >= k_).astype(float))
                yk = (yt >= k_).astype(float)
                p_lo = dist.apply_lower(p_te, lb)
                per_model = {}
                for m, p in preds.items():
                    pm = dist.sf_ge(p["te"], k_, fams[m]["family"], fams[m]["alpha"])
                    per_model[m] = {"brier": dist.brier(pm, yk), "logloss": dist.logloss(pm, yk)}
                thr[str(k_)] = {"test_rate": float(yk.mean()) if len(yk) else None, "models": per_model,
                                "reliability": dist.reliability(p_te, yk), "lower_table": lb, "coverage": dist.coverage(p_lo, yk)}
            info["thresholds"] = thr
        elif t["family"] == "binary":
            p_se, p_te = preds[champ]["se"], preds[champ]["te"]
            lb = dist.lower_bound_table(p_se, ys)
            info["binary"] = {"models": {m: {"brier": dist.brier(p["te"], yt), "logloss": dist.logloss(p["te"], yt)} for m, p in preds.items()},
                              "reliability": dist.reliability(p_te, yt), "lower_table": lb, "coverage": dist.coverage(dist.apply_lower(p_te, lb), yt)}
        else:
            resid = ys - preds[champ]["se"]
            info["continuous"] = {"resid_sd": float(np.std(resid)), "q10": float(np.quantile(resid, 0.1)), "q90": float(np.quantile(resid, 0.9)),
                                  "test_cover_80": float(np.mean((yt >= preds[champ]["te"] + np.quantile(resid, 0.1)) & (yt <= preds[champ]["te"] + np.quantile(resid, 0.9)))) if len(yt) else None}
        # persist
        for k, m in models.items():
            if k != "autogluon":
                m.save(os.path.join(ART, version, t["id"], k))
        report["targets"][t["id"]] = info
        report["timing"][t["id"]] = round(time.time() - t0, 1)
        keys = {"skater": ["game_id", "player_id"], "goalie": ["game_id", "player_id"], "team": ["game_id", "team"], "goalie_candidate": ["game_id", "team", "player_id"]}[ent]
        tp = te[keys].copy(); tp["mu"] = preds[champ]["te"]; tp["y"] = yt
        for k, p in preds.items():
            tp["mu_" + k] = p["te"]
        test_preds[t["id"]] = tp
        sp = se[keys].copy(); sp["mu"] = preds[champ]["se"]; sp["y"] = ys
        sp.to_parquet(os.path.join(BUILD, f"sel_{t['id']}.parquet"), index=False)
        if len(up):
            upp = up[keys + [c for c in ("name", "team", "opp", "pos", "is_d", "home") if c in up.columns and c not in keys]].copy()
            for k, p in preds.items():
                upp["mu_" + k] = p["up"]
            upp["mu"] = preds[champ]["up"]
            upcoming_preds[t["id"]] = upp
        print(f"   champion={champ} select={board[champ]['select']:.4f} test={board[champ]['test']:.4f} ({report['timing'][t['id']]}s)", flush=True)

    os.makedirs(os.path.join(ART, version), exist_ok=True)
    for k, v in test_preds.items():
        v.to_parquet(os.path.join(BUILD, f"test_{k}.parquet"), index=False)
    for k, v in upcoming_preds.items():
        v.to_parquet(os.path.join(BUILD, f"upcoming_{k}.parquet"), index=False)
    json.dump(report, open(os.path.join(ART, version, "report.json"), "w"), indent=1, default=float)
    # ---- registry (champion/challenger at version level)
    reg = json.load(open(REG)) if os.path.exists(REG) else {"versions": [], "champion": None, "history": []}
    reg["versions"].append({"version": version, "trained_at": report["trained_at"], "data_hash": data_hash, "status": "candidate",
                            "targets": {k: {"champion_model": v["champion"], "select": v["leaderboard"][v["champion"]]["select"],
                                            "test": v["leaderboard"][v["champion"]]["test"]} for k, v in report["targets"].items()}})
    os.makedirs(os.path.dirname(REG), exist_ok=True)
    json.dump(reg, open(REG, "w"), indent=1)
    print("version", version)


if __name__ == "__main__":
    main()

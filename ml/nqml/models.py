"""Model adapters: baseline, XGBoost specialist, AutoGluon TabularPredictor.

Every adapter exposes fit(train, tune) -> self, predict(df) -> mean (or
probability for binary targets), save(path), and load(path). Chronological
discipline is enforced by the caller (train.py): `tune` is always a strictly
later window than `train`, and model SELECTION happens on a third window.
"""
from __future__ import annotations

import itertools
import json
import os
import time

import numpy as np
import pandas as pd
import xgboost as xgb

# ------------------------------------------------------------------ features
WIN = ("l5", "l20", "l82")
SK_STATS = ("goals", "assists", "points", "sog", "hits", "blocks", "ppp")
TEAM_CTX = [f"t_{c}_pg_{w}" for c in ("gf", "ga", "sf", "sa", "pen", "pen_drawn", "win") for w in ("l20", "l82")]
OPP_CTX = ["o" + c for c in TEAM_CTX]

SKATER_FEATURES = (["home", "is_d", "pos_c", "pos_w", "gp_prior", "fo_prior", "toi_rank", "ppp_share_rank", "rest_days", "b2b",
                    "team_gp_prior", "opp_rest", "opp_b2b"]
                   + [f"toi_pg_{w}" for w in WIN]
                   + [f"{s}_{k}_{w}" for s in SK_STATS for k in ("pg", "p60") for w in WIN]
                   + TEAM_CTX + OPP_CTX)
GOALIE_FEATURES = (["home", "g_gp_prior", "g_svpct_l10", "g_svpct_l30", "g_sa_pg_l10", "g_sa_pg_l30", "starter_l10", "rest_days", "b2b",
                    "opp_rest", "opp_b2b"] + TEAM_CTX + OPP_CTX)
TEAM_FEATURES = ["home", "rest_days", "b2b", "opp_rest", "opp_b2b", "team_gp_prior", "opp_gp_prior"] + TEAM_CTX + OPP_CTX
GSTART_FEATURES = ["home", "b2b", "rest_days", "share_l10", "days_since_start", "started_prev", "g_gp_prior", "g_svpct_l30", "team_gp_prior",
                   "share_l3", "share_l5", "share_season", "streak", "n_cands", "starts_14d", "prev_b2b", "g_svpct_l5", "rank_l10", "rank_season"]

FEATURES = {"skater": SKATER_FEATURES, "goalie": GOALIE_FEATURES, "team": TEAM_FEATURES, "goalie_candidate": GSTART_FEATURES}


# ------------------------------------------------------------------ baseline
class Baseline:
    """Simple historical benchmark: blended recent / long per-game rate."""
    name = "baseline"

    def __init__(self, target: dict):
        self.t = target
        self.fallback = 0.0

    def fit(self, train: pd.DataFrame, tune: pd.DataFrame | None = None):
        self.fallback = float(train[self.t["column"]].mean())
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        c, ent = self.t["column"], self.t["entity"]
        if ent == "skater":
            if c == "toi_min":
                a, b = df.get("toi_pg_l20"), df.get("toi_pg_l82")
            else:
                a, b = df.get(f"{c}_pg_l20"), df.get(f"{c}_pg_l82")
            out = 0.5 * a.fillna(b) + 0.5 * b.fillna(a)
        elif ent == "goalie":
            sa = df["ot_sf_pg_l20"].fillna(df["ot_sf_pg_l82"])
            sv = df["g_svpct_l30"].fillna(0.9).clip(0.85, 0.94)
            out = {"shots_against": sa, "saves": sa * sv, "goals_against": sa * (1 - sv)}[c]
        elif ent == "team":
            if c == "win":
                d = (df["t_gf_pg_l82"] - df["t_ga_pg_l82"]) - (df["ot_gf_pg_l82"] - df["ot_ga_pg_l82"])
                out = 1 / (1 + np.exp(-(0.45 * d.fillna(0) + 0.12 * (2 * df["home"] - 1))))
            else:
                k = {"gf": ("t_gf_pg_l20", "ot_ga_pg_l20"), "sf": ("t_sf_pg_l20", "ot_sa_pg_l20")}[c]
                out = 0.5 * df[k[0]] + 0.5 * df[k[1]]
        else:  # goalie start candidate
            out = df["share_l10"].fillna(0.5)
        return np.asarray(pd.Series(out).fillna(self.fallback), dtype=float).clip(1e-4, None)

    def save(self, path):
        os.makedirs(path, exist_ok=True)
        json.dump({"fallback": self.fallback}, open(os.path.join(path, "baseline.json"), "w"))

    @classmethod
    def load(cls, path, target):
        m = cls(target); m.fallback = json.load(open(os.path.join(path, "baseline.json")))["fallback"]; return m


# ------------------------------------------------------------------ XGBoost
class XGBSpecialist:
    name = "xgboost"
    GRID = {"max_depth": [3, 5], "min_child_weight": [5, 25], "reg_lambda": [1.0, 8.0]}
    FIXED = {"learning_rate": 0.04, "subsample": 0.8, "colsample_bytree": 0.7, "gamma": 0.0, "reg_alpha": 0.0, "nthread": 4, "tree_method": "hist"}

    def __init__(self, target: dict, features: list[str]):
        self.t, self.f = target, features
        self.booster = None
        self.params = None
        self.search: list[dict] = []
        self.best_iteration = None

    def _obj(self):
        return {"count": ("count:poisson", "poisson-nloglik"), "binary": ("binary:logistic", "logloss"), "continuous": ("reg:squarederror", "rmse")}[self.t["family"]]

    def fit(self, train: pd.DataFrame, tune: pd.DataFrame):
        obj, metric = self._obj()
        dtr = xgb.DMatrix(train[self.f], label=train[self.t["column"]], missing=np.nan)
        dtu = xgb.DMatrix(tune[self.f], label=tune[self.t["column"]], missing=np.nan)
        best = None
        for combo in itertools.product(*self.GRID.values()):
            p = dict(zip(self.GRID.keys(), combo)) | self.FIXED | {"objective": obj, "eval_metric": metric, "seed": 7}
            if obj == "count:poisson":
                p["max_delta_step"] = 0.7
            ev = {}
            b = xgb.train(p, dtr, num_boost_round=3000, evals=[(dtu, "tune")], early_stopping_rounds=80, evals_result=ev, verbose_eval=False)
            score = float(ev["tune"][metric][b.best_iteration])
            self.search.append({"params": {k: p[k] for k in self.GRID}, "rounds": int(b.best_iteration + 1), "tune_" + metric: score})
            if best is None or score < best[0]:
                best = (score, b, p)
        self.booster, self.params = best[1], best[2]
        self.best_iteration = int(self.booster.best_iteration)
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        d = xgb.DMatrix(df[self.f], missing=np.nan)
        return self.booster.predict(d, iteration_range=(0, self.best_iteration + 1)).astype(float)

    def contributions(self, df: pd.DataFrame) -> np.ndarray:
        """TreeSHAP contributions (last column = bias), in margin (log-mean / logit) space."""
        d = xgb.DMatrix(df[self.f], missing=np.nan)
        return self.booster.predict(d, pred_contribs=True, iteration_range=(0, self.best_iteration + 1))

    def gain(self) -> dict:
        return self.booster.get_score(importance_type="gain")

    def save(self, path):
        os.makedirs(path, exist_ok=True)
        self.booster.save_model(os.path.join(path, "model.json"))
        json.dump({"features": self.f, "params": {k: v for k, v in self.params.items()}, "best_iteration": self.best_iteration, "search": self.search},
                  open(os.path.join(path, "meta.json"), "w"), indent=1)

    @classmethod
    def load(cls, path, target):
        meta = json.load(open(os.path.join(path, "meta.json")))
        m = cls(target, meta["features"])
        m.booster = xgb.Booster(); m.booster.load_model(os.path.join(path, "model.json"))
        m.params, m.best_iteration, m.search = meta["params"], meta["best_iteration"], meta["search"]
        return m


# ------------------------------------------------------------------ AutoGluon
class AutoGluonModel:
    name = "autogluon"
    HYPER = {"GBM": {}, "XGB": {}, "RF": {"n_estimators": 200}, "XT": {"n_estimators": 200}, "LR": {}}

    def __init__(self, target: dict, features: list[str], time_limit: int = 90):
        self.t, self.f, self.time_limit = target, features, time_limit
        self.pred = None
        self.fit_seconds = None

    def fit(self, train: pd.DataFrame, tune: pd.DataFrame, path: str):
        from autogluon.tabular import TabularPredictor
        fam = self.t["family"]
        ptype, metric = {"count": ("regression", "root_mean_squared_error"), "continuous": ("regression", "root_mean_squared_error"),
                         "binary": ("binary", "log_loss")}[fam]
        cols = self.f + [self.t["column"]]
        t0 = time.time()
        # Explicit chronological tuning_data: AutoGluon validates / weights the ensemble on the LATER window.
        self.pred = TabularPredictor(label=self.t["column"], problem_type=ptype, eval_metric=metric, path=path, verbosity=0).fit(
            train_data=train[cols], tuning_data=tune[cols], time_limit=self.time_limit, hyperparameters=self.HYPER,
            num_bag_folds=0, num_stack_levels=0, use_bag_holdout=False, fit_weighted_ensemble=True)
        self.fit_seconds = time.time() - t0
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if self.t["family"] == "binary":
            pr = self.pred.predict_proba(df[self.f], as_multiclass=False)
            return np.asarray(pr, dtype=float)
        return np.clip(np.asarray(self.pred.predict(df[self.f]), dtype=float), 1e-3, None)

    def leaderboard(self, df: pd.DataFrame) -> list[dict]:
        lb = self.pred.leaderboard(df[self.f + [self.t["column"]]], silent=True)
        keep = [c for c in ("model", "score_test", "score_val", "fit_time", "pred_time_test") if c in lb.columns]
        return lb[keep].head(8).to_dict(orient="records")

    def importance(self, df: pd.DataFrame) -> dict:
        try:
            fi = self.pred.feature_importance(df[self.f + [self.t["column"]]].sample(min(3000, len(df)), random_state=1), num_shuffle_sets=2, silent=True)
            return fi["importance"].head(15).to_dict()
        except Exception as e:  # pragma: no cover
            return {"error": str(e)}

    @classmethod
    def load(cls, path, target, features):
        from autogluon.tabular import TabularPredictor
        m = cls(target, features); m.pred = TabularPredictor.load(path, verbosity=0); return m

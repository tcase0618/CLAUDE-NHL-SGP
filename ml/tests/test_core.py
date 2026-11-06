"""Python subsystem tests: .venv/bin/python -m pytest ml/tests -q"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from nqml import cv, dist  # noqa: E402
from nqml.build import _roll  # noqa: E402
from nqml.models import XGBSpecialist  # noqa: E402
from odds import match_events, norm, normalize_event  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def test_threshold_probabilities_monotone_and_valid():
    mu = np.array([0.3, 1.5, 3.2])
    for fam, a in (("poisson", 0), ("nb", 0.3)):
        p = [dist.sf_ge(mu, k, fam, a) for k in range(0, 8)]
        assert np.allclose(p[0], 1)
        for k in range(1, 8):
            assert np.all(p[k] <= p[k - 1] + 1e-12), "P(X>=k) must be non-increasing"
        tot = sum(dist.pmf(mu, k, fam, a) for k in range(0, 80))
        assert np.allclose(tot, 1, atol=1e-6)


def test_nb_converges_to_poisson():
    mu = np.array([2.0])
    assert np.allclose(dist.sf_ge(mu, 3, "nb", 1e-5), dist.sf_ge(mu, 3, "poisson"), atol=1e-4)


def test_lower_bound_never_exceeds_point_estimate():
    rng = np.random.default_rng(0)
    p = rng.uniform(0.05, 0.9, 5000); y = (rng.uniform(size=5000) < p * 0.95).astype(float)
    tab = dist.lower_bound_table(p, y)
    lo = dist.apply_lower(p, tab)
    assert np.all(lo <= p + 1e-12) and np.all(lo >= 0)


def test_family_selection_prefers_nb_for_overdispersed_counts():
    rng = np.random.default_rng(1)
    mu = rng.uniform(1, 4, 20000)
    y = rng.negative_binomial(1 / 0.4, (1 / 0.4) / (1 / 0.4 + mu))
    assert dist.fit_family(y, mu)["family"] == "nb"
    y2 = rng.poisson(mu)
    assert dist.fit_family(y2, mu)["alpha"] <= 0.02


def test_point_in_time_rolling_uses_only_prior_rows():
    df = pd.DataFrame({"pid": [1, 1, 1, 2, 1], "x": [5, 7, 11, 100, 13]})
    r = _roll(df, "pid", ["x"], {"l2": 2})
    # first appearance has no history; later rows sum strictly earlier rows only
    assert np.isnan(r.loc[0, "x_l2"])
    assert r.loc[1, "x_l2"] == 5 and r.loc[2, "x_l2"] == 12 and r.loc[4, "x_l2"] == 18
    assert np.isnan(r.loc[3, "x_l2"])  # other entity isolated


def test_cv_formulas_match_spec():
    assert cv.to_decimal(150) == 2.5 and abs(cv.to_decimal(-200) - 1.5) < 1e-12
    assert abs(cv.cv_no_push(0.45, 2.5) - 12.5) < 1e-9
    assert abs(cv.cv_push(0.5, 0.3, 2.0) - 20) < 1e-9
    with pytest.raises(ValueError):
        cv.cv_push(0.7, 0.4, 2.0)
    assert cv.cv_sgp(0.15, None) is None, "no combined quote -> no SGP CV%"


def test_xgboost_train_save_reload_roundtrip(tmp_path):
    rng = np.random.default_rng(2)
    X = pd.DataFrame({"a": rng.normal(size=3000), "b": rng.normal(size=3000)})
    X["y"] = rng.poisson(np.exp(0.3 + 0.4 * X.a))
    t = {"id": "t", "column": "y", "family": "count", "entity": "skater"}
    m = XGBSpecialist(t, ["a", "b"])
    m.GRID = {"max_depth": [2], "min_child_weight": [5], "reg_lambda": [1.0]}
    m.fit(X.iloc[:2000], X.iloc[2000:])
    m.save(str(tmp_path / "x"))
    m2 = XGBSpecialist.load(str(tmp_path / "x"), t)
    assert np.allclose(m.predict(X.iloc[:50]), m2.predict(X.iloc[:50]))
    sv = m.contributions(X.iloc[:20])
    assert np.allclose(sv.sum(axis=1), np.log(m.predict(X.iloc[:20])), atol=1e-4), "SHAP contributions sum to margin"


def test_autogluon_executes_with_chronological_tuning(tmp_path):
    from nqml.models import AutoGluonModel
    rng = np.random.default_rng(3)
    X = pd.DataFrame({"a": rng.normal(size=1500), "b": rng.normal(size=1500)})
    X["y"] = rng.poisson(np.exp(0.2 + 0.5 * X.a)).astype(float)
    t = {"id": "t", "column": "y", "family": "count", "entity": "skater"}
    m = AutoGluonModel(t, ["a", "b"], time_limit=20)
    m.HYPER = {"GBM": {}, "XGB": {}}
    m.fit(X.iloc[:1000], X.iloc[1000:], str(tmp_path / "ag"))
    p = m.predict(X.iloc[:10])
    assert p.shape == (10,) and np.all(p > 0)


def test_odds_normalization_exact_matching():
    # Test fixture shaped like the provider's documented event-odds payload (not real prices).
    ev = {"id": "e1", "bookmakers": [{"key": "bookA", "last_update": "2026-11-06T20:00:00Z", "markets": [
        {"key": "player_shots_on_goal", "last_update": "2026-11-06T20:00:00Z", "outcomes": [
            {"name": "Over", "description": "Jane Doe", "price": 120, "point": 2.5},
            {"name": "Over", "description": "Unknown Skater", "price": 110, "point": 2.5},
            {"name": "Over", "description": "Jane Doe", "price": 50, "point": 3.5}]},
        {"key": "player_goal_scorer_anytime", "outcomes": [{"name": "Yes", "description": "Jane Doe", "price": 240}]}]}]}
    game = {"game_id": 1, "home": "BOS", "away": "TOR", "start_utc": "2026-11-07T00:00:00Z"}
    q, rej = normalize_event(ev, game, {norm("Jane Doe"): 99})
    assert {(x["market"], x["line"], x["side"], x["american"]) for x in q} == {("player_sog", 2.5, "over", 120), ("player_goals", 0.5, "over", 240)}
    reasons = sorted(r["reason"] for r in rej)
    assert any("not exactly matched" in r for r in reasons) and any("invalid American" in r for r in reasons)
    evs = [{"id": "e1", "home_team": "Boston Bruins", "away_team": "Toronto Maple Leafs", "commence_time": "2026-11-07T00:10:00Z"}]
    assert match_events(evs, [game])["e1"]["game_id"] == 1
    assert norm("Tim Stützle") == "tim stutzle"

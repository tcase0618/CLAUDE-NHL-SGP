"""Probability-distribution layer: model mean -> full predictive distribution.

Count targets are mapped from a predicted mean mu to a Poisson or a
negative-binomial (NB2, Var = mu + alpha mu^2) distribution. The family and
alpha are chosen on the VALIDATION window by log-likelihood, never on test.
Threshold probabilities P(X >= k) come from one distribution, so they are
monotone by construction (P(5+) <= P(4+)).

Conservative bounds (Case Value input): for each target/threshold the
validation window is binned by predicted probability; within each bin we
measure the observed hit rate and its binomial standard error. The lower
bound is

    p_lower = clip(p + min(0, obs_b - pred_b) - z * se_b, 0, 1)

i.e. negative calibration bias is subtracted, positive bias is never added,
and the bin's sampling uncertainty is subtracted. Its coverage (share of
held-out bins whose realised hit rate >= mean p_lower) is reported on TEST.
"""
from __future__ import annotations

import numpy as np
from scipy import stats

Z_LOWER = 1.645  # one-sided 95%


def nb_params(mu: np.ndarray, alpha: float):
    """scipy nbinom(n, p) parameterisation for NB2 with dispersion alpha."""
    n = 1.0 / alpha
    p = n / (n + mu)
    return n, p


def sf_ge(mu: np.ndarray, k: int, family: str, alpha: float = 0.0) -> np.ndarray:
    """P(X >= k)."""
    mu = np.clip(np.asarray(mu, dtype=float), 1e-6, None)
    if family == "poisson" or alpha <= 1e-6:
        return stats.poisson.sf(k - 1, mu)
    n, p = nb_params(mu, alpha)
    return stats.nbinom.sf(k - 1, n, p)


def pmf(mu: np.ndarray, k: int, family: str, alpha: float = 0.0) -> np.ndarray:
    mu = np.clip(np.asarray(mu, dtype=float), 1e-6, None)
    if family == "poisson" or alpha <= 1e-6:
        return stats.poisson.pmf(k, mu)
    n, p = nb_params(mu, alpha)
    return stats.nbinom.pmf(k, n, p)


def loglik(y: np.ndarray, mu: np.ndarray, family: str, alpha: float = 0.0) -> float:
    mu = np.clip(mu, 1e-6, None)
    if family == "poisson" or alpha <= 1e-6:
        return float(stats.poisson.logpmf(y, mu).sum())
    n, p = nb_params(mu, alpha)
    return float(stats.nbinom.logpmf(y, n, p).sum())


def fit_family(y: np.ndarray, mu: np.ndarray) -> dict:
    """Choose Poisson vs NB2 (grid over alpha) by validation log-likelihood."""
    best = {"family": "poisson", "alpha": 0.0, "ll": loglik(y, mu, "poisson")}
    for a in [0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0, 1.5]:
        ll = loglik(y, mu, "nb", a)
        if ll > best["ll"]:
            best = {"family": "nb", "alpha": a, "ll": ll}
    best["n"] = int(len(y))
    best["ll_per_obs"] = best["ll"] / max(1, len(y))
    return best


def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    """Quantile-binned reliability table."""
    p = np.asarray(p, float); y = np.asarray(y, float)
    if len(p) == 0:
        return []
    edges = np.unique(np.quantile(p, np.linspace(0, 1, bins + 1)))
    if len(edges) < 2:
        edges = np.array([p.min(), p.max() + 1e-9])
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    out = []
    for b in range(len(edges) - 1):
        m = idx == b
        n = int(m.sum())
        if n == 0:
            continue
        obs = float(y[m].mean())
        out.append({"lo": float(edges[b]), "hi": float(edges[b + 1]), "n": n, "pred": float(p[m].mean()), "obs": obs,
                    "se": float(np.sqrt(max(obs * (1 - obs), 1e-4) / n))})
    return out


def lower_bound_table(p_val: np.ndarray, y_val: np.ndarray, bins: int = 10) -> list[dict]:
    rel = reliability(p_val, y_val, bins)
    for r in rel:
        r["adj"] = min(0.0, r["obs"] - r["pred"]) - Z_LOWER * r["se"]
    return rel


def apply_lower(p: np.ndarray, table: list[dict]) -> np.ndarray:
    p = np.asarray(p, float)
    if not table:
        return np.clip(p - 0.1, 0, 1)
    his = np.array([t["hi"] for t in table]); adj = np.array([t["adj"] for t in table])
    idx = np.clip(np.searchsorted(his, p, side="left"), 0, len(table) - 1)
    return np.clip(p + adj[idx], 0.0, 1.0)


def brier(p, y) -> float:
    p = np.asarray(p, float); y = np.asarray(y, float)
    return float(np.mean((p - y) ** 2)) if len(p) else float("nan")


def logloss(p, y) -> float:
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6); y = np.asarray(y, float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))) if len(p) else float("nan")


def coverage(p_lower: np.ndarray, y: np.ndarray, bins: int = 10) -> dict:
    """Share of held-out probability bins whose realised rate >= mean lower bound."""
    rel = reliability(p_lower, y, bins)
    ok = sum(1 for r in rel if r["obs"] + 1e-12 >= r["pred"])
    return {"bins": len(rel), "covered": ok, "rate": ok / max(1, len(rel)),
            "mean_lower": float(np.mean(p_lower)) if len(p_lower) else None, "hit_rate": float(np.mean(y)) if len(y) else None}

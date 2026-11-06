"""Polymarket US public market-data feed -> normalized team-moneyline quotes.

Endpoint: https://gateway.polymarket.us/v1 (public, no API key for market data;
the trading API at api.polymarket.us requires authenticated keys and is NOT used —
this terminal never places orders).

What Polymarket US lists for the NHL (verified 2026-11-06): full-game winner
markets ("hockey_team_full_game_winner": overtime and shootout INCLUDED, settled
from NHL data) and season futures. No player props, no totals — so it prices the
`t_win` target only, and cannot price player-prop SGPs.

Pricing (docs.polymarket.us/fees):
  buying side X at price p costs  p + Θ·p·(1−p)  per contract, pays $1 if X wins
  → effective decimal odds  D = 1 / (p · (1 + Θ·(1−p)))
  Θ = taker coefficient by 30-day volume tier (Tier 1 < $10k: 0.095 — effective
  2026-11-06 13:00 ET). Fees are rounded to $0.01 per fill (banker's rounding);
  the per-contract formula is exact for large orders and slightly optimistic for
  tiny ones. Purchase price per side: the market's "long" team = best ASK; the
  other team = 1 − best BID of the long side (buying the short).

Usage:  .venv/bin/python ml/polymarket.py [--theta 0.095]
Writes: data/artifacts/odds_snapshot.js (merged with other feeds),
        data/history/odds_snapshots.jsonl (append-only)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402

GW = "https://gateway.polymarket.us/v1"
UA = "case-capital-nhl-quant/3.8 (research, read-only)"
MARKET_TYPE = "hockey_team_full_game_winner"
# Polymarket US abbreviations -> NHL abbreviations (only the ones that differ are mapped)
PM_TO_NHL = {"sj": "SJS", "was": "WSH", "nas": "NSH", "mon": "MTL", "nj": "NJD", "tb": "TBL", "la": "LAK", "veg": "VGK", "cls": "CBJ"}
TIERS = {1: 0.095, 2: 0.085, 3: 0.075, 4: 0.0695}


def get(path: str) -> dict:
    req = urllib.request.Request(GW + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def nhl_abbr(pm: str) -> str:
    return PM_TO_NHL.get(pm.lower(), pm.upper())


def eff_decimal(p: float, theta: float) -> float:
    """Fee-inclusive decimal odds for buying one contract at price p."""
    if not 0 < p < 1:
        raise ValueError("price must be in (0,1)")
    return 1.0 / (p * (1.0 + theta * (1.0 - p)))


def to_american(dec: float) -> int:
    return round((dec - 1) * 100) if dec >= 2 else -round(100 / (dec - 1))


def open_nhl_game_markets() -> list[dict]:
    out, off = [], 0
    while True:
        evs = get(f"/events?closed=false&limit=100&offset={off}").get("events", [])
        for e in evs:
            for m in e.get("markets", []) or []:
                if m.get("sportsMarketType") == MARKET_TYPE and m.get("status") == "MARKET_STATUS_OPEN" and (m.get("slug") or "").startswith("aec-nhl-"):  # same type is reused for AHL
                    out.append({"event_slug": e.get("slug"), **m})
        if len(evs) < 100:
            break
        off += 100
    return out


def depth_at(levels: list[dict], px: float) -> float:
    return sum(float(l["qty"]) for l in levels if abs(float(l["px"]["value"]) - px) < 1e-9)


def normalize(m: dict, bbo: dict, book: dict, slate: list[dict], theta: float, now: str) -> tuple[list[dict], dict | None]:
    sides = m.get("marketSides", [])
    long_side = next((s for s in sides if s.get("long")), None)
    short_side = next((s for s in sides if not s.get("long")), None)
    md = (bbo or {}).get("marketData", {})
    bid = float((md.get("bestBid") or m.get("bestBidQuote") or {}).get("value", "nan"))
    ask = float((md.get("bestAsk") or m.get("bestAskQuote") or {}).get("value", "nan"))
    if not (long_side and short_side and 0 < bid < ask < 1):
        return [], {"slug": m.get("slug"), "reason": "no two-sided market"}
    teams = {}
    for s in (long_side, short_side):
        t = s.get("team") or {}
        teams["long" if s.get("long") else "short"] = (nhl_abbr(t.get("abbreviation", "")), t.get("ordering"))
    # home/away from team.ordering when provided; otherwise slug order is away-home
    order = {v[1]: v[0] for v in teams.values() if v[1] in ("home", "away")}
    if len(order) < 2:
        parts = (m.get("event_slug") or "").split("-")
        order = {"away": nhl_abbr(parts[1]), "home": nhl_abbr(parts[2])} if len(parts) > 3 else {}
    gst = m.get("gameStartTime")
    game = None
    for g in slate:
        if g["home"] == order.get("home") and g["away"] == order.get("away"):
            dt = abs((datetime.fromisoformat(g["start_utc"].replace("Z", "+00:00")) - datetime.fromisoformat(gst.replace("Z", "+00:00"))).total_seconds())
            if dt <= 6 * 3600:
                game = g
    if not game:
        return [], {"slug": m.get("slug"), "reason": f"no exact slate match for {order} at {gst}"}
    bk = (book or {}).get("marketData", {})
    quotes = []
    for key, price, depth in (("long", ask, depth_at(bk.get("offers", []), ask)), ("short", round(1 - bid, 4), depth_at(bk.get("bids", []), bid))):
        team = teams[key][0]
        side = "home" if team == game["home"] else "away" if team == game["away"] else None
        if side is None:
            continue
        d = eff_decimal(price, theta)
        quotes.append({
            "book": "polymarket_us", "game_id": game["game_id"], "market": "team_ml", "team": team, "side": side,
            "american": to_american(d), "decimal": round(d, 4), "price": price, "decimal_gross": round(1 / price, 4), "theta": theta,
            "spread": round(ask - bid, 4), "depth_contracts": round(depth, 2), "open_interest": float(md.get("openInterest") or 0),
            "volume_contracts": float(md.get("sharesTraded") or 0), "last_trade": float((md.get("lastTradePx") or {}).get("value") or 0) or None,
            "ts": now, "status": "open", "source": "feed", "provider": "polymarket_us", "market_slug": m.get("slug"),
            "settlement": "Full game incl. overtime and shootout; NHL-sourced",
        })
    return quotes, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=1, choices=TIERS.keys(), help="Polymarket US taker fee tier (1 = < $10k 30-day volume)")
    a = ap.parse_args()
    theta = TIERS[a.tier]
    slate = json.load(open(os.path.join(ROOT, "data", "build", "upcoming.json")))
    now = datetime.now(timezone.utc).isoformat()
    mkts = open_nhl_game_markets()
    quotes, rejected = [], []
    for m in mkts:
        slug = m["slug"]
        try:
            bbo, book = get(f"/markets/{slug}/bbo"), get(f"/markets/{slug}/book")
        except Exception as e:  # keep going; record the failure
            rejected.append({"slug": slug, "reason": f"fetch failed: {e}"})
            continue
        q, rej = normalize(m, bbo, book, slate, theta, now)
        quotes += q
        if rej:
            rejected.append(rej)
    path = os.path.join(ROOT, "data", "artifacts", "odds_snapshot.js")
    prev = {}
    if os.path.exists(path):
        try:
            prev = json.loads(open(path).read().split("=", 1)[1].rstrip().rstrip(";"))
        except Exception:
            prev = {}
    others = [q for q in prev.get("quotes", []) if q.get("provider") != "polymarket_us"]
    snap = {"fetched_at": now, "providers": sorted({"polymarket_us", *[q.get("provider", "?") for q in others]}),
            "quotes": others + quotes, "rejected": rejected,
            "polymarket": {"markets_open": len(mkts), "quotes": len(quotes), "theta": theta, "tier": a.tier, "fee_formula": "Θ·C·p·(1−p)"}}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("window.NQ_ODDS = " + json.dumps(snap) + ";\n")
    os.makedirs(os.path.join(ROOT, "data", "history"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "history", "odds_snapshots.jsonl"), "a") as f:
        f.write(json.dumps({"fetched_at": now, "provider": "polymarket_us", "quotes": quotes, "rejected": rejected}) + "\n")
    print(f"Polymarket US: {len(mkts)} open NHL game markets -> {len(quotes)} quotes, {len(rejected)} rejected (Θ={theta})")
    for r in rejected[:10]:
        print("  rejected:", r)


if __name__ == "__main__":
    main()

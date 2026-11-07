"""Cumulative parlay ledger across every published card.

  .venv/bin/python ml/ledger.py      → reports/ledger.md + reports/ledger.json

Official card per game: the T-60 slot scan (reports/slots/**) when one exists,
otherwise the daily card (reports/sgp-*.json). Each parlay is settled with the same
rules as ml/settle.py. Reported: cumulative W/L by size, legs, expected vs actual,
Brier joint vs independence, calibration by predicted-probability band, and the
fair-price $2/parlay P&L ceiling (no sportsbook prices exist yet).
"""
from __future__ import annotations

import glob
import json
import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import ROOT  # noqa: E402
from settle import game_stats, grade  # noqa: E402


def official_cards() -> dict[int, tuple[str, dict]]:
    cards: dict[int, tuple[str, dict]] = {}
    daily = sorted(glob.glob(os.path.join(ROOT, "reports", "sgp-*.json")))
    slots = sorted(glob.glob(os.path.join(ROOT, "reports", "slots", "*", "slot-*.json")))
    for path in daily + slots:  # slot scans overwrite daily-card entries for the same game
        rep = json.load(open(path))
        for g in rep["games"]:
            cards[g["game_id"]] = (os.path.relpath(path, ROOT), g)
    return cards


def main():
    cards = official_cards()
    rows, cache = [], {}
    for gid, (src, g) in sorted(cards.items()):
        gs = cache.setdefault(gid, game_stats(gid))
        if gs["state"] not in ("OFF", "FINAL"):
            continue
        for size, blk in g["sizes"].items():
            for i, pk in enumerate(blk["picks"]):
                gr = [grade(l, gs) for l in pk["legs"]]
                st = [x[0] for x in gr]
                status = "LOST" if "LOST" in st else "VOID" if "VOID" in st else "WON" if all(s == "WON" for s in st) else "PENDING"
                rows.append({"game_id": gid, "game": f"{g['away']}@{g['home']}", "date": g["start_utc"][:10], "source": src, "size": int(size),
                             "pick": chr(65 + i), "family": pk["family"], "pJoint": pk["pJoint"], "pIndep": pk["pIndep"], "pLower": pk["pLower"],
                             "breakEven": pk["breakEven"], "status": status,
                             "legs": [{"text": l["text"], "p": l["p"], "result": s, "value": v} for l, (s, v) in zip(pk["legs"], gr)]})
    settled = [r for r in rows if r["status"] in ("WON", "LOST")]

    def summ(rs):
        if not rs:
            return None
        n = len(rs); w = sum(r["status"] == "WON" for r in rs)
        return {"n": n, "won": w, "lost": n - w, "win_pct": w / n, "expected": sum(r["pJoint"] for r in rs),
                "brier_joint": sum((r["pJoint"] - (r["status"] == "WON")) ** 2 for r in rs) / n,
                "brier_indep": sum((r["pIndep"] - (r["status"] == "WON")) ** 2 for r in rs) / n,
                "fair_pnl_2": sum((2 / r["pJoint"] - 2) if r["status"] == "WON" else -2 for r in rs)}

    legs = {}
    for r in rows:
        for l in r["legs"]:
            legs[(r["game_id"], l["text"])] = l
    lsettled = [l for l in legs.values() if l["result"] in ("WON", "LOST")]
    bands = []
    for lo, hi in ((0, 0.1), (0.1, 0.25), (0.25, 0.4), (0.4, 0.6), (0.6, 1.01)):
        b = [r for r in settled if lo <= r["pJoint"] < hi]
        if b:
            bands.append({"band": f"{int(lo * 100)}–{int(min(hi, 1) * 100)}%", "n": len(b), "pred": sum(r["pJoint"] for r in b) / len(b),
                          "actual": sum(r["status"] == "WON" for r in b) / len(b)})
    out = {"updated_at": datetime.now(timezone.utc).isoformat(), "nights": sorted({r["date"] for r in rows}), "all": summ(settled),
           "by_size": {s: summ([r for r in settled if r["size"] == s]) for s in (3, 5, 8)}, "voids": sum(r["status"] == "VOID" for r in rows),
           "legs": {"n": len(lsettled), "won": sum(l["result"] == "WON" for l in lsettled), "expected": sum(l["p"] for l in lsettled)},
           "bands": bands, "parlays": rows}
    json.dump(out, open(os.path.join(ROOT, "reports", "ledger.json"), "w"), indent=1)
    a = out["all"]
    md = ["# Parlay ledger (cumulative)", f"Updated {out['updated_at'][:16]}Z · nights: {', '.join(out['nights']) or '—'}", ""]
    if a:
        md += [f"**Parlays:** {a['won']}–{a['lost']} ({100 * a['win_pct']:.1f}%) · model expected {a['expected']:.1f} wins · voids {out['voids']}",
               f"**Legs:** {out['legs']['won']}/{out['legs']['n']} ({100 * out['legs']['won'] / max(1, out['legs']['n']):.1f}%) · expected {out['legs']['expected']:.1f}",
               f"**Brier:** joint {a['brier_joint']:.3f} vs independence {a['brier_indep']:.3f} · **fair-price $2/parlay P&L ceiling:** {a['fair_pnl_2']:+.2f}", "",
               "| Size | W–L | Win % | Expected wins | Brier joint | Brier indep |", "|---|---|---|---|---|---|"]
        for s, b in out["by_size"].items():
            if b:
                md.append(f"| {s} | {b['won']}–{b['lost']} | {100 * b['win_pct']:.0f}% | {b['expected']:.2f} | {b['brier_joint']:.3f} | {b['brier_indep']:.3f} |")
        md += ["", "| Predicted band | n | Predicted | Actual |", "|---|---|---|---|"]
        md += [f"| {b['band']} | {b['n']} | {100 * b['pred']:.1f}% | {100 * b['actual']:.1f}% |" for b in bands]
        md.append("\n_Recalibrate tails only after ≥ 10 nights. P&L is a fair-price ceiling until real sportsbook SGP prices are recorded._")
    open(os.path.join(ROOT, "reports", "ledger.md"), "w").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()

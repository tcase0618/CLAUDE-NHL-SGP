"""Settle published SGP research picks against official NHL data (audit).

Usage: .venv/bin/python ml/settle.py reports/sgp-2026-11-07.json
Writes reports/audit-<date>.md and .json (re-run any time; idempotent).

Leg grading (stats from api-web.nhle.com boxscore + landing scoring summary):
  WON      stat already above the line (counts never decrease) — locked even live
  LOST     game final (OFF/FINAL) and stat at or below the line
  VOID     game final and player did not dress (goalie leg: did not start)
  PENDING  game not started or still in progress and not yet over the line
Parlay: LOST if any leg lost; WON if every leg won; VOID-affected parlays are
reported separately (books reprice them; repricing is not modelled);
otherwise PENDING. Shootout goals are excluded (book settlement rule).
Calibration is reported only over SETTLED parlays and is not meaningful at
small n — it is printed with its sample size.
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import BASE, ROOT, _get  # noqa: E402

FINAL = ("OFF", "FINAL")


def game_stats(gid: int) -> dict:
    box = _get(f"{BASE}/gamecenter/{gid}/boxscore") or {}
    land = _get(f"{BASE}/gamecenter/{gid}/landing") or {}
    st = {"state": box.get("gameState", "FUT"), "score": f"{box.get('awayTeam', {}).get('abbrev')} {box.get('awayTeam', {}).get('score', '-')} @ "
          f"{box.get('homeTeam', {}).get('abbrev')} {box.get('homeTeam', {}).get('score', '-')}", "players": {}, "goalies": {},
          "period": (box.get("periodDescriptor") or {}).get("number"), "outcome": (box.get("gameOutcome") or {}).get("lastPeriodType")}
    ppp = {}
    for per in (land.get("summary") or {}).get("scoring", []):
        if (per.get("periodDescriptor") or {}).get("periodType") == "SO":
            continue
        for gl in per.get("goals", []):
            if gl.get("strength") == "pp":
                for pid in [gl.get("playerId")] + [a.get("playerId") for a in gl.get("assists", [])]:
                    ppp[pid] = ppp.get(pid, 0) + 1
    for side in ("homeTeam", "awayTeam"):
        t = (box.get("playerByGameStats") or {}).get(side, {})
        for grp in ("forwards", "defense"):
            for p in t.get(grp, []):
                st["players"][p["playerId"]] = {"SOG": p.get("sog", 0), "G": p.get("goals", 0), "A": p.get("assists", 0), "PTS": p.get("points", 0),
                                                "HIT": p.get("hits", 0), "BLK": p.get("blockedShots", 0), "PPP": ppp.get(p["playerId"], 0),
                                                "name": p["name"]["default"]}
        for g in t.get("goalies", []):
            st["goalies"][g["playerId"]] = {"SV": g.get("saves", 0) or 0, "started": bool(g.get("starter")), "name": g["name"]["default"]}
    return st


def grade(leg: dict, gs: dict) -> tuple[str, float | None]:
    final = gs["state"] in FINAL
    if leg["stat"] == "SV":
        g = gs["goalies"].get(leg["player_id"])
        if g is None or not g["started"]:
            return ("VOID" if final or (g is None and gs["state"] not in ("FUT", "PRE")) else "PENDING"), None
        v = g["SV"]
    else:
        p = gs["players"].get(leg["player_id"])
        if p is None:
            return ("VOID" if final else "PENDING"), None
        v = p[leg["stat"]]
    if v > leg["line"]:
        return "WON", v
    return ("LOST" if final else "PENDING"), v


def main(path: str):
    rep = json.load(open(path))
    now = datetime.now(timezone.utc).isoformat()
    rows, md_games = [], []
    for g in rep["games"]:
        gs = game_stats(g["game_id"])
        lines = [f"## {g['away']} @ {g['home']} — {gs['score']} · {gs['state']}{' (' + gs['outcome'] + ')' if gs.get('outcome') else ''}"]
        for size, blk in g["sizes"].items():
            for i, pk in enumerate(blk["picks"]):
                gr = [grade(l, gs) for l in pk["legs"]]
                states = [x[0] for x in gr]
                if "LOST" in states:
                    status = "LOST"
                elif "VOID" in states:
                    status = "VOID-REPRICE"
                elif all(s == "WON" for s in states):
                    status = "WON"
                else:
                    status = "PENDING"
                rows.append({"game_id": g["game_id"], "game": f"{g['away']}@{g['home']}", "state": gs["state"], "size": int(size), "pick": chr(65 + i),
                             "family": pk["family"], "pJoint": pk["pJoint"], "pLower": pk["pLower"], "pIndep": pk["pIndep"], "breakEven": pk["breakEven"],
                             "status": status, "legs": [{"text": l["text"], "p": l["p"], "result": s, "value": v} for l, (s, v) in zip(pk["legs"], gr)]})
                if gs["state"] not in ("FUT", "PRE"):
                    lines.append(f"**{size}-leg {chr(65 + i)} · {pk['family']}** — model {100 * pk['pJoint']:.1f}% · break-even {'+' if pk['breakEven'] > 0 else ''}{pk['breakEven']} → **{status}**")
                    for l, (s, v) in zip(pk["legs"], gr):
                        mark = {"WON": "✅", "LOST": "❌", "VOID": "⚪", "PENDING": "⏳"}[s]
                        lines.append(f"- {mark} {l['text']} (model {100 * l['p']:.0f}%) — actual: {v if v is not None else 'n/a'}")
                    lines.append("")
        if gs["state"] in ("FUT", "PRE"):
            lines.append(f"_Not started — {sum(len(b['picks']) for b in g['sizes'].values())} parlays pending._\n")
        md_games.append("\n".join(lines))
    settled = [r for r in rows if r["status"] in ("WON", "LOST")]
    legs = [l for r in rows for l in r["legs"] if l["result"] in ("WON", "LOST")]
    def summ(rs, key="pJoint"):
        if not rs:
            return None
        n = len(rs); w = sum(r["status"] == "WON" for r in rs); ep = sum(r[key] for r in rs)
        brier = sum((r[key] - (r["status"] == "WON")) ** 2 for r in rs) / n
        ll = -sum(math.log(max(1e-6, r[key] if r["status"] == "WON" else 1 - r[key])) for r in rs) / n
        return {"n": n, "won": w, "expected_wins": ep, "hit_rate": w / n, "mean_p": ep / n, "brier": brier, "logloss": ll}
    by = {s: summ([r for r in settled if r["size"] == s]) for s in (3, 5, 8)}
    indep = {s: summ([r for r in settled if r["size"] == s], "pIndep") for s in (3, 5, 8)}
    leg_sum = {"n": len(legs), "won": sum(l["result"] == "WON" for l in legs), "expected": sum(l["p"] for l in legs)}
    counts = {k: sum(r["status"] == k for r in rows) for k in ("WON", "LOST", "PENDING", "VOID-REPRICE")}
    out = {"audited_at": now, "source": os.path.basename(path), "model_version": rep.get("model_version"), "counts": counts, "by_size": by,
           "by_size_independence": indep, "legs": leg_sum, "parlays": rows}
    md = [f"# Parlay audit — {os.path.basename(path)}", f"Audited {now} against official NHL data · model {rep.get('model_version')}", "",
          f"**Parlays:** {counts['WON']} won · {counts['LOST']} lost · {counts['PENDING']} pending · {counts['VOID-REPRICE']} void/reprice (of {len(rows)})", ""]
    md.append("| Size | Settled | Won | Expected wins (model) | Hit rate | Mean model P | Brier joint | Brier indep |")
    md.append("|---|---|---|---|---|---|---|---|")
    for s in (3, 5, 8):
        b, ib = by[s], indep[s]
        md.append(f"| {s} | {b['n'] if b else 0} | {b['won'] if b else 0} | {b['expected_wins']:.2f} | {100 * b['hit_rate']:.0f}% | {100 * b['mean_p']:.1f}% | {b['brier']:.3f} | {ib['brier']:.3f} |" if b else f"| {s} | 0 | – | – | – | – | – | – |")
    if legs:
        md.append(f"\n**Settled legs:** {leg_sum['won']}/{leg_sum['n']} won vs {leg_sum['expected']:.1f} expected by the model.")
    md.append("\n_Small samples: a single night cannot validate or refute the model — compare against the 24,535-combination historical validation._\n")
    md += md_games
    base = os.path.join(ROOT, "reports", f"audit-{os.path.basename(path).replace('sgp-', '').replace('.json', '')}")
    open(base + ".md", "w").write("\n".join(md) + "\n")
    json.dump(out, open(base + ".json", "w"), indent=1)
    print("\n".join(md[:14]))
    print(f"\nwrote {base}.md")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else sorted(p for p in os.listdir(os.path.join(ROOT, "reports")) if p.startswith("sgp-") and p.endswith(".json"))[-1])

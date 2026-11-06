"""Authorised odds feed adapter -> normalized quotes (contracts/odds_schema.json).

Provider: The Odds API v4 (https://the-odds-api.com) — requires ODDS_API_KEY.
Respects the provider's quota (one events call + one call per event, only
for games on the current slate). Combined SGP prices are NOT available from
this provider; SGP quotes must be entered manually in the Odds Desk.

Matching rules (exact or rejected — never fuzzy):
  * event  -> slate game by (home abbrev, away abbrev, commence date within 6 h)
  * player -> NHL playerId by exact normalized full name within that game's two
              team rosters (api-web.nhle.com /v1/roster/{team}/current)
  * market -> registry market key; line/point and Over/Under preserved verbatim

Usage:  ODDS_API_KEY=... .venv/bin/python ml/odds.py
Writes: data/artifacts/odds_snapshot.js and appends data/history/odds_snapshots.jsonl
"""
from __future__ import annotations

import json
import os
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from nqml.ingest import BASE, ROOT, UA, _get  # noqa: E402

API = "https://api.the-odds-api.com/v4"
SPORT = "icehockey_nhl"
MARKETS = {  # provider market -> registry market (side handling)
    "player_shots_on_goal": "player_sog", "player_points": "player_points", "player_assists": "player_assists",
    "player_blocked_shots": "player_blocks", "player_power_play_points": "player_ppp", "player_total_saves": "goalie_saves",
    "player_goals": "player_goals", "player_goal_scorer_anytime": "player_goals",
}
TEAM_ABBR = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF", "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR",
    "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL", "Detroit Red Wings": "DET",
    "Edmonton Oilers": "EDM", "Florida Panthers": "FLA", "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montréal Canadiens": "MTL",
    "Montreal Canadiens": "MTL", "Nashville Predators": "NSH", "New Jersey Devils": "NJD", "New York Islanders": "NYI", "New York Rangers": "NYR",
    "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS", "Seattle Kraken": "SEA",
    "St Louis Blues": "STL", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR", "Utah Mammoth": "UTA",
    "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return " ".join("".join(ch for ch in s if ch.isalpha() or ch == " ").split())


def roster_index(abbr: str) -> dict[str, int]:
    js = _get(f"{BASE}/roster/{abbr}/current") or {}
    out: dict[str, list[int]] = {}
    for grp in ("forwards", "defensemen", "goalies"):
        for p in js.get(grp, []):
            full = norm(f"{p['firstName']['default']} {p['lastName']['default']}")
            out.setdefault(full, []).append(int(p["id"]))
    return {k: v[0] for k, v in out.items() if len(v) == 1}  # ambiguous names dropped


def normalize_event(ev_odds: dict, game: dict, rosters: dict[str, int]) -> tuple[list[dict], list[dict]]:
    """Provider event-odds JSON -> (quotes, rejected)."""
    quotes, rejected = [], []
    for bk in ev_odds.get("bookmakers", []):
        for mk in bk.get("markets", []):
            reg = MARKETS.get(mk.get("key"))
            if not reg:
                continue
            for oc in mk.get("outcomes", []):
                player = oc.get("description") or ""
                pid = rosters.get(norm(player))
                side = (oc.get("name") or "").lower()
                line = oc.get("point")
                if mk["key"] == "player_goal_scorer_anytime":
                    side, line = "over", 0.5
                q = {"book": bk.get("key"), "game_id": game["game_id"], "market": reg, "player_id": pid, "line": line, "side": side,
                     "american": oc.get("price"), "ts": mk.get("last_update") or bk.get("last_update"), "status": "open",
                     "provider": "the-odds-api", "provider_event": ev_odds.get("id"), "player_name": player}
                if pid is None:
                    rejected.append({**q, "reason": "player name not exactly matched to an NHL roster id"})
                elif side not in ("over", "under") or not isinstance(line, (int, float)):
                    rejected.append({**q, "reason": "unsupported selection/line"})
                elif not isinstance(q["american"], (int, float)) or abs(q["american"]) < 100:
                    rejected.append({**q, "reason": "invalid American price"})
                else:
                    quotes.append(q)
    return quotes, rejected


def match_events(events: list[dict], slate: list[dict]) -> dict[str, dict]:
    out = {}
    for ev in events:
        h, a = TEAM_ABBR.get(ev.get("home_team")), TEAM_ABBR.get(ev.get("away_team"))
        t = datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00"))
        for g in slate:
            gt = datetime.fromisoformat(g["start_utc"].replace("Z", "+00:00"))
            if g["home"] == h and g["away"] == a and abs((gt - t).total_seconds()) <= 6 * 3600:
                out[ev["id"]] = g
    return out


def _api(path: str, **params) -> object:
    key = os.environ.get("ODDS_API_KEY")
    if not key:
        raise SystemExit("ODDS_API_KEY not set — no odds fetched (nothing is fabricated).")
    url = f"{API}{path}?" + urllib.parse.urlencode({"apiKey": key, **params})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        print("quota remaining:", r.headers.get("x-requests-remaining"))
        return json.loads(r.read().decode())


def main():
    slate = json.load(open(os.path.join(ROOT, "data", "build", "upcoming.json")))
    events = _api(f"/sports/{SPORT}/events")
    matched = match_events(events, slate)
    quotes, rejected = [], []
    rosters_cache: dict[str, dict] = {}
    for eid, g in matched.items():
        rs = {}
        for t in (g["home"], g["away"]):
            rosters_cache.setdefault(t, roster_index(t)); rs.update(rosters_cache[t])
        ev = _api(f"/sports/{SPORT}/events/{eid}/odds", regions="us", oddsFormat="american", markets=",".join(MARKETS))
        q, r = normalize_event(ev, g, rs)
        quotes += q; rejected += r
    snap = {"fetched_at": datetime.now(timezone.utc).isoformat(), "provider": "the-odds-api", "quotes": quotes, "rejected": rejected[:500],
            "events_matched": len(matched), "events_total": len(events)}
    os.makedirs(os.path.join(ROOT, "data", "artifacts"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "artifacts", "odds_snapshot.js"), "w") as f:
        f.write("window.NQ_ODDS = " + json.dumps(snap) + ";\n")
    os.makedirs(os.path.join(ROOT, "data", "history"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "history", "odds_snapshots.jsonl"), "a") as f:
        f.write(json.dumps(snap) + "\n")
    print(f"quotes {len(quotes)} rejected {len(rejected)} events {len(matched)}/{len(events)}")


if __name__ == "__main__":
    main()

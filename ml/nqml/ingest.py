"""Real NHL data ingestion (public api-web.nhle.com endpoints).

Fetches, per regular-season game:
  * /v1/gamecenter/{id}/boxscore  -> skater & goalie box scores, team score/SOG
  * /v1/gamecenter/{id}/landing   -> scoring summary (PP points, empty-net,
                                     shootout exclusion) and penalty list
Raw responses are cached gzip-compressed in data/raw/nhl/ so re-runs are
incremental and polite. Only FINAL/OFF games are ingested as history; future
games come from the schedule endpoint (see upcoming()).

Point-in-time rule: every raw record carries the game's start time (UTC). The
feature builder only ever aggregates games whose start time is strictly before
the target game's start time.
"""
from __future__ import annotations

import gzip
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

BASE = "https://api-web.nhle.com/v1"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "data", "raw", "nhl")
UA = "case-capital-nhl-quant/3.8 (research; contact: repository owner)"
SEASONS = ["20242025", "20252026", "20262027"]
MAX_GAMES = 1312  # 32 teams x 82 / 2


def _get(url: str, retries: int = 4) -> dict | None:
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5 * (2 ** k))
        except Exception:  # network hiccup
            time.sleep(1.5 * (2 ** k))
    return None


def _cache_path(gid: int, kind: str) -> str:
    return os.path.join(RAW, f"{gid}_{kind}.json.gz")


def fetch_game(gid: int) -> str:
    """Fetch boxscore+landing for one game. Returns status string."""
    bp, lp = _cache_path(gid, "box"), _cache_path(gid, "landing")
    if os.path.exists(bp) and os.path.exists(lp):
        return "cached"
    box = _get(f"{BASE}/gamecenter/{gid}/boxscore")
    if box is None:
        return "missing"
    if box.get("gameState") not in ("OFF", "FINAL"):
        return "not-final"
    land = _get(f"{BASE}/gamecenter/{gid}/landing")
    if land is None:
        return "missing-landing"
    os.makedirs(RAW, exist_ok=True)
    with gzip.open(bp, "wt") as f:
        json.dump(box, f)
    with gzip.open(lp, "wt") as f:
        json.dump(land, f)
    time.sleep(0.12)  # polite pacing per worker
    return "ok"


def _base_ids() -> set[int]:
    """Game ids already present in the committed base tables (no need to refetch)."""
    p = os.path.join(ROOT, "data", "base", "games.parquet")
    if not os.path.exists(p):
        return set()
    import pandas as pd
    return set(int(x) for x in pd.read_parquet(p, columns=["game_id"]).game_id)


def ingest(seasons=SEASONS, workers: int = 4, log=print) -> dict:
    stats = {}
    for season in seasons:
        start = int(season[:4])
        ids = [int(f"{start}02{n:04d}") for n in range(1, MAX_GAMES + 1)]
        have = _base_ids()
        ids = [i for i in ids if i not in have]
        counts: dict[str, int] = {}
        miss_run = 0
        # walk in chunks; stop a season once a long run of non-final games appears
        for chunk_start in range(0, len(ids), 64):
            chunk = ids[chunk_start:chunk_start + 64]
            with ThreadPoolExecutor(max_workers=workers) as ex:
                res = {ex.submit(fetch_game, g): g for g in chunk}
                out = {res[f]: f.result() for f in as_completed(res)}
            for g in chunk:
                s = out[g]
                counts[s] = counts.get(s, 0) + 1
                miss_run = miss_run + 1 if s in ("not-final", "missing") else 0
            log(f"{season} {chunk[-1]} {counts}")
            if miss_run >= 64:
                break
        stats[season] = counts
    return stats


def upcoming(days: int = 7) -> list[dict]:
    """Scheduled (not yet started) regular-season games for the next `days` days."""
    out, seen = [], set()
    # Start one day back: the schedule endpoint is keyed by North American (ET) game date, so after
    # 00:00 UTC tonight's late games belong to "yesterday" and would otherwise be skipped.
    d = datetime.now(timezone.utc).date() - timedelta(days=1)
    end = d + timedelta(days=days + 1)
    while d <= end:
        js = _get(f"{BASE}/schedule/{d.isoformat()}")
        if not js:
            break
        for wk in js.get("gameWeek", []):
            for g in wk.get("games", []):
                if g["id"] in seen or g.get("gameType") != 2:
                    continue
                seen.add(g["id"])
                if g.get("gameState") in ("FUT", "PRE"):
                    out.append({
                        "game_id": g["id"], "season": str(g["season"]), "start_utc": g["startTimeUTC"],
                        "home": g["homeTeam"]["abbrev"], "away": g["awayTeam"]["abbrev"],
                    })
        d += timedelta(days=7)
    return sorted(out, key=lambda x: x["start_utc"])


def load_raw(gid: int) -> tuple[dict, dict]:
    with gzip.open(_cache_path(gid, "box"), "rt") as f:
        box = json.load(f)
    with gzip.open(_cache_path(gid, "landing"), "rt") as f:
        land = json.load(f)
    return box, land


if __name__ == "__main__":
    print(ingest())

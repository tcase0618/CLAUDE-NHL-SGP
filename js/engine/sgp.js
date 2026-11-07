/* ==========================================================================
 * NQ.sgp — 3 / 5 / 8-leg Same Game Parlay research engine (real NHL games).
 *
 * Pipeline: prop pool (from simulated marginals) → validity filters
 * (duplicates, redundancy, incompatibility) → ideology family constraints →
 * beam search on bit-packed sim outcome masks (heuristic — evaluated count is
 * tracked; NOT exhaustive) → finalists re-scored on an INDEPENDENT fresh
 * simulation (removes selection-on-noise bias) → conservative joint bound →
 * SGP CV% only where an actual combined sportsbook quote exists.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const sgp = {};

  sgp.LINES = { SOG: [1.5, 2.5, 3.5, 4.5], PTS: [0.5, 1.5], G: [0.5], A: [0.5], BLK: [0.5, 1.5, 2.5], HIT: [0.5, 1.5, 2.5, 3.5], PPP: [0.5], SV: [22.5, 24.5, 26.5, 28.5, 30.5] };
  // Parlay legs are drawn ONLY from markets the user's sportsbook offers in an SGP.
  // Hits are still simulated (blocks/pace depend on the same environment) but never offered as legs.
  sgp.BETTABLE = ['SOG', 'PTS', 'G', 'A', 'BLK', 'PPP'];  // + SV (goalie saves) below
  sgp.GOALIE_MIN_START = 0.85;
  sgp.MAX_LEG_EXPOSURE = 2;   // a leg may appear in at most this many published parlays per game
  sgp.MARKET_OF = { SOG: 'player_sog', PTS: 'player_points', G: 'player_goals', A: 'player_assists', BLK: 'player_blocks', HIT: 'player_hits', PPP: 'player_ppp', SV: 'goalie_saves' };
  sgp.CONFIG = {
    3: { band: [0.35, 0.93], beam: 40, keep: 14, floor: 0.12 },
    5: { band: [0.45, 0.94], beam: 40, keep: 14, floor: 0.05 },
    8: { band: [0.55, 0.96], beam: 30, keep: 14, floor: 0.015 }
  };

  // Ideology families: pool filter + combination constraint (+ description).
  const tm = (leg) => leg.team; // 0 home, 1 away
  sgp.FAMILIES = {
    3: [
      { id: '3A', n: 'Shot-volume structure', d: 'Shot thresholds driven by shot opportunity, usage and game pace.', pool: (l) => l.stat === 'SOG', ok: () => true },
      { id: '3B', n: 'Team offensive scenario', d: 'Compatible scoring/production events under one team\'s offensive scenario.', pool: (l) => ['G', 'A', 'PTS', 'PPP', 'SOG'].includes(l.stat) && l.stat !== 'SV', ok: (legs) => new Set(legs.map(tm)).size === 1 },
      { id: '3C', n: 'Goalie workload structure', d: 'Goalie saves alongside opposing shot production (shared opponent shot volume).', pool: (l) => l.stat === 'SV' || l.stat === 'SOG', ok: (legs) => { const g = legs.filter((l) => l.stat === 'SV'); return g.length === 1 && legs.filter((l) => l.stat === 'SOG').every((l) => l.team !== g[0].team); } },
      { id: '3D', n: 'Cross-team scenario', d: 'Props from both teams under one anticipated game environment.', pool: () => true, ok: (legs) => new Set(legs.map(tm)).size === 2 }
    ],
    5: [
      { id: '5A', n: 'Five-on-five offensive environment', d: 'Even-strength shot and production thresholds for one team (no PP legs).', pool: (l) => ['SOG', 'PTS', 'G', 'A'].includes(l.stat), ok: (legs) => new Set(legs.map(tm)).size === 1 },
      { id: '5B', n: 'Top-6 usage cluster', d: 'Production from a team\'s six highest-usage forwards/D (line assignments need shift data — proxy by TOI rank).', pool: (l) => l.toiRank <= 6 && l.stat !== 'SV', ok: (legs) => new Set(legs.map(tm)).size === 1 },
      { id: '5C', n: 'Special-teams scenario', d: 'Power-play points plus shots from PP-heavy players.', pool: (l) => l.stat === 'PPP' || (l.stat === 'SOG' && l.ppShare >= 0.25), ok: (legs) => legs.filter((l) => l.stat === 'PPP').length >= 2 },
      { id: '5D', n: 'High-tempo matchup', d: 'Shot legs on both teams tied to elevated game shot volume.', pool: (l) => l.stat === 'SOG', ok: (legs) => new Set(legs.map(tm)).size === 2 },
      { id: '5E', n: 'Balanced cross-team structure', d: 'At least two legs per team, mixed stats; shared game risk still modelled.', pool: (l) => l.stat !== 'SV', ok: (legs) => legs.filter((l) => l.team === 0).length >= 2 && legs.filter((l) => l.team === 1).length >= 2 }
    ],
    8: [
      { id: '8A', n: 'Shot-dominant game', d: 'Coordinated shot-volume legs (and saves) under a high-tempo scenario.', pool: (l) => l.stat === 'SOG' || l.stat === 'SV', ok: (legs) => legs.filter((l) => l.stat === 'SV').length <= 1 },
      { id: '8B', n: 'Concentrated offensive production', d: 'Production from a team\'s four highest-usage skaters.', pool: (l) => l.toiRank <= 4 && ['SOG', 'PTS', 'A', 'G'].includes(l.stat), ok: (legs) => new Set(legs.map(tm)).size <= 2 },
      { id: '8C', n: 'Special-teams-heavy game', d: 'Driven by extra power plays and PP usage.', pool: (l) => l.stat === 'PPP' || l.stat === 'SOG' || l.stat === 'PTS', ok: (legs) => legs.filter((l) => l.stat === 'PPP').length >= 3 },
      { id: '8D', n: 'Multi-line production', d: 'Several usage tiers of one team competing for limited team opportunities.', pool: (l) => l.stat !== 'SV', ok: (legs) => new Set(legs.map((l) => Math.ceil(l.toiRank / 4))).size >= 3 },
      { id: '8E', n: 'Goaltender workload game', d: 'Goalie saves with opposing shot markets under joint workload.', pool: (l) => l.stat === 'SV' || l.stat === 'SOG' || l.stat === 'BLK', ok: (legs) => legs.filter((l) => l.stat === 'SV').length >= 1 },
      { id: '8F', n: 'Cross-team high-event scenario', d: 'Both teams, shots and points under shared pace.', pool: (l) => ['SOG', 'PTS'].includes(l.stat), ok: (legs) => legs.filter((l) => l.team === 0).length >= 3 && legs.filter((l) => l.team === 1).length >= 3 }
    ]
  };

  /** Build the over-side prop pool with simulated marginal probabilities. */
  sgp.pool = (R, game) => {
    const pool = [];
    const W = Math.ceil(R.n / 32);
    const pack = (m, valid) => { const b = new Uint32Array(W), v = new Uint32Array(W); for (let s = 0; s < R.n; s++) { if (m[s]) b[s >> 5] |= 1 << (s & 31); if (valid[s]) v[s >> 5] |= 1 << (s & 31); } return { b, v }; };
    const sides = [game.home, game.away];
    sides.forEach((t, side) => {
      t.players.forEach((p) => {
        for (const stat of sgp.BETTABLE) {
          let best = null;
          for (const line of sgp.LINES[stat]) {
            const leg = { player_id: p.id, stat, line, side: 'over' };
            const { m, valid } = NQ.joint.legMask(R, leg);
            let c = 0; for (let s = 0; s < R.n; s++) c += m[s];
            const pr = c / R.n;
            const L = { ...leg, team: side, name: p.name, pos: p.pos, toiRank: p.toiRank || 99, ppShare: p.mu.PPP / Math.max(0.05, p.mu.PTS), p: pr, market: sgp.MARKET_OF[stat], ...pack(m, valid) };
            if (!best) best = []; best.push(L);
          }
          pool.push(...best);
        }
      });
      // Goalie legs only for a confirmed / near-certain starter: post-mortem 2026-11-07 showed the start
      // model's top pick starts just 54% of the time when it is below 70% confident.
      (t.goalies || []).filter((g) => g.pStart >= sgp.GOALIE_MIN_START).forEach((g) => {
        for (const line of sgp.LINES.SV) {
          const leg = { player_id: g.id, stat: 'SV', line, side: 'over' };
          const { m, valid } = NQ.joint.legMask(R, leg);
          let c = 0, nv = 0; for (let s = 0; s < R.n; s++) { if (valid[s]) { nv++; c += m[s]; } }
          const L = { ...leg, team: side, name: g.name, pos: 'G', toiRank: 0, ppShare: 0, p: nv ? c / nv : 0, market: 'goalie_saves', ...pack(m, valid) };
          pool.push(L);
        }
      });
    });
    return { legs: pool, W };
  };

  const popc = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };

  /** Redundant / incompatible pair check. */
  sgp.conflict = (a, b) => {
    if (a.player_id !== b.player_id) return false;
    if (a.stat === b.stat) return true; // one line per player-market
    const pair = [a.stat, b.stat].sort().join('|');
    // G≥1 ⇒ PTS≥1, A≥1 ⇒ PTS≥1, PPP≥1 ⇒ PTS≥1 at the 0.5 lines → logically redundant
    return ['G|PTS', 'A|PTS', 'PPP|PTS'].includes(pair) && a.line === 0.5 && b.line === 0.5;
  };

  /** Beam search for one family. Returns finalists + evaluated count. */
  sgp.search = (P, size, fam) => {
    const cfg = sgp.CONFIG[size];
    const pool = P.legs.filter((l) => l.p >= cfg.band[0] && l.p <= cfg.band[1] && fam.pool(l));
    let beam = [{ legs: [], b: null, v: null, score: 0 }];
    let evaluated = 0;
    const seen = new Set();
    for (let k = 0; k < size; k++) {
      const next = [];
      for (const st of beam) {
        for (const l of pool) {
          if (st.legs.some((x) => x === l || sgp.conflict(x, l))) continue;
          const legs = [...st.legs, l];
          const key = legs.map((x) => x.player_id + x.stat + x.line).sort().join(',');
          if (seen.has(key)) continue; seen.add(key);
          if (k === size - 1 && !fam.ok(legs)) continue;
          let hit = 0, val = 0;
          const nb = new Uint32Array(P.W), nv = new Uint32Array(P.W);
          for (let w = 0; w < P.W; w++) {
            const bb = (st.b ? st.b[w] : 0xFFFFFFFF) & l.b[w], vv = (st.v ? st.v[w] : 0xFFFFFFFF) & l.v[w];
            nb[w] = bb & vv; nv[w] = vv; hit += popc(nb[w]); val += popc(vv);
          }
          evaluated++;
          const p = val ? hit / val : 0;
          if (p <= 0) continue;
          next.push({ legs, b: nb, v: nv, score: Math.log(p), p, hit, val });
        }
      }
      next.sort((a, b) => b.score - a.score);
      beam = next.slice(0, cfg.beam);
      if (!beam.length) break;
    }
    const fin = beam.filter((s) => s.legs.length === size && fam.ok(s.legs) && s.p >= cfg.floor).slice(0, cfg.keep);
    return { finalists: fin, evaluated, poolSize: pool.length };
  };

  /**
   * Conservative joint bound: min(Wilson lower on fresh sims, p + validated
   * joint-calibration adjustment for this leg count). Without a validation
   * table the combination is marked unverified.
   */
  sgp.lower = (ev, size, valTables) => {
    const t = valTables && valTables[String(size)];
    if (!t || !t.length) return { pLower: null, verified: false, reason: 'No historical joint-calibration table for ' + size + '-leg' };
    const adj = NQ.cv.applyTable(ev.p, t);
    const pLower = Math.min(ev.wilsonLower, adj);
    return { pLower: Math.max(0, pLower), verified: ev.precisionOK, reason: ev.precisionOK ? '' : `Monte Carlo precision insufficient (${ev.hits} hits, rel. err ${(100 * ev.relErr).toFixed(0)}%)` };
  };

  /** Full research run for one game & size. fresh = independent re-simulation. */
  sgp.research = (R, fresh, game, size, valTables, quotes) => {
    const P = sgp.pool(R, game);
    const out = [];
    let evaluated = 0;
    for (const fam of sgp.FAMILIES[size]) {
      const res = sgp.search(P, size, fam);
      evaluated += res.evaluated;
      for (const f of res.finalists) {
        const legs = f.legs.map((l) => ({ player_id: l.player_id, stat: l.stat, line: l.line, side: 'over', team: l.team, name: l.name, pos: l.pos, market: l.market, p: l.p }));
        const ev = NQ.joint.evaluate(fresh, legs, { minHits: size === 8 ? 80 : 50 });
        const lo = sgp.lower(ev, size, valTables);
        const key = NQ.odds.sgpKey(game.game_id, legs.map((l) => ({ market: l.market, player_id: l.player_id, line: l.line, side: 'over' })));
        const q = (quotes || []).filter((x) => x.market === 'sgp' && NQ.odds.sgpKey(x.game_id, x.legs) === key);
        const cvs = q.map((x) => ({ book: x.book, ts: x.ts, american: x.american, ...NQ.cv.evalSGP({ pJoint: ev.p, pJointLower: lo.pLower ?? 0, quoteAmerican: x.american, precisionOK: lo.verified }) }));
        out.push({ family: fam, legs, searchP: f.p, ev, lower: lo, key, quotes: cvs, best: cvs.filter((x) => x.supported).sort((a, b) => b.cv - a.cv)[0] || null,
          breakEven: lo.pLower > 0 ? NQ.cv.fair(lo.pLower) : null, scenario: NQ.joint.scenario(fresh, legs) });
      }
    }
    return { size, items: out, evaluated, poolSize: P.legs.length, exhaustive: false };
  };

  NQ.sgp = sgp;
})(globalThis.NQ = globalThis.NQ || {});

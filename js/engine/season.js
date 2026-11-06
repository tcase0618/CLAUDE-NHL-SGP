/* ==========================================================================
 * NQ.season — schedule + chronological season simulation + aggregation.
 *
 * Builds an 82-game schedule (82 rounds of 16 games), simulates the first
 * PLAYED_ROUNDS rounds through NQ.sim, and stores:
 *   - per-game results (with as-of-date rest + starter info)
 *   - skater / goalie / team season accumulators + game logs
 *   - line, pair, PP and PK unit accumulators
 *   - the full shot-event table (for maps, xG diagnostics, explorer)
 * Unplayed rounds remain as the forward schedule for the prediction engine.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const { NS, NG, NT, NL, S, G, T } = NQ.sim;

  const ROUNDS = 82;
  const PLAYED_ROUNDS = 48;
  const START = Date.UTC(2025, 9, 7); // 2025-10-07 — synthetic 2025-26 season
  const DAY = 86400000;

  function dateOf(day) { return new Date(START + day * DAY); }
  function fmtDate(day) {
    const d = dateOf(day);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function isoDate(day) { return dateOf(day).toISOString().slice(0, 10); }

  function buildSchedule(league, rng) {
    const n = league.teams.length;
    const homeCount = new Array(n).fill(0);
    const games = [];
    const tor = league.byAbbr.TOR.id, bos = league.byAbbr.BOS.id;
    for (let r = 0; r < ROUNDS; r++) {
      const ids = rng.shuffle([...Array(n).keys()]);
      // Featured matchup: the first unplayed round is TOR (home) vs BOS.
      if (r === PLAYED_ROUNDS) {
        const rest = ids.filter((x) => x !== tor && x !== bos);
        ids.length = 0; ids.push(tor, bos, ...rest);
      }
      for (let k = 0; k < n; k += 2) {
        let h = ids[k], a = ids[k + 1];
        if (!(r === PLAYED_ROUNDS && k === 0)) {
          if (homeCount[a] < homeCount[h] || (homeCount[a] === homeCount[h] && rng.chance(0.5))) { const t = h; h = a; a = t; }
        }
        homeCount[h]++;
        const day = Math.floor(r * 2.15) + (k / 2 >= 8 ? 1 : 0);
        games.push({ id: games.length, round: r, day, date: fmtDate(day), iso: isoDate(day), home: h, away: a, played: false });
      }
    }
    // Rest days for each team (days since previous game; 3 = opener/rested).
    const last = new Array(n).fill(-10);
    for (const g of games) {
      g.restH = Math.min(4, g.day - last[g.home]); g.restA = Math.min(4, g.day - last[g.away]);
      last[g.home] = g.day; last[g.away] = g.day;
    }
    // Featured game is presented with both clubs rested (confirmed starters).
    const feat = games.find((g) => g.round === PLAYED_ROUNDS && g.home === tor);
    if (feat) { feat.restH = Math.max(2, feat.restH); feat.restA = Math.max(2, feat.restA); }
    return games;
  }

  function newAcc(len) { return new Float64Array(len); }

  /** Simulate the played portion of the season. */
  function run(league, seed) {
    const rng = new NQ.Rng(seed + 7);
    const games = buildSchedule(league, rng);
    const P = league.players.length;
    const sk = Array.from({ length: P }, () => newAcc(NS));
    const gk = Array.from({ length: P }, () => newAcc(NG));
    const gp = new Int32Array(P);
    const gpG = new Int32Array(P), gsG = new Int32Array(P);
    const gRec = Array.from({ length: P }, () => ({ w: 0, l: 0, otl: 0, so: 0 }));
    const plog = Array.from({ length: P }, () => []);
    const team = league.teams.map(() => ({ acc: newAcc(NT), w: 0, l: 0, otl: 0, row: 0, pts: 0, gp: 0, sow: 0, sol: 0, otw: 0, log: [] }));
    const lines = league.teams.map(() => ({ L: newAcc(4 * NL), P: newAcc(3 * NL), PP: newAcc(8), PK: newAcc(8) }));
    const shots = [];

    for (const g of games) {
      if (g.round >= PLAYED_ROUNDS) break;
      const th = league.teams[g.home], ta = league.teams[g.away];
      const stH = starterPick(league, th, g.restH, rng), stA = starterPick(league, ta, g.restA, rng);
      const H = NQ.sim.buildTeamCtx(league, th, { home: true, rest: g.restH, starter: stH });
      const A = NQ.sim.buildTeamCtx(league, ta, { home: false, rest: g.restA, starter: stA });
      const res = NQ.sim.simulate(H, A, rng, { shots: true });
      g.played = true; g.hg = res.hg; g.ag = res.ag; g.type = res.type;
      g.hxg = res.ts[0][T.XGF]; g.axg = res.ts[1][T.XGF];
      g.hs = res.ts[0][T.SF]; g.as = res.ts[1][T.SF];
      g.starterH = th.roster[stH]; g.starterA = ta.roster[stA];
      const sides = [[th, H, g.restH], [ta, A, g.restA]];
      for (let t = 0; t < 2; t++) {
        const [tm, ctx, rest] = sides[t];
        const o = 1 - t;
        const tr = team[tm.id];
        // ---- team
        const tacc = tr.acc, ts = res.ts[t];
        for (let k = 0; k < NT; k++) tacc[k] += ts[k];
        tr.gp++;
        const gf = t === 0 ? res.hg : res.ag, ga = t === 0 ? res.ag : res.hg;
        const won = gf > ga;
        let r;
        if (won) { tr.w++; tr.pts += 2; r = 'W'; if (res.type !== 'SO') tr.row++; if (res.type === 'SO') tr.sow++; if (res.type === 'OT') tr.otw++; }
        else if (res.type === 'REG') { tr.l++; r = 'L'; }
        else { tr.otl++; tr.pts += 1; r = 'OTL'; if (res.type === 'SO') tr.sol++; }
        tr.log.push({
          gid: g.id, opp: (t === 0 ? ta : th).id, home: t === 0, gf, ga, r, type: res.type, rest,
          xgf: ts[T.XGF], xga: ts[T.XGA], xgf5: ts[T.XGF5], xga5: ts[T.XGA5], toi5: ts[T.TOI5],
          cf5: ts[T.CF5], ca5: ts[T.CA5], sf: ts[T.SF], sa: ts[T.SA], ppo: ts[T.PPO], ppg: ts[T.PPGF], ppxg: ts[T.PPXGF],
          tsh: ts[T.TSH], pkga: ts[T.PKGA], pkxga: ts[T.PKXGA], pptoi: ts[T.PPTOI], pktoi: ts[T.PKTOI], first: ts[T.FIRST],
          g5f: ts[T.GF5], g5a: ts[T.GA5], hdf5: ts[T.HDF5], hda5: ts[T.HDA5], round: g.round
        });
        // ---- lines / units
        const la = lines[tm.id];
        for (let k = 0; k < 4 * NL; k++) la.L[k] += res.ls[t][k];
        for (let k = 0; k < 3 * NL; k++) la.P[k] += res.ps[t][k];
        for (let k = 0; k < 8; k++) { la.PP[k] += res.us[t][k]; la.PK[k] += res.ks[t][k]; }
        // ---- skaters
        const b = res.box[t];
        for (let s = 0; s < 18; s++) {
          const pid = tm.roster[s];
          const acc = sk[pid], off = s * NS;
          for (let k = 0; k < NS; k++) acc[k] += b[off + k];
          gp[pid]++;
          plog[pid].push({
            gid: g.id, r: g.round, opp: (t === 0 ? ta : th).id, toi: b[off + S.TOI], g: b[off + S.G], a: b[off + S.A1] + b[off + S.A2],
            sog: b[off + S.SOG], ixg: b[off + S.IXG], xgf5: b[off + S.XGF5], xga5: b[off + S.XGA5], toi5: b[off + S.TOI5],
            blk: b[off + S.BLK], hit: b[off + S.HIT], ppt: b[off + S.TOIPP], cf5: b[off + S.CF5], ca5: b[off + S.CA5]
          });
        }
        // ---- goalies
        for (const gi of res.gUsed[t]) {
          const slot = 18 + gi, pid = tm.roster[slot];
          const acc = gk[pid], off = gi * NG, gbx = res.gb[t];
          for (let k = 0; k < NG; k++) acc[k] += gbx[off + k];
          gpG[pid]++;
          const isStart = res.gUsed[t][0] === gi;
          if (isStart) gsG[pid]++;
          const isDec = res.dec[t] === gi;
          if (isDec) {
            if (won) gRec[pid].w++; else if (res.type === 'REG') gRec[pid].l++; else gRec[pid].otl++;
            if (won && ga === 0) gRec[pid].so++;
          }
          plog[pid].push({
            gid: g.id, r: g.round, opp: (t === 0 ? ta : th).id, start: isStart, toi: gbx[off + G.TOI], sa: gbx[off + G.SA], ga: gbx[off + G.GA],
            xga: gbx[off + G.XGA], dec: isDec ? (won ? 'W' : res.type === 'REG' ? 'L' : 'OTL') : '', b2b: rest <= 1, home: t === 0
          });
        }
      }
      // ---- shots
      for (const sh of res.shots) {
        sh.gm = g.id; sh.tm = sh.t === 0 ? th.id : ta.id; sh.dt = sh.t === 0 ? ta.id : th.id;
        delete sh.t;
        shots.push(sh);
      }
    }
    const played = games.filter((g) => g.played);
    const upcoming = games.filter((g) => !g.played);
    return { games, played, upcoming, sk, gk, gp, gpG, gsG, gRec, plog, team, lines, shots, PLAYED_ROUNDS, ROUNDS };
  }

  function starterPick(league, team, rest, rng) {
    const share = league.players[team.roster[18]].lat.share;
    const p = rest <= 1 ? 0.3 : Math.min(0.92, share + 0.08);
    return rng.chance(p) ? 18 : 19;
  }

  /** Probability the slot-18 goalie starts given rest days (shared with predictor). */
  function starterProb(league, team, rest) {
    const share = league.players[team.roster[18]].lat.share;
    return rest <= 1 ? 0.3 : Math.min(0.92, share + 0.08);
  }

  NQ.season = { run, starterProb, fmtDate, isoDate, ROUNDS, PLAYED_ROUNDS };
})(globalThis.NQ = globalThis.NQ || {});

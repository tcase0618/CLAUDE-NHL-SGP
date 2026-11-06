/* ==========================================================================
 * NQ.estimate — talent-estimation layer.
 *
 * The forecaster is NOT allowed to see the simulator's hidden latent talent.
 * Instead it reconstructs a talent vector for every player and team from
 * MEASURED statistics (z-scored within position, shrunk by sample size),
 * then the Monte Carlo engine runs on that estimated league. This mirrors
 * the real problem: you only ever observe noisy outcomes.
 *
 * Because the universe is synthetic, Model Audit can also report how well
 * the estimates recover the hidden truth (a luxury reality never offers).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const { S, G, T } = NQ.sim;

  function zMaker(ids, fn) {
    const v = ids.map(fn).filter((x) => typeof x === 'number' && isFinite(x));
    const m = u.mean(v), s = u.sd(v) || 1;
    return (x) => (typeof x === 'number' && isFinite(x) ? (x - m) / s : 0);
  }

  function build(league, season, M) {
    const sk = M.skater, gl = M.goalie;
    const F = league.players.filter((p) => !p.isG && !p.isD).map((p) => p.id);
    const D = league.players.filter((p) => p.isD).map((p) => p.id);
    const est = {};

    for (const group of [F, D]) {
      const v = (k) => (id) => sk[id].vals[k];
      const z = {};
      ['icf60', 'xa60', 'a160', 'cent60', 'cex60', 'carry', 'txg60', 'relxga', 'entden', 'tk60', 'dzerr60', 'hit60', 'blk60', 'give60', 'slotpc', 'ppp60', 'pend60']
        .forEach((k) => { z[k] = zMaker(group.filter((id) => season.gp[id] >= 10), v(k)); });
      const penZ = zMaker(group, (id) => (season.sk[id][S.PEN] * 3600) / Math.max(600, season.sk[id][S.TOI]));
      const drwZ = zMaker(group, (id) => (season.sk[id][S.PDRAW] * 3600) / Math.max(600, season.sk[id][S.TOI]));
      for (const id of group) {
        const p = league.players[id], a = season.sk[id], val = sk[id].vals;
        const toiMin = a[S.TOI] / 60;
        const r = toiMin / (toiMin + 220);              // rate-stat reliability
        const rpp = (a[S.TOIPP] / 60) / (a[S.TOIPP] / 60 + 70);
        const Z = (k) => z[k](val[k]);
        const finRaw = Math.log((a[S.G] + 5) / (a[S.IXG] + 5)) / 0.11;
        const rf = a[S.IXG] / (a[S.IXG] + 22);
        const fo = p.pos === 'C' ? (() => { const n = a[S.FOW] + a[S.FOL]; const pr = n ? (a[S.FOW] + 50) / (n + 100) : 0.5; return (u.logit(pr) / 0.28) * (n / (n + 250)) + 0.2; })() : -1;
        est[id] = {
          vol: 0.95 * r * Z('icf60'),
          sht: rf * finRaw + 0.25 * r * Z('icf60'),
          pm: r * (0.6 * Z('xa60') + 0.4 * Z('a160')),
          trn: r * (Z('cent60') + Z('cex60') + Z('carry') + Z('txg60')) / 3.2,
          def: r * (-0.35 * Z('relxga') + 0.3 * Z('entden') + 0.25 * Z('tk60') - 0.25 * Z('dzerr60')),
          phy: r * Z('hit60'),
          fo,
          dis: -r * penZ((a[S.PEN] * 3600) / Math.max(600, a[S.TOI])),
          drw: r * drwZ((a[S.PDRAW] * 3600) / Math.max(600, a[S.TOI])),
          blk: r * Z('blk60'),
          skt: r * (0.5 * Z('cent60') + 0.5 * Z('entden')),
          pp: rpp * Z('ppp60') + 0.3 * r * Z('xa60'),
          iq: r * (-0.5 * Z('give60') + 0.5 * Z('slotpc'))
        };
      }
    }
    // goalies
    const gIds = league.players.filter((p) => p.isG).map((p) => p.id);
    const talZ = zMaker(gIds.filter((id) => season.gpG[id] >= 8), (id) => gl[id].vals.gtal);
    const hdZ = zMaker(gIds.filter((id) => season.gpG[id] >= 8), (id) => gl[id].vals.ghdx);
    const rebZ = zMaker(gIds.filter((id) => season.gpG[id] >= 8), (id) => gl[id].vals.greba);
    const consZ = zMaker(gIds.filter((id) => season.gpG[id] >= 8), (id) => gl[id].vals.gsd);
    for (const id of gIds) {
      const a = season.gk[id], val = gl[id].vals;
      const r = a[G.SA] / (a[G.SA] + 500);
      const team = league.teams[league.players[id].teamId];
      const tgp = season.team[team.id].gp;
      est[id] = {
        stop: (val.gtal || 0) / 0.72 + 0.1 * talZ(val.gtal),
        hd: r * hdZ(val.ghdx), reb: -r * rebZ(val.greba), lat: r * 0.5 * talZ(val.gtal), cons: -r * consZ(val.gsd), puck: 0, stam: 0,
        share: league.players[id].slot === 18 ? Math.min(0.85, Math.max(0.5, season.gsG[id] / Math.max(1, tgp) - 0.05)) : 0
      };
    }

    // teams — residual system effects, shrunk 60%
    const lg = { cf: 0, ca: 0, t5: 0, ppx: 0, ppt: 0, pkx: 0, pkt: 0, pen: 0, gp: 0, hit: 0 };
    season.team.forEach((t) => { lg.cf += t.acc[T.CF5]; lg.t5 += t.acc[T.TOI5]; lg.ppx += t.acc[T.PPXGF]; lg.ppt += t.acc[T.PPTOI]; lg.pkx += t.acc[T.PKXGA]; lg.pkt += t.acc[T.PKTOI]; lg.pen += t.acc[T.PEN]; lg.gp += t.gp; lg.hit += t.acc[T.HIT]; });
    const lgCF = lg.cf / lg.t5, lgPP = lg.ppx / lg.ppt, lgPK = lg.pkx / lg.pkt, lgPen = lg.pen / lg.gp, lgHit = lg.hit / lg.gp;
    const teamEst = league.teams.map((tm) => {
      const a = season.team[tm.id].acc, gp = season.team[tm.id].gp;
      const cf = a[T.CF5] / a[T.TOI5], ca = a[T.CA5] / a[T.TOI5];
      const pace = 0.6 * 0.5 * Math.log((cf + ca) / (2 * lgCF));
      return {
        off: 0.35 * (Math.log(cf / lgCF) - pace) / 0.2,
        def: 0.35 * (-Math.log(ca / lgCF) - pace) / 0.16,
        pp: 0.6 * Math.log((a[T.PPXGF] / a[T.PPTOI]) / lgPP) / 0.5,
        pk: 0.6 * -Math.log((a[T.PKXGA] / a[T.PKTOI]) / lgPK) / 0.35,
        pace, disc: -0.6 * Math.log((a[T.PEN] / gp) / lgPen) / 0.5,
        phy: 0.6 * Math.log((a[T.HIT] / gp) / lgHit) / 0.3, fore: 0, exitq: 0, struct: 0
      };
    });

    // assemble the estimated league (same ids / rosters, estimated latents)
    const players = league.players.map((p) => ({ ...p, lat: est[p.id] }));
    const teams = league.teams.map((tm) => {
      const ch = M.chem[tm.id];
      return {
        ...tm, lat: teamEst[tm.id],
        lines: tm.lines.map((L, i) => ({ ...L, chem: 0.55 * ch.lines[i].synergy })),
        pairs: tm.pairs.map((Q, i) => ({ ...Q, chem: 0.45 * ch.pairs[i].synergy }))
      };
    });
    const estLeague = { seed: league.seed, players, teams, byAbbr: {} };
    teams.forEach((t) => { estLeague.byAbbr[t.abbr] = t; });

    const cal = calibrate(estLeague, season);
    return { league: estLeague, recovery: recovery(league, estLeague), cal };
  }

  /**
   * Environment calibration: simulate a round of matchups on the estimated
   * league and shift every team's pace / finishing so league-average shots
   * and goals match what was observed. (Two passes.)
   */
  function calibrate(L, season) {
    let obsSF = 0, obsGF = 0, gp = 0;
    season.team.forEach((t) => { obsSF += t.acc[T.SF]; obsGF += t.acc[T.GF]; gp += t.gp; });
    obsSF /= gp; obsGF /= gp;
    const rng = new NQ.Rng('calibrate');
    const hist = [];
    L.goalScale = 1;
    for (let pass = 0; pass < 2; pass++) {
      let sf = 0, gf = 0, n = 0;
      const ids = rng.shuffle(L.teams.map((t) => t.id));
      for (let k = 0; k < ids.length; k += 2) {
        const H = NQ.sim.buildTeamCtx(L, L.teams[ids[k]], { home: true });
        const A = NQ.sim.buildTeamCtx(L, L.teams[ids[k + 1]], {});
        for (let r = 0; r < 70; r++) {
          const res = NQ.sim.simulate(H, A, rng, {});
          sf += res.ts[0][T.SF] + res.ts[1][T.SF]; gf += res.ts[0][T.GF] + res.ts[1][T.GF]; n += 2;
        }
      }
      sf /= n; gf /= n;
      const dPace = Math.log(obsSF / sf) / 2;
      L.teams.forEach((t) => { t.lat = Object.assign({}, t.lat, { pace: t.lat.pace + dPace }); });
      // goals beyond the shot adjustment are absorbed by a global finishing scale
      L.goalScale *= (obsGF / gf) / (obsSF / sf);
      hist.push({ pass, simSF: sf, simGF: gf, obsSF, obsGF });
    }
    return hist;
  }

  /** Correlation between estimated and true latents (synthetic-only diagnostic). */
  function recovery(truth, est) {
    const corr = (xs, ys) => {
      const mx = u.mean(xs), my = u.mean(ys);
      let n = 0, dx = 0, dy = 0;
      for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
      return dx && dy ? n / Math.sqrt(dx * dy) : 0;
    };
    const sk = truth.players.filter((p) => !p.isG);
    const keys = [['vol', 'Shot volume'], ['sht', 'Finishing'], ['pm', 'Playmaking'], ['trn', 'Transition'], ['def', 'Defense'], ['phy', 'Physicality'], ['blk', 'Shot blocking'], ['pp', 'PP skill']];
    const out = keys.map(([k, n]) => ({ k, n, r: corr(sk.map((p) => p.lat[k]), sk.map((p) => est.players[p.id].lat[k])) }));
    const cs = truth.players.filter((p) => p.pos === 'C');
    out.push({ k: 'fo', n: 'Faceoffs (C)', r: corr(cs.map((p) => p.lat.fo), cs.map((p) => est.players[p.id].lat.fo)) });
    const gs = truth.players.filter((p) => p.isG);
    out.push({ k: 'stop', n: 'Goalie shot-stopping', r: corr(gs.map((p) => p.lat.stop), gs.map((p) => est.players[p.id].lat.stop)) });
    out.push({ k: 'chem', n: 'Line chemistry', r: corr(truth.teams.flatMap((t) => t.lines.map((l) => l.chem)), est.teams.flatMap((t) => t.lines.map((l) => l.chem))) });
    return out;
  }

  NQ.estimate = { build };
})(globalThis.NQ = globalThis.NQ || {});

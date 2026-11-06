/* ==========================================================================
 * NQ.chem — line & pairing chemistry engine.
 *
 *   Line impact = Σ individual impact_i + interaction effect
 *
 * Individual impact comes from each skater's measured box/tracking profile
 * (offense: ixG, xA, entries, transition xG; defense: denial, takeaways,
 * assignment errors, retrievals) expressed in xG/60 units relative to the
 * team. The interaction (chemistry) term is the residual between observed
 * line results and that expectation, SHRUNK by shared TOI:
 *
 *   chem = (observed − expected) × TOI / (TOI + K),  K = 250 min (lines), 300 (pairs)
 *
 * so a brand-new trio with 20 great minutes cannot be labelled "elite".
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const { NL } = NQ.sim;
  const K_LINE = 250 * 60, K_PAIR = 300 * 60;

  /** Individual xG/60 impact (off, def) from percentile profile. */
  function impact(sk) {
    const p = sk.pct;
    const av = (ks) => { const v = ks.map((k) => p[k]).filter((x) => typeof x === 'number'); return v.length ? u.mean(v) : 50; };
    const off = av(['ixg60', 'xa60', 'cent60', 'txg60', 'cc60']);
    const def = av(['entden', 'tk60', 'dzerr60', 'ret60', 'nzt60']);
    return { off: ((off - 50) / 50) * 0.32, def: ((def - 50) / 50) * 0.26 };
  }

  function unitStats(arr, i) {
    const b = i * NL;
    return { toi: arr[b], cf: arr[b + 1], ca: arr[b + 2], xgf: arr[b + 3], xga: arr[b + 4], gf: arr[b + 5], ga: arr[b + 6], sf: arr[b + 7], sa: arr[b + 8], hdf: arr[b + 9], hda: arr[b + 10] };
  }

  function build(league, season, skm) {
    const out = {};
    for (const team of league.teams) {
      const acc = season.team[team.id].acc;
      const T = NQ.sim.T;
      const tF = (acc[T.XGF5] * 3600) / acc[T.TOI5], tA = (acc[T.XGA5] * 3600) / acc[T.TOI5];
      const imp = {};
      team.roster.slice(0, 18).forEach((pid) => { imp[pid] = impact(skm[pid]); });
      const fIds = team.roster.slice(0, 12), dIds = team.roster.slice(12, 18);
      const mF = { off: u.mean(fIds.map((i) => imp[i].off)), def: u.mean(fIds.map((i) => imp[i].def)) };
      const mD = { off: u.mean(dIds.map((i) => imp[i].off)), def: u.mean(dIds.map((i) => imp[i].def)) };
      const unit = (ids, st, K, mean, wOff) => {
        const io = u.sum(ids.map((i) => imp[i].off - mean.off)) * wOff;
        const id = u.sum(ids.map((i) => imp[i].def - mean.def)) * wOff;
        const expF = Math.max(0.8, tF + io), expA = Math.max(0.8, tA - id);
        const obsF = st.toi > 0 ? (st.xgf * 3600) / st.toi : expF, obsA = st.toi > 0 ? (st.xga * 3600) / st.toi : expA;
        const shrink = st.toi / (st.toi + K);
        const adjF = expF + (obsF - expF) * shrink, adjA = expA + (obsA - expA) * shrink;
        const expPct = (100 * expF) / (expF + expA), obsPct = st.xgf + st.xga > 0 ? (100 * st.xgf) / (st.xgf + st.xga) : expPct;
        const n = st.cf + st.ca;
        const se = n > 0 ? 100 * Math.sqrt(0.25 / n) * 1.6 : 15;
        return {
          ids, st, toiMin: st.toi / 60, expF, expA, obsF, obsA, adjF, adjA, shrink,
          xgfPct: obsPct, expPct, adjPct: (100 * adjF) / (adjF + adjA),
          chemPct: (obsPct - expPct) * shrink, synergy: ((obsF - obsA) - (expF - expA)) * shrink,
          ci: 1.96 * se * shrink + 1.96 * se * (1 - shrink) * 0.35,
          cfPct: n ? (100 * st.cf) / n : null, gfPct: st.gf + st.ga ? (100 * st.gf) / (st.gf + st.ga) : null,
          hdd60: st.toi ? ((st.hdf - st.hda) * 3600) / st.toi : null, gf60: st.toi ? (st.gf * 3600) / st.toi : null
        };
      };
      const lines = team.lines.map((L, i) => unit(L.slots.map((s) => team.roster[s]), unitStats(season.lines[team.id].L, i), K_LINE, mF, 0.6));
      const pairs = team.pairs.map((Q, i) => unit(Q.slots.map((s) => team.roster[s]), unitStats(season.lines[team.id].P, i), K_PAIR, mD, 0.6));
      const pu = season.lines[team.id].PP, ku = season.lines[team.id].PK;
      const pp = team.pp.map((U, i) => ({ ids: U.slots.map((s) => team.roster[s]), toi: pu[i * 4], gf: pu[i * 4 + 1], xgf: pu[i * 4 + 2], sf: pu[i * 4 + 3] }));
      const pk = team.pk.map((U, i) => ({ ids: U.slots.map((s) => team.roster[s]), toi: ku[i * 4], ga: ku[i * 4 + 1], xga: ku[i * 4 + 2], sa: ku[i * 4 + 3] }));
      const wl = lines.reduce((s, l) => s + l.st.toi, 0), wp = pairs.reduce((s, l) => s + l.st.toi, 0);
      out[team.id] = {
        lines, pairs, pp, pk, imp, tF, tA,
        summary: {
          f: lines.reduce((s, l) => s + l.chemPct * l.st.toi, 0) / (wl || 1),
          d: pairs.reduce((s, l) => s + l.chemPct * l.st.toi, 0) / (wp || 1),
          best: Math.max(...lines.map((l) => l.adjF - l.adjA))
        }
      };
    }
    return out;
  }

  /** Projected xGF/60, xGA/60 for an arbitrary trio (Line Builder). */
  function customLine(league, chem, teamId, ids) {
    const C = chem[teamId];
    const team = league.teams[teamId];
    const existing = C.lines.find((l) => l.ids.slice().sort().join() === ids.slice().sort().join());
    const fIds = team.roster.slice(0, 12);
    const mF = { off: u.mean(fIds.map((i) => C.imp[i].off)), def: u.mean(fIds.map((i) => C.imp[i].def)) };
    const io = u.sum(ids.map((i) => C.imp[i].off - mF.off)) * 0.6, id = u.sum(ids.map((i) => C.imp[i].def - mF.def)) * 0.6;
    const expF = Math.max(0.8, C.tF + io), expA = Math.max(0.8, C.tA - id);
    if (existing) return { ...existing, existing: true };
    return { ids, expF, expA, adjF: expF, adjA: expA, adjPct: (100 * expF) / (expF + expA), chemPct: 0, synergy: 0, ci: 9.5, shrink: 0, existing: false, toiMin: 0 };
  }

  /** Line-vs-line xGF% edge matrix (team A lines rows vs team B lines cols). */
  function matchup(chem, a, b, lgF, lgA) {
    const A = chem[a], B = chem[b];
    const m = A.lines.map((la) => B.lines.map((lb) => {
      const f = lgF * (la.adjF / lgF) * (lb.adjA / lgA);
      const g = lgF * (lb.adjF / lgF) * (la.adjA / lgA);
      return (100 * f) / (f + g) - 50;
    }));
    const pm = A.pairs.map((pa) => B.lines.map((lb) => {
      const f = lgF * (pa.adjF / lgF) * (lb.adjA / lgA);
      const g = lgF * (lb.adjF / lgF) * (pa.adjA / lgA);
      return (100 * f) / (f + g) - 50;
    }));
    // deployment-weighted overall edge
    const wa = A.lines.map((l) => l.st.toi), wb = B.lines.map((l) => l.st.toi);
    const sa = u.sum(wa), sb = u.sum(wb);
    let overall = 0;
    m.forEach((row, i) => row.forEach((v, j) => { overall += v * (wa[i] / sa) * (wb[j] / sb); }));
    return { m, pm, overall, rowEdge: m.map((row) => row.reduce((s, v, j) => s + v * (wb[j] / sb), 0)) };
  }

  NQ.chem = { build, customLine, matchup, impact, teamSummary: (league, season, team) => (NQ.chem._last ? NQ.chem._last[team.id].summary : { f: 0, d: 0, best: 0 }) };
})(globalThis.NQ = globalThis.NQ || {});

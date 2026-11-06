/* ==========================================================================
 * NQ.joint — correlation-aware multivariate simulator for REAL NHL games.
 *
 * Inputs are the ML champions' per-player / per-team means for one game plus
 * dependence parameters fitted on held-out data (ml/jointfit.py). Each sim:
 *
 *   E  ~ LogN(σE)            shared game pace (both teams)
 *   O_t ~ LogN(σO)           team offensive shock
 *   W_t ~ LogN(σW)           team finishing / opposing-goalie shock
 *   S_t ~ Poisson(μS_t·E·O_t)                        team shots on goal
 *   shots → skaters  ~ Multinomial(w_i·Z_i),  Z_i ~ LogN(σZ)   (usage shock)
 *   G_t ~ Binomial(S_t, q_t·W_t); goals are drawn FROM shots (goals_i ≤ sog_i)
 *   assists: 0/1/2 per goal, from teammates only (≠ scorer)
 *   PP flag per goal from the scorer's PP share → PPP to scorer + assisters
 *   hits_i ~ Poisson(μH·Γ·E^0.3); blocks_i ~ Poisson(μB·Γ·(S_opp/μS_opp)^κ)
 *   goalie saves = S_opp − G_opp for the sampled starter
 *
 * Identities hold in every sim: points = goals + assists, goals ≤ SOG,
 * Σ skater goals = team goals, saves + goals against = opponent shots.
 * A short pilot run reconciles simulated marginal means to the ML means
 * (iterative proportional fitting on the weights), so single-prop and SGP
 * probabilities share the same calibrated marginals.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const STATS = ['SOG', 'G', 'A', 'PTS', 'BLK', 'HIT', 'PPP'];
  const joint = { STATS };

  function lnShock(rng, s) { return s > 0 ? Math.exp(rng.normal(0, s) - (s * s) / 2) : 1; }
  function gamma1(rng, shape) { // Marsaglia–Tsang, scale 1
    if (shape < 1) return gamma1(rng, shape + 1) * Math.pow(rng.next(), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = rng.normal(0, 1); v = 1 + c * x; } while (v <= 0);
      v = v * v * v; const uu = rng.next();
      if (uu < 1 - 0.0331 * x * x * x * x || Math.log(uu) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  const gammaMean1 = (rng, alpha) => (alpha > 1e-6 ? gamma1(rng, 1 / alpha) * alpha : 1);

  /** Prepare per-team arrays. game = {home:{muS, muG, players, goalies}, away:{...}} */
  function prep(game) {
    return [game.home, game.away].map((t) => {
      const P = t.players;
      const n = P.length;
      const sumS = P.reduce((s, p) => s + p.mu.SOG, 0) || 1;
      return {
        t, n, ids: P.map((p) => p.id),
        wS: Float64Array.from(P.map((p) => p.mu.SOG / sumS)),
        fin: Float64Array.from(P.map((p) => Math.max(0.01, p.mu.G) / Math.max(0.05, p.mu.SOG))),
        wA: Float64Array.from(P.map((p) => Math.max(0.005, p.mu.A))),
        ppShare: Float64Array.from(P.map((p) => Math.min(0.95, Math.max(0, p.mu.PPP) / Math.max(0.05, p.mu.PTS)))),
        wPP: Float64Array.from(P.map((p) => Math.max(0.002, p.mu.PPP))),
        muH: Float64Array.from(P.map((p) => p.mu.HIT)), muB: Float64Array.from(P.map((p) => p.mu.BLK)),
        q: Math.min(0.3, t.muG / t.muS)
      };
    });
  }

  function pick(rng, w, n, excl, excl2) {
    let tot = 0;
    for (let i = 0; i < n; i++) if (i !== excl && i !== excl2) tot += w[i];
    let x = rng.next() * tot;
    for (let i = 0; i < n; i++) { if (i === excl || i === excl2) continue; x -= w[i]; if (x <= 0) return i; }
    for (let i = n - 1; i >= 0; i--) if (i !== excl && i !== excl2) return i;
    return -1;
  }

  /** Core simulation loop writing into `out` (Int16 arrays) for sims [s0, s1). */
  function runRange(T, prm, rng, out, s0, s1) {
    const nH = T[0].n, nA = T[1].n, NP = nH + nA;
    const sogTmp = [new Int16Array(nH), new Int16Array(nA)];
    const shotOwner = [new Int16Array(200), new Int16Array(200)];
    for (let s = s0; s < s1; s++) {
      const E = lnShock(rng, prm.sigE);
      const S = [0, 0], Gt = [0, 0], ppg = [0, 0];
      const base = s * NP;
      for (let t = 0; t < 2; t++) {
        const X = T[t], off = t === 0 ? 0 : nH;
        const O = lnShock(rng, prm.sigO), W = lnShock(rng, prm.sigW);
        const lam = X.t.muS * E * O;
        const St = Math.min(199, rng.poisson(lam));
        S[t] = St;
        // usage shocks → shot weights
        const w = new Float64Array(X.n); let tw = 0;
        for (let i = 0; i < X.n; i++) { w[i] = X.wS[i] * lnShock(rng, prm.sigZ); tw += w[i]; }
        const cum = new Float64Array(X.n); let c = 0;
        for (let i = 0; i < X.n; i++) { c += w[i] / tw; cum[i] = c; }
        sogTmp[t].fill(0);
        for (let k = 0; k < St; k++) {
          const r = rng.next(); let lo = 0, hi = X.n - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
          shotOwner[t][k] = lo; sogTmp[t][lo]++;
        }
        // goals: binomial thinning of team shots, assigned to specific shots
        const qt = Math.min(0.6, X.q * W * prm.gScale);
        let g = 0; for (let k = 0; k < St; k++) if (rng.next() < qt) g++;
        Gt[t] = g;
        const avail = new Uint8Array(St).fill(1);
        for (let k = 0; k < g; k++) {
          let tot = 0; for (let j = 0; j < St; j++) if (avail[j]) tot += X.fin[shotOwner[t][j]];
          let x = rng.next() * tot, jj = -1;
          for (let j = 0; j < St; j++) { if (!avail[j]) continue; x -= X.fin[shotOwner[t][j]]; if (x <= 0) { jj = j; break; } }
          if (jj < 0) { for (let j = St - 1; j >= 0; j--) if (avail[j]) { jj = j; break; } }
          avail[jj] = 0;
          const sc = shotOwner[t][jj];
          out.G[base + off + sc]++;
          const pp = rng.next() < Math.min(0.9, X.ppShare[sc] * prm.ppScale);
          if (pp) { out.PPP[base + off + sc]++; ppg[t]++; }
          const r = rng.next();
          const na = r < prm.assist[0] ? 0 : r < prm.assist[0] + prm.assist[1] ? 1 : 2;
          let a1 = -1;
          for (let a = 0; a < na && X.n > a + 1; a++) {
            const who = pick(rng, pp ? X.wPP : X.wA, X.n, sc, a1);
            if (who < 0) break;
            out.A[base + off + who]++;
            if (pp) out.PPP[base + off + who]++;
            a1 = who;
          }
        }
        for (let i = 0; i < X.n; i++) out.SOG[base + off + i] = sogTmp[t][i];
      }
      for (let t = 0; t < 2; t++) {
        const X = T[t], off = t === 0 ? 0 : nH, o = 1 - t;
        const shotRatio = Math.pow(S[o] / Math.max(1, T[o].t.muS), prm.blkK);
        const eH = Math.pow(E, 0.3);
        for (let i = 0; i < X.n; i++) {
          out.HIT[base + off + i] = rng.poisson(X.muH[i] * prm.hScale * eH * gammaMean1(rng, prm.alphaH));
          out.BLK[base + off + i] = rng.poisson(X.muB[i] * prm.bScale * shotRatio * gammaMean1(rng, prm.alphaB));
          out.PTS[base + off + i] = out.G[base + off + i] + out.A[base + off + i];
        }
      }
      out.S[s * 2] = S[0]; out.S[s * 2 + 1] = S[1]; out.GT[s * 2] = Gt[0]; out.GT[s * 2 + 1] = Gt[1];
      out.PPG[s * 2] = ppg[0]; out.PPG[s * 2 + 1] = ppg[1];
      out.E[s] = E;
      const gs = [0, 1].map((t) => { const gl = T[t].t.goalies || []; let x = rng.next(); for (let k = 0; k < gl.length; k++) { x -= gl[k].pStart; if (x <= 0) return k; } return gl.length ? 0 : -1; });
      out.GST[s * 2] = gs[0]; out.GST[s * 2 + 1] = gs[1];
    }
  }

  function alloc(n, NP) {
    const o = {};
    for (const k of STATS) o[k] = new Int16Array(n * NP);
    o.S = new Int16Array(n * 2); o.GT = new Int16Array(n * 2); o.PPG = new Int16Array(n * 2); o.GST = new Int8Array(n * 2); o.E = new Float32Array(n);
    return o;
  }

  function means(out, n, NP) {
    const m = {};
    for (const k of STATS) { const a = new Float64Array(NP); for (let s = 0; s < n; s++) for (let i = 0; i < NP; i++) a[i] += out[k][s * NP + i]; for (let i = 0; i < NP; i++) a[i] /= n; m[k] = a; }
    return m;
  }

  /**
   * Simulate a game. opts = { n, seed, params, reconcile:true, pilot:3000 }.
   * Returns a result object with masks/joint helpers.
   */
  joint.simulate = (game, opts) => {
    opts = opts || {};
    const prm = Object.assign({ sigE: 0.08, sigO: 0.08, sigW: 0.15, sigZ: 0.25, assist: [0.06, 0.28, 0.66], alphaH: 0.35, alphaB: 0.3, blkK: 0.8, gScale: 1, ppScale: 1, hScale: 1, bScale: 1 }, opts.params || {});
    const T = prep(game);
    const NP = T[0].n + T[1].n;
    const all = [...game.home.players, ...game.away.players];
    const rng = new NQ.Rng(opts.seed || NQ.hashSeed('joint:' + game.game_id));
    const recon = [];
    if (opts.reconcile !== false) {
      // pilot runs: rescale weights so simulated marginal means track ML means
      for (let it = 0; it < 3; it++) {
        const np = opts.pilot || 3000;
        const pilot = alloc(np, NP);
        runRange(T, prm, rng, pilot, 0, np);
        const m = means(pilot, np, NP);
        let dev = 0;
        for (let t = 0; t < 2; t++) {
          const X = T[t], off = t === 0 ? 0 : T[0].n;
          let gSim = 0, gMl = 0, pSim = 0, pMl = 0;
          for (let i = 0; i < X.n; i++) {
            const mu = all[off + i].mu, k = off + i;
            const f = (num, den) => (den > 0.02 ? Math.min(3, Math.max(0.33, num / den)) : 1);
            X.fin[i] *= f(mu.G, m.G[k]); X.wA[i] *= f(mu.A, m.A[k]); X.wPP[i] *= f(mu.PPP, m.PPP[k]);
            X.muH[i] *= f(mu.HIT, m.HIT[k]); X.muB[i] *= f(mu.BLK, m.BLK[k]);
            gSim += m.G[k]; gMl += mu.G; pSim += m.PPP[k]; pMl += mu.PPP;
            dev += Math.abs(m.SOG[k] - mu.SOG) + Math.abs(m.G[k] - mu.G) + Math.abs(m.A[k] - mu.A);
          }
          void gSim; void gMl; void pSim; void pMl;
        }
        recon.push(dev / NP);
      }
    }
    const n = opts.n || 20000;
    const out = alloc(n, NP);
    runRange(T, prm, rng, out, 0, n);
    const idx = {}; all.forEach((p, i) => { idx[p.id] = i; });
    const gIdx = {};
    [game.home, game.away].forEach((t, side) => (t.goalies || []).forEach((g, k) => { gIdx[g.id] = { side, k }; }));
    return { game, n, NP, out, idx, gIdx, players: all, recon, params: prm };
  };

  /** Mask of sims where a leg settles as a WIN. Goalie legs are conditional on start (mask also returns valid). */
  joint.legMask = (R, leg) => {
    const m = new Uint8Array(R.n), valid = new Uint8Array(R.n).fill(1);
    const thr = (v) => (leg.side === 'over' ? v > leg.line : v < leg.line);
    if (leg.stat === 'SV') {
      const g = R.gIdx[leg.player_id];
      if (!g) return { m, valid: new Uint8Array(R.n) };
      const o = 1 - g.side;
      for (let s = 0; s < R.n; s++) {
        if (R.out.GST[s * 2 + g.side] !== g.k) { valid[s] = 0; continue; }
        m[s] = thr(R.out.S[s * 2 + o] - R.out.GT[s * 2 + o]) ? 1 : 0;
      }
      return { m, valid };
    }
    const i = R.idx[leg.player_id];
    if (i === undefined) return { m, valid: new Uint8Array(R.n) };
    const a = R.out[leg.stat];
    for (let s = 0; s < R.n; s++) m[s] = thr(a[s * R.NP + i]) ? 1 : 0;
    return { m, valid };
  };

  /**
   * Joint evaluation of legs. Goalie legs require the goalie to start: sims
   * where any goalie leg is void are excluded (conditional-on-start pricing).
   */
  joint.evaluate = (R, legs, opts) => {
    opts = opts || {};
    const M = legs.map((l) => joint.legMask(R, l));
    let n = 0, hits = 0;
    const single = new Float64Array(legs.length), cnt = new Float64Array(legs.length);
    for (let s = 0; s < R.n; s++) {
      let ok = 1, v = 1;
      for (let j = 0; j < M.length; j++) { if (!M[j].valid[s]) { v = 0; break; } }
      if (!v) continue;
      n++;
      for (let j = 0; j < M.length; j++) { single[j] += M[j].m[s]; if (!M[j].m[s]) ok = 0; }
      hits += ok;
    }
    for (let j = 0; j < legs.length; j++) { cnt[j] = n; single[j] /= Math.max(1, n); }
    const p = n ? hits / n : 0;
    const indep = Array.from(single).reduce((a, b) => a * b, 1);
    const se = n ? Math.sqrt((p * (1 - p)) / n) : 1;
    const relErr = p > 0 ? se / p : Infinity;
    const minHits = opts.minHits || 50, maxRel = opts.maxRelErr || 0.15;
    const phi = M.map((A, x) => M.map((B, y) => {
      if (x === y) return 1;
      let ab = 0, nn = 0; for (let s = 0; s < R.n; s++) { if (!A.valid[s] || !B.valid[s]) continue; nn++; ab += A.m[s] & B.m[s]; }
      const pa = single[x], pb = single[y], pab = ab / Math.max(1, nn), den = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
      return den ? (pab - pa * pb) / den : 0;
    }));
    return { n, hits, p, indep, lift: indep > 0 ? p / indep : null, se, relErr, single: Array.from(single), phi,
      wilsonLower: NQ.cv.wilsonLower(hits, n), precisionOK: hits >= minHits && relErr <= maxRel };
  };

  /** Conditional game environment when the parlay hits vs all sims (scenario intelligence). */
  joint.scenario = (R, legs) => {
    const M = legs.map((l) => joint.legMask(R, l));
    const acc = (sel) => {
      let n = 0, sh = 0, gt = 0, ppg = 0, mg = 0, e = 0;
      for (let s = 0; s < R.n; s++) {
        if (!sel(s)) continue;
        n++; sh += R.out.S[2 * s] + R.out.S[2 * s + 1]; gt += R.out.GT[2 * s] + R.out.GT[2 * s + 1]; ppg += R.out.PPG[2 * s] + R.out.PPG[2 * s + 1];
        mg += R.out.GT[2 * s] - R.out.GT[2 * s + 1]; e += R.out.E[s];
      }
      return n ? { n, shots: sh / n, goals: gt / n, ppg: ppg / n, margin: mg / n, pace: e / n } : null;
    };
    const hit = (s) => M.every((x) => x.valid[s] && x.m[s]);
    return { all: acc(() => true), hit: acc(hit) };
  };

  /** Marginal P(stat ≥ k) for every player from a simulation (for display / pool). */
  joint.marginals = (R) => {
    const res = {};
    R.players.forEach((p, i) => {
      res[p.id] = {};
      for (const k of STATS) {
        const h = new Float64Array(16);
        for (let s = 0; s < R.n; s++) h[Math.min(15, R.out[k][s * R.NP + i])]++;
        for (let x = 0; x < 16; x++) h[x] /= R.n;
        let mean = 0; for (let x = 0; x < 16; x++) mean += x * h[x];
        res[p.id][k] = { h: Array.from(h), mean };
      }
    });
    return res;
  };

  NQ.joint = joint;
})(globalThis.NQ = globalThis.NQ || {});

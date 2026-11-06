/* ==========================================================================
 * NQ.predict — prediction engine.
 *
 *  1. quick*  — analytic layer: Poisson goal model on shrunk team rates.
 *               Powers factor explanations, standings xPts and the forward
 *               backtest (it is cheap enough to re-fit as-of every game).
 *  2. run     — Monte Carlo: N full event-level simulations through NQ.sim
 *               on the ESTIMATED league. Every player line, goalie line and
 *               team score in a given sim comes from the same events, so
 *               joint probabilities (same-game parlays) are coherent.
 *  3. sgp     — joint-probability evaluator over the stored sim outcomes.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const { S, G, T, NS, NG } = NQ.sim;

  // ------------------------------------------------------------ analytic layer
  // Prior strengths (tuned on the forward backtest): games for 5v5 rates and
  // special teams, shots for goaltending, xG for finishing.
  const SHRINK = { ev: 12, st: 30, gShots: 1500, fin: 600 };
  const gShrinkRaw = (sa, ga, xga) => ((xga - ga) * 100) / (sa + SHRINK.gShots);
  const gShrink = (gv) => { const sa = gv.gsa || 0; return gShrinkRaw(sa, gv.gga || 0, gv.gxga || 0); };

  function quickFromLambda(lh, la) {
    const N = 13;
    const ph = [], pa = [];
    for (let k = 0; k < N; k++) { ph.push(u.poissonPmf(k, Math.max(0.05, lh))); pa.push(u.poissonPmf(k, Math.max(0.05, la))); }
    let w = 0, t = 0, l = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = ph[i] * pa[j]; if (i > j) w += p; else if (i === j) t += p; else l += p; }
    const s = w + t + l; w /= s; t /= s; l /= s;
    const pOT = u.clamp(0.5 + 0.55 * (lh - la) / (lh + la), 0.25, 0.75);
    return { regWin: w, tie: t, regLoss: l, win: w + t * pOT, otl: t * (1 - pOT), loss: l, pOT };
  }

  /** Expected goals for each side from team rate inputs. Returns factors too. */
  function quickModel(h, a, ctx) {
    ctx = ctx || {};
    const lg = ctx.lg || { f5: 2.55, pp: 6.6, pk: 6.6, ppMin: 4.0 };
    const side = (x, y, home, restX, restY) => {
      let ev = ((x.f5 + y.a5) / 2) * (50.5 / 60);
      const pp = x.ppMin * ((x.pp + y.pk) / 2) / 60;
      const sh = 0.08 * (x.shMin / 4);
      let lam = ev + pp + sh;
      lam *= 1 - (y.gtal || 0) / 14;          // opposing goaltender (GSAx/100 talent)
      lam *= 1 + (x.fin || 0);                 // shrunk finishing above expected
      if (home) lam *= 1.03;
      if (restX <= 1) lam *= 0.955;
      if (restY <= 1) lam *= 1.03;
      return { lam: Math.max(0.6, lam), ev, pp };
    };
    const H = side(h, a, true, ctx.restH, ctx.restA), A = side(a, h, false, ctx.restA, ctx.restH);
    const out = quickFromLambda(H.lam, A.lam);
    out.lh = H.lam; out.la = A.lam;
    if (ctx.explain) {
      const base = out.win;
      const neutral = (o, k, v) => Object.assign({}, o, { [k]: v });
      const f = [];
      const test = (label, hh, aa, c2) => {
        const H2 = side(hh, aa, (c2 || ctx).home !== false, (c2 || ctx).restH, (c2 || ctx).restA);
        const A2 = side(aa, hh, false, (c2 || ctx).restA, (c2 || ctx).restH);
        f.push({ label, delta: base - quickFromLambda(H2.lam, A2.lam).win });
      };
      test('5v5 play driving (xGF/xGA per 60)', neutral(neutral(h, 'f5', lg.f5), 'a5', lg.f5), neutral(neutral(a, 'f5', lg.f5), 'a5', lg.f5));
      test('Special teams (PP vs PK)', neutral(neutral(h, 'pp', lg.pp), 'pk', lg.pk), neutral(neutral(a, 'pp', lg.pp), 'pk', lg.pk));
      test('Penalty volume (PP minutes)', neutral(neutral(h, 'ppMin', lg.ppMin), 'shMin', lg.ppMin), neutral(neutral(a, 'ppMin', lg.ppMin), 'shMin', lg.ppMin));
      test('Goaltending (shrunk GSAx/100)', neutral(h, 'gtal', 0), neutral(a, 'gtal', 0));
      test('Finishing talent', neutral(h, 'fin', 0), neutral(a, 'fin', 0));
      const hh = side(h, a, false, ctx.restH, ctx.restA), aa = side(a, h, false, ctx.restA, ctx.restH);
      f.push({ label: 'Home ice / last change', delta: base - quickFromLambda(hh.lam, aa.lam).win });
      const hr = side(h, a, true, 2, 2), ar = side(a, h, false, 2, 2);
      f.push({ label: 'Rest & schedule', delta: base - quickFromLambda(hr.lam, ar.lam).win });
      out.factors = f.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    }
    return out;
  }

  /** Team rate inputs from season metrics (shrunk) — used for explanations. */
  function teamInputs(state, teamId, starterPid) {
    const v = state.M.team[teamId].vals;
    const tr = state.season.team[teamId];
    const gp = tr.gp;
    const K = SHRINK;
    const lgF = state.M.LG.xga60;
    const shrink = (x, prior, k) => (x * gp + prior * (k || K.ev)) / (gp + (k || K.ev));
    const g = starterPid !== undefined ? state.M.goalie[starterPid].vals : null;
    const acc = tr.acc;
    return {
      f5: shrink(v.txgf60, lgF), a5: shrink(v.txga60, lgF),
      pp: shrink(v.tppx60, 6.6, K.st), pk: shrink(v.tpkx60, 6.6, K.st),
      ppMin: shrink((acc[T.PPTOI] / 60) / gp, 4.0, K.st), shMin: shrink((acc[T.PKTOI] / 60) / gp, 4.0, K.st),
      gtal: g ? gShrink(g) : 0, fin: u.clamp((acc[T.GF] - acc[T.XGF]) / (acc[T.XGF] + K.fin), -0.04, 0.04)
    };
  }

  // ------------------------------------------------------------ Monte Carlo
  const PST = ['G', 'A', 'PTS', 'SOG', 'BLK', 'HIT', 'PPP', 'FOW', 'TOI'];

  /**
   * Run N simulations. opts: { n, starterH:'auto'|18|19, starterA, scratches:Set,
   * restH, restA, seed, onProgress(frac), chunk }
   * Returns a Promise (browser) — use runSync for tests.
   */
  function prepare(state, homeId, awayId, opts) {
    const L = state.est.league;
    const th = L.teams[homeId], ta = L.teams[awayId];
    const g = state.season.upcoming.find((x) => x.home === homeId && x.away === awayId);
    const restH = opts.restH !== undefined ? opts.restH : g ? g.restH : 2;
    const restA = opts.restA !== undefined ? opts.restA : g ? g.restA : 2;
    const scr = opts.scratches || new Set();
    const mk = (team, home, rest, starter) => NQ.sim.buildTeamCtx(L, team, { home, rest, starter, scratches: scr });
    const ctx = {
      H: [mk(th, true, restH, 18), mk(th, true, restH, 19)],
      A: [mk(ta, false, restA, 18), mk(ta, false, restA, 19)],
      pH: opts.starterH === 18 ? 1 : opts.starterH === 19 ? 0 : NQ.season.starterProb(L, th, restH),
      pA: opts.starterA === 18 ? 1 : opts.starterA === 19 ? 0 : NQ.season.starterProb(L, ta, restA),
      restH, restA, th, ta
    };
    const n = opts.n || 4000;
    const store = {
      n, done: 0, hg: new Int8Array(n), ag: new Int8Array(n), type: new Int8Array(n), hs: new Int8Array(n), as: new Int8Array(n),
      gst: new Int8Array(n * 2),
      p: PST.reduce((o, k) => { o[k] = k === 'TOI' ? new Float32Array(n * 36) : new Int8Array(n * 36); return o; }, {}),
      gk: { SA: new Int8Array(n * 4), GA: new Int8Array(n * 4), TOI: new Float32Array(n * 4) },
      str: { h5: 0, hpp: 0, hsh: 0, hen: 0, a5: 0, app: 0, ash: 0, aen: 0, hxg: 0, axg: 0, hppo: 0, appo: 0 }
    };
    return { ctx, store, rng: new NQ.Rng(opts.seed || NQ.hashSeed('mc:' + homeId + ':' + awayId + ':' + (opts.tag || ''))) };
  }

  function step(job, count) {
    const { ctx, store, rng } = job;
    const end = Math.min(store.n, store.done + count);
    for (let i = store.done; i < end; i++) {
      const sh = rng.chance(ctx.pH) ? 0 : 1, sa = rng.chance(ctx.pA) ? 0 : 1;
      const r = NQ.sim.simulate(ctx.H[sh], ctx.A[sa], rng, {});
      store.hg[i] = r.hg; store.ag[i] = r.ag; store.type[i] = r.type === 'REG' ? 0 : r.type === 'OT' ? 1 : 2;
      store.hs[i] = r.ts[0][T.SF]; store.as[i] = r.ts[1][T.SF];
      store.gst[i * 2] = sh; store.gst[i * 2 + 1] = sa;
      for (let t = 0; t < 2; t++) {
        const b = r.box[t];
        for (let s = 0; s < 18; s++) {
          const o = s * NS, j = i * 36 + t * 18 + s;
          const g = b[o + S.G], a = b[o + S.A1] + b[o + S.A2];
          store.p.G[j] = g; store.p.A[j] = a; store.p.PTS[j] = g + a; store.p.SOG[j] = b[o + S.SOG];
          store.p.BLK[j] = b[o + S.BLK]; store.p.HIT[j] = b[o + S.HIT]; store.p.PPP[j] = b[o + S.PPG] + b[o + S.PPA];
          store.p.FOW[j] = b[o + S.FOW]; store.p.TOI[j] = b[o + S.TOI];
        }
        for (let gi = 0; gi < 2; gi++) {
          const j = i * 4 + t * 2 + gi;
          store.gk.SA[j] = r.gb[t][gi * NG + G.SA]; store.gk.GA[j] = r.gb[t][gi * NG + G.GA]; store.gk.TOI[j] = r.gb[t][gi * NG + G.TOI];
        }
      }
      const s0 = r.ts[0], s1 = r.ts[1], st = store.str;
      st.h5 += s0[T.GF5]; st.hpp += s0[T.PPGF]; st.hsh += s0[T.SHGF]; st.hen += s0[T.ENGF];
      st.a5 += s1[T.GF5]; st.app += s1[T.PPGF]; st.ash += s1[T.SHGF]; st.aen += s1[T.ENGF];
      st.hxg += s0[T.XGF]; st.axg += s1[T.XGF]; st.hppo += s0[T.PPO]; st.appo += s1[T.PPO];
    }
    store.done = end;
    return end >= store.n;
  }

  function runSync(state, homeId, awayId, opts) {
    const job = prepare(state, homeId, awayId, opts || {});
    step(job, job.store.n);
    return summarize(state, job);
  }

  function run(state, homeId, awayId, opts) {
    opts = opts || {};
    const job = prepare(state, homeId, awayId, opts);
    const chunk = opts.chunk || 300;
    return new Promise((resolve) => {
      const tick = () => {
        const done = step(job, chunk);
        if (opts.onProgress) opts.onProgress(job.store.done / job.store.n);
        if (done) resolve(summarize(state, job)); else setTimeout(tick, 0);
      };
      tick();
    });
  }

  // ------------------------------------------------------------ summaries
  function hist(arr, idx, n, stride, max) {
    const h = new Float64Array(max + 1);
    for (let i = 0; i < n; i++) { const v = arr[i * stride + idx]; h[v > max ? max : v < 0 ? 0 : v]++; }
    for (let k = 0; k <= max; k++) h[k] /= n;
    return h;
  }
  const ge = (h, k) => { let s = 0; for (let i = k; i < h.length; i++) s += h[i]; return s; };
  const qOf = (h, q) => { let s = 0; for (let i = 0; i < h.length; i++) { s += h[i]; if (s >= q) return i; } return h.length - 1; };
  const meanOf = (h) => { let s = 0; for (let i = 0; i < h.length; i++) s += i * h[i]; return s; };

  function summarize(state, job) {
    const { store, ctx } = job;
    const n = store.n;
    let hw = 0, aw = 0, ot = 0, so = 0, hReg = 0, aReg = 0, hOT = 0, aOT = 0, hSO = 0, aSO = 0, hsh = 0, ash = 0;
    const score = Array.from({ length: 9 }, () => new Float64Array(9));
    const tot = new Float64Array(16);
    const hgH = new Float64Array(11), agH = new Float64Array(11), hsH = new Float64Array(61), asH = new Float64Array(61);
    for (let i = 0; i < n; i++) {
      const h = store.hg[i], a = store.ag[i], ty = store.type[i];
      if (h > a) { hw++; if (ty === 0) hReg++; else if (ty === 1) hOT++; else hSO++; } else { aw++; if (ty === 0) aReg++; else if (ty === 1) aOT++; else aSO++; }
      if (ty >= 1) ot++; if (ty === 2) so++;
      if (a === 0) hsh++; if (h === 0) ash++;
      score[Math.min(8, h)][Math.min(8, a)]++;
      tot[Math.min(15, h + a)]++;
      hgH[Math.min(10, h)]++; agH[Math.min(10, a)]++;
      hsH[Math.min(60, store.hs[i])]++; asH[Math.min(60, store.as[i])]++;
    }
    const nz = (x) => x / n;
    score.forEach((r) => { for (let j = 0; j < 9; j++) r[j] /= n; });
    for (const h of [tot, hgH, agH, hsH, asH]) for (let k = 0; k < h.length; k++) h[k] /= n;
    const st = store.str;
    const team = (side, gH, sH) => ({
      mean: meanOf(gH), lo: qOf(gH, 0.05), hi: qOf(gH, 0.95), dist: Array.from(gH), sog: meanOf(sH), sogLo: qOf(sH, 0.05), sogHi: qOf(sH, 0.95), sogDist: Array.from(sH),
      g5: (side ? st.a5 : st.h5) / n, gpp: (side ? st.app : st.hpp) / n, gsh: (side ? st.ash : st.hsh) / n, gen: (side ? st.aen : st.hen) / n,
      xg: (side ? st.axg : st.hxg) / n, ppo: (side ? st.appo : st.hppo) / n
    });
    const L = state.est.league;
    const players = [];
    [ctx.th, ctx.ta].forEach((tm, t) => {
      for (let s = 0; s < 18; s++) {
        const idx = t * 18 + s;
        const pid = tm.roster[s];
        const scratched = ctx.H[0].P[s] && (t === 0 ? ctx.H[0].P[s] : ctx.A[0].P[s]).replacement;
        const row = { pid, t, slot: s, scratched: !!scratched };
        for (const k of PST) {
          if (k === 'TOI') { let sum = 0; for (let i = 0; i < n; i++) sum += store.p.TOI[i * 36 + idx]; row.TOI = sum / n; continue; }
          const h = hist(store.p[k], idx, n, 36, 12);
          row[k] = { mean: meanOf(h), dist: Array.from(h), lo: qOf(h, 0.05), hi: qOf(h, 0.95), med: qOf(h, 0.5), ge: (j) => ge(h, j) };
        }
        players.push(row);
      }
    });
    const goalies = [];
    [ctx.th, ctx.ta].forEach((tm, t) => {
      for (let gi = 0; gi < 2; gi++) {
        const pid = tm.roster[18 + gi];
        let starts = 0, sa = 0, ga = 0, so2 = 0, win = 0;
        const gaH = new Float64Array(8), svH = new Float64Array(61);
        for (let i = 0; i < n; i++) {
          if (store.gst[i * 2 + t] !== gi) continue;
          starts++;
          const j = i * 4 + t * 2 + gi;
          const s = store.gk.SA[j], g = store.gk.GA[j];
          sa += s; ga += g;
          gaH[Math.min(7, g)]++; svH[Math.min(60, Math.max(0, s - g))]++;
          const h = store.hg[i], a = store.ag[i];
          const won = t === 0 ? h > a : a > h;
          if (won) win++;
          if (won && g === 0 && store.gk.TOI[j] > 3300) so2++;
        }
        if (!starts) { goalies.push({ pid, t, pStart: 0 }); continue; }
        for (let k = 0; k < gaH.length; k++) gaH[k] /= starts;
        for (let k = 0; k < svH.length; k++) svH[k] /= starts;
        goalies.push({ pid, t, pStart: starts / n, sa: sa / starts, ga: ga / starts, sv: (sa - ga) / starts, svPct: sa ? 1 - ga / sa : null, gaDist: Array.from(gaH), svDist: Array.from(svH), svLo: qOf(svH, 0.05), svHi: qOf(svH, 0.95), shutout: so2 / starts, win: win / starts });
      }
    });
    const res = {
      homeId: ctx.th.id, awayId: ctx.ta.id, n, restH: ctx.restH, restA: ctx.restA,
      winH: nz(hw), winA: nz(aw), pOT: nz(ot), pSO: nz(so), regH: nz(hReg), regA: nz(aReg), otH: nz(hOT), otA: nz(aOT), soH: nz(hSO), soA: nz(aSO),
      regTie: nz(ot), shutH: nz(hsh), shutA: nz(ash), score, total: Array.from(tot), home: team(0, hgH, hsH), away: team(1, agH, asH),
      players, goalies, store, L
    };
    // modal exact score
    let best = [0, 0, 0];
    score.forEach((r, i) => r.forEach((p, j) => { if (p > best[2]) best = [i, j, p]; }));
    res.modal = best;
    res.totalMean = res.home.mean + res.away.mean;
    return res;
  }

  // ------------------------------------------------------------ SGP evaluator
  /**
   * leg = { kind:'win'|'reg'|'ot'|'total'|'ttotal'|'player'|'goalie', side:0|1,
   *         op:'over'|'under', line:number, pid, stat:'G'|'A'|'PTS'|'SOG'|'BLK'|'HIT'|'PPP'|'SV'|'SO' , k }
   */
  function legMask(res, leg) {
    const s = res.store, n = s.n, m = new Uint8Array(n);
    const pIdx = (pid) => res.players.findIndex((p) => p.pid === pid);
    for (let i = 0; i < n; i++) {
      const h = s.hg[i], a = s.ag[i];
      let ok = false;
      switch (leg.kind) {
        case 'win': ok = leg.side === 0 ? h > a : a > h; break;
        case 'reg': ok = s.type[i] === 0 && (leg.side === 0 ? h > a : a > h); break;
        case 'ot': ok = s.type[i] >= 1; break;
        case 'total': ok = leg.op === 'over' ? h + a > leg.line : h + a < leg.line; break;
        case 'ttotal': { const x = leg.side === 0 ? h : a; ok = leg.op === 'over' ? x > leg.line : x < leg.line; break; }
        case 'player': { const j = i * 36 + pIdx(leg.pid); const v = s.p[leg.stat][j]; ok = v >= leg.k; break; }
        case 'goalie': {
          const g = res.goalies.find((x) => x.pid === leg.pid);
          const gi = res.L.teams[g.t === 0 ? res.homeId : res.awayId].roster.indexOf(leg.pid) - 18;
          if (s.gst[i * 2 + g.t] !== gi) { ok = false; break; }
          const j = i * 4 + g.t * 2 + gi;
          if (leg.stat === 'SV') ok = s.gk.SA[j] - s.gk.GA[j] >= leg.k;
          else if (leg.stat === 'SO') ok = s.gk.GA[j] === 0 && (g.t === 0 ? h > a : a > h);
          break;
        }
        default: ok = false;
      }
      m[i] = ok ? 1 : 0;
    }
    return m;
  }

  function sgp(res, legs) {
    if (!legs.length) return null;
    const masks = legs.map((l) => legMask(res, l));
    const n = res.store.n;
    const single = masks.map((m) => { let c = 0; for (let i = 0; i < n; i++) c += m[i]; return c / n; });
    let j = 0;
    for (let i = 0; i < n; i++) { let ok = 1; for (const m of masks) if (!m[i]) { ok = 0; break; } j += ok; }
    const joint = j / n;
    const indep = single.reduce((p, x) => p * x, 1);
    // pairwise correlation (phi) for the leg matrix
    const phi = masks.map((a, x) => masks.map((b, y) => {
      if (x === y) return 1;
      let ab = 0; for (let i = 0; i < n; i++) ab += a[i] & b[i];
      const pa = single[x], pb = single[y], pab = ab / n;
      const den = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
      return den ? (pab - pa * pb) / den : 0;
    }));
    const se = Math.sqrt((joint * (1 - joint)) / n);
    return { single, joint, indep, lift: indep ? joint / indep : null, phi, se };
  }

  const toAmerican = (p) => (p <= 0 ? null : p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
  const fromAmerican = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  const decimalOf = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);

  NQ.predict = { SHRINK, gShrinkRaw, quickFromLambda, quickModel, teamInputs, run, runSync, sgp, legMask, toAmerican, fromAmerican, decimalOf, PST };
})(globalThis.NQ = globalThis.NQ || {});

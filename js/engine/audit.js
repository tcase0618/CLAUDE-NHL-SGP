/* ==========================================================================
 * NQ.audit — forward-only backtests, calibration, data-quality checks.
 *
 * Backtest discipline: every game is predicted using ONLY information
 * available before puck drop (rolling team aggregates updated after each
 * game, chronological order). Confirmed starters are assumed known.
 * Complex models are always compared with simple baselines.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const { S, G, T } = NQ.sim;

  function gameBacktest(league, season) {
    const n = league.teams.length;
    const z = () => ({ gp: 0, xgf5: 0, xga5: 0, toi5: 0, ppx: 0, ppt: 0, pkx: 0, pkt: 0, gf: 0, ga: 0, xgf: 0, pts: 0, gf5: 0, ga5: 0 });
    const A = Array.from({ length: n }, z);
    const gAcc = {}; // goalie as-of: sa, ga, xga
    const logIdx = league.teams.map(() => 0);
    const rows = [];
    let homeW = 0, gamesSeen = 0;
    const lgF = 2.55;
    const inputs = (a, gid) => {
      const K = NQ.predict.SHRINK, gp = a.gp;
      const sh = (x, p, k) => (x * gp + p * (k || K.ev)) / (gp + (k || K.ev));
      const g = gAcc[gid] || { sa: 0, ga: 0, xga: 0 };
      return {
        f5: sh(a.toi5 ? (a.xgf5 * 3600) / a.toi5 : lgF, lgF), a5: sh(a.toi5 ? (a.xga5 * 3600) / a.toi5 : lgF, lgF),
        pp: sh(a.ppt ? (a.ppx * 3600) / a.ppt : 6.6, 6.6, K.st), pk: sh(a.pkt ? (a.pkx * 3600) / a.pkt : 6.6, 6.6, K.st),
        ppMin: sh(gp ? a.ppt / 60 / gp : 4, 4, K.st), shMin: sh(gp ? a.pkt / 60 / gp : 4, 4, K.st),
        gtal: NQ.predict.gShrinkRaw(g.sa, g.ga, g.xga), fin: u.clamp((a.gf - a.xgf) / (a.xgf + K.fin), -0.04, 0.04)
      };
    };
    for (const g of season.played) {
      const h = A[g.home], a = A[g.away];
      const lh = season.team[g.home].log[logIdx[g.home]], la = season.team[g.away].log[logIdx[g.away]];
      if (h.gp >= 5 && a.gp >= 5) {
        const hi = inputs(h, g.starterH), ai = inputs(a, g.starterA);
        const q = NQ.predict.quickModel(hi, ai, { restH: g.restH, restA: g.restA });
        const ptsH = (h.pts + 20) / (2 * h.gp + 40), ptsA = (a.pts + 20) / (2 * a.gp + 40); // shrunk to .500
        const log5 = (ptsH * (1 - ptsA)) / (ptsH * (1 - ptsA) + ptsA * (1 - ptsH));
        rows.push({
          gid: g.id, p: q.win, lh: q.lh, la: q.la, y: g.hg > g.ag ? 1 : 0, total: g.hg + g.ag, hg: g.hg, ag: g.ag,
          pHome: gamesSeen ? homeW / gamesSeen : 0.53, pPts: u.clamp(0.04 + log5 * 0.92, 0.05, 0.95),
          x: [hi.f5 - hi.a5 - (ai.f5 - ai.a5), (hi.pp - hi.pk) - (ai.pp - ai.pk), hi.gtal - ai.gtal, 1, (g.restH <= 1 ? -1 : 0) - (g.restA <= 1 ? -1 : 0), ptsH - ptsA,
            (h.gf - h.xgf) / h.gp - (a.gf - a.xgf) / a.gp]
        });
      }
      // update as-of aggregates with this game's results
      for (const [team, L] of [[h, lh], [a, la]]) {
        team.gp++; team.xgf5 += L.xgf5; team.xga5 += L.xga5; team.toi5 += L.toi5; team.ppx += L.ppxg; team.ppt += L.pptoi;
        team.pkx += L.pkxga; team.pkt += L.pktoi; team.gf += L.gf; team.ga += L.ga; team.xgf += L.xgf;
        team.pts += L.r === 'W' ? 2 : L.r === 'OTL' ? 1 : 0; team.gf5 += L.g5f; team.ga5 += L.g5a;
      }
      logIdx[g.home]++; logIdx[g.away]++;
      // goalie as-of from the goalie logs of this game
      for (const pid of [league.teams[g.home].roster[18], league.teams[g.home].roster[19], league.teams[g.away].roster[18], league.teams[g.away].roster[19]]) {
        const e = season.plog[pid].find((x) => x.gid === g.id);
        if (!e) continue;
        const o = gAcc[pid] || (gAcc[pid] = { sa: 0, ga: 0, xga: 0 });
        o.sa += e.sa; o.ga += e.ga; o.xga += e.xga;
      }
      homeW += g.hg > g.ag ? 1 : 0; gamesSeen++;
    }
    return rows;
  }

  function scores(rows, key) {
    let b = 0, ll = 0, acc = 0;
    for (const r of rows) {
      const p = u.clamp(r[key], 0.01, 0.99);
      b += (p - r.y) ** 2; ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); acc += (p >= 0.5) === (r.y === 1) ? 1 : 0;
    }
    const n = rows.length || 1;
    return { brier: b / n, logloss: ll / n, acc: acc / n };
  }

  function calibration(rows, key, bins) {
    bins = bins || 10;
    const out = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
    for (const r of rows) { const i = Math.min(bins - 1, Math.floor(r[key] * bins)); out[i].n++; out[i].p += r[key]; out[i].y += r.y; }
    return out.filter((b) => b.n > 0).map((b) => ({ n: b.n, pred: b.p / b.n, obs: b.y / b.n }));
  }

  /** Least-squares fit of observed on predicted across calibration bins. */
  function calFit(cal) {
    const xs = cal.map((c) => c.pred), ys = cal.map((c) => c.obs), ws = cal.map((c) => c.n);
    const W = u.sum(ws), mx = u.sum(xs.map((x, i) => x * ws[i])) / W, my = u.sum(ys.map((y, i) => y * ws[i])) / W;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += ws[i] * (x - mx) * (ys[i] - my); den += ws[i] * (x - mx) ** 2; });
    const slope = den ? num / den : 1;
    return { slope, intercept: my - slope * mx };
  }

  function bootstrapBrier(rows, key, B) {
    const rng = new NQ.Rng('boot:' + key);
    const out = [];
    for (let b = 0; b < (B || 300); b++) {
      let s = 0;
      for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rng.next() * rows.length)]; s += (u.clamp(r[key], 0.01, 0.99) - r.y) ** 2; }
      out.push(s / rows.length);
    }
    return [u.quantile(out, 0.05), u.quantile(out, 0.95)];
  }

  /** Logistic regression (gradient descent) for feature importance. */
  function logit(rows, names) {
    const k = rows[0].x.length;
    const mean = new Array(k).fill(0), sd = new Array(k).fill(1);
    for (let j = 0; j < k; j++) {
      const v = rows.map((r) => r.x[j]); mean[j] = u.mean(v); sd[j] = u.sd(v) || 1;
      if (j === 3) { mean[j] = 0; sd[j] = 1; }
    }
    const X = rows.map((r) => r.x.map((v, j) => (j === 3 ? 1 : (v - mean[j]) / sd[j])));
    const w = new Array(k).fill(0);
    for (let it = 0; it < 600; it++) {
      const gr = new Array(k).fill(0);
      for (let i = 0; i < X.length; i++) {
        let z = 0; for (let j = 0; j < k; j++) z += w[j] * X[i][j];
        const e = u.logistic(z) - rows[i].y;
        for (let j = 0; j < k; j++) gr[j] += e * X[i][j];
      }
      for (let j = 0; j < k; j++) w[j] -= (0.8 * gr[j]) / X.length + 0.002 * (j === 3 ? 0 : w[j]);
    }
    return names.map((n, j) => ({ name: n, beta: w[j], intercept: j === 3 })).filter((x) => !x.intercept).sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta));
  }

  function playerBacktest(league, season) {
    let sogAE = 0, sogBias = 0, nS = 0, ptsB = 0, gB = 0, n = 0, sog3B = 0, toiAE = 0;
    const cal = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
    for (const p of league.players) {
      if (p.isG) continue;
      const log = season.plog[p.id];
      let sog = 0, toi = 0, pts = 0, g = 0, ixg = 0;
      log.forEach((e, i) => {
        if (i >= 8) {
          const eToi = toi / i;
          const sRate = (sog + 10 * (p.isD ? 0.045 : 0.07)) / (toi / 60 + 10);
          const eSog = sRate * eToi / 60;
          const pRate = (pts + 10 * (p.isD ? 0.02 : 0.035)) / (toi / 60 + 10);
          const gRate = (0.6 * g + 0.4 * ixg + 10 * (p.isD ? 0.006 : 0.017)) / (toi / 60 + 10);
          const pP = 1 - Math.exp(-pRate * eToi / 60), pG = 1 - Math.exp(-gRate * eToi / 60);
          const p3 = 1 - [0, 1, 2].reduce((s, k) => s + u.poissonPmf(k, eSog), 0);
          sogAE += Math.abs(eSog - e.sog); sogBias += eSog - e.sog; nS++;
          toiAE += Math.abs(eToi - e.toi);
          ptsB += (pP - (e.g + e.a > 0 ? 1 : 0)) ** 2; gB += (pG - (e.g > 0 ? 1 : 0)) ** 2;
          sog3B += (p3 - (e.sog >= 3 ? 1 : 0)) ** 2; n++;
          const bi = Math.min(9, Math.floor(pP * 10)); cal[bi].n++; cal[bi].p += pP; cal[bi].y += e.g + e.a > 0 ? 1 : 0;
        }
        sog += e.sog; toi += e.toi; pts += e.g + e.a; g += e.g; ixg += e.ixg;
      });
    }
    return { n, sogMAE: sogAE / nS, sogBias: sogBias / nS, toiMAE: toiAE / nS, ptsBrier: ptsB / n, gBrier: gB / n, sog3Brier: sog3B / n, ptsCal: cal.filter((c) => c.n).map((c) => ({ n: c.n, pred: c.p / c.n, obs: c.y / c.n })) };
  }

  function goalieBacktest(league, season) {
    let ae = 0, n = 0, gaLL = 0;
    for (const p of league.players) {
      if (!p.isG) continue;
      const log = season.plog[p.id];
      let sa = 0, ga = 0, xga = 0, k = 0;
      for (const e of log) {
        if (e.start && k >= 4) {
          const eSA = sa / k, svp = 1 - (ga + 0.1 * 300) / (sa + 300);
          const eSv = eSA * svp;
          ae += Math.abs(eSv - (e.sa - e.ga)); n++;
          gaLL += -Math.log(Math.max(1e-6, u.poissonPmf(e.ga, eSA * (1 - svp))));
        }
        if (e.start) { sa += e.sa; ga += e.ga; xga += e.xga; k++; }
      }
    }
    return { n, savesMAE: ae / n, gaLogScore: gaLL / n };
  }

  function xgDiagnostics(season) {
    const sh = season.shots.filter((s) => s.r !== 3 && s.g >= 0);
    const bins = Array.from({ length: 12 }, () => ({ n: 0, xg: 0, g: 0 }));
    const edges = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.32, 0.45, 1.01];
    let ll = 0, llBase = 0, goals = 0;
    for (const s of sh) goals += s.r === 2 ? 1 : 0;
    const base = goals / sh.length;
    for (const s of sh) {
      let i = 0; while (s.xg >= edges[i + 1]) i++;
      bins[i].n++; bins[i].xg += s.xg; bins[i].g += s.r === 2 ? 1 : 0;
      const y = s.r === 2 ? 1 : 0, p = u.clamp(s.xg, 1e-4, 0.999);
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      llBase += -(y * Math.log(base) + (1 - y) * Math.log(1 - base));
    }
    // AUC via rank-sum
    const sorted = sh.map((s) => [s.xg, s.r === 2 ? 1 : 0]).sort((a, b) => a[0] - b[0]);
    let rankSum = 0, pos = 0;
    sorted.forEach((x, i) => { if (x[1]) { rankSum += i + 1; pos++; } });
    const neg = sorted.length - pos;
    const auc = (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
    return { n: sh.length, goals, base, ll: ll / sh.length, llBase: llBase / sh.length, auc, bins: bins.filter((b) => b.n).map((b) => ({ n: b.n, pred: b.xg / b.n, obs: b.g / b.n })) };
  }

  /** Internal-consistency checks: the identities the simulator guarantees. */
  function dataQuality(league, season) {
    const checks = [];
    const add = (name, pass, detail) => checks.push({ name, pass, detail });
    let gMis = 0, aMis = 0, gaMis = 0, ptsMis = 0, nan = 0;
    for (const t of league.teams) {
      const tr = season.team[t.id];
      let g = 0, a1 = 0, a2 = 0;
      t.roster.slice(0, 18).forEach((pid) => { const a = season.sk[pid]; g += a[S.G]; a1 += a[S.A1]; a2 += a[S.A2]; a.forEach((v, k) => { if (!isFinite(v) || (v < 0 && k !== S.QOC && k !== S.QOT)) nan++; }); });
      if (Math.abs(g - tr.acc[T.GF]) > 1e-9) gMis++;
      if (a1 > g || a2 > a1) aMis++;
      const gga = season.gk[t.roster[18]][G.GA] + season.gk[t.roster[19]][G.GA];
      if (Math.abs(gga + tr.acc[T.ENGA] - tr.acc[T.GA]) > 1e-9) gaMis++;
      if (tr.pts !== 2 * tr.w + tr.otl) ptsMis++;
    }
    add('Σ skater goals = team goals (excl. SO)', gMis === 0, `${32 - gMis}/32 teams reconcile`);
    add('A1 ≤ goals and A2 ≤ A1', aMis === 0, `${32 - aMis}/32 teams pass`);
    add('Σ goalie GA + empty-net GA = team GA', gaMis === 0, `${32 - gaMis}/32 teams reconcile`);
    add('Standings points = 2·W + OTL', ptsMis === 0, `${32 - ptsMis}/32 teams pass`);
    let scoreMis = 0;
    const tlog = league.teams.map((t) => season.team[t.id].log);
    const idx = league.teams.map(() => 0);
    for (const g of season.played) {
      const lh = tlog[g.home][idx[g.home]++]; idx[g.away]++;
      if (lh.gf !== g.hg) scoreMis++;
    }
    add('Final score = goals + shootout winner', scoreMis === 0, `${season.played.length - scoreMis}/${season.played.length} games`);
    let cf = 0; season.team.forEach((t) => { cf += t.acc[T.CF]; });
    add('Shot-event table = Σ team shot attempts', cf === season.shots.length, `${season.shots.length.toLocaleString()} events / ${cf.toLocaleString()} attempts`);
    let toi = 0, gameSec = 0;
    league.players.forEach((p) => { if (!p.isG) toi += season.sk[p.id][S.TOI]; });
    season.played.forEach((g) => { gameSec += 3600 + (g.type !== 'REG' ? 300 : 0); });
    const ratio = toi / (2 * gameSec);
    add('Skater TOI ≈ 5 skaters × game clock', ratio > 4.6 && ratio < 5.3, `${ratio.toFixed(2)} skaters on ice on average`);
    add('No negative / non-finite counting stats', nan === 0, nan ? `${nan} bad values` : 'all finite & non-negative');
    let svMis = 0;
    league.players.forEach((p) => { if (p.isG) { const a = season.gk[p.id]; if (a[G.GA] > a[G.SA]) svMis++; } });
    add('Goalie GA ≤ SA (saves = SA − GA ≥ 0)', svMis === 0, `${64 - svMis}/64 goalies pass`);
    return checks;
  }

  function run(league, season) {
    const rows = gameBacktest(league, season);
    const model = scores(rows, 'p'), home = scores(rows, 'pHome'), pts = scores(rows, 'pPts');
    const coin = { brier: 0.25, logloss: Math.log(2), acc: rows.filter((r) => r.y === 1).length / rows.length };
    const cal = calibration(rows, 'p', 20);
    const fit = calFit(cal);
    // totals: MAE + 90% Poisson interval coverage
    let tae = 0, cover = 0, ll = 0;
    for (const r of rows) {
      const lam = r.lh + r.la;
      tae += Math.abs(lam - r.total);
      let c = 0, lo = 0, hi = 0;
      for (let k = 0; k < 20; k++) { c += u.poissonPmf(k, lam); if (c < 0.05) lo = k + 1; if (c < 0.95) hi = k + 1; }
      if (r.total >= lo && r.total <= hi) cover++;
      ll += -Math.log(Math.max(1e-9, u.poissonPmf(r.hg, r.lh) * u.poissonPmf(r.ag, r.la)));
    }
    const fi = logit(rows, ['5v5 xG differential', 'Special-teams differential', 'Goaltending (GSAx talent)', 'Home ice', 'Rest differential', 'Points % differential', 'Finishing-luck differential']);
    return {
      n: rows.length, rows, model, home, pts, coin, cal, fit, ci: bootstrapBrier(rows, 'p', 300),
      totals: { mae: tae / rows.length, cover: cover / rows.length, scoreLL: ll / rows.length },
      importance: fi, players: playerBacktest(league, season), goalies: goalieBacktest(league, season),
      xg: xgDiagnostics(season), quality: dataQuality(league, season)
    };
  }

  NQ.audit = { run };
})(globalThis.NQ = globalThis.NQ || {});

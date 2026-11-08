#!/usr/bin/env node
/* ==========================================================================
 * Historical joint-probability validation for 3 / 5 / 8-leg SGPs on REAL
 * held-out NHL games (data/build/test_games.json, produced by ml/export.py
 * from pregame champion predictions — no postgame information).
 *
 *   FIT window  (2026-03-01 .. 2026-06-30): fits the joint lower-bound tables
 *   EVAL window (2026-07-01 ..)            : reports coverage of those bounds
 *
 * Two candidate streams per game and size:
 *   random   — uniformly sampled valid combinations (unbiased calibration)
 *   searched — beam-search finalists per ideology family (selection-biased,
 *              i.e. what the product actually surfaces), scored on an
 *              independent re-simulation
 * Compared against the naive independence product. No sportsbook prices are
 * involved: historical SGP quotes are not available, so NO historical CV%
 * or return is claimed here.
 *
 * Usage: node pipeline/validate_sgp.js [--sims 4000] [--games 0 (all)]
 * ========================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/odds.js', 'js/engine/jointsim.js', 'js/engine/sgp.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const SIMS = arg('--sims', 4000), MAXG = arg('--games', 0), RANDOM_PER = arg('--random', 6);
const SPLIT = Date.parse('2026-07-01T00:00:00Z');

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/build/test_games.json'), 'utf8'));
let games = data.games;
if (MAXG) games = games.filter((_, i) => i % Math.ceil(games.length / MAXG) === 0);
const FS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/build/final_scores.json'), 'utf8'));
const sarg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const CAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/sim_calibration.json'), 'utf8')).params;
const params = Object.assign({}, data.params, CAL, { otHome: FS.otHome });
if (sarg('--sigE') !== null) params.sigE = +sarg('--sigE');   // pace-shock sweep
const OUTF = sarg('--out');                                  // write a side report instead of the live artifact

function realised(game, leg) {
  if (NQ.joint.TEAM_STATS.includes(leg.stat)) {
    const f = FS.scores[String(game.game_id)];
    if (!f) return null;
    const mine = leg.team === 0 ? f.home : f.away, theirs = leg.team === 0 ? f.away : f.home;
    if (leg.stat === 'ML') return mine > theirs ? 1 : 0;
    if (leg.stat === 'PL') return mine - theirs + leg.line > 0 ? 1 : 0;
    const v = leg.stat === 'TT' ? mine : f.home + f.away;
    return (leg.side === 'over' ? v > leg.line : v < leg.line) ? 1 : 0;
  }
  if (leg.stat === 'SV') {
    for (const s of ['home', 'away']) for (const g of game[s].goalies) if (g.id === leg.player_id) return g.y && g.y.started ? (g.y.SV > leg.line ? 1 : 0) : null;
    return null;
  }
  for (const s of ['home', 'away']) for (const p of game[s].players) if (p.id === leg.player_id) { const v = p.y[leg.stat]; return v === null || v === undefined ? null : (v > leg.line ? 1 : 0); }
  return null;
}

const rows = [], teamRows = [];
const t0 = Date.now();
let simSeconds = 0, evaluated = 0;
games.forEach((g, gi) => {
  const s0 = Date.now();
  const R = NQ.joint.simulate(g, { n: SIMS, seed: 1000 + gi, params, pilot: 1200 });
  const F = NQ.joint.simulate(g, { n: SIMS, seed: 900000 + gi, params, pilot: 1200 });
  simSeconds += (Date.now() - s0) / 1000;
  const P = NQ.sgp.pool(R, g);
  const win = Date.parse(g.start_utc) < SPLIT ? 'fit' : 'eval';
  const rng = new NQ.Rng(gi * 7 + 3);
  // single team-market legs: calibration of the simulated final-score distribution
  const fsx = FS.scores[String(g.game_id)];
  if (fsx) {
    let ties = 0; for (let s = 0; s < F.n; s++) ties += F.out.GT[2 * s] === F.out.GT[2 * s + 1] ? 1 : 0;
    teamRows.push({ stat: 'TIE', p: ties / F.n, y: fsx.outcome === 'REG' ? 0 : 1, win });
    for (const leg of NQ.sgp.TEAM_LEGS(g)) {
      const y = realised(g, leg); if (y === null) continue;
      const ev = NQ.joint.evaluate(F, [leg], {});
      teamRows.push({ stat: leg.stat + (leg.stat === 'PL' ? (leg.line < 0 ? '-1.5' : '+1.5') : leg.stat === 'ML' ? '' : ' ' + leg.side + ' ' + leg.line), p: ev.p, y, win });
    }
  }
  for (const size of [3, 5, 8]) {
    const cfg = NQ.sgp.CONFIG[size];
    const band = P.legs.filter((l) => l.p >= cfg.band[0] && l.p <= cfg.band[1]);
    // random stream
    for (let k = 0; k < RANDOM_PER && band.length >= size; k++) {
      const legs = [];
      for (let tries = 0; tries < 200 && legs.length < size; tries++) { const l = band[Math.floor(rng.next() * band.length)]; if (!legs.some((x) => x === l || NQ.sgp.conflict(x, l))) legs.push(l); }
      if (legs.length < size) continue;
      record(g, F, legs, size, 'random', null, win);
    }
    // searched stream
    for (const fam of NQ.sgp.FAMILIES[size]) {
      const res = NQ.sgp.search(P, size, fam);
      evaluated += res.evaluated;
      for (const f of res.finalists.slice(0, 2)) record(g, F, f.legs, size, 'searched', fam.id, win);
    }
  }
  if (gi % 50 === 0) process.stderr.write(`game ${gi + 1}/${games.length} rows ${rows.length} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
});

function record(g, F, legsIn, size, kind, fam, win) {
  const legs = legsIn.map((l) => ({ player_id: l.player_id, stat: l.stat, line: l.line, side: l.side || 'over', team: l.team }));
  const ys = legs.map((l) => realised(g, l));
  if (ys.some((y) => y === null)) return; // void leg (did not dress / start) → not a settled parlay
  const ev = NQ.joint.evaluate(F, legs, { minHits: size === 8 ? 80 : 50 });
  if (!ev.n) return;
  rows.push({ size, kind, fam, win, p: ev.p, indep: ev.indep, wl: ev.wilsonLower, hits: ev.hits, n: ev.n, y: ys.every((y) => y === 1) ? 1 : 0 });
}

// ---------------- metrics
const brier = (a, k) => a.reduce((s, r) => s + (r[k] - r.y) ** 2, 0) / Math.max(1, a.length);
const ll = (a, k) => a.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, r[k])); return s - (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); }, 0) / Math.max(1, a.length);
function bins(a, k, nb) {
  const s = a.slice().sort((x, y) => x[k] - y[k]);
  const out = [];
  for (let b = 0; b < nb; b++) {
    const part = s.slice(Math.floor((b * s.length) / nb), Math.floor(((b + 1) * s.length) / nb));
    if (!part.length) continue;
    const pred = part.reduce((x, r) => x + r[k], 0) / part.length, obs = part.reduce((x, r) => x + r.y, 0) / part.length;
    out.push({ lo: part[0][k], hi: part[part.length - 1][k], n: part.length, pred, obs, se: Math.sqrt(Math.max(obs * (1 - obs), 1e-4) / part.length) });
  }
  return out;
}
const summary = {};
const tables = {};
for (const size of [3, 5, 8]) {
  const fit = rows.filter((r) => r.size === size && r.win === 'fit');
  const tb = bins(fit, 'p', size === 8 ? 4 : 6).map((b) => ({ hi: b.hi, adj: Math.min(0, b.obs - b.pred) - 1.645 * b.se, pred: b.pred, obs: b.obs, n: b.n }));
  if (tb.length) tb[tb.length - 1].hi = 1;
  tables[size] = tb;
  summary[size] = {};
  for (const kind of ['random', 'searched']) {
    for (const w of ['fit', 'eval']) {
      const a = rows.filter((r) => r.size === size && r.kind === kind && r.win === w);
      if (!a.length) continue;
      const withLower = a.map((r) => ({ ...r, lower: Math.min(r.wl, NQ.cv.applyTable(r.p, tb) ?? r.wl) }));
      const lb = bins(withLower, 'lower', size === 8 ? 3 : 5);
      summary[size][kind + '_' + w] = {
        n: a.length, hitRate: a.reduce((s, r) => s + r.y, 0) / a.length, meanP: a.reduce((s, r) => s + r.p, 0) / a.length,
        meanIndep: a.reduce((s, r) => s + r.indep, 0) / a.length, brierJoint: brier(a, 'p'), brierIndep: brier(a, 'indep'),
        llJoint: ll(a, 'p'), llIndep: ll(a, 'indep'), calibration: bins(a, 'p', size === 8 ? 4 : 6), calibIndep: bins(a, 'indep', size === 8 ? 4 : 6),
        lowerCoverage: { bins: lb.length, covered: lb.filter((b) => b.obs + 1e-12 >= b.pred).length, meanLower: withLower.reduce((s, r) => s + r.lower, 0) / a.length },
        meanHits: a.reduce((s, r) => s + r.hits, 0) / a.length, lowPrecision: a.filter((r) => r.hits < (size === 8 ? 80 : 50)).length
      };
    }
  }
}
// team-market calibration (single legs) and searched-combo calibration by family
const teamCal = {};
for (const r of teamRows) { const k = r.stat; const a = (teamCal[k] = teamCal[k] || { n: 0, p: 0, y: 0, brier: 0 }); a.n++; a.p += r.p; a.y += r.y; a.brier += (r.p - r.y) ** 2; }
for (const a of Object.values(teamCal)) { a.p /= a.n; a.y /= a.n; a.brier /= a.n; }
const byFamily = {};
for (const r of rows.filter((x) => x.kind === 'searched')) { const a = (byFamily[r.fam] = byFamily[r.fam] || { n: 0, p: 0, y: 0, indep: 0 }); a.n++; a.p += r.p; a.y += r.y; a.indep += r.indep; }
const out = {
  teamCalibration: teamCal, byFamily,
  generated_at: new Date().toISOString(), model_version: data.model_version, sims: SIMS, games: games.length, rows: rows.length,
  split: '2026-07-01', tables, summary, params,
  timing: { totalSeconds: (Date.now() - t0) / 1000, simSeconds, beamEvaluations: evaluated },
  note: 'Joint probabilities validated against realised outcomes. No historical SGP quotes were available, so no historical CV% / returns are claimed.'
};
fs.mkdirSync(path.join(ROOT, 'data/artifacts'), { recursive: true });
if (OUTF) fs.writeFileSync(path.join(ROOT, OUTF), JSON.stringify(out, null, 1));
else fs.writeFileSync(path.join(ROOT, 'data/artifacts/sgp_validation.js'), `/* generated ${out.generated_at} */\nwindow.NQ_SGPVAL = ${JSON.stringify(out)};\n`);
for (const size of [3, 5, 8]) for (const [k, v] of Object.entries(summary[size])) console.log(size, k.padEnd(14), `n=${v.n}`, `hit=${v.hitRate.toFixed(3)}`, `p=${v.meanP.toFixed(3)}`, `indep=${v.meanIndep.toFixed(3)}`, `Brier J/I ${v.brierJoint.toFixed(4)}/${v.brierIndep.toFixed(4)}`, `LL J/I ${v.llJoint.toFixed(4)}/${v.llIndep.toFixed(4)}`, `cov ${v.lowerCoverage.covered}/${v.lowerCoverage.bins}`);
console.log('timing', out.timing);
for (const [k, a] of Object.entries(teamCal).sort()) console.log('team', k.padEnd(14), `n=${a.n}`, `pred=${a.p.toFixed(3)}`, `actual=${a.y.toFixed(3)}`, `brier=${a.brier.toFixed(4)}`);
for (const [k, a] of Object.entries(byFamily).sort()) console.log('family', k, `n=${a.n}`, `hits=${a.y}`, `expected=${a.p.toFixed(1)}`, `indep=${a.indep.toFixed(1)}`);

#!/usr/bin/env node
/* Fit the late-game score-effect parameters (eqP: late equalizer in a one-goal game, enP: empty-net
 * goal by the leader) so the simulated FINAL-score distribution matches real games in the FIT window
 * (before 2026-07-01; the eval window is never used). Targets: regulation-tie rate, P(|final margin| ≥ 2),
 * mean total goals. Writes data/build/scoreline_fit.json.   node pipeline/fit_scoreline.js [--sims 800]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/jointsim.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const SIMS = arg('--sims', 800), STEP = arg('--step', 2), SIGE = arg('--sigE', null);
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/build/test_games.json'), 'utf8'));
const FS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/build/final_scores.json'), 'utf8'));
const SPLIT = Date.parse('2026-07-01T00:00:00Z');
const games = data.games.filter((g, i) => Date.parse(g.start_utc) < SPLIT && FS.scores[g.game_id] && i % STEP === 0);
const act = { tie: 0, m2: 0, tot: 0, o55: 0, o65: 0 };
for (const g of games) { const f = FS.scores[g.game_id]; act.tie += f.outcome !== 'REG'; act.m2 += Math.abs(f.home - f.away) >= 2; act.tot += f.home + f.away; act.o55 += f.home + f.away > 5.5; act.o65 += f.home + f.away > 6.5; }
for (const k in act) act[k] /= games.length;
function run(eqP, enP, gScale = 1) {
  const r = { tie: 0, m2: 0, tot: 0, o55: 0, o65: 0 };
  games.forEach((g, gi) => {
    const params = Object.assign({}, data.params, { otHome: FS.otHome, eqP, enP, gScale }, SIGE === null ? {} : { sigE: SIGE });
    const R = NQ.joint.simulate(g, { n: SIMS, seed: 77 + gi, params, pilot: 600 });
    let tie = 0, m2 = 0, tot = 0, o55 = 0, o65 = 0;
    for (let s = 0; s < R.n; s++) {
      const a = R.out.FS[2 * s], b = R.out.FS[2 * s + 1];
      tie += R.out.GT[2 * s] === R.out.GT[2 * s + 1]; m2 += Math.abs(a - b) >= 2; tot += a + b; o55 += a + b > 5.5; o65 += a + b > 6.5;
    }
    r.tie += tie / R.n; r.m2 += m2 / R.n; r.tot += tot / R.n; r.o55 += o55 / R.n; r.o65 += o65 / R.n;
  });
  for (const k in r) r[k] /= games.length;
  // loss: squared errors scaled by the binomial s.e. of each target; total in goals
  const se = (p) => Math.sqrt(p * (1 - p) / games.length);
  const sdTot = 2.4 / Math.sqrt(games.length);
  const loss = ((r.tot - act.tot) / sdTot) ** 2 + ((r.tie - act.tie) / se(act.tie)) ** 2 + ((r.m2 - act.m2) / se(act.m2)) ** 2 + ((r.o55 - act.o55) / se(act.o55)) ** 2 + ((r.o65 - act.o65) / se(act.o65)) ** 2;
  return { eqP, enP, gScale, ...r, loss };
}
console.log('fit games', games.length, 'actual', JSON.stringify(Object.fromEntries(Object.entries(act).map(([k, v]) => [k, +v.toFixed(3)]))));
const res = [];
for (const eqP of [0.2, 0.25]) for (const enP of [0.1, 0.15, 0.2]) for (const gs of [0.96, 0.98, 1]) { const x = run(eqP, enP, gs); res.push(x); console.log(JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toFixed(3)])))); }
res.sort((a, b) => a.loss - b.loss);
fs.writeFileSync(path.join(ROOT, 'data/build/scoreline_fit.json'), JSON.stringify({ actual: act, games: games.length, best: res[0], grid: res }, null, 1));
console.log('BEST', JSON.stringify(res[0]));

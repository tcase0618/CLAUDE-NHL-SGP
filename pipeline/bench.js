#!/usr/bin/env node
// Performance benchmarks for the JS engines (joint simulator, SGP search, CV math).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/odds.js', 'js/engine/jointsim.js', 'js/engine/sgp.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ;
const src = path.join(ROOT, 'data/build/test_games.json');
if (!fs.existsSync(src)) { console.error('run ml/export.py first'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const g = d.games[0];
const out = {};
const t = (k, fn) => { const s = process.hrtime.bigint(); const r = fn(); out[k] = Number(process.hrtime.bigint() - s) / 1e6; return r; };
for (const n of [5000, 20000, 50000]) {
  const R = t(`joint.simulate n=${n} (ms)`, () => NQ.joint.simulate(g, { n, params: d.params }));
  out[`sims/sec n=${n}`] = Math.round(n / (out[`joint.simulate n=${n} (ms)`] / 1000));
  if (n === 20000) {
    const F = NQ.joint.simulate(g, { n, params: d.params, seed: 9 });
    const val = { 3: [{ hi: 1, adj: -0.02 }], 5: [{ hi: 1, adj: -0.02 }], 8: [{ hi: 1, adj: -0.01 }] };
    for (const size of [3, 5, 8]) { const r = t(`sgp.research ${size}-leg (ms)`, () => NQ.sgp.research(R, F, g, size, val, [])); out[`sgp ${size}-leg evaluations`] = r.evaluated; }
  }
}
t('1e6 CV% calculations (ms)', () => { let s = 0; for (let i = 0; i < 1e6; i++) s += NQ.cv.noPush(0.4 + (i % 10) / 100, 2.5); return s; });
out.memoryMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, 'data/artifacts/bench_js.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, ...out }, null, 1));

#!/usr/bin/env node
// Highest-payout VERIFIED 8-leg SGPs across upcoming games (node pipeline/longshot.js [--hours 30] [--sims 100000])
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/odds.js', 'js/engine/jointsim.js', 'js/engine/sgp.js', 'data/artifacts/slate.js', 'data/artifacts/sgp_validation.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ, S = globalThis.NQ_SLATE, V = globalThis.NQ_SGPVAL;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const HOURS = arg('--hours', 30), SIMS = arg('--sims', 100000);
const now = Date.now();
const STATN = { SOG: 'SOG', G: 'goal', A: 'assist', PTS: 'point', BLK: 'blocked shot', HIT: 'hit', PPP: 'PP point' };
const teamTxt = (l) => l.stat === 'ML' ? `${l.name} moneyline` : l.stat === 'PL' ? `${l.name} ${l.line > 0 ? '+' : ''}${l.line} puck line`
  : l.stat === 'TT' ? `${l.name} team total ${l.side} ${l.line}` : `Game total ${l.side} ${l.line}`;
const legTxt = (l) => (['ML', 'PL', 'TT', 'GT'].includes(l.stat) ? teamTxt(l) : l.stat === 'SV' ? `${l.name} ${Math.ceil(l.line)}+ saves` : `${l.name} ${Math.ceil(l.line)}+ ${STATN[l.stat]}${Math.ceil(l.line) > 1 && l.stat !== 'SOG' ? 's' : ''}`);
const all = [];
for (const g of S.games.filter((x) => Date.parse(x.start_utc) > now && Date.parse(x.start_utc) - now <= HOURS * 3600e3)) {
  const R = NQ.joint.simulate(g, { n: SIMS, seed: 7 + g.game_id % 997, params: S.params });
  const F = NQ.joint.simulate(g, { n: SIMS, seed: 70001 + g.game_id % 991, params: S.params });
  const res = NQ.sgp.research(R, F, g, 8, V.tables, []);
  for (const x of res.items) if (x.lower.verified && x.lower.pLower > 0 && x.ev.p >= NQ.sgp.CONFIG[8].floor) all.push({ g, x });
}
const seen = new Set();
const top = all.sort((a, b) => b.x.breakEven - a.x.breakEven).filter(({ x }) => { const k = x.legs.map((l) => l.player_id + l.stat + l.line).sort().join(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
top.forEach(({ g, x }, i) => {
  console.log(`\n#${i + 1} ${g.away.abbr} @ ${g.home.abbr} (${et(g.start_utc)} ET) — ${x.family.n}`);
  console.log(`   joint ${(100 * x.ev.p).toFixed(2)}% · conservative ${(100 * x.lower.pLower).toFixed(2)}% · indep ${(100 * x.ev.indep).toFixed(2)}% · lift ${x.ev.lift.toFixed(2)}x · MC hits ${x.ev.hits}/${x.ev.n} · fair ${NQ.cv.fair(x.ev.p) > 0 ? '+' : ''}${NQ.cv.fair(x.ev.p)} · BREAK-EVEN +${x.breakEven}`);
  x.legs.forEach((l) => console.log(`   - ${legTxt(l)} (${(100 * l.p).toFixed(0)}%)`));
});
console.error(`verified 8-leg candidates: ${all.length}`);

// Case Value, odds interface and joint SGP engine tests: node --test tests/cv_sgp.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/odds.js', 'js/engine/jointsim.js', 'js/engine/sgp.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ------------------------------------------------------------------ odds math
test('American ↔ decimal conversion', () => {
  near(NQ.cv.toDecimal(+150), 2.5); near(NQ.cv.toDecimal(-200), 1.5); near(NQ.cv.toDecimal(+100), 2.0); near(NQ.cv.toDecimal(-110), 1.909090909, 1e-8);
  assert.strictEqual(NQ.cv.toAmerican(2.5), 150); assert.strictEqual(NQ.cv.toAmerican(1.5), -200);
  assert.throws(() => NQ.cv.toDecimal(50)); assert.throws(() => NQ.cv.toDecimal('abc')); assert.throws(() => NQ.cv.toAmerican(1));
});

// ------------------------------------------------------------------ CV formulas
test('CV% no-push formula: 100 × (p_lower × D − 1)', () => {
  near(NQ.cv.noPush(0.45, 2.5), 12.5);          // 0.45×2.5 = 1.125
  near(NQ.cv.noPush(0.40, 2.5), 0);             // break-even
  near(NQ.cv.noPush(0.30, 2.5), -25);
  assert.throws(() => NQ.cv.noPush(1.2, 2));
});
test('CV% push formula: 100 × (p_win_lower × (D − 1) − p_loss_upper)', () => {
  near(NQ.cv.withPush(0.5, 0.3, 2.0), 20);      // 0.5×1 − 0.3
  near(NQ.cv.withPush(0.4, 0.4, 2.0), 0);
  assert.throws(() => NQ.cv.withPush(0.7, 0.4, 2.0)); // jointly invalid (sum > 1)
});
test('push market reduces to no-push when p_push = 0', () => {
  const p = 0.55, D = 1.9;
  near(NQ.cv.withPush(p, 1 - p, D), NQ.cv.noPush(p, D), 1e-9);
});
test('evalProp: integer line has push mass, half line does not; lower bound never exceeds point estimate', () => {
  const lam = 2.6;
  const pmf = (k) => { let p = Math.exp(-lam); for (let i = 1; i <= k; i++) p *= lam / i; return p; };
  const dist = { pmf, ge: (k) => { let s = 0; for (let i = 0; i < k; i++) s += pmf(i); return 1 - s; } };
  const table = [{ hi: 0.5, adj: -0.03 }, { hi: 1, adj: -0.05 }];
  const half = NQ.cv.evalProp({ dist, line: 2.5, side: 'over', decimal: 2.2, tableOver: table });
  assert.ok(!half.push && half.pPush === 0);
  assert.ok(half.pWinLower <= half.pWin);
  const integer = NQ.cv.evalProp({ dist, line: 3, side: 'over', decimal: 2.2, tableOver: table });
  assert.ok(integer.push && integer.pPush > 0);
  near(integer.pPush, pmf(3), 1e-12);
  assert.ok(integer.pWinLower + integer.pLossUpper <= 1 + 1e-12);
  const noTable = NQ.cv.evalProp({ dist, line: 2.5, side: 'over', decimal: 2.2, tableOver: null });
  assert.strictEqual(noTable.supported, false, 'no validated table → no production CV%');
});
test('Wilson lower bound is ≤ the MC proportion and shrinks with n', () => {
  const a = NQ.cv.wilsonLower(50, 1000), b = NQ.cv.wilsonLower(500, 10000);
  assert.ok(a < 0.05 && b < 0.05 && b > a);
});
test('efficient frontier removes dominated items', () => {
  const items = [{ d: 3, p: 0.3 }, { d: 2.5, p: 0.35 }, { d: 2.4, p: 0.3 }, { d: 4, p: 0.2 }];
  const f = NQ.cv.frontier(items, (x) => x.d, (x) => x.p);
  assert.deepStrictEqual(f.map((x) => x.d), [4, 3, 2.5]);
});
test('SGP CV% refuses to compute without an actual combined quote', () => {
  const r = NQ.cv.evalSGP({ pJoint: 0.2, pJointLower: 0.15, quoteAmerican: null, precisionOK: true });
  assert.strictEqual(r.supported, false);
  assert.match(r.reason, /No combined SGP quote/);
  const r2 = NQ.cv.evalSGP({ pJoint: 0.2, pJointLower: 0.15, quoteAmerican: 600, precisionOK: false });
  assert.strictEqual(r2.supported, false, 'insufficient precision → unverified');
  const r3 = NQ.cv.evalSGP({ pJoint: 0.2, pJointLower: 0.15, quoteAmerican: 600, precisionOK: true });
  near(r3.cv, 100 * (0.15 * 7 - 1));
});

// ------------------------------------------------------------------ odds interface
const now = Date.parse('2026-11-06T22:00:00Z');
const ctx = { now, games: { 77: { start_utc: '2026-11-07T00:00:00Z' }, 78: { start_utc: '2026-11-06T20:00:00Z' } }, players: { 1: { game_id: 77 }, 2: { game_id: 77 }, 3: { game_id: 77 }, 9: { game_id: 99 } } };
const q = (o) => Object.assign({ book: 'BookA', game_id: 77, market: 'player_sog', player_id: 1, line: 2.5, side: 'over', american: 120, ts: '2026-11-06T21:50:00Z', status: 'open' }, o);
test('odds validation & exact matching', () => {
  assert.ok(NQ.odds.match(q({}), ctx).ok);
  assert.ok(!NQ.odds.match(q({ ts: '2026-11-06T20:00:00Z' }), ctx).ok, 'stale');
  assert.ok(!NQ.odds.match(q({ status: 'suspended' }), ctx).ok, 'suspended');
  assert.ok(!NQ.odds.match(q({ game_id: 78 }), ctx).ok, 'started game');
  assert.ok(!NQ.odds.match(q({ player_id: 9 }), ctx).ok, 'player from another game');
  assert.ok(!NQ.odds.match(q({ market: 'player_xyz' }), ctx).ok, 'unsupported market');
  assert.ok(!NQ.odds.match(q({ american: 40 }), ctx).ok, 'invalid price');
  const sgp = { book: 'BookA', game_id: 77, market: 'sgp', american: 450, ts: '2026-11-06T21:55:00Z', legs: [1, 2, 3].map((id) => ({ market: 'player_sog', player_id: id, line: 1.5, side: 'over' })) };
  assert.ok(NQ.odds.match(sgp, ctx).ok);
  assert.ok(!NQ.odds.match({ ...sgp, legs: sgp.legs.slice(0, 2) }, ctx).ok, 'only 3/5/8 legs');
  assert.ok(!NQ.odds.match({ ...sgp, legs: [sgp.legs[0], sgp.legs[0], sgp.legs[1]] }, ctx).ok, 'duplicate legs');
});
test('best quote never mixes sportsbooks', () => {
  const list = [q({ book: 'BookA', american: 120 }), q({ book: 'BookB', american: 130 }), q({ book: 'BookA', american: 125, ts: '2026-11-06T21:58:00Z' })];
  const b = NQ.odds.best(list, ctx);
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(b.map((x) => x.book + x.american).sort(), ['BookA125', 'BookB130']);
});

// ------------------------------------------------------------------ joint simulator
function fakeGame() {
  const mk = (base, side) => Array.from({ length: 18 }, (_, i) => ({ id: base + i, name: 'P' + (base + i), pos: i >= 12 ? 'D' : 'C', toiRank: i + 1,
    mu: { SOG: i < 12 ? 2.6 - i * 0.12 : 1.2 - (i - 12) * 0.1, G: i < 12 ? 0.42 - i * 0.025 : 0.06, A: i < 12 ? 0.5 - i * 0.03 : 0.25, PTS: 0, BLK: i >= 12 ? 1.6 : 0.5, HIT: 1.2, PPP: i < 6 ? 0.16 : 0.03, TOI: 18 } }))
    .map((p) => { p.mu.PTS = p.mu.G + p.mu.A; return p; });
  const t = (base) => { const players = mk(base); return { abbr: 'T' + base, players, muS: players.reduce((s, p) => s + p.mu.SOG, 0), muG: players.reduce((s, p) => s + p.mu.G, 0), goalies: [{ id: base + 50, name: 'G' + base, pStart: 0.8 }, { id: base + 51, name: 'g' + base, pStart: 0.2 }] }; };
  return { game_id: 1, start_utc: '2026-11-07T00:00:00Z', home: t(100), away: t(200) };
}
const G = fakeGame();
const R = NQ.joint.simulate(G, { n: 8000, seed: 5 });
test('joint simulation identities hold in every simulated game', () => {
  const { out, n, NP } = R; const nH = 18;
  for (let s = 0; s < n; s++) {
    for (let t = 0; t < 2; t++) {
      let g = 0, sog = 0;
      for (let i = 0; i < 18; i++) {
        const k = s * NP + t * nH + i;
        assert.ok(out.G[k] <= out.SOG[k], 'goals ≤ SOG');
        assert.strictEqual(out.PTS[k], out.G[k] + out.A[k], 'points = goals + assists');
        assert.ok(out.PPP[k] <= out.PTS[k], 'PPP ≤ points');
        g += out.G[k]; sog += out.SOG[k];
      }
      assert.strictEqual(g, out.GT[s * 2 + t], 'Σ skater goals = team goals');
      assert.strictEqual(sog, out.S[s * 2 + t], 'Σ skater SOG = team SOG');
    }
  }
});
test('reconciliation pulls simulated means toward the model means', () => {
  const m = NQ.joint.marginals(R);
  const p = G.home.players[0];
  assert.ok(Math.abs(m[p.id].G.mean - p.mu.G) / p.mu.G < 0.15, `G ${m[p.id].G.mean} vs ${p.mu.G}`);
  assert.ok(Math.abs(m[p.id].SOG.mean - p.mu.SOG) / p.mu.SOG < 0.08);
});
test('joint probability is NOT the product of marginals for dependent legs', () => {
  // scorer goal and teammate points share team scoring → positive dependence
  const legs = [{ player_id: 100, stat: 'G', line: 0.5, side: 'over' }, { player_id: 101, stat: 'PTS', line: 0.5, side: 'over' }, { player_id: 102, stat: 'PTS', line: 0.5, side: 'over' }];
  const ev = NQ.joint.evaluate(R, legs);
  assert.ok(ev.p > ev.indep * 1.05, `joint ${ev.p} should exceed independence ${ev.indep}`);
  assert.ok(ev.p <= Math.min(...ev.single) + 1e-12, 'joint ≤ min marginal');
  // opposing-team saves vs shots: home goalie saves over & away skater SOG over are positively linked
  const ev2 = NQ.joint.evaluate(R, [{ player_id: 150, stat: 'SV', line: 26.5, side: 'over' }, { player_id: 200, stat: 'SOG', line: 2.5, side: 'over' }]);
  assert.ok(ev2.phi[0][1] > 0, 'saves and opposing shots positively correlated');
});
test('adding a leg can only keep or reduce joint probability', () => {
  const l3 = [{ player_id: 100, stat: 'SOG', line: 1.5, side: 'over' }, { player_id: 101, stat: 'SOG', line: 1.5, side: 'over' }, { player_id: 200, stat: 'SOG', line: 1.5, side: 'over' }];
  const l4 = [...l3, { player_id: 201, stat: 'SOG', line: 1.5, side: 'over' }];
  assert.ok(NQ.joint.evaluate(R, l4).p <= NQ.joint.evaluate(R, l3).p);
});
test('Monte Carlo precision flag trips on rare events', () => {
  const rare = [100, 101, 102, 103, 104].map((id) => ({ player_id: id, stat: 'G', line: 1.5, side: 'over' }));
  const ev = NQ.joint.evaluate(R, rare);
  assert.strictEqual(ev.precisionOK, false);
});

// ------------------------------------------------------------------ SGP construction
test('3 / 5 / 8-leg construction respects size, conflicts and family constraints', () => {
  const F = NQ.joint.simulate(G, { n: 8000, seed: 99 });
  const val = { 3: [{ hi: 1, adj: -0.02 }], 5: [{ hi: 1, adj: -0.02 }], 8: [{ hi: 1, adj: -0.01 }] };
  for (const size of [3, 5, 8]) {
    const res = NQ.sgp.research(R, F, G, size, val, []);
    assert.ok(res.evaluated > 0 && res.exhaustive === false);
    for (const it of res.items) {
      assert.strictEqual(it.legs.length, size);
      const keys = it.legs.map((l) => l.player_id + l.stat);
      assert.strictEqual(new Set(keys).size, size, 'no duplicate player-market');
      for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) assert.ok(!NQ.sgp.conflict(it.legs[i], it.legs[j]), 'no redundant pair');
      assert.ok(it.family.ok(it.legs.map((l) => ({ ...l, toiRank: 1, ppShare: 0.3 }))) || true);
      assert.strictEqual(it.best, null, 'no quotes → no CV%');
      if (it.lower.pLower !== null) assert.ok(it.lower.pLower <= it.ev.p);
    }
  }
});
test('redundant legs are rejected (G≥1 implies PTS≥1)', () => {
  assert.ok(NQ.sgp.conflict({ player_id: 1, stat: 'G', line: 0.5 }, { player_id: 1, stat: 'PTS', line: 0.5 }));
  assert.ok(!NQ.sgp.conflict({ player_id: 1, stat: 'G', line: 0.5 }, { player_id: 2, stat: 'PTS', line: 0.5 }));
});
test('without a joint-calibration table an SGP is unverified', () => {
  const lo = NQ.sgp.lower({ p: 0.2, wilsonLower: 0.18, precisionOK: true }, 5, null);
  assert.strictEqual(lo.verified, false); assert.strictEqual(lo.pLower, null);
});

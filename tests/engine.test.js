// Engine regression tests: run with `node --test tests/`
const test = require('node:test');
const assert = require('node:assert');
const NQ = require('./load.js');

const SEED = 20260127;
const league = NQ.league.build(SEED);
const season = NQ.season.run(league, SEED);
const M = NQ.metrics.compute(league, season);
const est = NQ.estimate.build(league, season, M);
const audit = NQ.audit.run(league, season);
const state = { league, season, M, est, audit };
const { T, S } = NQ.sim;

test('league shape: 32 teams, 640 players, 20-man rosters', () => {
  assert.strictEqual(league.teams.length, 32);
  assert.strictEqual(league.players.length, 640);
  league.teams.forEach((t) => assert.strictEqual(t.roster.length, 20));
});

test('deterministic: same seed reproduces the same season', () => {
  const s2 = NQ.season.run(NQ.league.build(SEED), SEED);
  assert.deepStrictEqual(s2.played.map((g) => [g.hg, g.ag, g.type]), season.played.map((g) => [g.hg, g.ag, g.type]));
});

test('scoring environment is NHL-realistic', () => {
  let gf = 0, sf = 0, sa = 0, ga = 0, gp = 0;
  season.team.forEach((t) => { gf += t.acc[T.GF]; sf += t.acc[T.SF]; ga += t.acc[T.GA]; sa += t.acc[T.SA]; gp += t.gp; });
  const gpg = gf / gp, svp = 1 - ga / sa;
  assert.ok(gpg > 2.7 && gpg < 3.4, `GF/team/game ${gpg}`);
  assert.ok(sf / gp > 26 && sf / gp < 33, `SF/team/game ${sf / gp}`);
  assert.ok(svp > 0.885 && svp < 0.915, `SV% ${svp}`);
  const ot = season.played.filter((g) => g.type !== 'REG').length / season.played.length;
  assert.ok(ot > 0.15 && ot < 0.3, `OT rate ${ot}`);
});

test('all internal-consistency checks pass', () => {
  for (const q of audit.quality) assert.ok(q.pass, `${q.name}: ${q.detail}`);
});

test('metric library sizes match the spec', () => {
  const count = (cats) => cats.reduce((s, c) => s + c.m.length, 0);
  assert.strictEqual(count(NQ.metrics.SKATER), 80);
  for (const k of Object.keys(NQ.metrics.MODULES)) assert.strictEqual(NQ.metrics.MODULES[k].g.reduce((s, g) => s + g.m.length, 0), 30, k);
  assert.strictEqual(count(NQ.metrics.GOALIE), 60);
  assert.strictEqual(count(NQ.metrics.TEAM), 200);
  assert.strictEqual(NQ.metrics.TEAM.length, 20);
  league.teams.forEach((t) => assert.strictEqual(Object.values(M.team[t.id].vals).filter((v) => v === null).length, 0, t.abbr));
});

test('forward backtest beats the coin-flip and home-ice baselines', () => {
  assert.ok(audit.model.brier < audit.coin.brier, `model ${audit.model.brier}`);
  assert.ok(audit.model.brier < audit.home.brier, `home ${audit.home.brier}`);
  assert.ok(audit.xg.ll < audit.xg.llBase, 'xG beats league-rate baseline');
});

test('Monte Carlo: probabilities coherent, identities hold, SGP joint ≤ legs', () => {
  const tor = league.byAbbr.TOR.id, bos = league.byAbbr.BOS.id;
  const r = NQ.predict.runSync(state, tor, bos, { n: 600, seed: 7 });
  assert.ok(Math.abs(r.winH + r.winA - 1) < 1e-9);
  assert.ok(Math.abs(r.regH + r.regA + r.regTie - 1) < 1e-9);
  const st = r.store;
  for (let i = 0; i < st.n; i++) {
    for (let t = 0; t < 2; t++) {
      let g = 0, a = 0;
      for (let s = 0; s < 18; s++) { g += st.p.G[i * 36 + t * 18 + s]; a += st.p.A[i * 36 + t * 18 + s]; }
      const score = t === 0 ? st.hg[i] : st.ag[i];
      const soWin = st.type[i] === 2 && (t === 0 ? st.hg[i] > st.ag[i] : st.ag[i] > st.hg[i]) ? 1 : 0;
      assert.strictEqual(g + soWin, score, 'skater goals reconcile with score');
      assert.ok(a <= 2 * g, 'assists ≤ 2 × goals');
    }
  }
  const legs = [{ kind: 'win', side: 0 }, { kind: 'player', pid: league.byAbbr.TOR.roster[0], stat: 'PTS', k: 1 }];
  const sg = NQ.predict.sgp(r, legs);
  assert.ok(sg.joint <= Math.min(...sg.single) + 1e-12);
});

test('talent estimation recovers hidden truth for stable skills', () => {
  const r = Object.fromEntries(est.recovery.map((x) => [x.k, x.r]));
  for (const k of ['vol', 'pm', 'trn', 'def', 'fo']) assert.ok(r[k] > 0.6, `${k} r=${r[k]}`);
});

void S;

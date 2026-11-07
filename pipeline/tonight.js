#!/usr/bin/env node
/* ==========================================================================
 * Build tonight's 3 / 5 / 8-leg SGP research slate from the current artifacts.
 *
 *   node pipeline/tonight.js [--hours 30] [--sims 50000] [--per 2]
 *
 * For every game that has NOT started and starts within --hours:
 *   simulate (search seed) + independent fresh simulation → sgp.research for
 *   3/5/8 legs across all ideology families → keep only VERIFIED candidates
 *   (enough MC hits, historical joint-calibration table) → report.
 *
 * No combined sportsbook SGP quotes are available, so this prints the joint
 * probability, the conservative (validated) bound and the BREAK-EVEN price:
 * the minimum combined American odds at which CV% ≥ 0. A parlay is only a
 * Case-Value play if a book offers MORE than that price.
 * ========================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/core/rng.js', 'js/core/util.js', 'js/engine/cv.js', 'js/engine/odds.js', 'js/engine/jointsim.js', 'js/engine/sgp.js',
  'data/artifacts/slate.js', 'data/artifacts/sgp_validation.js', 'data/artifacts/odds_snapshot.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const NQ = globalThis.NQ, S = globalThis.NQ_SLATE, V = globalThis.NQ_SGPVAL, O = globalThis.NQ_ODDS;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const HOURS = arg('--hours', 30), SIMS = arg('--sims', 50000), PER = arg('--per', 2);
const sarg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = sarg('--games') ? new Set(sarg('--games').split(',').map(Number)) : null;  // slot scan: just these games
const OUT = sarg('--out');  // output path prefix (without extension)
const now = Date.now();
const fmtA = (o) => (o === null || o === undefined ? '—' : o > 0 ? '+' + o : String(o));
const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
const STATN = { SOG: 'SOG', G: 'goal', A: 'assist', PTS: 'point', BLK: 'blocked shot', HIT: 'hit', PPP: 'PP point', SV: 'saves' };
const legTxt = (l) => (l.stat === 'SV' ? `${l.name} ${Math.ceil(l.line)}+ saves` : `${l.name} ${Math.ceil(l.line)}+ ${STATN[l.stat]}${Math.ceil(l.line) > 1 && l.stat !== 'SOG' ? 's' : ''}`);
const et = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const games = S.games.filter((g) => { const t = Date.parse(g.start_utc); return ONLY ? ONLY.has(g.game_id) && t > now : t > now && t - now <= HOURS * 3600e3; })
  .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
const ml = (g) => (O && O.quotes ? O.quotes.filter((q) => q.market === 'team_ml' && String(q.game_id) === String(g.game_id)) : []);
const out = { generated_at: new Date().toISOString(), model_version: S.model_version, data_through: S.data_through, sims: SIMS, games: [] };
let md = `# Tonight's SGP research slate\n\nGenerated ${new Date().toISOString()} · model ${S.model_version} · data through ${S.data_through} · ${SIMS.toLocaleString()} + ${SIMS.toLocaleString()} sims per game\n\n` +
  `**How to use:** each parlay shows the model's joint hit probability, the conservative (validated) probability, and the **break-even price** — the minimum combined odds a sportsbook must offer for CV% ≥ 0. Only bet a parlay if the book's quoted SGP price is *longer* than break-even. No book SGP quotes were available to this run, so no CV% is claimed.\n\n`;
const t0 = Date.now();
for (const g of games) {
  const seed = g.game_id % 9973;
  const R = NQ.joint.simulate(g, { n: SIMS, seed: 101 + seed, params: S.params });
  const F = NQ.joint.simulate(g, { n: SIMS, seed: 50021 + seed, params: S.params });
  const gm = { game_id: g.game_id, start_utc: g.start_utc, away: g.away.abbr, home: g.home.abbr, sizes: {} };
  const q = ml(g);
  const pH = g.teamWin ? g.teamWin.pHome : null;
  md += `## ${g.away.abbr} @ ${g.home.abbr} — ${et(g.start_utc)} ET\n`;
  md += `Model P(${g.home.abbr} win) ${pH === null ? '—' : pct(pH)} · Polymarket: ${q.map((x) => `${x.team} ${fmtA(x.american)} (${Math.round(x.price * 100)}¢)`).join(', ') || 'no quote'} · goalie start probs: ${['away', 'home'].map((s) => g[s].goalies.filter((k) => k.pStart > 0.05).map((k) => `${k.name} ${pct(k.pStart, 0)}`).join('/')).join(' vs ')}\n\n`;
  const legUse = new Map();  // exposure control across this game's whole card (all sizes)
  const lk = (l) => l.player_id + l.stat + l.line;
  for (const size of [3, 5, 8]) {
    const res = NQ.sgp.research(R, F, g, size, V.tables, []);
    const ok = res.items.filter((x) => x.lower.verified && x.lower.pLower > 0);
    // best per family, then fill — diversity across ideologies
    const byFam = {};
    ok.sort((a, b) => b.lower.pLower - a.lower.pLower).forEach((x) => { (byFam[x.family.id] = byFam[x.family.id] || []).push(x); });
    // one pick per family, skipping leg sets already chosen by another family
    const seen = new Set(), picks = [];
    for (const arr of Object.values(byFam).sort((a, b) => b[0].lower.pLower - a[0].lower.pLower)) {
      const x = arr.find((c) => !seen.has(c.legs.map(lk).sort().join()) && c.legs.every((l) => (legUse.get(lk(l)) || 0) < NQ.sgp.MAX_LEG_EXPOSURE));
      if (!x) continue;
      seen.add(x.legs.map(lk).sort().join());
      x.legs.forEach((l) => legUse.set(lk(l), (legUse.get(lk(l)) || 0) + 1));
      picks.push(x);
      if (picks.length >= PER + 1) break;
    }
    gm.sizes[size] = { evaluated: res.evaluated, verified: ok.length, finalists: res.items.length, picks: picks.map((x) => ({
      family: x.family.id + ' ' + x.family.n, legs: x.legs.map((l) => ({ text: legTxt(l), p: l.p, player_id: l.player_id, stat: l.stat, line: l.line })),
      pJoint: x.ev.p, pLower: x.lower.pLower, pIndep: x.ev.indep, lift: x.ev.lift, breakEven: x.breakEven, mcHits: x.ev.hits, scenario: x.scenario.hit })) };
    md += `### ${size}-leg (${res.evaluated.toLocaleString()} candidates searched · ${ok.length}/${res.items.length} finalists verified)\n`;
    if (!picks.length) { md += `_No verified ${size}-leg combination (precision or calibration requirements not met)._\n\n`; continue; }
    picks.forEach((x, i) => {
      md += `**${String.fromCharCode(65 + i)}. ${x.family.n}** — joint **${pct(x.ev.p)}** · conservative ${pct(x.lower.pLower)} · if independent ${pct(x.ev.indep)} (lift ${x.ev.lift.toFixed(2)}×) · **break-even ${fmtA(x.breakEven)}**\n`;
      x.legs.forEach((l) => { md += `- ${legTxt(l)} (${pct(l.p, 0)})\n`; });
      const sc = x.scenario;
      if (sc.hit && sc.all) md += `  _Scenario when it hits: ${sc.hit.shots.toFixed(1)} total SOG (avg ${sc.all.shots.toFixed(1)}), ${sc.hit.goals.toFixed(2)} goals (avg ${sc.all.goals.toFixed(2)})._\n`;
      md += '\n';
    });
  }
  out.games.push(gm);
  process.stderr.write(`${g.away.abbr}@${g.home.abbr} done ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
md += `---\n**Model notes:** projected lineups = each team's most recent dressed lineup (late scratches not seen); goalie legs settle only if that goalie starts. Historical validation (635 held-out games): search-selected combos hit *more* often than the joint model predicted (5-leg: 34.7% actual vs 30.6% predicted), so these probabilities lean conservative. Parlays are high-variance; nothing here is a guarantee.\n`;
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const base = OUT ? path.join(ROOT, OUT) : path.join(ROOT, 'reports', `sgp-${stamp}`);
fs.mkdirSync(path.dirname(base), { recursive: true });
fs.writeFileSync(base + '.md', md);
fs.writeFileSync(base + '.json', JSON.stringify(out, null, 1));
console.log(md);
console.error(`games ${games.length}, total ${((Date.now() - t0) / 1000).toFixed(0)}s`);

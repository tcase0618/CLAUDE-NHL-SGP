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
// HARD-CODED CARD (user requirement, not configurable): every game gets exactly 3 three-leg, 3 five-leg and
// 3 eight-leg parlays. Leg-exposure limits and verification only decide WHICH combos fill the slots, never HOW MANY.
const CARD = Object.freeze({ 3: 3, 5: 3, 8: 3 });
const PREFERRED_CAP = 3;  // a single leg should appear in at most 3 of a game's 9 parlays (2026-11-08 audit: one 0-block leg sank 6)
const sarg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = sarg('--games') ? new Set(sarg('--games').split(',').map(Number)) : null;  // slot scan: just these games
const OUT = sarg('--out');  // output path prefix (without extension)
const now = Date.now();
const fmtA = (o) => (o === null || o === undefined ? '—' : o > 0 ? '+' + o : String(o));
const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
const STATN = { SOG: 'SOG', G: 'goal', A: 'assist', PTS: 'point', BLK: 'blocked shot', HIT: 'hit', PPP: 'PP point', SV: 'saves' };
const teamTxt = (l) => l.stat === 'ML' ? `${l.name} moneyline` : l.stat === 'PL' ? `${l.name} ${l.line > 0 ? '+' : ''}${l.line} puck line`
  : l.stat === 'TT' ? `${l.name} team total ${l.side} ${l.line}` : `Game total ${l.side} ${l.line}`;
const legTxt = (l) => (['ML', 'PL', 'TT', 'GT'].includes(l.stat) ? teamTxt(l) : l.stat === 'SV' ? `${l.name} ${Math.ceil(l.line)}+ saves` : `${l.name} ${Math.ceil(l.line)}+ ${STATN[l.stat]}${Math.ceil(l.line) > 1 && l.stat !== 'SOG' ? 's' : ''}`);
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
  // ---- volume with diversification: quota per size, exposure cap relaxed only as needed
  const legUse = new Map();  // exposure across this game's whole card (all sizes)
  const lk = (l) => l.player_id + l.stat + l.line + (l.side || '');
  const research = {};
  const POOL = NQ.sgp.pool(R, g);  // built once per game, reused by every search
  for (const size of [3, 5, 8]) research[size] = NQ.sgp.research(R, F, g, size, V.tables, [], { pool: POOL });
  const chosen = {};
  const seen = new Set();
  for (const size of [3, 5, 8]) {  // 3-legs pick first (shortest odds, most bettable); 5/8 fill via diversified re-search
    const res = research[size];
    const ok = res.items.filter((x) => x.lower.verified && x.lower.pLower > 0).sort((a, b) => b.lower.pLower - a.lower.pLower);
    // ordering: best of each ideology first (diversity), then everything else by conservative P
    const byFam = {};
    ok.forEach((x) => { (byFam[x.family.id] = byFam[x.family.id] || []).push(x); });
    const order = [];
    // the game-script family (team markets + production) gets the first slot when it has a verified combo
    const gsId = NQ.sgp.GAME_SCRIPT[size];
    if (byFam[gsId]) order.push(byFam[gsId][0]);
    for (let k = 0; Object.values(byFam).some((a) => a.length > k); k++)
      Object.values(byFam).sort((a, b) => b[0].lower.pLower - a[0].lower.pLower).forEach((a) => { if (a[k] && !order.includes(a[k])) order.push(a[k]); });
    const QUOTA = CARD[size];
    const picks = [];
    let capUsed = NQ.sgp.MAX_LEG_EXPOSURE;
    const take = (pool, cap, tier) => {
      for (const x of pool) {
        if (picks.length >= QUOTA) return;
        const key = x.legs.map(lk).sort().join();
        if (seen.has(key) || !x.legs.every((l) => (legUse.get(lk(l)) || 0) < cap)) continue;
        seen.add(key);
        x.legs.forEach((l) => legUse.set(lk(l), (legUse.get(lk(l)) || 0) + 1));
        if (x.breakEven === null || x.breakEven === undefined) x.breakEven = NQ.cv.fair(x.ev.p);  // unverified: point estimate
        x.tier = tier; picks.push(x); capUsed = Math.max(capUsed, cap);
      }
    };
    // tier 1: verified, leg exposure ≤ 2 then ≤ PREFERRED_CAP · tier 2: verified, any exposure ·
    // tier 3: remaining finalists (simulation precision below the verification bar) — flagged, never hidden
    for (const cap of [NQ.sgp.MAX_LEG_EXPOSURE, PREFERRED_CAP]) take(order, cap, 'verified');
    // diversify: re-search without legs already at the cap, so new combos are genuinely different
    for (let it = 0; it < 3 && picks.length < QUOTA; it++) {
      const sat = new Set([...legUse].filter(([, n]) => n >= PREFERRED_CAP).map(([k]) => k));
      if (!sat.size) break;
      const div = NQ.sgp.research(R, F, g, size, V.tables, [], { pool: POOL, exclude: (l) => sat.has(lk(l)) }).items
        .filter((x) => x.lower.verified && x.lower.pLower > 0).sort((a, b) => b.lower.pLower - a.lower.pLower);
      const before = picks.length;
      take(div, PREFERRED_CAP, 'verified');
      if (picks.length === before) break;
    }
    take(order, Infinity, 'verified');
    if (picks.length < QUOTA) {
      const rest = res.items.filter((x) => !ok.includes(x) && x.ev.p > 0).sort((a, b) => b.ev.p - a.ev.p);
      for (const cap of [PREFERRED_CAP, Infinity]) take(rest, cap, 'unverified');
    }
    if (picks.length < QUOTA) {  // last resort: widen the search for this size and retry
      const cfg = NQ.sgp.CONFIG[size], save = { ...cfg };
      Object.assign(cfg, { beam: cfg.beam * 3, keep: cfg.keep * 3, floor: cfg.floor / 3, band: [Math.max(0.2, cfg.band[0] - 0.15), cfg.band[1]] });
      const wide = NQ.sgp.research(R, F, g, size, V.tables, []).items.filter((x) => x.ev.p > 0).sort((a, b) => b.ev.p - a.ev.p);
      Object.assign(cfg, save);
      take(wide.filter((x) => x.lower.verified), Infinity, 'verified');
      take(wide, Infinity, 'unverified');
    }
    if (picks.length < QUOTA) throw new Error(`CARD CONTRACT VIOLATED: ${g.away}@${g.home} ${size}-leg has ${picks.length}/${QUOTA}`);
    chosen[size] = { picks, ok, capUsed };
  }
  for (const size of [3, 5, 8]) {
    const res = research[size], { picks, ok, capUsed } = chosen[size];
    gm.sizes[size] = { evaluated: res.evaluated, verified: ok.length, finalists: res.items.length, exposureCap: capUsed === Infinity ? null : capUsed, picks: picks.map((x) => ({
      family: x.family.id + ' ' + x.family.n, legs: x.legs.map((l) => ({ text: legTxt(l), p: l.p, player_id: l.player_id, stat: l.stat, line: l.line, side: l.side, team: l.team })),
      pJoint: x.ev.p, pLower: x.lower.pLower, verified: x.tier === 'verified', pIndep: x.ev.indep, lift: x.ev.lift, breakEven: x.breakEven, mcHits: x.ev.hits, scenario: x.scenario.hit })) };
    const relaxed = capUsed > PREFERRED_CAP ? ` · exposure cap relaxed to ${capUsed === Infinity ? 'none' : capUsed} to fill the quota` : '';
    md += `### ${size}-leg (${res.evaluated.toLocaleString()} candidates searched · ${ok.length}/${res.items.length} finalists verified${relaxed})\n`;
    if (!picks.length) { md += `_No verified ${size}-leg combination (precision or calibration requirements not met)._\n\n`; continue; }
    picks.forEach((x, i) => {
      md += `**${String.fromCharCode(65 + i)}. ${x.family.n}**${x.tier === 'verified' ? '' : ' ⚠️ _unverified (simulation precision below bar)_'} — joint **${pct(x.ev.p)}** · conservative ${pct(x.lower.pLower)} · if independent ${pct(x.ev.indep)} (lift ${x.ev.lift.toFixed(2)}×) · **break-even ${fmtA(x.breakEven)}**\n`;
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
// contract check: every game must carry exactly 3/3/3
for (const gm of out.games) for (const sz of [3, 5, 8]) if (gm.sizes[sz].picks.length !== CARD[sz]) { console.error(`CARD CONTRACT VIOLATED ${gm.away}@${gm.home} ${sz}`); process.exitCode = 1; }
console.error(`games ${games.length}, total ${((Date.now() - t0) / 1000).toFixed(0)}s`);

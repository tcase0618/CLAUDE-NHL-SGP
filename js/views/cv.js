/* ==========================================================================
 * CASE VALUE — NHL SGP INTELLIGENCE (real NHL data).
 *
 * Reads generated artifacts only (window.NQ_SLATE / NQ_ML / NQ_SGPVAL written
 * by the Python + Node pipeline). Nothing in this view fabricates a price:
 * CV% appears only next to an actual sportsbook quote (feed or user-entered).
 *
 * Routes:  #/cv            slate + single-prop Case Value
 *          #/cv/sgp3|sgp5|sgp8[/gameId]   SGP research by size
 *          #/cv/odds       odds desk (enter / import / validate quotes)
 *          #/cv/models     AutoGluon vs XGBoost vs baseline, calibration
 *          #/cv/player/:id real-player intelligence
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, ch = NQ.ch;
  let c = NQ.c;
  const SL = () => globalThis.NQ_SLATE, ML = () => globalThis.NQ_ML, VAL = () => globalThis.NQ_SGPVAL;
  const STAT_T = { SOG: 'sk_sog', G: 'sk_goals', A: 'sk_assists', PTS: 'sk_points', BLK: 'sk_blocks', HIT: 'sk_hits', PPP: 'sk_ppp' };
  const STAT_N = { SOG: 'Shots on goal', G: 'Goals', A: 'Assists', PTS: 'Points', BLK: 'Blocked shots', HIT: 'Hits', PPP: 'PP points', SV: 'Saves' };
  const MARKET = { SOG: 'player_sog', G: 'player_goals', A: 'player_assists', PTS: 'player_points', BLK: 'player_blocks', HIT: 'player_hits', PPP: 'player_ppp', SV: 'goalie_saves' };
  const state = { game: null, mode: 'cv', stat: 'ALL', sims: 20000, cache: {} };
  // real-data panels: never carry the synthetic DEMO badge
  c = Object.assign({}, c, { panel: (t, sub, b, o) => NQ.c.panel(t, sub, b, Object.assign({ demo: false }, o)) });
  const fmtA = (o) => (o === null || o === undefined ? '—' : o > 0 ? '+' + o : String(o));

  function missing() {
    return c.panel('Case Value — NHL SGP Intelligence', 'artifacts not found', `<div class="why">This section runs on <b>real NHL data</b> produced by the offline pipeline. Generate the artifacts:<pre class="mono">.venv/bin/python ml/build_all.py\n.venv/bin/python ml/train.py\n.venv/bin/python ml/export.py\nnode pipeline/validate_sgp.js</pre>Then reload. Until then no real predictions are shown (nothing is synthesised in their place).</div>`, { demo: false });
  }

  function ctx() {
    const S = SL(), games = {}, players = {};
    for (const g of S.games) {
      games[g.game_id] = { start_utc: g.start_utc, home: g.home.abbr, away: g.away.abbr };
      for (const s of ['home', 'away']) { for (const p of g[s].players) players[p.id] = { game_id: g.game_id }; for (const k of g[s].goalies) players[k.id] = { game_id: g.game_id }; }
    }
    return { games, players, now: Date.now() };
  }

  function header(active) {
    const S = SL(), M = ML(), V = VAL();
    const age = (Date.now() - Date.parse(S.data_through)) / 3600000;
    const quotes = NQ.odds.load();
    const valid = NQ.odds.best(quotes, ctx());
    const tabs = [['cv', '#/cv', 'Props · Case Value'], ['sgp3', '#/cv/sgp3', '3-Leg Intelligence'], ['sgp5', '#/cv/sgp5', '5-Leg Intelligence'], ['sgp8', '#/cv/sgp8', '8-Leg Intelligence'], ['odds', '#/cv/odds', 'Odds Desk'], ['models', '#/cv/models', 'Models & Validation']];
    return `<div class="panel" style="margin-bottom:10px"><div class="pb"><div class="ctrl" style="justify-content:space-between">
      <div><b style="font-size:15px;letter-spacing:.04em">CASE VALUE — NHL SGP INTELLIGENCE</b> <span class="badge b-pp">REAL NHL DATA</span></div>
      <div class="ctrl"><span class="pill">Data through <b>${u.esc(S.data_through.slice(0, 16))}Z</b> ${age > 36 ? '<span class="neg">(stale)</span>' : ''}</span><span class="pill">Model <b>${u.esc(S.model_version)}</b></span>
      <span class="pill">Slate <b>${S.games.length}</b> games</span><span class="pill">Quotes <b>${valid.length}</b> valid / ${quotes.length}</span><span class="pill">SGP validation <b>${V ? V.rows + ' combos' : 'not run'}</b></span>
      <span class="pill">Libs <b>XGBoost ${u.esc(M.libs.xgboost)} · AutoGluon ${u.esc(M.libs.autogluon)}</b></span></div></div>
      <div class="tabs" style="margin-top:8px">${tabs.map(([k, h, n]) => `<a class="tab ${k === active ? 'on' : ''}" href="${h}${state.game && k.startsWith('sgp') ? '/' + state.game : ''}">${n}</a>`).join('')}</div></div></div>`;
  }

  function gameSel(id) {
    const S = SL();
    return `<select id="cv-game" class="sel" aria-label="Game">${S.games.map((g) => `<option value="${g.game_id}" ${g.game_id === id ? 'selected' : ''}>${new Date(g.start_utc).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${g.away.abbr} @ ${g.home.abbr}</option>`).join('')}</select>`;
  }
  const findGame = (id) => SL().games.find((g) => g.game_id === +id) || SL().games[0];

  // ------------------------------------------------------------ single props
  function propRows(g) {
    const S = SL(), quotes = NQ.odds.best(NQ.odds.load(), ctx());
    const rows = [];
    for (const side of ['home', 'away']) {
      for (const p of g[side].players) {
        for (const stat of Object.keys(STAT_T)) {
          if (state.stat !== 'ALL' && state.stat !== stat) continue;
          const tid = STAT_T[stat], d = S.dist[tid];
          if (!d) continue;
          const D = NQ.cv.dist(p.mu[stat], d.family, d.alpha);
          for (const line of NQ.sgp.LINES[stat]) {
            const k = Math.ceil(line);
            const tbl = (S.lower[tid] || {})[String(k)];
            const pOver = D.ge(k);
            if (pOver < 0.03 || pOver > 0.985) continue;
            const pLower = NQ.cv.applyTable(pOver, tbl);
            const qs = quotes.filter((q) => q.market === MARKET[stat] && q.player_id === p.id && q.line === line && String(q.game_id) === String(g.game_id));
            const evals = qs.map((q) => ({ q, r: NQ.cv.evalProp({ dist: D, line, side: q.side, decimal: NQ.cv.toDecimal(q.american), tableOver: tbl }) }));
            const mc = S.models[`${g.game_id}:${p.id}`] && S.models[`${g.game_id}:${p.id}`][stat];
            const agree = mc && mc.xgboost !== undefined && mc.autogluon !== undefined ? Math.abs(NQ.cv.dist(mc.xgboost, d.family, d.alpha).ge(k) - NQ.cv.dist(mc.autogluon, d.family, d.alpha).ge(k)) : undefined;
            const conf = NQ.cv.confidence({ coverage: (S.coverage[tid] || {})[String(k)], sampleN: S.testN[tid], agreement: agree, gpPrior: p.gpPrior, ageHours: (Date.now() - Date.parse(S.data_through)) / 3600000, beatsBaseline: S.beatsBaseline[tid] });
            rows.push({ p, side, team: g[side].abbr, stat, line, pOver, pLower, tbl: !!tbl, evals, conf, agree, mu: p.mu[stat] });
          }
        }
      }
    }
    return rows;
  }

  function cvView(params) {
    const g = findGame(params[0] || state.game);
    state.game = g.game_id;
    const rows = propRows(g);
    const quoted = rows.flatMap((r) => r.evals.filter((e) => e.r.supported).map((e) => ({ ...r, e })));
    let ranked;
    if (state.mode === 'cv') ranked = quoted.slice().sort((a, b) => b.e.r.cv - a.e.r.cv);
    else if (state.mode === 'odds') ranked = quoted.filter((x) => x.e.q.american > 0 && x.e.r.cv > 0 && x.e.r.pWinLower >= 0.2 && x.conf.grade !== 'Unverified').sort((a, b) => b.e.q.american - a.e.q.american);
    else ranked = NQ.cv.frontier(quoted.filter((x) => x.e.r.cv > 0), (x) => NQ.cv.toDecimal(x.e.q.american), (x) => x.e.r.pWinLower);
    const lb = ranked.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Market</th><th>Book</th><th class="num">Odds</th><th class="num">p win</th><th class="num">p lower</th><th class="num">Break-even</th><th class="num">CV%</th><th class="num">EV% (raw, internal)</th><th>Confidence</th><th>Quote time</th></tr></thead><tbody>
      ${ranked.slice(0, 60).map((x, i) => `<tr><td class="num">${i + 1}</td><td><a class="plink" href="#/cv/player/${x.p.id}">${u.esc(x.p.name)}</a> <span class="pos">${x.p.pos}</span> <span class="muted mono">${x.team}</span></td><td>${STAT_N[x.stat]} ${x.e.q.side} ${x.line}${x.e.r.push ? ' <span class="badge">push</span>' : ''}</td><td>${u.esc(x.e.q.book)}</td><td class="num">${fmtA(x.e.q.american)}</td><td class="num">${u.pct(x.e.r.pWin)}</td><td class="num">${u.pct(x.e.r.pWinLower)}</td><td class="num">${u.pct(x.e.r.breakEven)}</td><td class="num ${x.e.r.cv > 0 ? 'pos' : 'neg'}"><b>${u.sgn(x.e.r.cv, 1)}</b></td><td class="num muted">${u.sgn(x.e.r.ev, 1)}</td><td>${grade(x.conf)}</td><td class="mono muted">${u.esc(x.e.q.ts.slice(5, 16))}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="why">No valid sportsbook quotes for this game yet, so <b>no CV% can be computed</b> (CV% requires an actual offered price). Add quotes in the <a href="#/cv/odds">Odds Desk</a> or run <span class="mono">ml/odds.py</span> with an authorised provider key. The research table below shows calibrated probabilities, conservative bounds and the fair / break-even prices you would need.</div>`;
    const research = rows.slice().sort((a, b) => (b.pLower ?? -1) - (a.pLower ?? -1));
    return `${header('cv')}<div class="grid">
      ${teamMLPanel()}
      ${c.panel('Single-Prop Case Value', 'CV% = 100 × [p_lower × D − 1] · push markets use p_win_lower × (D − 1) − p_loss_upper', `
        <div class="ctrl" style="margin-bottom:8px">${gameSel(g.game_id)}${c.tabs('cvmode', [{ k: 'cv', n: 'Highest CV%' }, { k: 'odds', n: 'Highest qualified + odds' }, { k: 'front', n: 'Odds–probability frontier' }], state.mode)}
          ${c.select('cv-stat', [{ v: 'ALL', n: 'All markets' }, ...Object.keys(STAT_T).map((k) => ({ v: k, n: STAT_N[k] }))], state.stat, { label: 'Market' })}</div>${lb}
        <div class="note">Qualified-odds mode requires CV% > 0, p_lower ≥ 20% and a confidence grade of C or better. CV% is an expected-value estimate under the conservative probability — not a guaranteed or observed return.</div>`)}
      ${c.panel('Calibrated Prop Probabilities', `${g.away.abbr} @ ${g.home.abbr} · champion model + validated distribution`, `<div class="tscroll" style="max-height:560px"><table class="tbl"><thead><tr><th>Player</th><th>Market (over)</th><th class="num">Model mean</th><th class="num">P(over)</th><th class="num">p lower</th><th class="num">Fair odds</th><th class="num">Need (CV≥0)</th><th class="num">|xgb−ag|</th><th>Confidence</th></tr></thead><tbody>
        ${research.slice(0, 400).map((r) => `<tr><td><a class="plink" href="#/cv/player/${r.p.id}">${u.esc(r.p.name)}</a> <span class="muted mono">${r.team}</span></td><td>${STAT_N[r.stat]} o${r.line}</td><td class="num">${u.fx(r.mu, 2)}</td><td class="num">${u.pct(r.pOver)}</td><td class="num">${r.pLower === null ? '<span class="muted">no table</span>' : u.pct(r.pLower)}</td><td class="num">${fmtA(NQ.cv.fair(r.pOver))}</td><td class="num">${r.pLower ? fmtA(NQ.cv.fair(r.pLower)) : '—'}</td><td class="num">${r.agree === undefined ? '—' : u.fx(r.agree, 3)}</td><td>${grade(r.conf)}</td></tr>`).join('')}</tbody></table></div>
        <div class="note">“Need (CV≥0)” = minimum American price at which the conservative probability breaks even. Over side shown; unders are evaluated when a quote exists.</div>`)}
    </div>`;
  }

  // ------------------------------------------------------------ team moneylines (Polymarket US)
  function teamMLPanel() {
    const S = SL(), O = globalThis.NQ_ODDS, cx = ctx();
    const tbl = (S.lower.t_win || {}).p;
    const quotes = NQ.odds.best(NQ.odds.load(), cx).filter((q) => q.market === 'team_ml');
    const age = (Date.now() - Date.parse(S.data_through)) / 3600000;
    const rows = [];
    for (const q of quotes) {
      const g = S.games.find((x) => String(x.game_id) === String(q.game_id));
      if (!g || !g.teamWin) continue;
      const D = q.decimal || NQ.cv.toDecimal(q.american);
      const r = NQ.cv.evalTeamML({ pHome: g.teamWin.pHome, table: tbl, side: q.side, decimal: D });
      const m = g.teamWin.models;
      const conf = NQ.cv.confidence({ coverage: (S.coverage.t_win || {}).p, sampleN: S.testN.t_win, agreement: m.xgboost !== undefined && m.autogluon !== undefined ? Math.abs(m.xgboost - m.autogluon) : undefined, gpPrior: 99, ageHours: age, beatsBaseline: S.beatsBaseline.t_win });
      rows.push({ q, g, r, conf, D });
    }
    rows.sort((a, b) => (b.r.cv ?? -1e9) - (a.r.cv ?? -1e9));
    const meta = O && O.polymarket ? `${O.polymarket.markets_open} open NHL game markets · Θ = ${O.polymarket.theta} (tier ${O.polymarket.tier}) · fetched ${u.esc(String(O.fetched_at).slice(5, 16))}Z` : 'feed not run';
    const stale = quotes.length === 0 && O && O.quotes && O.quotes.some((q) => q.provider === 'polymarket_us');
    const body = rows.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Game</th><th>Team</th><th class="num">Buy price</th><th class="num">Spread</th><th class="num">Depth @ price</th><th class="num">Gross</th><th class="num">Net of fee</th><th class="num">Model P(win)</th><th class="num">p lower</th><th class="num">Break-even</th><th class="num">CV%</th><th class="num">EV% (raw)</th><th>Confidence</th></tr></thead><tbody>
      ${rows.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${x.g.away.abbr} @ ${x.g.home.abbr} <span class="muted mono">${new Date(x.g.start_utc).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></td><td><b>${u.esc(x.q.team)}</b> <span class="muted">${x.q.side}</span></td><td class="num">${u.fx(x.q.price * 100, 0)}¢</td><td class="num">${u.fx((x.q.spread || 0) * 100, 0)}¢</td><td class="num ${x.q.depth_contracts < 500 ? 'warn' : ''}">${Math.round(x.q.depth_contracts || 0).toLocaleString()}</td><td class="num">${fmtA(NQ.cv.toAmerican(x.q.decimal_gross))}</td><td class="num"><b>${fmtA(x.q.american)}</b></td>
        <td class="num">${x.r.supported ? u.pct(x.r.pWin) : '—'}</td><td class="num">${x.r.supported ? u.pct(x.r.pWinLower) : '—'}</td><td class="num">${u.pct(1 / x.D)}</td><td class="num ${x.r.cv > 0 ? 'pos' : 'neg'}">${x.r.supported ? '<b>' + u.sgn(x.r.cv, 1) + '</b>' : u.esc(x.r.reason)}</td><td class="num muted">${x.r.supported ? u.sgn(x.r.ev, 1) : ''}</td><td>${grade(x.conf)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="why">${stale ? 'Polymarket quotes on file are older than ' + NQ.odds.MAX_AGE_MIN + ' minutes and are rejected as stale — re-run the feed.' : 'No Polymarket US quotes loaded.'} Refresh: <span class="mono">.venv/bin/python ml/polymarket.py</span></div>`;
    return c.panel('Team Moneylines — Polymarket US (live)', meta, body + `<div class="note">Real executable prices from the public Polymarket US gateway (no key; read-only). Net odds include the taker fee Θ·p·(1−p) per contract. Settlement matches the model target exactly: full game incl. OT and shootout. Polymarket US lists no NHL player props or totals, so it cannot price player-prop SGPs. Depth < 500 contracts flagged.</div>`, { demo: false });
  }

  function grade(cf) {
    const cls = cf.grade === 'A' ? 'b-pp' : cf.grade === 'B' ? 'b-pk' : cf.grade === 'C' ? 'b-arch' : '';
    return `<span class="badge ${cls}" title="${cf.checks.map(([n, ok]) => (ok ? '✓ ' : '✗ ') + n).join('\n')}">${cf.grade} · ${cf.met}/${cf.total}</span>`;
  }

  // ------------------------------------------------------------ SGP views
  function runGame(g) {
    const key = g.game_id + ':' + state.sims;
    if (!state.cache[key]) {
      const prm = SL().params;
      const t0 = performance.now();
      const R = NQ.joint.simulate(g, { n: state.sims, seed: 11 + g.game_id % 997, params: prm });
      const F = NQ.joint.simulate(g, { n: state.sims, seed: 7777 + g.game_id % 991, params: prm });
      state.cache[key] = { R, F, ms: performance.now() - t0, res: {} };
    }
    return state.cache[key];
  }

  function sgpView(size, params) {
    const g = findGame(params[0] || state.game);
    state.game = g.game_id;
    return `${header('sgp' + size)}<div class="grid">${c.panel(`${size}-Leg SGP Intelligence`, { 3: 'Concentrated probability architecture', 5: 'Balanced multi-factor architecture', 8: 'High-payout scenario intelligence — rare-event research module' }[size], `
      <div class="ctrl" style="margin-bottom:8px">${gameSel(g.game_id)}<label>Sims</label>${c.select('cv-sims', [10000, 20000, 50000].map((x) => ({ v: x, n: x.toLocaleString() })), state.sims, { label: 'Simulations' })}<button class="btn sm" id="cv-run">Run ${size}-leg research</button></div>
      ${size === 8 ? '<div class="why"><b>8-leg SGPs are rare-event bets and are never safe.</b> A combination is ranked only if its joint probability has enough simulated successes (≥ 80 hits, relative error ≤ 15%), a historical joint-calibration table exists, and a real combined quote is entered. Everything else is shown as unverified or unquoted.</div>' : ''}
      <div id="sgp-out">${c.loading('Simulating game and searching combinations…')}</div>`)}</div>`;
  }

  function sgpResults(size, g) {
    const run = runGame(g);
    if (!run.res[size]) {
      const quotes = NQ.odds.best(NQ.odds.load(), ctx());
      run.res[size] = NQ.sgp.research(run.R, run.F, g, size, VAL() ? VAL().tables : null, quotes);
    }
    const res = run.res[size];
    const items = res.items.slice();
    const quoted = items.filter((x) => x.best).sort((a, b) => b.best.cv - a.best.cv);
    // diversity: round-robin across ideology families, each family ordered by conservative joint P
    const byFam = {};
    items.filter((x) => !x.best).forEach((x) => { (byFam[x.family.id] = byFam[x.family.id] || []).push(x); });
    Object.values(byFam).forEach((a) => a.sort((p, q) => (q.lower.pLower ?? 0) - (p.lower.pLower ?? 0)));
    const unq = [];
    for (let k = 0; Object.values(byFam).some((a) => a.length > k); k++) Object.keys(byFam).sort().forEach((f) => { if (byFam[f][k]) unq.push(byFam[f][k]); });
    const row = (x, i) => `<tr data-sgp="${items.indexOf(x)}" style="cursor:pointer"><td class="num">${i + 1}</td><td><span class="badge b-arch">${x.family.id}</span> ${u.esc(x.family.n)}</td><td style="white-space:normal;min-width:260px">${x.legs.map((l) => `<a class="plink" href="#/cv/player/${l.player_id}">${u.esc(l.name)}</a> ${l.stat === 'SV' ? 'saves' : l.stat} o${l.line} <span class="muted">(${u.pct(l.p, 0)})</span>`).join('<br>')}</td>
      <td class="num">${u.pct(x.ev.p, 2)}</td><td class="num">${x.lower.pLower === null ? '—' : u.pct(x.lower.pLower, 2)}</td><td class="num">${u.pct(x.ev.indep, 2)}</td><td class="num">${u.fx(x.ev.lift, 2)}×</td>
      <td class="num">${fmtA(x.breakEven)}</td><td class="num">${x.best ? `${u.esc(x.best.book)} ${fmtA(x.best.american)}` : '<span class="muted">no quote</span>'}</td><td class="num ${x.best ? (x.best.cv > 0 ? 'pos' : 'neg') : ''}">${x.best ? '<b>' + u.sgn(x.best.cv, 1) + '</b>' : '—'}</td>
      <td>${x.lower.verified ? '<span class="badge b-pp">verified</span>' : `<span class="badge" title="${u.esc(x.lower.reason)}">unverified</span>`}</td><td class="num muted">${x.ev.hits}/${x.ev.n}</td></tr>`;
    const head = `<thead><tr><th>#</th><th>Ideology</th><th>Legs (individual P)</th><th class="num">Joint P</th><th class="num">Conservative</th><th class="num">If independent</th><th class="num">Lift</th><th class="num">Break-even</th><th class="num">Quote</th><th class="num">SGP CV%</th><th>Reliability</th><th class="num">MC hits</th></tr></thead>`;
    return `<div class="stats">${c.stat('Candidates evaluated', res.evaluated.toLocaleString(), { sub: 'beam search (not exhaustive)' })}${c.stat('Prop pool', res.poolSize)}${c.stat('Finalists', items.length)}${c.stat('Quoted', quoted.length)}${c.stat('Sim time', (run.ms / 1000).toFixed(1) + ' s', { sub: `${(2 * state.sims).toLocaleString()} games` })}${c.stat('Reconciliation', u.fx(run.R.recon[run.R.recon.length - 1], 3), { sub: 'mean |sim − model|' })}</div>
      <div class="sect">SGP leaderboard — ranked by SGP CV% (actual combined quotes only)</div>
      ${quoted.length ? `<div class="tscroll"><table class="tbl">${head}<tbody>${quoted.map(row).join('')}</tbody></table></div>` : '<div class="why">No combined SGP quotes entered for these combinations — <b>no SGP CV% is computed</b>. Click a candidate below and enter the sportsbook\'s quoted price for that exact combination.</div>'}
      <div class="sect">Research candidates (unquoted) — best of each ideology first, then by conservative joint probability</div>
      <div class="tscroll"><table class="tbl">${head}<tbody>${unq.map(row).join('')}</tbody></table></div>
      <div id="sgp-detail" style="margin-top:10px"></div>
      <div class="note">Joint probabilities come from the correlation-aware game simulator. Finalists are re-scored on an independent simulation (seed ≠ search seed). Conservative = min(Wilson lower bound, joint-calibration haircut for ${size}-leg from historical validation). Lift = joint ÷ product of marginals; high correlation is <b>not</b> automatically value — books may already price it.</div>`;
  }

  function sgpDetail(size, g, x) {
    const S = SL(), V = VAL(), run = runGame(g);
    const sc = x.scenario;
    const vs = V && V.summary[size];
    const modelRows = x.legs.map((l) => {
      const mc = S.models[`${g.game_id}:${l.player_id}`];
      const m = mc && mc[l.stat];
      const d = S.dist[STAT_T[l.stat]];
      const pr = (mu) => (mu === undefined || !d ? '—' : u.pct(NQ.cv.dist(mu, d.family, d.alpha).ge(Math.ceil(l.line)), 1));
      return `<tr><td>${u.esc(l.name)} ${l.stat === 'SV' ? 'saves' : l.stat} o${l.line}</td><td class="num">${u.pct(l.p, 1)}</td><td class="num">${m ? pr(m.baseline) : '—'}</td><td class="num">${m ? pr(m.xgboost) : '—'}</td><td class="num">${m ? pr(m.autogluon) : '—'}</td><td class="num">${m ? pr(m.blend) : '—'}</td></tr>`;
    }).join('');
    const ci = [NQ.cv.wilsonLower(x.ev.hits, x.ev.n), NQ.cv.wilsonUpper(x.ev.hits, x.ev.n)];
    return c.panel('Combination Detail', `${x.family.id} · ${u.esc(x.family.n)}`, `<div class="note" style="margin:0 0 8px">${u.esc(x.family.d)}</div>
      <div class="grid g3">
        <div><div class="sect">Joint probability &amp; uncertainty</div>
          <div class="stats">${c.stat('Joint P', u.pct(x.ev.p, 2))}${c.stat('MC 90% CI', `${u.pct(ci[0], 1)}–${u.pct(ci[1], 1)}`)}${c.stat('Conservative', x.lower.pLower === null ? '—' : u.pct(x.lower.pLower, 2))}${c.stat('Rel. MC error', u.pct(x.ev.relErr, 1))}</div>
          ${ch.bars([1 - x.ev.p, x.ev.p], { labels: ['miss', 'hit'], w: 200, h: 80, hl: (i) => (i ? 'hi' : 'lo') })}
          <div class="sect">Quote for this exact combination</div>
          <div class="ctrl"><input class="inp" id="sq-book" placeholder="Sportsbook" style="width:110px"><input class="inp" id="sq-odds" placeholder="+650" style="width:80px"><button class="btn sm" id="sq-add">Save quote</button></div>
          ${x.quotes.length ? x.quotes.map((q) => `<div class="mono">${u.esc(q.book)} ${fmtA(q.american)} · ${q.supported ? 'CV% ' + u.sgn(q.cv, 1) : u.esc(q.reason)}</div>`).join('') : '<div class="note">No quote stored.</div>'}</div>
        <div><div class="sect">Pairwise correlation (φ)</div><table class="mx"><thead><tr><th></th>${x.legs.map((_, i) => `<th>L${i + 1}</th>`).join('')}</tr></thead><tbody>${x.ev.phi.map((r, i) => `<tr><th>L${i + 1}</th>${r.map((v, j) => `<td style="background:${i === j ? 'var(--panel2)' : u.diverge(v * 2.5)}">${i === j ? '—' : u.fx(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <div class="note">Pairwise φ does not fully describe the joint distribution — the joint probability above is computed directly from all legs together.</div></div>
        <div><div class="sect">Scenario intelligence (when the parlay hits)</div>${sc.hit ? `<table class="tbl"><thead><tr><th>Game environment</th><th class="num">All sims</th><th class="num">Parlay hits</th></tr></thead><tbody>
          <tr><td>Total shots on goal</td><td class="num">${u.fx(sc.all.shots, 1)}</td><td class="num">${u.fx(sc.hit.shots, 1)}</td></tr><tr><td>Total goals</td><td class="num">${u.fx(sc.all.goals, 2)}</td><td class="num">${u.fx(sc.hit.goals, 2)}</td></tr>
          <tr><td>Power-play goals</td><td class="num">${u.fx(sc.all.ppg, 2)}</td><td class="num">${u.fx(sc.hit.ppg, 2)}</td></tr><tr><td>Home margin</td><td class="num">${u.sgn(sc.all.margin, 2)}</td><td class="num">${u.sgn(sc.hit.margin, 2)}</td></tr>
          <tr><td>Pace factor</td><td class="num">${u.fx(sc.all.pace, 3)}</td><td class="num">${u.fx(sc.hit.pace, 3)}</td></tr></tbody></table>` : c.empty('No hits in simulation')}</div>
      </div>
      <div class="grid g2" style="margin-top:8px"><div><div class="sect">Model comparison per leg — P(over)</div><table class="tbl"><thead><tr><th>Leg</th><th class="num">Joint sim</th><th class="num">Baseline</th><th class="num">XGBoost</th><th class="num">AutoGluon</th><th class="num">Blend</th></tr></thead><tbody>${modelRows}</tbody></table></div>
      <div><div class="sect">Historical validation — ${size}-leg (real held-out games)</div>${vs ? ['random_fit', 'random_eval', 'searched_fit', 'searched_eval'].filter((k) => vs[k]).map((k) => { const v = vs[k]; return `<div class="mono" style="font-size:12px">${k.padEnd(14)} n=${v.n} hit ${u.pct(v.hitRate, 1)} vs pred ${u.pct(v.meanP, 1)} (indep ${u.pct(v.meanIndep, 1)}) · Brier J/I ${u.fx(v.brierJoint, 4)}/${u.fx(v.brierIndep, 4)}</div>`; }).join('') : c.empty('Run node pipeline/validate_sgp.js')}
      <div class="note">Validation uses realised outcomes only; no historical SGP quotes exist in this repository, so no historical CV% or return is claimed.</div></div></div>`, { demo: false });
  }

  // ------------------------------------------------------------ odds desk
  function oddsView() {
    const list = NQ.odds.load(), cx = ctx();
    const S = SL();
    const pOpts = S.games.flatMap((g) => ['home', 'away'].flatMap((s) => [...g[s].players, ...g[s].goalies].map((p) => ({ v: g.game_id + ':' + p.id, n: `${g.away.abbr}@${g.home.abbr} · ${p.name}` }))));
    return `${header('odds')}<div class="grid g2">
      ${c.panel('Add Single-Prop Quote', 'exact market match required', `<div class="ctrl">
        <input class="inp" id="oq-book" placeholder="Sportsbook (required)" style="width:150px">
        <select id="oq-player" class="sel" aria-label="Player">${pOpts.map((o) => `<option value="${o.v}">${u.esc(o.n)}</option>`).join('')}</select>
        ${c.select('oq-market', Object.entries(NQ.odds.MARKETS).map(([k, m]) => ({ v: k, n: m.label })), 'player_sog', { label: 'Market' })}
        <input class="inp" id="oq-line" placeholder="Line e.g. 2.5" style="width:90px">${c.select('oq-side', [{ v: 'over', n: 'Over' }, { v: 'under', n: 'Under' }], 'over', { label: 'Side' })}
        <input class="inp" id="oq-odds" placeholder="American e.g. +135" style="width:120px"><button class="btn sm" id="oq-add">Add quote</button></div>
        <div id="oq-msg" class="note"></div>
        <div class="sect">Import quotes (JSON array)</div><textarea id="oq-json" class="inp" rows="5" style="width:100%" placeholder='[{"book":"…","game_id":2026020262,"market":"player_sog","player_id":8478402,"line":2.5,"side":"over","american":125,"ts":"2026-11-06T21:00:00Z","status":"open"}]'></textarea>
        <div class="ctrl" style="margin-top:6px"><button class="btn sm" id="oq-import">Import</button><button class="btn ghost sm" id="oq-export">Export my quotes</button><button class="btn ghost sm" id="oq-clear">Clear my quotes</button></div>
        <div class="note">Quotes you enter stay in this browser only. A quote older than ${NQ.odds.MAX_AGE_MIN} minutes, suspended, for a started game, or for a player not in that game's projected lineup is rejected. Automated feed: <span class="mono">ODDS_API_KEY=… .venv/bin/python ml/odds.py</span> (writes data/artifacts/odds_snapshot.js; combined SGP prices are not offered by that feed).</div>`)}
      ${c.panel('Quote Validation', `${list.length} stored`, list.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Book</th><th>Market</th><th>Player / legs</th><th class="num">Line</th><th class="num">Odds</th><th>Time</th><th>Source</th><th>Status</th></tr></thead><tbody>
        ${list.map((q) => { const m = NQ.odds.match(q, cx); return `<tr><td>${u.esc(q.book || '')}</td><td>${u.esc(q.market)}</td><td>${q.market === 'sgp' ? q.legs.length + ' legs' : q.player_id}</td><td class="num">${q.market === 'sgp' ? '' : q.line}</td><td class="num">${fmtA(q.american)}</td><td class="mono muted">${u.esc(String(q.ts).slice(5, 16))}</td><td>${q.source}</td><td class="${m.ok ? 'check-ok' : 'check-bad'}" title="${u.esc(m.reasons.join('; '))}">${m.ok ? 'VALID' : 'REJECTED: ' + u.esc(m.reasons[0])}</td></tr>`; }).join('')}</tbody></table></div>` : c.empty('No quotes. Nothing is priced until real quotes are entered or fed.'))}
    </div>`;
  }

  // ------------------------------------------------------------ models & validation
  function modelsView(params) {
    const M = ML(), V = VAL();
    const tid = params[0] && M.targets[params[0]] ? params[0] : 'sk_sog';
    const t = M.targets[tid];
    const lbRows = Object.entries(t.leaderboard).map(([k, v]) => `<tr ${k === t.champion ? 'class="sel-row"' : ''}><td>${k === t.champion ? '<b>' + k + ' ★</b>' : k}</td><td class="num">${u.fx(v.select, 4)}</td><td class="num">${u.fx(v.test, 4)}</td><td class="num">${v.test_mae === null || v.test_mae === undefined ? '—' : u.fx(v.test_mae, 4)}</td></tr>`).join('');
    const metricName = t.family === 'count' ? 'Poisson deviance ↓' : t.family === 'binary' ? 'log loss ↓' : 'RMSE ↓';
    const thrK = t.thresholds ? Object.keys(t.thresholds) : [];
    const thrSel = state.thr && thrK.includes(state.thr) ? state.thr : thrK[Math.floor(thrK.length / 2)] || null;
    const th = thrSel ? t.thresholds[thrSel] : null;
    const imp = (o) => Object.entries(o || {}).slice(0, 12).map(([k, v]) => `<tr><td class="mono">${u.esc(k)}</td><td class="num">${u.fx(+v, 4)}</td></tr>`).join('');
    const rel = th ? th.reliability : t.binary ? t.binary.reliability : [];
    const sgpRows = V ? [3, 5, 8].flatMap((s) => Object.entries(V.summary[s]).map(([k, v]) => `<tr><td>${s}-leg</td><td>${k.replace('_', ' / ')}</td><td class="num">${v.n}</td><td class="num">${u.pct(v.hitRate, 1)}</td><td class="num">${u.pct(v.meanP, 1)}</td><td class="num">${u.pct(v.meanIndep, 1)}</td><td class="num ${v.brierJoint < v.brierIndep ? 'pos' : 'neg'}">${u.fx(v.brierJoint, 4)}</td><td class="num">${u.fx(v.brierIndep, 4)}</td><td class="num ${v.llJoint < v.llIndep ? 'pos' : 'neg'}">${u.fx(v.llJoint, 4)}</td><td class="num">${u.fx(v.llIndep, 4)}</td><td class="num">${v.lowerCoverage.covered}/${v.lowerCoverage.bins}</td></tr>`)).join('') : '';
    return `${header('models')}<div class="grid">
      <div class="ctrl">${c.select('mv-t', Object.keys(M.targets).map((k) => ({ v: k, n: k })), tid, { label: 'Target' })}${thrK.length ? c.select('mv-k', thrK.map((k) => ({ v: k, n: 'P(X ≥ ' + k + ')' })), thrSel, { label: 'Threshold' }) : ''}
        <span class="pill">Trained <b>${u.esc(M.trained_at.slice(0, 16))}</b></span><span class="pill">Windows: train &lt; ${M.windows.train_end} · tune &lt; ${M.windows.tune_end} · select &lt; ${M.windows.select_end} · test ≥ ${M.windows.select_end}</span></div>
      <div class="grid g3">
        ${c.panel('Champion / Challenger', `${tid} · ${metricName}`, `<table class="tbl"><thead><tr><th>Model</th><th class="num">Select</th><th class="num">Test (held out)</th><th class="num">Test MAE</th></tr></thead><tbody>${lbRows}</tbody></table>
          <div class="note">Champion chosen on the SELECT window only; must beat the baseline there. TEST is never used for any decision. Rows: train ${t.n.train.toLocaleString()} · tune ${t.n.tune.toLocaleString()} · select ${t.n.select.toLocaleString()} · test ${t.n.test.toLocaleString()}.</div>
          ${t.dist ? `<div class="sect">Distribution family (select window)</div>${Object.entries(t.dist).map(([k, d]) => `<div class="mono" style="font-size:12px">${k}: ${d.family}${d.alpha ? ' α=' + d.alpha : ''} · LL/obs ${u.fx(d.ll_per_obs, 4)}</div>`).join('')}` : ''}
          ${t.continuous ? `<div class="sect">Residuals</div><div class="mono">sd ${u.fx(t.continuous.resid_sd, 2)} · 80% interval test coverage ${u.pct(t.continuous.test_cover_80)}</div>` : ''}`)}
        ${c.panel('Calibration (held-out test)', th ? `P(X ≥ ${thrSel}) · base rate ${u.pct(th.test_rate)}` : t.binary ? 'probability' : '—', rel.length ? ch.calib(rel.map((r) => ({ pred: r.pred, obs: r.obs, n: r.n })), { lo: 0, hi: Math.min(1, Math.max(...rel.map((r) => Math.max(r.pred, r.obs))) * 1.1), dp: 2 }) + (th ? `<table class="tbl"><thead><tr><th>Model</th><th class="num">Brier</th><th class="num">Log loss</th></tr></thead><tbody>${Object.entries(th.models).map(([k, v]) => `<tr ${k === t.champion ? 'class="sel-row"' : ''}><td>${k}</td><td class="num">${u.fx(v.brier, 4)}</td><td class="num">${u.fx(v.logloss, 4)}</td></tr>`).join('')}</tbody></table><div class="note">Conservative-bound coverage on test: ${th.coverage.covered}/${th.coverage.bins} probability bins realised ≥ their mean p_lower (${u.pct(th.coverage.rate, 0)}).</div>` : t.binary ? `<div class="note">Bound coverage ${t.binary.coverage.covered}/${t.binary.coverage.bins}</div>` : '') : c.empty('No calibration data'))}
        ${c.panel('Feature Importance', 'predictive, not causal', `<div class="grid g2"><div><div class="sect">XGBoost mean |SHAP|</div><table class="tbl"><tbody>${imp(t.shap)}</tbody></table></div><div><div class="sect">AutoGluon permutation</div><table class="tbl"><tbody>${imp(t.ag_importance)}</tbody></table></div></div>`)}
      </div>
      <div class="grid g2">
        ${c.panel('AutoGluon Leaderboard', 'held-out test scores (higher = better, AutoGluon sign convention)', t.ag_leaderboard ? `<table class="tbl"><thead><tr><th>Model</th><th class="num">Test</th><th class="num">Val</th><th class="num">Fit s</th></tr></thead><tbody>${t.ag_leaderboard.map((r) => `<tr><td>${u.esc(r.model)}</td><td class="num">${u.fx(r.score_test, 4)}</td><td class="num">${u.fx(r.score_val, 4)}</td><td class="num">${u.fx(r.fit_time, 1)}</td></tr>`).join('')}</tbody></table>` : c.empty('AutoGluon not trained'))}
        ${c.panel('XGBoost Hyper-parameter Search', `best rounds ${t.xgb_rounds}`, `<table class="tbl"><thead><tr><th>max_depth</th><th>min_child_weight</th><th>reg_lambda</th><th class="num">rounds</th><th class="num">tune metric</th></tr></thead><tbody>${(t.xgb_search || []).map((r) => { const m = Object.keys(r).find((k) => k.startsWith('tune_')); return `<tr><td>${r.params.max_depth}</td><td>${r.params.min_child_weight}</td><td>${r.params.reg_lambda}</td><td class="num">${r.rounds}</td><td class="num">${u.fx(r[m], 5)}</td></tr>`; }).join('')}</tbody></table>`)}
      </div>
      ${c.panel('All Targets — Held-out Summary', '', `<div class="tscroll"><table class="tbl"><thead><tr><th>Target</th><th>Family</th><th>Champion</th><th class="num">Baseline (test)</th><th class="num">XGBoost (test)</th><th class="num">AutoGluon (test)</th><th class="num">Blend (test)</th><th class="num">Champion (test)</th><th class="num">Train s</th></tr></thead><tbody>
        ${Object.entries(M.targets).map(([k, v]) => `<tr><td><a href="#/cv/models/${k}">${k}</a></td><td>${v.family}</td><td><b>${v.champion}</b></td>${['baseline', 'xgboost', 'autogluon', 'blend'].map((m) => `<td class="num">${v.leaderboard[m] ? u.fx(v.leaderboard[m].test, 4) : '—'}</td>`).join('')}<td class="num"><b>${u.fx(v.leaderboard[v.champion].test, 4)}</b></td><td class="num">${M.timing[k]}</td></tr>`).join('')}</tbody></table></div>`)}
      ${c.panel('SGP Joint-Probability Validation', V ? `${V.games} real held-out games · ${V.rows} settled combinations · ${V.sims} sims each` : 'not run', V ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Size</th><th>Stream / window</th><th class="num">n</th><th class="num">Hit rate</th><th class="num">Mean joint P</th><th class="num">Mean indep P</th><th class="num">Brier joint</th><th class="num">Brier indep</th><th class="num">LL joint</th><th class="num">LL indep</th><th class="num">Lower-bound coverage</th></tr></thead><tbody>${sgpRows}</tbody></table></div>
        <div class="grid g3" style="margin-top:8px">${[3, 5, 8].map((s) => { const v = V.summary[s].random_eval || V.summary[s].random_fit; return v ? `<div><div class="sect">${s}-leg calibration (random, ${V.summary[s].random_eval ? 'eval' : 'fit'})</div>${ch.calib(v.calibration.map((b) => ({ pred: b.pred, obs: b.obs, n: b.n })), { lo: 0, hi: Math.min(1, Math.max(...v.calibration.map((b) => Math.max(b.pred, b.obs))) * 1.15), dp: 2, w: 240, h: 200 })}</div>` : ''; }).join('')}</div>
        <div class="note">${u.esc(V.note)} Bounds fitted on games before ${V.split}, coverage evaluated after. Joint params: ${u.esc(JSON.stringify(V.params).slice(0, 220))}…</div>` : c.empty('Run node pipeline/validate_sgp.js'))}
    </div>`;
  }

  // ------------------------------------------------------------ real player
  function playerView(params) {
    const S = SL(), id = +params[0];
    let p = null, g = null, team = '';
    for (const gg of S.games) for (const s of ['home', 'away']) for (const x of gg[s].players) if (x.id === id && !p) { p = x; g = gg; team = gg[s].abbr; }
    if (!p) return header('') + c.empty('Player not on the current slate.');
    const rec = S.recent[id] || [];
    const mc = S.models[`${g.game_id}:${id}`] || {};
    return `${header('')}<div class="grid g2">
      ${c.panel(u.esc(p.name), `${p.pos} · ${team} · next: ${g.away.abbr} @ ${g.home.abbr}`, `<div class="note" style="margin:0 0 8px">Real NHL player · ${p.gpPrior} prior games in dataset · projected TOI rank ${p.toiRank} · <a href="https://www.nhl.com/player/${id}" target="_blank" rel="noopener">NHL.com profile</a></div>
        <table class="tbl"><thead><tr><th>Stat</th><th class="num">Champion mean</th><th class="num">Baseline</th><th class="num">XGBoost</th><th class="num">AutoGluon</th><th class="num">P(≥1)</th><th class="num">P(≥2)</th><th class="num">P(≥3)</th></tr></thead><tbody>
        ${Object.keys(STAT_T).map((s) => { const d = S.dist[STAT_T[s]]; const D = d ? NQ.cv.dist(p.mu[s], d.family, d.alpha) : null; const m = mc[s] || {}; return `<tr><td>${STAT_N[s]}</td><td class="num"><b>${u.fx(p.mu[s], 2)}</b></td><td class="num">${u.fx(m.baseline, 2)}</td><td class="num">${u.fx(m.xgboost, 2)}</td><td class="num">${u.fx(m.autogluon, 2)}</td><td class="num">${D ? u.pct(D.ge(1)) : '—'}</td><td class="num">${D ? u.pct(D.ge(2)) : '—'}</td><td class="num">${D ? u.pct(D.ge(3)) : '—'}</td></tr>`; }).join('')}
        <tr><td>TOI (min)</td><td class="num"><b>${u.fx(p.mu.TOI, 1)}</b></td><td class="num">${u.fx((mc.TOI || {}).baseline, 1)}</td><td class="num">${u.fx((mc.TOI || {}).xgboost, 1)}</td><td class="num">${u.fx((mc.TOI || {}).autogluon, 1)}</td><td colspan="3"></td></tr></tbody></table>`, { demo: false })}
      ${c.panel('Last 10 Games', 'real box scores', `<table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th class="num">TOI</th><th class="num">G</th><th class="num">A</th><th class="num">SOG</th><th class="num">BLK</th><th class="num">HIT</th><th class="num">PPP</th></tr></thead><tbody>${rec.slice().reverse().map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[2] ? 'vs' : '@'} ${u.esc(r[1])}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td><td class="num">${r[5]}</td><td class="num">${r[6]}</td><td class="num">${r[7]}</td><td class="num">${r[8]}</td><td class="num">${r[9]}</td></tr>`).join('')}</tbody></table>`, { demo: false })}
    </div>`;
  }

  // ------------------------------------------------------------ route
  NQ.views.cv = {
    render(params) {
      if (!SL() || !ML()) return missing();
      const sub = params[0] || '';
      if (sub === 'odds') return oddsView();
      if (sub === 'models') return modelsView(params.slice(1));
      if (sub === 'player') return playerView(params.slice(1));
      if (/^sgp[358]$/.test(sub)) return sgpView(+sub.slice(3), params.slice(1));
      return cvView(params);
    },
    mount(root, params) {
      if (!SL() || !ML()) return;
      const sub = params[0] || '';
      const gs = root.querySelector('#cv-game');
      if (gs) gs.addEventListener('change', (e) => { state.game = +e.target.value; location.hash = /^sgp/.test(sub) ? `#/cv/${sub}/${state.game}` : `#/cv/${state.game}`; });
      NQ.app.wireTabs(root, (id, k) => { if (id === 'cvmode') { state.mode = k; NQ.app.rerender(); } });
      const st = root.querySelector('#cv-stat'); if (st) st.addEventListener('change', (e) => { state.stat = e.target.value; NQ.app.rerender(); });
      const mt = root.querySelector('#mv-t'); if (mt) mt.addEventListener('change', (e) => { location.hash = '#/cv/models/' + e.target.value; });
      const mk = root.querySelector('#mv-k'); if (mk) mk.addEventListener('change', (e) => { state.thr = e.target.value; NQ.app.rerender(); });
      if (/^sgp[358]$/.test(sub)) {
        const size = +sub.slice(3), g = findGame(params[1] || state.game);
        const draw = () => {
          const out = root.querySelector('#sgp-out');
          setTimeout(() => {
            out.innerHTML = sgpResults(size, g);
            const run = runGame(g), res = run.res[size];
            out.querySelectorAll('[data-sgp]').forEach((tr) => tr.addEventListener('click', () => {
              const x = res.items[+tr.dataset.sgp];
              const det = out.querySelector('#sgp-detail');
              det.innerHTML = sgpDetail(size, g, x);
              det.scrollIntoView({ block: 'nearest' });
              det.querySelector('#sq-add').addEventListener('click', () => {
                const book = det.querySelector('#sq-book').value.trim(), am = +det.querySelector('#sq-odds').value.replace('+', '');
                const q = { book, game_id: g.game_id, market: 'sgp', american: am, ts: new Date().toISOString(), status: 'open', legs: x.legs.map((l) => ({ market: l.market, player_id: l.player_id, line: l.line, side: 'over' })) };
                const err = NQ.odds.validate(q);
                if (err.length) { alert('Quote rejected: ' + err.join('; ')); return; }
                NQ.odds.add(q); delete run.res[size]; draw();
              });
            }));
          }, 20);
        };
        root.querySelector('#cv-sims').addEventListener('change', (e) => { state.sims = +e.target.value; });
        root.querySelector('#cv-run').addEventListener('click', () => { root.querySelector('#sgp-out').innerHTML = c.loading('Simulating…'); delete (runGame(g).res || {})[size]; draw(); });
        draw();
      }
      if (sub === 'odds') {
        const $ = (s) => root.querySelector(s);
        $('#oq-add').addEventListener('click', () => {
          const [gid, pid] = $('#oq-player').value.split(':').map(Number);
          const q = { book: $('#oq-book').value.trim(), game_id: gid, market: $('#oq-market').value, player_id: pid, line: parseFloat($('#oq-line').value), side: $('#oq-side').value, american: +$('#oq-odds').value.replace('+', ''), ts: new Date().toISOString(), status: 'open' };
          const m = NQ.odds.match(q, ctx());
          if (!m.ok) { $('#oq-msg').innerHTML = '<span class="neg">Rejected: ' + u.esc(m.reasons.join('; ')) + '</span>'; return; }
          NQ.odds.add(q); NQ.app.rerender();
        });
        $('#oq-import').addEventListener('click', () => { try { const r = NQ.odds.importJSON($('#oq-json').value); alert(`Imported ${r.added}, rejected ${r.rejected.length}`); NQ.app.rerender(); } catch (e) { alert('Import failed: ' + e.message); } });
        $('#oq-export').addEventListener('click', () => { const blob = new Blob([JSON.stringify(NQ.odds.load().filter((q) => q.source !== 'feed'), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'case-capital-quotes.json'; a.click(); });
        $('#oq-clear').addEventListener('click', () => { if (confirm('Delete all quotes you entered in this browser?')) { NQ.odds.saveUser([]); NQ.app.rerender(); } });
      }
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

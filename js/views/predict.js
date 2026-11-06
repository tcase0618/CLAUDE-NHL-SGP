/* ==========================================================================
 * Prediction Engine — scenario controls, Monte Carlo game forecast, full
 * projected box scores, factor explanations and a same-game-parlay builder
 * that reads joint probabilities directly from the simulated games.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];
  const STATS = [['G', 'Goals'], ['A', 'Assists'], ['PTS', 'Points'], ['SOG', 'Shots on goal'], ['BLK', 'Blocked shots'], ['HIT', 'Hits'], ['PPP', 'PP points']];

  const view = {
    cfg: null, res: null, legs: [], odds: '',
    key(h, a) { return h + '-' + a; }
  };

  function gameOptions(st) {
    const up = st.season.upcoming.filter((g) => g.round < st.season.PLAYED_ROUNDS + 3);
    return up.map((g) => ({ v: `${TM(g.home).abbr}/${TM(g.away).abbr}`, n: `${g.date} · ${TM(g.away).abbr} @ ${TM(g.home).abbr}` }));
  }

  function controls(st, H, A, cfg) {
    const teams = st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((x) => ({ v: x.abbr, n: x.abbr }));
    const gOpt = (t) => [{ v: 'auto', n: 'Auto (prob-weighted)' }, { v: '18', n: P(t.roster[18]).last + ' (G1)' }, { v: '19', n: P(t.roster[19]).last + ' (G2)' }];
    const scr = (t) => `<details><summary class="muted" style="cursor:pointer">${t.abbr} scratches (${t.roster.slice(0, 18).filter((id) => cfg.scratches.has(id)).length})</summary><div style="columns:2;margin-top:4px">${t.roster.slice(0, 18).map((id) => `<label class="chk"><input type="checkbox" data-scr="${id}" ${cfg.scratches.has(id) ? 'checked' : ''}>${u.esc(P(id).last)} <span class="pos">${P(id).pos}</span></label>`).join('<br>')}</div></details>`;
    return `<div class="ctrl"><label>Game</label><select id="pe-game" class="sel" aria-label="Upcoming game"><option value="">Custom matchup…</option>${gameOptions(st).map((o) => `<option value="${o.v}" ${o.v === `${H.abbr}/${A.abbr}` ? 'selected' : ''}>${o.n}</option>`).join('')}</select>
      <label>Home</label>${c.select('pe-h', teams, H.abbr, { label: 'Home team' })}<label>Away</label>${c.select('pe-a', teams, A.abbr, { label: 'Away team' })}
      <label>Sims</label>${c.select('pe-n', [{ v: 1000, n: '1,000' }, { v: 3000, n: '3,000' }, { v: 6000, n: '6,000' }, { v: 10000, n: '10,000' }], cfg.n, { label: 'Simulations' })}
      <button class="btn" id="pe-run">Run simulation</button></div>
      <div class="grid g4" style="margin-top:8px">
        <div><label class="muted">${H.abbr} goalie</label><br>${c.select('pe-gh', gOpt(H), cfg.starterH, { label: 'Home goalie' })}</div>
        <div><label class="muted">${A.abbr} goalie</label><br>${c.select('pe-ga', gOpt(A), cfg.starterA, { label: 'Away goalie' })}</div>
        <div><label class="muted">Rest days (H / A)</label><br>${c.select('pe-rh', [0, 1, 2, 3].map((x) => ({ v: x, n: x + 'd' })), cfg.restH, { label: 'Home rest' })} ${c.select('pe-ra', [0, 1, 2, 3].map((x) => ({ v: x, n: x + 'd' })), cfg.restA, { label: 'Away rest' })}</div>
        <div class="note" style="margin:0">Scenario simulator: change starters, rest or scratch players (replaced by a replacement-level call-up) and re-run.</div>
      </div>
      <div class="grid g2" style="margin-top:6px">${scr(H)}${scr(A)}</div>`;
  }

  function factorsHtml(st, H, A, res) {
    const gH = res.goalies.filter((g) => g.t === 0).sort((a, b) => b.pStart - a.pStart)[0], gA = res.goalies.filter((g) => g.t === 1).sort((a, b) => b.pStart - a.pStart)[0];
    const q = NQ.predict.quickModel(NQ.predict.teamInputs(st, H.id, gH.pid), NQ.predict.teamInputs(st, A.id, gA.pid), { explain: true, restH: res.restH, restA: res.restA });
    const top = q.factors[0];
    return `${q.factors.map((f) => `<div class="factor"><span>${f.label}</span><span class="fb"><i style="left:${f.delta >= 0 ? 50 : 50 + Math.max(-50, f.delta * 500)}%;width:${Math.min(50, Math.abs(f.delta) * 500)}%;background:${f.delta >= 0 ? 'var(--pos)' : 'var(--neg)'}"></i></span><span class="num r">${u.sgn(f.delta * 100, 1)}%</span></div>`).join('')}
      <div class="why">The biggest driver is <b>${top.label.toLowerCase()}</b> (${u.sgn(top.delta * 100, 1)} pts of ${H.abbr} win probability). Analytic layer: ${H.abbr} ${u.pct(q.win)} · simulation: ${u.pct(res.winH)}. The simulator adds lineup-level detail (line matchups, PP units, goalie pulls, OT/SO rules) that the analytic Poisson layer ignores.</div>
      <div class="note">Each bar = change in ${H.abbr} win probability when that factor is reset to league average.</div>`;
  }

  function totalsHtml(res) {
    const lines = [4.5, 5.5, 6.5, 7.5];
    let over = (L) => res.total.reduce((s, p, k) => s + (k > L ? p : 0), 0);
    return `${ch.bars(res.total.slice(0, 13), { labels: [...Array(13).keys()].map(String), hl: (i) => (i >= 6 ? 'hi' : '') })}
      <table class="tbl"><thead><tr><th>Total</th><th class="num">Over</th><th class="num">Under</th><th class="num">Fair (O)</th></tr></thead><tbody>${lines.map((L) => { const o = over(L); return `<tr><td>${L}</td><td class="num">${u.pct(o)}</td><td class="num">${u.pct(1 - o)}</td><td class="num">${fmtOdds(NQ.predict.toAmerican(o))}</td></tr>`; }).join('')}</tbody></table>
      <div class="note">Mean total ${u.fx(res.totalMean, 2)} goals (incl. shootout winner goal).</div>`;
  }
  const fmtOdds = (o) => (o === null ? '—' : o > 0 ? '+' + o : String(o));

  function strengthHtml(res, H, A) {
    const r = (t, s) => `<tr><td>${c.team(t)}</td><td class="num">${u.fx(s.g5, 2)}</td><td class="num">${u.fx(s.gpp, 2)}</td><td class="num">${u.fx(s.gsh, 2)}</td><td class="num">${u.fx(s.gen, 2)}</td><td class="num">${u.fx(s.ppo, 2)}</td><td class="num">${u.fx(s.sog, 1)}</td></tr>`;
    return `<table class="tbl"><thead><tr><th>Team</th><th class="num">5v5 G</th><th class="num">PP G</th><th class="num">SH G</th><th class="num">EN G</th><th class="num">PP opp</th><th class="num">SOG</th></tr></thead><tbody>${r(H, res.home)}${r(A, res.away)}</tbody></table>
      <div class="grid g2" style="margin-top:6px"><div><div class="sect">${H.abbr} SOG distribution</div>${ch.bars(res.home.sogDist.slice(15, 46), { labels: [...Array(31).keys()].map((i) => String(i + 15)), every: 5 })}</div>
      <div><div class="sect">${A.abbr} SOG distribution</div>${ch.bars(res.away.sogDist.slice(15, 46), { labels: [...Array(31).keys()].map((i) => String(i + 15)), every: 5 })}</div></div>`;
  }

  function goaliesHtml(res) {
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Goalie</th><th class="num">Start</th><th class="num">SA</th><th class="num">Saves</th><th class="num">90%</th><th class="num">GA</th><th class="num">SV%</th><th class="num">SO</th><th class="num">Win|start</th></tr></thead><tbody>
      ${res.goalies.map((g) => `<tr><td>${c.pname(P(g.pid))} <span class="muted mono">${TM(P(g.pid).teamId).abbr}</span></td><td class="num">${u.pct(g.pStart, 0)}</td>${g.pStart ? `<td class="num">${u.fx(g.sa, 1)}</td><td class="num">${u.fx(g.sv, 1)}</td><td class="num">${g.svLo}–${g.svHi}</td><td class="num">${u.fx(g.ga, 2)}</td><td class="num">${u.sv(g.svPct)}</td><td class="num">${u.pct(g.shutout)}</td><td class="num">${u.pct(g.win)}</td>` : '<td colspan="7" class="muted">not projected to start</td>'}</tr>`).join('')}</tbody></table></div>`;
  }

  function boxHtml(res, side) {
    const rows = res.players.filter((r) => r.t === side);
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Skater</th><th>Unit</th><th class="num">TOI</th><th class="num">G</th><th class="num">A</th><th class="num">PTS</th><th class="num">SOG</th><th class="num">BLK</th><th class="num">HIT</th><th class="num">PPP</th><th class="num">FOW</th><th class="num">P(G≥1)</th><th class="num">P(PTS≥1)</th><th class="num">P(PTS≥2)</th><th class="num">P(SOG≥3)</th><th>Points</th></tr></thead><tbody>
      ${rows.map((r) => { const p = P(r.pid); return `<tr ${r.scratched ? 'class="muted"' : ''}><td>${r.scratched ? '<s>' + u.esc(p.last) + '</s> → call-up' : c.pname(p, { short: true, pos: true })}</td><td class="muted">${p.isD ? 'P' + p.pair : 'L' + p.line}</td><td class="num">${u.toi(r.TOI)}</td><td class="num">${u.fx(r.G.mean)}</td><td class="num">${u.fx(r.A.mean)}</td><td class="num"><b>${u.fx(r.PTS.mean)}</b></td><td class="num">${u.fx(r.SOG.mean, 1)}</td><td class="num">${u.fx(r.BLK.mean, 1)}</td><td class="num">${u.fx(r.HIT.mean, 1)}</td><td class="num">${u.fx(r.PPP.mean)}</td><td class="num">${u.fx(r.FOW.mean, 1)}</td><td class="num">${u.pct(r.G.ge(1))}</td><td class="num">${u.pct(r.PTS.ge(1))}</td><td class="num">${u.pct(r.PTS.ge(2))}</td><td class="num">${u.pct(r.SOG.ge(3))}</td><td>${ch.mini(r.PTS.dist)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  // ------------------------------------------------------------ SGP builder
  function legLabel(leg, res) {
    const H = TM(res.homeId), A = TM(res.awayId), tn = (s) => (s === 0 ? H.abbr : A.abbr);
    switch (leg.kind) {
      case 'win': return `${tn(leg.side)} moneyline (incl. OT/SO)`;
      case 'reg': return `${tn(leg.side)} regulation win (60 min)`;
      case 'ot': return 'Game goes to overtime';
      case 'total': return `Total goals ${leg.op} ${leg.line}`;
      case 'ttotal': return `${tn(leg.side)} team total ${leg.op} ${leg.line}`;
      case 'player': return `${P(leg.pid).first[0]}. ${P(leg.pid).last} ${leg.k}+ ${STATS.find((s) => s[0] === leg.stat)[1].toLowerCase()}`;
      case 'goalie': return leg.stat === 'SO' ? `${P(leg.pid).last} shutout (win)` : `${P(leg.pid).last} ${leg.k}+ saves`;
      default: return '?';
    }
  }

  function sgpForm(res) {
    const H = TM(res.homeId), A = TM(res.awayId);
    const players = res.players.filter((r) => !r.scratched).map((r) => ({ v: r.pid, n: `${TM(r.t === 0 ? res.homeId : res.awayId).abbr} · ${P(r.pid).last} (${P(r.pid).pos})` }));
    const goalies = res.goalies.filter((g) => g.pStart > 0).map((g) => ({ v: g.pid, n: `${TM(g.t === 0 ? res.homeId : res.awayId).abbr} · ${P(g.pid).last}` }));
    return `<div class="ctrl">${c.select('sg-kind', [{ v: 'player', n: 'Player prop' }, { v: 'win', n: 'Moneyline' }, { v: 'reg', n: 'Regulation win' }, { v: 'total', n: 'Game total' }, { v: 'ttotal', n: 'Team total' }, { v: 'ot', n: 'Goes to OT' }, { v: 'goalie', n: 'Goalie saves' }, { v: 'so', n: 'Goalie shutout' }], 'player', { label: 'Leg type' })}
      <span data-f="player">${c.select('sg-pid', players, players[0] && players[0].v, { label: 'Player' })}${c.select('sg-stat', STATS.map(([v, n]) => ({ v, n })), 'PTS', { label: 'Stat' })}${c.select('sg-k', [1, 2, 3, 4, 5].map((k) => ({ v: k, n: k + '+' })), 1, { label: 'Threshold' })}</span>
      <span data-f="side" hidden>${c.select('sg-side', [{ v: 0, n: H.abbr }, { v: 1, n: A.abbr }], 0, { label: 'Team' })}</span>
      <span data-f="ou" hidden>${c.select('sg-op', [{ v: 'over', n: 'Over' }, { v: 'under', n: 'Under' }], 'over', { label: 'Over/under' })}${c.select('sg-line', [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((x) => ({ v: x, n: x })), 5.5, { label: 'Line' })}</span>
      <span data-f="goalie" hidden>${c.select('sg-gid', goalies, goalies[0] && goalies[0].v, { label: 'Goalie' })}<span data-f="gk">${c.select('sg-gk', [20, 22, 25, 28, 30, 32, 35].map((k) => ({ v: k, n: k + '+' })), 25, { label: 'Saves' })}</span></span>
      <button class="btn sm" id="sg-add">+ Add leg</button><button class="btn ghost sm" id="sg-sugg">Suggest correlated legs</button><button class="btn ghost sm" id="sg-clear">Clear</button></div>
      <div id="sg-out" style="margin-top:10px"></div>`;
  }

  function sgpOut(res) {
    if (!view.legs.length) return c.empty('Add legs to price a same-game parlay from the simulated joint distribution.');
    const r = NQ.predict.sgp(res, view.legs);
    const fair = NQ.predict.toAmerican(r.joint), naive = NQ.predict.toAmerican(r.indep);
    const odds = parseFloat(view.odds);
    let ev = '';
    if (isFinite(odds) && odds !== 0 && Math.abs(odds) >= 100) {
      const dec = NQ.predict.decimalOf(odds), e = r.joint * dec - 1, kelly = Math.max(0, (r.joint * dec - 1) / (dec - 1));
      ev = `${c.stat('Offered', fmtOdds(odds), { sub: `implied ${u.pct(NQ.predict.fromAmerican(odds))}` })}${c.stat('EV / $1', u.sgn(e, 3), { cls: e > 0 ? 'hl' : 'bad' })}${c.stat('Kelly fraction', u.pct(kelly), { sub: 'quarter-Kelly ' + u.pct(kelly / 4) })}`;
    }
    return `<div class="legs">${view.legs.map((l, i) => `<div class="leg"><span>${u.esc(legLabel(l, res))}</span><span class="num r">${u.pct(r.single[i])}</span><span class="num r muted">${fmtOdds(NQ.predict.toAmerican(r.single[i]))}</span><button class="x" data-del="${i}" aria-label="Remove leg">×</button></div>`).join('')}</div>
      <div class="stats" style="margin-top:10px">${c.stat('Joint probability', u.pct(r.joint, 2), { sub: `± ${u.pct(1.96 * r.se, 2)} (95%)` })}${c.stat('Fair odds', fmtOdds(fair))}${c.stat('If independent', u.pct(r.indep, 2), { sub: fmtOdds(naive) })}${c.stat('Correlation lift', u.fx(r.lift, 2) + '×', { cls: r.lift > 1 ? 'hl' : 'bad' })}${ev}</div>
      <div class="ctrl" style="margin-top:8px"><label>Offered parlay odds (American)</label><input class="inp" id="sg-odds" placeholder="e.g. +450" value="${u.esc(view.odds)}" style="width:110px"></div>
      ${view.legs.length > 1 ? `<div class="sect">Leg correlation (φ, from ${res.n.toLocaleString()} sims)</div><table class="mx"><thead><tr><th></th>${view.legs.map((_, i) => `<th>L${i + 1}</th>`).join('')}</tr></thead><tbody>${r.phi.map((row, i) => `<tr><th>L${i + 1}</th>${row.map((v, j) => `<td style="background:${i === j ? 'var(--panel2)' : u.diverge(v * 2.5)}">${i === j ? '—' : u.fx(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      <div class="why">Same-game legs are <b>not independent</b>: a goal by a first-line winger also lifts the center's assist odds, the team total and the moneyline. Because every leg is evaluated on the same simulated games, the joint probability already contains that correlation. A lift above 1.0× means the books' independent pricing would understate the parlay.</div>`;
  }

  function suggest(res) {
    const side = res.winH >= 0.5 ? 0 : 1;
    const top = res.players.filter((r) => r.t === side && !r.scratched).sort((a, b) => b.PTS.mean - a.PTS.mean);
    const legs = [{ kind: 'win', side }];
    if (top[0]) legs.push({ kind: 'player', pid: top[0].pid, stat: 'PTS', k: 1 });
    // linemate of the top skater (same line, highest assist mean)
    const tp = P(top[0].pid), team = TM(side === 0 ? res.homeId : res.awayId);
    const mates = tp.isD ? [] : team.lines[tp.line - 1].slots.map((s) => team.roster[s]).filter((id) => id !== tp.id);
    const mate = res.players.filter((r) => mates.includes(r.pid)).sort((a, b) => b.PTS.mean - a.PTS.mean)[0];
    if (mate) legs.push({ kind: 'player', pid: mate.pid, stat: 'PTS', k: 1 });
    legs.push({ kind: 'ttotal', side, op: 'over', line: 2.5 });
    return legs;
  }

  // ------------------------------------------------------------ view
  NQ.views.predict = {
    render(params) {
      const st = S();
      let H = st.league.byAbbr[params[0]], A = st.league.byAbbr[params[1]];
      if (!H || !A || H.id === A.id) { const g = NQ.app.nextGame(st.league.byAbbr[NQ.app.focus].id); H = TM(g.home); A = TM(g.away); }
      const g = st.season.upcoming.find((x) => x.home === H.id && x.away === A.id);
      if (!view.cfg || view.cfg.key !== view.key(H.id, A.id)) {
        view.cfg = { key: view.key(H.id, A.id), n: 3000, starterH: 'auto', starterA: 'auto', scratches: new Set(), restH: g ? g.restH : 2, restA: g ? g.restA : 2 };
        view.legs = []; view.odds = '';
      }
      view.H = H; view.A = A;
      return `<div class="grid">
        ${c.panel('Prediction Engine', 'scenario controls', controls(st, H, A, view.cfg), { id: 'pe-ctrl' })}
        <div id="pe-out">${c.loading('Running event-level simulations…')}</div></div>`;
    },
    mount(root) {
      const st = S(), cfg = view.cfg;
      const $ = (s) => root.querySelector(s);
      $('#pe-game').addEventListener('change', (e) => { if (e.target.value) location.hash = '#/predict/' + e.target.value; });
      const hop = () => { if ($('#pe-h').value !== $('#pe-a').value) location.hash = `#/predict/${$('#pe-h').value}/${$('#pe-a').value}`; };
      $('#pe-h').addEventListener('change', hop); $('#pe-a').addEventListener('change', hop);
      root.querySelectorAll('[data-scr]').forEach((cb) => cb.addEventListener('change', () => { const id = +cb.dataset.scr; if (cb.checked) cfg.scratches.add(id); else cfg.scratches.delete(id); }));
      const run = () => {
        cfg.n = +$('#pe-n').value; cfg.starterH = $('#pe-gh').value; cfg.starterA = $('#pe-ga').value; cfg.restH = +$('#pe-rh').value; cfg.restA = +$('#pe-ra').value;
        const out = $('#pe-out');
        out.innerHTML = c.loading('Running ' + cfg.n.toLocaleString() + ' event-level simulations…');
        const opts = { n: cfg.n, starterH: cfg.starterH === 'auto' ? 'auto' : +cfg.starterH, starterA: cfg.starterA === 'auto' ? 'auto' : +cfg.starterA, scratches: new Set(cfg.scratches), restH: cfg.restH, restA: cfg.restA };
        NQ.app.mc(view.H.id, view.A.id, NQ.app.withProgress(out, opts)).then((res) => { if (document.body.contains(out)) { view.res = res; draw(root, res); } });
      };
      $('#pe-run').addEventListener('click', run);
      run();
      void st;
    }
  };

  function draw(root, res) {
    const st = S(), H = TM(res.homeId), A = TM(res.awayId);
    const out = root.querySelector('#pe-out');
    out.innerHTML = `<div class="grid g3">
        ${c.panel('Game Prediction', `${A.abbr} @ ${H.abbr}`, NQ.parts.gamePred(res))}
        ${c.panel('Why — Win Probability Drivers', 'factor attribution', factorsHtml(st, H, A, res))}
        ${c.panel('Exact Score Probabilities', '% of simulations', '<div class="tscroll">' + ch.scoreGrid(res.score, H.abbr, A.abbr, 7) + '</div>')}
      </div>
      <div class="grid g3" style="margin-top:10px">
        ${c.panel('Total Goals', 'distribution & lines', totalsHtml(res))}
        ${c.panel('Team Goals by Strength', 'mean per game', strengthHtml(res, H, A))}
        ${c.panel('Goaltender Projections', 'saves = SA − GA', goaliesHtml(res))}
      </div>
      ${c.panel('Projected Box Score', 'every skater · means & threshold probabilities', c.tabs('box', [{ k: 'h', n: H.full }, { k: 'a', n: A.full }], 'h') + `<div style="height:8px"></div><div data-pane-of="box" data-pane="h">${boxHtml(res, 0)}</div><div data-pane-of="box" data-pane="a" hidden>${boxHtml(res, 1)}</div>`, { style: 'margin-top:10px' })}
      ${c.panel('Same-Game Parlay Builder', 'joint probabilities from the simulated games', sgpForm(res), { style: 'margin-top:10px', id: 'sec-sgp' })}`;
    NQ.app.wireTabs(out);
    wireSgp(out, res);
  }

  function wireSgp(root, res) {
    const $ = (s) => root.querySelector(s);
    const redraw = () => { $('#sg-out').innerHTML = sgpOut(res); const o = $('#sg-odds'); if (o) o.addEventListener('change', (e) => { view.odds = e.target.value.replace('+', ''); redraw(); }); };
    const kind = $('#sg-kind');
    const showFields = () => {
      const k = kind.value;
      root.querySelector('[data-f="player"]').hidden = k !== 'player';
      root.querySelector('[data-f="side"]').hidden = !['win', 'reg', 'ttotal'].includes(k);
      root.querySelector('[data-f="ou"]').hidden = !['total', 'ttotal'].includes(k);
      root.querySelector('[data-f="goalie"]').hidden = !['goalie', 'so'].includes(k);
      root.querySelector('[data-f="gk"]').hidden = k !== 'goalie';
    };
    kind.addEventListener('change', showFields);
    $('#sg-add').addEventListener('click', () => {
      const k = kind.value;
      let leg;
      if (k === 'player') leg = { kind: 'player', pid: +$('#sg-pid').value, stat: $('#sg-stat').value, k: +$('#sg-k').value };
      else if (k === 'win' || k === 'reg') leg = { kind: k, side: +$('#sg-side').value };
      else if (k === 'ot') leg = { kind: 'ot' };
      else if (k === 'total') leg = { kind: 'total', op: $('#sg-op').value, line: +$('#sg-line').value };
      else if (k === 'ttotal') leg = { kind: 'ttotal', side: +$('#sg-side').value, op: $('#sg-op').value, line: +$('#sg-line').value };
      else if (k === 'goalie') leg = { kind: 'goalie', pid: +$('#sg-gid').value, stat: 'SV', k: +$('#sg-gk').value };
      else if (k === 'so') leg = { kind: 'goalie', pid: +$('#sg-gid').value, stat: 'SO' };
      if (leg && view.legs.length < 8) view.legs.push(leg);
      redraw();
    });
    $('#sg-sugg').addEventListener('click', () => { view.legs = suggest(res); redraw(); });
    $('#sg-clear').addEventListener('click', () => { view.legs = []; redraw(); });
    $('#sg-out').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { view.legs.splice(+d.dataset.del, 1); redraw(); } });
    showFields();
    redraw();
  }
})(globalThis.NQ = globalThis.NQ || {});

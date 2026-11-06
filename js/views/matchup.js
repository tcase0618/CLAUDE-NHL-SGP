/* ==========================================================================
 * Matchup Lab — team-vs-team tactical intelligence: category clash, line
 * and pair matrices, special-teams and goalie matchups, style insights.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];

  // [label, attacking metric (A), defending metric (B), description]
  const CLASHES = [
    ['Rush attack', 'trxf', 'trxa2', (a, b) => `${a} generates rush chances (${'{va}'} rush xGF/60) against a ${b} side that allows ${'{vb}'} rush xGA/60.`],
    ['Forecheck vs breakout', 'tfpi', 'tcex', (a, b) => `${a}'s forecheck pressure meets ${b}'s breakout (controlled-exit success ${'{vb}'}%).`],
    ['Power play vs penalty kill', 'tppx60', 'tpkx60', (a, b) => `${a} PP creates ${'{va}'} xG/60; ${b} PK concedes ${'{vb}'} xGA/60.`],
    ['Slot attack vs slot defense', 'thd5', 'thda5', (a, b) => `${a} produces ${'{va}'} HD chances/60 at 5v5; ${b} allows ${'{vb}'}.`],
    ['Shot volume vs suppression', 'tc5', 'tca5', (a, b) => `${a} attempts ${'{va}'} shots/60 vs ${b}'s ${'{vb}'} attempts against/60.`],
    ['Drawing penalties', 'tdrw60', 'tpen60', (a, b) => `${a} draws ${'{va}'} penalties/60; ${b} takes ${'{vb}'}.`],
    ['Cycle offense vs DZ structure', 'tcyx', 'tcov', (a, b) => `${a} cycle xGF/60 ${'{va}'} vs ${b} coverage breakdowns ${'{vb}'}/60.`]
  ];

  function insights(aId, bId) {
    const st = S(), A = st.M.team[aId], B = st.M.team[bId], an = TM(aId).abbr, bn = TM(bId).abbr;
    const out = [];
    for (const [label, ka, kb, txt] of CLASHES) {
      for (const [x, y, xn, yn] of [[A, B, an, bn], [B, A, bn, an]]) {
        // attacker good rank (low) + defender bad rank (high) → edge
        const edge = (y.rank[kb] - 16.5) - (x.rank[ka] - 16.5);
        const fm = (k, v) => u.fmtMetric(v, (st.catalog.find((m) => m.k === k) || {}).f);
        out.push({ label, team: xn, edge, text: txt(xn, yn).replace('{va}', fm(ka, x.vals[ka])).replace('{vb}', fm(kb, y.vals[kb])), ra: x.rank[ka], rb: y.rank[kb] });
      }
    }
    return out.sort((p, q) => Math.abs(q.edge) - Math.abs(p.edge)).slice(0, 7);
  }

  function categories(aId, bId) {
    const st = S(), A = st.M.team[aId].cat, B = st.M.team[bId].cat;
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Category</th><th class="num">${TM(aId).abbr}</th><th style="width:38%"></th><th class="num">${TM(bId).abbr}</th><th class="num">Edge</th></tr></thead><tbody>
      ${NQ.metrics.TEAM.map((k) => { const a = A[k.id], b = B[k.id], d = a - b; return `<tr><td>${u.esc(k.n)}</td><td class="num">${Math.round(a)}</td><td><div style="display:flex;gap:2px;height:8px"><div style="flex:1;display:flex;justify-content:flex-end"><i style="width:${a}%;background:var(--accent);border-radius:4px 0 0 4px"></i></div><div style="flex:1"><i style="display:block;height:100%;width:${b}%;background:var(--neg);border-radius:0 4px 4px 0"></i></div></div></td><td class="num">${Math.round(b)}</td><td class="num ${d > 0 ? 'pos' : 'neg'}">${u.sgn(d, 0)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function goalieMatch(aId, bId) {
    const st = S();
    const gs = [NQ.parts.starter(TM(aId)), NQ.parts.starter(TM(bId))].map((id) => ({ p: P(id), v: st.M.goalie[id].vals, r: st.M.goalie[id].rating }));
    const rows = [['Rating', (g) => u.fx(g.r.overall, 1)], ['Save %', (g) => u.sv(g.v.gsv)], ['GSAx', (g) => u.sgn(g.v.ggsax, 1)], ['GSAx/100 talent', (g) => u.sgn(g.v.gtal, 2)], ['HD save %', (g) => u.sv(g.v.ghd)], ['Rebound rate', (g) => u.fx(g.v.greba, 1) + '%'], ['Quality start %', (g) => u.fx(g.v.gqs, 1)], ['Last-10 SV%', (g) => u.sv(g.v.gl10)]];
    return `<table class="tbl"><thead><tr><th>Metric</th><th class="num">${c.pname(gs[0].p, { short: true })}</th><th class="num">${c.pname(gs[1].p, { short: true })}</th></tr></thead><tbody>${rows.map(([n, f]) => `<tr><td>${n}</td><td class="num">${f(gs[0])}</td><td class="num">${f(gs[1])}</td></tr>`).join('')}</tbody></table>`;
  }

  function h2h(aId, bId) {
    const st = S(), games = st.season.games;
    const log = st.season.team[aId].log.filter((g) => g.opp === bId);
    if (!log.length) return c.empty('No meetings yet this season.');
    return `<table class="tbl"><thead><tr><th>Date</th><th>Venue</th><th>Result (${TM(aId).abbr})</th><th class="num">Score</th><th class="num">xG</th></tr></thead><tbody>${log.map((g) => `<tr><td class="mono">${games[g.gid].date}</td><td>${g.home ? 'Home' : 'Away'}</td><td class="${g.r === 'W' ? 'pos' : 'neg'}">${g.r}</td><td class="num">${g.gf}–${g.ga}</td><td class="num">${u.fx(g.xgf, 1)}–${u.fx(g.xga, 1)}</td></tr>`).join('')}</tbody></table>`;
  }

  NQ.views.matchup = {
    render(params) {
      const st = S();
      const A = st.league.byAbbr[params[0]] || st.league.byAbbr[NQ.app.focus];
      let B = st.league.byAbbr[params[1]];
      if (!B || B.id === A.id) { const g = NQ.app.nextGame(A.id); B = TM(g ? (g.home === A.id ? g.away : g.home) : (A.id + 1) % 32); }
      const opts = st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((x) => ({ v: x.abbr, n: x.full }));
      const q = NQ.predict.quickModel(NQ.predict.teamInputs(st, A.id, NQ.parts.starter(A)), NQ.predict.teamInputs(st, B.id, NQ.parts.starter(B)), { explain: true, restH: 2, restA: 2 });
      const mA = NQ.parts.matrix(A.id, B.id), mB = NQ.parts.matrix(B.id, A.id);
      const pm = mA.res.pm;
      const ins = insights(A.id, B.id);
      const vA = st.M.team[A.id].vals, vB = st.M.team[B.id].vals;
      return `<div class="grid">
        <div class="ctrl"><label>Team A (home)</label>${c.select('mu-a', opts, A.abbr, { label: 'Team A' })}<label>Team B</label>${c.select('mu-b', opts, B.abbr, { label: 'Team B' })}<button class="iconbtn" id="mu-swap" title="Swap">⇄</button><a class="btn sm" href="#/predict/${A.abbr}/${B.abbr}">Simulate this game</a></div>
        <div class="grid g3">
          ${c.panel('Head to Head', 'analytic preview', `<div class="vs"><div>${c.crest(A, 50)}<div>${c.team(A, { big: true })}</div><div class="wp pos">${u.pct(q.win)}</div><div class="muted">xG ${u.fx(q.lh)}</div></div><div class="vsc">VS</div><div>${c.crest(B, 50)}<div>${c.team(B, { big: true })}</div><div class="wp neg">${u.pct(1 - q.win)}</div><div class="muted">xG ${u.fx(q.la)}</div></div></div>${c.split(q.win, 1 - q.win, A.abbr, B.abbr)}
            <div class="sect">Win-probability drivers (${A.abbr} perspective)</div>${q.factors.map((f) => `<div class="factor"><span>${f.label}</span><span class="fb"><i style="left:${f.delta >= 0 ? 50 : 50 + Math.max(-50, f.delta * 500)}%;width:${Math.min(50, Math.abs(f.delta) * 500)}%;background:${f.delta >= 0 ? 'var(--pos)' : 'var(--neg)'}"></i></span><span class="num r">${u.sgn(f.delta * 100, 1)}%</span></div>`).join('')}`)}
          ${c.panel('Profile Overlay', `${A.abbr} (blue) vs ${B.abbr} (red)`, NQ.parts.teamRadar(A.id, 260, B.id))}
          ${c.panel('Style Clash Insights', 'largest rank mismatches', ins.map((x) => `<div class="why"><b>${x.label} · ${x.team}</b> <span class="mono ${x.edge > 0 ? 'pos' : 'neg'}">${x.edge > 0 ? 'edge' : 'disadvantage'} (${u.ord(x.ra)} vs ${u.ord(x.rb)})</span><br>${x.text}</div>`).join(''))}
        </div>
        <div class="grid g3">
          ${c.panel('Line Matchup Matrix', `${A.abbr} lines vs ${B.abbr} lines · xGF% edge`, mA.html)}
          ${c.panel('Line Matchup Matrix', `${B.abbr} lines vs ${A.abbr} lines · xGF% edge`, mB.html)}
          ${c.panel('Pairs vs Lines', `${A.abbr} pairs vs ${B.abbr} forward lines`, `<table class="mx"><thead><tr><th></th>${pm[0].map((_, j) => `<th>${B.abbr} L${j + 1}</th>`).join('')}</tr></thead><tbody>${pm.map((row, i) => `<tr><th>${A.abbr} P${i + 1}</th>${row.map((v) => `<td style="background:${u.diverge(v / 6)}">${u.sgn(v, 1)}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="note">Log5-style combination of regularised unit xGF/60 and xGA/60 vs league average. Home team holds last change and can steer these matchups.</div>`)}
        </div>
        <div class="grid g3">
          ${c.panel('Category Clash', '20 categories, 0–100', categories(A.id, B.id))}
          ${c.panel('Special Teams Matchup', '', `<table class="tbl"><thead><tr><th>Battle</th><th class="num">Attack</th><th class="num">Defense</th><th class="num">Blend xG/60</th></tr></thead><tbody>
            <tr><td>${A.abbr} PP vs ${B.abbr} PK</td><td class="num">${u.fx(vA.tppx60)}</td><td class="num">${u.fx(vB.tpkx60)}</td><td class="num">${u.fx((vA.tppx60 + vB.tpkx60) / 2)}</td></tr>
            <tr><td>${B.abbr} PP vs ${A.abbr} PK</td><td class="num">${u.fx(vB.tppx60)}</td><td class="num">${u.fx(vA.tpkx60)}</td><td class="num">${u.fx((vB.tppx60 + vA.tpkx60) / 2)}</td></tr>
            <tr><td>Penalties drawn / taken (${A.abbr})</td><td class="num">${u.fx(vA.tdrw60)}</td><td class="num">${u.fx(vA.tpen60)}</td><td></td></tr>
            <tr><td>Penalties drawn / taken (${B.abbr})</td><td class="num">${u.fx(vB.tdrw60)}</td><td class="num">${u.fx(vB.tpen60)}</td><td></td></tr></tbody></table>`)}
          <div class="grid" style="align-content:start">${c.panel('Goalie Matchup', 'probable starters', goalieMatch(A.id, B.id))}${c.panel('Season Series', '', h2h(A.id, B.id))}</div>
        </div></div>`;
    },
    mount(root) {
      const a = root.querySelector('#mu-a'), b = root.querySelector('#mu-b');
      const go = () => { location.hash = `#/matchup/${a.value}/${b.value}`; };
      a.addEventListener('change', go); b.addEventListener('change', go);
      root.querySelector('#mu-swap').addEventListener('click', () => { location.hash = `#/matchup/${b.value}/${a.value}`; });
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

/* ==========================================================================
 * Goalie Intelligence — 64 goaltenders, 60-metric profiles, GSAx, danger
 * splits, net maps, consistency, next-start projection.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];

  function list(sel, sort) {
    const st = S();
    const gs = st.league.players.filter((p) => p.isG);
    const val = (p) => (sort === 'rating' ? st.M.goalie[p.id].rating.overall : st.M.goalie[p.id].vals[sort]);
    gs.sort((a, b) => (val(b) ?? -1e9) - (val(a) ?? -1e9));
    const fm = sort === 'rating' ? 'r1' : (st.catalog.find((m) => m.k === sort) || {}).f;
    return gs.map((p, i) => `<a class="row ${p.id === sel ? 'on' : ''}" href="#/goalie/${p.id}"><span class="num">${i + 1}</span><span>${u.esc(p.first[0] + '. ' + p.last)} <span class="muted mono" style="font-size:11px">${TM(p.teamId).abbr} · ${st.season.gpG[p.id]} GP</span></span><span></span><span class="num">${u.fmtMetric(val(p), fm)}</span></a>`).join('');
  }

  function gameLog(gid) {
    const log = S().season.plog[gid].slice().reverse().slice(0, 15), games = S().season.games;
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th>Dec</th><th class="num">TOI</th><th class="num">SA</th><th class="num">GA</th><th class="num">SV%</th><th class="num">xGA</th><th class="num">GSAx</th><th>Note</th></tr></thead><tbody>
      ${log.map((g) => `<tr><td class="mono">${games[g.gid].date}</td><td>${g.home ? 'vs' : '@'} ${c.team(TM(g.opp))}</td><td>${g.dec}</td><td class="num">${u.toi(g.toi)}</td><td class="num">${g.sa}</td><td class="num">${g.ga}</td><td class="num">${u.sv(g.sa ? 1 - g.ga / g.sa : null)}</td><td class="num">${u.fx(g.xga, 2)}</td><td class="num">${c.sign(g.xga - g.ga, 2)}</td><td class="muted">${g.start ? '' : 'relief'}${g.b2b ? ' b2b' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function startProj(gid, res) {
    const g = res.goalies.find((x) => x.pid === gid);
    const H = TM(res.homeId), A = TM(res.awayId);
    if (!g || !g.pStart) return `<div class="muted">${c.team(A)} @ ${c.team(H)}</div>` + c.empty('Not projected to start (0% in simulations).');
    return `<div class="muted" style="margin-bottom:6px">${c.team(A)} @ ${c.team(H)} · ${res.n.toLocaleString()} sims</div>
      <div class="stats">${c.stat('Start prob.', u.pct(g.pStart, 0))}${c.stat('Shots faced', u.fx(g.sa, 1))}${c.stat('Saves', u.fx(g.sv, 1), { sub: `90%: ${g.svLo}–${g.svHi}` })}${c.stat('Goals allowed', u.fx(g.ga, 2))}${c.stat('Save %', u.sv(g.svPct))}${c.stat('Shutout', u.pct(g.shutout))}${c.stat('Win | start', u.pct(g.win))}</div>
      <div class="grid g2" style="margin-top:8px"><div><div class="sect">Goals-allowed distribution</div>${ch.bars(g.gaDist, { labels: ['0', '1', '2', '3', '4', '5', '6', '7+'], hl: (i) => (i === 0 ? 'hi' : i >= 4 ? 'neg' : '') })}</div>
      <div><div class="sect">Saves distribution</div>${ch.bars(g.svDist.slice(10, 46), { labels: [...Array(36).keys()].map((i) => String(i + 10)), every: 5 })}</div></div>
      <div class="note">Saves = shots against − goals allowed in every simulation (identity enforced). Conditional on starting.</div>`;
  }

  NQ.views.goalie = {
    sort: 'rating',
    render(params) {
      const st = S();
      let gid = params[0] !== undefined ? +params[0] : NaN;
      if (isNaN(gid) || !P(gid) || !P(gid).isG) gid = NQ.parts.starter(st.league.byAbbr[NQ.app.focus]);
      this.sel = gid;
      const m = st.M.goalie[gid], r = m.rating;
      const shotsAgainst = st.season.shots.filter((s) => s.g === gid);
      const log = st.season.plog[gid];
      const gsx = log.map((g) => g.xga - g.ga);
      const sorts = [['rating', 'Overall rating'], ['ggsax', 'GSAx'], ['ggsax100', 'GSAx / 100'], ['gsv', 'Save %'], ['ghd', 'HD save %'], ['gqs', 'Quality start %'], ['gtal', 'Talent est.'], ['ggp', 'Games played']];
      return `<div class="grid g-wide">
        ${c.panel('Goaltenders', '64 profiles', `<div class="ctrl" style="margin-bottom:8px">${c.select('gf-sort', sorts.map(([v, n]) => ({ v, n })), this.sort, { label: 'Sort' })}</div><div class="plist" id="glist">${list(gid, this.sort)}</div>`, { demo: false })}
        <div class="grid" style="align-content:start">
          ${NQ.parts.goalieCard(gid, { link: false })}
          <div class="grid g2">
            ${c.panel('Goalie Rating', 'composite', `<div class="rating"><span class="muted">Overall</span><span class="big">${r.overall.toFixed(1)}</span>${c.sign(r.trend, 1)}</div>
              <div class="comp">${[['Shot stopping', r.shot], ['Technique', r.technique], ['Consistency', r.consistency], ['Situational', r.situational]].map(([k, x]) => `<span>${k}</span><span class="cv">${x.toFixed(1)}</span>`).join('')}</div>
              <div class="sect">Per-game GSAx</div>${ch.bars(gsx.map((x) => Math.abs(x)), { labels: gsx.map((_, i) => String(i + 1)), every: 5, hl: (i) => (gsx[i] >= 0 ? 'hi' : 'neg') })}
              <div class="why">GSAx = Σ shot xG faced − goals allowed. Talent estimate shrinks toward league average with ~1,500 shots of prior weight; the posterior SD is <b>${u.fx(m.vals.gse, 2)}</b> GSAx/100.</div>`)}
            ${c.panel('Next-Start Projection', 'Monte Carlo', `<div id="gp-proj">${c.loading()}</div>`)}
          </div>
          ${c.panel('60-Metric Goaltender Profile', '6 categories × 10 · percentile vs goalies (≥8 GP)', c.categories(NQ.metrics.GOALIE, m.vals, m.pct, { open: 3 }))}
          <div class="grid g2">${NQ.parts.shotMap(shotsAgainst, 'Shots Faced', { sub: 'location of attempts against', who: 'against', heat: true })}${c.panel('Game Log', 'last 15 appearances', gameLog(gid))}</div>
        </div></div>`;
    },
    mount(root) {
      const self = this;
      root.querySelector('#gf-sort').addEventListener('change', (e) => { self.sort = e.target.value; root.querySelector('#glist').innerHTML = list(self.sel, self.sort); });
      const p = P(this.sel), next = NQ.app.nextGame(p.teamId), el = root.querySelector('#gp-proj');
      if (!next) { el.innerHTML = c.empty('No upcoming game'); return; }
      NQ.app.mc(next.home, next.away, NQ.app.withProgress(el, {})).then((res) => { if (document.body.contains(el)) el.innerHTML = startProj(p.id, res); });
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

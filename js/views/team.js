/* ==========================================================================
 * Team Intelligence — league table (rank any of 200 metrics) + all 32 team
 * profiles: 20 categories × 10 metrics with league ranks, roster, schedule.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];

  function standings(state) {
    const st = S();
    const metric = st.catalog.find((m) => m.k === state.metric && m.scope === 'Team');
    let teams = st.league.teams.slice();
    if (state.group !== 'League') teams = teams.filter((t) => t.conf === state.group || t.div === state.group);
    const key = (t) => {
      const tr = st.season.team[t.id], v = st.M.team[t.id].vals;
      switch (state.sort) {
        case 'pts': return tr.pts + tr.row / 100;
        case 'rating': return v.trtg;
        case 'xgf': return v.txgf;
        case 'metric': return metric.hib === false ? -v[metric.k] : v[metric.k];
        default: return tr.pts;
      }
    };
    teams.sort((a, b) => key(b) - key(a));
    const th = (k, n, cls) => `<th class="sortable ${cls || 'num'} ${state.sort === k ? 'sorted' : ''}" data-sort="${k}">${n}</th>`;
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Team</th><th>Div</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th><th class="num">OTL</th>${th('pts', 'PTS')}<th class="num">P%</th><th class="num">GF</th><th class="num">GA</th>${th('xgf', '5v5 xGF%')}<th class="num">PP%</th><th class="num">PK%</th><th class="num">xPts</th>${th('rating', 'Rating')}${th('metric', u.esc(metric.n))}<th class="num">Rk</th><th>Last 10 xG</th></tr></thead><tbody>
      ${teams.map((t, i) => {
        const tr = st.season.team[t.id], M = st.M.team[t.id], v = M.vals;
        const r = NQ.parts.teamRolling(t.id, 6);
        return `<tr><td class="num">${i + 1}</td><td>${c.team(t, { full: true })}</td><td class="muted">${t.div.slice(0, 3)}</td><td class="num">${tr.gp}</td><td class="num">${tr.w}</td><td class="num">${tr.l}</td><td class="num">${tr.otl}</td><td class="num"><b>${tr.pts}</b></td><td class="num">${u.fx(tr.pts / (2 * tr.gp), 3).replace(/^0/, '')}</td><td class="num">${v.tgf ? Math.round(v.tgf * tr.gp) : ''}</td><td class="num">${Math.round(v.tga * tr.gp)}</td><td class="num ${v.txgf >= 50 ? 'pos' : 'neg'}">${u.fx(v.txgf, 1)}</td><td class="num">${u.fx(v.tpp, 1)}</td><td class="num">${u.fx(v.tpk, 1)}</td><td class="num">${u.fx(v.txpts, 1)}</td><td class="num">${c.sign(v.trtg, 2)}</td><td class="num">${u.fmtMetric(v[metric.k], metric.f)}</td><td class="num">${M.rank[metric.k] || '—'}</td><td style="width:110px">${ch.spark(r.f.map((x, k) => x - r.a[k]).slice(-20), { color: v.txgf >= 50 ? 'var(--pos)' : 'var(--neg)', w: 100, h: 22 })}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function roster(tid) {
    const st = S(), t = TM(tid);
    const sk = t.roster.slice(0, 18).map((id) => P(id));
    const row = (p) => {
      const a = st.season.sk[p.id], Sx = NQ.sim.S, m = st.M.skater[p.id];
      return `<tr><td>${c.pname(p)}</td><td class="pos">${p.pos}</td><td class="muted">${p.isD ? 'P' + p.pair : 'L' + p.line}</td><td>${c.roleBadges({ roles: (p.roles || []).filter((r) => /^PP|^PK/.test(r)) })}</td><td class="num">${st.season.gp[p.id]}</td><td class="num">${a[Sx.G]}</td><td class="num">${a[Sx.A1] + a[Sx.A2]}</td><td class="num"><b>${a[Sx.G] + a[Sx.A1] + a[Sx.A2]}</b></td><td class="num">${c.sign(a[Sx.GF5] - a[Sx.GA5], 0)}</td><td class="num">${a[Sx.SOG]}</td><td class="num">${u.toi(a[Sx.TOI] / st.season.gp[p.id])}</td><td class="num">${u.fx(m.vals.xgf, 1)}</td><td class="num">${c.sign(m.vals.relxgf, 1)}</td><td class="num">${c.sign(m.vals.gar, 1)}</td><td class="num"><b>${u.fx(m.rating.overall, 1)}</b></td></tr>`;
    };
    const goalies = t.roster.slice(18).map((id) => P(id));
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Skater</th><th>Pos</th><th>Unit</th><th>ST</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">P</th><th class="num" title="5v5 goal differential on ice">5v5 ±</th><th class="num">SOG</th><th class="num">TOI/GP</th><th class="num">xGF%</th><th class="num">Rel xGF</th><th class="num">GAR</th><th class="num">Rating</th></tr></thead><tbody>${sk.map(row).join('')}</tbody></table></div>
      <div class="sect">Goaltenders</div><table class="tbl"><thead><tr><th>Goalie</th><th class="num">GP</th><th class="num">GS</th><th>Record</th><th class="num">SV%</th><th class="num">GAA</th><th class="num">GSAx</th><th class="num">HD SV%</th><th class="num">QS%</th><th class="num">Rating</th></tr></thead><tbody>
      ${goalies.map((g) => { const v = st.M.goalie[g.id].vals; return `<tr><td>${c.pname(g)}</td><td class="num">${v.ggp}</td><td class="num">${v.ggs}</td><td class="mono">${v.grec}</td><td class="num">${u.sv(v.gsv)}</td><td class="num">${u.fx(v.ggaa)}</td><td class="num">${c.sign(v.ggsax, 1)}</td><td class="num">${u.sv(v.ghd)}</td><td class="num">${u.fx(v.gqs, 1)}</td><td class="num"><b>${u.fx(st.M.goalie[g.id].rating.overall, 1)}</b></td></tr>`; }).join('')}</tbody></table>`;
  }

  function schedule(tid) {
    const st = S(), t = TM(tid), games = st.season.games;
    const log = st.season.team[tid].log.slice(-10).reverse();
    const up = st.season.upcoming.filter((g) => g.home === tid || g.away === tid).slice(0, 6);
    const q = (g) => {
      const hS = NQ.parts.starter(TM(g.home)), aS = NQ.parts.starter(TM(g.away));
      const r = NQ.predict.quickModel(NQ.predict.teamInputs(st, g.home, hS), NQ.predict.teamInputs(st, g.away, aS), { restH: g.restH, restA: g.restA });
      return g.home === tid ? r.win : 1 - r.win;
    };
    return `<div class="grid g2"><div><div class="sect">Last 10 results</div><table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th>Res</th><th class="num">Score</th><th class="num">xG</th><th class="num">SOG</th></tr></thead><tbody>
      ${log.map((g) => `<tr><td class="mono">${games[g.gid].date}</td><td>${g.home ? 'vs' : '@'} ${c.team(TM(g.opp))}</td><td class="${g.r === 'W' ? 'pos' : g.r === 'L' ? 'neg' : 'warn'}">${g.r}${g.type !== 'REG' ? ' (' + g.type + ')' : ''}</td><td class="num">${g.gf}–${g.ga}</td><td class="num">${u.fx(g.xgf, 1)}–${u.fx(g.xga, 1)}</td><td class="num">${g.sf}–${g.sa}</td></tr>`).join('')}</tbody></table></div>
      <div><div class="sect">Upcoming (analytic win prob.)</div><table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th class="num">Rest</th><th class="num">Win %</th><th></th></tr></thead><tbody>
      ${up.map((g) => { const p = q(g); const home = g.home === tid; return `<tr><td class="mono">${g.date}</td><td>${home ? 'vs' : '@'} ${c.team(TM(home ? g.away : g.home))}</td><td class="num">${home ? g.restH : g.restA}d</td><td class="num ${p >= 0.5 ? 'pos' : 'neg'}">${u.pct(p)}</td><td><a class="btn ghost sm" href="#/predict/${TM(g.home).abbr}/${TM(g.away).abbr}">Simulate</a></td></tr>`; }).join('')}</tbody></table>
      <div class="note">Analytic layer (Poisson on shrunk rates). Full Monte Carlo in the Prediction Engine.</div></div></div>`;
  }

  function catScores(tid) {
    const st = S(), cat = st.M.team[tid].cat;
    return `<div class="comp" style="grid-template-columns:minmax(0,1fr) 120px 40px">${NQ.metrics.TEAM.map((k) => `<span>${u.esc(k.n)}</span><span>${c.pbar(cat[k.id], { num: false })}</span><span class="cv">${Math.round(cat[k.id])}</span>`).join('')}</div>
      <div class="note">Category score = 100 × (1 − (mean league rank − 1) / 31) over the category's directional metrics.</div>`;
  }

  NQ.views.team = {
    st: { metric: 'txgf60', sort: 'pts', group: 'League' },
    render(params) {
      const st = S();
      if (!params[0] || !st.league.byAbbr[params[0]]) {
        const groups = ['League', 'East', 'West', 'Atlantic', 'Metropolitan', 'Central', 'Pacific'];
        const teamMetrics = st.catalog.filter((m) => m.scope === 'Team');
        return `<div class="grid">${c.panel('League Table', 'all 32 team profiles · rank by any of 200 metrics', `
          <div class="ctrl" style="margin-bottom:8px">${c.tabs('grp', groups.map((g) => ({ k: g, n: g })), this.st.group)}<span class="sp" style="flex:1"></span><label>Rank by</label>
          <select id="tm-metric" class="sel" aria-label="Metric">${NQ.metrics.TEAM.map((cat) => `<optgroup label="${u.esc(cat.n)}">${cat.m.map((m) => `<option value="${m.k}" ${m.k === this.st.metric ? 'selected' : ''}>${u.esc(m.n)}</option>`).join('')}</optgroup>`).join('')}</select></div>
          <div id="stand">${standings(this.st)}</div><div class="note">${teamMetrics.length} team metrics available. Click a column header to sort.</div>`)}
          <div class="grid g4">${st.league.teams.slice().sort((a, b) => st.M.team[b.id].vals.trtg - st.M.team[a.id].vals.trtg).slice(0, 4).map((t) => c.panel(t.abbr, 'top-4 rating', NQ.parts.teamRadar(t.id, 200) + `<div class="c"><a href="#/team/${t.abbr}">${u.esc(t.full)} →</a></div>`)).join('')}</div></div>`;
      }
      const t = st.league.byAbbr[params[0]], M = st.M.team[t.id];
      const sf = st.season.shots.filter((s) => s.tm === t.id), sa = st.season.shots.filter((s) => s.dt === t.id);
      return `<div class="grid">
        <div class="ctrl"><a class="btn ghost sm" href="#/team">← League table</a>${c.select('tm-jump', st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((x) => ({ v: x.abbr, n: x.full })), t.abbr, { label: 'Team' })}
          <a class="btn ghost sm" href="#/lines/${t.abbr}">Lines &amp; pairings</a><a class="btn ghost sm" href="#/matchup/${t.abbr}">Matchup lab</a></div>
        ${NQ.parts.teamCard(t.id, { link: false })}
        <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
          ${c.panel('200-Metric Team Library', '20 categories × 10 · league rank (1 = best)', c.categories(NQ.metrics.TEAM, M.vals, M.rank, { rankMode: true, open: 3 }))}
          <div class="grid" style="align-content:start">${c.panel('Category Scores', '0–100', catScores(t.id))}${NQ.parts.xgTrend(t.id)}</div>
        </div>
        <div class="grid g3" id="sec-zone">
          ${NQ.parts.shotMap(sf, 'Shots For', { who: t.abbr })}
          ${NQ.parts.shotMap(sa, 'Shots Against', { who: 'opponents', heat: true })}
          ${NQ.parts.zones(t.id)}
        </div>
        ${c.panel('Roster', 'skaters & goalies', roster(t.id))}
        ${c.panel('Schedule & Results', '', schedule(t.id))}
      </div>`;
    },
    mount(root) {
      const self = this;
      const jump = root.querySelector('#tm-jump');
      if (jump) jump.addEventListener('change', (e) => { location.hash = '#/team/' + e.target.value; });
      const sel = root.querySelector('#tm-metric');
      if (!sel) return;
      const redraw = () => { root.querySelector('#stand').innerHTML = standings(self.st); };
      sel.addEventListener('change', (e) => { self.st.metric = e.target.value; self.st.sort = 'metric'; redraw(); });
      root.querySelector('#stand').addEventListener('click', (e) => { const th = e.target.closest('[data-sort]'); if (th) { self.st.sort = th.dataset.sort; redraw(); } });
      NQ.app.wireTabs(root, (id, k) => { if (id === 'grp') { self.st.group = k; redraw(); } });
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

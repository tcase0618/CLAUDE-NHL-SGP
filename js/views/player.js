/* ==========================================================================
 * Player Intelligence — every skater: 80 universal metrics, positional
 * module(s), usage splits, shot map, trends, comparables, next-game
 * projection with an explanation of WHY.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];

  const SORTS = [['rating', 'Overall rating'], ['p60', 'Points / 60'], ['ixg60', 'ixG / 60'], ['xgf', 'xGF%'], ['xa60', 'xA / 60'], ['relxgf', 'Rel xGF%'], ['gar', 'GAR'], ['toigp', 'TOI / GP'], ['sog60', 'SOG / 60'], ['hit60', 'Hits / 60'], ['blk60', 'Blocks / 60']];

  function listHtml(f) {
    const st = S();
    let ps = st.league.players.filter((p) => !p.isG);
    if (f.team !== 'ALL') ps = ps.filter((p) => TM(p.teamId).abbr === f.team);
    if (f.pos === 'F') ps = ps.filter((p) => !p.isD); else if (f.pos !== 'ALL') ps = ps.filter((p) => p.pos === f.pos);
    if (f.q) ps = ps.filter((p) => (p.first + ' ' + p.last).toLowerCase().includes(f.q));
    const val = (p) => (f.sort === 'rating' ? st.M.skater[p.id].rating.overall : st.M.skater[p.id].vals[f.sort]);
    ps.sort((a, b) => (val(b) ?? -1e9) - (val(a) ?? -1e9));
    const fm = f.sort === 'rating' ? 'r1' : (NQ.app.state.catalog.find((m) => m.k === f.sort) || {}).f;
    return ps.slice(0, 400).map((p, i) => `<a class="row ${p.id === f.sel ? 'on' : ''}" href="#/player/${p.id}"><span class="num">${i + 1}</span><span>${u.esc(p.first[0] + '. ' + p.last)} <span class="pos">${p.pos}</span> <span class="muted mono" style="font-size:11px">${TM(p.teamId).abbr}</span></span><span></span><span class="num">${u.fmtMetric(val(p), fm)}</span></a>`).join('') || c.empty('No players match');
  }

  function usageSplit(pid) {
    const a = S().season.sk[pid], Sx = NQ.sim.S, gp = S().season.gp[pid];
    const rows = [
      ['5v5', a[Sx.TOI5], a[Sx.G5], a[Sx.A5], a[Sx.SOG5], a[Sx.IXG5]],
      ['Power play', a[Sx.TOIPP], a[Sx.PPG], a[Sx.PPA], a[Sx.PPSOG], a[Sx.PPXG]],
      ['Penalty kill', a[Sx.TOIPK], a[Sx.SHG], null, null, null],
      ['All situations', a[Sx.TOI], a[Sx.G], a[Sx.A1] + a[Sx.A2], a[Sx.SOG], a[Sx.IXG]]
    ];
    return `<table class="tbl"><thead><tr><th>Strength</th><th class="num">TOI/GP</th><th class="num">G</th><th class="num">A</th><th class="num">SOG</th><th class="num">ixG</th><th class="num">P/60</th></tr></thead><tbody>
      ${rows.map(([n, toi, g, aa, sog, ixg]) => `<tr><td>${n}</td><td class="num">${u.toi(toi / gp)}</td><td class="num">${u.int(g)}</td><td class="num">${aa === null ? '—' : u.int(aa)}</td><td class="num">${sog === null ? '—' : u.int(sog)}</td><td class="num">${ixg === null ? '—' : u.fx(ixg, 1)}</td><td class="num">${toi > 300 && aa !== null ? u.fx(((g + aa) * 3600) / toi) : '—'}</td></tr>`).join('')}</tbody></table>`;
  }

  function comparables(pid) {
    const st = S(), me = st.M.skater[pid], p = P(pid);
    const keys = NQ.metrics.SKATER.flatMap((cat) => cat.m.filter((m) => m.hib !== null).map((m) => m.k));
    const pool = st.league.players.filter((q) => !q.isG && q.isD === p.isD && q.id !== pid && st.season.gp[q.id] >= 10);
    const d = pool.map((q) => {
      const o = st.M.skater[q.id]; let s = 0, n = 0;
      for (const k of keys) if (typeof me.pct[k] === 'number' && typeof o.pct[k] === 'number') { s += (me.pct[k] - o.pct[k]) ** 2; n++; }
      return [q, Math.sqrt(s / Math.max(1, n))];
    }).sort((a, b) => a[1] - b[1]).slice(0, 6);
    return `<table class="tbl"><thead><tr><th>Player</th><th>Team</th><th class="num">Similarity</th><th class="num">Rating</th><th class="num">P/60</th><th class="num">xGF%</th></tr></thead><tbody>
      ${d.map(([q, dist]) => `<tr><td>${c.pname(q, { pos: true })}</td><td>${c.team(TM(q.teamId))}</td><td class="num">${u.fx(Math.max(0, 100 - dist * 2.2), 0)}</td><td class="num">${u.fx(st.M.skater[q.id].rating.overall, 1)}</td><td class="num">${u.fx(st.M.skater[q.id].vals.p60)}</td><td class="num">${u.fx(st.M.skater[q.id].vals.xgf, 1)}%</td></tr>`).join('')}</tbody></table>
      <div class="note">Nearest neighbours by Euclidean distance across ${keys.length} universal-metric percentiles (same position group).</div>`;
  }

  function trend(pid) {
    const log = S().season.plog[pid];
    const pts = log.map((g) => g.g + g.a);
    const roll = u.rollingRatio(pts, log.map((g) => g.toi), 10, 3600);
    const sog = u.rollingRatio(log.map((g) => g.sog), log.map(() => 1), 5, 1);
    const last = log.slice(-10).reverse();
    const games = S().season.games;
    return `<div class="grid g2"><div><div class="sect">Points / 60 (10-GP rolling) &amp; SOG (5-GP)</div>
      ${ch.line({ w: 360, h: 150, series: [{ data: roll, color: 'var(--pos)', area: true }, { data: sog, color: 'var(--warn)', dash: true }], xLabels: NQ.parts.monthLabels(log.map((g) => g.gid)), label: 'rolling points per 60' })}
      <div class="legend"><span><i style="background:var(--pos)"></i>P/60 rolling</span><span><i style="background:var(--warn)"></i>SOG/GP rolling</span></div></div>
      <div><div class="sect">Last 10 games</div><table class="tbl"><thead><tr><th>Date</th><th>Opp</th><th class="num">TOI</th><th class="num">G</th><th class="num">A</th><th class="num">SOG</th><th class="num">ixG</th><th class="num">xGF%</th></tr></thead><tbody>
      ${last.map((g) => `<tr><td class="mono">${games[g.gid].date}</td><td>${c.team(TM(g.opp))}</td><td class="num">${u.toi(g.toi)}</td><td class="num">${g.g}</td><td class="num">${g.a}</td><td class="num">${g.sog}</td><td class="num">${u.fx(g.ixg)}</td><td class="num">${g.xgf5 + g.xga5 > 0 ? u.fx((100 * g.xgf5) / (g.xgf5 + g.xga5), 0) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function shotBlock(pid) {
    const shots = S().season.shots.filter((s) => s.sh === pid);
    const types = {};
    shots.forEach((s) => { if (s.r === 3) return; const t = types[s.type] || (types[s.type] = { n: 0, g: 0, xg: 0 }); t.n++; t.xg += s.xg; if (s.r === 2) t.g++; });
    const ttable = `<table class="tbl"><thead><tr><th>Shot type</th><th class="num">Att.</th><th class="num">G</th><th class="num">xG</th><th class="num">G−xG</th></tr></thead><tbody>${Object.entries(types).sort((a, b) => b[1].n - a[1].n).map(([k, t]) => `<tr><td>${k}</td><td class="num">${t.n}</td><td class="num">${t.g}</td><td class="num">${u.fx(t.xg, 1)}</td><td class="num">${c.sign(t.g - t.xg, 1)}</td></tr>`).join('')}</tbody></table>`;
    return { map: NQ.parts.shotMap(shots, 'Shot Map', { sub: 'season, all strengths', who: P(pid).last }), ttable };
  }

  /** Human-readable projection rationale. */
  function explain(pid, row, res) {
    const st = S(), p = P(pid), m = st.M.skater[pid], v = m.vals, pc = m.pct;
    const side = row.t, oppId = side === 0 ? res.awayId : res.homeId, opp = st.M.team[oppId];
    const g = res.goalies.filter((x) => x.t !== side && x.pStart > 0).sort((a, b) => b.pStart - a.pStart)[0];
    const gv = g ? st.M.goalie[g.pid] : null;
    const out = [];
    const ppRole = (p.roles || []).find((r) => /^PP/.test(r));
    out.push(`Projected <b>${u.toi(row.TOI)}</b> TOI${ppRole ? ` with <b>${ppRole}</b> usage (${u.toi(v.toippgp)} PP/GP)` : ''}.`);
    if (pc.sog60 !== undefined) out.push(`Shot generation <b>${u.fx(v.sog60)} SOG/60</b> (${Math.round(pc.sog60)}th pct) and <b>${u.fx(v.ixg60)} ixG/60</b> (${Math.round(pc.ixg60)}th pct).`);
    out.push(`Opponent ${TM(oppId).abbr} allows <b>${u.fx(opp.vals.txga60)} xGA/60</b> at 5v5 (${u.ord(opp.rank.txga60)} best) and kills penalties at <b>${u.fx(opp.vals.tpk, 1)}%</b>.`);
    if (gv) out.push(`Likely opposing goalie <b>${P(g.pid).last}</b> (${u.pct(g.pStart, 0)} start prob.): GSAx/100 talent ${u.sgn(gv.vals.gtal, 2)}, HD SV% ${u.sv(gv.vals.ghd)}.`);
    const line = st.M.chem[p.teamId][p.isD ? 'pairs' : 'lines'][(p.isD ? p.pair : p.line) - 1];
    if (line) out.push(`${p.isD ? 'Pair' : 'Line'} synergy ${u.sgn(line.synergy, 2)} xGD/60 (shrink ${u.pct(line.shrink, 0)}), on-ice xGF% ${u.fx(line.xgfPct, 1)}.`);
    if (typeof v.shreg === 'number' && Math.abs(v.shreg) > 2.5) out.push(`Finishing ${v.shreg > 0 ? 'above' : 'below'} expectation by ${u.fx(Math.abs(v.shreg), 1)} pts — the model regresses this toward the player's shot quality.`);
    return out.map((x) => `<div>• ${x}</div>`).join('');
  }

  function projBlock(pid, res) {
    const row = res.players.find((r) => r.pid === pid);
    if (!row) return c.empty('Player not in projected lineup');
    const H = TM(res.homeId), A = TM(res.awayId);
    const thr = (d, ks) => ks.map((k) => `<td class="num">${u.pct(d.ge(k), 0)}</td>`).join('');
    return `<div class="muted" style="margin-bottom:6px">${c.team(A)} @ ${c.team(H)} · ${res.n.toLocaleString()} simulations · win prob. ${H.abbr} ${u.pct(res.winH)}</div>
      <div class="stats">${c.stat('Goals', u.fx(row.G.mean), { sub: `P(1+) ${u.pct(row.G.ge(1))}` })}${c.stat('Assists', u.fx(row.A.mean), { sub: `P(1+) ${u.pct(row.A.ge(1))}` })}${c.stat('Points', u.fx(row.PTS.mean), { sub: `P(2+) ${u.pct(row.PTS.ge(2))}` })}${c.stat('Shots', u.fx(row.SOG.mean, 1), { sub: `90%: ${row.SOG.lo}–${row.SOG.hi}` })}${c.stat('Blocks', u.fx(row.BLK.mean, 1))}${c.stat('Hits', u.fx(row.HIT.mean, 1))}${c.stat('TOI', u.toi(row.TOI))}${c.stat('PP points', u.fx(row.PPP.mean, 2))}</div>
      <div class="grid g2" style="margin-top:8px"><div><div class="sect">Threshold probabilities</div><table class="tbl"><thead><tr><th>Stat</th><th class="num">1+</th><th class="num">2+</th><th class="num">3+</th><th class="num">4+</th><th class="num">5+</th></tr></thead><tbody>
        <tr><td>Goals</td>${thr(row.G, [1, 2, 3, 4, 5])}</tr><tr><td>Assists</td>${thr(row.A, [1, 2, 3, 4, 5])}</tr><tr><td>Points</td>${thr(row.PTS, [1, 2, 3, 4, 5])}</tr><tr><td>Shots on goal</td>${thr(row.SOG, [1, 2, 3, 4, 5])}</tr><tr><td>Blocks</td>${thr(row.BLK, [1, 2, 3, 4, 5])}</tr><tr><td>Hits</td>${thr(row.HIT, [1, 2, 3, 4, 5])}</tr></tbody></table></div>
      <div><div class="sect">SOG distribution</div>${ch.bars(row.SOG.dist.slice(0, 10), { labels: [...Array(10).keys()].map(String), hl: (i) => (i >= 3 ? 'hi' : '') })}
      <div class="sect">Why the model projects this</div><div class="why">${explain(pid, row, res)}</div></div></div>`;
  }

  NQ.views.player = {
    f: null,
    render(params) {
      const st = S();
      let pid = params[0] !== undefined ? +params[0] : NaN;
      if (isNaN(pid) || !P(pid) || P(pid).isG) pid = NQ.parts.topSkater(st.league.byAbbr[NQ.app.focus]);
      const p = P(pid), t = TM(p.teamId), m = st.M.skater[pid];
      this.f = this.f || { team: t.abbr, pos: 'ALL', sort: 'rating', q: '' };
      if (params[0] !== undefined && this.f.team !== 'ALL' && this.f.team !== t.abbr) this.f.team = t.abbr;
      this.f.sel = pid;
      const f = this.f;
      const teams = [{ v: 'ALL', n: 'All teams' }, ...st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((x) => ({ v: x.abbr, n: x.abbr }))];
      const sb = shotBlock(pid);
      const mods = m.mods;
      const modHtml = mods.map((mk, i) => {
        const mod = NQ.metrics.MODULES[mk];
        return `<div data-pane-of="mod" data-pane="${mk}" ${i ? 'hidden' : ''}><div class="note" style="margin:0 0 8px">${u.esc(mod.resp)}</div>${c.categories(mod.g, m.vals, m.pct, { open: 3 })}</div>`;
      }).join('');
      return `<div class="grid g-wide">
        ${c.panel('Skaters', `${st.league.players.filter((x) => !x.isG).length} profiles`, `
          <div class="ctrl" style="margin-bottom:8px">${c.select('pf-team', teams, f.team, { label: 'Team' })}${c.select('pf-pos', [{ v: 'ALL', n: 'All' }, { v: 'F', n: 'Forwards' }, { v: 'C', n: 'C' }, { v: 'LW', n: 'LW' }, { v: 'RW', n: 'RW' }, { v: 'D', n: 'D' }], f.pos, { label: 'Position' })}
          ${c.select('pf-sort', SORTS.map(([v, n]) => ({ v, n })), f.sort, { label: 'Sort' })}<input class="inp" id="pf-q" placeholder="Filter name" value="${u.esc(f.q)}" style="flex:1;min-width:90px"></div>
          <div class="plist" id="plist">${listHtml(f)}</div>`, { demo: false })}
        <div class="grid" style="align-content:start">
          ${NQ.parts.playerCard(pid, { link: false })}
          <div class="grid g2">
            ${c.panel('Usage & Strength Splits', 'season', usageSplit(pid) + `<div class="sect">Deployment</div>${c.kv([['QoC index', u.fx(m.vals.qoc, 1)], ['QoT index', u.fx(m.vals.qot, 1)], ['OZ start %', u.fx(m.vals.ozs, 1) + '%'], ['Shifts / GP', u.fx(m.vals.shgp, 1)], ['Avg shift', u.fx(m.vals.shlen, 1) + ' s'], ['GP', st.season.gp[pid]]])}`)}
            ${c.panel('Next-Game Projection', 'Monte Carlo', `<div id="pp-proj">${c.loading()}</div>`)}
          </div>
          ${c.panel('80 Universal Skater Metrics', '8 categories × 10 · percentile vs ' + (p.isD ? 'defensemen' : 'forwards') + ' (≥10 GP)', c.categories(NQ.metrics.SKATER, m.vals, m.pct, { open: 2 }), { id: 'sec-metrics' })}
          ${c.panel('Positional Module', mods.map((k) => NQ.metrics.MODULES[k].n).join(' + ') + ' · 30 specialised metrics', (mods.length > 1 ? c.tabs('mod', mods.map((k) => ({ k, n: NQ.metrics.MODULES[k].n })), mods[0]) + '<div style="height:8px"></div>' : '') + modHtml)}
          <div class="grid g2">${sb.map}${c.panel('Shot Profile', 'by type', sb.ttable)}</div>
          ${c.panel('Performance Trend', 'game log', trend(pid))}
          ${c.panel('Comparable Players', 'statistical neighbours', comparables(pid))}
        </div></div>`;
    },
    mount(root) {
      const self = this, f = this.f;
      const redraw = () => { root.querySelector('#plist').innerHTML = listHtml(f); };
      root.querySelector('#pf-team').addEventListener('change', (e) => { f.team = e.target.value; redraw(); });
      root.querySelector('#pf-pos').addEventListener('change', (e) => { f.pos = e.target.value; redraw(); });
      root.querySelector('#pf-sort').addEventListener('change', (e) => { f.sort = e.target.value; redraw(); });
      root.querySelector('#pf-q').addEventListener('input', (e) => { f.q = e.target.value.trim().toLowerCase(); redraw(); });
      NQ.app.wireTabs(root);
      const p = P(f.sel), next = NQ.app.nextGame(p.teamId);
      const el = root.querySelector('#pp-proj');
      if (!next) { el.innerHTML = c.empty('No upcoming game'); return; }
      NQ.app.mc(next.home, next.away, NQ.app.withProgress(el, {})).then((res) => { if (document.body.contains(el) && self.f.sel === p.id) el.innerHTML = projBlock(p.id, res); });
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

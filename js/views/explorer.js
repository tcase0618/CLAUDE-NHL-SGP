/* ==========================================================================
 * Analysis tools: Shot & Event Explorer, Skating & Usage leaderboards,
 * Feature Store (metric dictionary).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;
  const TM = (id) => S().league.teams[id];
  const P = (id) => S().league.players[id];

  // ------------------------------------------------------------ shot explorer
  const ex = { team: 'ALL', side: 'for', st: 'all', res: 'all', dg: 'all', type: 'all', flag: 'all', per: 'all', mode: 'dots' };
  function filterShots() {
    const st = S(), tid = ex.team === 'ALL' ? -1 : st.league.byAbbr[ex.team].id;
    const stMap = { '5v5': 0, PP: 1, PK: -1, '3v3': 3 };
    return st.season.shots.filter((s) => {
      if (tid >= 0 && (ex.side === 'for' ? s.tm !== tid : s.dt !== tid)) return false;
      if (ex.st !== 'all' && s.st !== stMap[ex.st]) return false;
      if (ex.res !== 'all' && s.r !== +ex.res) return false;
      if (ex.dg !== 'all' && s.dg !== +ex.dg) return false;
      if (ex.type !== 'all' && s.type !== ex.type) return false;
      if (ex.flag !== 'all' && !s[ex.flag]) return false;
      if (ex.per !== 'all' && s.per !== +ex.per) return false;
      return true;
    });
  }
  function exOut() {
    const sh = filterShots();
    const unb = sh.filter((s) => s.r !== 3), goals = sh.filter((s) => s.r === 2).length, sog = sh.filter((s) => s.r >= 1 && s.r <= 2).length;
    const xg = unb.reduce((s, x) => s + x.xg, 0);
    const sample = sh.length > 3500 ? sh.filter((_, i) => i % Math.ceil(sh.length / 3500) === 0) : sh;
    const byDist = Array.from({ length: 7 }, () => ({ n: 0, g: 0, xg: 0 }));
    unb.forEach((s) => { const d = Math.hypot(89 - s.x, s.y); const b = Math.min(6, Math.floor(d / 10)); byDist[b].n++; byDist[b].xg += s.xg; if (s.r === 2) byDist[b].g++; });
    const types = {};
    unb.forEach((s) => { const t = types[s.type] || (types[s.type] = { n: 0, g: 0, xg: 0 }); t.n++; t.xg += s.xg; if (s.r === 2) t.g++; });
    return `<div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)">
      <div>${ch.rink(sample, { heat: ex.mode === 'heat', dots: ex.mode !== 'heat' })}<div class="note">${sample.length < sh.length ? `Showing a 1-in-${Math.ceil(sh.length / 3500)} sample of ${sh.length.toLocaleString()} events.` : `${sh.length.toLocaleString()} events.`}</div></div>
      <div><div class="stats">${c.stat('Attempts', sh.length.toLocaleString())}${c.stat('Unblocked', unb.length.toLocaleString())}${c.stat('SOG', sog.toLocaleString())}${c.stat('Goals', goals)}${c.stat('xG', u.fx(xg, 1))}${c.stat('G − xG', u.sgn(goals - xg, 1), { cls: goals >= xg ? 'hl' : 'bad' })}${c.stat('Sh%', sog ? u.pct(goals / sog) : '—')}${c.stat('xG / attempt', unb.length ? u.fx(xg / unb.length, 3) : '—')}</div>
      <div class="sect">Goal rate by distance (unblocked)</div><table class="tbl"><thead><tr><th>Distance</th><th class="num">Att.</th><th class="num">Goals</th><th class="num">Goal %</th><th class="num">xG %</th></tr></thead><tbody>
      ${byDist.map((b, i) => `<tr><td>${i * 10}–${i === 6 ? '+' : i * 10 + 10} ft</td><td class="num">${b.n}</td><td class="num">${b.g}</td><td class="num">${b.n ? u.pct(b.g / b.n) : '—'}</td><td class="num">${b.n ? u.pct(b.xg / b.n) : '—'}</td></tr>`).join('')}</tbody></table>
      <div class="sect">By shot type</div><table class="tbl"><thead><tr><th>Type</th><th class="num">Att.</th><th class="num">Goals</th><th class="num">xG</th><th class="num">G−xG</th></tr></thead><tbody>${Object.entries(types).sort((a, b) => b[1].n - a[1].n).map(([k, t]) => `<tr><td>${k}</td><td class="num">${t.n}</td><td class="num">${t.g}</td><td class="num">${u.fx(t.xg, 1)}</td><td class="num">${c.sign(t.g - t.xg, 1)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  NQ.views.explorer = {
    render() {
      const st = S();
      const teams = [{ v: 'ALL', n: 'All teams' }, ...st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((t) => ({ v: t.abbr, n: t.abbr }))];
      const f = (id, opts, val, lab) => `<span><label>${lab}</label> ${c.select(id, opts, val, { label: lab })}</span>`;
      return `<div class="grid">${c.panel('Shot & Event Explorer', `${st.season.shots.length.toLocaleString()} simulated shot attempts`, `
        <div class="ctrl" id="ex-ctrl">${f('ex-team', teams, ex.team, 'Team')}${f('ex-side', [{ v: 'for', n: 'Shots for' }, { v: 'against', n: 'Shots against' }], ex.side, 'Side')}
        ${f('ex-st', ['all', '5v5', 'PP', 'PK', '3v3'].map((v) => ({ v, n: v === 'all' ? 'All' : v })), ex.st, 'Strength')}
        ${f('ex-res', [{ v: 'all', n: 'All' }, { v: 2, n: 'Goal' }, { v: 1, n: 'Saved' }, { v: 0, n: 'Missed' }, { v: 3, n: 'Blocked' }], ex.res, 'Result')}
        ${f('ex-dg', [{ v: 'all', n: 'All' }, { v: 2, n: 'High' }, { v: 1, n: 'Medium' }, { v: 0, n: 'Low' }], ex.dg, 'Danger')}
        ${f('ex-type', ['all', 'Wrist', 'Snap', 'Slap', 'Backhand', 'Tip', 'Wrap'].map((v) => ({ v, n: v === 'all' ? 'All' : v })), ex.type, 'Type')}
        ${f('ex-flag', [{ v: 'all', n: 'Any' }, { v: 'reb', n: 'Rebound' }, { v: 'rush', n: 'Rush' }, { v: 'ot', n: 'One-timer' }, { v: 'cs', n: 'Cross-slot' }], ex.flag, 'Context')}
        ${f('ex-per', [{ v: 'all', n: 'All' }, { v: 1, n: 'P1' }, { v: 2, n: 'P2' }, { v: 3, n: 'P3' }, { v: 4, n: 'OT' }], ex.per, 'Period')}
        ${f('ex-mode', [{ v: 'dots', n: 'Events' }, { v: 'heat', n: 'xG heat' }], ex.mode, 'View')}</div>
        <div id="ex-out" style="margin-top:10px">${exOut()}</div>`)}</div>`;
    },
    mount(root) {
      root.querySelector('#ex-ctrl').addEventListener('change', (e) => {
        const k = e.target.id.replace('ex-', ''); ex[k] = e.target.value;
        root.querySelector('#ex-out').innerHTML = exOut();
      });
    }
  };

  // ------------------------------------------------------------ leaders
  const ld = { cat: 'usage', pos: 'ALL', team: 'ALL', sort: null, gp: 20 };
  function leadersOut() {
    const st = S();
    const cat = NQ.metrics.SKATER.find((x) => x.id === ld.cat);
    const sortK = ld.sort && cat.m.find((m) => m.k === ld.sort) ? ld.sort : cat.m[0].k;
    const sm = cat.m.find((m) => m.k === sortK);
    let ps = st.league.players.filter((p) => !p.isG && st.season.gp[p.id] >= ld.gp);
    if (ld.pos === 'F') ps = ps.filter((p) => !p.isD); else if (ld.pos !== 'ALL') ps = ps.filter((p) => p.pos === ld.pos);
    if (ld.team !== 'ALL') ps = ps.filter((p) => TM(p.teamId).abbr === ld.team);
    const v = (p) => st.M.skater[p.id].vals[sortK];
    ps.sort((a, b) => (sm.hib === false ? (v(a) ?? 1e9) - (v(b) ?? 1e9) : (v(b) ?? -1e9) - (v(a) ?? -1e9)));
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Team</th><th class="num">GP</th>${cat.m.map((m) => `<th class="num sortable ${m.k === sortK ? 'sorted' : ''}" data-sort="${m.k}" title="${u.esc(m.def)}">${u.esc(m.n)}</th>`).join('')}</tr></thead><tbody>
      ${ps.slice(0, 120).map((p, i) => `<tr><td class="num">${i + 1}</td><td>${c.pname(p, { pos: true })}</td><td>${c.team(TM(p.teamId))}</td><td class="num">${st.season.gp[p.id]}</td>${cat.m.map((m) => `<td class="num">${u.fmtMetric(st.M.skater[p.id].vals[m.k], m.f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="note">${ps.length} qualifying skaters (≥ ${ld.gp} GP). Click a column to sort.</div>`;
  }
  NQ.views.leaders = {
    render() {
      const st = S();
      const teams = [{ v: 'ALL', n: 'All teams' }, ...st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((t) => ({ v: t.abbr, n: t.abbr }))];
      return `<div class="grid">${c.panel('Skating, Usage & Leaderboards', 'league-wide · every universal metric category', `
        <div class="ctrl">${c.tabs('ldcat', NQ.metrics.SKATER.map((x) => ({ k: x.id, n: x.n.split(' &')[0].split(' (')[0] })), ld.cat)}</div>
        <div class="ctrl" style="margin:8px 0">${c.select('ld-pos', [{ v: 'ALL', n: 'All skaters' }, { v: 'F', n: 'Forwards' }, { v: 'C', n: 'C' }, { v: 'LW', n: 'LW' }, { v: 'RW', n: 'RW' }, { v: 'D', n: 'D' }], ld.pos, { label: 'Position' })}${c.select('ld-team', teams, ld.team, { label: 'Team' })}${c.select('ld-gp', [1, 10, 20, 30, 40].map((x) => ({ v: x, n: 'Min ' + x + ' GP' })), ld.gp, { label: 'Min GP' })}</div>
        <div id="ld-out">${leadersOut()}</div>`)}</div>`;
    },
    mount(root) {
      const redraw = () => { root.querySelector('#ld-out').innerHTML = leadersOut(); };
      NQ.app.wireTabs(root, (id, k) => { ld.cat = k; ld.sort = null; redraw(); });
      root.querySelector('#ld-pos').addEventListener('change', (e) => { ld.pos = e.target.value; redraw(); });
      root.querySelector('#ld-team').addEventListener('change', (e) => { ld.team = e.target.value; redraw(); });
      root.querySelector('#ld-gp').addEventListener('change', (e) => { ld.gp = +e.target.value; redraw(); });
      root.querySelector('#ld-out').addEventListener('click', (e) => { const th = e.target.closest('[data-sort]'); if (th) { ld.sort = th.dataset.sort; redraw(); } });
    }
  };

  // ------------------------------------------------------------ feature store
  const fs = { q: '', scope: 'ALL', src: 'ALL' };
  function libOut() {
    const cat = S().catalog.filter((m) => (fs.scope === 'ALL' || m.scope === fs.scope) && (fs.src === 'ALL' || m.src === fs.src) && (!fs.q || (m.n + ' ' + m.def + ' ' + m.k + ' ' + m.cat).toLowerCase().includes(fs.q)));
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Key</th><th>Metric</th><th>Scope</th><th>Category</th><th>Src</th><th>Format</th><th>Direction</th><th>Definition</th></tr></thead><tbody>
      ${cat.map((m) => `<tr><td class="mono muted">${m.k}</td><td>${u.esc(m.n)}</td><td>${u.esc(m.scope)}</td><td class="muted">${u.esc(m.cat)}</td><td>${c.srcTag(m.src)}</td><td class="mono muted">${m.f}</td><td>${m.hib === true ? '↑ higher better' : m.hib === false ? '↓ lower better' : '— context'}</td><td style="white-space:normal;min-width:240px">${u.esc(m.def)}</td></tr>`).join('')}</tbody></table></div><div class="note">${cat.length} of ${S().catalog.length} metric definitions.</div>`;
  }
  NQ.views.library = {
    render() {
      const cat = S().catalog;
      const by = (k) => cat.reduce((o, m) => { o[m[k]] = (o[m[k]] || 0) + 1; return o; }, {});
      const sc = by('scope'), sr = by('src');
      return `<div class="grid"><div class="stats">${Object.entries(sc).map(([k, n]) => c.stat(k, n)).join('')}${Object.entries(sr).map(([k, n]) => c.stat('Source ' + k, n)).join('')}</div>
        ${c.panel('Feature Store', 'metric definitions · formula · source · direction', `<div class="ctrl" style="margin-bottom:8px"><input class="inp" id="fs-q" placeholder="Search metrics, formulas…" value="${u.esc(fs.q)}" style="min-width:220px;flex:1">
          ${c.select('fs-scope', [{ v: 'ALL', n: 'All scopes' }, ...Object.keys(sc).map((k) => ({ v: k, n: k }))], fs.scope, { label: 'Scope' })}${c.select('fs-src', [{ v: 'ALL', n: 'All sources' }, { v: 'PBP', n: 'PBP — play-by-play' }, { v: 'TRK', n: 'TRK — tracking-equivalent' }, { v: 'MDL', n: 'MDL — model output' }], fs.src, { label: 'Source' })}</div>
          <div id="fs-out">${libOut()}</div>`)}</div>`;
    },
    mount(root) {
      const redraw = () => { root.querySelector('#fs-out').innerHTML = libOut(); };
      root.querySelector('#fs-q').addEventListener('input', (e) => { fs.q = e.target.value.trim().toLowerCase(); redraw(); });
      root.querySelector('#fs-scope').addEventListener('change', (e) => { fs.scope = e.target.value; redraw(); });
      root.querySelector('#fs-src').addEventListener('change', (e) => { fs.src = e.target.value; redraw(); });
    }
  };
  void P;
})(globalThis.NQ = globalThis.NQ || {});

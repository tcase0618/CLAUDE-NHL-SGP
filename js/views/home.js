/* ==========================================================================
 * Home dashboard + reusable panel builders (NQ.parts).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  NQ.views = NQ.views || {};
  const parts = {};
  NQ.parts = parts;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];

  // ------------------------------------------------------------ data helpers
  parts.monthLabels = (gids) => {
    const games = S().season.games;
    const out = []; let last = '';
    gids.forEach((gid, i) => { const m = games[gid].date.split(' ')[0]; if (m !== last) { out.push({ i, label: m }); last = m; } });
    return out;
  };
  parts.teamRolling = (tid, w) => {
    const log = S().season.team[tid].log;
    const f = u.rollingRatio(log.map((g) => g.xgf5), log.map((g) => g.toi5), w || 10, 3600);
    const a = u.rollingRatio(log.map((g) => g.xga5), log.map((g) => g.toi5), w || 10, 3600);
    const k = Math.min(4, log.length - 1); // need a few games before a rolling rate is meaningful
    return { f: f.map((x, i) => (i < k ? null : x)), a: a.map((x, i) => (i < k ? null : x)), gids: log.map((g) => g.gid) };
  };
  parts.topSkater = (team) => team.roster.slice(0, 18).map((id) => [id, S().M.skater[id].rating.overall]).sort((a, b) => b[1] - a[1])[0][0];
  parts.starter = (team) => {
    const a = team.roster[18], b = team.roster[19];
    return S().season.gsG[a] >= S().season.gsG[b] ? a : b;
  };

  // ------------------------------------------------------------ player card
  parts.playerCard = (pid, o) => {
    o = o || {};
    const p = P(pid), t = TM(p.teamId), m = S().M.skater[pid], v = m.vals, pc = m.pct, r = m.rating;
    const mod = NQ.metrics.MODULES[m.mods[0]].n;
    const keys = [['xgf60', 'xGF/60'], ['xga60', 'xGA/60'], ['xgf', 'xGF%'], ['sog60', 'Shots/60'], ['pp160', 'Primary P/60'], ['cent60', 'Controlled Entry/60'], ['cex60', 'Zone Exit/60'], ['hit60', 'Hits/60']];
    const log = S().season.plog[pid];
    const warm = (arr) => arr.map((x, i) => (i < 4 ? null : x));
    const rf = warm(u.rollingRatio(log.map((g) => g.xgf5), log.map((g) => g.toi5), 10, 3600));
    const ra = warm(u.rollingRatio(log.map((g) => g.xga5), log.map((g) => g.toi5), 10, 3600));
    const rx = u.rollingRatio(log.map((g) => g.xgf5), log.map((g) => g.xgf5 + g.xga5), 8, 100);
    const body = `
      <div class="prof">${c.avatar(p, t, 78)}
        <div style="flex:1;min-width:180px">
          <div class="pn"><span class="no">#${p.num}</span> ${u.esc((p.first + ' ' + p.last).toUpperCase())} <span class="posbox">${p.pos}</span></div>
          <div class="meta">${{ C: 'Center', LW: 'Left Wing', RW: 'Right Wing', D: 'Defense' }[p.pos]} · Age ${p.age} · ${Math.floor(p.ht / 12)}'${p.ht % 12}" · ${p.wt} lb · Shoots ${p.shoots}</div>
          <div>${c.team(t)} <span class="muted">Role:</span> ${c.roleBadges(p)}</div>
        </div>
        <div class="modbox"><b>80 Universal Skater Metrics</b>Positional module: <span class="badge b-arch">${mod}</span></div>
      </div>
      <div class="grid g2" style="margin-top:10px">
        <div><div class="sect">Key metrics (per 60, 5v5)</div>
          <table class="mt"><thead><tr><th>Metric</th><th class="r">Value</th><th>%ile</th></tr></thead><tbody>
          ${keys.map(([k, n]) => `<tr><td>${n}</td><td class="r num">${u.fmtMetric(v[k], k === 'xgf' ? 'pct' : 'r2')}</td><td>${c.pbar(pc[k])}</td></tr>`).join('')}
          </tbody></table></div>
        <div><div class="sect">Rating &amp; trend (5v5)</div>
          <div class="rating"><span class="muted">Overall</span><span class="big">${r.overall.toFixed(1)}</span>${c.sign(r.trend, 1)}<span style="flex:1">${ch.spark(rx, { color: 'var(--pos)', w: 110, h: 30 })}</span></div>
          <div class="comp">${[['Offense', r.offense], ['Defense', r.defense], ['Transition', r.transition], ['Special Teams', r.special], ['Impact', r.impact]].map(([k, x]) => `<span>${k}</span><span class="cv">${x.toFixed(1)}</span>`).join('')}</div>
          <div class="sect">xGF/60 vs xGA/60 (10-game rolling)</div>
          ${ch.line({ w: 300, h: 110, series: [{ data: rf, color: 'var(--accent)' }, { data: ra, color: 'var(--neg)' }], xLabels: parts.monthLabels(log.map((g) => g.gid)), yTicks: 3, label: 'rolling xGF and xGA per 60' })}
        </div>
      </div>`;
    return c.panel('Player Intelligence', 'Skater Profile', body, { actions: o.link !== false ? `<a class="btn ghost sm" href="#/player/${pid}">Open profile</a>` : '' });
  };

  // ------------------------------------------------------------ goalie card
  parts.netCells = (gid) => {
    const cells = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ sa: 0, ga: 0, xga: 0 })));
    for (const s of S().season.shots) {
      if (s.g !== gid || s.r < 1 || s.nx === undefined) continue;
      const col = s.nx < -1 ? 0 : s.nx > 1 ? 2 : 1, row = s.ny > 2.6 ? 0 : s.ny > 1.2 ? 1 : 2;
      const cell = cells[row][col]; cell.sa++; cell.xga += s.xg; if (s.r === 2) cell.ga++;
    }
    return cells;
  };
  parts.goalieCard = (gid, o) => {
    o = o || {};
    const p = P(gid), t = TM(p.teamId), m = S().M.goalie[gid], v = m.vals, pc = m.pct;
    const a = S().season.gk[gid], G = NQ.sim.G;
    const log = S().season.plog[gid];
    let cum = 0; const cs = log.map((g) => (cum += g.xga - g.ga));
    const keys = [['gsv', 'Save % (all)', 'sv'], ['gxsv', 'Save % (xG)', 'sv'], ['ggsax', 'GSAx (total)', 's1'], ['ggsax60', 'GSAx/60', 's2'], ['greba', 'Rebound rate %', 'pct'], ['ghd', 'High-danger SV%', 'sv'], ['gmd', 'Mid-danger SV%', 'sv'], ['gld', 'Low-danger SV%', 'sv']];
    const dz = [['High', G.SAHD, G.GAHD, G.XGAHD], ['Medium', G.SAMD, G.GAMD, G.XGAMD], ['Low', G.SALD, G.GALD, G.XGALD]];
    const body = `
      <div class="prof">${c.avatar(p, t, 78)}
        <div style="flex:1;min-width:160px"><div class="pn"><span class="no">#${p.num}</span> ${u.esc((p.first + ' ' + p.last).toUpperCase())} <span class="posbox">G</span></div>
        <div class="meta">Age ${p.age} · ${Math.floor(p.ht / 12)}'${p.ht % 12}" · ${p.wt} lb · Catches ${p.catches}</div><div>${c.team(t)} ${c.roleBadges(p)}</div></div>
        <div class="modbox"><b>60-Metric Goalie Profile</b>Rating <span class="mono pos">${m.rating.overall.toFixed(1)}</span></div>
      </div>
      <div class="grid g2" style="margin-top:10px">
        <div><div class="sect">Key goalie metrics</div>
          <table class="mt"><thead><tr><th>Metric</th><th class="r">Value</th><th>%ile</th></tr></thead><tbody>
          ${keys.map(([k, n, f]) => `<tr><td>${n}</td><td class="r num">${u.fmtMetric(v[k], f)}</td><td>${c.pbar(pc[k])}</td></tr>`).join('')}</tbody></table></div>
        <div><div class="sect">GSAx (cumulative)</div>
          ${ch.line({ w: 300, h: 100, series: [{ data: cs, color: 'var(--pos)', area: true }], ref: 0, yTicks: 3, label: 'cumulative GSAx' })}
          <div class="grid g2" style="gap:6px"><div><div class="sect">Crease performance</div>${ch.net(parts.netCells(gid))}</div>
          <div><div class="sect">Shot-danger split</div><table class="mt"><thead><tr><th>Danger</th><th class="r">SV%</th><th class="r">Shots</th><th class="r">Δ</th></tr></thead><tbody>
          ${dz.map(([n, s1, g1, x1]) => { const sv = a[s1] ? 1 - a[g1] / a[s1] : null, xs = a[s1] ? 1 - a[x1] / a[s1] : null; return `<tr><td>${n}</td><td class="r num">${u.sv(sv)}</td><td class="r num">${a[s1]}</td><td class="r num">${c.sign(sv !== null ? sv - xs : null, 3)}</td></tr>`; }).join('')}</tbody></table></div></div>
        </div>
      </div>`;
    return c.panel('Goalie Intelligence', 'Goalie Profile', body, { actions: o.link !== false ? `<a class="btn ghost sm" href="#/goalie/${gid}">Open profile</a>` : '' });
  };

  // ------------------------------------------------------------ team card
  parts.teamRadar = (tid, size, cmp) => {
    const cat = S().M.team[tid].cat;
    const ax = [['Offense', ['t2', 't4']], ['Defense', ['t3', 't5', 't11']], ['Transition', ['t8', 't9']], ['Special Teams', ['t6', 't7']], ['Possession', ['t1', 't10']], ['Goaltending', ['t13']]];
    const val = (id) => ax.map(([, ks]) => u.mean(ks.map((k) => S().M.team[id].cat[k])) / 100);
    const series = [{ vals: val(tid), color: 'var(--accent)' }];
    if (cmp !== undefined) series.push({ vals: val(cmp), color: 'var(--neg)', fill: 0.12 });
    void cat;
    return ch.radar(ax.map((x) => x[0]), series, { size: size || 220 });
  };
  parts.teamCard = (tid, o) => {
    o = o || {};
    const t = TM(tid), M = S().M.team[tid], v = M.vals, rk = M.rank, tr = S().season.team[tid];
    const row = (n, k, f) => `<tr><td>${n}</td><td class="r num">${u.fmtMetric(v[k], f)}</td><td class="r"><span class="rank ${rk[k] <= 5 ? 'r-top' : rk[k] >= 28 ? 'r-bot' : ''}">${u.ord(rk[k])}</span></td></tr>`;
    const body = `
      <div class="prof">${c.crest(t, 56)}<div style="flex:1"><div class="pn">${t.abbr} <span class="muted" style="font-size:14px;font-weight:600">${u.esc(t.full)}</span></div>
        <div class="meta">${t.div} · ${t.conf} · Record (DEMO): <b class="mono">${tr.w}-${tr.l}-${tr.otl}</b> (${tr.pts} pts)</div></div>
        <div class="modbox"><b>200-Metric Team Intelligence</b>Rating <span class="mono ${v.trtg >= 0 ? 'pos' : 'neg'}">${u.sgn(v.trtg, 2)}</span></div></div>
      <div class="grid g3" style="margin-top:10px">
        <div><div class="sect">5v5 expected goals (per 60)</div><table class="mt"><thead><tr><th>Metric</th><th class="r">${t.abbr}</th><th class="r">Rank</th></tr></thead><tbody>
          ${row('xGF/60', 'txgf60', 'r2')}${row('xGA/60', 'txga60', 'r2')}${row('xGF%', 'txgf', 'pct')}${row('HDCF/60', 'thd5', 'r2')}${row('HDCA/60', 'thda5', 'r2')}</tbody></table></div>
        <div><div class="sect">Special teams</div><table class="mt"><thead><tr><th>Unit</th><th class="r">Rate</th><th class="r">Rank</th></tr></thead><tbody>${row('Power Play', 'tpp', 'pct')}${row('Penalty Kill', 'tpk', 'pct')}</tbody></table>
          <div class="sect">Opponent-adjusted</div><table class="mt"><tbody>${row('Adj. defense', 'tdsup', 's2')}${row('Adj. net rating', 'trtg', 's2')}${row('xPts', 'txpts', 'r1')}</tbody></table></div>
        <div><div class="sect">Team profile (relative)</div>${parts.teamRadar(tid, 200)}</div>
      </div>`;
    return c.panel('Team Intelligence', 'Team Profile', body, { actions: o.link !== false ? `<a class="btn ghost sm" href="#/team/${t.abbr}">Open profile</a>` : '' });
  };

  // ------------------------------------------------------------ other panels
  parts.xgTrend = (tid) => {
    const r = parts.teamRolling(tid, 10), t = TM(tid), v = S().M.team[tid].vals;
    return c.panel('5v5 xG / xGA Trend', '', `<div class="legend"><span><i style="background:var(--accent)"></i>xGF/60 (${t.abbr}): <b class="mono">${u.fx(v.txgf60)}</b></span><span><i style="background:var(--neg)"></i>xGA/60 (${t.abbr}): <b class="mono">${u.fx(v.txga60)}</b></span></div>
      ${ch.line({ w: 360, h: 190, series: [{ data: r.f, color: 'var(--accent)', dots: true }, { data: r.a, color: 'var(--neg)', dots: true }], xLabels: parts.monthLabels(r.gids), label: '10-game rolling 5v5 xGF and xGA per 60' })}`);
  };

  parts.shotMap = (shots, title, o) => {
    o = o || {};
    const cnt = (r) => shots.filter((s) => s.r === r).length;
    const body = `<div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start">${ch.rink(shots, { heat: o.heat })}
      <div><div class="sect">Shot attempts${o.who ? ` (${o.who})` : ''}</div>
      <div class="legend" style="flex-direction:column;gap:3px"><span><i style="background:#ff4d4d"></i>Goal (n = ${cnt(2)})</span><span><i style="background:#ffa53a"></i>On net (n = ${cnt(1)})</span><span><i style="background:#4f8fe8"></i>Missed (n = ${cnt(0)})</span><span><i style="background:#9aa7b8"></i>Blocked (n = ${cnt(3)})</span></div>
      <div class="sect">Shooting lanes</div><div class="legend" style="flex-direction:column;gap:3px"><span><i class="sq" style="background:rgba(255,93,93,.5)"></i>High-danger lane</span><span><i class="sq" style="background:rgba(255,176,32,.45)"></i>Slot lane</span><span><i class="sq" style="background:rgba(61,115,201,.35)"></i>Perimeter lane</span></div>
      <div class="note">ixG ${u.fx(shots.reduce((s, x) => s + x.xg, 0), 1)} · ${shots.length} attempts</div></div></div>`;
    return c.panel(title || 'Shot Map & Shooting Lanes', o.sub || '', body);
  };

  parts.zones = (tid) => {
    const v = S().M.team[tid].vals;
    const z = (k) => Math.min(1, Math.max(0, ((v[k] || 50) - 35) / 35));
    return c.panel('Zone Entries & Exits', 'per 60', `${ch.fullRink({ entries: [z('tcent'), z('te2s'), z('tcarry')], exits: [z('tcex'), z('texp'), z('tretr')] })}
      <div class="grid g2" style="margin-top:6px">
        <div><div class="sect">Zone entries (offense)</div><table class="mt"><tbody>
          <tr><td>Controlled entry %</td><td class="r num">${u.fmtMetric(v.tcent, 'pct')}</td></tr><tr><td>Entries / 60</td><td class="r num">${u.fx(v.tent60, 1)}</td></tr>
          <tr><td>Entry → shot %</td><td class="r num">${u.fmtMetric(v.te2s, 'pct')}</td></tr><tr><td>Dump-in recovery %</td><td class="r num">${u.fmtMetric(v.tdump, 'pct')}</td></tr></tbody></table></div>
        <div><div class="sect">Zone exits (defense)</div><table class="mt"><tbody>
          <tr><td>Controlled exit %</td><td class="r num">${u.fmtMetric(v.tcex, 'pct')}</td></tr><tr><td>Exits / 60</td><td class="r num">${u.fx(v.tex60, 1)}</td></tr>
          <tr><td>Retrieval success %</td><td class="r num">${u.fmtMetric(v.tretr, 'pct')}</td></tr><tr><td>Exit pass completion %</td><td class="r num">${u.fmtMetric(v.texp, 'pct')}</td></tr></tbody></table></div>
      </div><div class="note">Entry/exit events are tracking-equivalent (TRK) metrics.</div>`);
  };

  parts.lineTable = (tid, kind, o) => {
    o = o || {};
    const C = S().M.chem[tid];
    const units = kind === 'pairs' ? C.pairs : C.lines;
    const totToi = units.reduce((s, l) => s + l.st.toi, 0);
    const rows = units.map((l, i) => `<tr><td>${kind === 'pairs' ? 'P' : 'L'}${i + 1}: ${l.ids.map((id) => c.pname(P(id), { short: true }).replace(/^(<a[^>]*>)\w+\. /, '$1')).join(' – ')}</td>
      <td class="num">${Math.round(l.toiMin)}</td><td class="num ${l.xgfPct >= 50 ? 'pos' : 'neg'}">${u.fx(l.xgfPct, 1)}%</td><td class="num">${u.fx(l.obsF)}</td>${o.full ? `<td class="num">${u.fx(l.obsA)}</td><td class="num">${u.fx(l.expPct, 1)}%</td>` : ''}
      <td class="num">${u.fx((100 * l.st.toi) / totToi, 1)}%</td><td class="num">${c.sign(l.synergy, 2)}</td>${o.full ? `<td class="num">±${u.fx(l.ci, 1)}</td>` : ''}</tr>`).join('');
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>${kind === 'pairs' ? 'Pair (D1 – D2)' : 'Line (C – LW – RW)'}</th><th class="num">TOI</th><th class="num">xGF%</th><th class="num">xGF/60</th>${o.full ? '<th class="num">xGA/60</th><th class="num">Exp xGF%</th>' : ''}<th class="num">Usage</th><th class="num" title="Regularised interaction effect, xG diff / 60">Synergy</th>${o.full ? '<th class="num">95% CI</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  parts.matrix = (aId, bId) => {
    const st = S();
    const res = NQ.chem.matchup(st.M.chem, aId, bId, st.M.LG.xga60, st.M.LG.xga60);
    const A = TM(aId), B = TM(bId);
    const cell = (v) => `<td style="background:${u.diverge(v / 6)}" title="${v.toFixed(2)} xGF% pts">${u.sgn(v, 1)}</td>`;
    const html = `<table class="mx"><thead><tr><th>${A.abbr} \\ ${B.abbr}</th>${res.m[0].map((_, j) => `<th>L${j + 1}</th>`).join('')}<th>Edge</th></tr></thead><tbody>
      ${res.m.map((row, i) => `<tr><th>${A.abbr} L${i + 1}</th>${row.map(cell).join('')}${cell(res.rowEdge[i])}</tr>`).join('')}</tbody></table>
      <div class="why" style="text-align:center">Overall matchup edge (${A.abbr}): <b class="mono ${res.overall >= 0 ? 'pos' : 'neg'}">${u.sgn(res.overall, 1)}% xGF</b></div>`;
    return { html, res };
  };

  parts.projTable = (res, side, limit) => {
    const st = S();
    const rows = res.players.filter((r) => r.t === side).sort((a, b) => b.PTS.mean - a.PTS.mean).slice(0, limit || 5);
    const g = res.goalies.filter((x) => x.t === side && x.pStart > 0).sort((a, b) => b.pStart - a.pStart)[0];
    let h = `<div class="tscroll"><table class="tbl"><thead><tr><th>Player (${TM(side === 0 ? res.homeId : res.awayId).abbr})</th><th class="num">G</th><th class="num">A</th><th class="num">SOG</th><th class="num">BLK</th><th>Points dist.</th><th class="num">90% range</th></tr></thead><tbody>`;
    for (const r of rows) {
      const p = st.league.players[r.pid];
      h += `<tr><td>${c.pname(p, { short: true, pos: true })}</td><td class="num">${u.fx(r.G.mean)}</td><td class="num">${u.fx(r.A.mean)}</td><td class="num">${u.fx(r.SOG.mean, 1)}</td><td class="num">${u.fx(r.BLK.mean, 1)}</td><td>${ch.mini(r.PTS.dist)}</td><td class="num muted">G ${r.G.lo}–${r.G.hi} · A ${r.A.lo}–${r.A.hi}</td></tr>`;
    }
    if (g) h += `<tr><td>${c.pname(st.league.players[g.pid], { short: true })} <span class="pos">G</span></td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>${ch.mini(g.gaDist, 'var(--neg)')}</td><td class="num muted">Saves ${u.fx(g.sv, 1)} (${g.svLo}–${g.svHi})</td></tr>`;
    return h + '</tbody></table></div>';
  };

  parts.gamePred = (res) => {
    const H = TM(res.homeId), A = TM(res.awayId);
    return `<div class="vs"><div>${c.crest(H, 52)}<div style="margin-top:4px">${c.team(H, { big: true })}</div><div class="muted">Win prob.</div><div class="wp pos">${u.pct(res.winH)}</div></div>
      <div class="vsc">VS</div>
      <div>${c.crest(A, 52)}<div style="margin-top:4px">${c.team(A, { big: true })}</div><div class="muted">Win prob.</div><div class="wp neg">${u.pct(res.winA)}</div></div></div>
      ${c.split(res.winH, res.winA, H.abbr, A.abbr)}
      <div class="score"><div class="lab">PROJECTED FINAL SCORE (MEAN)</div><div class="val">${H.abbr} ${u.fx(res.home.mean, 1)} — ${u.fx(res.away.mean, 1)} ${A.abbr}</div><div class="muted mono">Most likely exact: ${res.modal[0]}–${res.modal[1]} (${u.pct(res.modal[2])})</div></div>
      <div class="sect">Game outcomes (probability)</div>
      <div class="outcomes"><div class="o"><div class="l">Regulation win (${H.abbr})</div><div class="v pos">${u.pct(res.regH)}</div></div><div class="o"><div class="l">OT / SO win (${H.abbr})</div><div class="v">${u.pct(res.otH + res.soH)}</div></div>
      <div class="o"><div class="l">Regulation win (${A.abbr})</div><div class="v neg">${u.pct(res.regA)}</div></div><div class="o"><div class="l">OT / SO win (${A.abbr})</div><div class="v">${u.pct(res.otA + res.soA)}</div></div></div>
      <div class="sect">Team goal projections</div><table class="tbl"><thead><tr><th>Team</th><th class="num">Mean</th><th class="num">90% range</th><th class="num">SOG</th><th class="num">xG</th><th class="num">P(shutout)</th></tr></thead><tbody>
      <tr><td>${c.team(H)}</td><td class="num">${u.fx(res.home.mean)}</td><td class="num">${res.home.lo} – ${res.home.hi}</td><td class="num">${u.fx(res.home.sog, 1)}</td><td class="num">${u.fx(res.home.xg)}</td><td class="num">${u.pct(res.shutH)}</td></tr>
      <tr><td>${c.team(A)}</td><td class="num">${u.fx(res.away.mean)}</td><td class="num">${res.away.lo} – ${res.away.hi}</td><td class="num">${u.fx(res.away.sog, 1)}</td><td class="num">${u.fx(res.away.xg)}</td><td class="num">${u.pct(res.shutA)}</td></tr></tbody></table>
      <div class="note">${res.n.toLocaleString()} event-level simulations · OT ${u.pct(res.pOT)} · shootout ${u.pct(res.pSO)}</div>`;
  };

  parts.auditMini = (res) => {
    const A = S().audit;
    const se = res ? Math.sqrt((res.winH * (1 - res.winH)) / res.n) : 0;
    return `<div class="grid g3" style="gap:8px">
      <div><div class="sect">Calibration curve (win prob.)</div>${ch.calib(A.cal, { w: 240, h: 200 })}<div class="legend"><span><i style="background:var(--accent)"></i>Model v3.7</span><span><i style="background:var(--txt3)"></i>Perfect</span></div></div>
      <div><div class="sect">Prediction error (out-of-sample)</div><table class="mt"><tbody>
        <tr><td>Brier score</td><td class="r num">${u.fx(A.model.brier, 3)}</td></tr><tr><td>Log loss</td><td class="r num">${u.fx(A.model.logloss, 3)}</td></tr>
        <tr><td>Accuracy</td><td class="r num">${u.pct(A.model.acc)}</td></tr><tr><td>MAE (total goals)</td><td class="r num">${u.fx(A.totals.mae, 2)}</td></tr>
        <tr><td>Calibration slope</td><td class="r num">${u.fx(A.fit.slope, 2)}</td></tr><tr><td>Calibration intercept</td><td class="r num">${u.sgn(A.fit.intercept, 2)}</td></tr>
        <tr><td>Games tested</td><td class="r num">${A.n}</td></tr></tbody></table>
        <div class="note">Home-ice baseline Brier ${u.fx(A.home.brier, 3)} · coin ${u.fx(A.coin.brier, 3)}</div></div>
      <div><div class="sect">Confidence intervals</div>${res ? `<table class="mt"><thead><tr><th>Target</th><th class="r">Pred.</th><th class="r">90% PI</th></tr></thead><tbody>
        <tr><td>${TM(res.homeId).abbr} goals</td><td class="r num">${u.fx(res.home.mean)}</td><td class="r num">[${res.home.lo}, ${res.home.hi}]</td></tr>
        <tr><td>${TM(res.awayId).abbr} goals</td><td class="r num">${u.fx(res.away.mean)}</td><td class="r num">[${res.away.lo}, ${res.away.hi}]</td></tr>
        <tr><td>${TM(res.homeId).abbr} win prob.</td><td class="r num">${u.fx(res.winH, 3)}</td><td class="r num">[${u.fx(res.winH - 1.645 * se, 3)}, ${u.fx(res.winH + 1.645 * se, 3)}]</td></tr></tbody></table>` : c.loading()}
        <div class="sect">Model version tracking</div><table class="mt"><tbody>${NQ.views.audit.VERSIONS.slice(0, 3).map((x, i) => `<tr><td>${i === 0 ? '<span class="pos">✓</span> ' : ''}v${x.v}</td><td class="mono muted">${x.d}</td></tr>`).join('')}</tbody></table></div></div>`;
  };

  // ------------------------------------------------------------ home view
  NQ.views.home = {
    render() {
      const st = S();
      const team = st.league.byAbbr[NQ.app.focus];
      const next = NQ.app.nextGame(team.id);
      const opp = next ? (next.home === team.id ? next.away : next.home) : (team.id + 1) % 32;
      const shots = st.season.shots.filter((s) => s.tm === team.id);
      const mat = parts.matrix(team.id, opp);
      return `<div class="grid g-home">
        ${parts.playerCard(parts.topSkater(team))}
        ${parts.goalieCard(parts.starter(team))}
        ${parts.teamCard(team.id)}
      </div>
      <div class="grid g3" style="margin-top:10px">
        ${parts.xgTrend(team.id)}
        ${parts.shotMap(shots, 'Shot Map & Shooting Lanes', { who: team.abbr })}
        ${parts.zones(team.id)}
      </div>
      <div class="grid g3" style="margin-top:10px">
        ${c.panel('Forward-Line Chemistry', '5v5', parts.lineTable(team.id, 'lines'))}
        ${c.panel('Defensive-Pairing Chemistry', '5v5', parts.lineTable(team.id, 'pairs'))}
        ${c.panel('Opponent Matchup Matrix', `${team.abbr} lines vs ${TM(opp).abbr} lines · matchup edge (xGF%)`, mat.html)}
      </div>
      <div class="grid g3" style="margin-top:10px">
        ${c.panel('Player Projections', `Next game${next ? ' · ' + next.date : ''}`, `<div id="h-proj">${c.loading()}</div>`)}
        ${c.panel('Game Prediction', 'Projected final score', `<div id="h-pred">${c.loading()}</div>`, { actions: next ? `<a class="btn ghost sm" href="#/predict/${TM(next.home).abbr}/${TM(next.away).abbr}">Open in engine</a>` : '' })}
        ${c.panel('Model Calibration & Audit', '', `<div id="h-audit">${parts.auditMini(null)}</div>`)}
      </div>`;
    },
    mount(root) {
      const st = S();
      const team = st.league.byAbbr[NQ.app.focus];
      const next = NQ.app.nextGame(team.id);
      if (!next) return;
      const el = root.querySelector('#h-pred');
      NQ.app.mc(next.home, next.away, NQ.app.withProgress(el, {})).then((res) => {
        if (!document.body.contains(el)) return;
        const side = next.home === team.id ? 0 : 1;
        root.querySelector('#h-proj').innerHTML = parts.projTable(res, side, 5) + `<div class="note">Mean projections from ${res.n.toLocaleString()} simulations; distribution = points.</div>`;
        el.innerHTML = parts.gamePred(res);
        root.querySelector('#h-audit').innerHTML = parts.auditMini(res);
      });
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

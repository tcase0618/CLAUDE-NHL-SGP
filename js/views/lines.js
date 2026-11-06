/* ==========================================================================
 * Lines & Pairings Laboratory — forward lines, D pairs, PP/PK units,
 * chemistry decomposition (individual + regularised interaction), builder.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c;
  const S = () => NQ.app.state;
  const P = (id) => S().league.players[id];
  const TM = (id) => S().league.teams[id];
  const nm = (id) => u.esc(P(id).last);

  function decomposition(tid) {
    const C = S().M.chem[tid];
    const units = [...C.lines.map((l, i) => ['L' + (i + 1), l]), ...C.pairs.map((l, i) => ['P' + (i + 1), l])];
    const lo = 35, hi = 65, X = (v) => ((u.clamp(v, lo, hi) - lo) / (hi - lo)) * 100;
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>Unit</th><th class="num">TOI</th><th class="num">Expected xGF%<br><span class="muted">Σ individuals</span></th><th class="num">Observed</th><th class="num">Shrink</th><th class="num">Chemistry<br><span class="muted">xGF% pts</span></th><th style="min-width:200px">Expected ◆ · Observed ● · adjusted ▮ (35–65%)</th></tr></thead><tbody>
      ${units.map(([k, l]) => `<tr><td><b>${k}</b> <span class="muted">${l.ids.map(nm).join(' – ')}</span></td><td class="num">${Math.round(l.toiMin)}</td><td class="num">${u.fx(l.expPct, 1)}</td><td class="num">${u.fx(l.xgfPct, 1)}</td><td class="num">${u.pct(l.shrink, 0)}</td><td class="num">${c.sign(l.chemPct, 2)}</td>
        <td><div style="position:relative;height:14px;background:var(--line);border-radius:7px">
          <i style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--txt3)"></i>
          <i style="position:absolute;left:${X(l.adjPct - l.ci / 2)}%;width:${Math.max(1, X(l.adjPct + l.ci / 2) - X(l.adjPct - l.ci / 2))}%;top:3px;height:8px;background:rgba(63,169,255,.35);border-radius:4px"></i>
          <i style="position:absolute;left:calc(${X(l.expPct)}% - 5px);top:1px;color:var(--warn);font-style:normal;font-size:10px">◆</i>
          <i style="position:absolute;left:calc(${X(l.xgfPct)}% - 4px);top:3px;width:8px;height:8px;border-radius:50%;background:var(--txt)"></i>
          <i style="position:absolute;left:calc(${X(l.adjPct)}% - 1px);top:0;width:3px;height:14px;background:var(--accent)"></i></div></td></tr>`).join('')}</tbody></table></div>
      <div class="why"><b>Line impact = Σ individual impact + interaction.</b> Individual impact comes from each skater's measured offensive (ixG, xA, entries, transition xG) and defensive (entry denial, takeaways, retrievals, errors) profile. The residual is the interaction effect, shrunk by <span class="mono">TOI / (TOI + 250 min)</span> for lines and 300 min for pairs — a new trio with 20 strong minutes cannot be labelled elite.</div>`;
  }

  function units(tid) {
    const C = S().M.chem[tid];
    const pp = C.pp.map((x, i) => `<tr><td><b>PP${i + 1}</b> <span class="muted">${x.ids.map(nm).join(', ')}</span></td><td class="num">${u.toi(x.toi)}</td><td class="num">${x.gf}</td><td class="num">${u.fx(x.xgf, 1)}</td><td class="num">${x.toi ? u.fx((x.xgf * 3600) / x.toi, 2) : '—'}</td><td class="num">${x.toi ? u.fx((x.gf * 3600) / x.toi, 2) : '—'}</td><td class="num">${x.toi ? u.fx((x.sf * 3600) / x.toi, 1) : '—'}</td></tr>`).join('');
    const pk = C.pk.map((x, i) => `<tr><td><b>PK${i + 1}</b> <span class="muted">${x.ids.map(nm).join(', ')}</span></td><td class="num">${u.toi(x.toi)}</td><td class="num">${x.ga}</td><td class="num">${u.fx(x.xga, 1)}</td><td class="num">${x.toi ? u.fx((x.xga * 3600) / x.toi, 2) : '—'}</td><td class="num">${x.toi ? u.fx((x.ga * 3600) / x.toi, 2) : '—'}</td><td class="num">${x.toi ? u.fx((x.sa * 3600) / x.toi, 1) : '—'}</td></tr>`).join('');
    return `<div class="sect">Power-play units</div><table class="tbl"><thead><tr><th>Unit</th><th class="num">TOI</th><th class="num">GF</th><th class="num">xGF</th><th class="num">xGF/60</th><th class="num">GF/60</th><th class="num">SF/60</th></tr></thead><tbody>${pp}</tbody></table>
      <div class="sect">Penalty-kill units</div><table class="tbl"><thead><tr><th>Unit</th><th class="num">TOI</th><th class="num">GA</th><th class="num">xGA</th><th class="num">xGA/60</th><th class="num">GA/60</th><th class="num">SA/60</th></tr></thead><tbody>${pk}</tbody></table>`;
  }

  function builder(tid, picks) {
    const t = TM(tid);
    const fw = t.roster.slice(0, 12);
    const opts = fw.map((id) => ({ v: id, n: `${P(id).last} (${P(id).pos})` }));
    return `<div class="ctrl">${[0, 1, 2].map((i) => c.select('lb-' + i, opts, picks[i], { label: 'Forward ' + (i + 1) })).join('')}<button class="btn sm" id="lb-go">Project line</button></div><div id="lb-out" style="margin-top:8px"></div>`;
  }

  function builderOut(tid, ids) {
    const st = S();
    if (new Set(ids).size < 3) return c.empty('Pick three different forwards.');
    const r = NQ.chem.customLine(st.league, st.M.chem, tid, ids);
    const imp = st.M.chem[tid].imp;
    return `<div class="stats">${c.stat('Proj. xGF/60', u.fx(r.adjF))}${c.stat('Proj. xGA/60', u.fx(r.adjA))}${c.stat('Proj. xGF%', u.fx(r.adjPct, 1) + '%', { cls: r.adjPct >= 50 ? 'hl' : 'bad' })}${c.stat('Chemistry', u.sgn(r.chemPct, 2), { sub: r.existing ? `${Math.round(r.toiMin)} shared min` : 'no shared TOI → 0' })}${c.stat('95% CI', '±' + u.fx(r.ci, 1))}</div>
      <table class="tbl" style="margin-top:6px"><thead><tr><th>Player</th><th class="num">Off. impact (xGF/60)</th><th class="num">Def. impact (xGA/60 saved)</th></tr></thead><tbody>${ids.map((id) => `<tr><td>${c.pname(P(id), { pos: true })}</td><td class="num">${c.sign(imp[id].off, 3)}</td><td class="num">${c.sign(imp[id].def, 3)}</td></tr>`).join('')}</tbody></table>
      <div class="note">${r.existing ? 'This trio is an existing line — the regularised chemistry estimate is included.' : 'New combination: projection uses individual impacts only (interaction prior = 0) with wide uncertainty.'}</div>`;
  }

  NQ.views.lines = {
    render(params) {
      const st = S();
      const t = st.league.byAbbr[params[0]] || st.league.byAbbr[NQ.app.focus];
      this.tid = t.id;
      const picks = t.lines[1].slots.map((s) => t.roster[s]);
      return `<div class="grid">
        <div class="ctrl">${c.select('ln-team', st.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr)).map((x) => ({ v: x.abbr, n: x.full })), t.abbr, { label: 'Team' })}<a class="btn ghost sm" href="#/team/${t.abbr}">Team profile</a></div>
        <div class="grid g2">
          ${c.panel('Forward Lines', `${t.abbr} · 5v5`, NQ.parts.lineTable(t.id, 'lines', { full: true }))}
          ${c.panel('Defensive Pairings', `${t.abbr} · 5v5`, NQ.parts.lineTable(t.id, 'pairs', { full: true }))}
        </div>
        ${c.panel('Chemistry Decomposition', 'individual talent + interaction effect', decomposition(t.id))}
        <div class="grid g2">
          ${c.panel('Special-Teams Units', '', units(t.id))}
          ${c.panel('Line Builder', 'project any trio', builder(t.id, picks))}
        </div></div>`;
    },
    mount(root) {
      const self = this;
      root.querySelector('#ln-team').addEventListener('change', (e) => { location.hash = '#/lines/' + e.target.value; });
      const go = () => { const ids = [0, 1, 2].map((i) => +root.querySelector('#lb-' + i).value); root.querySelector('#lb-out').innerHTML = builderOut(self.tid, ids); };
      root.querySelector('#lb-go').addEventListener('click', go);
      go();
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

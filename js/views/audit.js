/* ==========================================================================
 * Model Audit & Research — forward backtests vs baselines, calibration,
 * player/goalie projection error, feature importance, custom xG model,
 * talent-recovery diagnostics, data quality, model library, versions.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c, ch = NQ.ch;
  const S = () => NQ.app.state;

  const VERSIONS = [
    { v: '3.7.0', d: '2026-01-20', s: 'Talent-estimation layer (no hidden-truth leakage), environment calibration, SGP joint pricing, shrinkage retune' },
    { v: '3.6.0', d: '2026-01-06', s: 'Zone transition features, rebound / rush xG terms, regularised line chemistry (K = 250 min)' },
    { v: '3.5.0', d: '2025-12-15', s: 'Expanded player model (80 universal metrics + 4 positional modules), goalie hook & pull logic' },
    { v: '3.4.2', d: '2025-11-28', s: 'Bug fix: PP goal now releases the earliest-expiring minor; shootout goals excluded from player totals' },
    { v: '3.4.0', d: '2025-11-10', s: 'Hierarchical goalie shot-stopping prior (1,500-shot weight); quality-start metrics' },
    { v: '3.0.0', d: '2025-10-01', s: 'Shift/event-level simulator replaces team-level Poisson as the primary engine' }
  ];

  const LIBRARY = [
    ['Player active / scratched', 'Calibrated classifier', 'Scenario input', 'Manual scratches → replacement-level call-up'],
    ['Starting goaltender', 'Probabilistic starter model', 'Live', 'Start share × rest (b2b → 30%)'],
    ['Ice time', 'Deployment-weight shift model', 'Live', 'TOI MAE (backtest)'],
    ['Shot attempts', 'Poisson segment process (rate model)', 'Live', 'Count likelihood'],
    ['Shot on goal', 'Conditional attempt-outcome model', 'Live', 'Blocked / missed / on-net'],
    ['Shot xG', 'Logistic xG (distance, angle, type, rebound, rush, one-timer, cross-slot, strength)', 'Live', 'Log loss · AUC'],
    ['Goal scoring', 'Shot-level Bernoulli simulation', 'Live', 'Brier (1+ goal)'],
    ['Primary assists', 'Event-sequence passer model', 'Live', 'Brier (1+ point)'],
    ['Secondary assists', 'Possession involvement model', 'Live', 'Count likelihood'],
    ['Blocks / hits', 'Opportunity-adjusted count models', 'Live', 'MAE'],
    ['Faceoffs', 'Binomial matchup model (logit skill gap)', 'Live', 'Win-rate calibration'],
    ['Goalie saves', 'Shot-level save simulation', 'Live', 'Saves MAE'],
    ['Team goals / winner', 'Event simulation + analytic Poisson layer', 'Live', 'Brier · log loss · calibration'],
    ['Lineup chemistry', 'Individual impact + shrunk interaction', 'Live', 'Recovery r (synthetic truth)'],
    ['Talent estimation', 'Position-z, sample-size shrinkage', 'Live', 'Recovery r (synthetic truth)']
  ];

  function baselineTable(A) {
    const rows = [['Model v3.7 (analytic, as-of)', A.model, true], ['Home-ice prior (rolling)', A.home], ['Points-% log5 (shrunk)', A.pts], ['Coin flip', A.coin]];
    return `<table class="tbl"><thead><tr><th>Model</th><th class="num">Brier ↓</th><th class="num">Log loss ↓</th><th class="num">Accuracy</th><th class="num">Brier skill vs coin</th></tr></thead><tbody>
      ${rows.map(([n, s, me]) => `<tr ${me ? 'class="sel-row"' : ''}><td>${me ? '<b>' + n + '</b>' : n}</td><td class="num">${u.fx(s.brier, 4)}</td><td class="num">${u.fx(s.logloss, 4)}</td><td class="num">${u.pct(s.acc)}</td><td class="num">${c.sign((1 - s.brier / 0.25) * 100, 2)}%</td></tr>`).join('')}</tbody></table>
      <div class="note">${A.n} games, predicted chronologically with only pre-game information (first 5 GP per team excluded). 90% bootstrap CI on model Brier: [${u.fx(A.ci[0], 4)}, ${u.fx(A.ci[1], 4)}]. Hockey is high-variance: elite public models land around 0.24 Brier.</div>`;
  }

  function importance(A) {
    const mx = Math.max(...A.importance.map((x) => Math.abs(x.beta)));
    return A.importance.map((x) => `<div class="factor"><span>${x.name}</span><span class="fb"><i style="left:${x.beta >= 0 ? 50 : 50 - (50 * Math.abs(x.beta)) / mx}%;width:${(50 * Math.abs(x.beta)) / mx}%;background:${x.beta >= 0 ? 'var(--pos)' : 'var(--neg)'}"></i></span><span class="num r">${u.sgn(x.beta, 3)}</span></div>`).join('') +
      '<div class="note">Standardised logistic-regression coefficients on the backtest set (home-win target). These are research diagnostics, not causal weights.</div>';
  }

  function xgModel(A) {
    const X = NQ.sim.XG;
    const rows = [['Intercept', X.b0], ['Distance (ft)', X.dist], ['Distance²', X.dist2], ['|Angle| (rad)', X.angle], ['Rebound', X.rebound], ['Rush', X.rush], ['One-timer', X.oneTimer], ['Cross-slot pass', X.crossSlot], ['Power play', X.pp], ['Shorthanded', X.sh], ['3v3 OT', X.ot3v3], ...Object.entries(X.type).map(([k, v]) => ['Type: ' + k, v])];
    return `<div class="grid g2"><div><div class="sect">Coefficients (logit scale)</div><table class="tbl"><tbody>${rows.map(([n, v]) => `<tr><td>${n}</td><td class="num">${u.sgn(v, 4)}</td></tr>`).join('')}</tbody></table></div>
      <div><div class="sect">xG calibration (unblocked attempts on goalies)</div>${ch.calib(A.xg.bins, { lo: 0, hi: 0.5, dp: 2, w: 260, h: 220 })}
      <table class="mt"><tbody><tr><td>Shots</td><td class="r num">${A.xg.n.toLocaleString()}</td></tr><tr><td>Goals</td><td class="r num">${A.xg.goals.toLocaleString()}</td></tr><tr><td>Log loss (model)</td><td class="r num">${u.fx(A.xg.ll, 4)}</td></tr><tr><td>Log loss (league-rate baseline)</td><td class="r num">${u.fx(A.xg.llBase, 4)}</td></tr><tr><td>AUC</td><td class="r num">${u.fx(A.xg.auc, 3)}</td></tr></tbody></table>
      <div class="note">Observed goal rate sits slightly off the diagonal by design: actual conversion also depends on shooter finishing and goaltender talent, which xG intentionally excludes.</div></div></div>`;
  }

  function recovery() {
    const st = S(), rec = st.est.recovery, cal = st.est.cal;
    return `${rec.map((r) => `<div class="factor"><span>${r.n}</span><span class="fb"><i style="left:50%;width:${Math.max(0, r.r) * 50}%;background:${r.r >= 0.7 ? 'var(--pos)' : r.r >= 0.4 ? 'var(--warn)' : 'var(--neg)'}"></i></span><span class="num r">r = ${u.fx(r.r, 2)}</span></div>`).join('')}
      <div class="why">Because the universe is synthetic, we can check how well talent estimated from <b>measured</b> stats recovers the simulator's hidden truth. Volume, playmaking, transition, defense and faceoffs recover well; finishing, PP skill and line chemistry are noisy after ${st.season.PLAYED_ROUNDS} games — exactly why the model shrinks them hard.</div>
      <div class="sect">Environment calibration (estimated league)</div><table class="tbl"><thead><tr><th>Pass</th><th class="num">Sim SF/team</th><th class="num">Obs SF</th><th class="num">Sim GF/team</th><th class="num">Obs GF</th></tr></thead><tbody>${cal.map((x) => `<tr><td>${x.pass + 1}</td><td class="num">${u.fx(x.simSF, 2)}</td><td class="num">${u.fx(x.obsSF, 2)}</td><td class="num">${u.fx(x.simGF, 2)}</td><td class="num">${u.fx(x.obsGF, 2)}</td></tr>`).join('')}</tbody></table>`;
  }

  function playerErr(A) {
    const p = A.players, g = A.goalies;
    return `<table class="tbl"><thead><tr><th>Target</th><th class="num">Metric</th><th class="num">Value</th><th class="num">n</th></tr></thead><tbody>
      <tr><td>Player SOG</td><td class="num">MAE</td><td class="num">${u.fx(p.sogMAE, 3)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Player SOG</td><td class="num">Bias</td><td class="num">${u.sgn(p.sogBias, 3)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Player SOG ≥ 3</td><td class="num">Brier</td><td class="num">${u.fx(p.sog3Brier, 4)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Player 1+ point</td><td class="num">Brier</td><td class="num">${u.fx(p.ptsBrier, 4)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Player 1+ goal</td><td class="num">Brier</td><td class="num">${u.fx(p.gBrier, 4)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Player TOI</td><td class="num">MAE</td><td class="num">${u.toi(p.toiMAE)}</td><td class="num">${p.n.toLocaleString()}</td></tr>
      <tr><td>Goalie saves</td><td class="num">MAE</td><td class="num">${u.fx(g.savesMAE, 2)}</td><td class="num">${g.n.toLocaleString()}</td></tr>
      <tr><td>Goalie goals allowed</td><td class="num">Log score</td><td class="num">${u.fx(g.gaLogScore, 3)}</td><td class="num">${g.n.toLocaleString()}</td></tr>
      <tr><td>Total goals</td><td class="num">MAE</td><td class="num">${u.fx(A.totals.mae, 3)}</td><td class="num">${A.n}</td></tr>
      <tr><td>Total goals 90% PI</td><td class="num">Coverage</td><td class="num">${u.pct(A.totals.cover)}</td><td class="num">${A.n}</td></tr>
      <tr><td>Exact score</td><td class="num">Log score</td><td class="num">${u.fx(A.totals.scoreLL, 3)}</td><td class="num">${A.n}</td></tr></tbody></table>
      <div class="note">Player projections: as-of rate × expected TOI with a 10-minute positional prior, after 8 GP. Goalies: shrunk SV% × average shots faced, after 4 starts.</div>`;
  }

  NQ.views.audit = {
    VERSIONS,
    render() {
      const A = S().audit;
      const q = A.quality;
      return `<div class="grid">
        <div class="stats">${c.stat('Backtest games', A.n)}${c.stat('Brier (model)', u.fx(A.model.brier, 4), { cls: A.model.brier < A.home.brier ? 'hl' : 'bad' })}${c.stat('Log loss', u.fx(A.model.logloss, 4))}${c.stat('Accuracy', u.pct(A.model.acc))}${c.stat('Cal. slope', u.fx(A.fit.slope, 2))}${c.stat('xG AUC', u.fx(A.xg.auc, 3))}${c.stat('Data checks', `${q.filter((x) => x.pass).length}/${q.length}`, { cls: q.every((x) => x.pass) ? 'hl' : 'bad' })}</div>
        <div class="grid g2" id="sec-backtest">
          ${c.panel('Forward Backtest', 'game winner vs baselines', baselineTable(A))}
          ${c.panel('Feature Importance', 'standardised logit β', importance(A))}
        </div>
        <div class="grid g3" id="sec-calibration">
          ${c.panel('Calibration — Win Probability', `slope ${u.fx(A.fit.slope, 2)} · intercept ${u.sgn(A.fit.intercept, 2)}`, ch.calib(A.cal, { lo: 0.2, hi: 0.8, dp: 1 }) + `<table class="tbl"><thead><tr><th class="num">Pred.</th><th class="num">Obs.</th><th class="num">n</th></tr></thead><tbody>${A.cal.map((b) => `<tr><td class="num">${u.fx(b.pred, 3)}</td><td class="num">${u.fx(b.obs, 3)}</td><td class="num">${b.n}</td></tr>`).join('')}</tbody></table>`)}
          ${c.panel('Calibration — Player 1+ Point', 'as-of player model', ch.calib(A.players.ptsCal, { lo: 0, hi: 0.9, dp: 1 }))}
          ${c.panel('Projection Error', 'players, goalies, totals', playerErr(A))}
        </div>
        <div class="grid g2" id="sec-xg">
          ${c.panel('Custom Expected-Goals Model', 'logistic, unblocked attempts', xgModel(A))}
          ${c.panel('Talent Recovery', 'synthetic ground-truth diagnostic', recovery())}
        </div>
        <div class="grid g2" id="sec-quality">
          ${c.panel('Data Quality & Internal Consistency', 'identities the engine must satisfy', `<table class="tbl"><tbody>${q.map((x) => `<tr><td class="${x.pass ? 'check-ok' : 'check-bad'}">${x.pass ? 'PASS' : 'FAIL'}</td><td>${u.esc(x.name)}</td><td class="muted">${u.esc(x.detail)}</td></tr>`).join('')}</tbody></table>
            <div class="note">Player projections and game outcomes come from the same simulated events, so these identities hold inside every forecast too.</div>`)}
          ${c.panel('Version Control', 'model changelog', `<table class="tbl" id="sec-versions"><thead><tr><th>Version</th><th>Date</th><th>Change (summary)</th></tr></thead><tbody>${VERSIONS.map((x, i) => `<tr><td class="mono">${i === 0 ? '<span class="pos">✓</span> ' : ''}v${x.v}</td><td class="mono">${x.d}</td><td style="white-space:normal">${u.esc(x.s)}</td></tr>`).join('')}</tbody></table><div class="note">Synthetic changelog for the demo build.</div>`)}
        </div>
        ${c.panel('Model Library', 'model family by prediction task', `<div class="tscroll"><table class="tbl"><thead><tr><th>Prediction task</th><th>Model family</th><th>Status</th><th>Validation</th></tr></thead><tbody>${LIBRARY.map((r) => `<tr><td>${r[0]}</td><td style="white-space:normal">${r[1]}</td><td><span class="badge b-pp">${r[2]}</span></td><td class="muted">${r[3]}</td></tr>`).join('')}</tbody></table></div>`, { id: 'sec-library' })}
      </div>`;
    }
  };
})(globalThis.NQ = globalThis.NQ || {});

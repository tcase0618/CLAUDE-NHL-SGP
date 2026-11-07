/* ==========================================================================
 * NQ.app — boot sequence, global state, router, shell (top bar / nav / side).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u, c = NQ.c;
  const SEED = 20260127;
  const VERSION = '3.7.0';
  const app = { state: null, views: NQ.views || {}, mcCache: new Map(), focus: 'TOR' };
  NQ.app = app;

  const store = {
    get: (k, d) => { try { const v = localStorage.getItem('nq:' + k); return v === null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem('nq:' + k, v); } catch (e) { /* storage unavailable */ } }
  };

  // ------------------------------------------------------------ boot
  // REAL-DATA FIRST: the shell boots instantly from the real-NHL artifacts
  // (window.NQ_SLATE / NQ_ML). The synthetic research universe is only built
  // the first time a sandbox page is opened.
  const STEPS = [
    ['Generating 32 franchises · 640 player talent profiles', (s) => { s.league = NQ.league.build(SEED); }],
    ['Simulating 768 games event-by-event (≈ 92k shot attempts)', (s) => { s.season = NQ.season.run(s.league, SEED); }],
    ['Computing 80 + 4×30 skater, 60 goalie, 200 team metrics', (s) => { s.M = NQ.metrics.compute(s.league, s.season); }],
    ['Estimating talent from measured stats · calibrating environment', (s) => { s.est = NQ.estimate.build(s.league, s.season, s.M); }],
    ['Running forward backtests, calibration & data-quality checks', (s) => { s.audit = NQ.audit.run(s.league, s.season); }]
  ];
  const REAL_VIEWS = new Set(['cv']);
  const SL = () => globalThis.NQ_SLATE;

  function boot() {
    app.state = null;
    app.focus = store.get('focus', 'TOR');
    if (store.get('theme', 'dark') === 'light') document.documentElement.setAttribute('data-theme', 'light');
    const b = document.getElementById('boot'); if (b) b.remove();
    const root = document.getElementById('app');
    root.hidden = false;
    root.innerHTML = shell();
    wireShell();
    window.addEventListener('hashchange', route);
    if (!location.hash || location.hash === '#' || location.hash === '#/') location.replace('#/cv');
    route();
  }

  /** Build the synthetic sandbox on demand (renders progress into `main`). */
  let synthPromise = null;
  function ensureSynth(main) {
    if (app.state) return Promise.resolve();
    if (!synthPromise) {
      synthPromise = new Promise((resolve) => {
        const st = {};
        let i = 0;
        const draw = () => { main.innerHTML = c.panel('Synthetic Research Sandbox', 'building simulated universe — not real NHL data', `<div class="loading"><div class="spin"></div><ul style="list-style:none;padding:0;margin:0;font:12px var(--mono);text-align:left">${STEPS.map((x, k) => `<li class="${k < i ? 'pos' : k === i ? '' : 'muted'}">${k < i ? '✓' : k === i ? '›' : '·'} ${x[0]}</li>`).join('')}</ul></div>`); };
        const next = () => {
          if (i >= STEPS.length) {
            st.refreshed = new Date(); st.catalog = NQ.metrics.catalog();
            app.state = st;
            if (!st.league.byAbbr[app.focus]) app.focus = 'TOR';
            resolve(); return;
          }
          draw();
          setTimeout(() => { STEPS[i][1](st); i++; next(); }, 30);
        };
        next();
      });
    }
    return synthPromise;
  }

  // ------------------------------------------------------------ shell
  const NAV = [
    ['cv', '#/cv', 'Props · Case Value'], ['cv:sgp3', '#/cv/sgp3', '3-Leg SGP'], ['cv:sgp5', '#/cv/sgp5', '5-Leg SGP'], ['cv:sgp8', '#/cv/sgp8', '8-Leg SGP'],
    ['cv:odds', '#/cv/odds', 'Odds Desk'], ['cv:models', '#/cv/models', 'Models & Validation'], ['sandbox', '#/home', 'Sandbox (synthetic) ▸']
  ];
  const SIDE = [
    ['Real NHL · Case Value', [['cv', '#/cv', 'Props · CV% + Polymarket'], ['cvs3', '#/cv/sgp3', '3-Leg SGP'], ['cvs5', '#/cv/sgp5', '5-Leg SGP'], ['cvs8', '#/cv/sgp8', '8-Leg SGP'], ['cvo', '#/cv/odds', 'Odds Desk'], ['cvm', '#/cv/models', 'AutoGluon · XGBoost']]],
    ['Sandbox · synthetic universe', [['home', '#/home', 'Sandbox dashboard'], ['player', '#/player', 'Player Intelligence'], ['goalie', '#/goalie', 'Goalie Intelligence'], ['team', '#/team', 'Team Intelligence'], ['lines', '#/lines', 'Lines & Pairings'], ['matchup', '#/matchup', 'Matchup Lab'], ['predict', '#/predict', 'Prediction Engine'], ['audit', '#/audit', 'Model Audit'], ['explorer', '#/explorer', 'Shot & Event Explorer'], ['leaders', '#/leaders', 'Skating & Usage'], ['features', '#/library', 'Feature Store']]]
  ];

  function shell() {
    const S = SL(), M = globalThis.NQ_ML, O = globalThis.NQ_ODDS, V = globalThis.NQ_SGPVAL;
    const nP = S ? S.games.reduce((n, g) => n + g.home.players.length + g.away.players.length, 0) : 0;
    const fresh = S ? (Date.now() - Date.parse(S.data_through)) / 3600000 <= 36 : false;
    return `
    <header class="top">
      <a class="logo" href="#/cv" aria-label="Case Capital NHL Quant home">
        <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 35 9v11c0 9-6.5 15.5-15 18C11.5 35.5 5 29 5 20V9z" fill="none" stroke="var(--accent)" stroke-width="2"/><ellipse cx="20" cy="24" rx="9" ry="3.6" fill="var(--txt)"/><rect x="11" y="19.5" width="18" height="4.5" fill="var(--txt)"/><ellipse cx="20" cy="19.5" rx="9" ry="3.6" fill="var(--txt2)"/><path d="M12 13h16" stroke="var(--accent)" stroke-width="2"/></svg>
        <div><div class="t1">CASE CAPITAL · NHL QUANT TERMINAL</div><div class="t2">REAL NHL DATA · CASE VALUE · SGP INTELLIGENCE</div></div>
      </a>
      <span class="pill" style="border-color:var(--pos)"><b style="color:var(--pos)">REAL NHL DATA</b> api-web.nhle.com · Polymarket US</span>
      <span class="sp"></span>
      ${S ? `<span class="pill hide-sm">Data through <b>${u.esc(S.data_through.slice(0, 16))}Z</b> ${fresh ? '' : '<span class="neg">stale</span>'}</span>
      <span class="pill hide-sm"><span class="dotok"></span> Model <b>${u.esc(S.model_version)}</b></span>
      <span class="pill hide-sm">Slate <b>${S.games.length}</b> games</span>` : '<span class="pill"><b class="neg">Real artifacts missing</b></span>'}
      ${O && O.polymarket ? `<span class="pill hide-sm">Polymarket <b>${O.polymarket.quotes}</b> quotes · ${u.esc(String(O.fetched_at).slice(11, 16))}Z</span>` : ''}
      <div class="search"><input id="gsearch" placeholder="Search tonight's players…" autocomplete="off" aria-label="Search real NHL players"><div class="res" id="gres"></div></div>
      <button class="iconbtn" id="themeBtn" title="Toggle light / dark" aria-label="Toggle theme">◐</button>
    </header>
    <nav class="nav" id="nav">${NAV.map(([k, h, l]) => `<a href="${h}" data-k="${k}">${l}</a>`).join('')}</nav>
    <div class="layout">
      <aside class="side" id="side">
        ${SIDE.map(([h, items]) => `<h3>${h}</h3>${items.map(([k, href, l]) => `<a href="${href}" data-sk="${k}">${l}</a>`).join('')}`).join('')}
        <div class="sysbox"><b>Case Capital NHL Quant</b>${S ? `<span class="dotok" style="display:inline-block;${fresh ? '' : 'background:var(--warn);box-shadow:none'}"></span> ${fresh ? 'Real data fresh' : 'Real data stale — run pipeline'}<br>
          Model ${u.esc(S.model_version)}<br>Libs: XGBoost ${M ? u.esc(M.libs.xgboost) : '—'} · AutoGluon ${M ? u.esc(M.libs.autogluon) : '—'}<br>Slate: ${S.games.length} games · ${nP} skaters<br>SGP validation: ${V ? V.rows.toLocaleString() + ' combos' : 'not run'}` : 'Run ml/build_all.py → train → export'}<br>
          <span class="muted">Sandbox pages use a synthetic universe.</span></div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>
    <footer class="foot">Case Value pages use real NHL box-score data (api-web.nhle.com) and live Polymarket US prices; sandbox pages are a synthetic simulated league for research. Not affiliated with the NHL, its clubs or Polymarket. Probabilities are model estimates — not betting advice and never a guarantee.</footer>`;
  }

  function wireShell() {
    document.getElementById('themeBtn').addEventListener('click', () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      if (light) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'light');
      store.set('theme', light ? 'dark' : 'light');
    });
    // global search over REAL slate players
    const inp = document.getElementById('gsearch'), res = document.getElementById('gres');
    const S = SL();
    const index = [];
    if (S) {
      const seen = new Set();
      for (const g of S.games) for (const side of ['home', 'away']) for (const p of g[side].players) {
        if (seen.has(p.id)) continue; seen.add(p.id);
        index.push({ label: p.name, sub: `${g[side].abbr} · ${p.pos}`, href: `#/cv/player/${p.id}`, key: `${p.name} ${g[side].abbr}`.toLowerCase() });
      }
      for (const g of S.games) index.push({ label: `${g.away.abbr} @ ${g.home.abbr}`, sub: new Date(g.start_utc).toLocaleDateString([], { month: 'short', day: 'numeric' }), href: `#/cv/sgp3/${g.game_id}`, key: `${g.away.abbr} ${g.home.abbr} ${g.away.abbr}@${g.home.abbr}`.toLowerCase() });
    }
    let sel = 0, hits = [];
    const draw = () => { res.innerHTML = hits.map((h, i) => `<a href="${h.href}" class="${i === sel ? 'on' : ''}"><span>${u.esc(h.label)}</span><span class="muted mono">${h.sub}</span></a>`).join(''); res.style.display = hits.length ? 'block' : 'none'; };
    inp.addEventListener('input', () => { const q = inp.value.trim().toLowerCase(); sel = 0; hits = q.length < 2 ? [] : index.filter((x) => x.key.includes(q)).slice(0, 12); draw(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && hits[sel]) { location.hash = hits[sel].href; inp.value = ''; hits = []; draw(); }
      else if (e.key === 'Escape') { hits = []; draw(); }
    });
    res.addEventListener('click', () => { inp.value = ''; hits = []; draw(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) { hits = []; draw(); } });
  }

  // ------------------------------------------------------------ router
  function route() {
    const h = (location.hash || '#/cv').replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    const view = parts[0] || 'cv';
    const params = parts.slice(1).map(decodeURIComponent);
    const v = NQ.views[view] || NQ.views.cv;
    const main = document.getElementById('main');
    const navKey = view === 'cv' ? (params[0] && /^(sgp[358]|odds|models)$/.test(params[0]) ? 'cv:' + params[0] : 'cv') : 'sandbox';
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === navKey));
    document.querySelectorAll('#side a').forEach((a) => {
      a.setAttribute('href', a.getAttribute('href').replace('{F}', app.focus));
      a.classList.toggle('on', a.getAttribute('href') === '#/' + h || (a.dataset.sk === view && !params.length));
    });
    const render = () => {
      try {
        main.innerHTML = (REAL_VIEWS.has(view) || !NQ.views[view] ? '' : '<div class="why" style="margin-bottom:10px"><b>Synthetic sandbox</b> — simulated league for method research. Players, stats and forecasts on this page are <b>not real</b>. Real NHL data lives under <a href="#/cv">Case Value</a>.</div>') + v.render(params, app.state);
        if (v.mount) v.mount(main, params, app.state);
      } catch (err) {
        main.innerHTML = c.panel('Error', 'view failed to render', `<pre class="mono">${u.esc(err.stack || err)}</pre>`, { demo: false });
        console.error(err);
      }
      if (!/^#\/audit\//.test(location.hash) && !/\/zone$/.test(location.hash)) window.scrollTo(0, 0);
      const pane = params[params.length - 1];
      if (pane && document.getElementById('sec-' + pane)) document.getElementById('sec-' + pane).scrollIntoView({ block: 'start' });
    };
    if (REAL_VIEWS.has(view) || !NQ.views[view]) render();
    else ensureSynth(main).then(() => { if (location.hash.replace(/^#\/?/, '') === h) render(); });
  }

  // ------------------------------------------------------------ shared helpers
  /** Cached Monte Carlo run (promise). */
  app.mc = (h, a, opts) => {
    opts = opts || {};
    const key = [h, a, opts.n || 3000, opts.starterH || 'auto', opts.starterA || 'auto', [...(opts.scratches || [])].sort().join('.'), opts.restH ?? '', opts.restA ?? ''].join('|');
    if (!app.mcCache.has(key)) app.mcCache.set(key, NQ.predict.run(app.state, h, a, Object.assign({ n: 3000 }, opts)));
    return app.mcCache.get(key);
  };
  app.nextGame = (teamId) => app.state.season.upcoming.find((g) => g.home === teamId || g.away === teamId);
  app.team = (x) => (typeof x === 'number' ? app.state.league.teams[x] : app.state.league.byAbbr[x]);
  app.P = (id) => app.state.league.players[id];
  /** Attach progress feedback to a loading element while a promise runs. */
  app.withProgress = (el, opts) => Object.assign({}, opts, { onProgress: (f) => { const i = el && el.querySelector('.prog i'); if (i) i.style.width = (f * 100).toFixed(0) + '%'; } });
  app.store = store;
  app.rerender = () => route();

  /** Delegated tab handling: data-tabs container toggles [data-pane] siblings. */
  app.wireTabs = (root, onChange) => {
    root.querySelectorAll('[data-tabs]').forEach((tb) => {
      tb.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]'); if (!b) return;
        tb.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
        const id = tb.dataset.tabs;
        root.querySelectorAll(`[data-pane-of="${id}"]`).forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
        if (onChange) onChange(id, b.dataset.tab);
      });
    });
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(globalThis.NQ = globalThis.NQ || {});

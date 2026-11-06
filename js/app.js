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
  const STEPS = [
    ['Generating 32 franchises · 640 player talent profiles', (s) => { s.league = NQ.league.build(SEED); }],
    ['Simulating 768 games event-by-event (≈ 92k shot attempts)', (s) => { s.season = NQ.season.run(s.league, SEED); }],
    ['Computing 80 + 4×30 skater, 60 goalie, 200 team metrics', (s) => { s.M = NQ.metrics.compute(s.league, s.season); }],
    ['Estimating talent from measured stats · calibrating environment', (s) => { s.est = NQ.estimate.build(s.league, s.season, s.M); }],
    ['Running forward backtests, calibration & data-quality checks', (s) => { s.audit = NQ.audit.run(s.league, s.season); }]
  ];

  function boot() {
    const st = {};
    const ul = document.getElementById('bootsteps'), bar = document.getElementById('bootbar');
    ul.innerHTML = STEPS.map((x) => `<li>${x[0]}</li>`).join('');
    let i = 0;
    const next = () => {
      const lis = ul.querySelectorAll('li');
      if (i > 0) { lis[i - 1].className = 'done'; }
      if (i >= STEPS.length) { finish(st); return; }
      lis[i].className = 'run';
      setTimeout(() => {
        STEPS[i][1](st);
        i++;
        bar.style.width = (100 * i) / STEPS.length + '%';
        next();
      }, 30);
    };
    next();
  }

  function finish(st) {
    st.refreshed = new Date();
    st.catalog = NQ.metrics.catalog();
    app.state = st;
    app.focus = store.get('focus', 'TOR');
    if (!st.league.byAbbr[app.focus]) app.focus = 'TOR';
    const theme = store.get('theme', 'dark');
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('boot').remove();
    const root = document.getElementById('app');
    root.hidden = false;
    root.innerHTML = shell();
    wireShell();
    window.addEventListener('hashchange', route);
    route();
  }

  // ------------------------------------------------------------ shell
  const NAV = [
    ['home', '#/home', '<svg width="16" height="16" viewBox="0 0 24 24" aria-label="Home"><path fill="currentColor" d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>'],
    ['player', '#/player', 'Player Intelligence'], ['goalie', '#/goalie', 'Goalie Intelligence'], ['team', '#/team', 'Team Intelligence'],
    ['lines', '#/lines', 'Lines & Pairings'], ['matchup', '#/matchup', 'Matchup Lab'], ['predict', '#/predict', 'Prediction Engine'], ['audit', '#/audit', 'Model Audit']
  ];
  const SIDE = [
    ['Research Workspace', [['player', '#/player', 'Player Intelligence'], ['goalie', '#/goalie', 'Goalie Intelligence'], ['team', '#/team', 'Team Intelligence'], ['lines', '#/lines', 'Lines & Pairings'], ['matchup', '#/matchup', 'Matchup Lab'], ['predict', '#/predict', 'Prediction Engine'], ['audit', '#/audit', 'Model Audit']]],
    ['Analysis Tools', [['explorer', '#/explorer', 'Shot & Event Explorer'], ['zone', '#/team/{F}/zone', 'Zone Play Analyzer'], ['leaders', '#/leaders', 'Skating & Usage'], ['chem', '#/lines/{F}', 'Line / Pair Chemistry'], ['opp', '#/matchup', 'Opponent Matchups'], ['scen', '#/predict', 'Scenario Simulator'], ['xg', '#/audit/xg', 'Custom Models']]],
    ['Data & Models', [['library', '#/audit/library', 'Model Library'], ['features', '#/library', 'Feature Store'], ['backtest', '#/audit/backtest', 'Backtests'], ['calib', '#/audit/calibration', 'Calibration'], ['versions', '#/audit/versions', 'Version Control']]]
  ];

  function shell() {
    const s = app.state;
    const teams = s.league.teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr));
    const healthy = s.audit.quality.every((q) => q.pass);
    return `
    <header class="top">
      <a class="logo" href="#/home" aria-label="NHL Quant home">
        <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 35 9v11c0 9-6.5 15.5-15 18C11.5 35.5 5 29 5 20V9z" fill="none" stroke="var(--accent)" stroke-width="2"/><ellipse cx="20" cy="24" rx="9" ry="3.6" fill="var(--txt)"/><rect x="11" y="19.5" width="18" height="4.5" fill="var(--txt)"/><ellipse cx="20" cy="19.5" rx="9" ry="3.6" fill="var(--txt2)"/><path d="M12 13h16" stroke="var(--accent)" stroke-width="2"/></svg>
        <div><div class="t1">NHL QUANT INTELLIGENCE PLATFORM</div><div class="t2">INSTITUTIONAL HOCKEY ANALYTICS &amp; PREDICTION TERMINAL</div></div>
      </a>
      <span class="pill demo-pill"><b>DEMO</b> Synthetic Data · Illustrative Only</span>
      <span class="sp"></span>
      <span class="pill hide-sm"><b>2025–26 (DEMO)</b> · GP ${s.season.PLAYED_ROUNDS}</span>
      <span class="pill hide-sm"><span class="dotok"></span> Model v${VERSION}</span>
      <span class="pill hide-sm">Data: <b>Synthetic</b></span>
      <span class="pill hide-sm">Refreshed: <b>${s.refreshed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>
      <label class="pill" title="Focus team for the home dashboard">Focus ${c.select('focusSel', teams.map((t) => ({ v: t.abbr, n: t.abbr })), app.focus, { label: 'Focus team' })}</label>
      <div class="search"><input id="gsearch" placeholder="Search players / teams…" autocomplete="off" aria-label="Search players and teams"><div class="res" id="gres"></div></div>
      <button class="iconbtn" id="themeBtn" title="Toggle light / dark" aria-label="Toggle theme">◐</button>
    </header>
    <nav class="nav" id="nav">${NAV.map(([k, h, l]) => `<a href="${h}" data-k="${k}">${l}</a>`).join('')}</nav>
    <div class="layout">
      <aside class="side" id="side">
        ${SIDE.map(([h, items]) => `<h3>${h}</h3>${items.map(([k, href, l]) => `<a href="${href}" data-sk="${k}">${l}</a>`).join('')}`).join('')}
        <div class="sysbox"><b>NHL Quant Terminal</b>v${VERSION} (DEMO)<br><span class="dotok" style="display:inline-block;${healthy ? '' : 'background:var(--neg);box-shadow:none'}"></span> ${healthy ? 'System healthy' : 'Data checks failing'}<br>
          Models: 12 active<br>Features: ${s.catalog.length}<br>Players: ${s.league.players.length} · Teams: 32<br>Data: Synthetic<br>Environment: Research</div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>
    <footer class="foot">All players, ratings, statistics and forecasts are synthetic and produced by the terminal's own simulator for illustration. Franchise names are labels only; no affiliation with or endorsement by the NHL or its clubs. Not betting advice.</footer>`;
  }

  function wireShell() {
    const s = app.state;
    document.getElementById('focusSel').addEventListener('change', (e) => { app.focus = e.target.value; store.set('focus', app.focus); route(); });
    document.getElementById('themeBtn').addEventListener('click', () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      if (light) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'light');
      store.set('theme', light ? 'dark' : 'light');
    });
    // global search
    const inp = document.getElementById('gsearch'), res = document.getElementById('gres');
    const index = [
      ...s.league.teams.map((t) => ({ label: t.full, sub: t.abbr, href: `#/team/${t.abbr}`, key: (t.full + ' ' + t.abbr).toLowerCase() })),
      ...s.league.players.map((p) => ({ label: `${p.first} ${p.last}`, sub: `${s.league.teams[p.teamId].abbr} · ${p.pos}`, href: p.isG ? `#/goalie/${p.id}` : `#/player/${p.id}`, key: `${p.first} ${p.last} ${s.league.teams[p.teamId].abbr}`.toLowerCase() }))
    ];
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
    const h = (location.hash || '#/home').replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    const view = parts[0] || 'home';
    const params = parts.slice(1).map(decodeURIComponent);
    const v = NQ.views[view] || NQ.views.home;
    const main = document.getElementById('main');
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === (NQ.views[view] ? view : 'home')));
    document.querySelectorAll('#side a').forEach((a) => {
      a.setAttribute('href', a.getAttribute('href').replace('{F}', app.focus));
      a.classList.toggle('on', a.getAttribute('href') === '#/' + h || (a.dataset.sk === view && !params.length));
    });
    try {
      main.innerHTML = v.render(params, app.state);
      if (v.mount) v.mount(main, params, app.state);
    } catch (err) {
      main.innerHTML = c.panel('Error', 'view failed to render', `<pre class="mono">${u.esc(err.stack || err)}</pre>`, { demo: false });
      console.error(err);
    }
    if (!/^#\/audit\//.test(location.hash) && !/\/zone$/.test(location.hash)) window.scrollTo(0, 0);
    const pane = params[params.length - 1];
    if (pane && document.getElementById('sec-' + pane)) document.getElementById('sec-' + pane).scrollIntoView({ block: 'start' });
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

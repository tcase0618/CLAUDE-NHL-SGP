/* ==========================================================================
 * NQ.c — shared UI components (pure functions returning HTML strings).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const c = {};

  c.panel = (title, sub, body, o) => {
    o = o || {};
    return `<section class="panel ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''} ${o.style ? `style="${o.style}"` : ''}>
      <header class="ph"><h2>${title}${sub ? ` <span class="sub">— ${sub}</span>` : ''}</h2>
      <div class="ph-r">${o.actions || ''}${o.demo === false ? '' : '<span class="demo">DEMO</span>'}</div></header>
      <div class="pb ${o.bodyCls || ''}">${body}</div></section>`;
  };

  c.badge = (t, cls) => `<span class="badge ${cls || ''}">${u.esc(t)}</span>`;
  c.roleBadges = (p) => (p.roles || []).map((r) => c.badge(r, /^PP/.test(r) ? 'b-pp' : /^PK/.test(r) ? 'b-pk' : /^\d?[CLRDG]\d?W?$|^D\d|^G\d|^\dC$/.test(r) ? 'b-slot' : 'b-arch')).join('');

  c.team = (t, o) => {
    o = o || {};
    return `<a class="tchip ${o.big ? 'big' : ''}" href="#/team/${t.abbr}" style="--tc:${t.color}" title="${u.esc(t.full)}"><span class="tdot"></span>${t.abbr}${o.full ? ` <span class="tfull">${u.esc(t.name)}</span>` : ''}</a>`;
  };
  c.crest = (t, size) => `<div class="crest" style="--tc:${t.color};--tc2:${t.color2};width:${size || 54}px;height:${size || 54}px"><span>${t.abbr}</span></div>`;

  c.avatar = (p, team, size) => {
    const ini = (p.first[0] || '') + (p.last.replace(/[^A-Za-z]/g, '')[0] || '');
    return `<div class="avatar" style="--tc:${team.color};width:${size || 72}px;height:${size || 72}px" aria-hidden="true">
      <svg viewBox="0 0 64 64"><circle cx="32" cy="24" r="12" class="av-head"/><path d="M8 62c2-14 12-22 24-22s22 8 24 22z" class="av-body"/></svg>
      <span class="av-num">#${p.num}</span><span class="av-ini">${ini}</span></div>`;
  };

  c.pname = (p, o) => {
    o = o || {};
    const href = p.isG ? `#/goalie/${p.id}` : `#/player/${p.id}`;
    const n = o.short ? `${p.first[0]}. ${p.last}` : `${p.first} ${p.last}`;
    return `<a class="plink" href="${href}">${u.esc(n)}</a>${o.pos ? ` <span class="pos">${p.pos}</span>` : ''}`;
  };

  c.pbar = (p, o) => {
    if (typeof p !== 'number') return '<span class="pbar empty"></span>';
    o = o || {};
    return `<span class="pbar ${u.pctClass(p)}" title="${Math.round(p)}th percentile"><i style="width:${Math.max(3, p)}%"></i></span>${o.num === false ? '' : `<span class="pnum">${Math.round(p)}</span>`}`;
  };

  c.srcTag = (s) => `<span class="src src-${s}" title="${s === 'PBP' ? 'Measured from play-by-play events' : s === 'TRK' ? 'Tracking / charting equivalent (modelled)' : 'Model output'}">${s}</span>`;

  /** A metric table for a category: rows of [name, value, pct bar, src]. */
  c.metricTable = (metrics, vals, pct, o) => {
    o = o || {};
    let h = `<table class="mt"><thead><tr><th>Metric</th><th class="r">Value</th><th>${o.rankMode ? 'Rank' : '%ile'}</th><th class="r src-h">Src</th></tr></thead><tbody>`;
    for (const m of metrics) {
      const v = vals[m.k];
      let right;
      if (o.rankMode) {
        const r = pct[m.k];
        right = typeof r === 'number' ? `<span class="rank ${r <= 5 ? 'r-top' : r >= 28 ? 'r-bot' : ''}">${u.ord(r)}</span>${c.pbar(100 * (1 - (r - 1) / 31), { num: false })}` : '';
      } else right = c.pbar(pct[m.k]);
      h += `<tr title="${u.esc(m.def)}"><td>${u.esc(m.n)}</td><td class="r num">${u.fmtMetric(v, m.f)}</td><td class="pc">${right}</td><td class="r">${c.srcTag(m.src)}</td></tr>`;
    }
    return h + '</tbody></table>';
  };

  /** Collapsible category list. */
  c.categories = (cats, vals, pct, o) => {
    o = o || {};
    return `<div class="cats">${cats.map((cat, i) => {
      const ps = cat.m.map((m) => (o.rankMode ? (typeof pct[m.k] === 'number' && m.hib !== null ? 100 * (1 - (pct[m.k] - 1) / 31) : null) : (m.hib === null ? null : pct[m.k]))).filter((x) => typeof x === 'number');
      const avg = ps.length ? u.mean(ps) : null;
      return `<details class="cat" ${i < (o.open || 0) ? 'open' : ''}><summary><span class="cidx">${String(i + 1).padStart(2, '0')}</span><span class="cname">${u.esc(cat.n)}</span>${cat.pri ? `<span class="cpri">Priority: ${u.esc(cat.pri)}</span>` : ''}<span class="ccount">${cat.m.length}</span>${avg !== null ? c.pbar(avg) : ''}</summary>${c.metricTable(cat.m, vals, pct, o)}</details>`;
    }).join('')}</div>`;
  };

  c.kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

  c.stat = (label, value, o) => {
    o = o || {};
    return `<div class="stat ${o.cls || ''}"><div class="sl">${label}</div><div class="sv ${o.vcls || ''}">${value}</div>${o.sub ? `<div class="ss">${o.sub}</div>` : ''}</div>`;
  };

  c.split = (a, b, la, lb) => `<div class="splitbar" role="img" aria-label="${la} ${(a * 100).toFixed(1)}%, ${lb} ${(b * 100).toFixed(1)}%"><i class="sa" style="width:${a * 100}%"></i><i class="sb" style="width:${b * 100}%"></i></div>`;

  c.tabs = (id, tabs, active) => `<div class="tabs" data-tabs="${id}">${tabs.map((t) => `<button class="tab ${t.k === active ? 'on' : ''}" data-tab="${t.k}">${u.esc(t.n)}</button>`).join('')}</div>`;

  c.empty = (msg) => `<div class="empty">${u.esc(msg)}</div>`;

  c.loading = (msg) => `<div class="loading"><div class="spin"></div><span>${u.esc(msg || 'Running simulations…')}</span><div class="prog"><i></i></div></div>`;

  c.sign = (v, d, good) => {
    if (typeof v !== 'number') return '—';
    const cls = v === 0 ? '' : (v > 0) === (good !== false) ? 'pos' : 'neg';
    return `<span class="${cls}">${u.sgn(v, d)}</span>`;
  };

  c.select = (id, options, value, o) => {
    o = o || {};
    return `<select id="${id}" class="sel" ${o.attrs || ''} aria-label="${u.esc(o.label || id)}">${options.map((x) => `<option value="${u.esc(x.v)}" ${String(x.v) === String(value) ? 'selected' : ''}>${u.esc(x.n)}</option>`).join('')}</select>`;
  };

  NQ.c = c;
})(globalThis.NQ = globalThis.NQ || {});

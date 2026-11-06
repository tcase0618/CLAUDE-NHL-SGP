/* ==========================================================================
 * NQ.ch — dependency-free SVG chart primitives. All colours come from CSS
 * custom properties so every chart follows the active theme.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const ch = {};
  const f1 = (v) => (Math.round(v * 10) / 10).toString();

  /** Multi-series line chart. */
  ch.line = (o) => {
    const W = o.w || 520, H = o.h || 180, pl = o.pl || 34, pr = 10, pt = 10, pb = o.xLabels ? 22 : 10;
    const all = o.series.flatMap((s) => s.data.filter((v) => v !== null && isFinite(v)));
    let lo = o.yMin !== undefined ? o.yMin : Math.min(...all), hi = o.yMax !== undefined ? o.yMax : Math.max(...all);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; if (o.yMin === undefined) lo -= pad; if (o.yMax === undefined) hi += pad;
    const n = Math.max(...o.series.map((s) => s.data.length));
    const X = (i) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    let g = '';
    const ticks = o.yTicks || 4;
    for (let k = 0; k <= ticks; k++) {
      const v = lo + ((hi - lo) * k) / ticks, y = Y(v);
      g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 5}" y="${y + 3}" class="axis" text-anchor="end">${o.fmt ? o.fmt(v) : f1(v)}</text>`;
    }
    if (o.ref !== undefined) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" class="ref"/>`;
    (o.xLabels || []).forEach((l) => { g += `<text x="${X(l.i)}" y="${H - 6}" class="axis" text-anchor="middle">${u.esc(l.label)}</text>`; });
    for (const s of o.series) {
      const pts = s.data.map((v, i) => (v === null || !isFinite(v) ? null : [X(i), Y(v)])).filter(Boolean);
      if (!pts.length) continue;
      const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
      if (s.area) g += `<path d="${d}L${pts[pts.length - 1][0]},${H - pb}L${pts[0][0]},${H - pb}Z" fill="${s.color}" opacity="0.12"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>`;
      if (s.dots) pts.forEach((p) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="2.2" fill="${s.color}"/>`; });
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${u.esc(o.label || 'line chart')}">${g}</svg>`;
  };

  ch.spark = (data, o) => {
    o = o || {};
    return ch.line({ w: o.w || 120, h: o.h || 32, pl: 2, series: [{ data, color: o.color || 'var(--accent)', area: true, width: 1.5 }], yTicks: 0, label: 'sparkline' }).replace(/<line[^>]*class="grid"\/>|<text[^>]*class="axis"[^>]*>[^<]*<\/text>/g, '');
  };

  /** Vertical bar distribution; hl(i) → highlight class. */
  ch.bars = (vals, o) => {
    o = o || {};
    const W = o.w || 300, H = o.h || 110, pb = 16, pt = 6;
    const n = vals.length, max = Math.max(...vals, 1e-9);
    const bw = (W - 4) / n;
    let g = '';
    vals.forEach((v, i) => {
      const h = (v / max) * (H - pb - pt);
      const cls = o.hl ? o.hl(i) : '';
      g += `<rect x="${2 + i * bw + bw * 0.12}" y="${H - pb - h}" width="${bw * 0.76}" height="${Math.max(0.5, h)}" class="bar ${cls}" rx="1.5"><title>${o.labels ? o.labels[i] : i}: ${(v * 100).toFixed(1)}%</title></rect>`;
      if (!o.every || i % o.every === 0) g += `<text x="${2 + i * bw + bw / 2}" y="${H - 4}" class="axis" text-anchor="middle">${o.labels ? o.labels[i] : i}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="distribution">${g}</svg>`;
  };

  /** Mini distribution (projection "bell"). */
  ch.mini = (dist, color) => {
    const vals = dist.slice(0, 7);
    const W = 64, H = 20, max = Math.max(...vals, 1e-9), bw = W / vals.length;
    let g = '';
    vals.forEach((v, i) => { const h = (v / max) * (H - 2); g += `<rect x="${i * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" fill="${color || 'var(--accent)'}" opacity="${0.35 + 0.65 * (v / max)}" rx="1"/>`; });
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="distribution">${g}</svg>`;
  };

  ch.radar = (axes, series, o) => {
    o = o || {};
    const S = o.size || 220, c = S / 2, R = S / 2 - 34, n = axes.length;
    const P = (i, r) => [c + R * r * Math.sin((2 * Math.PI * i) / n), c - R * r * Math.cos((2 * Math.PI * i) / n)];
    let g = '';
    for (const r of [0.25, 0.5, 0.75, 1]) g += `<polygon points="${axes.map((_, i) => P(i, r).join(',')).join(' ')}" class="grid" fill="none"/>`;
    axes.forEach((a, i) => {
      const [x, y] = P(i, 1), [lx, ly] = P(i, 1.2);
      g += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" class="grid"/><text x="${lx}" y="${ly + 3}" class="axis lbl" text-anchor="middle">${u.esc(a)}</text>`;
    });
    for (const s of series) {
      const pts = s.vals.map((v, i) => P(i, u.clamp(v, 0.02, 1)).join(',')).join(' ');
      g += `<polygon points="${pts}" fill="${s.color}" fill-opacity="${s.fill || 0.22}" stroke="${s.color}" stroke-width="1.6"/>`;
    }
    return `<svg class="chart radar" viewBox="0 0 ${S} ${S}" role="img" aria-label="radar">${g}</svg>`;
  };

  /** Half-rink (offensive zone, net at top). Rink coords: x∈[25,100], y∈[-42.5,42.5]. */
  ch.rink = (shots, o) => {
    o = o || {};
    const W = 300, H = 270;
    const sx = (y) => 150 + (y / 42.5) * 140, sy = (x) => 12 + ((100 - x) / 75) * 250;
    let g = `<defs><clipPath id="rk"><path d="M${sx(-42.5)},${sy(25)} L${sx(-42.5)},${sy(72)} Q${sx(-42.5)},${sy(100)} ${sx(-14.5)},${sy(100)} L${sx(14.5)},${sy(100)} Q${sx(42.5)},${sy(100)} ${sx(42.5)},${sy(72)} L${sx(42.5)},${sy(25)} Z"/></clipPath></defs>`;
    g += `<path d="M${sx(-42.5)},${sy(25)} L${sx(-42.5)},${sy(72)} Q${sx(-42.5)},${sy(100)} ${sx(-14.5)},${sy(100)} L${sx(14.5)},${sy(100)} Q${sx(42.5)},${sy(100)} ${sx(42.5)},${sy(72)} L${sx(42.5)},${sy(25)} Z" class="ice"/>`;
    if (o.lanes !== false) {
      // shooting lanes: perimeter, slot, high-danger
      g += `<g clip-path="url(#rk)"><polygon points="${sx(-42.5)},${sy(25)} ${sx(42.5)},${sy(25)} ${sx(42.5)},${sy(89)} ${sx(-42.5)},${sy(89)}" class="lane-per"/>`;
      g += `<polygon points="${sx(-22)},${sy(54)} ${sx(22)},${sy(54)} ${sx(9)},${sy(89)} ${sx(-9)},${sy(89)}" class="lane-slot"/>`;
      g += `<polygon points="${sx(-9)},${sy(69)} ${sx(9)},${sy(69)} ${sx(4)},${sy(89)} ${sx(-4)},${sy(89)}" class="lane-hd"/></g>`;
    }
    g += `<line x1="${sx(-42.5)}" x2="${sx(42.5)}" y1="${sy(89)}" y2="${sy(89)}" class="goalline"/>`;
    g += `<line x1="${sx(-42.5)}" x2="${sx(42.5)}" y1="${sy(25)}" y2="${sy(25)}" class="blueline"/>`;
    g += `<path d="M${sx(-4)},${sy(89)} A${(6 / 42.5) * 140},${(6 / 75) * 250} 0 0 0 ${sx(4)},${sy(89)}" class="crease"/>`;
    g += `<rect x="${sx(-3)}" y="${sy(91)}" width="${sx(3) - sx(-3)}" height="${sy(89) - sy(91)}" class="net"/>`;
    for (const yy of [-22, 22]) {
      g += `<ellipse cx="${sx(yy)}" cy="${sy(69)}" rx="${(15 / 42.5) * 140}" ry="${(15 / 75) * 250}" class="circle"/><circle cx="${sx(yy)}" cy="${sy(69)}" r="2" class="dot"/>`;
    }
    if (o.heat) {
      // hex-ish binning of xG
      const bins = {};
      for (const s of shots) {
        if (s.r === 3) continue;
        const bx = Math.round(s.y / 6), by = Math.round(s.x / 6);
        const k = bx + ':' + by; bins[k] = (bins[k] || 0) + s.xg;
      }
      const mx = Math.max(...Object.values(bins), 1e-9);
      g += '<g clip-path="url(#rk)">';
      for (const [k, v] of Object.entries(bins)) {
        const [bx, by] = k.split(':').map(Number);
        g += `<circle cx="${sx(bx * 6)}" cy="${sy(by * 6)}" r="${9 + 5 * (v / mx)}" fill="var(--heat)" opacity="${(0.08 + 0.7 * (v / mx)).toFixed(2)}"/>`;
      }
      g += '</g>';
    }
    if (o.dots !== false) {
      const order = shots.slice().sort((a, b) => a.r - b.r);
      for (const s of order) {
        if (o.noBlocked && s.r === 3) continue;
        const cls = s.r === 2 ? 'sh-goal' : s.r === 1 ? 'sh-save' : s.r === 0 ? 'sh-miss' : 'sh-blk';
        const r = s.r === 2 ? 3.6 : 2.3;
        g += `<circle cx="${sx(s.y).toFixed(1)}" cy="${sy(s.x).toFixed(1)}" r="${r}" class="${cls}"/>`;
      }
    }
    return `<svg class="chart rink" viewBox="0 0 ${W} ${H}" role="img" aria-label="shot map">${g}</svg>`;
  };

  /** Full rink with entry / exit arrows (left = own zone, right = offensive). */
  ch.fullRink = (o) => {
    const W = 420, H = 180;
    let g = `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="56" class="ice"/>`;
    g += `<line x1="${W / 2}" x2="${W / 2}" y1="4" y2="${H - 4}" class="redline"/><line x1="${W * 0.36}" x2="${W * 0.36}" y1="4" y2="${H - 4}" class="blueline"/><line x1="${W * 0.64}" x2="${W * 0.64}" y1="4" y2="${H - 4}" class="blueline"/>`;
    g += `<line x1="${W * 0.06}" x2="${W * 0.06}" y1="12" y2="${H - 12}" class="goalline"/><line x1="${W * 0.94}" x2="${W * 0.94}" y1="12" y2="${H - 12}" class="goalline"/>`;
    g += `<circle cx="${W / 2}" cy="${H / 2}" r="22" class="circle"/>`;
    for (const x of [0.17, 0.83]) for (const y of [0.3, 0.7]) g += `<circle cx="${W * x}" cy="${H * y}" r="20" class="circle"/>`;
    const arrow = (x1, y1, x2, y2, cls, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" stroke-width="${w}" marker-end="url(#ah-${cls})"/>`;
    g += `<defs>${['arr-in', 'arr-out'].map((c) => `<marker id="ah-${c}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0L10,5L0,10z" class="${c}-head"/></marker>`).join('')}</defs>`;
    const ent = o.entries || [0.6, 0.5, 0.4], ex = o.exits || [0.6, 0.5, 0.4];
    [0.28, 0.5, 0.72].forEach((y, i) => { g += arrow(W * 0.12, H * y, W * 0.33, H * y, 'arr-out', 2 + 4 * ex[i]); });
    [0.28, 0.5, 0.72].forEach((y, i) => { g += arrow(W * 0.6, H * y, W * 0.84, H * y, 'arr-in', 2 + 4 * ent[i]); });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="zone entries and exits">${g}</svg>`;
  };

  /** Goalie net heat map: grid of [sa, ga, xga] cells → save % vs expected. */
  ch.net = (cells, o) => {
    o = o || {};
    const cols = cells[0].length, rows = cells.length;
    const W = 260, H = 190, nx = 20, ny = 16, nw = W - 40, nh = H - 40;
    let g = `<rect x="${nx - 6}" y="${ny - 6}" width="${nw + 12}" height="${nh + 6}" class="netframe" rx="4"/>`;
    const cw = nw / cols, rh = nh / rows;
    cells.forEach((row, r) => row.forEach((c, k) => {
      const d = c.sa >= 8 ? (c.xga - c.ga) / c.sa : 0; // GSAx per shot in cell
      const t = u.clamp(d / 0.05, -1, 1);
      g += `<rect x="${nx + k * cw}" y="${ny + r * rh}" width="${cw - 1}" height="${rh - 1}" fill="${u.diverge(t)}"><title>SA ${c.sa} · GA ${c.ga} · SV ${c.sa ? (1 - c.ga / c.sa).toFixed(3) : '—'}</title></rect>`;
      if (c.sa >= 8) g += `<text x="${nx + k * cw + cw / 2}" y="${ny + r * rh + rh / 2 + 3}" class="axis cell" text-anchor="middle">${u.sv(1 - c.ga / c.sa)}</text>`;
    }));
    g += `<line x1="${nx - 6}" x2="${nx + nw + 6}" y1="${ny + nh}" y2="${ny + nh}" class="goalline"/>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="net save map">${g}</svg>`;
  };

  /** Calibration scatter (pred vs observed) with diagonal. */
  ch.calib = (pts, o) => {
    o = o || {};
    const W = o.w || 260, H = o.h || 220, p = 30, lo = o.lo || 0, hi = o.hi || 1;
    const cl = (v) => Math.min(hi, Math.max(lo, v));
    const X = (v) => p + ((cl(v) - lo) / (hi - lo)) * (W - p - 10), Y = (v) => H - p + 8 - ((cl(v) - lo) / (hi - lo)) * (H - p - 10);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      g += `<line x1="${p}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${p - 4}" y="${Y(v) + 3}" class="axis" text-anchor="end">${v.toFixed(o.dp || 1)}</text><text x="${X(v)}" y="${H - 6}" class="axis" text-anchor="middle">${v.toFixed(o.dp || 1)}</text>`;
    }
    g += `<line x1="${X(lo)}" y1="${Y(lo)}" x2="${X(hi)}" y2="${Y(hi)}" class="ref"/>`;
    const sorted = pts.slice().sort((a, b) => a.pred - b.pred);
    g += `<path d="M${sorted.map((q) => X(q.pred).toFixed(1) + ',' + Y(q.obs).toFixed(1)).join('L')}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
    const mx = Math.max(...pts.map((q) => q.n));
    for (const q of sorted) g += `<circle cx="${X(q.pred)}" cy="${Y(q.obs)}" r="${2.5 + 4 * Math.sqrt(q.n / mx)}" fill="var(--accent)" fill-opacity="0.55" stroke="var(--accent)"><title>pred ${q.pred.toFixed(3)} · obs ${q.obs.toFixed(3)} · n=${q.n}</title></circle>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="calibration curve">${g}</svg>`;
  };

  /** Score-probability matrix as an HTML table. */
  ch.scoreGrid = (m, hl, al, max) => {
    max = max || 7;
    let peak = 0; for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) peak = Math.max(peak, m[i][j]);
    let h = `<table class="grid-tbl"><tr><th class="corner">${u.esc(hl)} ↓ / ${u.esc(al)} →</th>${[...Array(max + 1).keys()].map((j) => `<th>${j}</th>`).join('')}</tr>`;
    for (let i = 0; i <= max; i++) {
      h += `<tr><th>${i}</th>`;
      for (let j = 0; j <= max; j++) {
        const p = m[i][j], t = p / peak;
        const tone = i > j ? 'var(--pos)' : i < j ? 'var(--neg)' : 'var(--warn)';
        h += `<td style="background:color-mix(in srgb, ${tone} ${Math.round(8 + 70 * t)}%, transparent)" title="${hl} ${i} – ${j} ${al}: ${(p * 100).toFixed(2)}%">${p >= 0.005 ? (p * 100).toFixed(1) : ''}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  };

  NQ.ch = ch;
})(globalThis.NQ = globalThis.NQ || {});

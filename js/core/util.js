/* ==========================================================================
 * NQ.u — shared formatting + statistics helpers.
 * ========================================================================== */
(function (NQ) {
  'use strict';

  const u = {};

  u.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  u.logistic = (x) => 1 / (1 + Math.exp(-x));
  u.logit = (p) => Math.log(p / (1 - p));
  u.sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  u.mean = (a) => (a.length ? u.sum(a) / a.length : 0);
  u.sd = (a) => {
    if (a.length < 2) return 0;
    const m = u.mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  };
  u.div = (a, b, d) => (b ? a / b : (d === undefined ? 0 : d));
  u.per60 = (x, toiSec) => (toiSec > 0 ? (x * 3600) / toiSec : 0);

  /** Quantile of a numeric array (sorted copy, linear interpolation). */
  u.quantile = (arr, q) => {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };

  /** Percentile rank (0-100) of v within a pre-sorted ascending array. */
  u.pctRank = (sorted, v) => {
    const n = sorted.length;
    if (!n) return 50;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    let hi2 = lo;
    while (hi2 < n && sorted[hi2] === v) hi2++;
    return u.clamp(((lo + hi2) / 2 / n) * 100, 0, 100);
  };

  /** Simple OLS slope of y on index. */
  u.slope = (y) => {
    const n = y.length;
    if (n < 2) return 0;
    const mx = (n - 1) / 2, my = u.mean(y);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - mx) * (y[i] - my); den += (i - mx) * (i - mx); }
    return den ? num / den : 0;
  };

  /** Rolling mean of ratio sum(a)/sum(b) over window w (returns per-index). */
  u.rollingRatio = (a, b, w, scale) => {
    const out = [];
    for (let i = 0; i < a.length; i++) {
      let sa = 0, sb = 0;
      for (let j = Math.max(0, i - w + 1); j <= i; j++) { sa += a[j]; sb += b[j]; }
      out.push(sb ? (sa / sb) * (scale || 1) : 0);
    }
    return out;
  };

  /** Poisson pmf. */
  u.poissonPmf = (k, l) => {
    let p = Math.exp(-l);
    for (let i = 1; i <= k; i++) p *= l / i;
    return p;
  };

  // ---------------- formatting ----------------
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  u.fx = (v, d) => (isNum(v) ? v.toFixed(d === undefined ? 2 : d) : '—');
  u.sgn = (v, d) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '' : '±') + v.toFixed(d === undefined ? 2 : d) : '—');
  u.pct = (v, d) => (isNum(v) ? (v * 100).toFixed(d === undefined ? 1 : d) + '%' : '—');
  u.sv = (v) => (isNum(v) ? (v >= 1 ? '1.000' : v.toFixed(3).replace(/^0/, '')) : '—');
  u.toi = (sec) => {
    if (!isNum(sec)) return '—';
    const s = Math.round(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  u.int = (v) => (isNum(v) ? String(Math.round(v)) : '—');
  u.ord = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /** Format a metric value given a metric format code. */
  u.fmtMetric = (v, f) => {
    switch (f) {
      case 'r0': return u.fx(v, 0);
      case 'r1': return u.fx(v, 1);
      case 'r3': return u.fx(v, 3);
      case 'pct': return isNum(v) ? v.toFixed(1) + '%' : '—';
      case 'sv': return u.sv(v);
      case 'toi': return u.toi(v);
      case 's2': return u.sgn(v, 2);
      case 's1': return u.sgn(v, 1);
      case 'int': return u.int(v);
      case 'rec': return v;
      default: return u.fx(v, 2);
    }
  };

  u.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Percentile → heat color class name. */
  u.pctClass = (p) => (p >= 90 ? 'p-elite' : p >= 70 ? 'p-good' : p >= 40 ? 'p-avg' : p >= 20 ? 'p-weak' : 'p-poor');

  /** Diverging color for a value in [-1,1] (blue ↔ red), returns css rgb. */
  u.diverge = (t, alpha) => {
    const x = u.clamp(t, -1, 1);
    const a = alpha === undefined ? 0.85 : alpha;
    if (x >= 0) return `rgba(${Math.round(40 + 30 * (1 - x))},${Math.round(150 + 60 * x)},${Math.round(90 + 20 * (1 - x))},${(0.15 + a * x).toFixed(2)})`;
    const y = -x;
    return `rgba(${Math.round(200 + 30 * y)},${Math.round(70 - 20 * y)},${Math.round(70 - 20 * y)},${(0.15 + a * y).toFixed(2)})`;
  };

  NQ.u = u;
})(globalThis.NQ = globalThis.NQ || {});

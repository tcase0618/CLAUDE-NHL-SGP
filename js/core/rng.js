/* ==========================================================================
 * NQ.Rng — deterministic seeded random number generator + distributions.
 *
 * Everything in the terminal (league, rosters, season, Monte Carlo) is driven
 * from seeded streams so a given seed always reproduces the exact same
 * synthetic universe. That is what makes the backtest and audit reproducible.
 * ========================================================================== */
(function (NQ) {
  'use strict';

  /** mulberry32: tiny, fast, good-quality 32-bit PRNG. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** FNV-1a string hash → uint32 seed. Used to derive per-entity streams. */
  function hashSeed(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function Rng(seed) {
    this.r = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
    this._spare = null;
  }

  Rng.prototype.next = function () { return this.r(); };

  /** Standard normal via Box–Muller (caches the spare deviate). */
  Rng.prototype.normal = function (mu, sd) {
    let z;
    if (this._spare !== null) { z = this._spare; this._spare = null; }
    else {
      let u = 0, v = 0;
      while (u === 0) u = this.r();
      v = this.r();
      const m = Math.sqrt(-2 * Math.log(u));
      z = m * Math.cos(2 * Math.PI * v);
      this._spare = m * Math.sin(2 * Math.PI * v);
    }
    return (mu || 0) + (sd === undefined ? 1 : sd) * z;
  };

  /** Poisson draw. Knuth for small means, normal approximation for large. */
  Rng.prototype.poisson = function (lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.r(); } while (p > L);
    return k - 1;
  };

  Rng.prototype.int = function (a, b) { return a + Math.floor(this.r() * (b - a + 1)); };
  Rng.prototype.uniform = function (a, b) { return a + this.r() * (b - a); };
  Rng.prototype.chance = function (p) { return this.r() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.r() * arr.length)]; };

  /** Pick an index from a weight array (weights need not sum to 1). */
  Rng.prototype.weighted = function (w, n) {
    const len = n === undefined ? w.length : n;
    let tot = 0;
    for (let i = 0; i < len; i++) tot += w[i];
    let x = this.r() * tot;
    for (let i = 0; i < len; i++) { x -= w[i]; if (x <= 0) return i; }
    return len - 1;
  };

  Rng.prototype.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  NQ.Rng = Rng;
  NQ.hashSeed = hashSeed;
})(globalThis.NQ = globalThis.NQ || {});

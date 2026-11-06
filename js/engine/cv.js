/* ==========================================================================
 * NQ.cv — Case Value (CV%) engine. Authoritative opportunity metric.
 *
 *   No-push market:     CV% = 100 × [ p_lower × D − 1 ]
 *   Push-eligible:      CV% = 100 × [ p_win_lower × (D − 1) − p_loss_upper ]
 *   SGP (all-or-none):  CV% = 100 × [ P_joint_lower × D_SGP − 1 ]
 *
 * p_lower / p_loss_upper are conservative bounds supplied by the model layer
 * (validated calibration tables for single props; Monte Carlo + validated
 * joint-calibration haircut for SGPs). D is ALWAYS an actual offered decimal
 * price — CV% is never computed from an assumed or multiplied price.
 * CV% is an expected-value estimate under the conservative probability, not a
 * guaranteed or observed return.
 * ========================================================================== */
(function (NQ) {
  'use strict';

  const cv = {};
  cv.Z = 1.645; // one-sided 95%

  /** American → decimal. Throws on invalid input (|odds| < 100 or non-finite). */
  cv.toDecimal = (american) => {
    const o = Number(american);
    if (!isFinite(o) || Math.abs(o) < 100) throw new Error('Invalid American odds: ' + american);
    return o > 0 ? 1 + o / 100 : 1 + 100 / -o;
  };
  /** Decimal → American (rounded to integer, books quote integers). */
  cv.toAmerican = (dec) => {
    if (!(dec > 1)) throw new Error('Invalid decimal odds: ' + dec);
    return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
  };
  cv.implied = (american) => 1 / cv.toDecimal(american);
  /** Fair American price for probability p (no margin). */
  cv.fair = (p) => (p > 0 && p < 1 ? cv.toAmerican(1 / p) : null);

  /** CV% for an all-or-nothing (no push) market. */
  cv.noPush = (pLower, decimal) => {
    if (!(pLower >= 0 && pLower <= 1)) throw new Error('p_lower out of range');
    if (!(decimal > 1)) throw new Error('decimal odds must be > 1');
    return 100 * (pLower * decimal - 1);
  };

  /** CV% for a push-eligible market. Bounds must be jointly valid (sum ≤ 1). */
  cv.withPush = (pWinLower, pLossUpper, decimal) => {
    if (pWinLower < 0 || pLossUpper < 0 || pWinLower + pLossUpper > 1 + 1e-12) throw new Error('jointly invalid probability bounds');
    if (!(decimal > 1)) throw new Error('decimal odds must be > 1');
    return 100 * (pWinLower * (decimal - 1) - pLossUpper);
  };

  /** Raw EV% (internal testing only — never the primary ranking). */
  cv.rawEV = (p, decimal) => 100 * (p * decimal - 1);

  /** Wilson score lower bound for a Monte Carlo proportion (hits/n). */
  cv.wilsonLower = (hits, n, z) => {
    z = z || cv.Z;
    if (!n) return 0;
    const p = hits / n, z2 = z * z;
    return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n));
  };
  cv.wilsonUpper = (hits, n, z) => 1 - cv.wilsonLower(n - hits, n, z);

  /**
   * Conservative bound for a single-prop probability using a validated
   * lower-bound table [{hi, adj}] (adj ≤ 0 from the calibration window).
   */
  cv.applyTable = (p, table) => {
    if (!table || !table.length) return null; // no validated table → no conservative bound
    let i = 0;
    while (i < table.length - 1 && p > table[i].hi) i++;
    return Math.min(1, Math.max(0, p + table[i].adj));
  };

  /**
   * Single-prop evaluation. side: 'over' | 'under'. line: number (x.5 → no push).
   * dist: {pmf(k) → prob} over integers. table: validated lower table for P(X ≥ k)
   * at the relevant threshold (over side) — under side uses the mirrored bound.
   */
  cv.evalProp = ({ dist, line, side, decimal, tableOver }) => {
    const isInt = Math.abs(line - Math.round(line)) < 1e-9;
    const kOver = isInt ? line + 1 : Math.ceil(line);      // X ≥ kOver wins the over
    const pOver = dist.ge(kOver);
    const pPush = isInt ? dist.pmf(line) : 0;
    const pUnder = Math.max(0, 1 - pOver - pPush);
    const lowOver = cv.applyTable(pOver, tableOver);
    if (lowOver === null) return { supported: false, reason: 'No validated calibration table for this market', pOver, pUnder, pPush };
    // Upper bound on over (for the under side) mirrors the haircut.
    const upOver = Math.min(1 - pPush, pOver + (pOver - lowOver));
    let pWin, pWinLower, pLossUpper;
    if (side === 'over') { pWin = pOver; pWinLower = lowOver; pLossUpper = Math.min(1 - pPush - lowOver, pUnder + (pOver - lowOver)); }
    else { pWin = pUnder; pWinLower = Math.max(0, 1 - pPush - upOver); pLossUpper = Math.min(1 - pPush - pWinLower, upOver); }
    const value = isInt ? cv.withPush(pWinLower, pLossUpper, decimal) : cv.noPush(pWinLower, decimal);
    return { supported: true, push: isInt, pWin, pPush, pWinLower, pLossUpper, cv: value, ev: cv.rawEV(pWin, decimal), breakEven: 1 / decimal };
  };

  /**
   * SGP evaluation. Requires an actual combined quote. pJointLower must come
   * from the joint model (never a product of marginals).
   */
  cv.evalSGP = ({ pJoint, pJointLower, quoteAmerican, precisionOK }) => {
    if (quoteAmerican === null || quoteAmerican === undefined || quoteAmerican === '') return { supported: false, reason: 'No combined SGP quote from a sportsbook — CV% unavailable', breakEvenAmerican: pJointLower > 0 ? cv.fair(pJointLower) : null };
    if (!precisionOK) return { supported: false, reason: 'Joint probability precision insufficient — unverified', breakEvenAmerican: null };
    const D = cv.toDecimal(quoteAmerican);
    return { supported: true, decimal: D, cv: cv.noPush(pJointLower, D), ev: cv.rawEV(pJoint, D), implied: 1 / D, edgeLower: pJointLower - 1 / D };
  };

  /**
   * Efficient frontier on (odds, probability): keep items not dominated on both
   * higher decimal odds AND higher conservative probability.
   */
  cv.frontier = (items, getD, getP) => {
    const s = items.slice().sort((a, b) => getD(b) - getD(a) || getP(b) - getP(a));
    const out = []; let bestP = -1;
    for (const it of s) { const p = getP(it); if (p > bestP) { out.push(it); bestP = p; } }
    return out;
  };

  /**
   * CV Confidence — evidence-based reliability grade (A/B/C/Unverified). Every
   * criterion is a measured quantity; the grade is the count of criteria met.
   */
  cv.confidence = (e) => {
    const checks = [
      ['Calibration coverage ≥ 80% of held-out bins', e.coverage !== undefined && e.coverage >= 0.8],
      ['Held-out sample ≥ 2,000 rows for this market', e.sampleN >= 2000],
      ['Model agreement (|xgb − ag| ≤ 0.05)', e.agreement !== undefined && e.agreement <= 0.05],
      ['Monte Carlo rel. error ≤ 10%', e.mcRelErr === undefined || e.mcRelErr <= 0.1],
      ['Features complete (player has ≥ 20 prior GP)', e.gpPrior >= 20],
      ['Data fresh (≤ 36 h since last ingested game)', e.ageHours !== undefined && e.ageHours <= 36],
      ['Champion beats baseline on selection window', !!e.beatsBaseline]
    ];
    const met = checks.filter((c) => c[1]).length;
    const grade = met >= 6 ? 'A' : met >= 5 ? 'B' : met >= 4 ? 'C' : 'Unverified';
    return { grade, met, total: checks.length, checks };
  };

  NQ.cv = cv;
})(globalThis.NQ = globalThis.NQ || {});

/* Predictive count distributions (mirrors ml/nqml/dist.py): Poisson or NB2. */
(function (NQ) {
  'use strict';
  function lgamma(z) { // Lanczos
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  NQ.cv.dist = (mu, family, alpha) => {
    mu = Math.max(1e-6, mu);
    const nb = family === 'nb' && alpha > 1e-6;
    const n = nb ? 1 / alpha : 0, p = nb ? n / (n + mu) : 0;
    const pmf = (k) => (k < 0 ? 0 : nb ? Math.exp(lgamma(k + n) - lgamma(n) - lgamma(k + 1) + n * Math.log(p) + k * Math.log(1 - p)) : Math.exp(-mu + k * Math.log(mu) - lgamma(k + 1)));
    const ge = (k) => { let s = 0; for (let i = 0; i < k; i++) s += pmf(i); return Math.max(0, 1 - s); };
    return { pmf, ge, mean: mu, family: nb ? 'nb' : 'poisson', alpha: nb ? alpha : 0 };
  };
})(globalThis.NQ = globalThis.NQ || {});

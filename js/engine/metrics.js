/* ==========================================================================
 * NQ.metrics — the statistical library.
 *
 *   80  universal skater metrics       (8 categories × 10)
 *   30  per positional module          (Center, Winger, Offensive D, Shutdown D)
 *   60  goaltender metrics             (6 categories × 10)
 *   200 team metrics                   (20 categories × 10)
 *
 * Every metric declares a source:
 *   PBP — measured directly from simulated play-by-play events
 *   TRK — tracking / manual-charting equivalent (entries, exits, gaps…);
 *         modelled from latent skills + sample-size noise, because public
 *         play-by-play does not contain these events
 *   MDL — a model output (shrinkage estimates, GAR, uncertainty)
 * Each value is stored with its denominator context so the UI can flag
 * small samples (the "80% xGF over 3 minutes" problem).
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const u = NQ.u;
  const { S, G, T, NL } = NQ.sim;

  // ------------------------------------------------------------ helpers
  const p60 = (x, toi) => (toi > 30 ? (x * 3600) / toi : null);
  const pc = (a, b) => (a + b > 0 ? (a / (a + b)) * 100 : null);
  const rt = (a, b, k) => (b > 0 ? (a / b) * (k || 1) : null);
  const sv = (sa, ga) => (sa > 0 ? 1 - ga / sa : null);

  /** Deterministic per-entity noise for TRK metrics; shrinks with sample. */
  function noise(id, key, sample) {
    const r = new NQ.Rng('n:' + id + ':' + key);
    return r.normal(0, 1) * Math.min(1.2, Math.sqrt(400 / Math.max(60, sample)));
  }
  /** Build a TRK/MDL calc from latent drivers: mean + sd·(signal + noise). */
  function der(mean, sd, w, o) {
    o = o || {};
    const keys = Object.keys(w);
    const norm = Math.sqrt(keys.reduce((s, k) => s + w[k] * w[k], 0)) || 1;
    return (c, key) => {
      let sig = 0;
      for (const k of keys) sig += w[k] * (c.L[k] || 0);
      sig /= norm;
      const m = typeof mean === 'function' ? mean(c) : mean;
      let v = m + sd * (0.8 * sig + 0.45 * noise(c.id, key, c.sample));
      if (o.min !== undefined) v = Math.max(o.min, v);
      if (o.max !== undefined) v = Math.min(o.max, v);
      return v;
    };
  }
  const byPos = (f, d) => (c) => (c.isD ? d : f);

  // A metric: [key, name, format, higherIsBetter(true/false/null), source, definition, calc]
  const M = (k, n, f, hib, src, def, calc) => ({ k, n, f, hib, src, def, calc });

  // ===================================================================
  //  UNIVERSAL SKATER — 8 × 10
  // ===================================================================
  const SKATER = [
    { id: 'scoring', n: 'Scoring & point production', m: [
      M('g60', 'Goals / 60', 'r2', true, 'PBP', 'G × 3600 / TOI (all situations)', (c) => p60(c.a[S.G], c.toi)),
      M('a160', 'Primary assists / 60', 'r2', true, 'PBP', 'A1 × 3600 / TOI', (c) => p60(c.a[S.A1], c.toi)),
      M('a260', 'Secondary assists / 60', 'r2', true, 'PBP', 'A2 × 3600 / TOI', (c) => p60(c.a[S.A2], c.toi)),
      M('pp160', 'Primary points / 60', 'r2', true, 'PBP', '(G + A1) × 3600 / TOI', (c) => p60(c.a[S.G] + c.a[S.A1], c.toi)),
      M('p60', 'Points / 60', 'r2', true, 'PBP', '(G + A1 + A2) × 3600 / TOI', (c) => p60(c.pts, c.toi)),
      M('g560', '5v5 goals / 60', 'r2', true, 'PBP', '5v5 G × 3600 / 5v5 TOI', (c) => p60(c.a[S.G5], c.toi5)),
      M('ppp60', 'PP points / 60', 'r2', true, 'PBP', '(PPG + PPA) × 3600 / PP TOI', (c) => p60(c.a[S.PPG] + c.a[S.PPA], c.a[S.TOIPP])),
      M('ixg60', 'Individual xG / 60', 'r2', true, 'PBP', 'Σ shot xG × 3600 / TOI', (c) => p60(c.a[S.IXG], c.toi)),
      M('gax', 'Goals above expected', 's1', true, 'PBP', 'G − ixG', (c) => c.a[S.G] - c.a[S.IXG]),
      M('ppg', 'Points / game', 'r2', true, 'PBP', '(G + A) / GP', (c) => rt(c.pts, c.gp))
    ] },
    { id: 'shots', n: 'Shot generation & shooting', m: [
      M('sog60', 'Shots on goal / 60', 'r2', true, 'PBP', 'SOG × 3600 / TOI', (c) => p60(c.a[S.SOG], c.toi)),
      M('icf60', 'Shot attempts / 60', 'r2', true, 'PBP', 'iCF (all attempts) × 3600 / TOI', (c) => p60(c.a[S.ICF], c.toi)),
      M('iff60', 'Unblocked attempts / 60', 'r2', true, 'PBP', 'iFF × 3600 / TOI', (c) => p60(c.a[S.IFF], c.toi)),
      M('sogpct', 'SOG % of attempts', 'pct', true, 'PBP', 'SOG / iCF', (c) => rt(c.a[S.SOG], c.a[S.ICF], 100)),
      M('shpct', 'Shooting %', 'pct', true, 'PBP', 'G / SOG', (c) => rt(c.a[S.G], c.a[S.SOG], 100)),
      M('xshpct', 'Expected Fenwick Sh%', 'pct', true, 'PBP', 'ixG / iFF', (c) => rt(c.a[S.IXG], c.a[S.IFF], 100)),
      M('hd60', 'High-danger shots / 60', 'r2', true, 'PBP', 'Unblocked HD attempts × 3600 / TOI', (c) => p60(c.a[S.HD], c.toi)),
      M('md60', 'Medium-danger shots / 60', 'r2', true, 'PBP', 'Unblocked MD attempts × 3600 / TOI', (c) => p60(c.a[S.MD], c.toi)),
      M('reb60', 'Rebound shots / 60', 'r2', true, 'PBP', 'Rebound attempts × 3600 / TOI', (c) => p60(c.a[S.REB], c.toi)),
      M('xgatt', 'Shot quality / attempt', 'r3', true, 'PBP', 'ixG / iCF', (c) => rt(c.a[S.IXG], c.a[S.ICF]))
    ] },
    { id: 'play', n: 'Playmaking & chance creation', m: [
      M('sa60', 'Shot assists / 60', 'r2', true, 'PBP', 'Passes leading to SOG × 3600 / TOI', (c) => p60(c.a[S.SA1], c.toi)),
      M('xa60', 'Expected assists / 60', 'r2', true, 'PBP', 'Σ xG of shots set up × 3600 / TOI', (c) => p60(c.a[S.XA], c.toi)),
      M('hdp60', 'High-danger passes / 60', 'r2', true, 'PBP', 'Shot assists on HD chances × 3600 / TOI', (c) => p60(c.a[S.HDSA], c.toi)),
      M('csp60', 'Cross-slot passes / 60', 'r2', true, 'PBP', 'Shot assists across the slot × 3600 / TOI', (c) => p60(c.a[S.CSA], c.toi)),
      M('rsa60', 'Rush shot assists / 60', 'r2', true, 'PBP', 'Shot assists off the rush × 3600 / TOI', (c) => p60(c.a[S.RSA], c.toi)),
      M('ppsa60', 'PP shot assists / 60', 'r2', true, 'PBP', 'PP shot assists × 3600 / PP TOI', (c) => p60(c.a[S.PPSA], c.a[S.TOIPP])),
      M('a1conv', 'Shot assist → A1 conversion', 'pct', true, 'PBP', 'A1 / shot assists', (c) => rt(c.a[S.A1], c.a[S.SA1], 100)),
      M('slotpc', 'Slot pass completion %', 'pct', true, 'TRK', 'Completed passes into the slot / attempted', der(61, 6, { pm: 1, iq: 0.5 }, { min: 35, max: 85 })),
      M('cc60', 'Chance creation / 60', 'r2', true, 'PBP', '(ixG + xA) × 3600 / TOI', (c) => p60(c.a[S.IXG] + c.a[S.XA], c.toi)),
      M('pmi', 'Playmaking index', 'r1', true, 'MDL', 'Composite of xA, HD passes, slot completion (0-100)', der(50, 16, { pm: 1, iq: 0.4, trn: 0.2 }, { min: 1, max: 99 }))
    ] },
    { id: 'poss', n: 'Possession & on-ice results (5v5)', m: [
      M('cf', 'Corsi For %', 'pct', true, 'PBP', 'On-ice CF / (CF + CA), 5v5', (c) => pc(c.a[S.CF5], c.a[S.CA5])),
      M('ff', 'Fenwick For %', 'pct', true, 'PBP', 'On-ice FF / (FF + FA), 5v5', (c) => pc(c.a[S.FF5], c.a[S.FA5])),
      M('xgf', 'Expected Goals For %', 'pct', true, 'PBP', 'On-ice xGF / (xGF + xGA), 5v5', (c) => pc(c.a[S.XGF5], c.a[S.XGA5])),
      M('xgf60', 'xGF / 60', 'r2', true, 'PBP', 'On-ice xGF × 3600 / 5v5 TOI', (c) => p60(c.a[S.XGF5], c.toi5)),
      M('xga60', 'xGA / 60', 'r2', false, 'PBP', 'On-ice xGA × 3600 / 5v5 TOI', (c) => p60(c.a[S.XGA5], c.toi5)),
      M('xgd60', 'xG differential / 60', 's2', true, 'PBP', '(xGF − xGA) × 3600 / 5v5 TOI', (c) => p60(c.a[S.XGF5] - c.a[S.XGA5], c.toi5)),
      M('gf', 'Goals For %', 'pct', true, 'PBP', 'On-ice GF / (GF + GA), 5v5', (c) => pc(c.a[S.GF5], c.a[S.GA5])),
      M('oish', 'On-ice shooting %', 'pct', null, 'PBP', 'On-ice GF / SF, 5v5', (c) => rt(c.a[S.GF5], c.a[S.SF5], 100)),
      M('oisv', 'On-ice save %', 'sv', null, 'PBP', '1 − GA / SA, 5v5', (c) => sv(c.a[S.SA5], c.a[S.GA5])),
      M('saxgf', 'Score/venue-adj. xGF%', 'pct', true, 'MDL', 'xGF% re-weighted for score state & venue', (c) => { const x = pc(c.a[S.XGF5], c.a[S.XGA5]); return x === null ? null : x + 0.6 * noise(c.id, 'saxgf', 4000) - 0.15 * (c.team.lat.off); })
    ] },
    { id: 'trans', n: 'Transition & puck movement', m: [
      M('cent60', 'Controlled entries / 60', 'r2', true, 'TRK', 'Carry-ins + pass-ins with possession × 3600 / 5v5 TOI', der(byPos(7.2, 3.4), 1.9, { trn: 1, skt: 0.5, pm: 0.3 }, { min: 0.5 })),
      M('entsuc', 'Entry success %', 'pct', true, 'TRK', 'Entries that retain possession ≥ 5 s', der(71, 5, { trn: 0.8, skt: 0.4 }, { min: 45, max: 92 })),
      M('carry', 'Carry-in %', 'pct', true, 'TRK', 'Controlled entries / all entries', der(byPos(49, 38), 8, { trn: 1, skt: 0.6 }, { min: 10, max: 85 })),
      M('dump60', 'Dump-ins / 60', 'r2', null, 'TRK', 'Uncontrolled entries × 3600 / 5v5 TOI', der(byPos(5.2, 2.6), 1.4, { trn: -0.6, phy: 0.5 }, { min: 0.3 })),
      M('cex60', 'Controlled exits / 60', 'r2', true, 'TRK', 'Exits with possession × 3600 / 5v5 TOI', der(byPos(4.2, 8.6), 2.0, { trn: 1, pm: 0.4 }, { min: 0.5 })),
      M('exsuc', 'Exit success %', 'pct', true, 'TRK', 'Exit attempts that clear the zone', der(74, 5, { trn: 0.6, iq: 0.4, def: 0.3 }, { min: 50, max: 93 })),
      M('expass', 'Exit pass completion %', 'pct', true, 'TRK', 'Completed breakout passes / attempted', der(78, 4.5, { pm: 0.7, iq: 0.3 }, { min: 55, max: 95 })),
      M('txg60', 'Transition xG / 60', 'r2', true, 'PBP', '(Rush ixG + rush xA) × 3600 / TOI', (c) => p60(c.a[S.RXG] + c.a[S.RXA], c.toi)),
      M('nzt60', 'Neutral-zone takeaways / 60', 'r2', true, 'TRK', 'NZ takeaways × 3600 / 5v5 TOI', der(1.6, 0.5, { def: 0.6, iq: 0.5, skt: 0.3 }, { min: 0.1 })),
      M('give60', 'Giveaways / 60', 'r2', false, 'TRK', 'Giveaways × 3600 / TOI', der(2.4, 0.6, { iq: -0.6, pm: 0.2, trn: 0.25 }, { min: 0.3 }))
    ] },
    { id: 'def', n: 'Defensive involvement', m: [
      M('blk60', 'Blocked shots / 60', 'r2', null, 'PBP', 'Blocks × 3600 / TOI', (c) => p60(c.a[S.BLK], c.toi)),
      M('hit60', 'Hits / 60', 'r2', null, 'PBP', 'Hits × 3600 / TOI', (c) => p60(c.a[S.HIT], c.toi)),
      M('tk60', 'Takeaways / 60', 'r2', true, 'TRK', 'Takeaways × 3600 / TOI', der(1.9, 0.55, { def: 0.6, iq: 0.5 }, { min: 0.2 })),
      M('entden', 'Entry denial %', 'pct', true, 'TRK', 'Opponent entries forced to dump / broken up', der(byPos(44, 52), 6, { def: 0.8, skt: 0.4 }, { min: 20, max: 80 })),
      M('ret60', 'Puck retrievals / 60', 'r2', true, 'TRK', 'Loose-puck recoveries × 3600 / TOI', der(byPos(9, 14), 2, { def: 0.4, skt: 0.5, phy: 0.3 }, { min: 2 })),
      M('hda60', 'On-ice HD chances against / 60', 'r2', false, 'PBP', 'HD attempts against × 3600 / 5v5 TOI', (c) => p60(c.a[S.HDA5], c.toi5)),
      M('pkxga60', 'PK xGA / 60', 'r2', false, 'PBP', 'On-ice xGA × 3600 / PK TOI (≥ 20 min PK)', (c) => (c.a[S.TOIPK] > 1200 ? p60(c.a[S.XGAPK], c.a[S.TOIPK]) : null)),
      M('relxga', 'Relative xGA / 60', 's2', false, 'PBP', 'On-ice xGA/60 − team off-ice xGA/60', (c) => c.rel.xga),
      M('pend60', 'Penalty differential / 60', 's2', true, 'PBP', '(Drawn − taken) × 3600 / TOI', (c) => p60(c.a[S.PDRAW] - c.a[S.PEN], c.toi)),
      M('dzerr60', 'Assignment errors / 60', 'r2', false, 'TRK', 'Coverage breakdowns leading to slot chances', der(0.9, 0.28, { def: -0.7, iq: -0.4 }, { min: 0.1 }))
    ] },
    { id: 'usage', n: 'Ice time & deployment', m: [
      M('toigp', 'TOI / GP', 'toi', null, 'PBP', 'All-situations TOI per game', (c) => rt(c.toi, c.gp)),
      M('toi5gp', '5v5 TOI / GP', 'toi', null, 'PBP', '5v5 TOI per game', (c) => rt(c.toi5, c.gp)),
      M('toippgp', 'PP TOI / GP', 'toi', null, 'PBP', 'Power-play TOI per game', (c) => rt(c.a[S.TOIPP], c.gp)),
      M('toipkgp', 'PK TOI / GP', 'toi', null, 'PBP', 'Penalty-kill TOI per game', (c) => rt(c.a[S.TOIPK], c.gp)),
      M('shgp', 'Shifts / GP', 'r1', null, 'PBP', 'Shifts per game', (c) => rt(c.a[S.SHIFTS], c.gp)),
      M('shlen', 'Avg shift length (s)', 'r1', null, 'PBP', 'TOI / shifts', (c) => rt(c.toi, c.a[S.SHIFTS])),
      M('ozs', 'Offensive-zone start %', 'pct', null, 'PBP', 'OZ faceoffs on ice / (OZ + DZ)', (c) => pc(c.a[S.OZFO], c.a[S.DZFO])),
      M('qoc', 'Quality of competition', 'r1', null, 'PBP', 'TOI-weighted opponent talent index (50 = avg)', (c) => (c.toi5 > 0 ? 50 + 25 * (c.a[S.QOC] / c.toi5) : null)),
      M('qot', 'Quality of teammates', 'r1', null, 'PBP', 'TOI-weighted teammate talent index (50 = avg)', (c) => (c.toi5 > 0 ? 50 + 25 * (c.a[S.QOT] / c.toi5) : null)),
      M('toish', 'Share of game time %', 'pct', null, 'PBP', 'TOI / (GP × 60:00)', (c) => rt(c.toi, c.gp * 3600, 100))
    ] },
    { id: 'impact', n: 'Impact, trends & uncertainty', m: [
      M('relxgf', 'Relative xGF%', 's1', true, 'PBP', 'On-ice xGF% − team off-ice xGF%', (c) => c.rel.xgf),
      M('relcf', 'Relative CF%', 's1', true, 'PBP', 'On-ice CF% − team off-ice CF%', (c) => c.rel.cf),
      M('gar', 'Goals above replacement', 's1', true, 'MDL', 'EV xG impact + finishing + PP + penalties vs replacement', (c) => c.gar),
      M('l10xgf', 'Last-10 xGF%', 'pct', true, 'PBP', 'On-ice 5v5 xGF%, last 10 GP', (c) => c.l10.xgf),
      M('l10p60', 'Last-10 points / 60', 'r2', true, 'PBP', 'Points × 3600 / TOI, last 10 GP', (c) => c.l10.p60),
      M('trend', 'xGF% trend (per 10 GP)', 's2', true, 'MDL', 'OLS slope of game xGF% × 10', (c) => c.trend),
      M('shreg', 'Finishing vs expected', 's1', null, 'PBP', 'Sh% − expected Fenwick Sh% (regression flag)', (c) => { const a = rt(c.a[S.G], c.a[S.SOG], 100), b = rt(c.a[S.IXG], c.a[S.IFF], 100); return a === null || b === null ? null : a - b; }),
      M('pdo', 'PDO', 'r1', null, 'PBP', 'On-ice Sh% + Sv% × 100, 5v5', (c) => { const a = rt(c.a[S.GF5], c.a[S.SF5], 100), b = sv(c.a[S.SA5], c.a[S.GA5]); return a === null || b === null ? null : a + b * 100; }),
      M('xgse', 'xGF% standard error', 'r2', false, 'MDL', '100·√(p(1−p)/n) on on-ice attempts — small sample flag', (c) => { const n = c.a[S.FF5] + c.a[S.FA5]; const p = pc(c.a[S.XGF5], c.a[S.XGA5]) / 100; return n > 0 ? 100 * Math.sqrt((p * (1 - p)) / n) * 2.2 : null; }),
      M('talxgf', 'Talent est. xGF% (shrunk)', 'pct', true, 'MDL', '(xGF + 10) / (xGF + xGA + 20) — Bayesian shrink to 50%', (c) => (100 * (c.a[S.XGF5] + 10)) / (c.a[S.XGF5] + c.a[S.XGA5] + 20))
    ] }
  ];

  // ===================================================================
  //  POSITIONAL MODULES — 3 × 10 each
  // ===================================================================
  const MODULES = {
    C: { n: 'Center', resp: 'Control play through the middle, create, support coverage, connect transitions.', g: [
      { n: 'Faceoffs & possession control', m: [
        M('fo', 'Overall faceoff win %', 'pct', true, 'PBP', 'FOW / (FOW + FOL)', (c) => pc(c.a[S.FOW], c.a[S.FOL])),
        M('foo', 'Offensive-zone FO %', 'pct', true, 'PBP', 'OZ FOW / OZ draws', (c) => pc(c.a[S.FOWO], c.a[S.FOLO])),
        M('fod', 'Defensive-zone FO %', 'pct', true, 'PBP', 'DZ FOW / DZ draws', (c) => pc(c.a[S.FOWD], c.a[S.FOLD])),
        M('fon', 'Neutral-zone FO %', 'pct', true, 'PBP', 'NZ FOW / NZ draws', (c) => pc(c.a[S.FOWN], c.a[S.FOLN])),
        M('fos', 'Strong-side FO %', 'pct', true, 'TRK', 'Draws on forehand side', der((c) => (pc(c.a[S.FOW], c.a[S.FOL]) || 50) + 1.5, 2.2, { fo: 0.6 }, { min: 30, max: 72 })),
        M('fow', 'Weak-side FO %', 'pct', true, 'TRK', 'Draws on backhand side', der((c) => (pc(c.a[S.FOW], c.a[S.FOL]) || 50) - 1.5, 2.2, { fo: 0.6 }, { min: 28, max: 70 })),
        M('foe', 'FO % vs elite centers', 'pct', true, 'PBP', 'Win % vs top-tier draw men', (c) => pc(c.a[S.FOWE], c.a[S.FOLE])),
        M('foret', 'Possession retained %', 'pct', true, 'TRK', 'Won draws with clean possession ≥ 3 s', der(78, 4.5, { fo: 0.5, iq: 0.4 }, { min: 55, max: 95 })),
        M('fo2s', 'Faceoff-to-shot %', 'pct', true, 'TRK', 'OZ wins producing an attempt within 10 s', der(19, 3.2, { fo: 0.4, pm: 0.4, vol: 0.3 }, { min: 5, max: 40 })),
        M('fo2c', 'Faceoff-to-clearance %', 'pct', true, 'TRK', 'DZ wins producing a clean exit', der(64, 6, { fo: 0.4, def: 0.5 }, { min: 35, max: 90 }))
      ] },
      { n: 'Offensive creation', m: [
        M('ca160', 'Primary assists / 60', 'r2', true, 'PBP', 'A1 × 3600 / TOI', (c) => p60(c.a[S.A1], c.toi)),
        M('cxa60', 'Expected primary assists / 60', 'r2', true, 'PBP', 'xA × 3600 / TOI', (c) => p60(c.a[S.XA], c.toi)),
        M('slot60', 'Slot pass creation / 60', 'r2', true, 'TRK', 'Completed passes into the slot', der(3.2, 0.9, { pm: 1, iq: 0.4 }, { min: 0.2 })),
        M('chdp60', 'High-danger passes / 60', 'r2', true, 'PBP', 'HD shot assists × 3600 / TOI', (c) => p60(c.a[S.HDSA], c.toi)),
        M('cyc60', 'Cycle chance creation / 60', 'r2', true, 'TRK', 'Cycle sequences ending in a chance', der(2.1, 0.6, { pm: 0.6, phy: 0.3, iq: 0.3 }, { min: 0.2 })),
        M('cep60', 'Controlled entries w/ possession / 60', 'r2', true, 'TRK', 'Possession entries', der(5.6, 1.6, { trn: 1, skt: 0.4 }, { min: 0.5 })),
        M('rxg60', 'Rush xG created / 60', 'r2', true, 'PBP', '(Rush ixG + rush xA) × 3600 / TOI', (c) => p60(c.a[S.RXG] + c.a[S.RXA], c.toi)),
        M('cls60', 'Center-lane attempts / 60', 'r2', true, 'PBP', 'Attempts from |y| < 10 ft × 3600 / TOI', (c) => p60(c.a[S.CLS], c.toi)),
        M('nfp60', 'Net-front pass completions / 60', 'r2', true, 'TRK', 'Completed passes to the crease area', der(1.5, 0.45, { pm: 0.5, phy: 0.3 }, { min: 0.1 })),
        M('hdg60', 'High-danger chance generation / 60', 'r2', true, 'PBP', '(HD shots + HD passes) × 3600 / TOI', (c) => p60(c.a[S.HD] + c.a[S.HDSA], c.toi))
      ] },
      { n: 'Two-way responsibility', m: [
        M('cslot', 'Opponent slot chances / 60', 'r2', false, 'PBP', 'On-ice HD attempts against × 3600 / 5v5 TOI', (c) => p60(c.a[S.HDA5], c.toi5)),
        M('dzrec', 'DZ recovery rate %', 'pct', true, 'TRK', 'Loose pucks won in own zone', der(52, 5, { def: 0.7, phy: 0.3 }, { min: 30, max: 75 })),
        M('oppc', 'Opp. center matchup xG / 60', 'r2', false, 'TRK', 'xG generated by matched opposing C', der(1.15, 0.15, { def: -0.8 }, { min: 0.6 })),
        M('bks', 'Breakout support success %', 'pct', true, 'TRK', 'Low-support plays leading to exits', der(71, 5, { trn: 0.5, iq: 0.5 }, { min: 45, max: 92 })),
        M('cdzto', 'DZ turnover rate / 60', 'r2', false, 'TRK', 'Own-zone giveaways', der(1.1, 0.3, { iq: -0.6, pm: -0.2 }, { min: 0.1 })),
        M('bchk', 'Backcheck recovery %', 'pct', true, 'TRK', 'Backchecks that recover / disrupt', der(45, 6, { skt: 0.6, def: 0.5 }, { min: 20, max: 75 })),
        M('nzi60', 'NZ interceptions / 60', 'r2', true, 'TRK', 'Pass interceptions in neutral zone', der(1.2, 0.35, { def: 0.5, iq: 0.5 }, { min: 0.1 })),
        M('cpk', 'PK xGA / 60', 'r2', false, 'PBP', 'On-ice PK xGA × 3600 / PK TOI', (c) => (c.a[S.TOIPK] > 1200 ? p60(c.a[S.XGAPK], c.a[S.TOIPK]) : null)),
        M('cerr', 'Assignment error rate / 60', 'r2', false, 'TRK', 'Missed coverage assignments', der(0.85, 0.25, { def: -0.7, iq: -0.5 }, { min: 0.05 })),
        M('qadj', 'QoC-adjusted impact', 's2', true, 'MDL', 'Rel xGF% + 4 × QoC (talent units)', (c) => (c.rel.xgf === null ? null : c.rel.xgf + 4 * (c.toi5 ? c.a[S.QOC] / c.toi5 : 0)))
      ] }
    ] },
    W: { n: 'Winger', resp: 'Create and finish chances, attack wide lanes, support transition, forecheck.', g: [
      { n: 'Goal scoring & finishing', m: [
        M('wixg', 'Individual xG / 60', 'r2', true, 'PBP', 'ixG × 3600 / TOI', (c) => p60(c.a[S.IXG], c.toi)),
        M('wsog', 'Shots on goal / 60', 'r2', true, 'PBP', 'SOG × 3600 / TOI', (c) => p60(c.a[S.SOG], c.toi)),
        M('whd', 'High-danger shots / 60', 'r2', true, 'PBP', 'HD unblocked attempts × 3600 / TOI', (c) => p60(c.a[S.HD], c.toi)),
        M('wslot', 'Slot shot frequency %', 'pct', true, 'PBP', 'HD attempts / unblocked attempts', (c) => rt(c.a[S.HD], c.a[S.IFF], 100)),
        M('wot', 'One-timer rate %', 'pct', true, 'PBP', 'One-timer attempts / unblocked attempts', (c) => rt(c.sh.ot, c.sh.ff, 100)),
        M('woff', 'Off-wing shot frequency %', 'pct', null, 'TRK', 'Attempts from the off-hand side', der((c) => (c.p.offWing ? 58 : 38), 6, { sht: 0.2 }, { min: 10, max: 85 })),
        M('wrush', 'Rush shooting %', 'pct', true, 'PBP', 'Rush goals / rush shots on goal', (c) => rt(c.sh.rushG, c.sh.rushS, 100)),
        M('wrebg', 'Rebound goals / 60', 'r2', true, 'PBP', 'Goals on rebound attempts × 3600 / TOI', (c) => p60(c.sh.rebG, c.toi)),
        M('wgax', 'Goals minus expected', 's1', true, 'PBP', 'G − ixG', (c) => c.a[S.G] - c.a[S.IXG]),
        M('wfin', 'Finishing talent estimate', 'r2', true, 'MDL', '(G + 8) / (ixG + 8) — shrunk finishing multiplier', (c) => (c.a[S.G] + 8) / (c.a[S.IXG] + 8))
      ] },
      { n: 'Offensive chance generation', m: [
        M('went', 'Controlled offensive entries / 60', 'r2', true, 'TRK', 'Possession entries', der(7.0, 1.8, { trn: 1, skt: 0.5 }, { min: 0.5 })),
        M('we2s', 'Entry-to-shot conversion %', 'pct', true, 'TRK', 'Entries producing an attempt', der(48, 6, { trn: 0.5, sht: 0.3, pm: 0.3 }, { min: 20, max: 75 })),
        M('wpsa', 'Primary shot assists / 60', 'r2', true, 'PBP', 'Shot assists × 3600 / TOI', (c) => p60(c.a[S.SA1], c.toi)),
        M('wxice', 'Cross-ice passing completion %', 'pct', true, 'TRK', 'Completed east-west passes', der(63, 6, { pm: 1 }, { min: 35, max: 88 })),
        M('wnft', 'Net-front touches / 60', 'r2', true, 'TRK', 'Puck touches within 10 ft of crease', der(3.0, 0.9, { phy: 0.6, sht: 0.3 }, { min: 0.3 })),
        M('wrc', 'Rebound chance creation / 60', 'r2', true, 'TRK', 'Shots generating a rebound', der(0.9, 0.3, { vol: 0.6, phy: 0.3 }, { min: 0.05 })),
        M('wcyc', 'Cycle play efficiency %', 'pct', true, 'TRK', 'Cycles retaining possession > 10 s', der(55, 6, { phy: 0.4, pm: 0.4 }, { min: 25, max: 85 })),
        M('wozr', 'Offensive puck recoveries / 60', 'r2', true, 'TRK', 'OZ loose-puck recoveries', der(4.2, 1.1, { phy: 0.5, def: 0.3, skt: 0.3 }, { min: 0.5 })),
        M('whdca', 'High-danger chance assists / 60', 'r2', true, 'PBP', 'HD shot assists × 3600 / TOI', (c) => p60(c.a[S.HDSA], c.toi)),
        M('wxgc', 'xG contribution / 60', 'r2', true, 'PBP', '(ixG + xA) × 3600 / TOI', (c) => p60(c.a[S.IXG] + c.a[S.XA], c.toi))
      ] },
      { n: 'Role & defensive activity', m: [
        M('wtop', 'Top-line TOI share %', 'pct', null, 'PBP', 'Player 5v5 TOI / team 5v5 TOI', (c) => rt(c.toi5, c.tacc[T.TOI5], 100)),
        M('wpps', 'Power-play shooting share %', 'pct', null, 'PBP', 'PP SOG / team PP SOG', (c) => rt(c.a[S.PPSOG], c.tacc[T.PPSF], 100)),
        M('wppot', 'PP one-timer attempts / 60', 'r2', true, 'PBP', 'PP one-timers × 3600 / PP TOI', (c) => p60(c.sh.ppot, c.a[S.TOIPP])),
        M('wess', 'Even-strength shot share %', 'pct', null, 'PBP', '5v5 SOG / team 5v5 SOG', (c) => rt(c.a[S.SOG5], c.tacc[T.SF5], 100)),
        M('wfcr', 'Forecheck puck recovery / 60', 'r2', true, 'TRK', 'Recoveries off forecheck pressure', der(2.6, 0.75, { phy: 0.5, skt: 0.5 }, { min: 0.2 })),
        M('wbb', 'Board battle success %', 'pct', true, 'TRK', 'Contested puck battles won', der(50, 5, { phy: 0.8, iq: 0.2 }, { min: 25, max: 75 })),
        M('wdze', 'DZ exit support %', 'pct', true, 'TRK', 'Wall plays leading to exits', der(68, 5, { iq: 0.5, trn: 0.4 }, { min: 40, max: 90 })),
        M('wbc', 'Backcheck contribution', 'r1', true, 'TRK', 'Backcheck disruptions per 60', der(2.0, 0.6, { skt: 0.6, def: 0.5 }, { min: 0.1 })),
        M('wpen', 'Penalties taken / 60', 'r2', false, 'PBP', 'Minors taken × 3600 / TOI', (c) => p60(c.a[S.PEN], c.toi)),
        M('wdrw', 'Penalties drawn / 60', 'r2', true, 'PBP', 'Penalties drawn × 3600 / TOI', (c) => p60(c.a[S.PDRAW], c.toi))
      ] }
    ] },
    OD: { n: 'Offensive defenseman', resp: 'Drive transition, create from the blue line, manage OZ possession, quarterback the PP.', g: [
      { n: 'Blue-line offensive generation', m: [
        M('oicf', 'Shot attempts / 60', 'r2', true, 'PBP', 'iCF × 3600 / TOI', (c) => p60(c.a[S.ICF], c.toi)),
        M('osog', 'Shots on goal / 60', 'r2', true, 'PBP', 'SOG × 3600 / TOI', (c) => p60(c.a[S.SOG], c.toi)),
        M('oixg', 'Individual xG / 60', 'r2', true, 'PBP', 'ixG × 3600 / TOI', (c) => p60(c.a[S.IXG], c.toi)),
        M('oa1', 'Primary assists / 60', 'r2', true, 'PBP', 'A1 × 3600 / TOI', (c) => p60(c.a[S.A1], c.toi)),
        M('osa', 'Shot assists / 60', 'r2', true, 'PBP', 'Shot assists × 3600 / TOI', (c) => p60(c.a[S.SA1], c.toi)),
        M('obl', 'Blue-line shot creation / 60', 'r2', true, 'PBP', '(iFF + shot assists) × 3600 / TOI', (c) => p60(c.a[S.IFF] + c.a[S.SA1], c.toi)),
        M('oot', 'One-timer opportunities / 60', 'r2', true, 'PBP', 'One-timer attempts × 3600 / TOI', (c) => p60(c.sh.ot, c.toi)),
        M('oreb', 'Point-shot rebound creation / 60', 'r2', true, 'TRK', 'Point shots creating rebounds', der(0.7, 0.22, { vol: 0.5, pm: 0.3 }, { min: 0.05 })),
        M('otq', 'Traffic-adjusted shot quality', 'r2', true, 'PBP', 'ixG per 100 unblocked attempts', (c) => rt(c.a[S.IXG], c.a[S.IFF], 100)),
        M('oppxg', 'PP xG contribution / 60', 'r2', true, 'PBP', 'On-ice PP xGF × 3600 / PP TOI', (c) => (c.a[S.TOIPP] > 600 ? p60(c.a[S.XGFPP], c.a[S.TOIPP]) : null))
      ] },
      { n: 'Transition & puck distribution', m: [
        M('ocex', 'Controlled zone exits / 60', 'r2', true, 'TRK', 'Possession exits', der(9.0, 2.1, { trn: 1, pm: 0.4 }, { min: 1 })),
        M('ocen', 'Controlled zone entries / 60', 'r2', true, 'TRK', 'Possession entries', der(3.8, 1.2, { trn: 1, skt: 0.5 }, { min: 0.3 })),
        M('oexp', 'Exit pass completion %', 'pct', true, 'TRK', 'Completed breakout passes', der(80, 4.5, { pm: 0.7, iq: 0.3 }, { min: 55, max: 96 })),
        M('ocar', 'Entry carry success %', 'pct', true, 'TRK', 'Carry-ins retaining possession', der(66, 6, { trn: 0.7, skt: 0.6 }, { min: 35, max: 92 })),
        M('ostr', 'Stretch-pass completions / 60', 'r2', true, 'TRK', 'Completed passes > 80 ft', der(1.3, 0.4, { pm: 0.6, iq: 0.4 }, { min: 0.05 })),
        M('obo', 'Breakout pass success %', 'pct', true, 'TRK', 'First-pass success under forecheck', der(76, 5, { pm: 0.6, iq: 0.4 }, { min: 50, max: 95 })),
        M('onzr', 'NZ possession retention %', 'pct', true, 'TRK', 'Regroups keeping possession', der(70, 5, { pm: 0.5, trn: 0.5 }, { min: 45, max: 92 })),
        M('oinv', 'Transition involvement %', 'pct', true, 'TRK', 'Share of team transitions touched', der(24, 4, { trn: 0.7, pm: 0.3 }, { min: 5, max: 45 })),
        M('oto', 'Transition turnover rate / 60', 'r2', false, 'TRK', 'Turnovers in transition', der(1.2, 0.35, { iq: -0.6, trn: 0.3 }, { min: 0.1 })),
        M('otxg', 'Expected transition value / 60', 'r2', true, 'PBP', '(Rush ixG + rush xA) × 3600 / TOI', (c) => p60(c.a[S.RXG] + c.a[S.RXA], c.toi))
      ] },
      { n: 'Defensive sustainability', m: [
        M('oxga', 'xGA / 60', 'r2', false, 'PBP', 'On-ice xGA × 3600 / 5v5 TOI', (c) => p60(c.a[S.XGA5], c.toi5)),
        M('ocea', 'Opp. controlled entries allowed / 60', 'r2', false, 'TRK', 'Entries allowed on own side', der(8.5, 1.6, { def: -0.6, skt: -0.4 }, { min: 2 })),
        M('ogap', 'Defensive gap control', 'r1', true, 'TRK', 'Gap score at the blue line (50 = avg)', der(50, 10, { def: 0.6, skt: 0.6 }, { min: 5, max: 95 })),
        M('oden', 'Zone entry denial %', 'pct', true, 'TRK', 'Entries denied / attempted on own side', der(50, 6, { def: 0.8, skt: 0.4 }, { min: 25, max: 80 })),
        M('oret', 'Puck retrieval success %', 'pct', true, 'TRK', 'Retrievals won', der(62, 5, { skt: 0.5, phy: 0.3, iq: 0.3 }, { min: 35, max: 85 })),
        M('odzt', 'DZ turnover rate / 60', 'r2', false, 'TRK', 'Own-zone giveaways', der(1.3, 0.35, { iq: -0.6, pm: -0.2 }, { min: 0.1 })),
        M('odze', 'DZ exit success %', 'pct', true, 'TRK', 'Exit attempts succeeding', der(74, 5, { trn: 0.6, iq: 0.4 }, { min: 45, max: 93 })),
        M('orush', 'Rush chances allowed / 60', 'r2', false, 'TRK', 'Odd-man & rush chances against', der(1.6, 0.4, { def: -0.6, skt: -0.4 }, { min: 0.2 })),
        M('opk', 'PK xGA / 60', 'r2', false, 'PBP', 'On-ice PK xGA × 3600 / PK TOI', (c) => (c.a[S.TOIPK] > 1200 ? p60(c.a[S.XGAPK], c.a[S.TOIPK]) : null)),
        M('oadj', 'Adjusted defensive impact', 's2', true, 'MDL', '−Rel xGA/60 + 0.3 × QoC', (c) => (c.rel.xga === null ? null : -c.rel.xga + 0.3 * (c.toi5 ? c.a[S.QOC] / c.toi5 : 0)))
      ] }
    ] },
    SD: { n: 'Shutdown defenseman', resp: 'Suppress high-danger chances, deny entries, win battles, move the puck out of danger.', g: [
      { n: 'Shot & chance suppression', m: [
        M('sxga', 'xGA / 60', 'r2', false, 'PBP', 'On-ice xGA × 3600 / 5v5 TOI', (c) => p60(c.a[S.XGA5], c.toi5)),
        M('shda', 'High-danger chances against / 60', 'r2', false, 'PBP', 'On-ice HD attempts against × 3600 / 5v5 TOI', (c) => p60(c.a[S.HDA5], c.toi5)),
        M('sslot', 'Slot shots allowed / 60', 'r2', false, 'TRK', 'Slot attempts with player as nearest D', der(3.4, 0.6, { def: -0.8, phy: -0.2 }, { min: 0.5 })),
        M('srush', 'Rush chances allowed / 60', 'r2', false, 'TRK', 'Rush chances against', der(1.5, 0.4, { def: -0.6, skt: -0.4 }, { min: 0.2 })),
        M('sosq', 'Opponent shot quality', 'r3', false, 'PBP', 'On-ice xGA / unblocked attempts against', (c) => rt(c.a[S.XGA5], c.a[S.FA5])),
        M('ssup', 'Shot suppression impact', 's2', false, 'PBP', 'On-ice CA/60 − team off-ice CA/60', (c) => c.rel.ca),
        M('sdzx', 'DZ xG suppression', 'r2', true, 'MDL', 'Model-estimated xGA prevented / 60', der(0, 0.18, { def: 1, blk: 0.3 })),
        M('sosa', 'Opponent attempt share %', 'pct', false, 'PBP', 'On-ice CA / (CF + CA)', (c) => pc(c.a[S.CA5], c.a[S.CF5])),
        M('snf', 'Net-front chance prevention %', 'pct', true, 'TRK', 'Net-front plays defended', der(58, 6, { def: 0.6, phy: 0.5 }, { min: 30, max: 85 })),
        M('stop', 'Top-line matchup xGA / 60', 'r2', false, 'TRK', 'xGA vs opponent top lines', der(2.9, 0.35, { def: -0.8 }, { min: 1.4 }))
      ] },
      { n: 'Defensive-zone execution', m: [
        M('sden', 'Controlled entry denial %', 'pct', true, 'TRK', 'Entries denied / attempted on own side', der(53, 6, { def: 0.8, skt: 0.4 }, { min: 25, max: 82 })),
        M('sebu', 'Entry break-ups / 60', 'r2', true, 'TRK', 'Entries broken up', der(2.3, 0.6, { def: 0.7, skt: 0.4 }, { min: 0.2 })),
        M('sgap', 'Gap control effectiveness', 'r1', true, 'TRK', 'Gap score (50 = avg)', der(50, 10, { def: 0.7, skt: 0.5 }, { min: 5, max: 95 })),
        M('sret', 'Puck retrieval rate / 60', 'r2', true, 'TRK', 'Retrievals × 3600 / TOI', der(14, 2.2, { skt: 0.5, phy: 0.4 }, { min: 3 })),
        M('sr2e', 'Retrieval-to-exit success %', 'pct', true, 'TRK', 'Retrievals leading to clean exits', der(58, 6, { iq: 0.5, trn: 0.4 }, { min: 30, max: 85 })),
        M('sbb', 'Board battle win %', 'pct', true, 'TRK', 'Contested battles won', der(52, 5, { phy: 0.8, def: 0.3 }, { min: 30, max: 78 })),
        M('sdzt', 'DZ turnover rate / 60', 'r2', false, 'TRK', 'Own-zone giveaways', der(1.2, 0.35, { iq: -0.6 }, { min: 0.1 })),
        M('sint', 'Slot pass interceptions / 60', 'r2', true, 'TRK', 'Slot passes intercepted', der(0.9, 0.28, { def: 0.6, iq: 0.4 }, { min: 0.05 })),
        M('sclr', 'Net-front clearance success %', 'pct', true, 'TRK', 'Crease pucks cleared', der(66, 6, { phy: 0.6, def: 0.4 }, { min: 35, max: 90 })),
        M('srbc', 'Rebound clearance rate %', 'pct', true, 'TRK', 'Rebounds cleared before a second shot', der(61, 6, { def: 0.6, blk: 0.3 }, { min: 30, max: 88 }))
      ] },
      { n: 'Physical & situational defense', m: [
        M('sblk', 'Blocked shots / 60', 'r2', null, 'PBP', 'Blocks × 3600 / TOI — opportunity-dependent', (c) => p60(c.a[S.BLK], c.toi)),
        M('shit', 'Hits / 60', 'r2', null, 'PBP', 'Hits × 3600 / TOI — opportunity-dependent', (c) => p60(c.a[S.HIT], c.toi)),
        M('spkt', 'Penalty-kill TOI / GP', 'toi', null, 'PBP', 'PK TOI per game', (c) => rt(c.a[S.TOIPK], c.gp)),
        M('spkx', 'Penalty-kill xGA / 60', 'r2', false, 'PBP', 'On-ice PK xGA × 3600 / PK TOI', (c) => (c.a[S.TOIPK] > 1200 ? p60(c.a[S.XGAPK], c.a[S.TOIPK]) : null)),
        M('sdzs', 'Defensive-zone start share %', 'pct', null, 'PBP', 'DZ faceoffs on ice / (OZ + DZ)', (c) => pc(c.a[S.DZFO], c.a[S.OZFO])),
        M('soqi', 'Opposition quality index', 'r1', null, 'PBP', 'QoC (50 = avg)', (c) => (c.toi5 > 0 ? 50 + 25 * (c.a[S.QOC] / c.toi5) : null)),
        M('slong', 'Long-shift defensive decline %', 'pct', false, 'TRK', 'xGA/60 increase after 50 s on ice', der(18, 6, { skt: -0.5, iq: -0.3 }, { min: 0, max: 50 })),
        M('spd', 'Penalty differential / 60', 's2', true, 'PBP', '(Drawn − taken) × 3600 / TOI', (c) => p60(c.a[S.PDRAW] - c.a[S.PEN], c.toi)),
        M('spair', 'Pairing-adjusted xGA / 60', 'r2', false, 'PBP', 'Pair on-ice xGA × 3600 / pair TOI', (c) => c.pairXga),
        M('sdar', 'Defensive impact above replacement', 's1', true, 'MDL', '(Replacement xGA/60 − xGA/60) × 5v5 hrs', (c) => { const x = p60(c.a[S.XGA5], c.toi5); return x === null ? null : (2.85 - x) * (c.toi5 / 3600); })
      ] }
    ] }
  };

  // ===================================================================
  //  GOALTENDER — 6 × 10
  // ===================================================================
  const GOALIE = [
    { id: 'trad', n: 'Traditional production', m: [
      M('ggp', 'Games played', 'int', null, 'PBP', 'Appearances', (c) => c.gp),
      M('ggs', 'Games started', 'int', null, 'PBP', 'Starts', (c) => c.gs),
      M('grec', 'Record (W-L-OTL)', 'rec', null, 'PBP', 'Decisions', (c) => `${c.rec.w}-${c.rec.l}-${c.rec.otl}`),
      M('gwin', 'Win %', 'pct', true, 'PBP', 'W / decisions', (c) => rt(c.rec.w, c.rec.w + c.rec.l + c.rec.otl, 100)),
      M('gsa', 'Shots against', 'int', null, 'PBP', 'Shots on goal faced', (c) => c.a[G.SA]),
      M('gsvs', 'Saves', 'int', null, 'PBP', 'SA − GA', (c) => c.a[G.SA] - c.a[G.GA]),
      M('gga', 'Goals against', 'int', false, 'PBP', 'Goals allowed', (c) => c.a[G.GA]),
      M('gsv', 'Save %', 'sv', true, 'PBP', '1 − GA / SA', (c) => sv(c.a[G.SA], c.a[G.GA])),
      M('ggaa', 'Goals-against average', 'r2', false, 'PBP', 'GA × 3600 / TOI', (c) => p60(c.a[G.GA], c.a[G.TOI])),
      M('gso', 'Shutouts', 'int', true, 'PBP', 'Wins with 0 GA', (c) => c.rec.so)
    ] },
    { id: 'xg', n: 'Expected goals & performance', m: [
      M('gxga', 'Expected goals against', 'r1', null, 'PBP', 'Σ xG of unblocked shots faced', (c) => c.a[G.XGA]),
      M('ggsax', 'Goals saved above expected', 's1', true, 'PBP', 'xGA − GA', (c) => c.a[G.XGA] - c.a[G.GA]),
      M('ggsax60', 'GSAx / 60', 's2', true, 'PBP', '(xGA − GA) × 3600 / TOI', (c) => p60(c.a[G.XGA] - c.a[G.GA], c.a[G.TOI])),
      M('ggsax100', 'GSAx / 100 shots', 's2', true, 'PBP', '(xGA − GA) × 100 / SA', (c) => rt(c.a[G.XGA] - c.a[G.GA], c.a[G.SA], 100)),
      M('ggsaxgp', 'GSAx / game', 's2', true, 'PBP', '(xGA − GA) / GP', (c) => rt(c.a[G.XGA] - c.a[G.GA], c.gp)),
      M('gamx', 'Goals allowed − xGA', 's1', false, 'PBP', 'GA − xGA', (c) => c.a[G.GA] - c.a[G.XGA]),
      M('gdsv', 'Delta save % (pts)', 's2', true, 'PBP', '(SV% − xSV%) × 100', (c) => (c.a[G.SA] ? ((c.a[G.XGA] - c.a[G.GA]) / c.a[G.SA]) * 100 : null)),
      M('gxsv', 'Expected save %', 'sv', null, 'PBP', '1 − xGA / SA', (c) => sv(c.a[G.SA], c.a[G.XGA])),
      M('ggsax5', '5v5 GSAx', 's1', true, 'PBP', '5v5 xGA − 5v5 GA', (c) => c.a[G.XGA5] - c.a[G.GA5]),
      M('ggsaxst', 'Special-teams GSAx', 's1', true, 'PBP', 'PK xGA − PK GA', (c) => c.a[G.XGAPK] - c.a[G.GAPK])
    ] },
    { id: 'danger', n: 'Shot-danger performance', m: [
      M('ghd', 'High-danger save %', 'sv', true, 'PBP', 'HD saves / HD SA', (c) => sv(c.a[G.SAHD], c.a[G.GAHD])),
      M('gmd', 'Medium-danger save %', 'sv', true, 'PBP', 'MD saves / MD SA', (c) => sv(c.a[G.SAMD], c.a[G.GAMD])),
      M('gld', 'Low-danger save %', 'sv', true, 'PBP', 'LD saves / LD SA', (c) => sv(c.a[G.SALD], c.a[G.GALD])),
      M('ghdx', 'High-danger GSAx', 's1', true, 'PBP', 'HD xGA − HD GA', (c) => c.a[G.XGAHD] - c.a[G.GAHD]),
      M('gmdx', 'Medium-danger GSAx', 's1', true, 'PBP', 'MD xGA − MD GA', (c) => c.a[G.XGAMD] - c.a[G.GAMD]),
      M('gldx', 'Low-danger GSAx', 's1', true, 'PBP', 'LD xGA − LD GA', (c) => c.a[G.XGALD] - c.a[G.GALD]),
      M('greb', 'Rebound-shot save %', 'sv', true, 'PBP', 'Saves on rebound attempts', (c) => sv(c.a[G.SAREB], c.a[G.GAREB])),
      M('grush', 'Rush-shot save %', 'sv', true, 'PBP', 'Saves on rush attempts', (c) => sv(c.a[G.SARUSH], c.a[G.GARUSH])),
      M('got', 'One-timer save %', 'sv', true, 'PBP', 'Saves on one-timers', (c) => sv(c.a[G.SAOT], c.a[G.GAOT])),
      M('gcs', 'Cross-slot shot save %', 'sv', true, 'PBP', 'Saves after cross-slot passes', (c) => sv(c.a[G.SACS], c.a[G.GACS]))
    ] },
    { id: 'tech', n: 'Technique & rebound control', m: [
      M('greba', 'Rebound rate %', 'pct', false, 'PBP', 'Rebound attempts allowed / saves', (c) => rt(c.a[G.REBA], c.a[G.SA] - c.a[G.GA], 100)),
      M('gfrz', 'Freeze %', 'pct', true, 'TRK', 'Saves frozen for a whistle', der(31, 4, { reb: 0.7, puck: -0.2 }, { min: 15, max: 50 })),
      M('ggl', 'Glove-side save %', 'sv', true, 'PBP', 'Saves on glove-side shots', (c) => sv(c.a[G.SAGL], c.a[G.GAGL])),
      M('gbl', 'Blocker-side save %', 'sv', true, 'PBP', 'Saves on blocker-side shots', (c) => sv(c.a[G.SABL], c.a[G.GABL])),
      M('ghi', 'High-shot save %', 'sv', true, 'PBP', 'Saves on shots > 2.2 ft', (c) => sv(c.a[G.SAHI], c.a[G.GAHI])),
      M('glo', 'Low-shot save %', 'sv', true, 'PBP', 'Saves on shots < 1 ft', (c) => sv(c.a[G.SALO], c.a[G.GALO])),
      M('g5h', 'Five-hole save %', 'sv', true, 'TRK', 'Charted five-hole attempts', der(0.935, 0.012, { stop: 0.6, lat: 0.3 }, { min: 0.85, max: 0.99 })),
      M('glat', 'Lateral movement success %', 'pct', true, 'TRK', 'Cross-crease pushes arriving set', der(72, 6, { lat: 1 }, { min: 40, max: 95 })),
      M('gpost', 'Post-integration score', 'r1', true, 'TRK', 'RVH / post seal grade (50 = avg)', der(50, 10, { lat: 0.5, hd: 0.5 }, { min: 5, max: 95 })),
      M('gpuck', 'Puck-handling plays / 60', 'r2', true, 'TRK', 'Successful stops/passes behind the net', der(2.2, 0.7, { puck: 1 }, { min: 0.1 }))
    ] },
    { id: 'work', n: 'Workload & situational', m: [
      M('gsa60', 'Shots against / 60', 'r1', null, 'PBP', 'SA × 3600 / TOI', (c) => p60(c.a[G.SA], c.a[G.TOI])),
      M('gxga60', 'xGA faced / 60', 'r2', null, 'PBP', 'xGA × 3600 / TOI — defense in front', (c) => p60(c.a[G.XGA], c.a[G.TOI])),
      M('gsv5', '5v5 save %', 'sv', true, 'PBP', '5v5 saves / 5v5 SA', (c) => sv(c.a[G.SA5], c.a[G.GA5])),
      M('gpksv', 'Penalty-kill save %', 'sv', true, 'PBP', 'PK saves / PK SA', (c) => sv(c.a[G.SAPK], c.a[G.GAPK])),
      M('gb2b', 'Back-to-back save %', 'sv', true, 'PBP', 'SV% on zero rest days', (c) => c.split.b2b),
      M('ghome', 'Home save %', 'sv', true, 'PBP', 'SV% at home', (c) => c.split.home),
      M('gaway', 'Road save %', 'sv', true, 'PBP', 'SV% on the road', (c) => c.split.away),
      M('gp3', 'Third-period save %', 'sv', true, 'PBP', 'SV% in P3', (c) => sv(c.a[G.SAP3], c.a[G.GAP3])),
      M('gtr', 'Save % when trailing', 'sv', true, 'PBP', 'SV% with own team behind', (c) => sv(c.a[G.SALE], c.a[G.GALE])),
      M('ghw', 'High-workload save %', 'sv', true, 'PBP', 'SV% in games facing 30+ shots', (c) => c.split.hw)
    ] },
    { id: 'cons', n: 'Consistency & predictive reliability', m: [
      M('gqs', 'Quality start %', 'pct', true, 'PBP', 'Starts with SV% ≥ .913 (or ≥ .885 on < 20 SA)', (c) => c.cons.qs),
      M('grbs', 'Really bad starts', 'int', false, 'PBP', 'Starts with SV% < .850', (c) => c.cons.rbs),
      M('gsd', 'GSAx volatility (σ / game)', 'r2', false, 'PBP', 'Std. dev. of per-game GSAx', (c) => c.cons.sd),
      M('gpos', 'Positive-GSAx game %', 'pct', true, 'PBP', 'Games with GSAx > 0', (c) => c.cons.pos),
      M('gl10', 'Last-10 save %', 'sv', true, 'PBP', 'Rolling 10-appearance SV%', (c) => c.cons.l10sv),
      M('gl10x', 'Last-10 GSAx', 's1', true, 'PBP', 'Rolling 10-appearance GSAx', (c) => c.cons.l10x),
      M('gtrend', 'GSAx trend (per 10 GP)', 's2', true, 'MDL', 'OLS slope of game GSAx × 10', (c) => c.cons.trend),
      M('gtal', 'Talent est. GSAx / 100 (shrunk)', 's2', true, 'MDL', '(xGA − GA) × 100 / (SA + 600) — hierarchical shrink', (c) => ((c.a[G.XGA] - c.a[G.GA]) * 100) / (c.a[G.SA] + 600)),
      M('gse', 'Talent std. error (GSAx / 100)', 'r2', false, 'MDL', 'Posterior SD of shot-stopping talent', (c) => 100 * Math.sqrt(0.09 * 0.91 / (c.a[G.SA] + 600))),
      M('gci', 'Consistency index', 'r1', true, 'MDL', '100 − 30 × GSAx σ (higher = steadier)', (c) => (c.cons.sd === null ? null : Math.max(0, 100 - 30 * c.cons.sd)))
    ] }
  ];

  // ===================================================================
  //  TEAM — 20 × 10
  // ===================================================================
  const tg = (k) => (c) => rt(c.t[T[k]], c.gp);
  const t60 = (k, toiK) => (c) => p60(c.t[T[k]], c.t[T[toiK || 'TOI5']]);
  const tAll60 = (k) => (c) => p60(c.t[T[k]], c.gp * 3600);
  const tder = (mean, sd, w, o) => der(mean, sd, w, o);
  const ln = (i, f) => (c) => f(c.lines.L, i);
  const lnXgf = (arr, i) => pc(arr[i * NL + 3], arr[i * NL + 4]);
  const lnXgf60 = (arr, i) => p60(arr[i * NL + 3], arr[i * NL]);
  const lnXga60 = (arr, i) => p60(arr[i * NL + 4], arr[i * NL]);

  const TEAM = [
    { id: 't1', n: 'Overall team strength', pri: 'Opponent-adjusted expected goal differential', m: [
      M('tgf', 'Goals for / game', 'r2', true, 'PBP', 'GF / GP', tg('GF')),
      M('tga', 'Goals against / game', 'r2', false, 'PBP', 'GA / GP', tg('GA')),
      M('tgd', 'Goal differential / game', 's2', true, 'PBP', '(GF − GA) / GP', (c) => rt(c.t[T.GF] - c.t[T.GA], c.gp)),
      M('txgf', '5v5 xGF%', 'pct', true, 'PBP', 'xGF / (xGF + xGA), 5v5', (c) => pc(c.t[T.XGF5], c.t[T.XGA5])),
      M('txgd60', '5v5 xG differential / 60', 's2', true, 'PBP', '(xGF − xGA) × 3600 / 5v5 TOI', (c) => p60(c.t[T.XGF5] - c.t[T.XGA5], c.t[T.TOI5])),
      M('tcf', 'Score-adjusted CF%', 'pct', true, 'MDL', 'CF% with score-state weighting (tied ×1, leading ×1.06, trailing ×0.94)', (c) => pc(c.t[T.TCF] + 1.06 * c.t[T.LCF] + 0.94 * c.t[T.BCF], c.t[T.TCA] + 0.94 * c.t[T.LCA] + 1.06 * c.t[T.BCA])),
      M('tff', 'Score-adjusted FF%', 'pct', true, 'MDL', 'FF% with score-state weighting', (c) => { const x = pc(c.t[T.FF5], c.t[T.FA5]); return x === null ? null : x + 0.25 * noise(c.id, 'tff', 3000); }),
      M('tgax', 'Goals above expected', 's1', true, 'PBP', 'GF − xGF (all situations)', (c) => c.t[T.GF] - c.t[T.XGF]),
      M('trtg', 'Opponent-adjusted rating', 's2', true, 'MDL', 'Ridge rating: xG diff/60 + SOS + ST + goalie (goals/game)', (c) => c.rating),
      M('txpts', 'Expected standings points', 'r1', true, 'MDL', 'Σ game-level P(W)·2 + P(OTL) from xG (Poisson)', (c) => c.xpts)
    ] },
    { id: 't2', n: 'Five-on-five offense', pri: '5v5 xGF / 60', m: [
      M('tg5', '5v5 goals / 60', 'r2', true, 'PBP', '5v5 GF × 3600 / 5v5 TOI', t60('GF5')),
      M('txgf60', '5v5 xGF / 60', 'r2', true, 'PBP', '5v5 xGF × 3600 / 5v5 TOI', t60('XGF5')),
      M('ts5', '5v5 shots / 60', 'r1', true, 'PBP', '5v5 SF × 3600 / 5v5 TOI', t60('SF5')),
      M('tc5', '5v5 attempts / 60', 'r1', true, 'PBP', '5v5 CF × 3600 / 5v5 TOI', t60('CF5')),
      M('thd5', '5v5 high-danger chances / 60', 'r2', true, 'PBP', '5v5 HDCF × 3600 / 5v5 TOI', t60('HDF5')),
      M('tq5', '5v5 shot quality', 'r3', true, 'PBP', '5v5 xGF / FF', (c) => rt(c.t[T.XGF5], c.t[T.FF5])),
      M('tr5', 'Rush xGF / 60', 'r2', true, 'PBP', 'Rush xGF × 3600 / TOI (all)', tAll60('RXGF')),
      M('trb5', 'Rebound xGF / 60', 'r2', true, 'PBP', 'Rebound xGF × 3600 / TOI (all)', tAll60('RBXGF')),
      M('tsh5', '5v5 shooting %', 'pct', null, 'PBP', '5v5 GF / SF', (c) => rt(c.t[T.GF5], c.t[T.SF5], 100)),
      M('tcv5', '5v5 chance conversion %', 'pct', true, 'PBP', '5v5 GF / 5v5 xGF', (c) => rt(c.t[T.GF5], c.t[T.XGF5], 100))
    ] },
    { id: 't3', n: 'Five-on-five defense', pri: '5v5 xGA / 60', m: [
      M('tga5', '5v5 goals allowed / 60', 'r2', false, 'PBP', '5v5 GA × 3600 / 5v5 TOI', t60('GA5')),
      M('txga60', '5v5 xGA / 60', 'r2', false, 'PBP', '5v5 xGA × 3600 / 5v5 TOI', t60('XGA5')),
      M('tsa5', '5v5 shots against / 60', 'r1', false, 'PBP', '5v5 SA × 3600 / 5v5 TOI', t60('SA5')),
      M('tca5', '5v5 attempts against / 60', 'r1', false, 'PBP', '5v5 CA × 3600 / 5v5 TOI', t60('CA5')),
      M('thda5', 'High-danger chances against / 60', 'r2', false, 'PBP', '5v5 HDCA × 3600 / 5v5 TOI', t60('HDA5')),
      M('trxa', 'Rush xGA / 60', 'r2', false, 'PBP', 'Rush xGA × 3600 / TOI (all)', tAll60('RXGA')),
      M('trbxa', 'Rebound xGA / 60', 'r2', false, 'PBP', 'Rebound xGA × 3600 / TOI (all)', tAll60('RBXGA')),
      M('tslot', 'Slot chances allowed / 60', 'r2', false, 'PBP', 'HD attempts against × 3600 / TOI (all)', tAll60('SLOTA')),
      M('toq', 'Opponent shot quality', 'r3', false, 'PBP', '5v5 xGA / FA', (c) => rt(c.t[T.XGA5], c.t[T.FA5])),
      M('tdsup', 'Adjusted xGA suppression', 's2', true, 'MDL', 'League 5v5 xGA/60 − team (opp-adjusted)', (c) => c.lg.xga60 - (p60(c.t[T.XGA5], c.t[T.TOI5]) || 0) - 0.2 * c.sosAdj)
    ] },
    { id: 't4', n: 'Shot generation & location', pri: 'Expected goals per attempt', m: [
      M('txpa', 'xG per attempt', 'r3', true, 'PBP', 'xGF / CF (all)', (c) => rt(c.t[T.XGF], c.t[T.CF])),
      M('tslotsh', 'Slot shot share %', 'pct', true, 'PBP', 'HD attempts / unblocked attempts', (c) => rt(c.t[T.HDF], c.t[T.FF], 100)),
      M('tmd', '5v5 medium-danger share %', 'pct', null, 'PBP', 'MD / (HD + MD + LD), 5v5', (c) => rt(c.t[T.MD5F], c.t[T.HDF5] + c.t[T.MD5F] + c.t[T.LD5F], 100)),
      M('tpt', 'Point-shot share %', 'pct', null, 'PBP', 'Defense attempts / unblocked attempts', (c) => rt(c.t[T.PTF], c.t[T.FF], 100)),
      M('tdist', 'Avg shot distance (ft)', 'r1', false, 'PBP', 'Mean distance of unblocked attempts', (c) => rt(c.t[T.DISTF], c.t[T.FF])),
      M('treb', 'Rebound attempt share %', 'pct', true, 'PBP', 'Rebound attempts / unblocked attempts', (c) => rt(c.t[T.REBF], c.t[T.FF], 100)),
      M('tot', 'One-timer rate %', 'pct', true, 'PBP', 'One-timers / unblocked attempts', (c) => rt(c.t[T.OTF], c.t[T.FF], 100)),
      M('tcs', 'Cross-slot rate %', 'pct', true, 'PBP', 'Cross-slot attempts / unblocked attempts', (c) => rt(c.t[T.CSF], c.t[T.FF], 100)),
      M('tnet', 'Shots on-net %', 'pct', true, 'PBP', 'SOG / unblocked attempts', (c) => rt(c.t[T.SF], c.t[T.FF], 100)),
      M('tcy', 'Cycle xGF / 60', 'r2', true, 'PBP', 'Non-rush, non-rebound xGF × 3600 / TOI', tAll60('CYXGF'))
    ] },
    { id: 't5', n: 'Shot suppression & blocking', pri: 'Opponent shot quality', m: [
      M('toq2', 'Opponent xG / attempt', 'r3', false, 'PBP', 'xGA / CA (all)', (c) => rt(c.t[T.XGA], c.t[T.CA])),
      M('tblk60', 'Blocks / 60', 'r1', null, 'PBP', 'Blocks × 3600 / TOI (all)', tAll60('BLK')),
      M('tblkp', 'Block % of attempts against', 'pct', true, 'PBP', 'Blocks / CA', (c) => rt(c.t[T.BLK], c.t[T.CA], 100)),
      M('thda', 'HD attempts against / 60', 'r2', false, 'PBP', 'HD attempts against × 3600 / TOI (all)', tAll60('HDA')),
      M('toslot', 'Opponent slot share %', 'pct', false, 'PBP', 'Opp HD / opp unblocked', (c) => rt(c.t[T.HDA], c.t[T.FA], 100)),
      M('todist', 'Opp. avg shot distance (ft)', 'r1', true, 'PBP', 'Mean distance of unblocked attempts against', (c) => rt(c.t[T.DISTA], c.t[T.FA])),
      M('tonet', 'Opp. shots on-net %', 'pct', false, 'PBP', 'SA / FA', (c) => rt(c.t[T.SA], c.t[T.FA], 100)),
      M('toreb', 'Opp. rebound share %', 'pct', false, 'PBP', 'Rebound attempts against / FA', (c) => rt(c.t[T.REBA], c.t[T.FA], 100)),
      M('torush', 'Opp. rush xG share %', 'pct', false, 'PBP', 'Rush xGA / xGA', (c) => rt(c.t[T.RXGA], c.t[T.XGA], 100)),
      M('tsa60', 'Shots against / 60 (all)', 'r1', false, 'PBP', 'SA × 3600 / TOI', tAll60('SA'))
    ] },
    { id: 't6', n: 'Power-play offense', pri: 'PP xG / 2 minutes', m: [
      M('tpp', 'Power-play conversion %', 'pct', true, 'PBP', 'PPG / PP opportunities', (c) => rt(c.t[T.PPGF], c.t[T.PPO], 100)),
      M('tppg60', 'PP goals / 60', 'r2', true, 'PBP', 'PPG × 3600 / PP TOI', t60('PPGF', 'PPTOI')),
      M('tppx60', 'PP xG / 60', 'r2', true, 'PBP', 'PP xGF × 3600 / PP TOI', t60('PPXGF', 'PPTOI')),
      M('tpps60', 'PP shots / 60', 'r1', true, 'PBP', 'PP SF × 3600 / PP TOI', t60('PPSF', 'PPTOI')),
      M('tppent', 'PP zone entry success %', 'pct', true, 'TRK', 'PP entries gaining set-up', tder(78, 5, { pp: 1, r_trn: 0.5 }, { min: 55, max: 95 })),
      M('tppce', 'PP controlled entry %', 'pct', true, 'TRK', 'Possession entries on PP', tder(62, 6, { pp: 0.8, r_trn: 0.6 }, { min: 35, max: 88 })),
      M('tppzt', 'PP zone-time share %', 'pct', true, 'TRK', 'Share of PP time in OZ', tder(68, 4, { pp: 1, r_pm: 0.4 }, { min: 50, max: 85 })),
      M('tppsp', 'PP slot-pass rate / 2 min', 'r2', true, 'PBP', 'PP cross-slot attempts per 2 PP min', (c) => p60(c.t[T.CSF] * 0.35, c.t[T.PPTOI] * 30)),
      M('tppot', 'PP one-timer frequency / 2 min', 'r2', true, 'PBP', 'PP one-timer attempts per 2 PP min', (c) => p60(c.t[T.OTF] * 0.4, c.t[T.PPTOI] * 30)),
      M('tppto', 'PP turnover rate / 2 min', 'r2', false, 'TRK', 'Giveaways per 2 PP min', tder(0.55, 0.12, { pp: -0.7, r_pm: -0.3 }, { min: 0.1 }))
    ] },
    { id: 't7', n: 'Penalty-kill defense', pri: 'PK xGA / 2 minutes', m: [
      M('tpk', 'Penalty-kill success %', 'pct', true, 'PBP', '1 − PPGA / times shorthanded', (c) => (c.t[T.TSH] ? 100 * (1 - c.t[T.PKGA] / c.t[T.TSH]) : null)),
      M('tpkga60', 'PK goals against / 60', 'r2', false, 'PBP', 'PK GA × 3600 / PK TOI', t60('PKGA', 'PKTOI')),
      M('tpkx60', 'PK xGA / 60', 'r2', false, 'PBP', 'PK xGA × 3600 / PK TOI', t60('PKXGA', 'PKTOI')),
      M('tpks60', 'PK shots against / 60', 'r1', false, 'PBP', 'PK SA × 3600 / PK TOI', t60('PKSA', 'PKTOI')),
      M('tpkden', 'PK controlled-entry denial %', 'pct', true, 'TRK', 'PP entries denied', tder(38, 6, { pk: 1, r_def: 0.5 }, { min: 15, max: 65 })),
      M('tpkclr', 'PK zone-clear success %', 'pct', true, 'TRK', 'Clear attempts succeeding', tder(62, 5, { pk: 0.8, r_def: 0.4 }, { min: 40, max: 85 })),
      M('tpksup', 'PK shot suppression', 's2', true, 'PBP', 'League PK CA/60 − team PK CA/60', (c) => c.lg.pkca60 - (p60(c.t[T.PKCA], c.t[T.PKTOI]) || 0)),
      M('tpkhd', 'PK HD chance suppression', 'r2', true, 'TRK', 'HD chances prevented per 2 min vs avg', tder(0, 0.25, { pk: 1, r_def: 0.4 })),
      M('tshg60', 'Shorthanded goals / 60', 'r2', true, 'PBP', 'SHG × 3600 / PK TOI', t60('SHGF', 'PKTOI')),
      M('tpkreb', 'PK rebound suppression %', 'pct', true, 'TRK', 'Rebounds cleared on PK', tder(64, 6, { pk: 0.7, r_def: 0.5 }, { min: 35, max: 90 }))
    ] },
    { id: 't8', n: 'Transitions & zone entries', pri: 'Transition xG created vs allowed', m: [
      M('ttrxd', 'Transition xG differential / 60', 's2', true, 'PBP', '(Rush xGF − rush xGA) × 3600 / TOI', (c) => p60(c.t[T.RXGF] - c.t[T.RXGA], c.gp * 3600)),
      M('tcent', 'Controlled entry %', 'pct', true, 'TRK', 'Possession entries / all entries', tder(47, 5, { r_trn: 1, r_skt: 0.4 }, { min: 30, max: 70 })),
      M('tent60', 'Zone entries / 60', 'r1', true, 'TRK', 'All OZ entries × 3600 / 5v5 TOI', tder(62, 5, { r_trn: 0.6, pace: 3 }, { min: 40 })),
      M('trshare', 'Rush shot share %', 'pct', null, 'PBP', 'Rush xGF / xGF', (c) => rt(c.t[T.RXGF], c.t[T.XGF], 100)),
      M('te2s', 'Entry-to-shot conversion %', 'pct', true, 'TRK', 'Entries producing an attempt', tder(46, 4, { r_trn: 0.5, off: 2 }, { min: 30, max: 65 })),
      M('tnzto', 'NZ turnovers / 60', 'r2', false, 'TRK', 'Neutral-zone giveaways', tder(6.5, 1.2, { r_trn: -0.5, exitq: -0.5 }, { min: 2 })),
      M('tcarry', 'Carry-in success %', 'pct', true, 'TRK', 'Carry-ins retaining possession', tder(64, 5, { r_trn: 0.7, r_skt: 0.5 }, { min: 40, max: 85 })),
      M('tdump', 'Dump-in recovery %', 'pct', true, 'TRK', 'Dump-ins recovered', tder(36, 5, { fore: 0.6, r_phy: 0.4 }, { min: 15, max: 60 })),
      M('trxf', 'Rush xGF / 60', 'r2', true, 'PBP', 'Rush xGF × 3600 / TOI', tAll60('RXGF')),
      M('trxa2', 'Rush xGA / 60', 'r2', false, 'PBP', 'Rush xGA × 3600 / TOI', tAll60('RXGA'))
    ] },
    { id: 't9', n: 'Breakouts & zone exits', pri: 'Controlled exit success', m: [
      M('tcex', 'Controlled exit success %', 'pct', true, 'TRK', 'Possession exits / attempts', tder(58, 5, { exitq: 0.7, r_pm: 0.4 }, { min: 35, max: 80 })),
      M('tex60', 'Zone exits / 60', 'r1', true, 'TRK', 'Exits × 3600 / 5v5 TOI', tder(58, 4, { exitq: 0.5, r_trn: 0.5 }, { min: 40 })),
      M('texp', 'Exit pass completion %', 'pct', true, 'TRK', 'Breakout passes completed', tder(77, 3.5, { exitq: 0.6, r_pm: 0.5 }, { min: 60, max: 92 })),
      M('tdzto', 'DZ turnovers / 60', 'r2', false, 'TRK', 'Own-zone giveaways', tder(4.2, 0.8, { exitq: -0.7, r_iq: -0.3 }, { min: 1 })),
      M('tfex', 'Failed exits / 60', 'r2', false, 'TRK', 'Exit attempts lost', tder(9.5, 1.5, { exitq: -0.7 }, { min: 3 })),
      M('tstr', 'Stretch-pass rate %', 'pct', null, 'TRK', 'Exits via long pass', tder(12, 3, { r_pm: 0.5, exitq: 0.3 }, { min: 2, max: 30 })),
      M('tb2r', 'Breakout-to-rush rate %', 'pct', true, 'TRK', 'Exits leading to a rush attempt', tder(17, 3, { r_trn: 0.6, exitq: 0.4 }, { min: 5, max: 35 })),
      M('tretr', 'Retrieval success %', 'pct', true, 'TRK', 'D-zone retrievals won', tder(61, 4, { r_skt: 0.5, r_phy: 0.4 }, { min: 40, max: 80 })),
      M('tice', 'Icings / 60', 'r2', false, 'TRK', 'Icings × 3600 / TOI', tder(4.8, 0.9, { exitq: -0.6 }, { min: 1.5 })),
      M('tdtd', 'D-to-D breakout share %', 'pct', null, 'TRK', 'Exits starting with D-to-D pass', tder(28, 5, { struct: 0.5 }, { min: 10, max: 50 }))
    ] },
    { id: 't10', n: 'Forechecking & puck recovery', pri: 'Forecheck-to-chance conversion', m: [
      M('tfc', 'Forecheck-to-chance %', 'pct', true, 'TRK', 'Forecheck recoveries producing a chance', tder(22, 3.5, { fore: 0.7, r_phy: 0.3 }, { min: 8, max: 40 })),
      M('tozr', 'OZ recoveries / 60', 'r1', true, 'TRK', 'OZ loose-puck recoveries', tder(24, 3, { fore: 0.6, r_skt: 0.4 }, { min: 10 })),
      M('tfpi', 'Forecheck pressure index', 'r1', true, 'TRK', 'F1/F2 pressure rate (50 = avg)', tder(50, 10, { fore: 1 }, { min: 5, max: 95 })),
      M('thit60', 'Hits / 60', 'r1', null, 'PBP', 'Hits × 3600 / TOI', tAll60('HIT')),
      M('ttk60', 'Takeaways / 60', 'r1', true, 'TRK', 'Takeaways × 3600 / TOI', tder(7.5, 1.2, { r_def: 0.5, fore: 0.4 }, { min: 3 })),
      M('tozt', 'OZ time share %', 'pct', true, 'MDL', 'Share of 5v5 time in OZ (from shot share)', (c) => { const x = pc(c.t[T.CF5], c.t[T.CA5]); return x === null ? null : 50 + 0.8 * (x - 50); }),
      M('tcyx', 'Cycle xGF / 60', 'r2', true, 'PBP', 'Cycle xGF × 3600 / TOI', tAll60('CYXGF')),
      M('tf1', 'F1 pressure success %', 'pct', true, 'TRK', 'First-forechecker disruptions', tder(41, 5, { fore: 0.7, r_skt: 0.3 }, { min: 20, max: 65 })),
      M('tdrw', 'Penalties drawn / 60 (forecheck)', 'r2', true, 'PBP', 'Opp. penalties × 3600 / TOI', (c) => p60(c.t[T.PPO], c.gp * 3600)),
      M('tozfo', 'OZ faceoff share %', 'pct', true, 'PBP', 'OZ draws / (OZ + DZ)', (c) => pc(c.t[T.OZFO], c.t[T.DZFO]))
    ] },
    { id: 't11', n: 'Defensive zone structure', pri: 'Slot chance suppression', m: [
      M('tsls', 'Slot chance suppression', 's2', true, 'PBP', 'League HD against/60 − team', (c) => c.lg.hda60 - (p60(c.t[T.HDA], c.gp * 3600) || 0)),
      M('tnfx', 'Net-front xGA / 60', 'r2', false, 'PBP', 'Rebound + HD xGA proxy / 60', (c) => p60(c.t[T.RBXGA] + c.t[T.HDA] * 0.12, c.gp * 3600)),
      M('tocs', 'Opp. cross-slot rate %', 'pct', false, 'PBP', 'Cross-slot attempts against / FA', (c) => rt(c.t[T.CSAG], c.t[T.FA], 100)),
      M('tdzx', 'DZ exits / 60', 'r1', true, 'TRK', 'Successful exits', tder(34, 3, { exitq: 0.6, struct: 0.4 }, { min: 20 })),
      M('torx', 'Opp. rebound xGA / 60', 'r2', false, 'PBP', 'Rebound xGA × 3600 / TOI', tAll60('RBXGA')),
      M('tdzfo', 'DZ faceoff win %', 'pct', true, 'PBP', 'DZ FOW / DZ draws', (c) => pc(c.t[T.FOWD], c.t[T.FOLD])),
      M('tcov', 'Coverage breakdowns / 60', 'r2', false, 'TRK', 'Charted coverage errors', tder(5.2, 0.9, { struct: -0.7, r_def: -0.4 }, { min: 1.5 })),
      M('tslx', 'Slot xGA / 60', 'r2', false, 'PBP', 'HD attempts against × 0.17 × 3600 / TOI', (c) => p60(c.t[T.HDA] * 0.17, c.gp * 3600)),
      M('tosd', 'Opp. shot distance (ft)', 'r1', true, 'PBP', 'Mean distance against', (c) => rt(c.t[T.DISTA], c.t[T.FA])),
      M('tdzt', 'DZ time share %', 'pct', false, 'MDL', 'Share of 5v5 time in DZ', (c) => { const x = pc(c.t[T.CA5], c.t[T.CF5]); return x === null ? null : 50 + 0.8 * (x - 50); })
    ] },
    { id: 't12', n: 'Physicality & penalties', pri: 'Net penalty value', m: [
      M('tpim', 'PIM / game', 'r2', false, 'PBP', 'Penalty minutes / GP', tg('PIM')),
      M('tpen60', 'Penalties taken / 60', 'r2', false, 'PBP', 'Penalties × 3600 / TOI', (c) => p60(c.t[T.PEN], c.gp * 3600)),
      M('tdrw60', 'Penalties drawn / 60', 'r2', true, 'PBP', 'PP opportunities × 3600 / TOI', (c) => p60(c.t[T.PPO], c.gp * 3600)),
      M('tnpd', 'Net penalty differential', 's1', true, 'PBP', 'Drawn − taken', (c) => c.t[T.PPO] - c.t[T.PEN]),
      M('thitf', 'Hits / game', 'r1', null, 'PBP', 'Hits / GP', tg('HIT')),
      M('thitt', 'Hits taken / game', 'r1', null, 'PBP', 'Hits absorbed / GP', tg('HITT')),
      M('tmaj', 'Major penalties', 'int', false, 'PBP', 'Five-minute majors', (c) => c.t[T.MAJ]),
      M('tstick', 'Stick-infraction share %', 'pct', false, 'TRK', 'Hooking/slashing/tripping share', tder(46, 6, { disc: -3, r_def: -0.3 }, { min: 20, max: 70 })),
      M('tnpv', 'Net penalty value (goals)', 's2', true, 'MDL', '(Drawn − taken) × PP xG per opportunity', (c) => (c.t[T.PPO] - c.t[T.PEN]) * 0.19),
      M('tdisc', 'Discipline index', 'r1', true, 'MDL', '50 − 12 × z(penalties/60)', (c) => 50 - 12 * (((p60(c.t[T.PEN], c.gp * 3600) || 0) - c.lg.pen60) / 0.6))
    ] },
    { id: 't13', n: 'Goaltending as a unit', pri: 'Team goaltending GSAx', m: [
      M('tsv', 'Team save %', 'sv', true, 'PBP', '1 − GA / SA (all)', (c) => sv(c.t[T.SA], c.t[T.GA] - c.t[T.ENGA])),
      M('tsv5', '5v5 save %', 'sv', true, 'PBP', '1 − GA5 / SA5', (c) => sv(c.t[T.SA5], c.t[T.GA5])),
      M('tgsax', 'Team GSAx', 's1', true, 'PBP', 'Σ goalie (xGA − GA)', (c) => c.gu.gsax),
      M('tgsax60', 'GSAx / 60', 's2', true, 'PBP', 'GSAx × 3600 / goalie TOI', (c) => p60(c.gu.gsax, c.gu.toi)),
      M('thdsv', 'High-danger save %', 'sv', true, 'PBP', 'HD saves / HD SA', (c) => sv(c.gu.hdsa, c.gu.hdga)),
      M('tstsh', 'Starter share %', 'pct', null, 'PBP', 'Starts by G1 / GP', (c) => rt(c.gu.g1gs, c.gp, 100)),
      M('tg1x', 'Starter GSAx', 's1', true, 'PBP', 'G1 xGA − GA', (c) => c.gu.g1x),
      M('tg2x', 'Backup GSAx', 's1', true, 'PBP', 'G2 xGA − GA', (c) => c.gu.g2x),
      M('tqs', 'Quality start %', 'pct', true, 'PBP', 'Team quality starts / GP', (c) => c.gu.qs),
      M('trebr', 'Rebound rate %', 'pct', false, 'PBP', 'Rebounds allowed / saves', (c) => c.gu.reb)
    ] },
    { id: 't14', n: 'Forward line chemistry', pri: 'Adjusted line xG impact', m: [
      M('tl1', 'L1 xGF%', 'pct', true, 'PBP', 'Line 1 on-ice 5v5 xGF%', ln(0, lnXgf)),
      M('tl2', 'L2 xGF%', 'pct', true, 'PBP', 'Line 2 on-ice 5v5 xGF%', ln(1, lnXgf)),
      M('tl3', 'L3 xGF%', 'pct', true, 'PBP', 'Line 3 on-ice 5v5 xGF%', ln(2, lnXgf)),
      M('tl4', 'L4 xGF%', 'pct', true, 'PBP', 'Line 4 on-ice 5v5 xGF%', ln(3, lnXgf)),
      M('tt6', 'Top-6 xGF / 60', 'r2', true, 'PBP', 'L1 + L2 xGF × 3600 / TOI', (c) => p60(c.lines.L[3] + c.lines.L[NL + 3], c.lines.L[0] + c.lines.L[NL])),
      M('tb6', 'Bottom-6 xGA / 60', 'r2', false, 'PBP', 'L3 + L4 xGA × 3600 / TOI', (c) => p60(c.lines.L[2 * NL + 4] + c.lines.L[3 * NL + 4], c.lines.L[2 * NL] + c.lines.L[3 * NL])),
      M('tlstab', 'Line stability %', 'pct', true, 'TRK', 'Share of 5v5 TOI with standard lines', tder(78, 6, { struct: 0.6 }, { min: 50, max: 96 })),
      M('tchem', 'Avg chemistry effect (xGF%)', 's2', true, 'MDL', 'Regularised interaction effect, TOI-weighted', (c) => c.chem.f),
      M('tdepth', 'Depth scoring share %', 'pct', true, 'PBP', 'Goals by L3/L4 forwards / forward goals', (c) => c.depth),
      M('tbest', 'Best line adjusted impact', 's2', true, 'MDL', 'Max line adj. xGD/60', (c) => c.chem.best)
    ] },
    { id: 't15', n: 'Defensive pair chemistry', pri: 'Adjusted pair xGA suppression', m: [
      M('tp1', 'P1 xGF%', 'pct', true, 'PBP', 'Pair 1 on-ice 5v5 xGF%', (c) => lnXgf(c.lines.P, 0)),
      M('tp2', 'P2 xGF%', 'pct', true, 'PBP', 'Pair 2 on-ice 5v5 xGF%', (c) => lnXgf(c.lines.P, 1)),
      M('tp3', 'P3 xGF%', 'pct', true, 'PBP', 'Pair 3 on-ice 5v5 xGF%', (c) => lnXgf(c.lines.P, 2)),
      M('tp1x', 'Top-pair xGA / 60', 'r2', false, 'PBP', 'P1 xGA × 3600 / TOI', (c) => lnXga60(c.lines.P, 0)),
      M('tpstab', 'Pair stability %', 'pct', true, 'TRK', 'Share of 5v5 TOI with standard pairs', tder(82, 5, { struct: 0.6 }, { min: 55, max: 97 })),
      M('tpchem', 'Avg pair effect (xGF%)', 's2', true, 'MDL', 'Regularised pair interaction effect', (c) => c.chem.d),
      M('tdpts', 'Defense points share %', 'pct', null, 'PBP', 'Points by D / team points', (c) => c.dshare.pts),
      M('tdsh', 'Defense shot share %', 'pct', null, 'PBP', 'D SOG / team SOG', (c) => c.dshare.sog),
      M('tpbest', 'Best pair xGA / 60', 'r2', false, 'PBP', 'Min pair xGA/60', (c) => Math.min(...[0, 1, 2].map((i) => lnXga60(c.lines.P, i) || 9))),
      M('tp3x', 'Third-pair xGA / 60', 'r2', false, 'PBP', 'P3 xGA × 3600 / TOI', (c) => lnXga60(c.lines.P, 2))
    ] },
    { id: 't16', n: 'Coaching & deployment', pri: 'Deployment-adjusted team performance', m: [
      M('tl1sh', 'L1 TOI share %', 'pct', null, 'PBP', 'Line 1 5v5 TOI / team 5v5 TOI', (c) => rt(c.lines.L[0], c.t[T.TOI5], 100)),
      M('td4sh', 'Top-4 D TOI share %', 'pct', null, 'PBP', 'P1 + P2 TOI / team 5v5 TOI', (c) => rt(c.lines.P[0] + c.lines.P[NL], c.t[T.TOI5], 100)),
      M('tpp1sh', 'PP1 TOI share %', 'pct', null, 'PBP', 'PP1 TOI / PP TOI', (c) => rt(c.lines.PP[0], c.lines.PP[0] + c.lines.PP[4], 100)),
      M('tozsp', 'OZ-start usage spread', 'r1', null, 'TRK', 'OZ-start % gap, top vs bottom line', tder(9, 3, { struct: 0.4 }, { min: 0 })),
      M('tlmi', 'Line-matching index', 'r1', null, 'TRK', 'Strength of last-change matchups (50 = avg)', tder(50, 10, { struct: 0.8 }, { min: 5, max: 95 })),
      M('tto', 'Timeout success %', 'pct', true, 'TRK', 'Next-shift xG share after timeouts', tder(52, 8, { struct: 0.4 }, { min: 20, max: 85 })),
      M('tpull', 'Goalie-pull time / GP (s)', 'r1', null, 'PBP', 'Empty-net attack seconds per game', (c) => rt(c.t[T.PULLT], c.gp)),
      M('tdep', 'Deployment-adjusted rating', 's2', true, 'MDL', 'Rating with deployment effects removed', (c) => c.rating - 0.05 * ((rt(c.lines.L[0], c.t[T.TOI5], 100) || 32) - 32)),
      M('troll', 'Roll-four index', 'r1', null, 'PBP', 'L4 TOI share / L1 TOI share × 100', (c) => rt(c.lines.L[3 * NL], c.lines.L[0], 100)),
      M('tshl', 'Avg shift length (s)', 'r1', null, 'PBP', 'Team mean forward shift length', (c) => c.shiftLen)
    ] },
    { id: 't17', n: 'Game state & clutch', pri: 'State-adjusted win contribution', m: [
      M('ttcf', 'Tied CF%', 'pct', true, 'PBP', 'CF% with score tied', (c) => pc(c.t[T.TCF], c.t[T.TCA])),
      M('tlcf', 'Leading CF%', 'pct', null, 'PBP', 'CF% when leading', (c) => pc(c.t[T.LCF], c.t[T.LCA])),
      M('tbcf', 'Trailing CF%', 'pct', null, 'PBP', 'CF% when trailing', (c) => pc(c.t[T.BCF], c.t[T.BCA])),
      M('t1g', 'One-goal game win %', 'pct', true, 'PBP', 'Wins / one-goal games (incl. OT/SO)', (c) => c.clutch.one),
      M('tcomb', 'Comeback wins', 'int', true, 'PBP', 'Wins when trailing after 2', (c) => c.clutch.comeback),
      M('tsf', 'Win % scoring first', 'pct', true, 'PBP', 'Wins / games scoring first', (c) => c.clutch.first),
      M('tp3d', '3rd-period goal differential', 's1', true, 'PBP', 'P3 GF − P3 GA', (c) => c.t[T.P3GF] - c.t[T.P3GA]),
      M('totr', 'Overtime record', 'rec', null, 'PBP', 'OT W–L', (c) => c.clutch.ot),
      M('tsor', 'Shootout record', 'rec', null, 'PBP', 'SO W–L', (c) => c.clutch.so),
      M('teng', 'Empty-net goals for', 'int', true, 'PBP', 'ENG scored', (c) => c.t[T.ENGF])
    ] },
    { id: 't18', n: 'Schedule & environment', pri: 'Rest-adjusted team rating', m: [
      M('thome', 'Home points %', 'pct', true, 'PBP', 'Home points / (2 × home GP)', (c) => c.sched.home),
      M('taway', 'Road points %', 'pct', true, 'PBP', 'Road points / (2 × road GP)', (c) => c.sched.away),
      M('tb2b', 'Back-to-back points %', 'pct', true, 'PBP', 'Points % on 0 rest days', (c) => c.sched.b2b),
      M('trest', 'Rested points %', 'pct', true, 'PBP', 'Points % with ≥ 2 rest days', (c) => c.sched.rest),
      M('thx', 'Home 5v5 xGF%', 'pct', true, 'PBP', 'xGF% at home', (c) => c.sched.hx),
      M('tax', 'Road 5v5 xGF%', 'pct', true, 'PBP', 'xGF% on the road', (c) => c.sched.ax),
      M('ttrav', 'Travel load (k mi)', 'r1', false, 'TRK', 'Estimated travel miles to date', tder(18, 4, { tz: 1 }, { min: 6 })),
      M('trar', 'Rest-adjusted rating', 's2', true, 'MDL', 'Rating + b2b penalty adjustment', (c) => c.rating + 0.08 * (c.sched.b2bN / Math.max(1, c.gp))),
      M('tsos', 'Strength of schedule', 's2', null, 'MDL', 'Mean opponent rating faced', (c) => c.sos),
      M('trsos', 'Remaining SOS', 's2', null, 'MDL', 'Mean rating of remaining opponents', (c) => c.rsos)
    ] },
    { id: 't19', n: 'Consistency & regression', pri: 'Expected goals trend', m: [
      M('tpdo', 'PDO', 'r1', null, 'PBP', '5v5 Sh% + Sv% × 100', (c) => { const a = rt(c.t[T.GF5], c.t[T.SF5], 100), b = sv(c.t[T.SA5], c.t[T.GA5]); return a === null || b === null ? null : a + 100 * b; }),
      M('tshp', 'Shooting % (all)', 'pct', null, 'PBP', 'GF / SF', (c) => rt(c.t[T.GF], c.t[T.SF], 100)),
      M('tsvp', 'Save % (all)', 'sv', null, 'PBP', '1 − GA / SA', (c) => sv(c.t[T.SA], c.t[T.GA])),
      M('tl10', 'Last-10 5v5 xGF%', 'pct', true, 'PBP', 'xGF%, last 10 GP', (c) => c.l10),
      M('ttrend', 'xGF% trend (per 10 GP)', 's2', true, 'MDL', 'OLS slope × 10', (c) => c.trend),
      M('tgfx', 'GF − xGF', 's1', null, 'PBP', 'Finishing luck/skill', (c) => c.t[T.GF] - c.t[T.XGF]),
      M('tgax2', 'xGA − GA', 's1', null, 'PBP', 'Goaltending luck/skill', (c) => c.t[T.XGA] - c.t[T.GA]),
      M('tptsx', 'Points % − xPoints %', 's1', null, 'MDL', 'Actual vs expected points %', (c) => c.ptsPct - (100 * c.xpts) / (2 * c.gp)),
      M('tluck', 'Luck index', 's1', null, 'MDL', 'z(PDO) + z(1-goal record) − z(xG gap)', (c) => ((c.pdo - 100) / 1.2) + ((c.clutch.one || 50) - 50) / 15),
      M('trex', 'Regression-expected points %', 'pct', true, 'MDL', '0.6 × xPts% + 0.4 × Pts%', (c) => 0.6 * ((100 * c.xpts) / (2 * c.gp)) + 0.4 * c.ptsPct)
    ] },
    { id: 't20', n: 'Opponent matchup intelligence', pri: 'Matchup-specific expected goal advantage', m: [
      M('tvdiv', 'Points % vs division', 'pct', true, 'PBP', 'Pts% in divisional games', (c) => c.opp.div),
      M('tvtop', 'Points % vs top-10', 'pct', true, 'PBP', 'Pts% vs top-10 rated teams', (c) => c.opp.top),
      M('tvbot', 'Points % vs bottom-10', 'pct', true, 'PBP', 'Pts% vs bottom-10 rated teams', (c) => c.opp.bot),
      M('tvxtop', 'xGF% vs top-10', 'pct', true, 'PBP', '5v5 xGF% vs top-10', (c) => c.opp.xtop),
      M('tvxbot', 'xGF% vs bottom-10', 'pct', true, 'PBP', '5v5 xGF% vs bottom-10', (c) => c.opp.xbot),
      M('tvconf', 'Points % vs own conference', 'pct', true, 'PBP', 'Pts% vs conference', (c) => c.opp.conf),
      M('tvoff', 'xGA / 60 vs top offenses', 'r2', false, 'PBP', '5v5 xGA/60 vs top-10 xGF/60 teams', (c) => c.opp.vsOff),
      M('tvdef', 'xGF / 60 vs top defenses', 'r2', true, 'PBP', '5v5 xGF/60 vs top-10 xGA/60 teams', (c) => c.opp.vsDef),
      M('tnext', 'Next-opp. matchup xG edge', 's2', true, 'MDL', 'Projected 5v5 xG diff vs next opponent', (c) => c.opp.next),
      M('tstyle', 'Style-clash index', 'r1', null, 'MDL', 'Forecheck vs breakout & rush vs suppression fit (50 = neutral)', (c) => c.opp.style)
    ] }
  ];

  // ===================================================================
  //  Compute
  // ===================================================================
  function compute(league, season) {
    const players = league.players;
    // League constants
    const LG = (() => {
      let xga = 0, toi = 0, pkca = 0, pkt = 0, hda = 0, gp = 0, pen = 0;
      season.team.forEach((t) => { xga += t.acc[T.XGA5]; toi += t.acc[T.TOI5]; pkca += t.acc[T.PKCA]; pkt += t.acc[T.PKTOI]; hda += t.acc[T.HDA]; gp += t.gp; pen += t.acc[T.PEN]; });
      return { xga60: (xga * 3600) / toi, pkca60: (pkca * 3600) / pkt, hda60: (hda * 3600) / (gp * 3600), pen60: (pen * 3600) / (gp * 3600) };
    })();

    // Per-shooter aggregates from the shot table
    const shAgg = players.map(() => ({ ot: 0, ff: 0, rushG: 0, rushS: 0, rebG: 0, ppot: 0 }));
    for (const s of season.shots) {
      const a = shAgg[s.sh];
      if (!a || s.r === 3) continue;
      a.ff++;
      if (s.ot) { a.ot++; if (s.st === 1) a.ppot++; }
      if (s.rush && s.r >= 1) { a.rushS++; if (s.r === 2) a.rushG++; }
      if (s.reb && s.r === 2) a.rebG++;
    }

    // ---------- team-level pre-calcs (skaters need team totals for relative metrics)
    const teamCtx = league.teams.map((tm) => teamPre(league, season, tm, LG));

    // ---------- skaters
    const sk = {};
    for (const p of players) {
      if (p.isG) continue;
      const a = season.sk[p.id], gp = season.gp[p.id];
      const tc = teamCtx[p.teamId];
      const c = {
        id: p.id, p, a, gp, toi: a[S.TOI], toi5: a[S.TOI5], pts: a[S.G] + a[S.A1] + a[S.A2], isD: p.isD,
        L: p.lat, sample: a[S.TOI] / 60, team: league.teams[p.teamId], tacc: tc.t, sh: shAgg[p.id]
      };
      // relative (on − off) metrics
      const t = tc.t;
      const offT = t[T.TOI5] - c.toi5;
      const on = (k) => p60(a[S[k]], c.toi5), off = (tk, sk2) => p60(t[T[tk]] - a[S[sk2]], offT);
      const onX = pc(a[S.XGF5], a[S.XGA5]), offX = pc(t[T.XGF5] - a[S.XGF5], t[T.XGA5] - a[S.XGA5]);
      const onC = pc(a[S.CF5], a[S.CA5]), offC = pc(t[T.CF5] - a[S.CF5], t[T.CA5] - a[S.CA5]);
      c.rel = {
        xgf: onX !== null && offX !== null ? onX - offX : null,
        cf: onC !== null && offC !== null ? onC - offC : null,
        xga: on('XGA5') !== null && off('XGA5', 'XGA5') !== null ? on('XGA5') - off('XGA5', 'XGA5') : null,
        ca: on('CA5') !== null && off('CA5', 'CA5') !== null ? on('CA5') - off('CA5', 'CA5') : null
      };
      // last-10 / trend from logs
      const log = season.plog[p.id];
      const l10 = log.slice(-10);
      const sx = (arr, k) => arr.reduce((s, g) => s + g[k], 0);
      c.l10 = { xgf: pc(sx(l10, 'xgf5'), sx(l10, 'xga5')), p60: p60(sx(l10, 'g') + sx(l10, 'a'), sx(l10, 'toi')) };
      const roll = u.rollingRatio(log.map((g) => g.xgf5), log.map((g) => g.xgf5 + g.xga5), 5, 100);
      c.trend = roll.length > 8 ? u.slope(roll.slice(4)) * 10 : null;
      // pair-level xGA for D
      if (p.isD) {
        const pi = p.pair - 1, L = season.lines[p.teamId].P;
        c.pairXga = p60(L[pi * NL + 4], L[pi * NL]);
      }
      // GAR estimate
      const xgd = p60(a[S.XGF5] - a[S.XGA5], c.toi5) || 0;
      const repl = p.isD ? -0.45 : -0.35;
      c.gar = 0.5 * (xgd - repl) * (c.toi5 / 3600) + 0.5 * (a[S.G] - a[S.IXG]) + 0.35 * ((a[S.PPG] + a[S.PPA]) - 3.2 * (a[S.TOIPP] / 3600)) + 0.17 * (a[S.PDRAW] - a[S.PEN]);

      const vals = {};
      for (const cat of SKATER) for (const m of cat.m) vals[m.k] = safe(m.calc(c, m.k));
      const mods = moduleFor(p);
      for (const mk of mods) for (const grp of MODULES[mk].g) for (const m of grp.m) vals[m.k] = safe(m.calc(c, m.k));
      sk[p.id] = { vals, pct: {}, mods, ctx: c };
    }

    // ---------- goalies
    const gl = {};
    for (const p of players) {
      if (!p.isG) continue;
      const a = season.gk[p.id];
      const log = season.plog[p.id];
      const c = { id: p.id, p, a, gp: season.gpG[p.id], gs: season.gsG[p.id], rec: season.gRec[p.id], L: p.lat, sample: a[G.SA] * 2 + 60 };
      const svOf = (arr) => { const s = arr.reduce((x, g) => x + g.sa, 0), g2 = arr.reduce((x, g) => x + g.ga, 0); return sv(s, g2); };
      c.split = { b2b: svOf(log.filter((g) => g.b2b)), home: svOf(log.filter((g) => g.home)), away: svOf(log.filter((g) => !g.home)), hw: svOf(log.filter((g) => g.sa >= 30)) };
      const starts = log.filter((g) => g.start);
      const gsx = log.map((g) => g.xga - g.ga);
      c.cons = {
        qs: starts.length ? (100 * starts.filter((g) => { const v = g.sa ? 1 - g.ga / g.sa : 1; return v >= 0.913 || (g.sa < 20 && v >= 0.885); }).length) / starts.length : null,
        rbs: starts.filter((g) => g.sa && 1 - g.ga / g.sa < 0.85).length,
        sd: gsx.length > 2 ? u.sd(gsx) : null,
        pos: gsx.length ? (100 * gsx.filter((x) => x > 0).length) / gsx.length : null,
        l10sv: svOf(log.slice(-10)),
        l10x: u.sum(gsx.slice(-10)),
        trend: gsx.length > 8 ? u.slope(u.rollingRatio(gsx, gsx.map(() => 1), 5, 1).slice(4)) * 10 : null
      };
      const vals = {};
      for (const cat of GOALIE) for (const m of cat.m) vals[m.k] = safe(m.calc(c, m.k));
      gl[p.id] = { vals, pct: {}, ctx: c };
    }

    // ---------- skater/goalie percentiles, then chemistry (needs percentiles)
    percentiles(sk, players, SKATER, MODULES, season);
    goaliePct(gl, players, season);
    const chem = NQ.chem.build(league, season, sk);
    NQ.chem._last = chem;

    // ---------- opponent-adjusted team rating (iterative SOS correction)
    for (let it = 0; it < 6; it++) {
      teamCtx.forEach((c) => { c.sosAdj = u.mean(c.log.map((g) => teamCtx[g.opp].rating)); });
      teamCtx.forEach((c) => { c.rating = c.rating0 + 0.5 * c.sosAdj; });
    }
    const sortedR = teamCtx.map((c) => c.rating).sort((a, b) => b - a);
    teamCtx.forEach((c) => teamPost(league, season, c, teamCtx, sortedR));

    // ---------- teams
    const tm = {};
    teamCtx.forEach((c) => {
      const vals = {};
      for (const cat of TEAM) for (const m of cat.m) vals[m.k] = safe(m.calc(c, m.k));
      tm[c.team.id] = { vals, rank: {}, ctx: c };
    });

    ranks(tm);
    ratings(sk, gl, tm, players, season);

    return { skater: sk, goalie: gl, team: tm, LG, teamCtx, chem };
  }

  const safe = (v) => (typeof v === 'number' ? (isFinite(v) ? v : null) : v === undefined ? null : v);

  function moduleFor(p) {
    if (p.pos === 'C') return ['C'];
    if (p.pos === 'LW' || p.pos === 'RW') return ['W'];
    if (p.arch === 'Offensive D') return ['OD'];
    if (p.arch === 'Shutdown D') return ['SD'];
    return ['OD', 'SD'];
  }

  function teamPre(league, season, team, LG) {
    const tr = season.team[team.id];
    const t = tr.acc, gp = tr.gp;
    const sk = team.roster.slice(0, 18).map((id) => league.players[id].lat);
    const rm = (k) => u.mean(sk.map((l) => l[k] || 0));
    const L = Object.assign({}, team.lat, { r_trn: rm('trn'), r_def: rm('def'), r_pm: rm('pm'), r_skt: rm('skt'), r_phy: rm('phy'), r_iq: rm('iq'), tz: team.conf === 'West' ? 0.6 : -0.2 });
    // base rating (goals/game): 5v5 xGD/60 scaled to ~50 min + ST + goaltending
    const xgd60 = p60(t[T.XGF5] - t[T.XGA5], t[T.TOI5]) || 0;
    const st = ((t[T.PPXGF] - t[T.PKXGA]) / Math.max(1, gp));
    // goaltending unit
    const gids = [team.roster[18], team.roster[19]];
    const ga = gids.map((id) => season.gk[id]);
    const gsax = ga.reduce((s, a) => s + a[G.XGA] - a[G.GA], 0);
    const gtoi = ga.reduce((s, a) => s + a[G.TOI], 0);
    const shrunkG = gsax / (gp + 25);
    const rating0 = 0.83 * xgd60 + 0.8 * st + 0.7 * shrunkG;
    return { id: 'T' + team.id, team, t, tr, gp, log: tr.log, lines: season.lines[team.id], L, sample: 3000, rating0, rating: rating0, sosAdj: 0, lg: LG, gids, gsax, gtoi };
  }

  function teamPost(league, season, c, all, sortedR) {
    const { t, tr, gp, log, team } = c;
    // goalie unit
    const g1 = season.gk[c.gids[0]], g2 = season.gk[c.gids[1]];
    const glog = [...season.plog[c.gids[0]], ...season.plog[c.gids[1]]].filter((g) => g.start);
    const qs = glog.filter((g) => { const v = g.sa ? 1 - g.ga / g.sa : 1; return v >= 0.913 || (g.sa < 20 && v >= 0.885); }).length;
    c.gu = {
      gsax: c.gsax, toi: c.gtoi, hdsa: g1[G.SAHD] + g2[G.SAHD], hdga: g1[G.GAHD] + g2[G.GAHD], g1gs: season.gsG[c.gids[0]],
      g1x: g1[G.XGA] - g1[G.GA], g2x: g2[G.XGA] - g2[G.GA], qs: glog.length ? (100 * qs) / glog.length : null,
      reb: rt(g1[G.REBA] + g2[G.REBA], g1[G.SA] + g2[G.SA] - g1[G.GA] - g2[G.GA], 100)
    };
    // expected points from per-game xG (Poisson with OT split)
    c.xpts = log.reduce((s, g) => { const w = NQ.predict ? NQ.predict.quickFromLambda(g.xgf, g.xga) : null; return s + (w ? 2 * w.win + w.otl : 1); }, 0);
    c.ptsPct = gp ? (100 * tr.pts) / (2 * gp) : 0;
    // chemistry estimates (from line aggregates vs individual expectation)
    c.chem = NQ.chem ? NQ.chem.teamSummary(league, season, team) : { f: 0, d: 0, best: 0 };
    // depth scoring & D share
    let fg = 0, dg = 0, fpts = 0, dpts = 0, dsog = 0, tsog = 0, shifts = 0, ftoi = 0;
    team.roster.slice(0, 18).forEach((id, s) => {
      const a = season.sk[id];
      const pts = a[S.G] + a[S.A1] + a[S.A2];
      if (s < 12) { fpts += pts; if (s >= 6) dg += a[S.G]; fg += a[S.G]; shifts += a[S.SHIFTS]; ftoi += a[S.TOI]; } else { dpts += pts; dsog += a[S.SOG]; }
      tsog += a[S.SOG];
    });
    c.depth = fg ? (100 * dg) / fg : null;
    c.dshare = { pts: rt(dpts, dpts + fpts, 100), sog: rt(dsog, tsog, 100) };
    c.shiftLen = rt(ftoi, shifts);
    // clutch
    const one = log.filter((g) => Math.abs(g.gf - g.ga) === 1 || g.type !== 'REG');
    const sf = log.filter((g) => g.first);
    const otg = log.filter((g) => g.type === 'OT'), sog = log.filter((g) => g.type === 'SO');
    c.clutch = {
      one: one.length ? (100 * one.filter((g) => g.r === 'W').length) / one.length : null,
      comeback: 0,
      first: sf.length ? (100 * sf.filter((g) => g.r === 'W').length) / sf.length : null,
      ot: `${otg.filter((g) => g.r === 'W').length}-${otg.filter((g) => g.r !== 'W').length}`,
      so: `${sog.filter((g) => g.r === 'W').length}-${sog.filter((g) => g.r !== 'W').length}`
    };
    c.clutch.comeback = Math.round(t[T.TRAILP2] * 0.18 + (tr.otw + tr.sow) * 0.25);
    // schedule splits
    const pp = (arr) => (arr.length ? (100 * arr.reduce((s, g) => s + (g.r === 'W' ? 2 : g.r === 'OTL' ? 1 : 0), 0)) / (2 * arr.length) : null);
    const xx = (arr) => pc(arr.reduce((s, g) => s + g.xgf5, 0), arr.reduce((s, g) => s + g.xga5, 0));
    const b2b = log.filter((g) => g.rest <= 1);
    c.sched = { home: pp(log.filter((g) => g.home)), away: pp(log.filter((g) => !g.home)), b2b: pp(b2b), rest: pp(log.filter((g) => g.rest >= 2)), hx: xx(log.filter((g) => g.home)), ax: xx(log.filter((g) => !g.home)), b2bN: b2b.length };
    c.sos = u.mean(log.map((g) => all[g.opp].rating));
    const rem = season.upcoming.filter((g) => g.home === team.id || g.away === team.id).map((g) => all[g.home === team.id ? g.away : g.home].rating);
    c.rsos = rem.length ? u.mean(rem) : null;
    // regression
    const l10 = log.slice(-10);
    c.l10 = xx(l10);
    const roll = u.rollingRatio(log.map((g) => g.xgf5), log.map((g) => g.xgf5 + g.xga5), 8, 100);
    c.trend = u.slope(roll.slice(7)) * 10;
    c.pdo = (rt(t[T.GF5], t[T.SF5], 100) || 8) + 100 * (sv(t[T.SA5], t[T.GA5]) || 0.92);
    // opponent splits
    const top10 = new Set(all.filter((x) => x.rating >= sortedR[9]).map((x) => x.team.id));
    const bot10 = new Set(all.filter((x) => x.rating <= sortedR[22]).map((x) => x.team.id));
    const off10 = new Set(all.slice().sort((a, b) => (p60(b.t[T.XGF5], b.t[T.TOI5]) || 0) - (p60(a.t[T.XGF5], a.t[T.TOI5]) || 0)).slice(0, 10).map((x) => x.team.id));
    const def10 = new Set(all.slice().sort((a, b) => (p60(a.t[T.XGA5], a.t[T.TOI5]) || 0) - (p60(b.t[T.XGA5], b.t[T.TOI5]) || 0)).slice(0, 10).map((x) => x.team.id));
    const vs = (set) => log.filter((g) => set.has(g.opp));
    const teams = league.teams;
    const next = season.upcoming.find((g) => g.home === team.id || g.away === team.id);
    let nextEdge = null, style = 50;
    if (next) {
      const o = all[next.home === team.id ? next.away : next.home];
      const myF = p60(t[T.XGF5], t[T.TOI5]), myA = p60(t[T.XGA5], t[T.TOI5]);
      const oF = p60(o.t[T.XGF5], o.t[T.TOI5]), oA = p60(o.t[T.XGA5], o.t[T.TOI5]);
      nextEdge = ((myF + oA) / 2 - (oF + myA) / 2) * (50 / 60);
      style = 50 + 8 * (team.lat.fore - o.team.lat.exitq) + 6 * (team.lat.exitq - o.team.lat.fore);
    }
    c.opp = {
      div: pp(log.filter((g) => teams[g.opp].div === team.div)), top: pp(vs(top10)), bot: pp(vs(bot10)),
      xtop: xx(vs(top10)), xbot: xx(vs(bot10)), conf: pp(log.filter((g) => teams[g.opp].conf === team.conf)),
      vsOff: (() => { const a = vs(off10); return p60(a.reduce((s, g) => s + g.xga5, 0), a.reduce((s, g) => s + g.toi5, 0)); })(),
      vsDef: (() => { const a = vs(def10); return p60(a.reduce((s, g) => s + g.xgf5, 0), a.reduce((s, g) => s + g.toi5, 0)); })(),
      next: nextEdge, style
    };
  }

  function percentiles(sk, players, SK, MODS, season) {
    const pools = { F: [], D: [] };
    for (const p of players) if (!p.isG && season.gp[p.id] >= 10) pools[p.isD ? 'D' : 'F'].push(p.id);
    const keys = [];
    for (const cat of SK) for (const m of cat.m) keys.push(m);
    const doPool = (ids, metrics, targetIds) => {
      for (const m of metrics) {
        const arr = ids.map((id) => sk[id].vals[m.k]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
        for (const id of targetIds) {
          const v = sk[id].vals[m.k];
          if (typeof v !== 'number' || !arr.length) continue;
          let pr = u.pctRank(arr, v);
          if (m.hib === false) pr = 100 - pr;
          sk[id].pct[m.k] = pr;
        }
      }
    };
    const allF = players.filter((p) => !p.isG && !p.isD).map((p) => p.id);
    const allD = players.filter((p) => p.isD).map((p) => p.id);
    doPool(pools.F, keys, allF);
    doPool(pools.D, keys, allD);
    for (const mk of Object.keys(MODS)) {
      const metrics = [];
      for (const grp of MODS[mk].g) for (const m of grp.m) metrics.push(m);
      const members = players.filter((p) => !p.isG && sk[p.id].mods.includes(mk)).map((p) => p.id);
      doPool(members.filter((id) => season.gp[id] >= 10), metrics, members);
    }
  }

  function goaliePct(gl, players, season) {
    const pool = players.filter((p) => p.isG && season.gpG[p.id] >= 8).map((p) => p.id);
    for (const cat of GOALIE) for (const m of cat.m) {
      const arr = pool.map((id) => gl[id].vals[m.k]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      for (const id of Object.keys(gl)) {
        const v = gl[id].vals[m.k];
        if (typeof v !== 'number' || !arr.length || m.hib === null) continue;
        let pr = u.pctRank(arr, v);
        if (m.hib === false) pr = 100 - pr;
        gl[id].pct[m.k] = pr;
      }
    }
  }

  function ranks(tm) {
    const ids = Object.keys(tm);
    for (const cat of TEAM) for (const m of cat.m) {
      const sorted = ids.filter((id) => typeof tm[id].vals[m.k] === 'number').sort((a, b) => (m.hib === false ? tm[a].vals[m.k] - tm[b].vals[m.k] : tm[b].vals[m.k] - tm[a].vals[m.k]));
      sorted.forEach((id, i) => { tm[id].rank[m.k] = i + 1; });
    }
  }

  function ratings(sk, gl, tm, players, season) {
    const avg = (o, ks) => { const v = ks.map((k) => o.pct[k]).filter((x) => typeof x === 'number'); return v.length ? u.mean(v) : 50; };
    const scale = (x) => 40 + 0.59 * x;
    for (const p of players) {
      if (p.isG) continue;
      const o = sk[p.id];
      const off = avg(o, ['p60', 'ixg60', 'xa60', 'xgf60', 'pp160', 'cc60']);
      const def = avg(o, ['xga60', 'relxga', 'tk60', 'entden', 'hda60', 'dzerr60']);
      const trn = avg(o, ['cent60', 'cex60', 'carry', 'exsuc', 'txg60']);
      const ppW = Math.min(1, (o.vals.toippgp || 0) / 150), pkW = Math.min(1, (o.vals.toipkgp || 0) / 120);
      const stp = (o.pct.ppp60 !== undefined ? o.pct.ppp60 : 40) * ppW + 35 * (1 - ppW);
      const stk = (o.pct.pkxga60 !== undefined ? o.pct.pkxga60 : 40) * pkW + 35 * (1 - pkW);
      const st = (stp * 0.6 + stk * 0.4);
      const imp = avg(o, ['relxgf', 'gar', 'xgf', 'talxgf']);
      const w = p.isD ? [0.26, 0.32, 0.2, 0.12, 0.1] : [0.38, 0.2, 0.17, 0.13, 0.12];
      const ov = w[0] * off + w[1] * def + w[2] * trn + w[3] * st + w[4] * imp;
      // trend: last-10 vs season composite
      const tr = ((o.vals.l10xgf || 50) - (o.vals.xgf || 50)) * 0.35 + ((o.vals.l10p60 || 0) - (o.vals.p60 || 0)) * 1.6;
      o.rating = { overall: scale(ov), offense: scale(off), defense: scale(def), transition: scale(trn), special: scale(st), impact: scale(imp), trend: u.clamp(tr, -6, 6) };
    }
    for (const id of Object.keys(gl)) {
      const o = gl[id];
      const ss = avg(o, ['ggsax100', 'ghd', 'gtal', 'gdsv']);
      const tech = avg(o, ['greba', 'gfrz', 'glat', 'gpost']);
      const cons = avg(o, ['gqs', 'gsd', 'gpos', 'gci']);
      const sit = avg(o, ['gsv5', 'gpksv', 'gp3', 'ghw']);
      o.rating = { overall: scale(0.45 * ss + 0.15 * tech + 0.25 * cons + 0.15 * sit), shot: scale(ss), technique: scale(tech), consistency: scale(cons), situational: scale(sit), trend: u.clamp(((o.vals.gl10 || 0.9) - (o.vals.gsv || 0.9)) * 300, -6, 6) };
    }
    // team category scores (0-100 from mean rank)
    for (const id of Object.keys(tm)) {
      const o = tm[id];
      o.cat = {};
      for (const cat of TEAM) {
        const hibRanks = cat.m.filter((m) => m.hib !== null && typeof o.rank[m.k] === 'number').map((m) => o.rank[m.k]);
        o.cat[cat.id] = hibRanks.length ? 100 * (1 - (u.mean(hibRanks) - 1) / 31) : 50;
      }
    }
  }

  /** Flat metric catalog for the Feature Store / metric dictionary. */
  function catalog() {
    const out = [];
    SKATER.forEach((c) => c.m.forEach((m) => out.push({ ...m, scope: 'Skater', cat: c.n })));
    Object.entries(MODULES).forEach(([k, mod]) => mod.g.forEach((g) => g.m.forEach((m) => out.push({ ...m, scope: mod.n, cat: g.n }))));
    GOALIE.forEach((c) => c.m.forEach((m) => out.push({ ...m, scope: 'Goalie', cat: c.n })));
    TEAM.forEach((c) => c.m.forEach((m) => out.push({ ...m, scope: 'Team', cat: c.n })));
    return out;
  }

  NQ.metrics = { SKATER, MODULES, GOALIE, TEAM, compute, catalog, moduleFor };
})(globalThis.NQ = globalThis.NQ || {});

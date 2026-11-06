/* ==========================================================================
 * NQ.sim — shift- and event-level NHL game simulator.
 *
 * One engine produces BOTH the historical synthetic season and every
 * forward-looking Monte Carlo forecast, so player box scores, goalie lines,
 * team scores and win probabilities always come from the same events:
 *
 *   shot attempt ─► blocked / missed / on goal ─► save (+rebound) / goal
 *        │                                              │
 *        └─ shooter, passer, location, xG               └─ A1 / A2, score,
 *                                                          PP release, OT end
 *
 * Identities that hold by construction (verified in Model Audit):
 *   team goals = Σ skater goals (+1 for a shootout win)
 *   goalie saves = shots against − goals against
 *   assists ≤ 2 × goals, every assist belongs to an on-ice teammate
 *
 * Game structure: 3 × 20:00 regulation in 40 s segments (≈ one shift);
 * penalties with release on PP goals; score effects; goalie pulls (6v5);
 * starter hook; 5:00 3v3 overtime (30 s segments); shootout.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const { offDrive, talent, replacement } = NQ.league;

  // ---------------------------------------------------------------- stat maps
  const SK = ['TOI', 'TOI5', 'TOIPP', 'TOIPK', 'TOIOT', 'G', 'A1', 'A2', 'G5', 'A5', 'PPG', 'PPA', 'SHG', 'SOG', 'ICF', 'IFF', 'IXG',
    'HD', 'MD', 'LD', 'REB', 'RUSH', 'SA1', 'XA', 'HDSA', 'CSA', 'RSA', 'PPSA', 'BLK', 'HIT', 'HITT', 'FOW', 'FOL', 'FOWO', 'FOLO',
    'FOWD', 'FOLD', 'FOWN', 'FOLN', 'FOWE', 'FOLE', 'PEN', 'PDRAW', 'CF5', 'CA5', 'FF5', 'FA5', 'XGF5', 'XGA5', 'GF5', 'GA5', 'SF5',
    'SA5', 'HDF5', 'HDA5', 'XGAPK', 'XGFPP', 'OZFO', 'DZFO', 'QOC', 'QOT', 'SHIFTS', 'CLS', 'RXG', 'GWG', 'OTG', 'PPXG', 'PPSOG',
    'IXG5', 'SOG5', 'ICF5', 'G5A', 'RXA', 'OTA'];
  const S = {}; SK.forEach((k, i) => { S[k] = i; });
  const NS = SK.length;

  const GK = ['TOI', 'SA', 'GA', 'XGA', 'FA', 'SA5', 'GA5', 'XGA5', 'SAPK', 'GAPK', 'XGAPK', 'SAHD', 'GAHD', 'XGAHD', 'SAMD', 'GAMD',
    'XGAMD', 'SALD', 'GALD', 'XGALD', 'SAREB', 'GAREB', 'SARUSH', 'GARUSH', 'SAOT', 'GAOT', 'SACS', 'GACS', 'REBA', 'SAGL', 'GAGL',
    'SABL', 'GABL', 'SAHI', 'GAHI', 'SALO', 'GALO', 'SAP3', 'GAP3', 'SATR', 'GATR', 'SALE', 'GALE', 'XGAREB', 'XGARUSH'];
  const G = {}; GK.forEach((k, i) => { G[k] = i; });
  const NG = GK.length;

  const TK = ['GF', 'GA', 'SF', 'SA', 'CF', 'CA', 'FF', 'FA', 'XGF', 'XGA', 'GF5', 'GA5', 'SF5', 'SA5', 'CF5', 'CA5', 'FF5', 'FA5',
    'XGF5', 'XGA5', 'TOI5', 'HDF5', 'HDA5', 'PPTOI', 'PPGF', 'PPXGF', 'PPSF', 'PPCF', 'PKTOI', 'PKGA', 'PKXGA', 'PKSA', 'PKCA', 'SHGF',
    'PPO', 'TSH', 'PIM', 'PEN', 'MAJ', 'RXGF', 'RXGA', 'RBXGF', 'RBXGA', 'CSF', 'CSAG', 'OTF', 'HDF', 'HDA', 'PTF', 'DISTF', 'DISTA',
    'BLK', 'HIT', 'FOW', 'FOL', 'FOWD', 'FOLD', 'FOWO', 'FOLO', 'ENGF', 'ENGA', 'P1GF', 'P2GF', 'P3GF', 'P1GA', 'P2GA', 'P3GA',
    'TCF', 'TCA', 'LCF', 'LCA', 'BCF', 'BCA', 'TXF', 'TXA', 'CYXGF', 'CYXGA', 'PULLT', 'FIRST', 'LEADP2', 'TRAILP2', 'SOGF', 'SOGA',
    'MD5F', 'LD5F', 'REBF', 'REBA', 'SLOTA', 'ONNETF', 'ONNETA', 'HITT', 'OZFO', 'DZFO'];
  const T = {}; TK.forEach((k, i) => { T[k] = i; });
  const NT = TK.length;
  const LS = ['TOI', 'CF', 'CA', 'XGF', 'XGA', 'GF', 'GA', 'SF', 'SA', 'HDF', 'HDA'];
  const NL = LS.length;

  // ---------------------------------------------------------------- xG model
  // Logistic expected-goals model on unblocked attempts. Coefficients are the
  // "custom xG model" surfaced in Model Audit → Custom Models.
  const XG = {
    b0: -0.98, dist: -0.075, dist2: 0.0004, angle: -0.75, rebound: 0.85, rush: 0.35, oneTimer: 0.25,
    crossSlot: 0.45, pp: 0.52, sh: -0.10, ot3v3: 0.15,
    type: { Wrist: 0, Snap: 0.06, Slap: -0.12, Backhand: -0.22, Tip: 0.25, Wrap: -0.4 }
  };
  const TYPES = ['Wrist', 'Snap', 'Slap', 'Backhand', 'Tip', 'Wrap'];
  const TYPE_W = [[0.45, 0.15, 0.35, 0.05, 0, 0], [0.5, 0.22, 0.08, 0.1, 0.1, 0], [0.42, 0.16, 0, 0.14, 0.22, 0.06]];

  function xgOf(d, ang, f) {
    let z = XG.b0 + XG.dist * d + XG.dist2 * d * d + XG.angle * Math.abs(ang) + XG.type[f.type];
    if (f.reb) z += XG.rebound;
    if (f.rush) z += XG.rush;
    if (f.ot) z += XG.oneTimer;
    if (f.cs) z += XG.crossSlot;
    if (f.st === 1) z += XG.pp; else if (f.st === -1) z += XG.sh; else if (f.st === 3) z += XG.ot3v3;
    return 1 / (1 + Math.exp(-z));
  }

  // Attempts per 60 for the attacking side, keyed by attackers*10+defenders.
  const BASE = { 55: 56, 54: 106, 45: 14, 44: 52, 53: 125, 35: 6, 43: 100, 34: 10, 33: 58, 65: 84, 56: 30, 64: 110, 46: 12, 63: 125, 36: 8 };
  const SEG = 40, OTSEG = 30, REG_SEGS = 90, OT_SEGS = 10;

  // ---------------------------------------------------------------- context
  /**
   * Prepare a team for simulation. opts: { scratches:Set<playerId>,
   * starter:18|19, rest:days, home:bool, form:number }.
   */
  function buildTeamCtx(league, team, opts) {
    opts = opts || {};
    const scr = opts.scratches || new Set();
    const P = team.roster.map((pid) => {
      const p = league.players[pid];
      return scr.has(pid) ? replacement(p) : p;
    });
    const n = 18;
    const f = (fn) => { const a = new Float64Array(n); for (let s = 0; s < n; s++) a[s] = fn(P[s].lat, P[s], s); return a; };
    const ctx = {
      team, P, home: !!opts.home, rest: opts.rest === undefined ? 2 : opts.rest,
      wShot: f((l, p) => Math.exp(0.33 * l.vol) * (p.isD ? 0.55 : 1)),
      wShotPP: f((l, p) => Math.exp(0.33 * l.vol + 0.3 * l.pp) * (p.isD ? 0.6 : 1)),
      wPass: f((l) => Math.exp(0.45 * l.pm)),
      wBlk: f((l, p) => Math.exp(0.5 * l.blk) * (p.isD ? 1.9 : 1)),
      wHit: f((l) => Math.exp(0.55 * l.phy)),
      fin: f((l) => Math.exp(0.11 * Math.max(-2.5, Math.min(2.5, l.sht)))),
      hdT: f((l, p) => Math.exp(0.22 * (0.6 * l.sht + 0.4 * l.vol) + 0.1 * l.iq) * (p.isD ? 0.33 : 1)),
      rushT: f((l) => Math.exp(0.3 * l.trn + 0.15 * l.skt)),
      pen: f((l) => Math.exp(-0.35 * l.dis)),
      drw: f((l) => Math.exp(0.3 * l.drw)),
      tal: f((l) => talent(l)),
      isD: f((l, p) => (p.isD ? 1 : 0)),
      fo: f((l) => l.fo)
    };
    const mean = (slots, fn) => { let s = 0; for (const x of slots) s += fn(P[x].lat); return s / slots.length; };
    ctx.lines = team.lines.map((L) => ({ slots: L.slots, w: L.w, chem: L.chem, off: mean(L.slots, offDrive), pm: mean(L.slots, (l) => l.pm), def: mean(L.slots, (l) => l.def), tal: mean(L.slots, talent), phy: mean(L.slots, (l) => l.phy) }));
    ctx.pairs = team.pairs.map((Q) => ({ slots: Q.slots, w: Q.w, chem: Q.chem, off: mean(Q.slots, offDrive), def: mean(Q.slots, (l) => l.def), blk: mean(Q.slots, (l) => l.blk), tal: mean(Q.slots, talent) }));
    ctx.pp = team.pp.map((U) => ({ slots: U.slots, w: U.w, off: mean(U.slots, (l) => 0.5 * l.pp + 0.5 * offDrive(l)) }));
    ctx.pk = team.pk.map((U) => ({ slots: U.slots, w: U.w, def: mean(U.slots, (l) => 0.6 * l.def + 0.4 * l.blk) }));
    ctx.ot = team.ot.map((U) => ({ slots: U.slots, w: U.w, off: mean(U.slots, offDrive), def: mean(U.slots, (l) => l.def) }));
    // Extra attacker for 6v5: first PP1 forward not already on the PP1 unit's base.
    ctx.pull = team.pp[0].slots.slice();
    const extra = team.lines[0].slots.find((s) => !ctx.pull.includes(s)) ?? team.lines[1].slots[0];
    ctx.pull.push(extra);
    // Goalies
    const gs = opts.starter === 19 ? 19 : 18;
    ctx.goalies = [18, 19].map((s) => {
      const gp = scr.has(team.roster[s]) ? replacement(league.players[team.roster[s]]) : league.players[team.roster[s]];
      return { slot: s, p: gp, log: -0.075 * gp.lat.stop, hd: -0.045 * gp.lat.hd, reb: Math.exp(-0.28 * gp.lat.reb), formSd: 0.07 * (1.3 - 0.3 * Math.max(-1, Math.min(1, gp.lat.cons))) };
    });
    ctx.starter = gs - 18;
    ctx.goalScale = league.goalScale || 1;
    return ctx;
  }

  // ---------------------------------------------------------------- engine
  /**
   * Simulate one game. H, A: team contexts. opts: { shots:boolean (record
   * shot list), gameId }.
   */
  function simulate(H, A, rng, opts) {
    opts = opts || {};
    const rec = opts.shots ? [] : null;
    const box = [new Float64Array(20 * NS), new Float64Array(20 * NS)];
    const gb = [new Float64Array(2 * NG), new Float64Array(2 * NG)];
    const ts = [new Float64Array(NT), new Float64Array(NT)];
    const ls = [new Float64Array(4 * NL), new Float64Array(4 * NL)];
    const ps = [new Float64Array(3 * NL), new Float64Array(3 * NL)];
    const us = [new Float64Array(8), new Float64Array(8)]; // PP1 toi,gf,xgf,sf | PP2 ...
    const ks = [new Float64Array(8), new Float64Array(8)]; // PK1 toi,ga,xga,sa | PK2 ...
    const C = [H, A];
    const score = [0, 0];
    const goals = [];
    const box2 = [[], []]; // penalty boxes: {left, major, slot}
    const gIdx = [H.starter, A.starter];
    const gUsed = [[gIdx[0]], [gIdx[1]]];
    const gForm = [rng.normal(0, C[0].goalies[gIdx[0]].formSd), rng.normal(0, C[1].goalies[gIdx[1]].formSd)];
    const hooked = [false, false];
    const homeAdv = [0.035, 0];
    const restAdj = [C[0].rest <= 1 ? -0.05 : 0, C[1].rest <= 1 ? -0.05 : 0];
    let first = -1;

    // per-segment state shared by helpers
    let per = 1, segIx = 0, isOT = false, over = false;
    const on = [[], []];
    let unit5 = [[-1, -1], [-1, -1]]; // [line, pair] when 5v5
    let ppU = [-1, -1], pkU = [-1, -1];
    let pulled = [false, false];
    let st = [0, 0]; // strength flag per team: 1 PP, -1 PK, 0 even, 3 3v3 OT
    let five = false; // true when 5v5 with both goalies in
    let segOff = [0, 0], segDef = [0, 0], segQual = [0, 0], segBlk = [0, 0];

    const bx = (t, slot, k, v) => { box[t][slot * NS + k] += v; };

    function chooseOnIce() {
      const sk = [5 - Math.min(2, box2[0].length), 5 - Math.min(2, box2[1].length)];
      if (isOT) {
        for (let t = 0; t < 2; t++) {
          const U = C[t].ot[rng.weighted(C[t].ot.map((x) => x.w))];
          on[t] = U.slots.slice(); segOff[t] = U.off; segDef[t] = U.def; segQual[t] = 0.2; segBlk[t] = 0; st[t] = 3;
          if (pulled[t]) pulled[t] = false;
        }
        five = false; unit5 = [[-1, -1], [-1, -1]]; ppU = [-1, -1]; pkU = [-1, -1];
        return;
      }
      // goalie pulls: last 3 segments of P3, trailing by 1-2, not shorthanded
      for (let t = 0; t < 2; t++) {
        const diff = score[t] - score[1 - t];
        pulled[t] = per === 3 && segIx >= 87 && (diff === -1 || diff === -2) && sk[t] >= sk[1 - t] && rng.chance(diff === -1 ? 0.92 : 0.75);
      }
      five = sk[0] === 5 && sk[1] === 5 && !pulled[0] && !pulled[1];
      ppU = [-1, -1]; pkU = [-1, -1]; unit5 = [[-1, -1], [-1, -1]];
      for (let t = 0; t < 2; t++) {
        const c = C[t], o = 1 - t;
        if (pulled[t]) {
          on[t] = c.pull.slice(); segOff[t] = c.pp[0].off; segDef[t] = -0.3; segQual[t] = 0.15; segBlk[t] = -0.3; st[t] = 0;
        } else if (sk[t] > sk[o]) {
          const u = rng.chance(c.pp[0].w) ? 0 : 1; ppU[t] = u;
          on[t] = c.pp[u].slots.slice(0, 4 + (sk[t] - 4)); // 5 skaters normally
          if (on[t].length < sk[t]) on[t] = c.pp[u].slots.slice();
          segOff[t] = c.pp[u].off + c.team.lat.pp; segDef[t] = -0.2; segQual[t] = 0.25 + 0.3 * c.team.lat.pp; segBlk[t] = -0.3; st[t] = 1;
        } else if (sk[t] < sk[o]) {
          const u = rng.chance(c.pk[0].w) ? 0 : 1; pkU[t] = u;
          on[t] = c.pk[u].slots.slice(0, sk[t] === 3 ? 3 : 4);
          segOff[t] = -0.5; segDef[t] = c.pk[u].def + c.team.lat.pk; segQual[t] = -0.3; segBlk[t] = c.pk[u].def; st[t] = -1;
        } else {
          const li = rng.weighted(c.lines.map((x) => x.w)), pi = rng.weighted(c.pairs.map((x) => x.w));
          const L = c.lines[li], Q = c.pairs[pi];
          unit5[t] = [li, pi];
          on[t] = sk[t] === 5 ? [...L.slots, ...Q.slots] : sk[t] === 4 ? [L.slots[0], L.slots[1], ...Q.slots] : [L.slots[0], ...Q.slots];
          segOff[t] = 0.6 * L.off + 0.4 * Q.off + L.chem + 0.5 * Q.chem + c.team.lat.off;
          segDef[t] = 0.45 * L.def + 0.55 * Q.def + 0.6 * L.chem + 0.6 * Q.chem + c.team.lat.def;
          segQual[t] = 0.25 * (L.pm - 0.2) + 0.5 * L.chem + 0.3 * c.team.lat.off;
          segBlk[t] = Q.blk;
          st[t] = 0;
        }
      }
    }

    /** Sample shot location for a danger tier; returns [x, y, d, ang]. */
    function location(tier, isDshooter) {
      let d, ang;
      if (tier === 2) { d = 4 + rng.next() * 18; ang = Math.max(-0.95, Math.min(0.95, rng.normal(0, 0.42))); }
      else if (tier === 1) { d = 15 + rng.next() * 23; ang = Math.max(-1.15, Math.min(1.15, rng.normal(0, 0.55))); }
      else if (isDshooter) { d = 46 + rng.next() * 18; ang = Math.max(-0.9, Math.min(0.9, rng.normal(0, 0.45))); }
      else { d = 30 + rng.next() * 32; ang = Math.max(-1.3, Math.min(1.3, rng.normal(0, 0.7))); }
      let x = 89 - d * Math.cos(ang), y = d * Math.sin(ang);
      if (x < 26) { x = 26 + rng.next() * 4; }
      if (y > 40) y = 40; if (y < -40) y = -40;
      d = Math.hypot(89 - x, y); ang = Math.atan2(y, 89 - x);
      return [x, y, d, ang];
    }

    function pickFrom(t, slots, w, exclude) {
      let tot = 0;
      for (const s of slots) if (s !== exclude) tot += w[s];
      let x = rng.next() * tot;
      for (const s of slots) { if (s === exclude) continue; x -= w[s]; if (x <= 0) return s; }
      for (const s of slots) if (s !== exclude) return s;
      return slots[0];
    }

    /** One shot attempt by team t. reb = rebound attempt. */
    function attempt(t, reb, segSec) {
      if (over) return;
      const o = 1 - t, c = C[t], oc = C[o];
      const tsa = ts[t], tsd = ts[o];
      const ppNow = st[t] === 1, pkNow = st[t] === -1;
      const shooter = pickFrom(t, on[t], ppNow ? c.wShotPP : c.wShot, -1);
      const passer = !reb && on[t].length > 1 && rng.chance(0.78) ? pickFrom(t, on[t], c.wPass, shooter) : -1;
      const rush = !reb && !ppNow && rng.chance((isOT ? 0.3 : 0.13) * c.rushT[shooter] * Math.exp(0.2 * c.team.lat.exitq * 0.3));
      const ot = !reb && passer >= 0 && rng.chance(ppNow ? 0.28 : 0.11);
      const cs = passer >= 0 && rng.chance(0.12 * Math.exp(0.4 * (c.P[passer].lat.pm)));
      let tier;
      if (reb) tier = rng.chance(0.7) ? 2 : rng.chance(0.85) ? 1 : 0;
      else {
        const ph = Math.min(0.6, Math.max(0.02, 0.17 * c.hdT[shooter] * Math.exp(segQual[t] - 0.25 * segDef[o]) * (rush ? 1.3 : 1) * (cs ? 1.6 : 1)));
        const r = rng.next();
        tier = r < ph ? 2 : r < ph + 0.33 ? 1 : 0;
      }
      const [x, y, d, ang] = location(tier, c.isD[shooter] === 1);
      const type = TYPES[rng.weighted(TYPE_W[tier])];
      const f = { type, reb, rush, ot, cs, st: st[t] };
      const xg = xgOf(d, ang, f);
      const isFive = five;
      const sd = score[o] - score[t]; // defending team's lead
      // ---- attempt accounting
      tsa[T.CF]++; tsd[T.CA]++;
      bx(t, shooter, S.ICF, 1);
      if (isFive) { tsa[T.CF5]++; tsd[T.CA5]++; bx(t, shooter, S.ICF5, 1); onIce5(t, 'CF5', 'CA5', 1); lineAcc(t, 1, 2, 1); }
      if (ppNow) { tsa[T.PPCF]++; tsd[T.PKCA]++; }
      const lead = score[t] - score[o];
      if (lead === 0) { tsa[T.TCF]++; tsd[T.TCA]++; } else if (lead > 0) { tsa[T.LCF]++; tsd[T.BCF]++; } else { tsa[T.BCF]++; tsd[T.LCF]++; }
      // blocked?
      const blkBase = ppNow ? 0.2 : pkNow ? 0.22 : 0.25;
      const pB = blkBase * Math.exp(0.25 * segBlk[o]) * (tier === 0 ? 1.3 : tier === 1 ? 0.9 : 0.45) * (reb ? 0.5 : 1);
      if (!pulled[o] && on[o].length > 0 && rng.chance(Math.min(0.6, pB))) {
        const blocker = pickFrom(o, on[o], oc.wBlk, -1);
        bx(o, blocker, S.BLK, 1); tsd[T.BLK]++;
        if (rec) rec.push({ t, sh: c.P[shooter].id, g: -1, x, y, xg: 0, r: 3, dg: tier, st: st[t], reb, rush, ot, cs, type, per, pas: passer >= 0 ? c.P[passer].id : -1, sd });
        return;
      }
      // unblocked
      tsa[T.FF]++; tsd[T.FA]++; tsa[T.XGF] += xg; tsd[T.XGA] += xg; tsa[T.DISTF] += d; tsd[T.DISTA] += d;
      bx(t, shooter, S.IFF, 1); bx(t, shooter, S.IXG, xg);
      bx(t, shooter, tier === 2 ? S.HD : tier === 1 ? S.MD : S.LD, 1);
      if (reb) { bx(t, shooter, S.REB, 1); tsa[T.RBXGF] += xg; tsd[T.RBXGA] += xg; tsa[T.REBF]++; tsd[T.REBA]++; }
      if (rush) { bx(t, shooter, S.RUSH, 1); bx(t, shooter, S.RXG, xg); tsa[T.RXGF] += xg; tsd[T.RXGA] += xg; }
      if (!rush && !reb) { tsa[T.CYXGF] += xg; tsd[T.CYXGA] += xg; }
      if (cs) { tsa[T.CSF]++; tsd[T.CSAG]++; }
      if (ot) tsa[T.OTF]++;
      if (tier === 2) { tsa[T.HDF]++; tsd[T.HDA]++; tsd[T.SLOTA]++; }
      if (c.isD[shooter]) tsa[T.PTF]++;
      if (Math.abs(y) < 10) bx(t, shooter, S.CLS, 1);
      if (passer >= 0) { bx(t, passer, S.XA, xg); if (rush) bx(t, passer, S.RXA, xg); }
      if (isFive) {
        tsa[T.FF5]++; tsd[T.FA5]++; tsa[T.XGF5] += xg; tsd[T.XGA5] += xg; bx(t, shooter, S.IXG5, xg);
        if (tier === 2) { tsa[T.HDF5]++; tsd[T.HDA5]++; onIce5(t, 'HDF5', 'HDA5', 1); lineAcc(t, 9, 10, 1); }
        else if (tier === 1) tsa[T.MD5F]++; else tsa[T.LD5F]++;
        onIce5(t, 'FF5', 'FA5', 1); onIce5(t, 'XGF5', 'XGA5', xg); lineAcc(t, 3, 4, xg);
      }
      if (ppNow) { tsa[T.PPXGF] += xg; tsd[T.PKXGA] += xg; bx(t, shooter, S.PPXG, xg); for (const s of on[t]) bx(t, s, S.XGFPP, xg); for (const s of on[o]) bx(o, s, S.XGAPK, xg); if (ppU[t] >= 0) us[t][ppU[t] * 4 + 2] += xg; if (pkU[o] >= 0) ks[o][pkU[o] * 4 + 2] += xg; }
      // goal?
      const g = C[o].goalies[gIdx[o]];
      let pG;
      if (pulled[o]) pG = Math.min(0.9, 0.45 + xg);
      else pG = Math.min(0.95, 0.875 * c.goalScale * xg * c.fin[shooter] * Math.exp(g.log + (tier === 2 ? g.hd : 0) + gForm[o]));
      const goal = rng.chance(pG);
      const onNet = goal || rng.chance(0.67 - (tier === 0 ? 0.05 : 0));
      const gb2 = gb[o], go = gIdx[o] * NG;
      if (!pulled[o]) {
        gb2[go + G.FA]++; gb2[go + G.XGA] += xg;
        if (isFive) gb2[go + G.XGA5] += xg;
        if (pkNow === false && st[o] === -1) gb2[go + G.XGAPK] += xg;
        gb2[go + (tier === 2 ? G.XGAHD : tier === 1 ? G.XGAMD : G.XGALD)] += xg;
        if (reb) gb2[go + G.XGAREB] += xg;
        if (rush) gb2[go + G.XGARUSH] += xg;
      }
      if (!onNet) {
        if (rec) rec.push({ t, sh: c.P[shooter].id, g: pulled[o] ? -1 : g.p.id, x, y, xg, r: 0, dg: tier, st: st[t], reb, rush, ot, cs, type, per, pas: passer >= 0 ? c.P[passer].id : -1, sd });
        return;
      }
      // on goal
      tsa[T.SF]++; tsd[T.SA]++; bx(t, shooter, S.SOG, 1); tsa[T.ONNETF]++; tsd[T.ONNETA]++;
      if (passer >= 0) { bx(t, passer, S.SA1, 1); if (tier === 2) bx(t, passer, S.HDSA, 1); if (cs) bx(t, passer, S.CSA, 1); if (rush) bx(t, passer, S.RSA, 1); if (ppNow) bx(t, passer, S.PPSA, 1); }
      if (ppNow) { tsa[T.PPSF]++; tsd[T.PKSA]++; bx(t, shooter, S.PPSOG, 1); if (ppU[t] >= 0) us[t][ppU[t] * 4 + 3]++; if (pkU[o] >= 0) ks[o][pkU[o] * 4 + 3]++; }
      if (isFive) { tsa[T.SF5]++; tsd[T.SA5]++; bx(t, shooter, S.SOG5, 1); onIce5(t, 'SF5', 'SA5', 1); lineAcc(t, 7, 8, 1); }
      // net location (shooter's view, feet): nx ∈ [-3,3], ny ∈ [0,4]
      const nx = Math.max(-2.95, Math.min(2.95, rng.normal(0, goal ? 2.0 : 1.4)));
      const ny = goal ? (rng.chance(0.47) ? rng.next() * 1.2 : rng.chance(0.4) ? 1.2 + rng.next() * 1.4 : 2.6 + rng.next() * 1.35) : Math.pow(rng.next(), 0.9) * 3.9;
      if (!pulled[o]) {
        const gs = gIdx[o] * NG;
        const glove = (g.p.catches === 'L') ? nx > 0.4 : nx < -0.4;
        const blocker = (g.p.catches === 'L') ? nx < -0.4 : nx > 0.4;
        const add = (k1, k2) => { gb2[gs + G[k1]]++; if (goal) gb2[gs + G[k2]]++; };
        add('SA', 'GA');
        if (isFive) add('SA5', 'GA5');
        if (st[o] === -1) add('SAPK', 'GAPK');
        add(tier === 2 ? 'SAHD' : tier === 1 ? 'SAMD' : 'SALD', tier === 2 ? 'GAHD' : tier === 1 ? 'GAMD' : 'GALD');
        if (reb) add('SAREB', 'GAREB');
        if (rush) add('SARUSH', 'GARUSH');
        if (ot) add('SAOT', 'GAOT');
        if (cs) add('SACS', 'GACS');
        if (glove) add('SAGL', 'GAGL'); else if (blocker) add('SABL', 'GABL');
        if (ny > 2.2) add('SAHI', 'GAHI'); else if (ny < 1.0) add('SALO', 'GALO');
        if (per === 3) add('SAP3', 'GAP3');
        if (sd < 0) add('SATR', 'GATR'); else if (sd > 0) add('SALE', 'GALE');
      }
      if (rec) rec.push({ t, sh: c.P[shooter].id, g: pulled[o] ? -1 : g.p.id, x, y, xg, r: goal ? 2 : 1, dg: tier, st: st[t], reb, rush, ot, cs, type, per, pas: passer >= 0 ? c.P[passer].id : -1, nx, ny, sd });
      if (goal) {
        scoreGoal(t, shooter, passer, xg, tier);
      } else if (!pulled[o]) {
        // save — rebound chance governed by goalie rebound control
        if (rng.chance(0.065 * g.reb)) { gb2[gIdx[o] * NG + G.REBA]++; attempt(t, true, segSec); }
      }
    }

    function onIce5(t, kf, ka, v) {
      const o = 1 - t, a = S[kf], b = S[ka];
      for (const s of on[t]) box[t][s * NS + a] += v;
      for (const s of on[o]) box[o][s * NS + b] += v;
    }
    function lineAcc(t, kf, ka, v) {
      const o = 1 - t;
      if (unit5[t][0] >= 0) { ls[t][unit5[t][0] * NL + kf] += v; ps[t][unit5[t][1] * NL + kf] += v; }
      if (unit5[o][0] >= 0) { ls[o][unit5[o][0] * NL + ka] += v; ps[o][unit5[o][1] * NL + ka] += v; }
    }

    function scoreGoal(t, shooter, passer, xg, tier) {
      const o = 1 - t, c = C[t];
      score[t]++;
      if (first < 0) first = t;
      const ppNow = st[t] === 1, pkNow = st[t] === -1;
      ts[t][T.GF]++; ts[o][T.GA]++;
      ts[t][per === 1 ? T.P1GF : per === 2 ? T.P2GF : T.P3GF] += per <= 3 ? 1 : 0;
      ts[o][per === 1 ? T.P1GA : per === 2 ? T.P2GA : T.P3GA] += per <= 3 ? 1 : 0;
      bx(t, shooter, S.G, 1);
      // assists — A1 is the recorded passer when there was one
      let a1 = passer;
      if (a1 < 0 && on[t].length > 1 && rng.chance(0.82)) a1 = pickFrom(t, on[t], c.wPass, shooter);
      let a2 = -1;
      if (a1 >= 0 && on[t].length > 2 && rng.chance(0.72)) {
        let tot = 0; for (const s of on[t]) if (s !== shooter && s !== a1) tot += c.wPass[s] * (c.isD[s] ? 1.05 : 1);
        let x = rng.next() * tot;
        for (const s of on[t]) { if (s === shooter || s === a1) continue; x -= c.wPass[s] * (c.isD[s] ? 1.05 : 1); if (x <= 0) { a2 = s; break; } }
      }
      if (a1 >= 0) bx(t, a1, S.A1, 1);
      if (a2 >= 0) bx(t, a2, S.A2, 1);
      if (five) {
        bx(t, shooter, S.G5, 1); if (a1 >= 0) bx(t, a1, S.A5, 1); if (a2 >= 0) bx(t, a2, S.A5, 1);
        onIce5(t, 'GF5', 'GA5', 1); lineAcc(t, 5, 6, 1);
        ts[t][T.GF5]++; ts[o][T.GA5]++;
      }
      if (ppNow) {
        bx(t, shooter, S.PPG, 1); if (a1 >= 0) bx(t, a1, S.PPA, 1); if (a2 >= 0) bx(t, a2, S.PPA, 1);
        ts[t][T.PPGF]++; ts[o][T.PKGA]++;
        if (ppU[t] >= 0) us[t][ppU[t] * 4 + 1]++;
        if (pkU[o] >= 0) ks[o][pkU[o] * 4 + 1]++;
        // release the earliest-expiring minor
        let bi = -1;
        for (let i = 0; i < box2[o].length; i++) if (!box2[o][i].major && (bi < 0 || box2[o][i].left < box2[o][bi].left)) bi = i;
        if (bi >= 0) box2[o].splice(bi, 1);
      }
      if (pkNow) { bx(t, shooter, S.SHG, 1); ts[t][T.SHGF]++; }
      if (pulled[o]) { ts[t][T.ENGF]++; ts[o][T.ENGA]++; }
      if (isOT) { bx(t, shooter, S.OTG, 1); over = true; }
      goals.push({ t, s: shooter, a1, a2, per, ppNow, pkNow, en: pulled[o], ot: isOT, five });
      // starter hook after a blow-up
      const og = C[o];
      if (!hooked[o] && per <= 2 && gIdx[o] === og.starter) {
        const ga = gb[o][gIdx[o] * NG + G.GA];
        if ((ga >= 5 && rng.chance(0.75)) || (ga === 4 && rng.chance(0.3))) {
          hooked[o] = true; gIdx[o] = 1 - gIdx[o]; gUsed[o].push(gIdx[o]);
          gForm[o] = rng.normal(0, og.goalies[gIdx[o]].formSd);
        }
      }
    }

    function penaltyCheck() {
      for (let t = 0; t < 2; t++) {
        if (pulled[t] || on[t].length === 0) continue;
        const o = 1 - t, c = C[t], oc = C[o];
        let mp = 0, md = 0;
        for (const s of on[t]) mp += c.pen[s];
        for (const s of on[o]) md += oc.drw[s];
        mp /= on[t].length; md /= Math.max(1, on[o].length);
        const h = (3.05 / REG_SEGS) * mp * md * Math.exp(-0.5 * c.team.lat.disc) * (box2[t].length ? 0.6 : 1);
        if (rng.chance(h)) {
          const culprit = pickFrom(t, on[t], c.pen, -1);
          const drawer = on[o].length ? pickFrom(o, on[o], oc.drw, -1) : -1;
          const major = rng.chance(0.025);
          box2[t].push({ left: major ? 8 : 3, major, slot: culprit });
          bx(t, culprit, S.PEN, 1); if (drawer >= 0) bx(o, drawer, S.PDRAW, 1);
          ts[t][T.PEN]++; ts[t][T.PIM] += major ? 5 : 2; if (major) ts[t][T.MAJ]++;
          ts[o][T.PPO]++; ts[t][T.TSH]++;
        }
      }
    }

    function faceoff(force) {
      if (!force && !rng.chance(0.56)) return;
      const ch = (t) => {
        let best = on[t][0], bv = -9;
        for (const s of on[t]) { if (C[t].isD[s]) continue; const v = C[t].fo[s] + (C[t].P[s].pos === 'C' ? 0.8 : 0); if (v > bv) { bv = v; best = s; } }
        return best;
      };
      if (!on[0].length || !on[1].length) return;
      const c0 = ch(0), c1 = ch(1);
      const pW = 1 / (1 + Math.exp(-(0.28 * (C[0].fo[c0] - C[1].fo[c1]) + 0.04)));
      const w = rng.chance(pW) ? 0 : 1, l = 1 - w;
      // zone from home perspective
      const tilt = 0.04 * (segOff[0] - segOff[1]);
      const r = rng.next();
      const zone = force ? 1 : r < 0.36 + tilt ? 0 : r < 0.72 ? 2 : 1; // 0 home OZ, 2 home DZ, 1 NZ
      const zoneFor = (t) => (zone === 1 ? 'N' : (zone === 0) === (t === 0) ? 'O' : 'D');
      const cw = w === 0 ? c0 : c1, cl = w === 0 ? c1 : c0;
      bx(w, cw, S.FOW, 1); bx(l, cl, S.FOL, 1);
      ts[w][T.FOW]++; ts[l][T.FOL]++;
      const zw = zoneFor(w), zl = zoneFor(l);
      bx(w, cw, zw === 'O' ? S.FOWO : zw === 'D' ? S.FOWD : S.FOWN, 1);
      bx(l, cl, zl === 'O' ? S.FOLO : zl === 'D' ? S.FOLD : S.FOLN, 1);
      if (zw === 'D') ts[w][T.FOWD]++; if (zl === 'D') ts[l][T.FOLD]++;
      if (zw === 'O') ts[w][T.FOWO]++; if (zl === 'O') ts[l][T.FOLO]++;
      if (C[l].fo[cl] > 0.9) bx(w, cw, S.FOWE, 1);
      if (C[w].fo[cw] > 0.9) bx(l, cl, S.FOLE, 1);
      for (let t = 0; t < 2; t++) {
        const z = zoneFor(t);
        if (z === 'O') { ts[t][T.OZFO]++; for (const s of on[t]) bx(t, s, S.OZFO, 1); }
        else if (z === 'D') { ts[t][T.DZFO]++; for (const s of on[t]) bx(t, s, S.DZFO, 1); }
      }
      // winning an offensive-zone draw boosts this shift's attempt rate
      return zoneFor(w) === 'O' ? w : -1;
    }

    function runSegment(segSec, forceFO) {
      chooseOnIce();
      const ozWin = faceoff(forceFO);
      const sk = [on[0].length, on[1].length];
      // TOI / usage
      for (let t = 0; t < 2; t++) {
        const o = 1 - t;
        const key = isOT ? S.TOIOT : (pulled[0] || pulled[1]) ? -1 : (sk[t] === 5 && sk[o] === 5) ? S.TOI5 : sk[t] > sk[o] ? S.TOIPP : sk[t] < sk[o] ? S.TOIPK : -1;
        let oppTal = 0, ownTal = 0;
        for (const s of on[o]) oppTal += C[o].tal[s];
        for (const s of on[t]) ownTal += C[t].tal[s];
        oppTal /= Math.max(1, on[o].length);
        for (const s of on[t]) {
          const b = s * NS;
          box[t][b + S.TOI] += segSec; if (key >= 0) box[t][b + key] += segSec;
          box[t][b + S.SHIFTS] += 1;
          if (five) { box[t][b + S.QOC] += oppTal * segSec; box[t][b + S.QOT] += ((ownTal - C[t].tal[s]) / (on[t].length - 1)) * segSec; }
        }
        if (!pulled[t] && !isOT) gb[t][gIdx[t] * NG + G.TOI] += segSec;
        if (isOT && !pulled[t]) gb[t][gIdx[t] * NG + G.TOI] += segSec;
        if (pulled[t]) ts[t][T.PULLT] += segSec;
        if (five) {
          ts[t][T.TOI5] += segSec;
          if (unit5[t][0] >= 0) { ls[t][unit5[t][0] * NL] += segSec; ps[t][unit5[t][1] * NL] += segSec; }
        }
        if (st[t] === 1) { ts[t][T.PPTOI] += segSec; if (ppU[t] >= 0) us[t][ppU[t] * 4] += segSec; }
        if (st[t] === -1) { ts[t][T.PKTOI] += segSec; if (pkU[t] >= 0) ks[t][pkU[t] * 4] += segSec; }
      }
      // hits
      for (let t = 0; t < 2; t++) {
        if (!on[t].length) continue;
        let ph = 0; for (const s of on[t]) ph += C[t].wHit[s];
        const lam = (18.5 / REG_SEGS) * (segSec / SEG) * (ph / on[t].length) * Math.exp(0.3 * C[t].team.lat.phy) * (isOT ? 0.3 : 1);
        const nh = rng.poisson(lam);
        for (let i = 0; i < nh; i++) {
          bx(t, pickFrom(t, on[t], C[t].wHit, -1), S.HIT, 1); ts[t][T.HIT]++;
          const v = on[1 - t].length ? on[1 - t][Math.floor(rng.next() * on[1 - t].length)] : -1;
          if (v >= 0) { bx(1 - t, v, S.HITT, 1); ts[1 - t][T.HITT]++; }
        }
      }
      // shot attempts — interleave both teams so mid-segment goals matter
      const n = [0, 0];
      for (let t = 0; t < 2; t++) {
        const o = 1 - t;
        const key = sk[t] * 10 + sk[o];
        const base = BASE[key] !== undefined ? BASE[key] : BASE[55];
        let lr = Math.log(base * segSec / 3600) + 0.2 * segOff[t] - 0.16 * segDef[o] + C[t].team.lat.pace + C[o].team.lat.pace + homeAdv[t] + restAdj[t];
        if (per >= 2 && !isOT) {
          const diff = score[t] - score[o];
          if (diff === -1) lr += 0.08; else if (diff <= -2) lr += 0.12; else if (diff === 1) lr -= 0.07; else if (diff >= 2) lr -= 0.1;
        }
        if (ozWin === t) lr += 0.08;
        n[t] = rng.poisson(Math.exp(lr));
      }
      let i0 = n[0], i1 = n[1];
      while ((i0 > 0 || i1 > 0) && !over) {
        const t = rng.next() < i0 / (i0 + i1) ? 0 : 1;
        if (t === 0) i0--; else i1--;
        attempt(t, false, segSec);
      }
      if (!isOT) penaltyCheck();
      // tick penalty clocks
      for (let t = 0; t < 2; t++) {
        for (let i = box2[t].length - 1; i >= 0; i--) { box2[t][i].left--; if (box2[t][i].left <= 0) box2[t].splice(i, 1); }
      }
    }

    // ---- regulation
    let lastGoals = 0;
    for (per = 1; per <= 3; per++) {
      for (let k = 0; k < 30; k++) {
        segIx = (per - 1) * 30 + k;
        const force = k === 0 || goals.length !== lastGoals;
        lastGoals = goals.length;
        runSegment(SEG, force);
      }
      if (per === 2) {
        const d = score[0] - score[1];
        if (d > 0) { ts[0][T.LEADP2]++; ts[1][T.TRAILP2]++; } else if (d < 0) { ts[1][T.LEADP2]++; ts[0][T.TRAILP2]++; }
      }
    }
    let type = 'REG';
    if (score[0] === score[1]) {
      type = 'OT'; isOT = true; per = 4; box2[0] = []; box2[1] = [];
      for (let k = 0; k < OT_SEGS && !over; k++) runSegment(OTSEG, k === 0);
      if (!over) {
        type = 'SO';
        const so = shootout(rng, C, gIdx);
        score[so]++;
      }
    }
    if (first >= 0) ts[first][T.FIRST] = 1;
    ts[0][T.SOGF] = ts[0][T.SF]; ts[1][T.SOGF] = ts[1][T.SF];

    // Game-winning goal: winner's goal number (loser's final + 1).
    const win = score[0] > score[1] ? 0 : 1;
    if (type !== 'SO') {
      const need = score[1 - win] + 1;
      let k = 0;
      for (const g of goals) if (g.t === win && ++k === need) { box[win][g.s * NS + S.GWG] += 1; break; }
    }
    // goalie of record = most TOI on each side
    const dec = [0, 1].map((t) => (gb[t][0 * NG + G.TOI] >= gb[t][1 * NG + G.TOI] ? 0 : 1));

    return { hg: score[0], ag: score[1], type, win, box, gb, ts, ls, ps, us, ks, goals, shots: rec, gUsed, dec };
  }

  function shootout(rng, C, gIdx) {
    const shooters = C.map((c) => [...Array(12).keys()].sort((a, b) => c.P[b].lat.sht - c.P[a].lat.sht));
    const p = (t, k) => {
      const c = C[t], s = shooters[t][k % 12], g = C[1 - t].goalies[gIdx[1 - t]].p;
      return 0.31 * Math.exp(0.15 * c.P[s].lat.sht - 0.12 * g.lat.stop);
    };
    const m = [0, 0];
    for (let r = 0; r < 3; r++) { if (rng.chance(p(1, r))) m[1]++; if (rng.chance(p(0, r))) m[0]++; }
    let r = 3;
    while (m[0] === m[1] && r < 40) {
      const a = rng.chance(p(1, r)) ? 1 : 0, h = rng.chance(p(0, r)) ? 1 : 0;
      m[0] += h; m[1] += a; r++;
    }
    return m[0] > m[1] ? 0 : 1;
  }

  NQ.sim = { buildTeamCtx, simulate, xgOf, XG, S, SK, NS, G, GK, NG, T, TK, NT, LS, NL, SEG };
})(globalThis.NQ = globalThis.NQ || {});

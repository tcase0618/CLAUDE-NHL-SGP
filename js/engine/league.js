/* ==========================================================================
 * NQ.league — builds the synthetic league: 32 franchises, 640 players.
 *
 * Each player carries a LATENT talent vector (the hidden "truth"). The
 * simulator consumes latents; every metric the terminal shows is then
 * MEASURED from simulated events (or derived with sample-size noise), so the
 * analytics layer has to recover talent from noisy data — just like reality.
 *
 * Roster slots (per team):
 *   0..11  forwards, line L = floor(slot/3), within line [C, LW, RW]
 *   12..17 defensemen, pair P = floor((slot-12)/2)
 *   18     starting goalie, 19 backup goalie
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const { TEAMS, FIRST, LAST, FEATURED } = NQ.data;

  const SK_KEYS = ['sht', 'vol', 'pm', 'trn', 'def', 'phy', 'fo', 'dis', 'drw', 'blk', 'skt', 'pp', 'iq'];
  const G_KEYS = ['stop', 'hd', 'reb', 'lat', 'cons', 'puck', 'stam'];

  // Archetype tilts (latent SD units).
  const F_ARCH = {
    'Sniper': { sht: 0.85, vol: 0.6, def: -0.3, phy: -0.2, pp: 0.3 },
    'Playmaker': { pm: 0.9, trn: 0.45, sht: -0.1, vol: -0.2, iq: 0.4, pp: 0.3 },
    'Two-Way': { def: 0.65, trn: 0.25, pm: 0.1, iq: 0.3, blk: 0.2 },
    'Power Fwd': { phy: 0.85, vol: 0.35, sht: 0.2, dis: -0.35, drw: 0.3 },
    'Grinder': { phy: 0.9, def: 0.2, sht: -0.45, pm: -0.35, blk: 0.3 },
    'Defensive': { def: 0.9, blk: 0.5, sht: -0.35, vol: -0.35, skt: 0.1 }
  };
  const D_ARCH = {
    'Offensive D': { pm: 0.75, trn: 0.65, vol: 0.45, pp: 0.6, def: -0.3, blk: -0.2 },
    'Two-Way D': { def: 0.35, trn: 0.35, pm: 0.2, iq: 0.3 },
    'Shutdown D': { def: 0.85, blk: 0.75, phy: 0.5, pm: -0.4, trn: -0.2, vol: -0.3 }
  };
  const LINE_MEAN = [0.95, 0.4, -0.25, -0.75];
  const PAIR_MEAN = [0.8, 0.15, -0.55];
  const LINE_ARCH = [
    ['Sniper', 'Playmaker', 'Power Fwd', 'Two-Way', 'Sniper', 'Playmaker'],
    ['Sniper', 'Playmaker', 'Two-Way', 'Power Fwd'],
    ['Two-Way', 'Grinder', 'Power Fwd', 'Defensive', 'Playmaker'],
    ['Grinder', 'Defensive', 'Grinder', 'Two-Way']
  ];
  const PAIR_ARCH = [['Offensive D', 'Two-Way D'], ['Two-Way D', 'Shutdown D'], ['Shutdown D', 'Two-Way D']];

  const offDrive = (l) => 0.3 * l.vol + 0.3 * l.pm + 0.25 * l.trn + 0.15 * l.sht;
  const talent = (l) => 0.55 * offDrive(l) + 0.45 * l.def;

  function makeSkater(rng, base, tilt, pos) {
    const lat = {};
    for (const k of SK_KEYS) lat[k] = 0.7 * base + (tilt[k] || 0) + rng.normal(0, 0.45);
    // Non-talent traits are less tied to tier.
    lat.dis = (tilt.dis || 0) + rng.normal(0, 0.8);
    lat.drw = (tilt.drw || 0) + 0.3 * lat.skt + rng.normal(0, 0.7);
    lat.phy = 0.25 * base + (tilt.phy || 0) + rng.normal(0, 0.75);
    lat.fo = pos === 'C' ? 0.4 * base + rng.normal(0, 0.8) : rng.normal(-1, 0.6);
    return lat;
  }

  function nameGen(rng, used) {
    for (let t = 0; t < 400; t++) {
      const n = [rng.pick(FIRST), rng.pick(LAST)];
      const key = n.join(' ');
      if (!used.has(key)) { used.add(key); return n; }
    }
    return [rng.pick(FIRST), rng.pick(LAST) + 'son'];
  }

  function bodyFor(rng, pos) {
    const ht = pos === 'G' ? rng.int(74, 78) : pos === 'D' ? rng.int(72, 77) : rng.int(69, 75);
    const wt = Math.round(ht * 2.72 + rng.normal(0, 9));
    return { ht, wt, age: rng.int(20, 35) };
  }

  /** Build the full league from a seed. */
  function build(seed) {
    const rng = new NQ.Rng(seed);
    const used = new Set();
    const players = [];
    const teams = [];

    TEAMS.forEach((t, ti) => {
      const [abbr, city, nick, conf, div, color, color2, tilt] = t;
      const team = {
        id: ti, abbr, city, name: nick, full: `${city} ${nick}`, conf, div, color, color2,
        lat: {
          off: tilt[0] + rng.normal(0, 0.04), def: tilt[1] + rng.normal(0, 0.04),
          pp: tilt[2] + rng.normal(0, 0.05), pk: tilt[3] + rng.normal(0, 0.05),
          pace: rng.normal(0, 0.06), phy: rng.normal(0, 0.2), disc: rng.normal(0, 0.12),
          fore: rng.normal(0, 1), exitq: rng.normal(0, 1), struct: rng.normal(0, 1)
        },
        roster: new Array(20),
        lines: [], pairs: [], pp: [], pk: [], ot: []
      };
      const feat = FEATURED[abbr];
      const usedNums = new Set();
      const numFor = (pref) => {
        let n = pref;
        while (!n || usedNums.has(n)) n = rng.int(2, 98);
        usedNums.add(n);
        return n;
      };
      const tierBoost = tilt[0] * 0.6 + tilt[1] * 0.4;

      // ---- forwards ----
      for (let L = 0; L < 4; L++) {
        const lineSlots = [];
        ['C', 'LW', 'RW'].forEach((pos, k) => {
          const slot = L * 3 + k;
          const arch = rng.pick(LINE_ARCH[L]);
          const base = LINE_MEAN[L] + tierBoost + rng.normal(0, 0.3);
          const lat = makeSkater(rng, base, F_ARCH[arch], pos);
          let nm, num;
          if (feat) { const f = feat.lines[L][k]; nm = [f[0], f[1]]; num = numFor(f[2]); used.add(nm.join(' ')); }
          else { nm = nameGen(rng, used); num = numFor(0); }
          const p = {
            id: players.length, teamId: ti, slot, first: nm[0], last: nm[1], num, pos, isG: false, isD: false,
            shoots: rng.chance(pos === 'RW' ? 0.55 : 0.35) ? 'R' : 'L', arch, lat, line: L + 1, ...bodyFor(rng, pos)
          };
          players.push(p); team.roster[slot] = p.id; lineSlots.push(slot);
        });
        team.lines.push({ idx: L, slots: lineSlots, chem: rng.normal(0, 0.11) });
      }
      // ---- defense ----
      for (let P = 0; P < 3; P++) {
        const pairSlots = [];
        for (let k = 0; k < 2; k++) {
          const slot = 12 + P * 2 + k;
          const arch = PAIR_ARCH[P][k] && rng.chance(0.75) ? PAIR_ARCH[P][k] : rng.pick(Object.keys(D_ARCH));
          const base = PAIR_MEAN[P] + tierBoost + rng.normal(0, 0.3);
          const lat = makeSkater(rng, base, D_ARCH[arch], 'D');
          let nm, num;
          if (feat) { const f = feat.pairs[P][k]; nm = [f[0], f[1]]; num = numFor(f[2]); used.add(nm.join(' ')); }
          else { nm = nameGen(rng, used); num = numFor(0); }
          const p = {
            id: players.length, teamId: ti, slot, first: nm[0], last: nm[1], num, pos: 'D', isG: false, isD: true,
            shoots: k === 0 ? 'L' : (rng.chance(0.6) ? 'R' : 'L'), arch, lat, pair: P + 1, ...bodyFor(rng, 'D')
          };
          players.push(p); team.roster[slot] = p.id; pairSlots.push(slot);
        }
        team.pairs.push({ idx: P, slots: pairSlots, chem: rng.normal(0, 0.09) });
      }
      // ---- goalies ----
      for (let k = 0; k < 2; k++) {
        const slot = 18 + k;
        const base = k === 0 ? 0.25 + tilt[4] * 2 + rng.normal(0, 0.55) : -0.45 + rng.normal(0, 0.5);
        const lat = {};
        for (const key of G_KEYS) lat[key] = 0.75 * base + rng.normal(0, 0.5);
        lat.share = k === 0 ? 0.62 + rng.uniform(0, 0.16) : 0;
        let nm, num;
        if (feat) { const f = feat.goalies[k]; nm = [f[0], f[1]]; num = numFor(f[2]); used.add(nm.join(' ')); }
        else { nm = nameGen(rng, used); num = numFor(rng.pick([1, 29, 30, 31, 33, 35, 37, 39, 40, 41, 70, 72])); }
        const p = {
          id: players.length, teamId: ti, slot, first: nm[0], last: nm[1], num, pos: 'G', isG: true, isD: false,
          catches: rng.chance(0.88) ? 'L' : 'R', arch: k === 0 ? 'Starter' : 'Backup', lat, ...bodyFor(rng, 'G')
        };
        players.push(p); team.roster[slot] = p.id;
      }

      // Featured franchise: give the headline center a true #1C profile.
      if (feat) {
        const c = players[team.roster[0]];
        Object.assign(c.lat, { pm: 2.0, trn: 1.7, vol: 1.4, sht: 1.3, def: 1.1, fo: 1.0, pp: 1.6, iq: 1.8 });
        c.arch = 'Two-Way'; c.age = 26; c.ht = 73; c.wt = 198; c.shoots = 'L';
        const g = players[team.roster[18]];
        Object.assign(g.lat, { stop: 1.35, hd: 1.2, reb: 0.9, lat: 1.0, cons: 1.1 });
        g.age = 27; g.ht = 76; g.wt = 208;
      }
      teams.push(team);
    });

    const league = { seed, teams, players, byAbbr: {} };
    teams.forEach((t) => { league.byAbbr[t.abbr] = t; });
    teams.forEach((t) => assignUnits(league, t, rng));
    return league;
  }

  /** Special-teams units + 3v3 units + deployment weights + role tags. */
  function assignUnits(league, team, rng) {
    const P = (slot) => league.players[team.roster[slot]];
    const F = [...Array(12).keys()], D = [12, 13, 14, 15, 16, 17];
    const by = (arr, f) => arr.slice().sort((a, b) => f(P(b).lat) - f(P(a).lat));

    const ppF = by(F, (l) => 0.45 * l.pp + 0.3 * l.sht + 0.25 * l.pm);
    const ppD = by(D, (l) => 0.5 * l.pp + 0.3 * l.pm + 0.2 * l.trn);
    team.pp = [
      { idx: 0, slots: [...ppF.slice(0, 4), ppD[0]], w: 0.64 },
      { idx: 1, slots: [...ppF.slice(4, 8), ppD[1]], w: 0.36 }
    ];
    const pkF = by(F, (l) => 0.6 * l.def + 0.2 * l.skt + 0.2 * l.blk);
    const pkD = by(D, (l) => 0.6 * l.def + 0.4 * l.blk);
    team.pk = [
      { idx: 0, slots: [pkF[0], pkF[1], pkD[0], pkD[1]], w: 0.56 },
      { idx: 1, slots: [pkF[2], pkF[3], pkD[2], pkD[3]], w: 0.44 }
    ];
    const otF = by(F, (l) => offDrive(l) + 0.3 * l.skt);
    const otD = by(D, (l) => offDrive(l) + 0.3 * l.skt);
    team.ot = [0, 1, 2].map((i) => ({ idx: i, slots: [otF[i * 2], otF[i * 2 + 1], otD[i]], w: [0.42, 0.34, 0.24][i] }));

    // Deployment weights (coach tendencies) — normalised.
    const lw = [0.32, 0.29, 0.23, 0.16].map((w) => w * Math.exp(rng.normal(0, 0.05)));
    const s1 = lw.reduce((a, b) => a + b, 0);
    team.lines.forEach((l, i) => { l.w = lw[i] / s1; });
    const pw = [0.40, 0.335, 0.265].map((w) => w * Math.exp(rng.normal(0, 0.04)));
    const s2 = pw.reduce((a, b) => a + b, 0);
    team.pairs.forEach((p, i) => { p.w = pw[i] / s2; });

    // Role tags for profile badges.
    for (let s = 0; s < 18; s++) {
      const p = P(s);
      const roles = [];
      if (s < 12) roles.push((s % 3 === 0 ? (p.line + 'C') : (p.pos === 'LW' ? 'L' : 'R') + p.line + 'W'));
      else roles.push('D' + p.pair);
      roles.push(p.arch);
      if (team.pp[0].slots.includes(s)) roles.push('PP1'); else if (team.pp[1].slots.includes(s)) roles.push('PP2');
      if (team.pk[0].slots.includes(s)) roles.push('PK1'); else if (team.pk[1].slots.includes(s)) roles.push('PK2');
      p.roles = roles;
      p.offWing = (p.pos === 'LW' && p.shoots === 'R') || (p.pos === 'RW' && p.shoots === 'L');
    }
    P(18).roles = ['G1', 'Starter']; P(19).roles = ['G2', 'Backup'];
  }

  /** A replacement-level call-up used when a player is scratched in a scenario. */
  function replacement(player) {
    const lat = {};
    for (const k of SK_KEYS) lat[k] = -1.0;
    lat.fo = player.pos === 'C' ? -0.6 : -1.2;
    if (player.isG) { for (const k of G_KEYS) lat[k] = -1.0; }
    return { ...player, id: -1 - player.id, first: 'Call-up', last: '(' + player.pos + ')', lat, replacement: true };
  }

  NQ.league = { build, replacement, offDrive, talent, SK_KEYS, G_KEYS };
})(globalThis.NQ = globalThis.NQ || {});

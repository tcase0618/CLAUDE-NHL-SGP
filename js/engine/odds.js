/* ==========================================================================
 * NQ.odds — normalized sportsbook quote interface.
 *
 * Quote (single):  { book, game_id, market, player_id, line, side, american, ts, status, source }
 * Quote (SGP):     { book, game_id, market:'sgp', legs:[{market, player_id, line, side}], american, ts, status, source }
 *
 * Sources: 'manual' (entered by the user), 'import' (JSON file), 'feed'
 * (data/artifacts/odds_snapshot.js written by ml/odds.py from an authorised
 * provider). The terminal ships with NO prices; nothing here invents one.
 * A quote is usable only if it validates, is fresh, is open, and matches an
 * exact upcoming game, player, market and line.
 * ========================================================================== */
(function (NQ) {
  'use strict';
  const odds = {};
  odds.MARKETS = {
    player_sog: { target: 'sk_sog', label: 'Shots on goal', entity: 'skater', stat: 'SOG' },
    player_points: { target: 'sk_points', label: 'Points', entity: 'skater', stat: 'PTS' },
    player_goals: { target: 'sk_goals', label: 'Goals', entity: 'skater', stat: 'G' },
    player_assists: { target: 'sk_assists', label: 'Assists', entity: 'skater', stat: 'A' },
    player_blocks: { target: 'sk_blocks', label: 'Blocked shots', entity: 'skater', stat: 'BLK' },
    player_hits: { target: 'sk_hits', label: 'Hits', entity: 'skater', stat: 'HIT' },
    player_ppp: { target: 'sk_ppp', label: 'Power-play points', entity: 'skater', stat: 'PPP' },
    goalie_saves: { target: 'g_saves', label: 'Saves', entity: 'goalie', stat: 'SV' }
  };
  odds.MAX_AGE_MIN = 30;
  const KEY = 'nq:quotes:v1';

  odds.legKey = (l) => `${l.market}|${l.player_id}|${l.line}|${l.side}`;
  odds.sgpKey = (game, legs) => game + '#' + legs.map(odds.legKey).sort().join('&');

  /** Validate structure only (not freshness / matching). Returns error list. */
  odds.validate = (q) => {
    const e = [];
    if (!q || typeof q !== 'object') return ['not an object'];
    if (!q.book || typeof q.book !== 'string') e.push('book required');
    if (!q.game_id) e.push('game_id required');
    if (!q.ts || isNaN(Date.parse(q.ts))) e.push('ts (ISO timestamp) required');
    try { NQ.cv.toDecimal(q.american); } catch (x) { e.push('american odds invalid'); }
    const legs = q.market === 'sgp' ? q.legs : [q];
    if (q.market === 'sgp' && (!Array.isArray(q.legs) || ![3, 5, 8].includes(q.legs.length))) e.push('sgp requires exactly 3, 5 or 8 legs');
    (legs || []).forEach((l, i) => {
      if (!odds.MARKETS[l.market]) e.push(`leg ${i}: unsupported market ${l.market}`);
      if (!(l.player_id > 0)) e.push(`leg ${i}: player_id required`);
      if (!(typeof l.line === 'number' && isFinite(l.line) && l.line >= 0)) e.push(`leg ${i}: numeric line required`);
      if (!['over', 'under'].includes(l.side)) e.push(`leg ${i}: side must be over|under`);
    });
    if (q.market === 'sgp') {
      const keys = (q.legs || []).map(odds.legKey);
      if (new Set(keys).size !== keys.length) e.push('duplicate legs');
    }
    return e;
  };

  /**
   * Match a quote against the live context. ctx = { games: {id: {start_utc}},
   * players: {id: {game_id}}, now } → { ok, reasons[] }.
   */
  odds.match = (q, ctx) => {
    const r = odds.validate(q);
    const now = ctx.now || Date.now();
    const g = ctx.games[q.game_id];
    if (!g) r.push('game not in upcoming slate');
    else if (Date.parse(g.start_utc) <= now) r.push('game already started');
    if (q.status && q.status !== 'open') r.push('market ' + q.status);
    const age = (now - Date.parse(q.ts)) / 60000;
    if (age > (ctx.maxAgeMin || odds.MAX_AGE_MIN)) r.push(`stale (${Math.round(age)} min old)`);
    if (age < -5) r.push('timestamp in the future');
    const legs = q.market === 'sgp' ? q.legs || [] : [q];
    for (const l of legs) {
      const p = ctx.players[l.player_id];
      if (!p) r.push(`player ${l.player_id} not in projected lineup`);
      else if (String(p.game_id) !== String(q.game_id)) r.push(`player ${l.player_id} not in game ${q.game_id}`);
    }
    return { ok: r.length === 0, reasons: r };
  };

  // ---------------- storage (user-entered quotes live in this browser only)
  odds.load = () => {
    let a = [];
    try { a = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { a = []; }
    const feed = (globalThis.NQ_ODDS && Array.isArray(globalThis.NQ_ODDS.quotes)) ? globalThis.NQ_ODDS.quotes.map((q) => ({ ...q, source: 'feed' })) : [];
    return [...feed, ...a];
  };
  odds.saveUser = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.filter((q) => q.source !== 'feed'))); } catch (e) { /* storage unavailable */ } };
  odds.add = (q) => { const l = odds.load().filter((x) => x.source !== 'feed'); l.push({ ...q, source: q.source || 'manual' }); odds.saveUser(l); };
  odds.remove = (idx) => { const l = odds.load().filter((x) => x.source !== 'feed'); l.splice(idx, 1); odds.saveUser(l); };
  odds.importJSON = (text) => {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('expected a JSON array of quotes');
    const good = [], bad = [];
    for (const q of arr) { const e = odds.validate(q); if (e.length) bad.push({ q, e }); else good.push({ ...q, source: 'import' }); }
    odds.saveUser([...odds.load().filter((x) => x.source !== 'feed'), ...good]);
    return { added: good.length, rejected: bad };
  };

  /** Latest valid quote per (book, market key) — never mixes books. */
  odds.best = (quotes, ctx) => {
    const out = {};
    for (const q of quotes) {
      const m = odds.match(q, ctx);
      if (!m.ok) continue;
      const key = q.book + '|' + (q.market === 'sgp' ? odds.sgpKey(q.game_id, q.legs) : odds.legKey(q));
      if (!out[key] || Date.parse(q.ts) > Date.parse(out[key].ts)) out[key] = q;
    }
    return Object.values(out);
  };

  NQ.odds = odds;
})(globalThis.NQ = globalThis.NQ || {});

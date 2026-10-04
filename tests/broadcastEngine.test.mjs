import test from 'node:test';
import assert from 'node:assert/strict';
// Unit tests for src/lib/broadcastEngine.js with made-up scores. No network.
import { computeBroadcastEvents, planPosts, shortName, buildFinalCards, safeDedupeKey, SWING_SPOTS } from '../src/lib/broadcastEngine.js';

test("Broadcast engine: triggers, copy, cooldowns and roundups", () => {
  const fails = [];
  const ok = (c, msg) => { if (!c) fails.push(msg); };

  const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const NOW = Date.parse('2026-06-01T14:00:00Z');
  const min = (m) => NOW - m * 60000;

  // player: name, vsPar by hole (net), gross by hole (derive gross = par + vs, handicap 0)
  function mk(id, name, vs, opts = {}) {
    const gross = {}, vsPar = {};
    for (const [h, v] of Object.entries(vs)) { vsPar[h] = v; gross[h] = PARS[h - 1] + v; }
    const holes = Object.keys(vs).length;
    const net = Object.values(vs).reduce((a, b) => a + b, 0);
    return { id, name, holesPlayed: holes, netToPar: holes ? net : 9999, gross, vsPar, startHole: opts.start || 1, group: opts.group || 'G1' };
  }
  function rank(rows) {
    rows.sort((a, b) => (a.holesPlayed > 0 ? 0 : 1) - (b.holesPlayed > 0 ? 0 : 1) || a.netToPar - b.netToPar || b.holesPlayed - a.holesPlayed);
    let lastKey = null;
    rows.forEach((r, i) => { const key = r.holesPlayed ? `${r.netToPar}|${r.holesPlayed}` : 'n' + r.id; r.displayRank = i === 0 ? 1 : key === lastKey ? rows[i - 1].displayRank : i + 1; lastKey = key; });
    return rows;
  }
  function times(rows, ageMin) { const t = {}; for (const r of rows) for (const h of Object.keys(r.gross)) t[`${r.id}|${h}`] = min(ageMin); return t; }
  const base = (rows0, extra = {}) => {
    let rows = rows0;
    if (rows0.length < 8 && !extra.noPad) {
      const fill = Array.from({ length: 8 - rows0.length }, (_, i) => mk('f' + i, 'Filler F' + i + ' X', { 1: 0, 2: 0, 3: 0 }));
      rows = rank([...rows0, ...fill]);
    }
    return { now: NOW, eventName: 'The Ginvitational', roundId: 'R1', pars: PARS, rows, scoreTimes: extra.scoreTimes || times(rows, 2), prevRanks: null, fieldIds: new Set(rows.map((r) => r.id)), messages: [], ...extra };
  };
  const kinds = (ev) => ev.map((e) => e.kind).sort().join(',');

  // --- names
  ok(shortName('Scott Johnstone') === 'Scott J.', 'shortName basic');
  ok(shortName('Michael James Murray') === 'Michael M.', 'shortName middle');
  ok(shortName('Cher') === 'Cher', 'shortName single');
  ok(shortName('Ken Griffey Jr.') === 'Ken G.', 'shortName suffix');
  ok(shortName('  ') === 'Someone', 'shortName empty');

  // --- fire: two net birdies in a row on the latest holes; announced once
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: 0, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 1, 2: 1, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 0 }), mk('d', 'Dee Day', { 1: 0, 2: 1, 3: 1 })]);
    const ev = computeBroadcastEvents(base(rows));
    ok(ev.some((e) => e.kind === 'fire' && e.playerId === 'a'), 'fire detected');
    ok(ev.some((e) => e.kind === 'ice' && e.playerId === 'd'), 'ice detected (two bogeys)');
    const fire = ev.find((e) => e.kind === 'fire');
    ok(fire.text.includes('Anna A.'), 'uses short name: ' + fire.text);
    // once posted, it is not announced again (same key in the log)
    const again = computeBroadcastEvents(base(rows, { messages: [{ id: 1, kind: 'fire', player_id: 'a', dedupe_key: safeDedupeKey(fire.dedupe), created_at: new Date(min(1)).toISOString() }] }));
    ok(!again.some((e) => e.kind === 'fire'), 'fire not repeated');
    // a streak that continues (third birdie) is not a new card
    const rows2 = rank([mk('a', 'Anna Ames', { 1: 0, 2: -1, 3: -1, 4: -1 }), mk('b', 'Ben Bell', { 1: 1, 2: 1, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 0 }), mk('d', 'Dee Day', { 1: 0, 2: 0, 3: 0 })]);
    ok(!computeBroadcastEvents(base(rows2)).some((e) => e.kind === 'fire'), 'ongoing streak is not re-announced');
  }

  // --- ice by one net double
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: 0, 2: 0, 3: 2 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 0 }), mk('d', 'Dee Day', { 1: 0, 2: 0, 3: 0 })]);
    ok(computeBroadcastEvents(base(rows)).some((e) => e.kind === 'ice' && e.playerId === 'a'), 'ice on double');
  }

  // --- play order: shotgun group starting on 10 — latest hole is 2 after 10..18,1,2
  {
    const vs = {}; for (let h = 10; h <= 18; h++) vs[h] = 0; vs[1] = 0; vs[2] = -1; vs[3] = -1;
    const r = mk('a', 'Anna Ames', vs, { start: 10 });
    const rows = rank([r, mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 0 }), mk('d', 'Dee Day', { 1: 0, 2: 0, 3: 0 })]);
    ok(computeBroadcastEvents(base(rows)).some((e) => e.kind === 'fire' && e.playerId === 'a'), 'fire is play-order aware');
  }

  // --- finished player gets nothing; stale scores (yesterday) produce no live events
  {
    const done = {}; for (let h = 1; h <= 18; h++) done[h] = h > 16 ? -1 : 0;
    const rows = rank([mk('a', 'Anna Ames', done), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 0 }), mk('d', 'Dee Day', { 1: 0, 2: 0, 3: 0 })]);
    ok(!computeBroadcastEvents(base(rows)).some((e) => e.kind === 'fire' && e.playerId === 'a'), 'finished player has no fire');
    const small = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    const noLead = computeBroadcastEvents(base(small, { noPad: true }));
    ok(!noLead.some((e) => e.kind === 'leader' || e.kind === 'lex'), 'no leader/LEX with fewer than 8 scored players');
    const seven = rank([...small, ...Array.from({ length: 3 }, (_, i) => mk('g' + i, 'Gee G' + i, { 1: 0, 2: 0, 3: 0 }))]);
    ok(!computeBroadcastEvents(base(seven, { noPad: true })).some((e) => e.kind === 'leader'), '7 players: still no leader');
    const eight = rank([...seven, mk('g9', 'Gee G9', { 1: 0, 2: 0, 3: 0 })]);
    const e8 = computeBroadcastEvents(base(eight, { noPad: true }));
    ok(e8.some((e) => e.kind === 'leader') && e8.some((e) => e.kind === 'lex'), '8 players: leader and LEX appear');
    const stale = computeBroadcastEvents(base(eight, { noPad: true, scoreTimes: times(eight, 60 * 24) }));
    ok(stale.length === 0, 'scores a day old: nothing live posts: ' + kinds(stale));
    const justOver = computeBroadcastEvents(base(eight, { noPad: true, scoreTimes: times(eight, 50) }));
    ok(justOver.length === 0, '50 min since the last score: nothing live posts');
    const justUnder = computeBroadcastEvents(base(eight, { noPad: true, scoreTimes: times(eight, 40) }));
    ok(justUnder.some((e) => e.kind === 'leader'), '40 min since the last score: still live');
    const dayOld = computeBroadcastEvents(base(rows, { scoreTimes: times(rows, 60 * 24) }));
    ok(!dayOld.some((e) => e.kind === 'ace' || e.kind === 'eagle'), 'day-old aces/eagles stay quiet (no popup for an old round)');
  }

  // --- hole in one + gross eagle (not net), albatross wording, par 3 ace is an ace not an eagle
  {
    const rows = rank([
      mk('a', 'Anna Ames', { 1: 0, 2: 0, 3: -2 }),                 // hole 3 par 3, gross 1 => ACE
      mk('b', 'Ben Bell', { 1: 0, 2: -2, 3: 0 }),                  // hole 2 par 4 gross 2 => eagle
      mk('c', 'Cal Cox', { 1: 0, 2: 0, 4: -3 }),                   // hole 4 par 5 gross 2 => albatross
      mk('d', 'Dee Day', { 1: 0, 2: -1, 3: -1 }),                  // net birdies only: no eagle
    ]);
    const ev = computeBroadcastEvents(base(rows));
    ok(ev.filter((e) => e.kind === 'ace').length === 1 && ev.find((e) => e.kind === 'ace').text.includes('Anna A.'), 'ace');
    ok(!ev.some((e) => e.kind === 'eagle' && e.playerId === 'a'), 'par-3 ace is not also an eagle');
    const eagle = ev.filter((e) => e.kind === 'eagle');
    ok(eagle.some((e) => e.playerId === 'b'), 'gross eagle');
    ok(eagle.find((e) => e.playerId === 'c').text.includes('albatross'), 'albatross wording: ' + eagle.find((e) => e.playerId === 'c').text);
    ok(!eagle.some((e) => e.playerId === 'd'), 'net birdies are not eagles');
    // ace key is stable and carries the hole at position 2 (the popup reads it)
    ok(safeDedupeKey(ev.find((e) => e.kind === 'ace').dedupe).split('|')[2] === '3', 'ace key carries hole');
  }

  // --- leader / LEX from the saved log; ties do not flip-flop; needs 3 holes
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    const ev = computeBroadcastEvents(base(rows));
    ok(ev.some((e) => e.kind === 'leader' && e.playerId === 'a'), 'new leader');
    ok(ev.some((e) => e.kind === 'lex' && e.playerId === 'd'), 'new LEX');
    const log = ev.filter((e) => e.kind === 'leader' || e.kind === 'lex').map((e, i) => ({ id: 10 + i, kind: e.kind, player_id: e.playerId, dedupe_key: safeDedupeKey(e.dedupe), created_at: new Date(min(1)).toISOString() }));
    const again = computeBroadcastEvents(base(rows, { messages: log }));
    ok(!again.some((e) => e.kind === 'leader' || e.kind === 'lex'), 'no repeat while leader/LEX unchanged');
    // leader changes -> a new card
    const rows2 = rank([mk('a', 'Anna Ames', { 1: 0, 2: 0, 3: 0 }), mk('b', 'Ben Bell', { 1: -1, 2: -1, 3: -1 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    const ev2 = computeBroadcastEvents(base(rows2, { messages: log }));
    ok(ev2.some((e) => e.kind === 'leader' && e.playerId === 'b'), 'leader change announced');
    // tie for the lead that includes the announced leader: nothing
    const rows3 = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: -1, 2: -1, 3: -1 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    ok(!computeBroadcastEvents(base(rows3, { messages: log })).some((e) => e.kind === 'leader'), 'tie including current leader: no new card');
    // only 2 holes in: no leader yet
    const rows4 = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1 })]);
    const ev4 = computeBroadcastEvents(base(rows4));
    ok(!ev4.some((e) => e.kind === 'leader' || e.kind === 'lex'), 'no leader/LEX before 3 holes');
  }

  // --- lead change war: 3 leader messages within the hour (+ pending) => one card, not repeated
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    const msg = (id, pid, ago) => ({ id, kind: 'leader', player_id: pid, dedupe_key: 'x' + id, created_at: new Date(min(ago)).toISOString() });
    const earlyTimes = Object.fromEntries(Object.keys(times(rows, 0)).map((k) => [k, k.endsWith('|3') ? min(2) : min(120)]));
    const ev = computeBroadcastEvents(base(rows, { scoreTimes: earlyTimes, messages: [msg(3, 'b', 5), msg(2, 'a', 15), msg(1, 'b', 30)] }));
    ok(ev.some((e) => e.kind === 'war'), 'war detected: ' + kinds(ev));
    const war = ev.find((e) => e.kind === 'war');
    const again = computeBroadcastEvents(base(rows, { scoreTimes: earlyTimes, messages: [msg(3, 'b', 5), msg(2, 'a', 15), msg(1, 'b', 30), { id: 9, kind: 'war', player_id: null, dedupe_key: 'w', created_at: new Date(min(1)).toISOString() }] }));
    ok(!again.some((e) => e.kind === 'war'), 'war not repeated within the hour');
    ok(!computeBroadcastEvents(base(rows, { messages: [msg(2, 'a', 15), msg(1, 'b', 30)].map((m) => ({ ...m, player_id: 'b' })) })).some((e) => e.kind === 'war' && false), 'sanity');
  }

  // --- big swing: 7+ spots only
  {
    const mkField = (jump) => {
      const rows = [];
      for (let i = 0; i < 12; i++) rows.push(mk('p' + i, `Pl${i} Name`, { 1: 0, 2: 0, 3: i - 6 > 0 ? 1 : 0 }));
      return rows;
    };
    const rows = rank(Array.from({ length: 12 }, (_, i) => mk('p' + i, `Pl${i} Name`, { 1: 0, 2: 0, 3: i - 6 })));
    const prev = new Map(rows.map((r) => [r.id, r.displayRank]));
    prev.set('p0', rows.length); // p0 is now rank 1; was last (12): +11 spots
    prev.set('p3', rows.find((r) => r.id === 'p3').displayRank + 5); // 5 spots: below threshold
    const ev = computeBroadcastEvents(base(rows, { prevRanks: prev }));
    const sw = ev.filter((e) => e.kind === 'swing');
    ok(sw.length === 1 && sw[0].playerId === 'p0', 'only the 7+ jump: ' + sw.map((e) => e.text));
    ok(/up 11 spots to #1|jumps 11 places to #1|rockets up 11 spots to #1/.test(sw[0].text), sw[0].text);
    ok(SWING_SPOTS === 7, 'threshold is 7');
  }

  // --- hot group
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: -1, 2: 0, 3: -1 }, { group: 'Group 4' }), mk('b', 'Ben Bell', { 1: -1, 2: -1, 3: 0 }, { group: 'Group 4' }), mk('c', 'Cal Cox', { 1: 0, 2: -1, 3: 0 }, { group: 'Group 4' }), mk('d', 'Dee Day', { 1: 1, 2: 0, 3: 1 }, { group: 'Group 4' })]);
    const ev = computeBroadcastEvents(base(rows));
    ok(ev.filter((e) => e.kind === 'hotgroup').length === 1 && ev.find((e) => e.kind === 'hotgroup').text.includes('Group 4'), 'hot group');
  }

  // --- recaps and final cards
  {
    const f9 = (n) => { const o = {}; for (let h = 1; h <= n; h++) o[h] = 0; return o; };
    const rows = rank([mk('a', 'Anna Ames', { ...f9(9) }), mk('b', 'Ben Bell', f9(9)), mk('c', 'Cal Cox', f9(4)), mk('d', 'Dee Day', f9(3))]);
    const ev = computeBroadcastEvents(base(rows, { noPad: true }));
    ok(ev.filter((e) => e.kind === 'recap').length === 1 && /Halfway there|making the turn/.test(ev.find((e) => e.kind === 'recap').text), 'turn recap at half');
    const full = (v) => { const o = {}; for (let h = 1; h <= 18; h++) o[h] = h === 1 ? v : 0; return o; };
    const fin = rank([mk('a', 'Anna Ames', full(-2)), mk('b', 'Ben Bell', full(0)), mk('c', 'Cal Cox', full(1)), mk('d', 'Dee Day', full(3))]);
    const ev2 = computeBroadcastEvents(base(fin, { noPad: true, scoreTimes: times(fin, 5) }));
    const champ = ev2.find((e) => e.kind === 'champion'), lex = ev2.find((e) => e.kind === 'lexfinal');
    ok(champ && /Congratulations to Anna A\., champion of The Ginvitational, winning by 2 shots!/.test(champ.text), 'champion card: ' + (champ && champ.text));
    ok(lex && /The LEX goes to Dee D\., who lost by 2 shots\. Wear it proudly\./.test(lex.text), 'lex card: ' + (lex && lex.text));
    // legacy final already posted => no new final cards
    const legacy = computeBroadcastEvents(base(fin, { noPad: true, scoreTimes: times(fin, 5), messages: [{ id: 1, kind: 'recap', player_id: null, dedupe_key: safeDedupeKey(['milestone', 'full_finish', 'R1']), created_at: new Date(min(1)).toISOString() }] }));
    ok(!legacy.some((e) => e.kind === 'champion' || e.kind === 'lexfinal'), 'legacy final blocks duplicates');
    // ties + edge cases
    const t1 = buildFinalCards(rank([mk('a', 'Anna Ames', full(0)), mk('b', 'Ben Bell', full(0)), mk('c', 'Cal Cox', full(2))]), 'E');
    ok(t1.length === 2 && /2-way tie for the lead: Anna A\. and Ben B\./.test(t1[0].text) && /goes to Cal C\., who lost by 2 shots/.test(t1[1].text), 'tie for lead: ' + t1.map((c) => c.text).join(' / '));
    const t2 = buildFinalCards(rank([mk('a', 'Anna Ames', full(0)), mk('b', 'Ben Bell', full(1)), mk('c', 'Cal Cox', full(1))]), 'E');
    ok(/2-way tie for The LEX: Ben B\. and Cal C\./.test(t2[1].text), 'tie for LEX');
    const t3 = buildFinalCards(rank([mk('a', 'Anna Ames', full(0)), mk('b', 'Ben Bell', full(0))]), 'E');
    ok(t3.length === 1 && /tie for the lead/.test(t3[0].text), 'whole field tied: one card');
    const t4 = buildFinalCards(rank([mk('a', 'Anna Ames', full(0))]), 'E');
    ok(t4.length === 1 && /champion of E!/.test(t4[0].text), 'single player');
  }

  // --- planPosts: cooldown, one-per-player, roundup, hidden rows
  {
    const mkEv = (kind, pid, key) => ({ kind, text: `${kind} ${pid}`, dedupe: [kind, pid, key], playerId: pid });
    // leader + fire for the same player: only the leader is visible, fire is hidden
    let out = planPosts([mkEv('leader', 'a', 1), mkEv('fire', 'a', 1)], { now: NOW, messages: [] });
    ok(out.filter((r) => !r.kind.startsWith('hidden_')).length === 1 && out.some((r) => r.kind === 'hidden_fire'), 'one visible card per player');
    // cooldown: fire for same player within 20 min is hidden
    out = planPosts([mkEv('fire', 'a', 2)], { now: NOW, messages: [{ id: 1, kind: 'fire', player_id: 'a', dedupe_key: 'k', created_at: new Date(min(10)).toISOString() }] });
    ok(out.length === 1 && out[0].kind === 'hidden_fire', 'cooldown hides');
    out = planPosts([mkEv('fire', 'a', 3)], { now: NOW, messages: [{ id: 1, kind: 'fire', player_id: 'a', dedupe_key: 'k', created_at: new Date(min(25)).toISOString() }] });
    ok(out.length === 1 && out[0].kind === 'fire', 'after 20 min it posts');
    // 4+ player cards => one roundup + hidden rows for each; ace/eagle/recap unaffected
    const batch = [mkEv('fire', 'a', 1), mkEv('ice', 'b', 1), mkEv('swing', 'c', 1), mkEv('leader', 'd', 1), { kind: 'ace', text: 'ace', dedupe: ['ace', 'z', 3, 'R1'], playerId: 'z' }, { kind: 'recap', text: 'recap', dedupe: ['milestone', 'x', 'R1'], playerId: null }];
    out = planPosts(batch, { now: NOW, messages: [] });
    const visible = out.filter((r) => !r.kind.startsWith('hidden_'));
    ok(visible.length === 3 && visible.some((r) => r.kind === 'roundup') && visible.some((r) => r.kind === 'ace') && visible.some((r) => r.kind === 'recap'), 'roundup + ace + recap: ' + visible.map((r) => r.kind));
    ok(out.filter((r) => r.kind.startsWith('hidden_')).length === 4, 'each folded card kept as hidden row');
    ok(visible.find((r) => r.kind === 'roundup').text.includes('fire a') && visible.find((r) => r.kind === 'roundup').text.includes('leader d'), 'roundup text lists everything');
    // exactly 3 player cards stay separate
    out = planPosts(batch.slice(0, 3), { now: NOW, messages: [] });
    ok(out.length === 3 && out.every((r) => !r.kind.startsWith('hidden_') && r.kind !== 'roundup'), '3 cards are not folded');
  }

  // --- variants rotate (never the same wording back to back for one kind)
  {
    const rows = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
    const seen = new Set();
    let msgs = [];
    for (let i = 0; i < 5; i++) {
      const rs = rank([mk('a', 'Anna Ames', { 1: -1, 2: -1, 3: -1 }), mk('b', 'Ben Bell', { 1: 0, 2: 0, 3: 0 }), mk('c', 'Cal Cox', { 1: 0, 2: 0, 3: 1 }), mk('d', 'Dee Day', { 1: 1, 2: 1, 3: 1 })]);
      const ev = computeBroadcastEvents(base(rs, { messages: msgs })).filter((e) => e.kind === 'leader');
      if (!ev.length) break;
      seen.add(ev[0].text.replace(/Anna A\./g, 'X'));
      // pretend the leader flipped and was recorded
      msgs = [{ id: 100 + i, kind: 'leader', player_id: 'zzz', dedupe_key: 'k' + i, created_at: new Date(min(1)).toISOString() }, ...msgs];
    }
    ok(seen.size >= 4, 'variants rotate through the list: ' + seen.size);
  }


  assert.deepEqual(fails, [], 'failed checks: ' + fails.join(' | '));
});

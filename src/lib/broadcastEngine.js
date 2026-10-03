// The Broadcast engine: turns the scores already loaded (plus the message log
// already saved in the database) into broadcast cards. It is pure — no
// network, no React, no clock of its own — so it can be tested with made-up
// scores. App.jsx supplies the data and does the inserting.
//
// Nothing is remembered in the browser:
//   * 🔥 / ❄️ / eagle / hole-in-one / hot group / recaps read the scores only
//   * new leader / new LEX / lead-change war compare against the saved log
//   * big swing compares against standings recomputed "as of a few minutes
//     ago" from score timestamps (App.jsx passes those in as `prevRanks`)

export const LIVE_MS = 45 * 60 * 1000; // live moments only post while scores are coming in (newest score under 45 min old)
export const RARE_MS = 3 * 60 * 60 * 1000; // aces/eagles/recaps only announce while the scores are fresh (so an old round never pops up a hole-in-one)
export const COOLDOWN_MS = 20 * 60 * 1000; // same player + same kind of card
export const WAR_WINDOW_MS = 60 * 60 * 1000;
export const SWING_SPOTS = 7;
export const SWING_WINDOW_MS = 10 * 60 * 1000; // how far back "previous standings" looks
const MIN_HOLES = 3; // nobody is "the leader" or "The LEX" before 3 holes
const MIN_FIELD = 8; // ...and neither exists until 8 players have scores
const ROUNDUP_OVER = 3; // more than this many player cards at once → one combined card

/** "Scott Johnstone" -> "Scott J." (one name stays as-is; Jr./III style suffixes are skipped). */
export function shortName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  if (parts.length === 1) return parts[0];
  let last = parts[parts.length - 1];
  if (parts.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(last)) last = parts[parts.length - 2];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

export function formatToPar(n) {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function safeDedupeKey(parts) {
  return parts
    .map((p) => String(p ?? "").trim().toLowerCase().replace(/\s+/g, "_"))
    .join("|")
    .slice(0, 240);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** ---------- Copy ---------- (n = short name, e.g. "Scott J.") */
export const COPY = {
  leader: [
    ({ n, score, holes }) => `${n} grabs the lead at ${score} through ${holes}. Everyone else, take notes.`,
    ({ n, score, holes }) => `New leader: ${n}, ${score} through ${holes}. The rest of you have some work to do.`,
    ({ n, score, holes }) => `${n} takes the top spot. ${score} after ${holes} holes.`,
    ({ n, score }) => `The crown has a new owner. ${n} leads at ${score}.`,
    ({ n, score }) => `${n} climbs to the top at ${score}. Look who's in front.`,
  ],
  lex: [
    ({ n, score }) => `${n} takes over The LEX at ${score}. Someone check on them.`,
    ({ n, score, holes }) => `The LEX has a new tenant: ${n}, ${score} through ${holes}.`,
    ({ n }) => `${n} slides into The LEX. The headcover is on its way.`,
    ({ n, score }) => `Last place changes hands. ${n} wears The LEX at ${score}.`,
    ({ n, score }) => `${n} is now holding up the field at ${score}. Somebody has to.`,
  ],
  fire: [
    ({ n }) => `${n} has birdied two in a row and is on fire. 🔥`,
    ({ n }) => `Back-to-back birdies for ${n}. Somebody call the fire department.`,
    ({ n }) => `${n} is heating up: two straight net birdies.`,
    ({ n }) => `${n} can't miss right now. Two birdies in a row.`,
    ({ n }) => `Smoke coming off ${n}'s clubs. Two straight under par.`,
  ],
  ice: [
    ({ n }) => `${n} has gone cold. ❄️`,
    ({ n }) => `Ice cold for ${n}. Two rough holes in a row.`,
    ({ n }) => `${n} just hit a wall: the course won that one.`,
    ({ n }) => `Frost warning for ${n}. Time for a comeback.`,
    ({ n }) => `The course sent ${n} the bill on that hole. Damage control mode.`,
  ],
  swingUp: [
    ({ n, spots, rank }) => `${n} rockets up ${spots} spots to #${rank}!`,
    ({ n, spots, rank }) => `Big move: ${n} jumps ${spots} places to #${rank}.`,
    ({ n, spots, rank }) => `${n} makes a charge, up ${spots} to #${rank}.`,
  ],
  swingDown: [
    ({ n, spots, rank }) => `${n} tumbles ${spots} spots to #${rank}.`,
    ({ n, spots, rank }) => `Ouch: ${n} drops ${spots} places to #${rank}.`,
    ({ n, spots, rank }) => `${n} slips ${spots} spots to #${rank}. That one stung.`,
  ],
  eagle: [
    ({ n, what, hole }) => `🦅 ${n} made ${what} on #${hole}! Put it on the board.`,
    ({ n, gross, par, hole }) => `Eagle alert: ${n} carded a ${gross} on the par ${par} #${hole}.`,
    ({ n, what, hole }) => `${n} just soared on #${hole}: ${what}. 🦅`,
    ({ n, what, hole }) => `Wow. ${n} with ${what} on #${hole}.`,
  ],
  war: [
    ({ a, b }) => `${a} and ${b} keep trading the lead. This is a fight.`,
    () => `The lead has changed hands three times in an hour. Nobody wants to let go.`,
    ({ a, b }) => `Back and forth at the top. ${a} and ${b} are not giving an inch.`,
  ],
  hotGroup: [
    ({ group }) => `${group} is lighting it up: three players under par.`,
    ({ group }) => `Heads up: ${group} has three players under par. Keep an eye on them.`,
    ({ group }) => `${group} is on a tear. Three under par and counting.`,
  ],
  turn: [
    ({ top, bottom }) => `Halfway there. Leaders: ${top} | The LEX: ${bottom}`,
    ({ top, bottom }) => `The field is making the turn. Leaders: ${top} | The LEX: ${bottom}`,
  ],
  half: [
    ({ top, bottom }) => `Half the field is home. Leaders: ${top} | The LEX: ${bottom}`,
    ({ top, bottom }) => `Scorecards are coming in. Leaders: ${top} | The LEX: ${bottom}`,
  ],
};

/** Variant for the Nth card of a kind: seeded by the card's key, then rotated by how many came before, so one kind never repeats back to back. */
function pickVariant(templates, seedKey, sentBefore) {
  return templates[(fnv1a(seedKey) + sentBefore) % templates.length];
}

// What a card of each kind is called when it is folded into a combined card.
const baseKind = (kind) => String(kind || "").replace(/^hidden_/, "");

/**
 * Final results, once the whole field has finished: a Champion card and a LEX
 * card. A tie for either spot names everyone involved and says it is settled
 * on-site (the app has no tie breaker). Same rules as the old single message.
 */
export function buildFinalCards(ranked, eventName) {
  const shots = (n) => plural(n, "shot");
  const nm = (r) => shortName(r.name);
  const leadScore = ranked[0].netToPar;
  const leaders = ranked.filter((r) => r.netToPar === leadScore);
  const lexScore = ranked[ranked.length - 1].netToPar;
  const lexGroup = ranked.filter((r) => r.netToPar === lexScore);

  const tieLead = {
    kind: "champion",
    text: `It's a ${leaders.length}-way tie for the lead: ${joinNames(leaders.map(nm))}. We'll settle the championship with an on-site tie breaker.`,
  };
  if (ranked.length === 1) return [{ kind: "champion", text: `Congratulations to ${nm(ranked[0])}, champion of ${eventName}!` }];
  if (leaders.length === ranked.length) return [tieLead];

  const cards = [];
  if (leaders.length > 1) {
    cards.push(tieLead);
  } else {
    const runnerUp = ranked.find((r) => r.netToPar !== leadScore);
    cards.push({
      kind: "champion",
      text: `Congratulations to ${nm(leaders[0])}, champion of ${eventName}, winning by ${shots(runnerUp.netToPar - leaders[0].netToPar)}!`,
    });
  }

  if (lexGroup.length > 1) {
    cards.push({
      kind: "lexfinal",
      text: `A ${lexGroup.length}-way tie for The LEX: ${joinNames(lexGroup.map(nm))}. We'll settle that one on-site too.`,
    });
  } else {
    const above = [...ranked].reverse().find((r) => r.netToPar !== lexScore);
    cards.push({
      kind: "lexfinal",
      text: `And The LEX goes to ${nm(lexGroup[0])}, who lost by ${shots(lexGroup[0].netToPar - above.netToPar)}. Wear it proudly.`,
    });
  }
  return cards;
}

function standingsLine(ranked) {
  const fmt = (r, place) => `${place}. ${shortName(r.name)} ${formatToPar(r.netToPar)} (thru ${r.holesPlayed})`;
  const top = ranked.slice(0, 3).map((r, i) => fmt(r, i + 1)).join("  •  ");
  const bottomRows = ranked.slice(Math.max(0, ranked.length - 3));
  const bottom = bottomRows.map((r, i) => fmt(r, ranked.length - bottomRows.length + i + 1)).join("  •  ");
  return { top, bottom };
}

/** "Streak" state at sequence index i of a player's net-vs-par-in-play-order list: "fire" | "ice" | null. */
function streakAt(seq, i) {
  const a = seq[i];
  if (a == null) return null;
  const b = i > 0 ? seq[i - 1] : null;
  if (a >= 2) return "ice";
  if (b != null && a >= 1 && b >= 1) return "ice";
  if (b != null && a <= -1 && b <= -1) return "fire";
  return null;
}

const PRIORITY = { ace: 0, eagle: 1, leader: 2, lex: 3, fire: 4, ice: 5, swing: 6 };

/**
 * ctx:
 *   now, eventName, roundId, pars[18]
 *   rows[]    leaderboard order: { id, name, holesPlayed, netToPar, displayRank, gross:{h}, vsPar:{h}, startHole, group }
 *   scoreTimes{ "playerId|hole": ms }   for the active round
 *   prevRanks Map(playerId -> displayRank a few minutes ago)
 *   fieldIds  Set of player ids playing this round (for the turn / finish recaps)
 *   messages[]  saved log, newest first: { id, kind, player_id, dedupe_key, created_at }
 * Returns candidate events: { kind, text, dedupe[], playerId, priority? } — not yet de-duplicated against the log.
 */
export function computeBroadcastEvents(ctx) {
  const { now, eventName, roundId, pars, rows, scoreTimes, prevRanks, fieldIds, messages } = ctx;
  const played = rows.filter((r) => r.holesPlayed > 0);
  if (played.length === 0) return [];

  const times = Object.values(scoreTimes);
  const lastScoreMs = times.length ? Math.max(...times) : 0;
  const roundStartMs = times.length ? Math.min(...times) : now;
  const live = now - lastScoreMs <= LIVE_MS;
  const rare = now - lastScoreMs <= RARE_MS;

  const nameOf = new Map(rows.map((r) => [r.id, shortName(r.name)]));
  const log = messages
    .map((m) => ({ ...m, kind: baseKind(m.kind), at: new Date(m.created_at).getTime() }))
    .filter((m) => m.at >= roundStartMs - 60_000);
  const keysSeen = new Set(messages.map((m) => m.dedupe_key));
  const countKind = (k) => log.filter((m) => m.kind === k).length;
  const events = [];
  const add = (e) => events.push(e);

  // ---------- hole-in-one + gross eagle or better (scores only) ----------
  for (const r of played) {
    for (const [hStr, gross] of Object.entries(r.gross)) {
      const h = Number(hStr);
      const t = scoreTimes[`${r.id}|${h}`];
      if (t == null || now - t > RARE_MS) continue;
      const par = pars[h - 1];
      const n = shortName(r.name);
      if (gross === 1) {
        add({
          kind: "ace",
          text: `🎉 HOLE IN ONE: ${n} aced #${h}. Legend.`,
          dedupe: ["ace", r.id, h, roundId],
          playerId: r.id,
        });
      } else if (gross <= par - 2) {
        const key = ["eagle", r.id, h, roundId];
        const what = par - gross >= 3 ? "an albatross" : "an eagle";
        const text = pickVariant(COPY.eagle, safeDedupeKey(key), countKind("eagle"))({ n, what, gross, par, hole: h });
        add({ kind: "eagle", text, dedupe: key, playerId: r.id });
      }
    }
  }

  if (live) {
    // ---------- 🔥 on fire / ❄️ iced (scores only, play-order aware) ----------
    for (const r of played) {
      if (r.holesPlayed >= 18) continue;
      const start = Math.min(18, Math.max(1, Number(r.startHole) || 1));
      const seq = [];
      const holeAt = [];
      for (let i = 0; i < 18; i++) {
        const h = ((start - 1 + i) % 18) + 1;
        holeAt.push(h);
        seq.push(r.vsPar[h] == null ? null : r.vsPar[h]);
      }
      let last = -1;
      for (let i = 17; i >= 0; i--) {
        if (seq[i] != null) {
          last = i;
          break;
        }
      }
      if (last < 0) continue;
      const state = streakAt(seq, last);
      if (!state) continue;
      if (last > 0 && seq[last - 1] != null && streakAt(seq, last - 1) === state) continue; // streak already announced
      const t = scoreTimes[`${r.id}|${holeAt[last]}`];
      if (t == null || now - t > LIVE_MS) continue;
      const key = [state, r.id, roundId, holeAt[last]];
      const text = pickVariant(COPY[state], safeDedupeKey(key), countKind(state))({ n: shortName(r.name) });
      add({ kind: state, text, dedupe: key, playerId: r.id });
    }

    // ---------- new leader / new LEX (compared with the saved log) ----------
    let pendingLeader = null;
    const top = played.filter((r) => r.displayRank === 1);
    if (played.length >= MIN_FIELD && top.length && top.every((r) => r.holesPlayed >= MIN_HOLES)) {
      const lastMsg = log.find((m) => m.kind === "leader");
      if (!lastMsg || !top.some((r) => r.id === lastMsg.player_id)) {
        const r = top[0];
        const key = ["leader", roundId, r.id, lastMsg ? lastMsg.id : "first"];
        const text = pickVariant(COPY.leader, safeDedupeKey(key), countKind("leader"))({
          n: shortName(r.name),
          score: formatToPar(r.netToPar),
          holes: r.holesPlayed,
        });
        pendingLeader = { kind: "leader", text, dedupe: key, playerId: r.id };
        add(pendingLeader);
      }
    }

    const maxRank = Math.max(...played.map((r) => r.displayRank));
    const bottom = played.filter((r) => r.displayRank === maxRank);
    const overlapsLeader = bottom.some((r) => r.displayRank === 1);
    if (
      !overlapsLeader &&
      played.length >= MIN_FIELD &&
      bottom.every((r) => r.holesPlayed >= MIN_HOLES)
    ) {
      const lastMsg = log.find((m) => m.kind === "lex");
      if (!lastMsg || !bottom.some((r) => r.id === lastMsg.player_id)) {
        const r = bottom[0];
        const key = ["lex", roundId, r.id, lastMsg ? lastMsg.id : "first"];
        const text = pickVariant(COPY.lex, safeDedupeKey(key), countKind("lex"))({
          n: shortName(r.name),
          score: formatToPar(r.netToPar),
          holes: r.holesPlayed,
        });
        add({ kind: "lex", text, dedupe: key, playerId: r.id });
      }
    }

    // ---------- lead-change war: 3+ leader changes within an hour ----------
    const recentLeaders = log.filter((m) => m.kind === "leader" && now - m.at <= WAR_WINDOW_MS);
    const withPending = recentLeaders.length + (pendingLeader ? 1 : 0);
    const warRecent = log.some((m) => m.kind === "war" && now - m.at <= WAR_WINDOW_MS);
    if (withPending >= 3 && !warRecent) {
      const ids = [];
      if (pendingLeader) ids.push(pendingLeader.playerId);
      for (const m of recentLeaders) if (!ids.includes(m.player_id)) ids.push(m.player_id);
      if (ids.length >= 2) {
        const key = ["war", roundId, recentLeaders[0] ? recentLeaders[0].id : "first"];
        const text = pickVariant(COPY.war, safeDedupeKey(key), countKind("war"))({
          a: nameOf.get(ids[0]) || "Someone",
          b: nameOf.get(ids[1]) || "Someone",
        });
        add({ kind: "war", text, dedupe: key, playerId: null });
      }
    }

    // ---------- big swing (compared with standings a few minutes ago) ----------
    if (prevRanks) {
      for (const r of played) {
        const was = prevRanks.get(r.id);
        if (was == null || r.holesPlayed < MIN_HOLES) continue;
        const delta = was - r.displayRank;
        if (Math.abs(delta) < SWING_SPOTS) continue;
        const up = delta > 0;
        const key = ["swing", r.id, roundId, was, r.displayRank];
        const text = pickVariant(up ? COPY.swingUp : COPY.swingDown, safeDedupeKey(key), countKind("swing"))({
          n: shortName(r.name),
          spots: Math.abs(delta),
          rank: r.displayRank,
        });
        add({ kind: "swing", text, dedupe: key, playerId: r.id });
      }
    }

    // ---------- hot group: 3 players in one group under par ----------
    const byGroup = new Map();
    for (const r of played) {
      if (!r.group || r.holesPlayed < MIN_HOLES || r.netToPar >= 0) continue;
      byGroup.set(r.group, (byGroup.get(r.group) || 0) + 1);
    }
    for (const [group, count] of byGroup) {
      if (count < 3) continue;
      const key = ["hotgroup", group, roundId];
      add({
        kind: "hotgroup",
        text: pickVariant(COPY.hotGroup, safeDedupeKey(key), countKind("hotgroup"))({ group }),
        dedupe: key,
        playerId: null,
      });
    }
  }

  // ---------- field-progress recaps + final results (scores only) ----------
  if (rare && fieldIds && fieldIds.size > 0) {
    const field = rows.filter((r) => fieldIds.has(r.id));
    if (field.length > 0) {
      const turnPct = field.filter((r) => r.holesPlayed >= 9).length / field.length;
      const finishPct = field.filter((r) => r.holesPlayed >= 18).length / field.length;
      const line = standingsLine(played);
      if (turnPct >= 0.5) {
        const key = ["milestone", "half_turn", roundId];
        add({ kind: "recap", text: pickVariant(COPY.turn, safeDedupeKey(key), 0)(line), dedupe: key, playerId: null });
      }
      if (finishPct >= 0.5) {
        const key = ["milestone", "half_finish", roundId];
        add({ kind: "recap", text: pickVariant(COPY.half, safeDedupeKey(key), 0)(line), dedupe: key, playerId: null });
      }
      // The old single "full finish" message used this key; if it was already posted, don't announce twice.
      const legacyFinal = safeDedupeKey(["milestone", "full_finish", roundId]);
      if (finishPct >= 1 && !keysSeen.has(legacyFinal)) {
        for (const c of buildFinalCards(played, eventName)) {
          add({ kind: c.kind, text: c.text, dedupe: [`final_${c.kind}`, roundId], playerId: null });
        }
      }
    }
  }

  return events.filter((e) => !keysSeen.has(safeDedupeKey(e.dedupe)));
}

/**
 * Decides what actually gets saved from a batch of candidate events:
 *   - the same kind of card for the same player is held back for 20 minutes
 *   - one visible card per player per check (the highest-priority one)
 *   - more than 3 player cards at once fold into one combined card
 * Anything not shown is still saved as a hidden row (kind "hidden_…") so it is
 * never announced later. Aces and eagles are never held back or folded.
 * Returns rows { kind, text, dedupe, playerId } ready to insert.
 */
export function planPosts(events, { now, messages }) {
  const out = [];
  const hide = (e) => out.push({ ...e, kind: `hidden_${e.kind}` });

  const recent = (kind, pid) =>
    messages.some(
      (m) => baseKind(m.kind) === kind && m.player_id === pid && now - new Date(m.created_at).getTime() < COOLDOWN_MS
    );

  const standalone = [];
  const playerCards = [];
  for (const e of events) {
    const cooled = (e.kind === "fire" || e.kind === "ice" || e.kind === "swing") && recent(e.kind, e.playerId);
    if (cooled) {
      hide(e);
    } else if (e.kind === "ace" || e.kind === "eagle" || e.playerId == null) {
      standalone.push(e);
    } else {
      playerCards.push(e);
    }
  }

  // one card per player
  const best = new Map();
  for (const e of playerCards) {
    const cur = best.get(e.playerId);
    if (!cur || PRIORITY[e.kind] < PRIORITY[cur.kind]) best.set(e.playerId, e);
  }
  const kept = [];
  for (const e of playerCards) {
    if (best.get(e.playerId) === e) kept.push(e);
    else hide(e);
  }

  if (kept.length > ROUNDUP_OVER) {
    const keys = kept.map((e) => safeDedupeKey(e.dedupe)).sort();
    out.push({
      kind: "roundup",
      text: `The last few minutes: ${kept.map((e) => e.text).join("  •  ")}`,
      dedupe: ["roundup", fnv1a(keys.join(",")).toString(36)],
      playerId: null,
    });
    for (const e of kept) hide(e);
  } else {
    for (const e of kept) out.push(e);
  }
  for (const e of standalone) out.push(e);
  return out;
}

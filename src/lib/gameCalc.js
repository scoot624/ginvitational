/**
 * Multi-Game calculation engine.
 *
 * Pure functions only — no Supabase calls, no React. Takes the same raw
 * data App.jsx already loads (players, scores, games, teams) and computes
 * a leaderboard for any single game, regardless of format.
 *
 * This module is intentionally separate from App.jsx's existing
 * `leaderboardRows` calculation, which is left untouched. Nothing here
 * is wired into rendering yet — see gameResults in App.jsx.
 */

function clampInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1];
}

/** Handicap actually played, after a game's handicap %. Can be negative (a plus handicap). */
function playingHandicap(handicap, handicapPct) {
  return Math.round(clampInt(handicap, 0) * (clampInt(handicapPct, 100) / 100));
}

/**
 * Strokes allocated on one hole, by real stroke-index allocation.
 * Positive playing handicap: strokes are RECEIVED, starting at the #1
 * handicap hole (hardest) and working up, for as many holes as the
 * handicap covers (wrapping past 18 for handicaps > 18).
 * Negative playing handicap (a plus handicap): strokes are GIVEN BACK
 * instead, using that same hole order — so the return value goes
 * negative on those holes. `net = gross - strokesOnHoleForGame(...)`
 * keeps working unchanged either way.
 */
function strokesOnHoleForGame(handicap, handicapPct, holeNum, strokeIndex) {
  const h = playingHandicap(handicap, handicapPct);
  if (h === 0) return 0;
  const magnitude = Math.abs(h);
  const full = Math.floor(magnitude / 18);
  const rem = magnitude % 18;
  const si = strokeIndex[holeNum - 1];
  const strokes = full + (rem > 0 && si <= rem ? 1 : 0);
  return h > 0 ? strokes : -strokes;
}

function netScoreForHoleGame(grossScore, handicap, handicapPct, holeNum, strokeIndex) {
  return grossScore - strokesOnHoleForGame(handicap, handicapPct, holeNum, strokeIndex);
}

/**
 * Build { [playerId]: { [hole]: grossScore } } from the flat `scores` rows.
 * Pass `roundId` to scope to one round; omit it to use every row as-is
 * (the single-round/Simple-Mode case, where there's nothing to scope).
 */
export function buildScoresByPlayer(scores, roundId) {
  const map = new Map();
  for (const s of scores) {
    if (roundId != null && s.round_id !== roundId) continue;
    const pid = s.player_id;
    const h = clampInt(s.hole, 0);
    const sc = clampInt(s.score, 0);
    if (h < 1 || h > 18) continue;
    if (!map.has(pid)) map.set(pid, {});
    map.get(pid)[h] = sc;
  }
  return map;
}

/** Competition ranking (1,1,3...), only tying rows that have actually scored. */
function assignDisplayRanks(rows) {
  let lastKey = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = r.holesPlayed > 0 ? `${r.toPar}|${r.holesPlayed}` : `noscore|${r.id}`;
    if (i === 0) r.displayRank = 1;
    else if (key === lastKey) r.displayRank = rows[i - 1].displayRank;
    else r.displayRank = i + 1;
    lastKey = key;
  }
  return rows;
}

export function sortRows(rows) {
  rows.sort((a, b) => {
    const aHas = a.holesPlayed > 0;
    const bHas = b.holesPlayed > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.toPar !== b.toPar) return a.toPar - b.toPar;
    if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
    return a.name.localeCompare(b.name);
  });
  return assignDisplayRanks(rows);
}

/**
 * Individual Net / Individual Gross.
 * With handicap_pct: 100 this produces numbers identical to the app's
 * original hardcoded Individual Net formula.
 */
export function computeIndividualGameRows(game, players, scoresByPlayer, { PARS, STROKE_INDEX, fieldOffset }) {
  const isGross = game.format === "individual_gross";
  const pct = clampInt(game.handicap_pct, 100);
  const offset = clampInt(fieldOffset, 0);

  const rows = players.map((p) => {
    const scoresByHole = scoresByPlayer.get(p.id) || {};
    const playedHoles = Object.keys(scoresByHole)
      .map((x) => clampInt(x, 0))
      .filter((h) => h >= 1 && h <= 18)
      .sort((a, b) => a - b);

    const holesPlayed = playedHoles.length;
    // `handicap` is the player's real course handicap (for display).
    // Calculations use `playingBasisHandicap`, which is the same number
    // unless Field-Relative mode shifts it by the field's lowest handicap.
    const handicap = clampInt(p.handicap, 0);
    const playingBasisHandicap = handicap - offset;
    const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
    const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

    const totalCounted = isGross
      ? gross
      : playedHoles.reduce(
          (acc, h) => acc + netScoreForHoleGame(scoresByHole[h], playingBasisHandicap, pct, h, STROKE_INDEX),
          0
        );

    const toPar = holesPlayed === 0 ? 9999 : totalCounted - parPlayed;

    return {
      id: p.id,
      name: p.name,
      last: lastName(p.name),
      handicap,
      charity: p.charity,
      holesPlayed,
      toPar,
      scoresByHole,
      gross,
    };
  });

  return sortRows(rows);
}

/**
 * Picks the counted total for one team on one hole, per the game's
 * counting rule (e.g. {scoresCounted:2, slots:["gross","net"]}).
 * Slots are grouped by type; each type independently takes its N lowest
 * values among the team's members for that hole. Returns null if not
 * enough team members have posted a score yet to fill every slot type.
 */
function teamCountedTotalForHole(memberValues, countingRule) {
  const neededByType = new Map();
  for (const slot of countingRule.slots) {
    neededByType.set(slot, (neededByType.get(slot) || 0) + 1);
  }

  let total = 0;
  for (const [type, count] of neededByType.entries()) {
    const values = memberValues
      .map((m) => (type === "gross" ? m.gross : m.net))
      .filter((v) => v != null)
      .sort((a, b) => a - b);

    if (values.length < count) return null;
    for (let i = 0; i < count; i++) total += values[i];
  }
  return total;
}

/** 2-Man / 4-Man Better Ball (or any team format using a counting rule). */
export function computeTeamGameRows(game, teams, teamMembersByTeam, playersById, scoresByPlayer, { PARS, STROKE_INDEX, fieldOffset }) {
  const pct = clampInt(game.handicap_pct, 100);
  const offset = clampInt(fieldOffset, 0);
  const countingRule = game.counting_rule || { scoresCounted: 1, slots: ["net"] };
  // Comparing N summed strokes against a single hole's par overstates
  // "to par" whenever N > 1 (e.g. Combined Score's two summed net scores
  // vs. one hole's par) — the baseline has to scale with how many scores
  // are actually being added together each hole.
  const parMultiplier = clampInt(countingRule.scoresCounted, 1);

  const rows = teams.map((team) => {
    const memberIds = teamMembersByTeam.get(team.id) || [];
    const members = memberIds.map((pid) => playersById.get(pid)).filter(Boolean);

    let holesPlayed = 0;
    let totalCounted = 0;
    let parPlayed = 0;
    const countedByHole = {};

    for (let h = 1; h <= 18; h++) {
      const memberValues = members
        .map((p) => {
          const scoresByHole = scoresByPlayer.get(p.id) || {};
          const gross = scoresByHole[h];
          if (gross == null) return null;
          const net = netScoreForHoleGame(gross, clampInt(p.handicap, 0) - offset, pct, h, STROKE_INDEX);
          return { playerId: p.id, gross, net };
        })
        .filter(Boolean);

      const counted = teamCountedTotalForHole(memberValues, countingRule);
      if (counted == null) continue;

      countedByHole[h] = counted;
      holesPlayed += 1;
      totalCounted += counted;
      parPlayed += PARS[h - 1] * parMultiplier;
    }

    const toPar = holesPlayed === 0 ? 9999 : totalCounted - parPlayed;

    return {
      id: team.id,
      name: team.name,
      last: team.name,
      members: members.map((p) => ({ id: p.id, name: p.name, handicap: clampInt(p.handicap, 0) })),
      holesPlayed,
      toPar,
      scoresByHole: countedByHole,
      gross: totalCounted,
    };
  });

  return sortRows(rows);
}

/** { holeNumber: segment } from a composite game's `segments` array. */
function buildHoleSegmentMap(segments) {
  const map = new Map();
  for (const seg of segments || []) {
    for (const h of seg.holes || []) map.set(clampInt(h, 0), seg);
  }
  return map;
}

/**
 * Composite (multi-format) round: 18 holes split into segments, each with
 * its own format and handicap rule.
 *
 * - "individual" segments (Best Ball, Combined Score, ...) reuse the same
 *   per-player counting-rule engine as computeTeamGameRows.
 * - "shared" segments (Scramble) use ONE team score per hole (Enter Scores
 *   saves the same value under every teammate, so any member's entry is
 *   the team's score) plus a blended team handicap: handicapAllowance.lowPct
 *   applied to the lower-handicap partner, .highPct to the higher.
 * A hole not covered by any segment is skipped entirely (not counted,
 * par not added) rather than guessed at.
 */
export function computeCompositeGameRows(game, teams, teamMembersByTeam, playersById, scoresByPlayer, { PARS, STROKE_INDEX, fieldOffset }) {
  const holeSegment = buildHoleSegmentMap(game.segments);
  const offset = clampInt(fieldOffset, 0);

  const rows = teams.map((team) => {
    const memberIds = teamMembersByTeam.get(team.id) || [];
    const members = memberIds.map((pid) => playersById.get(pid)).filter(Boolean);

    let holesPlayed = 0;
    let totalCounted = 0;
    let parPlayed = 0;
    const countedByHole = {};

    for (let h = 1; h <= 18; h++) {
      const seg = holeSegment.get(h);
      if (!seg) continue;

      let counted = null;
      let parMultiplier = 1;

      if (seg.formatType === "shared") {
        // One shared team score per hole — always compared against a single
        // hole's par (parMultiplier stays 1), regardless of team size.
        const grosses = members
          .map((p) => (scoresByPlayer.get(p.id) || {})[h])
          .filter((v) => v != null);

        if (grosses.length > 0) {
          const gross = grosses[0]; // entry flow saves the same value to every teammate
          const allowance = seg.handicapAllowance || { lowPct: 100, highPct: 0 };
          const hcps = members.map((p) => clampInt(p.handicap, 0) - offset).sort((a, b) => a - b);
          const lowHcp = hcps[0] ?? 0;
          const highHcp = hcps[hcps.length - 1] ?? lowHcp;
          const teamHandicap = Math.round(
            lowHcp * (clampInt(allowance.lowPct, 0) / 100) + highHcp * (clampInt(allowance.highPct, 0) / 100)
          );
          counted = netScoreForHoleGame(gross, teamHandicap, 100, h, STROKE_INDEX);
        }
      } else {
        const pct = clampInt(seg.handicapPct, 100);
        const memberValues = members
          .map((p) => {
            const gross = (scoresByPlayer.get(p.id) || {})[h];
            if (gross == null) return null;
            const net = netScoreForHoleGame(gross, clampInt(p.handicap, 0) - offset, pct, h, STROKE_INDEX);
            return { playerId: p.id, gross, net };
          })
          .filter(Boolean);

        const rule = seg.countingRule || { scoresCounted: 1, slots: ["net"] };
        counted = teamCountedTotalForHole(memberValues, rule);
        // Comparing N summed strokes against a single hole's par overstates
        // "to par" whenever N > 1 (e.g. Combined Score's two summed net
        // scores vs. one hole's par) — scale the baseline to match.
        parMultiplier = clampInt(rule.scoresCounted, 1);
      }

      if (counted == null) continue;

      countedByHole[h] = counted;
      holesPlayed += 1;
      totalCounted += counted;
      parPlayed += PARS[h - 1] * parMultiplier;
    }

    const toPar = holesPlayed === 0 ? 9999 : totalCounted - parPlayed;

    return {
      id: team.id,
      name: team.name,
      last: team.name,
      members: members.map((p) => ({ id: p.id, name: p.name, handicap: clampInt(p.handicap, 0) })),
      holesPlayed,
      toPar,
      scoresByHole: countedByHole,
      gross: totalCounted,
    };
  });

  return sortRows(rows);
}

/**
 * Combines one game's already-computed rows from several rounds into a
 * single "Overall" set of rows (same shape, so it renders exactly like
 * any other set of rows). A row that didn't play in a given round simply
 * contributes nothing from that round — its 9999 "no score" sentinel is
 * never summed in, only real holesPlayed/toPar/gross are.
 */
export function mergeGameRowsAcrossRounds(perRoundRows) {
  const byId = new Map();

  for (const rows of perRoundRows) {
    for (const r of rows) {
      if (!byId.has(r.id)) {
        byId.set(r.id, {
          id: r.id,
          name: r.name,
          last: r.last,
          handicap: r.handicap,
          charity: r.charity,
          members: r.members,
          holesPlayed: 0,
          toParSum: 0,
          gross: 0,
        });
      }
      if (r.holesPlayed <= 0) continue;
      const acc = byId.get(r.id);
      acc.holesPlayed += r.holesPlayed;
      acc.toParSum += r.toPar;
      acc.gross += r.gross;
    }
  }

  const rows = Array.from(byId.values()).map((acc) => ({
    id: acc.id,
    name: acc.name,
    last: acc.last,
    handicap: acc.handicap,
    charity: acc.charity,
    members: acc.members,
    holesPlayed: acc.holesPlayed,
    toPar: acc.holesPlayed === 0 ? 9999 : acc.toParSum,
    scoresByHole: {}, // hole numbers repeat per round, so a merged per-hole view isn't meaningful here
    gross: acc.gross,
  }));

  return sortRows(rows);
}

/** Dispatches to the right calculation by game.format. */
export function computeGameRows(game, ctx) {
  const { players, scoresByPlayer, teams, teamMembersByTeam, playersById, PARS, STROKE_INDEX, fieldOffset } = ctx;

  if (game.format === "individual_net" || game.format === "individual_gross") {
    return computeIndividualGameRows(game, players, scoresByPlayer, { PARS, STROKE_INDEX, fieldOffset });
  }

  if (game.format === "better_ball_2" || game.format === "better_ball_4") {
    const gameTeams = teams.filter((t) => t.game_id === game.id);
    return computeTeamGameRows(game, gameTeams, teamMembersByTeam, playersById, scoresByPlayer, {
      PARS,
      STROKE_INDEX,
      fieldOffset,
    });
  }

  if (game.format === "composite") {
    const gameTeams = teams.filter((t) => t.game_id === game.id);
    return computeCompositeGameRows(game, gameTeams, teamMembersByTeam, playersById, scoresByPlayer, {
      PARS,
      STROKE_INDEX,
      fieldOffset,
    });
  }

  return [];
}

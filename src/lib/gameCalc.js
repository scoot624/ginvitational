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

/** Handicap actually played, after a game's handicap %. */
function playingHandicap(handicap, handicapPct) {
  return Math.round(clampInt(handicap, 0) * (clampInt(handicapPct, 100) / 100));
}

function strokesOnHoleForGame(handicap, handicapPct, holeNum, strokeIndex) {
  const h = playingHandicap(handicap, handicapPct);
  if (h <= 0) return 0;
  const full = Math.floor(h / 18);
  const rem = h % 18;
  const si = strokeIndex[holeNum - 1];
  return full + (rem > 0 && si <= rem ? 1 : 0);
}

function netScoreForHoleGame(grossScore, handicap, handicapPct, holeNum, strokeIndex) {
  return grossScore - strokesOnHoleForGame(handicap, handicapPct, holeNum, strokeIndex);
}

/** Build { [playerId]: { [hole]: grossScore } } from the flat `scores` rows. */
export function buildScoresByPlayer(scores) {
  const map = new Map();
  for (const s of scores) {
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

function sortRows(rows) {
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
export function computeIndividualGameRows(game, players, scoresByPlayer, { PARS, STROKE_INDEX }) {
  const isGross = game.format === "individual_gross";
  const pct = clampInt(game.handicap_pct, 100);

  const rows = players.map((p) => {
    const scoresByHole = scoresByPlayer.get(p.id) || {};
    const playedHoles = Object.keys(scoresByHole)
      .map((x) => clampInt(x, 0))
      .filter((h) => h >= 1 && h <= 18)
      .sort((a, b) => a - b);

    const holesPlayed = playedHoles.length;
    const handicap = clampInt(p.handicap, 0);
    const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
    const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

    const totalCounted = isGross
      ? gross
      : playedHoles.reduce(
          (acc, h) => acc + netScoreForHoleGame(scoresByHole[h], handicap, pct, h, STROKE_INDEX),
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
export function computeTeamGameRows(game, teams, teamMembersByTeam, playersById, scoresByPlayer, { PARS, STROKE_INDEX }) {
  const pct = clampInt(game.handicap_pct, 100);
  const countingRule = game.counting_rule || { scoresCounted: 1, slots: ["net"] };

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
          const net = netScoreForHoleGame(gross, clampInt(p.handicap, 0), pct, h, STROKE_INDEX);
          return { playerId: p.id, gross, net };
        })
        .filter(Boolean);

      const counted = teamCountedTotalForHole(memberValues, countingRule);
      if (counted == null) continue;

      countedByHole[h] = counted;
      holesPlayed += 1;
      totalCounted += counted;
      parPlayed += PARS[h - 1];
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

/** Dispatches to the right calculation by game.format. */
export function computeGameRows(game, ctx) {
  const { players, scoresByPlayer, teams, teamMembersByTeam, playersById, PARS, STROKE_INDEX } = ctx;

  if (game.format === "individual_net" || game.format === "individual_gross") {
    return computeIndividualGameRows(game, players, scoresByPlayer, { PARS, STROKE_INDEX });
  }

  if (game.format === "better_ball_2" || game.format === "better_ball_4") {
    const gameTeams = teams.filter((t) => t.game_id === game.id);
    return computeTeamGameRows(game, gameTeams, teamMembersByTeam, playersById, scoresByPlayer, {
      PARS,
      STROKE_INDEX,
    });
  }

  return [];
}

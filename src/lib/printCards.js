// Which printable scorecards to print, and what is on each. Pure, no React.
//
// A team game (Better Ball, Scramble, Alternate Shot, Multi-Format Round) prints ONE CARD PER TEAM. Each hole on the
// card is either one shared box (scramble / alternate shot: the pair posts one score) or one box per player (better
// ball / total score), exactly as the game plays that hole, with the handicap-stroke dots worked out the same way the
// boards and the Enter Scores screen do. An individual game (or a team game with no teams built yet) prints one card
// per playing group, as it always has.

import { PARS, STROKE_INDEX } from "./course.js";
import { compositeSharedHandicap, computeGameRows, scrambleTeamHandicap, teamLabel } from "./gameCalc.js";
import { isSharedBallFormat, isTeamFormat } from "./gameConfig.js";
import { clampInt } from "./golf.js";

const MAX_COLUMNS = 4;

/**
 * Returns the cards in print order:
 *   { kind: "group", f, members }                               one playing group, a column per player (up to 4)
 *   { kind: "team", f, team, label, members, holes, anyShared }  one team; holes[h-1] = { shared, ballStrokes } for a
 *                                                               shared box, or { shared: false, strokes: { playerId: n } }
 * `f` is the playing group the card belongs to (its tee time, starting hole and code), or null for a team nobody is
 * grouped with yet.
 */
export function buildPrintCards({ foursomes, players, foursomePlayers, game, gameTeams, gameTeamMembers, fieldOffset }) {
  const playersById = new Map((players || []).map((p) => [p.id, p]));
  const membersOfGroup = (f) => {
    const pids = foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((x) => x.player_id);
    return players.filter((p) => pids.includes(p.id)).slice(0, MAX_COLUMNS);
  };
  const groupCard = (f, members) => ({ kind: "group", f, members });

  const teams = game && isTeamFormat(game.format) ? (gameTeams || []).filter((t) => t.game_id === game.id) : [];
  if (teams.length === 0) return foursomes.map((f) => groupCard(f, membersOfGroup(f)));

  // each team's players, in the order they were put on the team
  const teamMembersByTeam = new Map(teams.map((t) => [t.id, []]));
  for (const row of gameTeamMembers || []) if (teamMembersByTeam.has(row.team_id)) teamMembersByTeam.get(row.team_id).push(row.player_id);
  const membersOfTeam = (t) => (teamMembersByTeam.get(t.id) || []).map((id) => playersById.get(id)).filter(Boolean).slice(0, MAX_COLUMNS);

  // what every hole looks like for each team (shared ball or own balls, and who gets a stroke): the same numbers the boards use
  const rows = computeGameRows(game, {
    players, teams: gameTeams, teamMembersByTeam, playersById, PARS, STROKE_INDEX, fieldOffset, scoresByPlayer: new Map(),
  });
  const marksByTeam = new Map(rows.map((r) => [r.id, r.marksByHole || {}]));

  const teamCard = (t, f) => {
    const members = membersOfTeam(t);
    const marks = marksByTeam.get(t.id) || {};
    const holes = Array.from({ length: 18 }, (_, i) => marks[i + 1] || { shared: false, strokes: {} });
    return { kind: "team", f, team: t, label: teamLabel(members, t.name), members, holes, anyShared: holes.some((h) => h.shared) };
  };

  const onATeam = new Set();
  for (const t of teams) membersOfTeam(t).forEach((p) => onATeam.add(p.id));

  const cards = [];
  const placed = new Set();
  for (const f of foursomes) {
    const here = new Set(foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((fp) => fp.player_id));
    // a team's card goes with the group its first player is in, so a team is never printed twice for one round
    for (const t of teams) {
      const members = membersOfTeam(t);
      if (members.length === 0 || !here.has(members[0].id)) continue;
      cards.push(teamCard(t, f));
      placed.add(t.id);
    }
    // anyone in this group who isn't on a team still gets a card
    const rest = membersOfGroup(f).filter((p) => !onATeam.has(p.id));
    if (rest.length > 0) cards.push(groupCard(f, rest));
  }
  // teams whose players aren't in any playing group yet still get a card (with the group details left blank)
  for (const t of teams) if (!placed.has(t.id) && membersOfTeam(t).length > 0) cards.push(teamCard(t, null));
  return cards;
}

/**
 * What goes on a team card laid out like the Leaderboard's scorecard (holes across the top, rows down the side):
 *   Par           the team's par for each hole (two scores added = two pars)
 *   <each player> a box per player on every own-ball hole (gross), with that player's stroke dots. On a scramble /
 *                 alternate-shot hole the players' boxes join into ONE big box for the team ball (gross), with the
 *                 team ball's dots: the first player's cell spans every player row, the others are skipped.
 *   Team score    a box on every hole for the score that counts (net): the better ball on an own-ball hole, the team
 *                 ball after strokes on a shared one. It carries the Out / In / Total.
 *   Marker's score the last row: the marker (who keeps the card for the team) writes the team's score here hole by hole,
 *                 with its own Out / In / Total, so it can be checked against the Team score row before signing.
 * A card with no shared holes keeps a box per player in the Out / In / Total columns too; once any hole is shared those
 * player totals are greyed out (the Team score row has the totals).
 * Returns { parRow: [18 numbers], rows: [{ key, label, player?, cells: [{ box, dots, span, skip }] x 18, totals }] }.
 */
export function teamCardLayout(card) {
  const { members, holes, anyShared } = card;
  const n = members.length;
  const soloCounts = new Set(holes.map((h, i) => (h.shared ? null : Math.max(1, Math.round(h.par / PARS[i])))).filter(Boolean));

  // what the Team score row is on a card of only own-ball holes: how many scores count
  let how = "counting score";
  if (soloCounts.size === 1) {
    const k = [...soloCounts][0];
    how = k === 1 ? "better ball" : k === 2 && n === 2 ? "both added" : `best ${k} added`;
  }

  const rows = members.map((p, idx) => ({
    key: p.id,
    label: p.name,
    player: p,
    cells: holes.map((h) => {
      if (!h.shared) return { box: true, dots: (h.strokes || {})[p.id] || 0, span: 1 };
      return idx === 0 ? { box: true, dots: h.ballStrokes || 0, span: n } : { box: false, skip: true };
    }),
    totals: anyShared ? "hatch" : "box",
  }));
  rows.push({
    key: "team",
    label: anyShared ? "Team score (net)" : `Team score = ${how} (net)`,
    cells: holes.map(() => ({ box: true, dots: 0, span: 1 })),
    totals: "box",
  });
  rows.push({
    key: "marker",
    label: "Marker's score",
    cells: holes.map(() => ({ box: true, dots: 0, span: 1 })),
    totals: "box",
  });
  return { parRow: holes.map((h) => h.par), rows };
}

// ---------- the handicap rules printed on a team card ----------

/** [1,2,3,4,5,6,9] -> "1–6, 9" */
function holeRanges(holes) {
  const hs = [...holes].map(Number).sort((a, b) => a - b);
  const parts = [];
  let start = hs[0];
  let prev = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === prev + 1) {
      prev = hs[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = hs[i];
    prev = hs[i];
  }
  return parts.join(", ");
}

/** "(both added)" / "(best 3 added)" when more than one score counts on an own-ball hole; nothing for the usual best score. */
function alsoCounts(rule, teamSize) {
  const k = rule && Array.isArray(rule.slots) ? rule.slots.length : 1;
  if (k <= 1) return "";
  return k === 2 && teamSize === 2 ? " (both added)" : ` (best ${k} added)`;
}

/** "35% low + 15% high" for two players, "40/30/20/10%" (lowest to highest) for more */
function blendText(pcts) {
  const p = pcts.map((x) => clampInt(x, 0));
  return p.length === 2 ? `${p[0]}% low + ${p[1]}% high` : `${p.join("/")}%`;
}

/**
 * The handicap rules printed on a team card, kept to a few words each (joined with bullets in the heading):
 *   Better ball 90%
 *   Scramble 35% low + 15% high = team handicap 5
 *   Scramble 1–6: 35% low + 15% high (team 4)   Alternate Shot 7–12: 50% low + 50% high (team 9)   Better Ball 13–18: 100%
 *   Field-Relative
 * [] when there's no game (or an individual one).
 */
export function handicapRules({ game, members, fieldOffset }) {
  if (!game) return [];
  const off = clampInt(fieldOffset, 0);
  const n = (members || []).length;
  const out = [];

  if (game.format === "composite") {
    const segs = [...(game.segments || [])].sort((a, b) => Math.min(...a.holes) - Math.min(...b.holes));
    for (const seg of segs) {
      const name = String(seg.label || "").split(" (")[0] || (seg.formatType === "shared" ? "Shared ball" : "Own ball");
      if (seg.formatType === "shared") {
        const a = seg.handicapAllowance || { lowPct: 100, highPct: 0 };
        out.push(`${name} ${holeRanges(seg.holes)}: ${blendText([a.lowPct, a.highPct])} (team ${compositeSharedHandicap(members || [], seg, off)})`);
      } else {
        out.push(`${name} ${holeRanges(seg.holes)}: ${clampInt(seg.handicapPct, 100)}%${alsoCounts(seg.countingRule, n)}`);
      }
    }
  } else if (isSharedBallFormat(game.format)) {
    const name = game.format === "alt_shot_2" ? "Alternate shot" : "Scramble";
    const pcts = Array.isArray(game.handicap_allowance) ? game.handicap_allowance : [];
    out.push(`${name} ${blendText(pcts)} = team handicap ${scrambleTeamHandicap(members || [], game, off)}`);
  } else if (game.format === "better_ball_2" || game.format === "better_ball_4") {
    out.push(`Better ball ${clampInt(game.handicap_pct, 100)}%${alsoCounts(game.counting_rule, n)}`);
  } else {
    return [];
  }

  if (off !== 0) out.push("Field-Relative");
  return out;
}

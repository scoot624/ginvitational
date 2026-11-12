// Game format names, presets and defaults used by the Games admin and the leaderboard.

/** Multi-Game: format labels + one-tap presets (Admin "Add Game" flow) */
export const GAME_FORMAT_LABELS = {
  individual_net: "Individual Net",
  individual_gross: "Individual Gross",
  better_ball_2: "2-Man Better Ball",
  better_ball_4: "4-Man Better Ball",
  scramble_2: "2-Man Scramble",
  scramble_4: "4-Man Scramble",
  alt_shot_2: "2-Man Alternate Shot",
  composite: "Multi-Format Round",
  match_play: "Match Play",
  ryder_cup: "Ryder Cup",
};

export const GAME_FORMAT_TEAM_SIZE = {
  individual_net: 1,
  individual_gross: 1,
  better_ball_2: 2,
  better_ball_4: 4,
  scramble_2: 2,
  scramble_4: 4,
  alt_shot_2: 2,
  // composite's team size is admin-chosen (newGameTeamSize), not fixed by format
};

/** The "Team size" picker in Admin → Add Game: how many players play together. */
export const TEAM_SIZE_OPTIONS = [
  { size: 1, label: "Individual (1 player)" },
  { size: 2, label: "2-Man (pairs)" },
  { size: 4, label: "4-Man (full group)" },
];

/**
 * Which formats are offered for each team size, so the Format list only shows what fits. Match Play is under 1 and 2
 * (singles, four-ball and foursomes are chosen per match later); a Multi-Format Round is built for 2 or 4.
 */
export const FORMATS_BY_TEAM_SIZE = {
  1: ["individual_net", "individual_gross", "match_play"],
  2: ["better_ball_2", "scramble_2", "alt_shot_2", "composite", "match_play"],
  4: ["better_ball_4", "scramble_4", "composite"],
};

export const GAME_SCORE_LABELS = {
  individual_net: "Net vs Par",
  individual_gross: "Gross vs Par",
  better_ball_2: "Team vs Par",
  better_ball_4: "Team vs Par",
  scramble_2: "Team vs Par",
  scramble_4: "Team vs Par",
  alt_shot_2: "Team vs Par",
  composite: "Team vs Par",
};

// Default ranked handicap-% allowance (lowest handicap on the team through
// highest) offered when an admin picks a Scramble format — editable before
// creating the game.
export const SCRAMBLE_DEFAULT_PCTS = {
  scramble_2: [35, 15],
  scramble_4: [40, 30, 20, 10],
  alt_shot_2: [35, 15], // Alternate Shot is scored and handicapped exactly like the 2-Man Scramble
};

/**
 * One ball per team, one score per hole, and a blended team handicap: the 2-Man / 4-Man Scramble and 2-Man
 * Alternate Shot. They share all of their scoring, score entry and handicap code; only the name differs.
 */
export const isSharedBallFormat = (f) => f === "scramble_2" || f === "scramble_4" || f === "alt_shot_2";

// A composite game's per-segment format choices. "individual" segments
// (Best Ball, Combined Score) reuse the counting-rule engine; "shared"
// segments (Scramble) use one team score + a blended team handicap.
export const SEGMENT_FORMAT_OPTIONS = {
  best_ball: { label: "Better Ball (best score counts)", kind: "individual", scoresCounted: 1, slots: ["net"] },
  combined: { label: "Total Score (both count, added together)", kind: "individual", scoresCounted: 2, slots: ["net", "net"] },
  scramble: { label: "Scramble", kind: "shared" },
  alt_shot: { label: "Alternate Shot", kind: "shared", teamSizes: [2] }, // scored like the scramble; pairs only
};

/** The segment choices for a multi-format round of this team size ([key, option] pairs, in menu order). */
export function segmentOptionsFor(teamSize) {
  return Object.entries(SEGMENT_FORMAT_OPTIONS)
    .filter(([, o]) => !o.teamSizes || o.teamSizes.includes(teamSize))
    .map(([key, o]) => [key, key === "combined" && teamSize === 4 ? { ...o, label: "Total Score (two best scores added)" } : o]);
}

/** One segment choice for this team size, or Better Ball when the saved key doesn't exist for it. */
export function segmentOption(key, teamSize) {
  const opts = segmentOptionsFor(teamSize);
  return (opts.find(([k]) => k === key) || opts.find(([k]) => k === "best_ball"))[1];
}

// Each preset: { label, handicapPct, scoresCounted, slots }
export const GAME_PRESETS = {
  individual_net: [{ key: "standard", label: "Standard", handicapPct: 100, scoresCounted: 1, slots: ["net"] }],
  individual_gross: [{ key: "standard", label: "Standard", handicapPct: 100, scoresCounted: 1, slots: ["gross"] }],
  better_ball_2: [
    { key: "best_net", label: "Best Net", handicapPct: 90, scoresCounted: 1, slots: ["net"] },
    { key: "net_gross", label: "1 Net + 1 Gross", handicapPct: 90, scoresCounted: 2, slots: ["net", "gross"] },
  ],
  better_ball_4: [
    { key: "best_net", label: "Best Net", handicapPct: 80, scoresCounted: 1, slots: ["net"] },
    { key: "two_net", label: "2 Net", handicapPct: 80, scoresCounted: 2, slots: ["net", "net"] },
    { key: "two_gross_one_net", label: "2 Gross + 1 Net", handicapPct: 80, scoresCounted: 3, slots: ["gross", "gross", "net"] },
  ],
};

export const isMatchFormat = (f) => f === "match_play" || f === "ryder_cup";

// Game format names, presets and defaults used by the Games admin and the leaderboard.

/** Multi-Game: format labels + one-tap presets (Admin "Add Game" flow) */
export const GAME_FORMAT_LABELS = {
  individual_net: "Individual Net",
  individual_gross: "Individual Gross",
  better_ball_2: "2-Man Better Ball",
  better_ball_4: "4-Man Better Ball",
  scramble_2: "2-Man Scramble",
  scramble_4: "4-Man Scramble",
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
  // composite's team size is admin-chosen (newGameTeamSize), not fixed by format
};

export const GAME_SCORE_LABELS = {
  individual_net: "Net vs Par",
  individual_gross: "Gross vs Par",
  better_ball_2: "Team vs Par",
  better_ball_4: "Team vs Par",
  scramble_2: "Team vs Par",
  scramble_4: "Team vs Par",
  composite: "Team vs Par",
};

// Default ranked handicap-% allowance (lowest handicap on the team through
// highest) offered when an admin picks a Scramble format — editable before
// creating the game.
export const SCRAMBLE_DEFAULT_PCTS = {
  scramble_2: [35, 15],
  scramble_4: [40, 30, 20, 10],
};

// A composite game's per-segment format choices. "individual" segments
// (Best Ball, Combined Score) reuse the counting-rule engine; "shared"
// segments (Scramble) use one team score + a blended team handicap.
export const SEGMENT_FORMAT_OPTIONS = {
  best_ball: { label: "Better Ball (best score counts)", kind: "individual", scoresCounted: 1, slots: ["net"] },
  combined: { label: "Both Count (two scores added)", kind: "individual", scoresCounted: 2, slots: ["net", "net"] },
  scramble: { label: "Scramble", kind: "shared" },
};

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

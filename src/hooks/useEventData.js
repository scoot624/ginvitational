import { useEffect, useMemo, useRef, useState } from "react";
import { buildScoresByPlayer } from "../lib/gameCalc";
import { normalizeDrinking } from "../lib/drinks";
import { clampInt } from "../lib/golf";
import { buildLeaderboardRows } from "../lib/leaderboard";
import { fetchAllRows, supabase } from "../lib/supabase";
import { errToText } from "../lib/util";

// The app's data layer: everything loaded from the database (players, scores, groups, games, rounds,
// matches, Broadcast messages, settings), how it is refreshed, and the values worked out from it.
// App.jsx calls this once and shares the result with every screen.

export function useEventData({ tab }) {
  const [status, setStatus] = useState("Loading...");
  // Diagnostics (kept)
  const [lastLoadErrors, setLastLoadErrors] = useState([]);
  const [lastLoadAt, setLastLoadAt] = useState(null);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);
  // Multi-Game (Stage 2: loaded + computed, not yet rendered anywhere)
  const [games, setGames] = useState([]);
  const [gameTeams, setGameTeams] = useState([]);
  const [gameTeamMembers, setGameTeamMembers] = useState([]);
  const [appSettings, setAppSettings] = useState({
    multi_game_enabled: false,
    multi_round_enabled: false,
    event_name: "The Ginvitational",
    handicap_basis: "course",
  });

  // Multi-Round
  const [rounds, setRounds] = useState([]);

  const [broadcastMsgs, setBroadcastMsgs] = useState([]);
  const [broadcastLoaded, setBroadcastLoaded] = useState(false);
  const [brandingReady, setBrandingReady] = useState(true);
  // Foursomes data (admin + enter scores)
  const [foursomes, setFoursomes] = useState([]);
  const [foursomePlayers, setFoursomePlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [matchPlayers, setMatchPlayers] = useState([]);
  const [matchTablesReady, setMatchTablesReady] = useState(true);
  const [gamesConfigReady, setGamesConfigReady] = useState(true);
  const matchReady = matchTablesReady && gamesConfigReady; // false until migration 0012 has been run
  // Drinking Mode: the drinks logged, and whether the one-time database change (migration 0014) has been made.
  const [drinks, setDrinks] = useState([]);
  const [drinksTableReady, setDrinksTableReady] = useState(true);
  const [drinkingColumnReady, setDrinkingColumnReady] = useState(true);
  const drinkingReady = drinksTableReady && drinkingColumnReady;
  const drinkingEnabledRef = useRef(false); // lets the refresh timers skip the drinks request when the mode is off

  async function loadPlayers() {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("players")
        .select("id,name,handicap,charity,team_label,created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    );

    if (error) {
      console.error("loadPlayers error:", error);
      return { ok: false, where: "players", error: errToText(error) };
    }
    setPlayers(data || []);
    return { ok: true, where: "players" };
  }

  async function loadScores() {
    // Paged: the table passes 1,000 rows once there is a second round or a bigger field.
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("scores")
        .select("id,player_id,hole,score,round_id,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
    );

    if (error) {
      console.error("loadScores error:", error);
      return { ok: false, where: "scores", error: errToText(error) };
    }
    setScores(data || []);
    return { ok: true, where: "scores" };
  }

  async function loadFoursomes() {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("foursomes")
        .select("id,group_name,code,tee_time,starting_hole,round_id,created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    );

    if (error) {
      console.error("loadFoursomes error:", error);
      return { ok: false, where: "foursomes", error: errToText(error) };
    }
    setFoursomes(data || []);
    return { ok: true, where: "foursomes" };
  }

  async function loadRounds() {
    const { data, error } = await supabase
      .from("rounds")
      .select("id,label,sort_order,is_active,created_at")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("loadRounds error:", error);
      return { ok: false, where: "rounds", error: errToText(error) };
    }
    setRounds(data || []);
    return { ok: true, where: "rounds" };
  }

  async function loadFoursomePlayers() {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("foursome_players")
        .select("foursome_id,player_id,seat,created_at")
        .order("created_at", { ascending: true })
        .order("foursome_id", { ascending: true })
        .order("player_id", { ascending: true })
    );

    if (error) {
      console.error("loadFoursomePlayers error:", error);
      return { ok: false, where: "foursome_players", error: errToText(error) };
    }
    setFoursomePlayers(data || []);
    return { ok: true, where: "foursome_players" };
  }

  async function loadGames() {
    const baseCols =
      "id,name,format,handicap_pct,counting_rule,segments,handicap_allowance,is_default,active,locked,sort_order,created_at";
    // "config" holds Match Play / Ryder Cup settings and only exists once migration 0012 has been run.
    let { data, error } = await supabase.from("games").select(`${baseCols},config`).order("sort_order", { ascending: true });
    setGamesConfigReady(!error);
    if (error) {
      ({ data, error } = await supabase.from("games").select(baseCols).order("sort_order", { ascending: true }));
    }

    if (error) {
      console.error("loadGames error:", error);
      return { ok: false, where: "games", error: errToText(error) };
    }
    setGames(data || []);
    return { ok: true, where: "games" };
  }

  // Not an error if the tables aren't there yet — the feature just isn't set up (see MatchSetupNotice).
  async function loadMatches() {
    const m = await fetchAllRows(() =>
      supabase
        .from("matches")
        .select("id,game_id,round_id,match_type,label,sort_order,created_at")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
    );
    const p = m.error
      ? null
      : await fetchAllRows(() =>
          supabase
            .from("match_players")
            .select("match_id,player_id,side,position")
            .order("match_id", { ascending: true })
            .order("player_id", { ascending: true })
        );
    if (m.error || p?.error) {
      setMatches([]);
      setMatchPlayers([]);
      setMatchTablesReady(false);
      return { ok: true, where: "matches" };
    }
    setMatches(m.data || []);
    setMatchPlayers(p.data || []);
    setMatchTablesReady(true);
    return { ok: true, where: "matches" };
  }

  async function loadGameTeams() {
    const { data, error } = await supabase
      .from("game_teams")
      .select("id,game_id,name,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadGameTeams error:", error);
      return { ok: false, where: "game_teams", error: errToText(error) };
    }
    setGameTeams(data || []);
    return { ok: true, where: "game_teams" };
  }

  async function loadGameTeamMembers() {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("game_team_members")
        .select("game_id,team_id,player_id,created_at")
        .order("created_at", { ascending: true })
        .order("team_id", { ascending: true })
        .order("player_id", { ascending: true })
    );

    if (error) {
      console.error("loadGameTeamMembers error:", error);
      return { ok: false, where: "game_team_members", error: errToText(error) };
    }
    setGameTeamMembers(data || []);
    return { ok: true, where: "game_team_members" };
  }

  // Not an error if the table isn't there yet: Drinking Mode just isn't set up (see DrinkingSetupNotice).
  async function loadDrinks() {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("drinks")
        .select("id,player_id,round_id,hole,note,created_at")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    );
    if (error) {
      setDrinks([]);
      setDrinksTableReady(false);
      return { ok: true, where: "drinks" };
    }
    setDrinks(data || []);
    setDrinksTableReady(true);
    return { ok: true, where: "drinks" };
  }

  async function loadAppSettings() {
    const baseCols = "id,multi_game_enabled,multi_round_enabled,event_name,handicap_basis,updated_at";

    // Newer columns only exist once their one-time database change has been run (tagline + logo: 0010,
    // drinking: 0014). Ask for everything first and fall back step by step, so a missing column never
    // takes the whole app down.
    const attempts = [
      { cols: `${baseCols},tagline,logo_data,drinking`, branding: true, drinking: true },
      { cols: `${baseCols},tagline,logo_data`, branding: true, drinking: false },
      { cols: `${baseCols},drinking`, branding: false, drinking: true },
      { cols: baseCols, branding: false, drinking: false },
    ];
    let data = null;
    let error = null;
    let used = attempts[attempts.length - 1];
    for (const attempt of attempts) {
      ({ data, error } = await supabase.from("app_settings").select(attempt.cols).eq("id", 1).maybeSingle());
      if (!error) {
        used = attempt;
        break;
      }
    }

    if (error) {
      console.error("loadAppSettings error:", error);
      return { ok: false, where: "app_settings", error: errToText(error) };
    }
    setBrandingReady(used.branding);
    setDrinkingColumnReady(used.drinking);
    setAppSettings(
      data || {
        multi_game_enabled: false,
        multi_round_enabled: false,
        event_name: "The Ginvitational",
        handicap_basis: "course",
      }
    );
    return { ok: true, where: "app_settings" };
  }

  async function loadBroadcast() {
    // newest first
    const { data, error } = await supabase
      .from("broadcast_messages")
      .select("id,created_at,kind,text,player_id,dedupe_key")
      .order("created_at", { ascending: false })
      .limit(400);

    if (error) {
      console.error("loadBroadcast error:", error);
      return { ok: false, where: "broadcast_messages", error: errToText(error) };
    }
    setBroadcastMsgs(data || []);
    setBroadcastLoaded(true);
    return { ok: true, where: "broadcast_messages" };
  }

  async function initialLoad() {
    setStatus("Loading...");
    setLastLoadErrors([]);

    const results = [];
    results.push(await loadPlayers());
    results.push(await loadScores());
    results.push(await loadFoursomes());
    results.push(await loadFoursomePlayers());
    results.push(await loadBroadcast());
    results.push(await loadGames());
    results.push(await loadGameTeams());
    results.push(await loadGameTeamMembers());
    results.push(await loadMatches());
    results.push(await loadDrinks());
    results.push(await loadRounds());
    results.push(await loadAppSettings());

    const fails = results.filter((r) => !r.ok);
    setLastLoadErrors(fails);
    setLastLoadAt(new Date().toISOString());

    if (fails.length === 0) {
      setStatus("Connected ✅");
      return;
    }

    const first = fails[0];
    setStatus(`FAIL: ${first.where} → ${first.error}`);
  }

  useEffect(() => {
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaderboard auto-refresh every minute while on leaderboard tab
  useEffect(() => {
    if (tab !== "leaderboard") return;
    const id = setInterval(async () => {
      await loadPlayers();
      await loadScores();
      if (drinkingEnabledRef.current) await loadDrinks(); // only while Drinking Mode is on
    }, 60_000);
    return () => clearInterval(id);
  }, [tab]);

  // TV Mode: the standings and the broadcast strip each refresh on their own
  // timer, with an immediate refresh on entry, so nobody has to touch the TV.
  useEffect(() => {
    if (tab !== "tv") return;
    const refreshStandings = async () => {
      await loadPlayers();
      await loadScores();
      if (drinkingEnabledRef.current) await loadDrinks(); // only while Drinking Mode is on
      await loadGames(); // picks up a game being locked/unlocked
    };
    refreshStandings();
    loadBroadcast();
    const standingsId = setInterval(refreshStandings, 30_000);
    const broadcastId = setInterval(loadBroadcast, 45_000);
    return () => {
      clearInterval(standingsId);
      clearInterval(broadcastId);
    };
  }, [tab]);

  // Every open phone picks up new cards (and a hole-in-one popup) within ~30 seconds.
  useEffect(() => {
    const id = setInterval(loadBroadcast, 30_000);
    return () => clearInterval(id);
  }, []);

  // Keep players/scores fresh for anyone just sitting on another tab.
  useEffect(() => {
    const id = setInterval(async () => {
      await loadPlayers();
      await loadScores();
      if (drinkingEnabledRef.current) await loadDrinks(); // only while Drinking Mode is on
    }, 180_000);
    return () => clearInterval(id);
  }, []);

  // Field-Relative handicap basis: every player's handicap minus the lowest
  // handicap among everyone imported for the event (0 in Course Handicap
  // mode, the default). A negative fieldOffset (the lowest in the field is
  // itself a plus handicap) raises everyone else's number; a positive one
  // lowers it. Used everywhere a handicap feeds into stroke/net-score math —
  // never for the raw "HCP" badges players see next to their name.
  const fieldOffset = useMemo(() => {
    if (appSettings.handicap_basis !== "field_relative") return 0;
    if (!players.length) return 0;
    return Math.min(...players.map((p) => clampInt(p.handicap, 0)));
  }, [players, appSettings.handicap_basis]);

  const leaderboardRows = useMemo(
    () => buildLeaderboardRows(players, scores, rounds.find((r) => r.is_active)?.id ?? null, fieldOffset),
    [players, scores, rounds, fieldOffset]
  );

  // --- Multi-Game (Stage 2) ---
  // Computed alongside the original leaderboardRows above, which is left
  // untouched. Nothing renders from this yet (see Stage 4).
  const playersById = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const teamMembersByTeamMap = useMemo(() => {
    const m = new Map();
    for (const row of gameTeamMembers) {
      if (!m.has(row.team_id)) m.set(row.team_id, []);
      m.get(row.team_id).push(row.player_id);
    }
    return m;
  }, [gameTeamMembers]);

  // Drinking Mode settings: what Admin saved, and what is actually in force (off until the database change is made).
  const drinkingSaved = useMemo(() => normalizeDrinking(appSettings.drinking), [appSettings.drinking]);
  const drinking = useMemo(() => ({ ...drinkingSaved, enabled: drinkingSaved.enabled && drinkingReady }), [drinkingSaved, drinkingReady]);
  useEffect(() => {
    drinkingEnabledRef.current = drinking.enabled;
  }, [drinking.enabled]);

  const activeRound = useMemo(() => rounds.find((r) => r.is_active) || rounds[0] || null, [rounds]);

  // { [roundId]: Map(playerId -> {hole: grossScore}) } — one scoped map per round.
  const scoresByRoundThenPlayer = useMemo(() => {
    const map = new Map();
    for (const r of rounds) map.set(r.id, buildScoresByPlayer(scores, r.id));
    return map;
  }, [scores, rounds]);

  return {
    drinks,
    setDrinks,
    drinksTableReady,
    drinkingColumnReady,
    drinkingReady,
    loadDrinks,
    drinkingSaved,
    drinking,
    status,
    setStatus,
    lastLoadErrors,
    setLastLoadErrors,
    lastLoadAt,
    setLastLoadAt,
    players,
    setPlayers,
    scores,
    setScores,
    games,
    setGames,
    gameTeams,
    setGameTeams,
    gameTeamMembers,
    setGameTeamMembers,
    appSettings,
    setAppSettings,
    rounds,
    setRounds,
    broadcastMsgs,
    setBroadcastMsgs,
    broadcastLoaded,
    setBroadcastLoaded,
    brandingReady,
    setBrandingReady,
    foursomes,
    setFoursomes,
    foursomePlayers,
    setFoursomePlayers,
    matches,
    setMatches,
    matchPlayers,
    setMatchPlayers,
    matchTablesReady,
    setMatchTablesReady,
    gamesConfigReady,
    setGamesConfigReady,
    loadPlayers,
    loadScores,
    loadFoursomes,
    loadRounds,
    loadFoursomePlayers,
    loadGames,
    loadMatches,
    loadGameTeams,
    loadGameTeamMembers,
    loadAppSettings,
    loadBroadcast,
    initialLoad,
    matchReady,
    fieldOffset,
    leaderboardRows,
    playersById,
    teamMembersByTeamMap,
    activeRound,
    scoresByRoundThenPlayer,
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import { AdminSection } from "./components/AdminSection";
import { rankCellContent } from "./components/LeaderIcons";
import { BrandingSetupNotice, ClearMessagesSetupNotice, MatchSetupNotice } from "./components/SetupNotices";
import { AcePopup } from "./features/broadcast/AcePopup";
import { ACE_POPUP_MS, readSeenAces, rememberSeenAce } from "./features/broadcast/aceSeen";
import { BroadcastFeed } from "./features/broadcast/BroadcastFeed";
import { LockedBoardPanel } from "./features/leaderboard/LockedBoardPanel";
import { expandChevronStyle, expandRowCellStyle } from "./features/leaderboard/rankStyles";
import { ScorecardDetail } from "./features/leaderboard/ScorecardDetail";
import { MatchBoard } from "./features/match/MatchBoard";
import { MatchEditor } from "./features/match/MatchEditor";
import { RosterPicker } from "./features/match/RosterPicker";
import { PhoneSetup } from "./features/phone/PhoneSetup";
import { PrintTwoUpScorecards } from "./features/print/PrintCards";
import { DeletePlayersPanel } from "./features/roster/DeletePlayersPanel";
import { RosterEditor } from "./features/roster/RosterEditor";
import { pendingKey, readPendingScores, writePendingScores } from "./features/scoring/pendingScores";
import { TvMode } from "./features/tv/TvMode";
import { useEventData } from "./hooks/useEventData";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { DEFAULT_TAGLINE, fileToLogoDataUrl } from "./lib/branding";
import { SWING_WINDOW_MS, computeBroadcastEvents, planPosts, safeDedupeKey } from "./lib/broadcastEngine";
import { ADMIN_PIN, ROUND_OVERALL } from "./lib/config";
import { PARS, STROKE_INDEX, netScoreForHole } from "./lib/course";
import { buildScoresByPlayer, computeGameRows, mergeGameRowsAcrossRounds } from "./lib/gameCalc";
import { GAME_FORMAT_LABELS, GAME_FORMAT_TEAM_SIZE, GAME_PRESETS, GAME_SCORE_LABELS, SCRAMBLE_DEFAULT_PCTS, SEGMENT_FORMAT_OPTIONS, isMatchFormat } from "./lib/gameConfig";
import { clampInt, formatToPar } from "./lib/golf";
import { buildLeaderboardRows } from "./lib/leaderboard";
import { HANDICAP_MODES, computeMatchResult } from "./lib/matchPlay";
import { lastPlaceRank } from "./lib/ranking";
import { formStreak } from "./lib/streaks";
import { supabase } from "./lib/supabase";
import { excelTimeToDbTime, fullNameFromRow } from "./lib/teeSheet";
import { errToText, makeCode } from "./lib/util";
import { THEME, netColorStyle, styles } from "./theme";

/* ---------- Phone setup ("Build on my phone") helpers: pure, no React ---------- */

export default function App() {
  const isWide = useMediaQuery("(min-width: 820px)"); // 2-column Admin on tablets/desktops
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin | broadcast
  const {
    status,
    lastLoadErrors,
    lastLoadAt,
    players,
    scores,
    games,
    gameTeams,
    gameTeamMembers,
    appSettings,
    rounds,
    broadcastMsgs,
    broadcastLoaded,
    brandingReady,
    foursomes,
    foursomePlayers,
    matches,
    matchPlayers,
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
  } = useEventData({ tab });

  // Broadcast
  const [acePopup, setAcePopup] = useState(null);
  // Admin → Danger Zone
  const [dangerUnlocked, setDangerUnlocked] = useState(false);
  const [dangerPin, setDangerPin] = useState("");
  const [dangerPinMsg, setDangerPinMsg] = useState("");
  const [clearMsg, setClearMsg] = useState("");
  const [clearNeedsSetup, setClearNeedsSetup] = useState(false);

  // Leaderboard scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // Leaderboard: which game tab is showing (only relevant when >1 active game)
  const [selectedGameId, setSelectedGameId] = useState(null);

  // Leaderboard: which round is showing (null => defaults to the active round)
  const [selectedRoundId, setSelectedRoundId] = useState(null);

  // Admin gate
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);
  const [printAllOn, setPrintAllOn] = useState(false);
  // Which active game's handicap rule the printed scorecards should match.
  // Defaults to the same game the Leaderboard defaults to (the first active
  // game, by sort order) — see `printGame` below.
  const [printGameId, setPrintGameId] = useState(null);

  // Admin: editable event name
  const [eventNameDraft, setEventNameDraft] = useState("");
  const [eventNameMsg, setEventNameMsg] = useState("");

  // Admin: editable tagline + uploadable main logo. `brandingReady` is false
  // until the one-time database change (migration 0010) has been made.
  const [taglineDraft, setTaglineDraft] = useState("");
  const [taglineMsg, setTaglineMsg] = useState("");
  const [logoDraft, setLogoDraft] = useState(null); // data URL awaiting "Save logo"
  const [logoMsg, setLogoMsg] = useState("");

  // Enter Scores: foursome code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null);
  const [activePlayers, setActivePlayers] = useState([]);

  // Enter Scores: hole-by-hole typing UI
  const [hole, setHole] = useState(1);
  const [holeInputs, setHoleInputs] = useState({});
  // Scores saved on this phone that have not reached the database yet.
  const [pendingScores, setPendingScores] = useState(() => readPendingScores());
  const [pendingErr, setPendingErr] = useState("");
  const uploadingRef = useRef(false);
  const uploadAgainRef = useRef(false);
  // True once this foursome has wrapped all the way back around to their
  // starting hole after entering their 18th hole (shotgun starts).
  const [roundComplete, setRoundComplete] = useState(false);

  // Admin: Excel import (tee sheet)
  const [teeSheetFile, setTeeSheetFile] = useState(null);
  const [teeSheetRows, setTeeSheetRows] = useState([]);
  // Foursomes sanity-check list is collapsed by default — after an import,
  // most visits to Admin don't need every player re-scanned every time.

  // Admin: which of the setup sections (Event Name, Import, Games, etc.) is
  // expanded — only one at a time, so the page shows one decision at a time
  // instead of everything at once. Set on PIN unlock in enterAdmin().
  const [openAdminSection, setOpenAdminSection] = useState(null);
  // "Build on my phone" setup flow replaces the Admin accordion while open.
  const [phoneSetupOn, setPhoneSetupOn] = useState(false);
  const [importReplaceFoursomes, setImportReplaceFoursomes] = useState(true);
  const [importMsg, setImportMsg] = useState("");
  const [importRoundId, setImportRoundId] = useState(null);

  // Admin: Multi-Game setup (Stage 3)
  const [newGameFormat, setNewGameFormat] = useState("individual_net");
  const [newGamePresetKey, setNewGamePresetKey] = useState(null);
  const [newGameName, setNewGameName] = useState("");
  const [newGameHandicapPct, setNewGameHandicapPct] = useState(100);
  const [newGameAdvancedOn, setNewGameAdvancedOn] = useState(false);
  const [newGameScoresCounted, setNewGameScoresCounted] = useState(1);
  const [newGameSlots, setNewGameSlots] = useState(["net"]);
  const [gamesMsg, setGamesMsg] = useState("");

  // Admin: Composite (multi-format) game builder
  const [newGameTeamSize, setNewGameTeamSize] = useState(2);
  // When a playing group is bigger than a 2-man team: "balanced" pairs the
  // lowest handicap with the highest, "order" pairs them as listed, "keep"
  // leaves the whole group as one team.
  const [newGameSplit, setNewGameSplit] = useState("balanced");
  const [newGameSegments, setNewGameSegments] = useState([]);

  // Match Play / Ryder Cup
  const [openMatchGameId, setOpenMatchGameId] = useState(null);
  const [newGameMatchMode, setNewGameMatchMode] = useState("off_lowest");
  const [newGameSideA, setNewGameSideA] = useState("USA");
  const [newGameSideB, setNewGameSideB] = useState("Europe");
  const [newGamePointsWin, setNewGamePointsWin] = useState(1);
  const [newGamePointsHalf, setNewGamePointsHalf] = useState(0.5);
  const [newGameRoster, setNewGameRoster] = useState({});

  // Admin: Scramble ranked handicap-% builder (lowest handicap on the
  // team through highest — length matches the format's team size)
  const [newGameScramblePcts, setNewGameScramblePcts] = useState(SCRAMBLE_DEFAULT_PCTS.scramble_2);

  // Admin: Rounds
  const [newRoundLabel, setNewRoundLabel] = useState("");
  const [roundsMsg, setRoundsMsg] = useState("");

  useEffect(() => {
  const handler = () => setPrintAllOn(false);
  window.addEventListener("afterprint", handler);
  return () => window.removeEventListener("afterprint", handler);
}, []);

  // Event name, editable from Admin — shown on Home, the top nav, print
  // scorecards, and the browser tab title.
  const eventName = appSettings.event_name || "The Ginvitational";

  // The "Connected ✅" status is an admin detail. Everywhere else it stays
  // hidden — except a failure, which is worth seeing wherever it happens.
  const visibleStatus = tab === "admin" || status.startsWith("FAIL") ? status : "";

  useEffect(() => {
    if (typeof document !== "undefined") document.title = eventName;
  }, [eventName]);

  // Keep the Admin draft in sync with the saved value (e.g. after a save,
  // or on initial load), without clobbering what's being typed elsewhere.
  useEffect(() => {
    setEventNameDraft(eventName);
  }, [eventName]);

  // Tagline: not set yet (null) means the default; saved blank means none.
  const tagline = appSettings.tagline == null ? DEFAULT_TAGLINE : appSettings.tagline.trim();
  useEffect(() => {
    setTaglineDraft(tagline);
  }, [tagline]);

  // Main logo: the uploaded one if there is one, else the built-in spool.
  const customLogo = !!appSettings.logo_data;
  const logoSrc = appSettings.logo_data || "/logo.png";

  // Carry a custom logo to the browser tab icon and the iOS "Add to Home
  // Screen" icon too (the originals are put back if it's reset). An app that
  // was already installed to a home screen keeps the icon it was installed
  // with — that one comes from the install manifest, not from this page.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => {
      if (el.dataset.origHref === undefined) {
        el.dataset.origHref = el.getAttribute("href") || "";
        el.dataset.origType = el.getAttribute("type") || "";
      }
      el.setAttribute("href", appSettings.logo_data || el.dataset.origHref);
      if (appSettings.logo_data) el.setAttribute("type", "image/png");
      else if (el.dataset.origType) el.setAttribute("type", el.dataset.origType);
      else el.removeAttribute("type");
    });
  }, [appSettings.logo_data]);

  // The game printed scorecards match. Defaults to the same game the
  // Leaderboard defaults to (the first active game, by sort order).
  const printGame = useMemo(() => {
    const activeGames = games.filter((g) => g.active);
    return activeGames.find((g) => g.id === printGameId) || activeGames[0] || null;
  }, [games, printGameId]);

  // Every Match Play / Ryder Cup game's matches, worked out from the scores entered.
  const matchEntriesByGame = useMemo(() => {
    const out = new Map();
    const startHoleFor = (pid, roundId) => {
      const fp = foursomePlayers.find(
        (x) => x.player_id === pid && foursomes.some((f) => f.id === x.foursome_id && (!f.round_id || f.round_id === roundId))
      );
      return foursomes.find((f) => f.id === fp?.foursome_id)?.starting_hole ?? 1;
    };
    for (const g of games) {
      if (!isMatchFormat(g.format)) continue;
      const cfg = g.config || {};
      const entries = matches
        .filter((m) => m.game_id === g.id)
        .sort((x, y) => x.sort_order - y.sort_order || String(x.created_at).localeCompare(String(y.created_at)))
        .map((m) => {
          const side = (s) =>
            matchPlayers
              .filter((mp) => mp.match_id === m.id && mp.side === s)
              .sort((x, y) => x.position - y.position)
              .map((mp) => playersById.get(mp.player_id))
              .filter(Boolean);
          const sideA = side("a");
          const sideB = side("b");
          const result = computeMatchResult(
            { ...m, sideA, sideB },
            {
              scoresByPlayer: scoresByRoundThenPlayer.get(m.round_id) || new Map(),
              PARS,
              STROKE_INDEX,
              handicapMode: cfg.handicapMode || "off_lowest",
              handicapPct: g.handicap_pct,
              fieldOffset,
              startHole: sideA[0] ? startHoleFor(sideA[0].id, m.round_id) : 1,
              pointsWin: cfg.pointsWin ?? 1,
              pointsHalf: cfg.pointsHalf ?? 0.5,
            }
          );
          return { match: m, result, roundId: m.round_id };
        });
      out.set(g.id, entries);
    }
    return out;
  }, [games, matches, matchPlayers, playersById, scoresByRoundThenPlayer, foursomes, foursomePlayers, fieldOffset]);

  const gameResults = useMemo(() => {
    const activeGames = games.filter((g) => g.active);
    const ctxBase = {
      players,
      teams: gameTeams,
      teamMembersByTeam: teamMembersByTeamMap,
      playersById,
      PARS,
      STROKE_INDEX,
      fieldOffset,
    };

    const roundSelection = selectedRoundId || activeRound?.id || null;

    if (roundSelection === ROUND_OVERALL) {
      return activeGames.map((game) => {
        const perRoundRows = rounds.map((r) =>
          computeGameRows(game, { ...ctxBase, scoresByPlayer: scoresByRoundThenPlayer.get(r.id) || new Map() })
        );
        return { game, rows: mergeGameRowsAcrossRounds(perRoundRows) };
      });
    }

    const scoresByPlayer = roundSelection
      ? scoresByRoundThenPlayer.get(roundSelection) || new Map()
      : buildScoresByPlayer(scores); // rounds not loaded yet — fall back to unscoped

    return activeGames.map((game) => ({
      game,
      rows: computeGameRows(game, { ...ctxBase, scoresByPlayer }),
    }));
  }, [
    games,
    gameTeams,
    teamMembersByTeamMap,
    players,
    playersById,
    rounds,
    scoresByRoundThenPlayer,
    selectedRoundId,
    activeRound,
    scores,
    fieldOffset,
  ]);

  const scorecardPlayer = useMemo(() => {
    if (!scorecardPlayerId) return null;
    return leaderboardRows.find((r) => r.id === scorecardPlayerId) || null;
  }, [scorecardPlayerId, leaderboardRows]);

  // TV Mode flames/ice cubes: { [playerId]: "fire" | "ice" }. Each group's
  // starting hole decides which holes count as their "most recent" ones.
  const tvForms = useMemo(() => {
    const roundId = activeRound?.id;
    const startByFoursome = new Map(
      foursomes.filter((f) => !f.round_id || f.round_id === roundId).map((f) => [f.id, f.starting_hole])
    );
    const startByPlayer = new Map();
    for (const fp of foursomePlayers) {
      if (startByFoursome.has(fp.foursome_id)) startByPlayer.set(fp.player_id, startByFoursome.get(fp.foursome_id));
    }
    const out = {};
    for (const p of leaderboardRows) {
      const form = formStreak(p, startByPlayer.get(p.id));
      if (form) out[p.id] = form;
    }
    return out;
  }, [leaderboardRows, foursomes, foursomePlayers, activeRound]);

  /** -----------------------
   *  THE BROADCAST
   *  What counts as a "moment" lives in ./lib/broadcastEngine (pure and
   *  tested). This just feeds it the data that is already loaded and saves
   *  whatever it decides. It runs whenever the scores change (a save here, or
   *  a refresh from anyone's phone) — not on a timer — and every card has a
   *  unique key in the database, so two phones can never post the same one.
   * ----------------------*/

  // The tick reads everything from this ref so it always sees the latest data,
  // not whatever was loaded when the function was created.
  const liveRef = useRef(null);
  const tickBusyRef = useRef(false);
  useEffect(() => {
    liveRef.current = { leaderboardRows, scores, players, rounds, foursomes, foursomePlayers, broadcastMsgs, eventName, fieldOffset };
  });

  async function insertBroadcastRows(rows) {
    for (const r of rows) {
      const { error } = await supabase
        .from("broadcast_messages")
        .insert({ kind: r.kind, text: r.text, player_id: r.playerId, dedupe_key: safeDedupeKey(r.dedupe) });
      if (!error) continue;
      const msg = errToText(error).toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) continue; // another phone got there first
      console.error("insertBroadcast error:", error);
    }
  }

  async function runBroadcastTick() {
    const s = liveRef.current;
    if (!s || tickBusyRef.current || s.leaderboardRows.length === 0) return;
    tickBusyRef.current = true;
    try {
      const now = Date.now();
      const roundId = s.rounds.find((r) => r.is_active)?.id ?? null;

      // Which group each player is in this round, and where that group starts.
      const roundFoursomes = new Map(
        s.foursomes.filter((f) => !f.round_id || f.round_id === roundId).map((f) => [f.id, f])
      );
      const startByPlayer = new Map();
      const groupByPlayer = new Map();
      for (const fp of s.foursomePlayers) {
        const f = roundFoursomes.get(fp.foursome_id);
        if (!f) continue;
        startByPlayer.set(fp.player_id, f.starting_hole);
        groupByPlayer.set(fp.player_id, f.group_name);
      }

      const scoreTimes = {};
      for (const sc of s.scores) {
        if (roundId != null && sc.round_id !== roundId) continue;
        scoreTimes[`${sc.player_id}|${sc.hole}`] = new Date(sc.created_at).getTime();
      }

      const rows = s.leaderboardRows.map((r) => {
        const vsPar = {};
        for (const [h, g] of Object.entries(r.scoresByHole)) {
          vsPar[h] = netScoreForHole(g, r.playingHandicap, Number(h)) - PARS[Number(h) - 1];
        }
        return {
          id: r.id,
          name: r.name,
          holesPlayed: r.holesPlayed,
          netToPar: r.netToPar,
          displayRank: r.displayRank,
          gross: r.scoresByHole,
          vsPar,
          startHole: startByPlayer.get(r.id) ?? 1,
          group: groupByPlayer.get(r.id) || null,
        };
      });

      // "Standings a few minutes ago": the same leaderboard math, ignoring scores saved since.
      const prevRows = buildLeaderboardRows(s.players, s.scores, roundId, s.fieldOffset, now - SWING_WINDOW_MS);
      const prevRanks = new Map(prevRows.filter((r) => r.holesPlayed > 0).map((r) => [r.id, r.displayRank]));
      const fieldIds = new Set(startByPlayer.keys());

      const events = computeBroadcastEvents({
        now,
        eventName: s.eventName,
        roundId,
        pars: PARS,
        rows,
        scoreTimes,
        prevRanks,
        fieldIds,
        messages: s.broadcastMsgs,
      });
      if (events.length === 0) return;
      await insertBroadcastRows(planPosts(events, { now, messages: s.broadcastMsgs }));
      await loadBroadcast();
    } finally {
      tickBusyRef.current = false;
    }
  }

  // Check for new cards whenever fresh scores/players arrive (and once the saved log has loaded).
  useEffect(() => {
    if (!broadcastLoaded) return;
    runBroadcastTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, players, broadcastLoaded]);

  // Unsent scores: retry every 10 seconds, the moment the phone comes back online, and on load.
  const hasPendingScores = pendingScores.length > 0;
  useEffect(() => {
    if (!hasPendingScores) return;
    const id = setInterval(uploadPendingScores, 10_000);
    window.addEventListener("online", uploadPendingScores);
    uploadPendingScores();
    return () => {
      clearInterval(id);
      window.removeEventListener("online", uploadPendingScores);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingScores]);

  // Hole-in-one popup: the newest ace from the last 10 minutes this phone hasn't dismissed yet.
  useEffect(() => {
    if (acePopup) return;
    const seen = readSeenAces();
    const m = broadcastMsgs.find(
      (x) => x.kind === "ace" && Date.now() - new Date(x.created_at).getTime() < ACE_POPUP_MS && !seen.includes(x.id)
    );
    if (m) setAcePopup(m);
  }, [broadcastMsgs, acePopup]);

  function dismissAce() {
    if (acePopup) rememberSeenAce(acePopup.id);
    setAcePopup(null);
  }

  // Cards the feed and TV Mode show (hidden rows only exist so nothing is announced twice).
  const visibleBroadcast = useMemo(
    () => broadcastMsgs.filter((m) => !String(m.kind || "").startsWith("hidden_")),
    [broadcastMsgs]
  );

  // Admin → Danger Zone → Clear all messages
  async function clearBroadcastMessages() {
    if (!adminOn) return alert("Admin only.");
    const head = await supabase.from("broadcast_messages").select("id", { count: "exact", head: true });
    const total = head.count ?? broadcastMsgs.length;
    if (!total) {
      setClearMsg("There are no Broadcast messages to clear.");
      return;
    }
    if (!confirm(`Delete all ${total} Broadcast messages? This can't be undone.`)) return;
    setClearMsg("Clearing…");
    const { data, error } = await supabase
      .from("broadcast_messages")
      .delete()
      .gte("created_at", "1970-01-01T00:00:00Z")
      .select("id");
    if (error) {
      console.error(error);
      setClearMsg(`Error clearing messages: ${errToText(error)}`);
      return;
    }
    if ((data || []).length === 0) {
      // The database accepted the request but removed nothing: delete isn't allowed yet.
      setClearNeedsSetup(true);
      setClearMsg("Nothing was deleted. The database needs a one-time permission first (see below).");
      return;
    }
    setClearNeedsSetup(false);
    await loadBroadcast();
    setClearMsg(`Cleared ${data.length} messages ✅`);
  }

  function unlockDanger() {
    if (dangerPin === ADMIN_PIN) {
      setDangerUnlocked(true);
      setDangerPin("");
      setDangerPinMsg("");
    } else {
      setDangerPinMsg("Wrong passcode.");
      setDangerPin("");
    }
  }

  function enterAdmin() {
    if (adminPin === ADMIN_PIN) {
      setAdminOn(true);
      setAdminPin("");
      setTab("admin");
      // First-run: nothing imported yet, so open straight to "Start a
      // Tournament". Once an event is set up, start collapsed and let them
      // pick what to tweak.
      setOpenAdminSection(foursomes.length === 0 ? "start" : null);
    } else {
      alert("Wrong PIN");
    }
  }

  // Deletes players along with everything that points at them (their scores,
  // their group spots, any game-team spots and their Broadcast cards).
  async function deletePlayers(ids) {
    if (!adminOn) return "Admin only.";
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      await supabase.from("broadcast_messages").delete().in("player_id", part); // best effort
      for (const table of ["foursome_players", "scores", "game_team_members"]) {
        const { error } = await supabase.from(table).delete().in("player_id", part);
        if (error) {
          console.error(error);
          return `Error removing ${table}: ${errToText(error)}`;
        }
      }
      const { data, error } = await supabase.from("players").delete().in("id", part).select("id");
      if (error) {
        console.error(error);
        return `Error deleting players: ${errToText(error)}`;
      }
      if ((data || []).length < part.length) {
        await initialLoad();
        return "Some players could not be deleted (the database refused). Reload and check the list.";
      }
    }
    await initialLoad();
    return `Deleted ${ids.length} player${ids.length === 1 ? "" : "s"} ✅`;
  }

  async function clearFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (!confirm("Clear all foursomes + assignments? (Does not delete players or scores)")) return;

    const delFP = await supabase
      .from("foursome_players")
      .delete()
      .neq("foursome_id", "00000000-0000-0000-0000-000000000000");
    if (delFP.error) {
      console.error(delFP.error);
      alert(`Could not clear the assignments: ${errToText(delFP.error)}`);
      return;
    }

    const delF = await supabase
      .from("foursomes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delF.error) {
      console.error(delF.error);
      alert(`Could not clear the foursomes: ${errToText(delF.error)}`);
      await initialLoad();
      return;
    }

    await initialLoad();
  }

  // ---------------------------
  // MULTI-GAME (Stage 3: Admin)
  // ---------------------------

  async function setMultiGameEnabled(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ multi_game_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  // 'course': everyone's own handicap, as entered.
  // 'field_relative': everyone's handicap minus the lowest handicap among
  // every player imported for the event, so the best player in the field
  // plays to scratch. Affects the Leaderboard, print scorecards, and the
  // scorecard popup — see `fieldOffset` below.
  async function setHandicapBasis(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ handicap_basis: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  async function saveEventName() {
    if (!adminOn) return alert("Admin only.");
    const name = eventNameDraft.trim() || "The Ginvitational";
    setEventNameMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ event_name: name, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setEventNameMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setEventNameMsg("Saved ✅");
  }

  async function saveTagline() {
    if (!adminOn) return alert("Admin only.");
    setTaglineMsg("Saving…");

    // Blank is allowed and means "no tagline" (stored as "", not null — null
    // is reserved for "never set", which shows the default).
    const { error } = await supabase
      .from("app_settings")
      .update({ tagline: taglineDraft.trim(), updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setTaglineMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setTaglineMsg("Saved ✅");
  }

  async function onLogoPicked(file) {
    if (!file) return;
    setLogoMsg("Processing…");
    try {
      setLogoDraft(await fileToLogoDataUrl(file));
      setLogoMsg("Preview above — click Save logo to use it everywhere.");
    } catch (e) {
      setLogoDraft(null);
      setLogoMsg(e.message || "Couldn't use that image.");
    }
  }

  async function saveLogo(nextLogoData) {
    if (!adminOn) return alert("Admin only.");
    setLogoMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ logo_data: nextLogoData, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setLogoMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    setLogoDraft(null);
    await loadAppSettings();
    setLogoMsg(nextLogoData ? "Saved ✅ — the new logo is live." : "Back to the default logo ✅");
  }

  async function setMultiRoundEnabled(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ multi_round_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  async function createRound() {
    if (!adminOn) return alert("Admin only.");
    const label = newRoundLabel.trim() || `Round ${rounds.length + 1}`;

    const { error } = await supabase.from("rounds").insert({
      label,
      sort_order: rounds.length,
      is_active: false,
    });

    if (error) {
      console.error(error);
      setRoundsMsg(`Error creating round: ${errToText(error)}`);
      return;
    }
    setNewRoundLabel("");
    setRoundsMsg(`"${label}" created ✅`);
    await loadRounds();
  }

  async function setRoundActive(round) {
    if (!adminOn) return alert("Admin only.");

    const clear = await supabase.from("rounds").update({ is_active: false }).eq("is_active", true);
    if (clear.error) {
      console.error(clear.error);
      setRoundsMsg(`Error updating rounds: ${errToText(clear.error)}`);
      return;
    }

    const { error } = await supabase.from("rounds").update({ is_active: true }).eq("id", round.id);
    if (error) {
      console.error(error);
      setRoundsMsg(`Error updating rounds: ${errToText(error)}`);
      return;
    }
    await loadRounds();
  }

  async function deleteRound(round) {
    if (!adminOn) return alert("Admin only.");
    if (rounds.length <= 1) return alert("At least one round must remain.");
    if (
      !confirm(
        `Delete "${round.label}"? This also removes its foursomes and every score entered for it. This can't be undone.`
      )
    )
      return;

    // Each step must succeed before the next one runs, so a refused delete never leaves the round half-removed without saying so.
    const roundFoursomeIds = foursomes.filter((f) => f.round_id === round.id).map((f) => f.id);
    const steps = [
      ["assignments", () => (roundFoursomeIds.length ? supabase.from("foursome_players").delete().in("foursome_id", roundFoursomeIds) : { error: null })],
      ["foursomes", () => supabase.from("foursomes").delete().eq("round_id", round.id)],
      ["scores", () => supabase.from("scores").delete().eq("round_id", round.id)],
    ];
    for (const [label, run] of steps) {
      const res = await run();
      if (res.error) {
        console.error(res.error);
        setRoundsMsg(`Error deleting the round's ${label}: ${errToText(res.error)}`);
        await initialLoad();
        return;
      }
    }

    const { error } = await supabase.from("rounds").delete().eq("id", round.id);
    if (error) {
      console.error(error);
      setRoundsMsg(`Error deleting round: ${errToText(error)}`);
      return;
    }

    if (round.is_active) {
      const nextRound = rounds.find((r) => r.id !== round.id);
      if (nextRound) await setRoundActive(nextRound);
    }

    await initialLoad();
  }

  function applyPreset(preset) {
    setNewGamePresetKey(preset.key);
    setNewGameHandicapPct(preset.handicapPct);
    setNewGameScoresCounted(preset.scoresCounted);
    setNewGameSlots(preset.slots);
    setNewGameAdvancedOn(false);
  }

  function selectNewGameFormat(format) {
    setNewGameFormat(format);
    setNewGameName(GAME_FORMAT_LABELS[format]);

    if (isMatchFormat(format)) {
      setNewGameHandicapPct(100);
      setNewGameMatchMode("off_lowest");
      setNewGameSideA("USA");
      setNewGameSideB("Europe");
      setNewGamePointsWin(1);
      setNewGamePointsHalf(0.5);
      setNewGameRoster({});
      return;
    }

    if (format === "composite") {
      setNewGameTeamSize(2);
      setNewGameSegments([
        { fromHole: 1, toHole: 6, formatKey: "scramble", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 7, toHole: 12, formatKey: "best_ball", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 13, toHole: 18, formatKey: "combined", handicapPct: 100, lowPct: 35, highPct: 15 },
      ]);
      return;
    }

    if (format === "scramble_2" || format === "scramble_4") {
      setNewGameScramblePcts(SCRAMBLE_DEFAULT_PCTS[format]);
      return;
    }

    const presets = GAME_PRESETS[format] || [];
    if (presets[0]) applyPreset(presets[0]);
  }

  // --- Scramble ranked handicap-% builder ---
  function setScramblePct(index, value) {
    setNewGameScramblePcts((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  // --- Composite (multi-format) segment builder ---
  function addSegment() {
    setNewGameSegments((prev) => [
      ...prev,
      { fromHole: 1, toHole: 1, formatKey: "best_ball", handicapPct: 100, lowPct: 35, highPct: 15 },
    ]);
  }

  function updateSegment(index, patch) {
    setNewGameSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSegment(index) {
    setNewGameSegments((prev) => prev.filter((_, i) => i !== index));
  }

  /** Holes 1-18 not covered by any segment yet, for a non-blocking hint. */
  function segmentCoverageGaps(segments) {
    const covered = new Set();
    for (const s of segments) {
      const from = Math.min(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
      const to = Math.max(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
      for (let h = from; h <= to; h++) covered.add(h);
    }
    const gaps = [];
    for (let h = 1; h <= 18; h++) if (!covered.has(h)) gaps.push(h);
    return gaps;
  }

  // Advanced counting-rule builder: keep `slots` in sync with `scoresCounted`
  function setAdvancedScoresCounted(n) {
    const count = Math.min(4, Math.max(1, clampInt(n, 1)));
    setNewGameScoresCounted(count);
    setNewGameSlots((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push("net");
      return next;
    });
  }

  function setAdvancedSlot(index, value) {
    setNewGameSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  /**
   * Where a game's teams come from: the players' "team" value when there is
   * one (the tee sheet's team column), otherwise each playing group of the
   * active round. Returns { teams: [{label, members}], source }.
   */
  function baseTeamPool() {
    const byLabel = new Map();
    for (const p of players) {
      const label = String(p.team_label || "").trim();
      if (!label) continue;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(p);
    }
    if (byLabel.size > 0) {
      return { source: "column", teams: Array.from(byLabel.entries()).map(([label, members]) => ({ label, members })) };
    }

    const roundId = activeRound?.id;
    const byId = new Map(players.map((p) => [p.id, p]));
    const teams = foursomes
      .filter((f) => !f.round_id || f.round_id === roundId)
      .map((f) => ({
        label: f.group_name,
        members: foursomePlayers
          .filter((fp) => fp.foursome_id === f.id)
          .map((fp) => byId.get(fp.player_id))
          .filter(Boolean),
      }))
      .filter((t) => t.members.length > 0);
    return { source: "groups", teams };
  }

  /** Teams for the given team size, ready to preview or save. */
  function teamPreviewGroups(teamSize) {
    const { teams } = baseTeamPool();
    const out = [];
    for (const t of teams) {
      if (teamSize === 2 && t.members.length > 2 && newGameSplit !== "keep") {
        // Split a bigger group into pairs: balanced = low + high handicap together.
        const sorted =
          newGameSplit === "order"
            ? [...t.members]
            : [...t.members].sort((x, y) => clampInt(x.handicap, 0) - clampInt(y.handicap, 0));
        const pairs = [];
        if (newGameSplit === "order") {
          for (let i = 0; i < sorted.length; i += 2) pairs.push(sorted.slice(i, i + 2));
        } else {
          let lo = 0;
          let hi = sorted.length - 1;
          while (lo < hi) pairs.push([sorted[lo++], sorted[hi--]]);
          if (lo === hi) pairs.push([sorted[lo]]);
        }
        pairs.forEach((members, i) => out.push({ label: `${t.label} ${String.fromCharCode(65 + i)}`, members, mismatched: members.length !== teamSize }));
      } else {
        out.push({ label: t.label, members: t.members, mismatched: t.members.length !== teamSize });
      }
    }
    return out;
  }

  async function createMatchGame() {
    if (!adminOn) return alert("Admin only.");
    if (!matchReady) {
      setGamesMsg("Run the one-time database setup first (shown above), then tap Reload Data.");
      return;
    }
    const isRyder = newGameFormat === "ryder_cup";
    const name = newGameName.trim() || GAME_FORMAT_LABELS[newGameFormat];
    const pointsWin = Number(newGamePointsWin);
    const pointsHalf = Number(newGamePointsHalf);
    if (!(pointsWin > 0) || !(pointsHalf >= 0)) {
      setGamesMsg("Points for a win must be above 0, and for a half must be 0 or more.");
      return;
    }
    const config = { handicapMode: newGameMatchMode, pointsWin, pointsHalf };
    const rosterA = [];
    const rosterB = [];
    if (isRyder) {
      const a = newGameSideA.trim() || "Team A";
      const b = newGameSideB.trim() || "Team B";
      if (a.toLowerCase() === b.toLowerCase()) {
        setGamesMsg("The two sides need different names.");
        return;
      }
      for (const [pid, side] of Object.entries(newGameRoster)) {
        if (side === "a") rosterA.push(pid);
        if (side === "b") rosterB.push(pid);
      }
      if (rosterA.length === 0 || rosterB.length === 0) {
        setGamesMsg("Put at least one player on each side first.");
        return;
      }
      config.sideA = { name: a };
      config.sideB = { name: b };
    }

    setGamesMsg("Creating game…");
    const { data: gameRow, error: gameError } = await supabase
      .from("games")
      .insert({
        name,
        format: newGameFormat,
        handicap_pct: clampInt(newGameHandicapPct, 100),
        is_default: false,
        active: true,
        sort_order: games.length,
        config,
      })
      .select("id")
      .single();
    if (gameError) {
      console.error(gameError);
      setGamesMsg(`Error creating game: ${errToText(gameError)}`);
      return;
    }

    if (isRyder) {
      const made = [];
      for (const [label, ids] of [[config.sideA.name, rosterA], [config.sideB.name, rosterB]]) {
        const { data: teamRow, error: teamError } = await supabase
          .from("game_teams")
          .insert({ game_id: gameRow.id, name: label })
          .select("id")
          .single();
        if (teamError) {
          console.error(teamError);
          setGamesMsg(`Game created, but error building side "${label}": ${errToText(teamError)}`);
          return;
        }
        made.push(teamRow.id);
        const { error: memberError } = await supabase
          .from("game_team_members")
          .insert(ids.map((player_id) => ({ game_id: gameRow.id, team_id: teamRow.id, player_id })));
        if (memberError) {
          console.error(memberError);
          setGamesMsg(`Game created, but error assigning "${label}": ${errToText(memberError)}`);
          return;
        }
      }
      const cfgUpdate = await supabase
        .from("games")
        .update({ config: { ...config, sideA: { ...config.sideA, teamId: made[0] }, sideB: { ...config.sideB, teamId: made[1] } } })
        .eq("id", gameRow.id);
      if (cfgUpdate.error) {
        console.error(cfgUpdate.error);
        setGamesMsg(`Game created, but could not link its sides: ${errToText(cfgUpdate.error)}`);
        return;
      }
    }

    setGamesMsg(`"${name}" created ✅ — now add its matches under "Manage matches" on its card.`);
    setNewGameName("");
    setNewGameRoster({});
    await loadGames();
    await loadGameTeams();
    await loadGameTeamMembers();
    await loadMatches();
  }

  async function createGame() {
    if (!adminOn) return alert("Admin only.");
    if (isMatchFormat(newGameFormat)) return createMatchGame();
    const name = newGameName.trim() || GAME_FORMAT_LABELS[newGameFormat];
    const isComposite = newGameFormat === "composite";
    const isScramble = newGameFormat === "scramble_2" || newGameFormat === "scramble_4";
    const handicap_pct = clampInt(newGameHandicapPct, 100);

    let counting_rule = null;
    let segments = null;
    let handicap_allowance = null;

    if (isScramble) {
      const teamSize = GAME_FORMAT_TEAM_SIZE[newGameFormat];
      const pcts = newGameScramblePcts.slice(0, teamSize).map((p) => clampInt(p, 0));
      if (pcts.length !== teamSize) {
        alert("Handicap % looks incomplete. Check every rank has a value.");
        return;
      }
      handicap_allowance = pcts;
    } else if (isComposite) {
      if (newGameSegments.length === 0) {
        alert("Add at least one segment first.");
        return;
      }
      segments = newGameSegments.map((s) => {
        const opt = SEGMENT_FORMAT_OPTIONS[s.formatKey] || SEGMENT_FORMAT_OPTIONS.best_ball;
        const from = Math.min(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
        const to = Math.max(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
        const holes = [];
        for (let h = from; h <= to; h++) holes.push(h);

        if (opt.kind === "shared") {
          return {
            holes,
            formatType: "shared",
            label: opt.label,
            handicapAllowance: { lowPct: clampInt(s.lowPct, 0), highPct: clampInt(s.highPct, 0) },
          };
        }
        return {
          holes,
          formatType: "individual",
          label: opt.label,
          countingRule: { scoresCounted: opt.scoresCounted, slots: opt.slots },
          handicapPct: clampInt(s.handicapPct, 100),
        };
      });
    } else {
      const scoresCounted = clampInt(newGameScoresCounted, 1);
      const slots = newGameSlots.slice(0, scoresCounted);
      if (slots.length !== scoresCounted) {
        alert("Counting rule looks incomplete. Check the advanced settings.");
        return;
      }
      counting_rule = { scoresCounted, slots };
    }

    const isTeamFormat =
      newGameFormat === "better_ball_2" || newGameFormat === "better_ball_4" || isScramble || isComposite;
    const teamSize = isComposite ? clampInt(newGameTeamSize, 2) : GAME_FORMAT_TEAM_SIZE[newGameFormat];
    const teamGroups = isTeamFormat ? teamPreviewGroups(teamSize).filter((g) => g.members.length > 0) : [];

    if (isTeamFormat && teamGroups.length === 0) {
      alert(
        "No teams to build from yet. Set up your players and groups first (Admin → Start a Tournament or Players & Groups), then try again."
      );
      return;
    }

    setGamesMsg("Creating game…");

    const insertPayload = {
      name,
      format: newGameFormat,
      handicap_pct,
      is_default: false,
      active: true,
      sort_order: games.length,
    };
    if (isScramble) {
      insertPayload.handicap_allowance = handicap_allowance; // counting_rule keeps its DB default; unused for Scramble
    } else if (isComposite) {
      insertPayload.segments = segments; // counting_rule keeps its DB default; unused for composite games
    } else {
      insertPayload.counting_rule = counting_rule;
    }

    const { data: gameRow, error: gameError } = await supabase
      .from("games")
      .insert(insertPayload)
      .select("id")
      .single();

    if (gameError) {
      console.error(gameError);
      setGamesMsg(`Error creating game: ${errToText(gameError)}`);
      return;
    }

    if (isTeamFormat) {
      for (const group of teamGroups) {
        const { data: teamRow, error: teamError } = await supabase
          .from("game_teams")
          .insert({ game_id: gameRow.id, name: group.label })
          .select("id")
          .single();

        if (teamError) {
          console.error(teamError);
          setGamesMsg(`Game created, but error building team "${group.label}": ${errToText(teamError)}`);
          continue;
        }

        const memberRows = group.members.map((p) => ({
          game_id: gameRow.id,
          team_id: teamRow.id,
          player_id: p.id,
        }));

        const { error: memberError } = await supabase.from("game_team_members").insert(memberRows);
        if (memberError) {
          console.error(memberError);
          setGamesMsg(`Game created, but error assigning team "${group.label}": ${errToText(memberError)}`);
        }
      }
    }

    setGamesMsg(`"${name}" created ✅`);
    setNewGameName("");
    await loadGames();
    await loadGameTeams();
    await loadGameTeamMembers();
  }

  async function deleteGame(game) {
    if (!adminOn) return alert("Admin only.");
    if (!confirm(`Delete "${game.name}"? This also removes its team assignments (not players or scores).`)) return;

    const { error } = await supabase.from("games").delete().eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error deleting game: ${errToText(error)}`);
      return;
    }
    await loadGames();
    await loadGameTeams();
    await loadGameTeamMembers();
  }

  async function toggleGameActive(game) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase.from("games").update({ active: !game.active }).eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error updating game: ${errToText(error)}`);
      return;
    }
    await loadGames();
  }

  // Admin already passed the PIN gate to get here, so this is a free toggle
  // (no re-prompt) — the passcode gate lives on the public Leaderboard side.
  async function toggleGameLocked(game) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase.from("games").update({ locked: !game.locked }).eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error updating game: ${errToText(error)}`);
      return;
    }
    await loadGames();
  }

  // Leaderboard-side unlock: anyone who knows the passcode can reveal a
  // locked board. Unlocking is global (persisted), matching how locking
  // itself works — meant for a "reveal to everyone" moment, not a private
  // per-viewer peek.
  async function unlockGameBoard(game, passcode) {
    if (passcode !== ADMIN_PIN) {
      return { ok: false, error: "Incorrect passcode." };
    }
    const { error } = await supabase.from("games").update({ locked: false }).eq("id", game.id);
    if (error) {
      console.error(error);
      return { ok: false, error: errToText(error) };
    }
    await loadGames();
    return { ok: true };
  }

  async function enterWithCode() {
    const code = entryCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter a 6-character code.");

    const { data: f, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time,starting_hole,round_id")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      console.error(error);
      alert(`Error checking code: ${errToText(error)}`);
      return;
    }
    if (!f) {
      alert("Code not found.");
      return;
    }

    const memberRows = foursomePlayers.filter((fp) => fp.foursome_id === f.id);
    const memberIds = memberRows.map((x) => x.player_id);
    const memberPlayers = players.filter((p) => memberIds.includes(p.id));

    if (memberPlayers.length === 0) {
      alert("This foursome has no players assigned yet.");
      return;
    }

    setActiveFoursome(f);
    setActivePlayers(memberPlayers);
    setHole(clampInt(f.starting_hole, 1));
    setHoleInputs({});
    setRoundComplete(false);
    setTab("enter");
  }

  function getExistingScore(pid, holeNum, roundId) {
    const queued = pendingScores.find(
      (q) => q.player_id === pid && q.hole === holeNum && (roundId == null || q.round_id === roundId)
    );
    if (queued) return queued.score;
    const row = scores.find(
      (s) => s.player_id === pid && clampInt(s.hole, 0) === holeNum && (roundId == null || s.round_id === roundId)
    );
    return row ? clampInt(row.score, 0) : null;
  }

  /**
   * Groups the active foursome's players for one hole's entry row(s).
   * Normally one group per player. But if this hole is shared scoring —
   * every hole in a standalone Scramble game, or a "shared" segment
   * (Scramble) of an active composite game — and 2+ of these players are
   * teammates in that game, they collapse into one shared group — same
   * score gets saved under every member (saveHoleThenNavigate doesn't need
   * to change: it already just writes whatever's in holeInputs[p.id] for
   * each player).
   */
  function holeEntryGroups(holeNum, playersInGroup) {
    // Each entry is a set of players who share ONE score on this hole.
    const sharedSets = [];
    let sharedGameFound = false;

    for (const g of games) {
      if (!g.active) continue;

      // Foursomes (alternate shot) matches: each pair plays one ball, on every hole.
      if (isMatchFormat(g.format)) {
        for (const m of matches) {
          if (m.game_id !== g.id || m.match_type !== "foursomes" || m.round_id !== activeFoursome?.round_id) continue;
          for (const side of ["a", "b"]) {
            sharedSets.push(matchPlayers.filter((mp) => mp.match_id === m.id && mp.side === side).map((mp) => mp.player_id));
          }
        }
        continue;
      }

      if (sharedGameFound) continue; // only the first scramble/composite game with a shared hole counts
      const isScramble = g.format === "scramble_2" || g.format === "scramble_4";
      let isSharedHole = isScramble; // every hole is shared in a standalone Scramble game

      if (!isScramble) {
        if (g.format !== "composite") continue;
        const seg = (g.segments || []).find((s) => (s.holes || []).includes(holeNum));
        isSharedHole = !!seg && seg.formatType === "shared";
      }
      if (!isSharedHole) continue;

      sharedGameFound = true;
      const teamIdsForGame = new Set(gameTeams.filter((t) => t.game_id === g.id).map((t) => t.id));
      const membersByTeam = new Map();
      for (const row of gameTeamMembers) {
        if (!teamIdsForGame.has(row.team_id)) continue;
        if (!membersByTeam.has(row.team_id)) membersByTeam.set(row.team_id, []);
        membersByTeam.get(row.team_id).push(row.player_id);
      }
      for (const memberIds of membersByTeam.values()) sharedSets.push(memberIds);
    }

    if (sharedSets.length === 0) return playersInGroup.map((p) => ({ key: p.id, players: [p], shared: false }));

    const idsInGroup = new Set(playersInGroup.map((p) => p.id));
    const consumed = new Set();
    const groups = [];

    for (const memberIds of sharedSets) {
      const presentIds = memberIds.filter((pid) => idsInGroup.has(pid) && !consumed.has(pid));
      if (presentIds.length >= 2) {
        const groupPlayers = presentIds.map((pid) => playersInGroup.find((p) => p.id === pid)).filter(Boolean);
        groups.push({ key: presentIds.join("-"), players: groupPlayers, shared: true });
        for (const pid of presentIds) consumed.add(pid);
      }
    }

    for (const p of playersInGroup) {
      if (!consumed.has(p.id)) groups.push({ key: p.id, players: [p], shared: false });
    }

    groups.sort((a, b) => playersInGroup.indexOf(a.players[0]) - playersInGroup.indexOf(b.players[0]));
    return groups;
  }

  useEffect(() => {
    if (!activeFoursome) return;
    const obj = {};
    for (const p of activePlayers) {
      const existing = getExistingScore(p.id, hole, activeFoursome.round_id);
      obj[p.id] = existing != null ? String(existing) : "";
    }
    setHoleInputs(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFoursome?.id, hole]);

  // Sends every waiting score. Anything the database refuses (offline, error) stays queued
  // and is shown in the banner; the rest is removed once it is safely uploaded.
  async function uploadPendingScores() {
    if (uploadingRef.current) {
      uploadAgainRef.current = true; // something new was queued mid-upload: go round again
      return;
    }
    uploadingRef.current = true;
    try {
      do {
        uploadAgainRef.current = false;
        const queue = readPendingScores();
        if (queue.length === 0) break;
        const failed = new Set();
        let lastError = "";
        for (const item of queue) {
          const { error } = await supabase
            .from("scores")
            .upsert(
              { player_id: item.player_id, hole: item.hole, score: item.score, round_id: item.round_id },
              { onConflict: "player_id,hole,round_id" }
            );
          if (error) {
            failed.add(pendingKey(item));
            lastError = errToText(error);
          }
        }
        // Keep what failed, plus anything queued while this upload was running.
        const sent = new Map(queue.filter((q) => !failed.has(pendingKey(q))).map((q) => [pendingKey(q), q.score]));
        const remaining = readPendingScores().filter((c) => !(sent.has(pendingKey(c)) && sent.get(pendingKey(c)) === c.score));
        writePendingScores(remaining);
        setPendingScores(remaining);
        setPendingErr(remaining.length ? lastError : "");
        if (sent.size > 0) await loadScores();
      } while (uploadAgainRef.current);
    } finally {
      uploadingRef.current = false;
    }
  }

  // Returns false only when a typed score is invalid (nothing is saved or moved).
  async function saveHoleThenNavigate(nextHole) {
    if (!activeFoursome) return false;

    const entries = [];
    for (const p of activePlayers) {
      const raw = (holeInputs[p.id] ?? "").trim();
      if (!raw) continue;
      const sc = clampInt(raw, 0);
      if (sc < 1 || sc > 20) {
        alert(`Score for ${p.name} looks wrong (1–20).`);
        return false;
      }
      entries.push({ player_id: p.id, hole, score: sc, round_id: activeFoursome.round_id });
    }

    if (entries.length > 0) {
      // Write to the phone first, so nothing can be lost; then try to send.
      const next = [...readPendingScores().filter((q) => !entries.some((e) => pendingKey(e) === pendingKey(q))), ...entries];
      writePendingScores(next);
      setPendingScores(next);
      await uploadPendingScores();
    } else {
      await loadScores();
    }

    setHole(nextHole);
    return true;
  }

  // ---------------------------
  // EXCEL IMPORT
  // ---------------------------
  function normKey(k) {
    return String(k || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

async function parseTeeSheetFile(file) {
  setImportMsg("");
  setTeeSheetFile(file);

  if (!file) {
    setTeeSheetRows([]);
    return;
  }

  try {
    // Loaded on demand — the Excel library is only needed here, during an
    // Admin import, so nobody else has to download it just to open the app.
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];

    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!raw || raw.length === 0) {
      setTeeSheetRows([]);
      setImportMsg("No rows found in the spreadsheet.");
      return;
    }

    const rows = raw.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) out[normKey(k)] = v;
      return out;
    });

    // Require these columns (matches your sheet)
    const required = ["team", "tee_time", "starting_hole", "first_name", "last_name"];
    const missing = required.filter((k) => !Object.prototype.hasOwnProperty.call(rows[0] || {}, k));
    if (missing.length) {
      setTeeSheetRows([]);
      setImportMsg(`Missing required columns: ${missing.join(", ")}`);
      return;
    }

    setTeeSheetRows(rows);
    setImportMsg(`Loaded ${rows.length} rows from "${sheetName}".`);
  } catch (e) {
    console.error(e);
    setTeeSheetRows([]);
    setImportMsg("Could not read that Excel file.");
  }
}

async function importFromTeeSheet() {
  if (!adminOn) return alert("Admin only.");
  if (!teeSheetRows.length) return alert("Upload a tee sheet first.");

  const targetRoundId = appSettings.multi_round_enabled ? importRoundId || activeRound?.id : activeRound?.id;
  if (!targetRoundId) {
    setImportMsg("No round to import into yet — reload the page and try again.");
    return;
  }

  setImportMsg("Importing…");
  await runTeeSheetImport(teeSheetRows, { replace: importReplaceFoursomes, targetRoundId, say: setImportMsg });
}

async function runTeeSheetImport(rows, { replace, targetRoundId, say }) {
  try {
    // Optional wipe (you have this checkbox already) — scoped to this round only,
    // so re-importing for one round never touches another round's foursomes.
    if (replace) {
      const roundFoursomeIds = foursomes.filter((f) => f.round_id === targetRoundId).map((f) => f.id);

      if (roundFoursomeIds.length) {
        const delFP = await supabase.from("foursome_players").delete().in("foursome_id", roundFoursomeIds);
        if (delFP.error) {
          console.error(delFP.error);
          say(`Error clearing assignments: ${errToText(delFP.error)}`);
          return false;
        }
      }

      const delF = await supabase.from("foursomes").delete().eq("round_id", targetRoundId);

      if (delF.error) {
        console.error(delF.error);
        say(`Error clearing foursomes: ${errToText(delF.error)}`);
        return false;
      }
    }

    // ---------- Build desired players list from sheet ----------
    const desiredPlayers = [];
    for (const r of rows) {
      const name = fullNameFromRow(r);
      if (!name) continue;

      desiredPlayers.push({
        name,
        handicap: clampInt(r.handicap, 0),
        charity: String(r.charity || "").trim() || null,
        // The "team" column drives both the physical foursome (below) and
        // this — players sharing a value here are also the pool a
        // 2-man/4-man game's teams are built from. One column, one group.
        team_label: String(r.team || "").trim() || null,
      });
    }

    // ---------- Read fresh players from DB ----------
    const playersBefore = await supabase
      .from("players")
      .select("id,name,handicap,charity,team_label")
      .order("created_at", { ascending: true });

    if (playersBefore.error) {
      console.error(playersBefore.error);
      say(`Error reading players: ${errToText(playersBefore.error)}`);
      return false;
    }

    const existingByName = new Map(
      (playersBefore.data || []).map((p) => [String(p.name || "").trim().toLowerCase(), p])
    );

    // New players get inserted. Players already in the system get their
    // handicap/charity/team synced to match the sheet, so re-uploading a
    // corrected sheet actually fixes a typo instead of only adding new people.
    const missingPlayers = [];
    const updatedPlayers = [];
    for (const p of desiredPlayers) {
      const key = p.name.toLowerCase();
      const existing = existingByName.get(key);

      if (!existing) {
        existingByName.set(key, p);
        missingPlayers.push(p);
        continue;
      }

      const changed =
        clampInt(existing.handicap, 0) !== p.handicap ||
        (existing.charity || null) !== p.charity ||
        (existing.team_label || null) !== p.team_label;

      if (changed) {
        updatedPlayers.push({
          id: existing.id,
          name: p.name, // upsert still validates NOT NULL columns even on the update path
          handicap: p.handicap,
          charity: p.charity,
          team_label: p.team_label,
        });
      }
    }

    if (missingPlayers.length) {
      const insPlayers = await supabase.from("players").insert(missingPlayers);
      if (insPlayers.error) {
        console.error(insPlayers.error);
        say(`Error inserting players: ${errToText(insPlayers.error)}`);
        return false;
      }
    }

    if (updatedPlayers.length) {
      const updPlayers = await supabase.from("players").upsert(updatedPlayers, { onConflict: "id" });
      if (updPlayers.error) {
        console.error(updPlayers.error);
        say(`Error updating players: ${errToText(updPlayers.error)}`);
        return false;
      }
    }

    // Re-read players (fresh IDs)
    const playersAfter = await supabase
      .from("players")
      .select("id,name")
      .order("created_at", { ascending: true });

    if (playersAfter.error) {
      console.error(playersAfter.error);
      say(`Error reloading players: ${errToText(playersAfter.error)}`);
      return false;
    }

    const playerIdByName = new Map(
      (playersAfter.data || []).map((p) => [String(p.name || "").trim().toLowerCase(), p.id])
    );

    // ---------- Build group list + metadata from sheet ----------
    // "team" is the one column that drives grouping — the foursome (this
    // round's physical playing group + tee time/code) and the game-team
    // pool (players.team_label, above) are the same value on purpose.
    const groupsNeeded = Array.from(
      new Set(rows.map((r) => String(r.team || "").trim()).filter(Boolean))
    );

    const groupMeta = new Map();
    for (const r of rows) {
      const group_name = String(r.team || "").trim();
      if (!group_name) continue;

      if (!groupMeta.has(group_name.toLowerCase())) {
        const rawStart = Number(r.starting_hole);
        const safeStart = rawStart >= 1 && rawStart <= 18 ? Math.trunc(rawStart) : 1;

        groupMeta.set(group_name.toLowerCase(), {
          tee_time: excelTimeToDbTime(r.tee_time),
          starting_hole: safeStart,
        });
      }
    }

    // Read existing foursomes (fresh), scoped to this round
    const existingF = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time,starting_hole,created_at")
      .eq("round_id", targetRoundId);

    if (existingF.error) {
      console.error(existingF.error);
      say(`Error reading foursomes: ${errToText(existingF.error)}`);
      return false;
    }

    const foursomeByGroup = new Map(
      (existingF.data || []).map((f) => [String(f.group_name || "").trim().toLowerCase(), f])
    );

    // ---------- Create missing foursomes using metadata ----------
    let newFoursomes = 0;

    for (const group_name of groupsNeeded) {
      const key = group_name.toLowerCase();
      if (foursomeByGroup.has(key)) continue;

      let created = null;
      const meta = groupMeta.get(key) || {};

      for (let tries = 0; tries < 10 && !created; tries++) {
        const code = makeCode(6);
        const res = await supabase
          .from("foursomes")
          .insert({
            group_name,
            code,
            tee_time: meta.tee_time ?? null,
            starting_hole: meta.starting_hole ?? 1,
            round_id: targetRoundId,
          })
          .select("id,group_name,code")
          .single();

        if (!res.error) created = res.data;
      }

      if (!created) {
        say(`Could not create foursome "${group_name}". (RLS / code unique / schema issue)`);
        return false;
      }

      newFoursomes += 1;
    }

    // Re-read foursomes (fresh IDs), scoped to this round
    const foursomesAfter = await supabase
      .from("foursomes")
      .select("id,group_name")
      .eq("round_id", targetRoundId)
      .order("created_at", { ascending: true });

    if (foursomesAfter.error) {
      console.error(foursomesAfter.error);
      say(`Error reloading foursomes: ${errToText(foursomesAfter.error)}`);
      return false;
    }

    const foursomeIdByGroup = new Map(
      (foursomesAfter.data || []).map((f) => [String(f.group_name || "").trim().toLowerCase(), f.id])
    );

    // ---------- Assign players to foursomes ----------
    const existingAssign = await supabase
      .from("foursome_players")
      .select("foursome_id,player_id");

    if (existingAssign.error) {
      console.error(existingAssign.error);
      say(`Error reading existing assignments: ${errToText(existingAssign.error)}`);
      return false;
    }

    const existingSet = new Set(
      (existingAssign.data || []).map((fp) => `${fp.foursome_id}::${fp.player_id}`)
    );

    const assignmentInserts = [];
    for (const r of rows) {
      const group = String(r.team || "").trim();
      const name = fullNameFromRow(r);
      if (!group || !name) continue;

      const fid = foursomeIdByGroup.get(group.toLowerCase());
      const pid = playerIdByName.get(name.toLowerCase());
      if (!fid || !pid) continue;

      const k = `${fid}::${pid}`;
      if (existingSet.has(k)) continue;

      existingSet.add(k);
      assignmentInserts.push({ foursome_id: fid, player_id: pid });
    }

    if (assignmentInserts.length) {
      const insFP = await supabase.from("foursome_players").insert(assignmentInserts);
      if (insFP.error) {
        console.error(insFP.error);
        say(`Error inserting assignments: ${errToText(insFP.error)}`);
        return false;
      }
    }

    // Refresh UI state after import
    await initialLoad();

    say(
      `Import complete ✅ New players: ${missingPlayers.length} • Updated players: ${updatedPlayers.length} • New foursomes: ${newFoursomes} • New assignments: ${assignmentInserts.length}`
    );
    return true;
  } catch (e) {
    console.error(e);
    say(`Import crashed: ${errToText(e)}`);
    return false;
  }
}

  return (
  <div className="appPage" style={styles.page}>

    {/* Scorecard printing: only while a print is in progress (printAllOn),
        so the landscape page setup never leaks into any other printing. One
        landscape sheet = two cards side by side. The rest of the app is
        display:none'd (not just invisible) so it can't add blank sheets. */}
    {printAllOn && (
      <style>{`
        @page { size: landscape; margin: 0.3in; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          .noPrint { display: none !important; }
          .appPage { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          #printRoot { background: #fff !important; color: #000 !important; padding: 0 !important; margin: 0 !important; }
          .printPage { break-after: page; page-break-after: always; break-inside: avoid; }
          .printPage:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    )}

      {tab === "tv" && (
        <TvMode
          eventName={eventName}
          subtitle={[
            gameResults.length > 1
              ? (gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0]).game.name
              : null,
            appSettings.multi_round_enabled
              ? (selectedRoundId || activeRound?.id) === ROUND_OVERALL
                ? "Overall"
                : rounds.find((r) => r.id === (selectedRoundId || activeRound?.id))?.label
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          board={gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0] || null}
          messages={visibleBroadcast}
          forms={tvForms}
          onExit={() => setTab("home")}
        />
      )}

      <div className="noPrint" style={tab === "tv" ? { display: "none" } : styles.shell}>
        {/* HOME (no top nav) */}
        {tab === "home" && (
          <div style={styles.homeCard}>
            <div style={{ textAlign: "center" }}>
              <img
                src={logoSrc}
                alt={`${eventName} logo`}
                style={{
                  width: 210,
                  height: "auto",
                  // A tall uploaded logo shouldn't push the menu off screen.
                  maxHeight: 200,
                  objectFit: "contain",
                  display: "block",
                  margin: "0 auto",
                  // The built-in spool's flag+needle jut out to the right, so
                  // centering its full bounding box makes the spool itself
                  // look left-of-center. Nudge right so the spool's own base
                  // lines up under "The" in the title below. (An uploaded
                  // logo is centered as-is.)
                  transform: customLogo ? "none" : "translateX(22px)",
                }}
              />

              <div style={styles.homeTitle}>
                {(() => {
                  const words = eventName.trim().split(/\s+/).filter(Boolean);
                  const first = words[0] || eventName;
                  const rest = words.slice(1).join(" ");
                  return rest ? (
                    <>
                      {first}
                      <br />
                      {rest}
                    </>
                  ) : (
                    first
                  );
                })()}
              </div>

              {tagline ? <div style={styles.homeSub}>{tagline}</div> : null}

              <div style={styles.homeRule} />
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                Leaderboard
              </button>

              <button
                style={styles.bigBtn}
                onClick={async () => {
                  await loadBroadcast();
                  setTab("broadcast");
                }}
              >
                The Broadcast
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("code")}>
                Enter Scores
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                Admin
              </button>
            </div>

            <div style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: THEME.textMuted }}>
              Manufacturers Golf &amp; CC
            </div>
          </div>
        )}

        {/* CODE GATE SCREEN (enter scores) */}
        {tab === "code" && (
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <button style={styles.smallBtn} onClick={() => setTab("home")}>
                Home
              </button>
              {visibleStatus ? <div style={{ fontSize: 12, color: THEME.textMuted }}>{visibleStatus}</div> : null}
            </div>

            <div style={{ marginTop: 12, fontSize: 22, fontWeight: 950, letterSpacing: -0.2 }}>
              Enter Scores
            </div>
            <div style={styles.helpText}>
              Enter your <b>6-character foursome code</b> to score your group.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                style={styles.input}
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-character code"
                maxLength={6}
                autoCapitalize="characters"
              />
              <button style={styles.bigBtn} onClick={enterWithCode}>
                Continue
              </button>

              <div style={{ fontSize: 12, color: THEME.textMuted }}>
                You can only enter scores for your foursome code.
              </div>
            </div>
          </div>
        )}

        {/* TOP NAV (all non-home pages) */}
        {tab !== "home" && tab !== "code" && (
          <header style={styles.header}>
            <div style={styles.headerTop}>
              <div style={styles.brand}>
                <div style={styles.brandTitle}>{eventName}</div>
                {visibleStatus ? <div style={styles.brandSub}>{visibleStatus}</div> : null}
              </div>

              <nav style={styles.nav}>
                <button style={styles.navBtn} onClick={() => setTab("home")}>
                  Home
                </button>
                <button
                  style={tab === "leaderboard" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("leaderboard")}
                >
                  Leaderboard
                </button>
                <button
                  style={tab === "broadcast" ? styles.navBtnActive : styles.navBtn}
                  onClick={async () => {
                    await loadBroadcast();
                    setTab("broadcast");
                  }}
                >
                  The Broadcast
                </button>
                <button style={styles.navBtn} onClick={() => setTab("code")}>
                  Enter Scores
                </button>
                <button
                  style={tab === "admin" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("admin")}
                >
                  Admin
                </button>
              </nav>
            </div>
          </header>
        )}

        {pendingScores.length > 0 && (
          <div
            role="status"
            style={{
              ...styles.card,
              marginBottom: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              border: `2px solid ${THEME.accent}`,
            }}
          >
            <div style={{ minWidth: 0, fontSize: 14 }}>
              <b>
                {pendingScores.length} score{pendingScores.length === 1 ? "" : "s"} saved on this phone
              </b>{" "}
              — waiting to upload. Keep this page open; it keeps trying.
              {pendingErr ? <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 4 }}>{pendingErr}</div> : null}
            </div>
            <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={uploadPendingScores}>
              Retry now
            </button>
          </div>
        )}

        {/* BROADCAST */}
        {tab === "broadcast" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>The Broadcast</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    await loadPlayers();
                    await loadScores();
                    await loadBroadcast();
                  }}
                >
                  Refresh
                </button>
                <button style={styles.smallBtn} onClick={() => setTab("home")}>
                  Home
                </button>
              </div>
            </div>

            <div style={styles.helpText}>
              Moe!!! Give us the updates.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <BroadcastFeed messages={visibleBroadcast} />
            </div>
          </div>
        )}

        {/* LEADERBOARD */}
        {tab === "leaderboard" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Leaderboard</div>
              <button
                style={styles.smallBtn}
                onClick={async () => {
                  await loadPlayers();
                  await loadScores();
                  await loadGames();
                  await loadGameTeams();
                  await loadGameTeamMembers();
                  await loadRounds();
                }}
              >
                Refresh
              </button>
            </div>

            {/* Round tabs — only when multi-round is on with 2+ rounds. */}
            {appSettings.multi_round_enabled && rounds.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {[{ id: ROUND_OVERALL, label: "Overall" }, ...rounds.map((r) => ({ id: r.id, label: r.label }))].map(
                  (opt) => {
                    const isActive = selectedRoundId ? selectedRoundId === opt.id : opt.id === activeRound?.id;
                    return (
                      <button
                        key={opt.id}
                        style={isActive ? styles.tabBtnActive : styles.tabBtn}
                        onClick={() => setSelectedRoundId(opt.id)}
                      >
                        {opt.label}
                      </button>
                    );
                  }
                )}
              </div>
            )}

            {/* Game tabs — only when more than one game is active. A Simple
                Mode event (the common case) never sees this and renders
                exactly as before. */}
            {gameResults.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {gameResults.map(({ game }) => {
                  // No game is favored by default — the first active one
                  // (by sort order) shows until you pick a different tab.
                  const isActive = selectedGameId ? selectedGameId === game.id : game.id === gameResults[0]?.game.id;
                  return (
                    <button
                      key={game.id}
                      style={isActive ? styles.tabBtnActive : styles.tabBtn}
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      {game.locked ? "🔒 " : ""}
                      {game.name}
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const showRoundTabs = appSettings.multi_round_enabled && rounds.length > 1;

              // Tighter cells than the app-wide table styles, just for the
              // Leaderboard — keeps Player + Score visible together on a
              // phone screen without horizontal scrolling.
              const lbTh = { ...styles.th, padding: "6px 6px", fontSize: 11 };
              const lbTd = { ...styles.td, padding: "8px 6px", fontSize: 13 };
              const lbPill = { ...styles.pill, minWidth: 22, padding: "3px 8px", fontSize: 11 };

              const lockCheckEntry =
                gameResults.length > 0
                  ? gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0]
                  : null;

              if (lockCheckEntry && lockCheckEntry.game.locked) {
                return <LockedBoardPanel game={lockCheckEntry.game} onUnlock={unlockGameBoard} />;
              }

              if (!lockCheckEntry) {
                return <div style={styles.helpText}>No games configured yet.</div>;
              }

              if (isMatchFormat(lockCheckEntry.game.format)) {
                const mg = lockCheckEntry.game;
                const mcfg = mg.config || {};
                return (
                  <>
                    <div style={styles.helpText}>
                      {mg.format === "ryder_cup" ? "Ryder Cup" : "Match play"} — {mg.name}. Auto-refreshes every minute.
                    </div>
                    <MatchBoard
                      game={mg}
                      entries={matchEntriesByGame.get(mg.id) || []}
                      rounds={rounds}
                      selection={selectedRoundId || activeRound?.id}
                      showSessions={showRoundTabs}
                      sideNames={[mcfg.sideA?.name || "Side A", mcfg.sideB?.name || "Side B"]}
                    />
                  </>
                );
              }

              if (gameResults.length <= 1 && !showRoundTabs) {
                const lastRank = lastPlaceRank(leaderboardRows);
                return (
              <>
                <div style={styles.helpText}>
                  Tap a player name to view their scorecard. Auto-refreshes every minute.
                </div>

                <div style={styles.tableWrap}>
                  {/* table-layout: fixed + explicit column widths — without
                      this, an expanded player's 18-hole scorecard (below,
                      in a colSpan cell) would force this whole table, and
                      everything above it, as wide as all 18 holes instead
                      of scrolling inside its own row. */}
                  <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ ...lbTh, width: "16%" }}>#</th>
                        <th style={{ ...lbTh, width: "44%" }}>Player</th>
                        <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>Net vs Par</th>
                        <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                      </tr>
                    </thead>

                    <tbody>
                      {leaderboardRows.map((r, idx) => {
                        const displayNet = r.holesPlayed === 0 ? "—" : formatToPar(r.netToPar);
                        const netStyle =
                          r.holesPlayed === 0
                            ? { opacity: 0.6, color: THEME.textMuted }
                            : { fontWeight: 950, ...netColorStyle(r.netToPar) };

                        const expanded = r.id === scorecardPlayerId;

                        return [
                          <tr key={r.id}>
                            <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                            <td style={{ ...lbTd, minWidth: 120 }}>
                              <button
                                style={{ ...styles.playerLink, display: "inline-flex", alignItems: "center", gap: 6 }}
                                onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                              >
                                {r.name}
                                <span style={expandChevronStyle(expanded)}>▸</span>
                              </button>
                              <div style={styles.playerMeta}>
                                HCP {r.handicap}
                                {r.charity ? ` • ${r.charity}` : ""}
                              </div>
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={netStyle}>{displayNet}</span>
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={lbPill}>{r.holesPlayed}</span>
                            </td>
                          </tr>,
                          expanded && (
                            <tr key={`${r.id}-detail`}>
                              <td colSpan={4} style={expandRowCellStyle}>
                                <ScorecardDetail player={scorecardPlayer} game={null} />
                              </td>
                            </tr>
                          ),
                        ];
                      })}

                      {leaderboardRows.length === 0 && (
                        <tr>
                          <td style={lbTd} colSpan={4}>
                            No players yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
                );
              }

              const { game, rows } = lockCheckEntry;
              const lastRank = lastPlaceRank(rows);
              const isTeamFormat =
                game.format === "better_ball_2" ||
                game.format === "better_ball_4" ||
                game.format === "scramble_2" ||
                game.format === "scramble_4" ||
                game.format === "composite";
              const scoreLabel = GAME_SCORE_LABELS[game.format] || "Score vs Par";

              return (
                  <>
                    <div style={styles.helpText}>
                      {isTeamFormat
                        ? `Team leaderboard for ${game.name}.`
                        : "Tap a player name to view their scorecard."}{" "}
                      Auto-refreshes every minute.
                    </div>

                    <div style={styles.tableWrap}>
                      {/* table-layout: fixed — see the matching comment on
                          the simple leaderboard table above. */}
                      <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ ...lbTh, width: "16%" }}>#</th>
                            <th style={{ ...lbTh, width: "44%" }}>{isTeamFormat ? "Team" : "Player"}</th>
                            <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>{scoreLabel}</th>
                            <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                          </tr>
                        </thead>

                        <tbody>
                          {rows.map((r, idx) => {
                            const displayScore = r.holesPlayed === 0 ? "—" : formatToPar(r.toPar);
                            const scoreStyle =
                              r.holesPlayed === 0
                                ? { opacity: 0.6, color: THEME.textMuted }
                                : { fontWeight: 950, ...netColorStyle(r.toPar) };

                            const expanded = !isTeamFormat && r.id === scorecardPlayerId;

                            return [
                              <tr key={r.id}>
                                <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                                <td style={{ ...lbTd, minWidth: 120 }}>
                                  {isTeamFormat ? (
                                    <>
                                      <div style={{ fontWeight: 950 }}>{r.name}</div>
                                      <div style={styles.playerMeta}>
                                        {r.members.map((m) => `${m.name} (HCP ${m.handicap})`).join(" • ")}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        style={{
                                          ...styles.playerLink,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                        onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                                      >
                                        {r.name}
                                        <span style={expandChevronStyle(expanded)}>▸</span>
                                      </button>
                                      <div style={styles.playerMeta}>
                                        HCP {r.handicap}
                                        {r.charity ? ` • ${r.charity}` : ""}
                                      </div>
                                    </>
                                  )}
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={scoreStyle}>{displayScore}</span>
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={lbPill}>{r.holesPlayed}</span>
                                </td>
                              </tr>,
                              expanded && (
                                <tr key={`${r.id}-detail`}>
                                  <td colSpan={4} style={expandRowCellStyle}>
                                    <ScorecardDetail player={scorecardPlayer} game={game} />
                                  </td>
                                </tr>
                              ),
                            ];
                          })}

                          {rows.length === 0 && (
                            <tr>
                              <td style={lbTd} colSpan={4}>
                                No {isTeamFormat ? "teams" : "players"} yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
              );
            })()}
          </div>
        )}

        {/* ENTER SCORES */}
        {tab === "enter" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Enter Scores</div>
                <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                  Foursome: <b>{activeFoursome?.group_name}</b> • Code: <b>{activeFoursome?.code}</b>
                  {appSettings.multi_round_enabled && activeFoursome && (
                    <>
                      {" "}
                      • Round: <b>{rounds.find((r) => r.id === activeFoursome.round_id)?.label || "—"}</b>
                    </>
                  )}
                </div>
              </div>
              <button
                style={styles.smallBtn}
                onClick={() => {
                  setActiveFoursome(null);
                  setActivePlayers([]);
                  setEntryCode("");
                  setTab("code");
                }}
              >
                Change Code
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {(() => {
                // Shotgun start: a group can start on any hole, plays 18 in
                // order from there, and wraps around (e.g. start on 10 ->
                // 10,11,...,18,1,2,...,9). "Last Hole"/"Save & Next" wrap
                // through 1<->18 instead of stopping dead at the ends, and
                // "starting hole" — not hole 1 — is this group's true start.
                const startingHole = clampInt(activeFoursome?.starting_hole, 1);
                const prevHole = hole === 1 ? 18 : hole - 1;
                const nextHole = hole === 18 ? 1 : hole + 1;

                if (roundComplete) {
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 950 }}>All 18 holes entered ✅</div>
                      <div style={styles.helpText}>
                        Your group is all set. Tap below if you need to go back and fix a hole.
                      </div>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setRoundComplete(false);
                          saveHoleThenNavigate(prevHole);
                        }}
                      >
                        Review Last Hole
                      </button>
                    </div>
                  );
                }

                return (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 950 }}>
                      Hole {hole}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>(Par {PARS[hole - 1]})</span>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      {holeEntryGroups(hole, activePlayers).map((grp) => (
                        <div key={grp.key} style={styles.scoreRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {grp.players.map((p) => p.name).join(" / ")}
                            </div>
                            <div style={{ fontSize: 12, color: THEME.textMuted }}>
                              {grp.shared
                                ? "Team score — one shared ball"
                                : `HCP ${clampInt(grp.players[0].handicap, 0)}`}
                            </div>
                          </div>

                          <input
                            style={{ ...styles.input, width: 92, textAlign: "center", fontSize: 16, fontWeight: 900 }}
                            inputMode="numeric"
                            placeholder="—"
                            value={holeInputs[grp.players[0].id] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setHoleInputs((prev) => {
                                const next = { ...prev };
                                for (const p of grp.players) next[p.id] = val;
                                return next;
                              });
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    <div style={styles.navRow}>
                      <button
                        style={styles.smallBtn}
                        disabled={hole === startingHole}
                        onClick={() => saveHoleThenNavigate(prevHole)}
                      >
                        Last Hole
                      </button>

                      <button
                        style={styles.bigBtn}
                        onClick={async () => {
                          const saved = await saveHoleThenNavigate(nextHole);
                          if (saved && nextHole === startingHole) setRoundComplete(true);
                        }}
                      >
                        {nextHole === startingHole ? "Save & Finish" : "Save & Next"}
                      </button>
                    </div>

                    <div style={styles.helpText}>
                      Type scores for your foursome, then hit <b>Save & Next</b>. You can go back with{" "}
                      <b>Last Hole</b>. Leaving a box blank means “no score yet”.
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

    {/* ADMIN */}
{tab === "admin" && (
  <div style={styles.card}>
    <div style={styles.cardTitle}>Admin</div>

    {lastLoadErrors.length > 0 && (
      <div style={{ ...styles.helpText, marginTop: 10 }}>
        <div style={{ fontWeight: 950 }}>Load Errors</div>
        <div style={{ marginTop: 6, fontSize: 12, color: THEME.textMuted }}>
          Last load: {lastLoadAt || "—"}
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            marginTop: 8,
            background: "rgba(22,35,29,0.05)",
            padding: 10,
            borderRadius: 12,
            border: `1px solid ${THEME.border}`,
            fontSize: 12,
            color: THEME.text,
          }}
        >
          {JSON.stringify(lastLoadErrors, null, 2)}
        </pre>
      </div>
    )}

    {!adminOn ? (
      <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 420 }}>
        <label style={styles.label}>
          Enter Admin PIN
          <input
            style={styles.input}
            type="password"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value)}
            inputMode="numeric"
            placeholder="••••••"
          />
        </label>

        <button style={styles.bigBtn} onClick={enterAdmin}>
          Unlock Admin
        </button>

        <div style={styles.helpText}>Simple front-end PIN gate. (We can harden security later.)</div>
      </div>
    ) : (
      <>
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button
            style={styles.smallBtn}
            onClick={() => {
              setAdminOn(false);
              setTab("home");
            }}
          >
            Exit Admin
          </button>

          <button style={styles.smallBtn} onClick={() => initialLoad()}>
            Reload Data
          </button>

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
              color: THEME.textMuted,
              padding: "0 6px",
            }}
          >
            Print stroke dots for
            <select
              style={{ ...styles.input, minWidth: 170, padding: "6px 8px" }}
              value={printGame?.id || ""}
              onChange={(e) => setPrintGameId(e.target.value)}
            >
              {games
                .filter((g) => g.active)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>

          <button
  style={styles.smallBtn}
  onClick={async () => {
    // make sure latest foursomes + assignments are loaded before printing
    await loadFoursomes();
    await loadFoursomePlayers();
    await loadPlayers();
    // The cards carry the logo and the serif title: make sure both are loaded
    // before the print dialog opens, even if this page was opened straight to
    // Admin (never showed Home).
    await Promise.all([
      new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = logoSrc;
      }),
      document.fonts ? document.fonts.load("600 26px Fraunces").catch(() => {}) : null,
    ]);

    setPrintAllOn(true);
    setTimeout(() => window.print(), 100);
  }}
>
  Print Scorecards
</button>

          <button style={styles.smallBtn} onClick={() => setTab("tv")}>
            Launch TV Mode
          </button>

        </div>

        {phoneSetupOn ? (
          <PhoneSetup
            eventName={eventName}
            onSaveEventName={async (name) => {
              const { error } = await supabase
                .from("app_settings")
                .update({ event_name: name, updated_at: new Date().toISOString() })
                .eq("id", 1);
              if (error) {
                console.error(error);
                return errToText(error);
              }
              await loadAppSettings();
              return null;
            }}
            rounds={rounds}
            multiRound={!!appSettings.multi_round_enabled}
            activeRound={activeRound}
            foursomes={foursomes}
            onStart={(rows, opts) => runTeeSheetImport(rows, opts)}
            onExit={() => setPhoneSetupOn(false)}
            onGoto={(t) => {
              setPhoneSetupOn(false);
              setTab(t);
            }}
          />
        ) : (
        <div style={{ ...styles.adminGrid, gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
          {/* Start a Tournament — two ways in, same result */}
          <AdminSection
            title="Start a Tournament"
            subtitle={foursomes.length > 0 ? `${foursomes.length} groups set up` : "Upload an Excel sheet or build it on your phone"}
            open={openAdminSection === "start"}
            onToggle={() => setOpenAdminSection((k) => (k === "start" ? null : "start"))}
          >
            <div style={styles.helpText}>Two ways to set up players, groups and tee times. Both give the same result.</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setPhoneSetupOn(true)}>
                📱 Build on my phone
              </button>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setOpenAdminSection("import")}>
                📄 Upload Excel sheet
              </button>
            </div>
          </AdminSection>

          {/* Event Name */}
          <AdminSection
            title="Event Name"
            subtitle={eventName || "Not set"}
            open={openAdminSection === "eventName"}
            onToggle={() => setOpenAdminSection((k) => (k === "eventName" ? null : "eventName"))}
          >
            <div style={styles.helpText}>Shown on Home, the top nav, print scorecards, and the browser tab.</div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                style={{ ...styles.input, flex: 1, minWidth: 200 }}
                value={eventNameDraft}
                onChange={(e) => {
                  setEventNameDraft(e.target.value);
                  setEventNameMsg("");
                }}
                placeholder="The Ginvitational"
              />
              <button style={styles.bigBtn} onClick={saveEventName}>
                Save
              </button>
            </div>

            {eventNameMsg ? <div style={styles.helpText}>{eventNameMsg}</div> : null}
          </AdminSection>

          {/* Tagline */}
          <AdminSection
            title="Tagline"
            subtitle={tagline || "None"}
            open={openAdminSection === "tagline"}
            onToggle={() => setOpenAdminSection((k) => (k === "tagline" ? null : "tagline"))}
          >
            <div style={styles.helpText}>
              Shown on the Home screen under the event name. Leave it blank to show no tagline.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 200 }}
                    value={taglineDraft}
                    onChange={(e) => {
                      setTaglineDraft(e.target.value);
                      setTaglineMsg("");
                    }}
                    placeholder={DEFAULT_TAGLINE}
                  />
                  <button style={styles.bigBtn} onClick={saveTagline}>
                    Save
                  </button>
                </div>
                {taglineMsg ? <div style={styles.helpText}>{taglineMsg}</div> : null}
              </>
            )}
          </AdminSection>

          {/* Main logo */}
          <AdminSection
            title="Logo"
            subtitle={customLogo ? "Custom logo" : "Default logo"}
            open={openAdminSection === "logo"}
            onToggle={() => setOpenAdminSection((k) => (k === "logo" ? null : "logo"))}
          >
            <div style={styles.helpText}>
              Your main logo — shown on the Home screen, the printed scorecards, and as the browser tab icon. Any
              image works; it's resized automatically. A PNG with a transparent background looks best.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ ...styles.label, marginBottom: 6 }}>{logoDraft ? "Current" : "Current logo"}</div>
                    <img
                      src={logoSrc}
                      alt="Current logo"
                      style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                    />
                  </div>
                  {logoDraft ? (
                    <div>
                      <div style={{ ...styles.label, marginBottom: 6 }}>New logo (not saved yet)</div>
                      <img
                        src={logoDraft}
                        alt="New logo preview"
                        style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                      />
                    </div>
                  ) : null}
                </div>

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    onLogoPicked(e.target.files?.[0] || null);
                    e.target.value = ""; // picking the same file again should still fire
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {logoDraft ? (
                    <>
                      <button style={styles.bigBtn} onClick={() => saveLogo(logoDraft)}>
                        Save logo
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setLogoDraft(null);
                          setLogoMsg("");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                  {customLogo && !logoDraft ? (
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        if (confirm("Go back to the default logo?")) saveLogo(null);
                      }}
                    >
                      Use default logo
                    </button>
                  ) : null}
                </div>

                {logoMsg ? <div style={styles.helpText}>{logoMsg}</div> : null}
              </div>
            )}
          </AdminSection>

          {/* Handicap Basis */}
          <AdminSection
            title="Handicap Basis"
            subtitle={appSettings.handicap_basis === "field_relative" ? "Field-Relative" : "Course Handicap"}
            open={openAdminSection === "handicapBasis"}
            onToggle={() => setOpenAdminSection((k) => (k === "handicapBasis" ? null : "handicapBasis"))}
          >
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={(appSettings.handicap_basis || "course") === "course"}
                  onChange={() => setHandicapBasis("course")}
                />
                Course Handicap — everyone plays off their own handicap.
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={appSettings.handicap_basis === "field_relative"}
                  onChange={() => setHandicapBasis("field_relative")}
                />
                Field-Relative — everyone plays off the lowest handicap among all imported players.
              </label>
            </div>

            <div style={styles.helpText}>
              Applies to the Leaderboard, print scorecards, and the scorecard popup. A plus handicap now correctly
              gives strokes back (marked with a "+") instead of being treated as scratch.
            </div>
          </AdminSection>

          {/* Import Tee Sheet */}
          <AdminSection
            title="Import Tee Sheet"
            subtitle={players.length > 0 ? `${players.length} players imported` : "No import yet"}
            open={openAdminSection === "import"}
            onToggle={() => setOpenAdminSection((k) => (k === "import" ? null : "import"))}
          >

            {/* gridTemplateColumns: minmax(0,1fr) instead of the implicit
                default column — a grid track otherwise sizes to the widest
                child's min-content (e.g. the preview table below), which
                stretches every other field in this grid along with it. */}
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
              {appSettings.multi_round_enabled && (
                <label style={styles.label}>
                  Round
                  <select
                    style={styles.input}
                    value={importRoundId || activeRound?.id || ""}
                    onChange={(e) => setImportRoundId(e.target.value)}
                  >
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.is_active ? " (active)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => parseTeeSheetFile(e.target.files?.[0] || null)}
              />

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: THEME.textMuted }}>
                <input
                  type="checkbox"
                  checked={importReplaceFoursomes}
                  onChange={(e) => setImportReplaceFoursomes(e.target.checked)}
                />
                Replace existing foursomes + assignments first (recommended)
              </label>

              <button style={styles.bigBtn} onClick={importFromTeeSheet}>
                Import Tee Sheet
              </button>

              {importMsg ? <div style={styles.helpText}>{importMsg}</div> : null}

              {teeSheetRows.length > 0 && (
                <div style={{ fontSize: 12, color: THEME.textMuted, minWidth: 0 }}>
                  Preview (first 5 of {teeSheetRows.length} rows):
                  <div style={{ marginTop: 8, overflowX: "auto" }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Team</th>
                          <th style={styles.th}>Tee</th>
                          <th style={styles.th}>Hole</th>
                          <th style={styles.th}>Name</th>
                          <th style={styles.th}>HCP</th>
                          <th style={styles.th}>Charity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teeSheetRows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            <td style={styles.td}>{r.team || "—"}</td>
                            <td style={styles.td}>{r.tee_time || "—"}</td>
                            <td style={styles.td}>{r.starting_hole || "—"}</td>
                            <td style={styles.td}>{fullNameFromRow(r) || "—"}</td>
                            <td style={styles.td}>{r.handicap ?? "—"}</td>
                            <td style={styles.td}>{r.charity || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {teeSheetFile ? (
                <div style={{ fontSize: 12, color: THEME.textMuted }}>
                  File: <b>{teeSheetFile.name}</b>
                </div>
              ) : null}
            </div>
          </AdminSection>

          {/* Players & Groups — edit after the tournament is set up */}
          <AdminSection
            title="Players & Groups"
            subtitle={`${players.length} players • ${foursomes.length} groups`}
            open={openAdminSection === "foursomes"}
            onToggle={() => setOpenAdminSection((k) => (k === "foursomes" ? null : "foursomes"))}
          >
            <div style={{ marginTop: 8 }}>
              <RosterEditor
                players={players}
                foursomes={foursomes}
                foursomePlayers={foursomePlayers}
                rounds={rounds}
                activeRound={activeRound}
                multiRound={!!appSettings.multi_round_enabled}
                onChanged={initialLoad}
              />
            </div>
          </AdminSection>

          {/* Multi-Game setup */}
          <AdminSection
            title="Games"
            subtitle={
              games.length > 0
                ? `${games.length} game${games.length === 1 ? "" : "s"} configured`
                : "No games yet"
            }
            open={openAdminSection === "games"}
            onToggle={() => setOpenAdminSection((k) => (k === "games" ? null : "games"))}
          >

            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
              <input
                type="checkbox"
                checked={!!appSettings.multi_game_enabled}
                onChange={(e) => setMultiGameEnabled(e.target.checked)}
              />
              Enable multiple games for this event
            </label>

            {!appSettings.multi_game_enabled && (
              <div style={styles.helpText}>
                Off by default. Every game below still works — lock/unlock, activate/deactivate, delete — this
                just hides the "Add Game" builder until you need more than one game running at once.
              </div>
            )}

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {games.map((g) => (
                    <div key={g.id} style={styles.foursomeCard}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 950 }}>
                            {g.name}{" "}
                            {!g.active && (
                              <span style={{ ...styles.strokePill, marginLeft: 6, opacity: 0.6 }}>Inactive</span>
                            )}
                            {g.locked && (
                              <span style={{ ...styles.strokePill, marginLeft: 6 }}>🔒 Locked</span>
                            )}
                          </div>
                          {isMatchFormat(g.format) ? (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} • {HANDICAP_MODES[g.config?.handicapMode] || "Strokes off the lowest"}
                              {g.config?.handicapMode !== "gross" ? ` (${g.handicap_pct}%)` : ""} •{" "}
                              {matches.filter((m) => m.game_id === g.id).length} matches
                              {g.format === "ryder_cup" ? ` • ${g.config?.sideA?.name || "A"} vs ${g.config?.sideB?.name || "B"}` : ""}
                            </div>
                          ) : g.format === "composite" ? (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} —{" "}
                              {(g.segments || [])
                                .map((s) => `Holes ${Math.min(...s.holes)}-${Math.max(...s.holes)}: ${s.label}`)
                                .join(" • ")}
                            </div>
                          ) : g.format === "scramble_2" || g.format === "scramble_4" ? (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} • HCP {(g.handicap_allowance || []).join("/")}%
                              (low → high)
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} • HCP {g.handicap_pct}% • Counts{" "}
                              {g.counting_rule?.scoresCounted} ({(g.counting_rule?.slots || []).join(" + ")})
                            </div>
                          )}
                          {(g.format === "better_ball_2" ||
                            g.format === "better_ball_4" ||
                            g.format === "scramble_2" ||
                            g.format === "scramble_4" ||
                            g.format === "composite") && (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              Teams: {gameTeams.filter((t) => t.game_id === g.id).length}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button style={styles.smallBtn} onClick={() => toggleGameLocked(g)}>
                            {g.locked ? "Unlock" : "Lock"}
                          </button>
                          <button style={styles.smallBtn} onClick={() => toggleGameActive(g)}>
                            {g.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                      {isMatchFormat(g.format) && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            style={{ ...styles.smallBtn, minHeight: 44 }}
                            onClick={() => setOpenMatchGameId((id) => (id === g.id ? null : g.id))}
                          >
                            {openMatchGameId === g.id ? "Hide matches" : "Manage matches"}
                          </button>
                          {openMatchGameId === g.id &&
                            (matchReady ? (
                              <MatchEditor
                                game={g}
                                players={players}
                                rounds={rounds}
                                multiRound={!!appSettings.multi_round_enabled}
                                activeRoundId={activeRound?.id}
                                matches={matches}
                                matchPlayers={matchPlayers}
                                gameTeams={gameTeams}
                                gameTeamMembers={gameTeamMembers}
                                foursomes={foursomes}
                                foursomePlayers={foursomePlayers}
                                onChanged={loadMatches}
                              />
                            ) : (
                              <MatchSetupNotice />
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {games.length === 0 && <div style={styles.helpText}>No games yet.</div>}
                </div>

                {appSettings.multi_game_enabled && (
                  <>
                    <div style={styles.hr} />

                    <div style={styles.sectionLabel}>Add Game</div>

                    <div style={{ display: "grid", gap: 10 }}>
                  <label style={styles.label}>
                    Format
                    <select
                      style={styles.input}
                      value={newGameFormat}
                      onChange={(e) => selectNewGameFormat(e.target.value)}
                    >
                      {Object.entries(GAME_FORMAT_LABELS)
                        .filter(([key]) => key !== "ryder_cup") // parked for now
                        .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={styles.label}>
                    Name
                    <input
                      style={styles.input}
                      value={newGameName}
                      onChange={(e) => setNewGameName(e.target.value)}
                    />
                  </label>

                  {(GAME_PRESETS[newGameFormat] || []).length > 1 && (
                    <div>
                      <div style={{ ...styles.label, marginBottom: 6 }}>Preset</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {GAME_PRESETS[newGameFormat].map((preset) => (
                          <button
                            key={preset.key}
                            style={newGamePresetKey === preset.key ? styles.navBtnActive : styles.smallBtn}
                            onClick={() => applyPreset(preset)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {newGameFormat === "scramble_2" || newGameFormat === "scramble_4" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={styles.label}>
                        Handicap % per player, lowest handicap to highest — a blend, not a per-player deduction
                      </div>
                      {newGameScramblePcts.map((pct, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12, color: THEME.textMuted, minWidth: 120 }}>
                            {i === 0
                              ? "Lowest handicap"
                              : i === newGameScramblePcts.length - 1
                              ? "Highest handicap"
                              : `${i + 1}${i === 1 ? "nd" : "rd"} lowest`}
                          </span>
                          <input
                            style={{ ...styles.input, width: 80 }}
                            type="number"
                            min={0}
                            max={100}
                            value={pct}
                            onChange={(e) => setScramblePct(i, e.target.value)}
                          />
                          <span style={{ fontSize: 12, color: THEME.textMuted }}>%</span>
                        </div>
                      ))}
                      <div style={styles.helpText}>
                        Team handicap = each teammate's own handicap × their %, added together. The two defaults
                        above are a common starting point — change them to whatever your event uses.
                      </div>
                    </div>
                  ) : (
                    newGameFormat !== "composite" && !isMatchFormat(newGameFormat) && (
                      <label style={styles.label}>
                        Handicap %
                        <input
                          style={styles.input}
                          type="number"
                          min={0}
                          max={150}
                          value={newGameHandicapPct}
                          onChange={(e) => setNewGameHandicapPct(e.target.value)}
                          disabled={newGameFormat === "individual_gross"}
                        />
                      </label>
                    )
                  )}

                  {newGameFormat !== "composite" && newGameFormat !== "scramble_2" && newGameFormat !== "scramble_4" && !isMatchFormat(newGameFormat) && (
                    <label
                      style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: THEME.textMuted }}
                    >
                      <input
                        type="checkbox"
                        checked={newGameAdvancedOn}
                        onChange={(e) => setNewGameAdvancedOn(e.target.checked)}
                      />
                      Advanced: build a custom counting rule
                    </label>
                  )}

                  {newGameFormat !== "composite" &&
                    newGameFormat !== "scramble_2" &&
                    newGameFormat !== "scramble_4" &&
                    !isMatchFormat(newGameFormat) &&
                    newGameAdvancedOn && (
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 12,
                        borderRadius: 12,
                        border: `1px solid ${THEME.border}`,
                      }}
                    >
                      <label style={styles.label}>
                        Scores counted per hole (1–4)
                        <input
                          style={styles.input}
                          type="number"
                          min={1}
                          max={4}
                          value={newGameScoresCounted}
                          onChange={(e) => setAdvancedScoresCounted(e.target.value)}
                        />
                      </label>
                      <div style={{ display: "grid", gap: 8 }}>
                        {newGameSlots.map((slot, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                            <span style={{ color: THEME.textMuted, minWidth: 56 }}>Slot {i + 1}</span>
                            <select style={styles.input} value={slot} onChange={(e) => setAdvancedSlot(i, e.target.value)}>
                              <option value="net">Net</option>
                              <option value="gross">Gross</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isMatchFormat(newGameFormat) &&
                    (!matchReady ? (
                      <MatchSetupNotice />
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        <label style={styles.label}>
                          Handicaps
                          <select style={styles.input} value={newGameMatchMode} onChange={(e) => setNewGameMatchMode(e.target.value)}>
                            {Object.entries(HANDICAP_MODES).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {newGameMatchMode !== "gross" && (
                          <label style={styles.label}>
                            Handicap %
                            <input
                              style={styles.input}
                              type="number"
                              min={0}
                              max={150}
                              value={newGameHandicapPct}
                              onChange={(e) => setNewGameHandicapPct(e.target.value)}
                            />
                          </label>
                        )}
                        <div style={styles.helpText}>
                          {newGameMatchMode === "off_lowest"
                            ? "The lowest handicap in each match plays to scratch; everyone else gets the difference on the hardest holes. Foursomes uses half of each pair's combined handicap."
                            : newGameMatchMode === "full"
                            ? "Everyone gets their full handicap strokes."
                            : "No handicap strokes — straight scratch match play."}
                        </div>

                        {newGameFormat === "ryder_cup" && (
                          <>
                            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                              <label style={styles.label}>
                                Side A name
                                <input style={styles.input} value={newGameSideA} onChange={(e) => setNewGameSideA(e.target.value)} />
                              </label>
                              <label style={styles.label}>
                                Side B name
                                <input style={styles.input} value={newGameSideB} onChange={(e) => setNewGameSideB(e.target.value)} />
                              </label>
                              <label style={styles.label}>
                                Points for a win
                                <input
                                  style={styles.input}
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={newGamePointsWin}
                                  onChange={(e) => setNewGamePointsWin(e.target.value)}
                                />
                              </label>
                              <label style={styles.label}>
                                Points for a half
                                <input
                                  style={styles.input}
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={newGamePointsHalf}
                                  onChange={(e) => setNewGamePointsHalf(e.target.value)}
                                />
                              </label>
                            </div>
                            <div style={styles.sectionLabel}>Who is on each side?</div>
                            <RosterPicker
                              players={players}
                              roster={newGameRoster}
                              setRoster={setNewGameRoster}
                              nameA={newGameSideA}
                              nameB={newGameSideB}
                            />
                          </>
                        )}
                        <div style={styles.helpText}>
                          After you create it, add the matches with "Manage matches" on the game's card.
                        </div>
                      </div>
                    ))}

                  {newGameFormat === "composite" && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <label style={styles.label}>
                        Team size
                        <select
                          style={styles.input}
                          value={newGameTeamSize}
                          onChange={(e) => setNewGameTeamSize(clampInt(e.target.value, 2))}
                        >
                          <option value={2}>2-Man</option>
                          <option value={4}>4-Man</option>
                        </select>
                      </label>

                      <div style={styles.label}>Segments (holes 1–18)</div>

                      {newGameSegments.map((seg, i) => {
                        const opt = SEGMENT_FORMAT_OPTIONS[seg.formatKey] || SEGMENT_FORMAT_OPTIONS.best_ball;
                        return (
                          <div
                            key={i}
                            style={{
                              display: "grid",
                              gap: 8,
                              padding: 12,
                              borderRadius: 12,
                              border: `1px solid ${THEME.border}`,
                            }}
                          >
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, color: THEME.textMuted }}>Holes</span>
                              <input
                                style={{ ...styles.input, width: 64 }}
                                type="number"
                                min={1}
                                max={18}
                                value={seg.fromHole}
                                onChange={(e) => updateSegment(i, { fromHole: e.target.value })}
                              />
                              <span style={{ fontSize: 12, color: THEME.textMuted }}>to</span>
                              <input
                                style={{ ...styles.input, width: 64 }}
                                type="number"
                                min={1}
                                max={18}
                                value={seg.toHole}
                                onChange={(e) => updateSegment(i, { toHole: e.target.value })}
                              />
                              <select
                                style={{ ...styles.input, flex: 1, minWidth: 140 }}
                                value={seg.formatKey}
                                onChange={(e) => updateSegment(i, { formatKey: e.target.value })}
                              >
                                {Object.entries(SEGMENT_FORMAT_OPTIONS).map(([key, o]) => (
                                  <option key={key} value={key}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              {newGameSegments.length > 1 && (
                                <button style={styles.dangerBtn} onClick={() => removeSegment(i)}>
                                  Remove
                                </button>
                              )}
                            </div>

                            {opt.kind === "shared" ? (
                              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>% of lower handicap</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.lowPct}
                                  onChange={(e) => updateSegment(i, { lowPct: e.target.value })}
                                />
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>% of higher handicap</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.highPct}
                                  onChange={(e) => updateSegment(i, { highPct: e.target.value })}
                                />
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>Handicap %</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.handicapPct}
                                  onChange={(e) => updateSegment(i, { handicapPct: e.target.value })}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <button style={styles.smallBtn} onClick={addSegment}>
                        + Add Segment
                      </button>

                      <div style={styles.helpText}>
                        {(() => {
                          const gaps = segmentCoverageGaps(newGameSegments);
                          return gaps.length === 0
                            ? "All 18 holes are covered ✓"
                            : `Not yet covered: hole${gaps.length > 1 ? "s" : ""} ${gaps.join(", ")}`;
                        })()}
                      </div>
                    </div>
                  )}

                  {(newGameFormat === "better_ball_2" ||
                    newGameFormat === "better_ball_4" ||
                    newGameFormat === "scramble_2" ||
                    newGameFormat === "scramble_4" ||
                    newGameFormat === "composite") && (
                    <div style={styles.helpText}>
                      {(() => {
                        const teamSize =
                          newGameFormat === "composite" ? clampInt(newGameTeamSize, 2) : GAME_FORMAT_TEAM_SIZE[newGameFormat];
                        const pool = baseTeamPool();
                        const groups = teamPreviewGroups(teamSize);
                        if (groups.length === 0) {
                          return "No teams to build from yet. Set up your players and groups first.";
                        }
                        const canSplit = teamSize === 2 && pool.teams.some((t) => t.members.length > 2);
                        return (
                          <div style={{ display: "grid", gap: 6 }}>
                            <div>
                              {pool.source === "column"
                                ? "Teams come from the \"team\" value on your players (the tee sheet's team column)."
                                : "Teams come from your playing groups."}
                            </div>
                            {canSplit && (
                              <label style={styles.label}>
                                Your groups have more than 2 players. For 2-man teams:
                                <select style={styles.input} value={newGameSplit} onChange={(e) => setNewGameSplit(e.target.value)}>
                                  <option value="balanced">Split each group into pairs: lowest + highest handicap together</option>
                                  <option value="order">Split each group into pairs: in the order listed</option>
                                  <option value="keep">Keep each whole group as one team</option>
                                </select>
                              </label>
                            )}
                            {groups.map((g) => (
                              <div key={g.label} style={{ color: g.mismatched ? THEME.bad : THEME.textMuted }}>
                                Team "{g.label}": {g.members.map((m) => m.name).join(", ")}
                                {g.mismatched ? ` (expected ${teamSize})` : ""}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <button style={styles.bigBtn} onClick={createGame}>
                    Create Game
                    </button>
                    {gamesMsg ? <div style={styles.helpText}>{gamesMsg}</div> : null}
                    </div>
                  </>
                )}
            </div>
          </AdminSection>

          {/* Multi-Round setup */}
          <AdminSection
            title="Rounds"
            subtitle={
              appSettings.multi_round_enabled
                ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
                : "Single round"
            }
            open={openAdminSection === "rounds"}
            onToggle={() => setOpenAdminSection((k) => (k === "rounds" ? null : "rounds"))}
          >
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
              <input
                type="checkbox"
                checked={!!appSettings.multi_round_enabled}
                onChange={(e) => setMultiRoundEnabled(e.target.checked)}
              />
              Enable multiple rounds for this event
            </label>

            {!appSettings.multi_round_enabled ? (
              <div style={styles.helpText}>
                Off by default. This event runs one round, same as always. Turn this on for a 2-day/3-day event —
                each round gets its own tee sheet import, and the Leaderboard gets an Overall total plus a tab per
                round.
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {rounds.map((r) => (
                    <div key={r.id} style={styles.foursomeCard}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>
                          {r.label}{" "}
                          {r.is_active && <span style={{ ...styles.strokePill, marginLeft: 6 }}>Active</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!r.is_active && (
                            <button style={styles.smallBtn} onClick={() => setRoundActive(r)}>
                              Set Active
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={styles.hr} />

                <div style={styles.sectionLabel}>Add Round</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 160 }}
                    value={newRoundLabel}
                    onChange={(e) => setNewRoundLabel(e.target.value)}
                    placeholder={`Round ${rounds.length + 1}`}
                  />
                  <button style={styles.bigBtn} onClick={createRound}>
                    Add Round
                  </button>
                </div>
                {roundsMsg ? <div style={styles.helpText}>{roundsMsg}</div> : null}

                <div style={styles.helpText}>
                  "Active" is the round Enter Scores codes and new tee-sheet imports default to, and the round The
                  Broadcast and player scorecards track. The Leaderboard's Overall tab and per-round tabs show every
                  round regardless of which one is active.
                </div>
              </div>
            )}
          </AdminSection>

          {/* Danger Zone — every irreversible action lives here, away from routine buttons */}
          <AdminSection
            title="⚠️ Danger Zone"
            danger
            open={openAdminSection === "danger"}
            onToggle={() => {
              // Opening the Danger Zone always asks for the passcode again.
              setDangerUnlocked(false);
              setDangerPin("");
              setDangerPinMsg("");
              setOpenAdminSection((k) => (k === "danger" ? null : "danger"));
            }}
          >
            {!dangerUnlocked ? (
              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                <div style={styles.helpText}>Enter the Admin passcode to open the Danger Zone.</div>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  style={{ ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box" }}
                  value={dangerPin}
                  onChange={(e) => {
                    setDangerPin(e.target.value);
                    setDangerPinMsg("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") unlockDanger();
                  }}
                  placeholder="Passcode"
                />
                <button style={{ ...styles.bigBtn, minHeight: 48 }} onClick={unlockDanger}>
                  Unlock Danger Zone
                </button>
                {dangerPinMsg ? (
                  <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{dangerPinMsg}</div>
                ) : null}
              </div>
            ) : (
              <>
            <div style={styles.helpText}>Every action below is irreversible. Each one asks you to confirm first.</div>

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <div>
                <div style={styles.sectionLabel}>Clear Foursomes</div>
                <div style={styles.helpText}>
                  Removes every foursome and player assignment for this event. Does not delete players or scores.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10 }} onClick={clearFoursomes}>
                  Clear Foursomes
                </button>
              </div>

              <div>
                <div style={styles.hr} />
                <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Clear all messages</div>
                <div style={styles.helpText}>
                  Deletes every message on The Broadcast (and the TV Mode strip). Scores and players are not touched.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44 }} onClick={clearBroadcastMessages}>
                  Clear all messages
                </button>
                {clearMsg ? <div style={styles.helpText}>{clearMsg}</div> : null}
                {clearNeedsSetup ? <ClearMessagesSetupNotice /> : null}
              </div>

              <DeletePlayersPanel
                players={players}
                groupNameByPlayer={
                  new Map(
                    foursomePlayers
                      .filter((fp) => foursomes.some((f) => f.id === fp.foursome_id && (!f.round_id || f.round_id === activeRound?.id)))
                      .map((fp) => [fp.player_id, foursomes.find((f) => f.id === fp.foursome_id)?.group_name])
                  )
                }
                onDelete={deletePlayers}
              />

              {games.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Game</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {games.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{g.name}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteGame(g)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {appSettings.multi_round_enabled && rounds.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Round</div>
                  <div style={styles.helpText}>Also removes that round's foursomes and every score entered for it.</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {rounds.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{r.label}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteRound(r)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
              </>
            )}
          </AdminSection>
        </div>
        )}
      </>
    )}
  </div>
)}

        {/* Router fallback */}
        {tab === "enter" && !activeFoursome && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Enter Scores</div>
            <div style={styles.helpText}>No foursome loaded. Go back and enter your code.</div>
            <button style={styles.smallBtn} onClick={() => setTab("code")}>
              Back to Code
            </button>
          </div>
        )}
      </div>
   {acePopup && <AcePopup msg={acePopup} players={players} onClose={dismissAce} />}
   {printAllOn && (
  <PrintTwoUpScorecards
    foursomes={foursomes}
    players={players}
    foursomePlayers={foursomePlayers}
    eventName={eventName}
    logoSrc={logoSrc}
    game={printGame}
    fieldOffset={fieldOffset}
  />
)}
</div>
  );
}

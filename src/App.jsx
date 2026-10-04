import { useEffect, useMemo, useRef, useState } from "react";
import { rankCellContent } from "./components/LeaderIcons";
import { DangerZoneSection } from "./features/admin/DangerZoneSection";
import { EventNameSection } from "./features/admin/EventNameSection";
import { GamesSection } from "./features/admin/GamesSection";
import { HandicapBasisSection } from "./features/admin/HandicapBasisSection";
import { ImportSection } from "./features/admin/ImportSection";
import { LogoSection } from "./features/admin/LogoSection";
import { PlayersGroupsSection } from "./features/admin/PlayersGroupsSection";
import { RoundsSection } from "./features/admin/RoundsSection";
import { StartTournamentSection } from "./features/admin/StartTournamentSection";
import { TaglineSection } from "./features/admin/TaglineSection";
import { AcePopup } from "./features/broadcast/AcePopup";
import { ACE_POPUP_MS, readSeenAces, rememberSeenAce } from "./features/broadcast/aceSeen";
import { BroadcastFeed } from "./features/broadcast/BroadcastFeed";
import { runTeeSheetImport } from "./features/import/runTeeSheetImport";
import { LockedBoardPanel } from "./features/leaderboard/LockedBoardPanel";
import { expandChevronStyle, expandRowCellStyle } from "./features/leaderboard/rankStyles";
import { ScorecardDetail } from "./features/leaderboard/ScorecardDetail";
import { MatchBoard } from "./features/match/MatchBoard";
import { PhoneSetup } from "./features/phone/PhoneSetup";
import { PrintTwoUpScorecards } from "./features/print/PrintCards";
import { pendingKey, readPendingScores, writePendingScores } from "./features/scoring/pendingScores";
import { TvMode } from "./features/tv/TvMode";
import { EventDataContext } from "./hooks/eventDataContext";
import { useEventData } from "./hooks/useEventData";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { DEFAULT_TAGLINE } from "./lib/branding";
import { SWING_WINDOW_MS, computeBroadcastEvents, planPosts, safeDedupeKey } from "./lib/broadcastEngine";
import { ADMIN_PIN, ROUND_OVERALL } from "./lib/config";
import { PARS, STROKE_INDEX, netScoreForHole } from "./lib/course";
import { buildScoresByPlayer, computeGameRows, mergeGameRowsAcrossRounds } from "./lib/gameCalc";
import { GAME_SCORE_LABELS, isMatchFormat } from "./lib/gameConfig";
import { clampInt, formatToPar } from "./lib/golf";
import { buildLeaderboardRows } from "./lib/leaderboard";
import { computeMatchResult } from "./lib/matchPlay";
import { lastPlaceRank } from "./lib/ranking";
import { formStreak } from "./lib/streaks";
import { supabase } from "./lib/supabase";
import { errToText } from "./lib/util";
import { THEME, netColorStyle, styles } from "./theme";

/* ---------- Phone setup ("Build on my phone") helpers: pure, no React ---------- */

export default function App() {
  const isWide = useMediaQuery("(min-width: 820px)"); // 2-column Admin on tablets/desktops
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin | broadcast
  const data = useEventData({ tab }); // shared with every screen through EventDataContext
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
    loadGameTeams,
    loadGameTeamMembers,
    loadAppSettings,
    loadBroadcast,
    initialLoad,
    fieldOffset,
    leaderboardRows,
    playersById,
    teamMembersByTeamMap,
    activeRound,
    scoresByRoundThenPlayer,
  } = data;

  // Broadcast
  const [acePopup, setAcePopup] = useState(null);

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

  // Foursomes sanity-check list is collapsed by default — after an import,
  // most visits to Admin don't need every player re-scanned every time.

  // Admin: which of the setup sections (Event Name, Import, Games, etc.) is
  // expanded — only one at a time, so the page shows one decision at a time
  // instead of everything at once. Set on PIN unlock in enterAdmin().
  const [openAdminSection, setOpenAdminSection] = useState(null);
  // "Build on my phone" setup flow replaces the Admin accordion while open.
  const [phoneSetupOn, setPhoneSetupOn] = useState(false);

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

  // Tagline: not set yet (null) means the default; saved blank means none.
  const tagline = appSettings.tagline == null ? DEFAULT_TAGLINE : appSettings.tagline.trim();

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

  // ---------------------------
  // MULTI-GAME (Stage 3: Admin)
  // ---------------------------

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

  return (
  <EventDataContext.Provider value={data}>
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
            onStart={(rows, opts) => runTeeSheetImport({ foursomes, initialLoad }, rows, opts)}
            onExit={() => setPhoneSetupOn(false)}
            onGoto={(t) => {
              setPhoneSetupOn(false);
              setTab(t);
            }}
          />
        ) : (
        <div style={{ ...styles.adminGrid, gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
          {/* Start a Tournament — two ways in, same result */}
          <StartTournamentSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} setPhoneSetupOn={setPhoneSetupOn} />

          {/* Event Name */}
          <EventNameSection adminOn={adminOn} eventName={eventName} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Tagline */}
          <TaglineSection adminOn={adminOn} tagline={tagline} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Main logo */}
          <LogoSection adminOn={adminOn} customLogo={customLogo} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} logoSrc={logoSrc} />

          {/* Handicap Basis */}
          <HandicapBasisSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Import Tee Sheet */}
          <ImportSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Players & Groups — edit after the tournament is set up */}
          <PlayersGroupsSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Multi-Game setup */}
          <GamesSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Multi-Round setup */}
          <RoundsSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} setMultiRoundEnabled={setMultiRoundEnabled} setRoundActive={setRoundActive} newRoundLabel={newRoundLabel} setNewRoundLabel={setNewRoundLabel} createRound={createRound} roundsMsg={roundsMsg} />

          {/* Danger Zone — every irreversible action lives here, away from routine buttons */}
          <DangerZoneSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} deleteGame={deleteGame} deleteRound={deleteRound} />

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
  </EventDataContext.Provider>
  );
}

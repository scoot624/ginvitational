import { useEffect, useMemo, useRef, useState } from "react";
import { AdminScreen } from "./features/admin/AdminScreen";
import { AcePopup } from "./features/broadcast/AcePopup";
import { ACE_POPUP_MS, readSeenAces, rememberSeenAce } from "./features/broadcast/aceSeen";
import { BroadcastScreen } from "./features/broadcast/BroadcastScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { LeaderboardScreen } from "./features/leaderboard/LeaderboardScreen";
import { PrintTwoUpScorecards } from "./features/print/PrintCards";
import { CodeScreen } from "./features/scoring/CodeScreen";
import { EnterScoresScreen } from "./features/scoring/EnterScoresScreen";
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
import { isMatchFormat, isSharedBallFormat } from "./lib/gameConfig";
import { clampInt } from "./lib/golf";
import { creditMap, drinksForRound } from "./lib/drinks";
import { computeDrinkEvents } from "./lib/drinkEvents";
import { buildLeaderboardRows } from "./lib/leaderboard";
import { computeMatchResult } from "./lib/matchPlay";
import { formStreak } from "./lib/streaks";
import { supabase } from "./lib/supabase";
import { errToText } from "./lib/util";
import { THEME, styles } from "./theme";

/* ---------- Phone setup ("Build on my phone") helpers: pure, no React ---------- */

export default function App() {
  const isWide = useMediaQuery("(min-width: 820px)"); // 2-column Admin on tablets/desktops
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin | broadcast
  const data = useEventData({ tab }); // shared with every screen through EventDataContext
  const {
    drinkLog,
    drinksView,
    drinking,
    creditByRound,
    status,
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
    loadScores,
    loadRounds,
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
              credit: creditByRound.get(m.round_id),
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
  }, [games, matches, matchPlayers, playersById, scoresByRoundThenPlayer, creditByRound, foursomes, foursomePlayers, fieldOffset]);

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
          computeGameRows(game, { ...ctxBase, scoresByPlayer: scoresByRoundThenPlayer.get(r.id) || new Map(), credit: creditByRound.get(r.id) })
        );
        return { game, rows: mergeGameRowsAcrossRounds(perRoundRows) };
      });
    }

    const scoresByPlayer = roundSelection
      ? scoresByRoundThenPlayer.get(roundSelection) || new Map()
      : buildScoresByPlayer(scores); // rounds not loaded yet — fall back to unscoped

    return activeGames.map((game) => ({
      game,
      rows: computeGameRows(game, { ...ctxBase, scoresByPlayer, credit: roundSelection ? creditByRound.get(roundSelection) : undefined }),
    }));
  }, [
    games,
    gameTeams,
    teamMembersByTeamMap,
    players,
    playersById,
    rounds,
    scoresByRoundThenPlayer,
    creditByRound,
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
    liveRef.current = { leaderboardRows, scores, players, rounds, foursomes, foursomePlayers, broadcastMsgs, eventName, fieldOffset, drinksView, drinking };
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
        const rawVsPar = {};
        for (const [h, g] of Object.entries(r.scoresByHole)) {
          rawVsPar[h] = netScoreForHole(g, r.playingHandicap, Number(h)) - PARS[Number(h) - 1];
          vsPar[h] = rawVsPar[h] - (r.creditByHole?.[h] || 0);
        }
        return {
          id: r.id,
          name: r.name,
          holesPlayed: r.holesPlayed,
          netToPar: r.netToPar,
          displayRank: r.displayRank,
          gross: r.scoresByHole,
          vsPar,
          rawVsPar, // net-to-par WITHOUT Stroke Credit: the drink report is judged on this
          startHole: startByPlayer.get(r.id) ?? 1,
          group: groupByPlayer.get(r.id) || null,
        };
      });

      // "Standings a few minutes ago": the same leaderboard math, ignoring scores saved since.
      // Drinking Mode's Stroke Credit counts as it stood then too, so a drink logged just now doesn't read as a place gained.
      const prevCredit = creditMap(
        drinksForRound(s.drinksView, roundId).filter((d) => new Date(d.created_at).getTime() <= now - SWING_WINDOW_MS),
        s.drinking
      );
      const prevRows = buildLeaderboardRows(s.players, s.scores, roundId, s.fieldOffset, now - SWING_WINDOW_MS, prevCredit);
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
      // Drinking Mode cards (nothing at all while the mode is off)
      events.push(
        ...computeDrinkEvents({
          now,
          roundId,
          drinking: s.drinking,
          drinks: s.drinksView,
          pars: PARS,
          rows,
          scoreTimes,
          fieldIds,
          messages: s.broadcastMsgs,
        })
      );
      if (events.length === 0) return;
      await insertBroadcastRows(planPosts(events, { now, messages: s.broadcastMsgs }));
      await loadBroadcast();
    } finally {
      tickBusyRef.current = false;
    }
  }

  // Check for new cards whenever fresh scores/players/drinks arrive (and once the saved log, the rounds and the
  // Drinking Mode setting have loaded, so the first check already knows which round is active).
  useEffect(() => {
    if (!broadcastLoaded) return;
    runBroadcastTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, players, broadcastLoaded, drinksView, rounds, drinking.enabled]);

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
      const isScramble = isSharedBallFormat(g.format); // Scramble or Alternate Shot: one ball, one score per team
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
  // Throw away scores still waiting to upload on this phone (for one round, or all), e.g. after they are deleted in Admin.
  function discardUnsentScores(roundId = null) {
    const keep = roundId ? readPendingScores().filter((q) => q.round_id !== roundId) : [];
    writePendingScores(keep);
    setPendingScores(keep);
    setPendingErr("");
  }

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
        {tab === "home" && <HomeScreen logoSrc={logoSrc} eventName={eventName} customLogo={customLogo} tagline={tagline} setTab={setTab} />}

        {/* CODE GATE SCREEN (enter scores) */}
        {tab === "code" && <CodeScreen setTab={setTab} visibleStatus={visibleStatus} entryCode={entryCode} setEntryCode={setEntryCode} enterWithCode={enterWithCode} />}

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

        {pendingScores.length + drinkLog.pendingCount > 0 && (
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
                {[
                  pendingScores.length ? `${pendingScores.length} score${pendingScores.length === 1 ? "" : "s"}` : null,
                  drinkLog.pendingCount ? `${drinkLog.pendingCount} drink change${drinkLog.pendingCount === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                saved on this phone
              </b>{" "}
              — waiting to upload. Keep this page open; it keeps trying.
              {pendingErr || drinkLog.error ? (
                <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 4 }}>{pendingErr || drinkLog.error}</div>
              ) : null}
            </div>
            <button
              style={{ ...styles.smallBtn, minHeight: 44 }}
              onClick={() => {
                uploadPendingScores();
                drinkLog.uploadPendingDrinks();
              }}
            >
              Retry now
            </button>
          </div>
        )}

        {/* BROADCAST */}
        {tab === "broadcast" && <BroadcastScreen setTab={setTab} visibleBroadcast={visibleBroadcast} />}

        {/* LEADERBOARD */}
        {tab === "leaderboard" && <LeaderboardScreen selectedRoundId={selectedRoundId} setSelectedRoundId={setSelectedRoundId} gameResults={gameResults} selectedGameId={selectedGameId} setSelectedGameId={setSelectedGameId} unlockGameBoard={unlockGameBoard} matchEntriesByGame={matchEntriesByGame} scorecardPlayerId={scorecardPlayerId} setScorecardPlayerId={setScorecardPlayerId} scorecardPlayer={scorecardPlayer} />}

        {/* ENTER SCORES */}
        {tab === "enter" && <EnterScoresScreen activeFoursome={activeFoursome} setActiveFoursome={setActiveFoursome} setActivePlayers={setActivePlayers} setEntryCode={setEntryCode} setTab={setTab} hole={hole} roundComplete={roundComplete} setRoundComplete={setRoundComplete} saveHoleThenNavigate={saveHoleThenNavigate} holeEntryGroups={holeEntryGroups} activePlayers={activePlayers} holeInputs={holeInputs} setHoleInputs={setHoleInputs} />}

    {/* ADMIN */}
    {tab === "admin" && <AdminScreen adminOn={adminOn} adminPin={adminPin} setAdminPin={setAdminPin} enterAdmin={enterAdmin} setAdminOn={setAdminOn} setTab={setTab} printGame={printGame} setPrintGameId={setPrintGameId} logoSrc={logoSrc} setPrintAllOn={setPrintAllOn} phoneSetupOn={phoneSetupOn} eventName={eventName} setPhoneSetupOn={setPhoneSetupOn} isWide={isWide} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} tagline={tagline} customLogo={customLogo} setMultiRoundEnabled={setMultiRoundEnabled} setRoundActive={setRoundActive} newRoundLabel={newRoundLabel} setNewRoundLabel={setNewRoundLabel} createRound={createRound} roundsMsg={roundsMsg} deleteGame={deleteGame} deleteRound={deleteRound} discardUnsentScores={discardUnsentScores} />}

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
    gameTeams={gameTeams}
    gameTeamMembers={gameTeamMembers}
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

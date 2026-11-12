import { useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { AltShotSetupNotice, MatchSetupNotice } from "../../components/SetupNotices";
import { MatchEditor } from "../match/MatchEditor";
import { RosterPicker } from "../match/RosterPicker";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { FORMATS_BY_TEAM_SIZE, GAME_FORMAT_LABELS, GAME_FORMAT_TEAM_SIZE, GAME_PRESETS, SCRAMBLE_DEFAULT_PCTS, TEAM_SIZE_OPTIONS, isMatchFormat, isSharedBallFormat, segmentOption, segmentOptionsFor } from "../../lib/gameConfig";
import { clampInt } from "../../lib/golf";
import { HANDICAP_MODES } from "../../lib/matchPlay";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

// Admin → Games: the games running on the event, and the builder for new ones (including match play and its matches).

export function GamesSection({ adminOn, openAdminSection, setOpenAdminSection }) {
  const {
    players,
    games,
    gameTeams,
    gameTeamMembers,
    appSettings,
    rounds,
    foursomes,
    foursomePlayers,
    matches,
    matchPlayers,
    loadGames,
    loadMatches,
    loadGameTeams,
    loadGameTeamMembers,
    loadAppSettings,
    matchReady,
    activeRound,
  } = useEventDataContext();

  // Admin: Multi-Game setup (Stage 3)
  const [newGameFormat, setNewGameFormat] = useState("individual_net");

  const [newGamePresetKey, setNewGamePresetKey] = useState(null);

  const [newGameName, setNewGameName] = useState("");

  const [newGameHandicapPct, setNewGameHandicapPct] = useState(100);

  const [newGameAdvancedOn, setNewGameAdvancedOn] = useState(false);

  const [newGameScoresCounted, setNewGameScoresCounted] = useState(1);

  const [newGameSlots, setNewGameSlots] = useState(["net"]);

  const [gamesMsg, setGamesMsg] = useState("");

  // Admin: Team size picker (1, 2 or 4): decides which formats the Format list offers, and a Multi-Format Round's team size
  const [newGameTeamSize, setNewGameTeamSize] = useState(1);

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
      setNewGameSegments([
        { fromHole: 1, toHole: 6, formatKey: "scramble", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 7, toHole: 12, formatKey: "best_ball", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 13, toHole: 18, formatKey: "combined", handicapPct: 100, lowPct: 35, highPct: 15 },
      ]);
      return;
    }

    if (isSharedBallFormat(format)) {
      setNewGameScramblePcts(SCRAMBLE_DEFAULT_PCTS[format]);
      return;
    }

    const presets = GAME_PRESETS[format] || [];
    if (presets[0]) applyPreset(presets[0]);
  }

  // Picking a team size narrows the Format list. The format stays if it still fits (a Multi-Format Round going from
  // 2-Man to 4-Man, or Match Play from 1 to 2); otherwise it moves to the first format for that size.
  function selectNewGameTeamSize(size) {
    setNewGameTeamSize(size);
    const allowed = FORMATS_BY_TEAM_SIZE[size] || [];
    if (allowed.includes(newGameFormat)) {
      if (newGameFormat === "composite") {
        // a segment type that only exists for another team size (Alternate Shot is pairs only) becomes a Scramble
        setNewGameSegments((prev) =>
          prev.map((s) => (segmentOptionsFor(size).some(([k]) => k === s.formatKey) ? s : { ...s, formatKey: "scramble" }))
        );
      }
      return;
    }
    if (allowed[0]) selectNewGameFormat(allowed[0]);
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
    const isScramble = isSharedBallFormat(newGameFormat); // Scramble or Alternate Shot: same scoring and handicap
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
        const opt = segmentOption(s.formatKey, clampInt(newGameTeamSize, 2));
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

  return (
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
                          ) : isSharedBallFormat(g.format) ? (
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
                            isSharedBallFormat(g.format) ||
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
                    Team size
                    <select
                      style={styles.input}
                      value={newGameTeamSize}
                      onChange={(e) => selectNewGameTeamSize(clampInt(e.target.value, 1))}
                    >
                      {TEAM_SIZE_OPTIONS.map((o) => (
                        <option key={o.size} value={o.size}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={styles.label}>
                    Format
                    <select
                      style={styles.input}
                      value={newGameFormat}
                      onChange={(e) => selectNewGameFormat(e.target.value)}
                    >
                      {(FORMATS_BY_TEAM_SIZE[newGameTeamSize] || []).map((key) => (
                        <option key={key} value={key}>
                          {GAME_FORMAT_LABELS[key]}
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

                  {isSharedBallFormat(newGameFormat) ? (
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
                        {newGameFormat === "alt_shot_2"
                          ? " Alternate Shot is scored exactly like the 2-Man Scramble: partners take turns hitting one ball and post one score per hole."
                          : ""}
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

                  {newGameFormat !== "composite" && !isSharedBallFormat(newGameFormat) && !isMatchFormat(newGameFormat) && (
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
                    !isSharedBallFormat(newGameFormat) &&
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
                      <div style={styles.label}>Segments (holes 1–18) — {newGameTeamSize === 4 ? "4-Man teams" : "2-Man teams"}</div>

                      {newGameSegments.map((seg, i) => {
                        const opt = segmentOption(seg.formatKey, clampInt(newGameTeamSize, 2));
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
                                {segmentOptionsFor(clampInt(newGameTeamSize, 2)).map(([key, o]) => (
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
                    isSharedBallFormat(newGameFormat) ||
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
                                <select style={{ ...styles.input, width: "100%", maxWidth: "100%", boxSizing: "border-box" }} value={newGameSplit} onChange={(e) => setNewGameSplit(e.target.value)}>
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
                    {newGameFormat === "alt_shot_2" && gamesMsg.includes("games_format_check") ? <AltShotSetupNotice /> : null}
                    </div>
                  </>
                )}
            </div>
          </AdminSection>
  );
}

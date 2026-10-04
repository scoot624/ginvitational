// Admin → Games → Manage matches: add, edit, delete and auto-fill matches.

import { useMemo, useState } from "react";
import { SIDE_COLOR } from "./sideColor";
import { clampInt, hcpLabel } from "../../lib/golf";
import { MATCH_TYPES, sideLabel } from "../../lib/matchPlay";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

const emptyMatchForm = { type: "singles", label: "", a: [""], b: [""] };

/**
 * Admin → Games → (a match game) → Manage matches. Matches belong to a
 * session (round). Each side picks 1 player (singles) or 2 (four-ball,
 * foursomes); a Ryder Cup picks from that side's roster.
 */
export function MatchEditor({ game, players, rounds, multiRound, activeRoundId, matches, matchPlayers, gameTeams, gameTeamMembers, foursomes, foursomePlayers, onChanged }) {
  const [roundId, setRoundId] = useState("");
  const [editingId, setEditingId] = useState(null); // null | "new" | match id
  const [form, setForm] = useState(emptyMatchForm);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };

  const isRyder = game.format === "ryder_cup";
  const cfg = game.config || {};
  const session = multiRound ? roundId || activeRoundId || "" : activeRoundId || "";
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const teams = gameTeams.filter((t) => t.game_id === game.id);
  const teamA = teams.find((t) => t.id === cfg.sideA?.teamId) || teams[0];
  const teamB = teams.find((t) => t.id === cfg.sideB?.teamId) || teams[1];
  const rosterOf = (team) =>
    team
      ? gameTeamMembers
          .filter((m) => m.team_id === team.id)
          .map((m) => playerById.get(m.player_id))
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  const eligible = { a: isRyder ? rosterOf(teamA) : players, b: isRyder ? rosterOf(teamB) : players };
  const sideName = { a: cfg.sideA?.name || "Side A", b: cfg.sideB?.name || "Side B" };

  const gameMatches = matches
    .filter((m) => m.game_id === game.id && m.round_id === session)
    .sort((x, y) => x.sort_order - y.sort_order || String(x.created_at).localeCompare(String(y.created_at)));
  const playersIn = (matchId, side) =>
    matchPlayers
      .filter((mp) => mp.match_id === matchId && mp.side === side)
      .sort((x, y) => x.position - y.position)
      .map((mp) => playerById.get(mp.player_id))
      .filter(Boolean);
  const busyPlayers = new Map(); // player id -> the match label they are already in this session
  for (const m of gameMatches) {
    if (m.id === editingId) continue;
    for (const mp of matchPlayers.filter((x) => x.match_id === m.id)) busyPlayers.set(mp.player_id, m.label || "another match");
  }

  const perSide = MATCH_TYPES[form.type].perSide;
  const resize = (arr, n) => Array.from({ length: n }, (_, i) => arr[i] || "");
  const setType = (type) => {
    const n = MATCH_TYPES[type].perSide;
    setForm({ ...form, type, a: resize(form.a, n), b: resize(form.b, n) });
  };
  const setPick = (side, i, id) => setForm({ ...form, [side]: form[side].map((v, j) => (j === i ? id : v)) });

  function openNew() {
    setForm({ ...emptyMatchForm, label: `Match ${gameMatches.length + 1}` });
    setEditingId("new");
    setMsg("");
  }
  function openEdit(m) {
    setForm({
      type: m.match_type,
      label: m.label || "",
      a: playersIn(m.id, "a").map((p) => p.id),
      b: playersIn(m.id, "b").map((p) => p.id),
    });
    setEditingId(m.id);
    setMsg("");
  }

  async function save() {
    const ids = [...form.a, ...form.b];
    if (ids.some((x) => !x)) return setMsg(`Pick ${perSide === 1 ? "a player" : "both players"} for each side.`);
    if (new Set(ids).size !== ids.length) return setMsg("A player can only be in a match once.");
    const clash = ids.find((id) => busyPlayers.has(id));
    if (clash) return setMsg(`${playerById.get(clash)?.name} is already in ${busyPlayers.get(clash)} this session.`);
    if (!session) return setMsg("No session (round) to put the match in yet.");
    setBusy(true);
    setMsg("Saving…");
    try {
      let matchId = editingId;
      const label = form.label.trim() || `Match ${gameMatches.length + 1}`;
      if (editingId === "new") {
        const { data, error } = await supabase
          .from("matches")
          .insert({
            game_id: game.id,
            round_id: session,
            match_type: form.type,
            label,
            sort_order: gameMatches.length ? Math.max(...gameMatches.map((m) => m.sort_order)) + 1 : 0,
          })
          .select("id")
          .single();
        if (error) return setMsg(errToText(error));
        matchId = data.id;
      } else {
        const { error } = await supabase.from("matches").update({ match_type: form.type, label }).eq("id", matchId);
        if (error) return setMsg(errToText(error));
        const del = await supabase.from("match_players").delete().eq("match_id", matchId);
        if (del.error) return setMsg(errToText(del.error));
      }
      const rows = [
        ...form.a.map((player_id, position) => ({ match_id: matchId, player_id, side: "a", position })),
        ...form.b.map((player_id, position) => ({ match_id: matchId, player_id, side: "b", position })),
      ];
      const ins = await supabase.from("match_players").insert(rows);
      if (ins.error) return setMsg(errToText(ins.error));
      await onChanged();
      setEditingId(null);
      setMsg("Saved ✅");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m) {
    if (!confirm(`Delete ${m.label || "this match"}?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("matches").delete().eq("id", m.id);
      if (error) return setMsg(errToText(error));
      await onChanged();
      setMsg("Deleted ✅");
    } finally {
      setBusy(false);
    }
  }

  // Saves a batch of matches: defs = [{ label, a: [players], b: [players] }].
  async function createMatches(type, defs) {
    if (defs.length === 0) return setMsg("There's nothing to fill in yet.");
    if (!confirm(`Create ${defs.length} ${MATCH_TYPES[type].label} match${defs.length === 1 ? "" : "es"} for this session?`)) return;
    setBusy(true);
    setMsg("Creating matches…");
    try {
      let order = gameMatches.length ? Math.max(...gameMatches.map((m) => m.sort_order)) + 1 : 0;
      for (const def of defs) {
        const { data, error } = await supabase
          .from("matches")
          .insert({ game_id: game.id, round_id: session, match_type: type, label: def.label, sort_order: order++ })
          .select("id")
          .single();
        if (error) return setMsg(errToText(error));
        const rows = [
          ...def.a.map((p, position) => ({ match_id: data.id, player_id: p.id, side: "a", position })),
          ...def.b.map((p, position) => ({ match_id: data.id, player_id: p.id, side: "b", position })),
        ];
        const ins = await supabase.from("match_players").insert(rows);
        if (ins.error) return setMsg(errToText(ins.error));
      }
      await onChanged();
      setMsg(`Created ${defs.length} match${defs.length === 1 ? "" : "es"} ✅`);
    } finally {
      setBusy(false);
    }
  }

  const byHcp = (list) => [...list].sort((x, y) => clampInt(x.handicap, 0) - clampInt(y.handicap, 0));

  // Ryder Cup shortcut (parked for now): pair the two rosters up for a whole session at once.
  function autoFill() {
    const type = form.type;
    const makeUnits = (list) => {
      const sorted = byHcp(list);
      if (MATCH_TYPES[type].perSide === 1) return sorted.map((p) => [p]);
      const units = [];
      let lo = 0;
      let hi = sorted.length - 1;
      while (lo < hi) units.push([sorted[lo++], sorted[hi--]]);
      return units;
    };
    const unitsA = makeUnits(eligible.a);
    const unitsB = makeUnits(eligible.b);
    const count = Math.min(unitsA.length, unitsB.length);
    if (count === 0) return setMsg("Each side needs players on its roster first.");
    const start = gameMatches.length;
    return createMatches(
      type,
      Array.from({ length: count }, (_, i) => ({ label: `Match ${start + i + 1}`, a: unitsA[i], b: unitsB[i] }))
    );
  }

  // Match Play shortcut: one match per playing group. 2v2 puts the lowest and highest
  // handicap together against the middle two; singles pairs neighbours by handicap.
  function autoFillFromGroups() {
    const type = form.type;
    const inSession = foursomes
      .filter((f) => !f.round_id || f.round_id === session)
      .sort(
        (x, y) =>
          String(x.tee_time || "99").localeCompare(String(y.tee_time || "99")) ||
          String(x.group_name).localeCompare(String(y.group_name), undefined, { numeric: true })
      );
    const defs = [];
    for (const f of inSession) {
      const members = byHcp(
        foursomePlayers
          .filter((fp) => fp.foursome_id === f.id)
          .map((fp) => playerById.get(fp.player_id))
          .filter((p) => p && !busyPlayers.has(p.id))
      );
      if (MATCH_TYPES[type].perSide === 1) {
        for (let i = 0; i + 1 < members.length; i += 2) {
          defs.push({ label: `${f.group_name}${members.length > 2 ? ` ${i / 2 + 1}` : ""}`, a: [members[i]], b: [members[i + 1]] });
        }
      } else if (members.length >= 4) {
        defs.push({ label: f.group_name, a: [members[0], members[3]], b: [members[1], members[2]] });
      }
    }
    if (defs.length === 0) {
      return setMsg(
        MATCH_TYPES[type].perSide === 1
          ? "No groups with at least 2 free players in this session."
          : "No groups with 4 free players in this session (2v2 needs four to a group)."
      );
    }
    return createMatches(type, defs);
  }

  const optionsFor = (side) =>
    eligible[side].map((p) => ({ id: p.id, label: `${p.name} (HCP ${hcpLabel(p.handicap)})`, taken: busyPlayers.has(p.id) }));

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 10, minWidth: 0 }}>
      {multiRound ? (
        <label style={styles.label}>
          Session (round)
          <select style={field} value={session} onChange={(e) => setRoundId(e.target.value)}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.is_active ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {msg ? <div style={{ fontSize: 13, fontWeight: 700, color: /✅/.test(msg) ? THEME.text : THEME.danger }}>{msg}</div> : null}

      {gameMatches.length === 0 && editingId !== "new" ? <div style={styles.helpText}>No matches in this session yet.</div> : null}
      {gameMatches.map((m) => (
        <div key={m.id} style={{ ...styles.playerRow, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 180px" }}>
            <div style={{ fontWeight: 900 }}>
              {m.label || "Match"} · {MATCH_TYPES[m.match_type]?.label}
            </div>
            <div style={{ fontSize: 13, color: THEME.textMuted, overflowWrap: "anywhere" }}>
              <span style={{ color: SIDE_COLOR.a, fontWeight: 700 }}>{sideLabel(playersIn(m.id, "a"))}</span> vs{" "}
              <span style={{ color: SIDE_COLOR.b, fontWeight: 700 }}>{sideLabel(playersIn(m.id, "b"))}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...styles.smallBtn, minHeight: 44 }} disabled={busy} onClick={() => openEdit(m)}>
              Edit
            </button>
            <button style={{ ...styles.dangerBtn, minHeight: 44 }} disabled={busy} onClick={() => remove(m)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      {editingId ? (
        <div style={{ ...styles.foursomeCard, display: "grid", gap: 10 }}>
          <div style={styles.sectionLabel}>{editingId === "new" ? "New match" : "Edit match"}</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            <label style={styles.label}>
              Type
              <select style={field} value={form.type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(MATCH_TYPES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label} ({t.perSide === 2 ? "2v2" : "1v1"})
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              Name
              <input style={field} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </label>
          </div>
          {["a", "b"].map((side) => (
            <div key={side} style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, color: SIDE_COLOR[side] }}>{isRyder ? sideName[side] : `Side ${side.toUpperCase()}`}</div>
              {form[side].map((val, i) => (
                <select key={i} style={field} value={val} onChange={(e) => setPick(side, i, e.target.value)}>
                  <option value="">{perSide === 1 ? "Choose a player…" : `Player ${i + 1}…`}</option>
                  {optionsFor(side).map((o) => (
                    <option key={o.id} value={o.id} disabled={o.taken || (form.a.concat(form.b).includes(o.id) && o.id !== val)}>
                      {o.label}
                      {o.taken ? " — in another match" : ""}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...styles.bigBtn, flex: 1, minHeight: 48, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>
              Save match
            </button>
            <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
          {form.type === "foursomes" && (
            <div style={styles.helpText}>
              Foursomes is alternate shot: each pair plays one ball, so Enter Scores asks for one score per pair.
            </div>
          )}
          {form.type === "fourball" && (
            <div style={styles.helpText}>
              Four-ball: everyone plays their own ball and each pair's better score on a hole counts.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={openNew}>
            + Add match
          </button>
          {gameMatches.length === 0 ? (
            <>
              <select
                aria-label="Match type for auto-fill"
                style={{ ...field, width: "auto", minHeight: 44, fontSize: 14 }}
                value={form.type}
                onChange={(e) => setType(e.target.value)}
              >
                {Object.entries(MATCH_TYPES).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label} ({t.perSide === 2 ? "2v2" : "1v1"})
                  </option>
                ))}
              </select>
              <button style={{ ...styles.smallBtn, minHeight: 44 }} disabled={busy} onClick={isRyder ? autoFill : autoFillFromGroups}>
                {isRyder ? "Auto-fill this session" : "Auto-fill from my groups"}
              </button>
            </>
          ) : null}
        </div>
      )}
      {!editingId && gameMatches.length === 0 ? (
        <div style={styles.helpText}>
          {isRyder
            ? "Auto-fill pairs the two rosters by handicap (lowest with highest for pairs) using the match type next to it."
            : "Auto-fill makes one match per playing group: 2v2 pairs the lowest and highest handicap against the middle two (a group needs four players); singles pairs neighbours by handicap. Or tap + Add match to pick every player yourself."}
        </div>
      ) : null}
    </div>
  );
}

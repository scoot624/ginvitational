// Admin → Players & Groups: edit players, add players, edit groups and who is in them.

import { useMemo, useState } from "react";
import { clampInt, hcpLabel } from "../../lib/golf";
import { supabase } from "../../lib/supabase";
import { formatTeeTime } from "../../lib/teeSheet";
import { errToText, makeCode } from "../../lib/util";
import { THEME, styles } from "../../theme";

const toTimeInput = (t) => (t ? String(t).slice(0, 5) : "");

const MAX_GROUP_SIZE = 4;

/** Name / handicap (with Plus box) / charity fields shared by "Add player" and "Edit player". */
function PlayerFields({ draft, setDraft, onSubmit, submitLabel, onCancel, busy, children }) {
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}
    >
      <label style={styles.label}>
        Name
        <input
          style={field}
          value={draft.name}
          autoComplete="off"
          autoCapitalize="words"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "end" }}>
        <label style={styles.label}>
          Handicap
          <input
            style={field}
            value={draft.hcp}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(e) => setDraft({ ...draft, hcp: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 46, fontSize: 14, color: THEME.text }}>
          <input
            type="checkbox"
            style={{ width: 22, height: 22 }}
            checked={draft.plus}
            onChange={(e) => setDraft({ ...draft, plus: e.target.checked })}
          />
          Plus
        </label>
      </div>
      <label style={styles.label}>
        Charity (optional)
        <input style={field} value={draft.charity} autoComplete="off" onChange={(e) => setDraft({ ...draft, charity: e.target.value })} />
      </label>
      {children}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" disabled={busy} style={{ ...styles.bigBtn, flex: 1, minHeight: 48, opacity: busy ? 0.6 : 1 }}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" style={{ ...styles.smallBtn, minHeight: 44 }} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

const emptyPlayerDraft = { name: "", hcp: "", plus: false, charity: "" };

const draftFromPlayer = (p) => ({
  name: p.name || "",
  hcp: String(Math.abs(clampInt(p.handicap, 0))),
  plus: clampInt(p.handicap, 0) < 0,
  charity: p.charity || "",
});

/** Validates a player draft; returns { error } or { name, handicap, charity }. */
function readPlayerDraft(draft, players, selfId) {
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter the player's name." };
  if (!/^\d{1,2}$/.test(draft.hcp.trim()) || Number(draft.hcp.trim()) > 54) {
    return { error: "Enter a handicap from 0 to 54 (use the Plus box for a plus handicap)." };
  }
  if (players.some((p) => p.id !== selfId && String(p.name || "").trim().toLowerCase() === name.toLowerCase())) {
    return { error: `${name} is already a player.` };
  }
  const n = Number(draft.hcp.trim());
  return { name, handicap: draft.plus && n !== 0 ? -n : n, charity: draft.charity.trim() || null };
}

/** One group: summary, and an editor for its name / tee time / hole / members. */
function RosterGroupCard({ f, members, otherGroups, unassigned, inOtherGroups, ops, busy, multiRound, roundLabel }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.group_name || "");
  const [time, setTime] = useState(toTimeInput(f.tee_time));
  const [hole, setHole] = useState(String(f.starting_hole || 1));
  const [addId, setAddId] = useState("");
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  const full = members.length >= MAX_GROUP_SIZE;

  const open = () => {
    setName(f.group_name || "");
    setTime(toTimeInput(f.tee_time));
    setHole(String(f.starting_hole || 1));
    setAddId("");
    setEditing(true);
  };

  return (
    <div style={styles.foursomeCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>
            {f.group_name} <span style={{ opacity: 0.78, fontWeight: 800 }}>(Code: {f.code})</span>
          </div>
          <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
            {multiRound ? <>Round: <b>{roundLabel}</b> • </> : null}
            Tee: <b>{formatTeeTime(f.tee_time) || "—"}</b> • Start Hole: <b>{f.starting_hole || "—"}</b> • Members:{" "}
            <b>{members.length}</b>
          </div>
        </div>
        <button style={{ ...styles.smallBtn, minHeight: 44, flex: "none" }} onClick={() => (editing ? setEditing(false) : open())}>
          {editing ? "Close" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 64px" }}>
            <label style={styles.label}>
              Group name
              <input style={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={styles.label}>
              Tee time
              <input type="time" style={field} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label style={styles.label}>
              Hole
              <input
                style={field}
                inputMode="numeric"
                value={hole}
                onChange={(e) => setHole(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              />
            </label>
          </div>
          <button
            style={{ ...styles.bigBtn, minHeight: 48, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => ops.saveGroup(f, { name, time, hole })}
          >
            Save group
          </button>

          <div style={styles.sectionLabel}>Members</div>
          {members.length === 0 ? <div style={styles.helpText}>No players in this group.</div> : null}
          {members.map((p) => (
            <div key={p.id} style={{ ...styles.playerRow, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 140px" }}>
                <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>{p.name}</div>
                <div style={styles.playerMeta}>HCP {hcpLabel(p.handicap)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {otherGroups.length > 0 ? (
                  <select
                    aria-label={`Move ${p.name} to another group`}
                    style={{ ...field, width: "auto", minHeight: 44, fontSize: 14, padding: "6px 8px" }}
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && ops.moveMember(p, e.target.value)}
                  >
                    <option value="">Move to…</option>
                    {otherGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.group_name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button style={{ ...styles.smallBtn, minHeight: 44 }} disabled={busy} onClick={() => ops.removeMember(f, p)}>
                  Remove
                </button>
              </div>
            </div>
          ))}

          <label style={styles.label}>
            Add a player to this group
            <div style={{ display: "flex", gap: 8 }}>
              <select style={{ ...field, flex: 1 }} value={addId} disabled={full} onChange={(e) => setAddId(e.target.value)}>
                <option value="">{full ? `Group is full (${MAX_GROUP_SIZE})` : "Choose a player…"}</option>
                {unassigned.length > 0 && (
                  <optgroup label="Not in a group">
                    {unassigned.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {inOtherGroups.length > 0 && (
                  <optgroup label="In another group (moves them)">
                    {inOtherGroups.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                style={{ ...styles.smallBtn, minHeight: 46, opacity: !addId || busy || full ? 0.5 : 1 }}
                disabled={!addId || busy || full}
                onClick={async () => {
                  await ops.addMember(addId, f);
                  setAddId("");
                }}
              >
                Add
              </button>
            </div>
          </label>

          <div style={styles.hr} />
          <button style={{ ...styles.dangerBtn, minHeight: 44 }} disabled={busy} onClick={() => ops.deleteGroup(f, members)}>
            Delete this group
          </button>
          <div style={styles.helpText}>The players stay in the event; they just won&apos;t be in a group.</div>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {members.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.name}</span>
              <span style={{ color: THEME.textMuted, flex: "none" }}>HCP {hcpLabel(p.handicap)}</span>
            </div>
          ))}
          {members.length === 0 ? <div style={styles.helpText}>No players assigned.</div> : null}
        </div>
      )}
    </div>
  );
}

/** One player row with an inline editor. */
function RosterPlayerRow({ p, groupName, players, ops, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(draftFromPlayer(p));
  const [err, setErr] = useState("");
  return (
    <div style={{ ...styles.playerRow, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>{p.name}</div>
          <div style={styles.playerMeta}>
            HCP {hcpLabel(p.handicap)}
            {p.charity ? ` • ${p.charity}` : ""} • {groupName || "No group"}
          </div>
        </div>
        <button
          style={{ ...styles.smallBtn, minHeight: 44, flex: "none" }}
          onClick={() => {
            setDraft(draftFromPlayer(p));
            setErr("");
            setEditing((v) => !v);
          }}
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {editing ? (
        <div style={{ marginTop: 10 }}>
          <PlayerFields
            draft={draft}
            setDraft={(d) => {
              setDraft(d);
              setErr("");
            }}
            busy={busy}
            submitLabel="Save player"
            onCancel={() => setEditing(false)}
            onSubmit={async () => {
              const r = readPlayerDraft(draft, players, p.id);
              if (r.error) return setErr(r.error);
              const ok = await ops.savePlayer(p, r);
              if (ok) setEditing(false);
            }}
          >
            {err ? <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{err}</div> : null}
          </PlayerFields>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Admin → Players & Groups: edit players (name, handicap, charity), add a
 * player, and edit groups after they exist (name, tee time, starting hole,
 * who is in them, add/delete a group). Works on the active round (or the
 * round you pick when several rounds are on).
 */
export function RosterEditor({ players, foursomes, foursomePlayers, rounds, activeRound, multiRound, onChanged }) {
  const [roundPick, setRoundPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [gDraft, setGDraft] = useState({ name: "", time: "", hole: "1" });
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [pDraft, setPDraft] = useState(emptyPlayerDraft);
  const [pGroup, setPGroup] = useState("");
  const [pErr, setPErr] = useState("");
  const [filter, setFilter] = useState("");
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };

  const roundId = multiRound ? roundPick || activeRound?.id || "" : activeRound?.id || "";
  const groups = useMemo(() => {
    return foursomes
      .filter((f) => !f.round_id || f.round_id === roundId)
      .sort(
        (a, b) =>
          String(a.tee_time || "99").localeCompare(String(b.tee_time || "99")) ||
          String(a.group_name).localeCompare(String(b.group_name), undefined, { numeric: true })
      );
  }, [foursomes, roundId]);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const groupOfPlayer = useMemo(() => {
    const ids = new Set(groups.map((g) => g.id));
    const m = new Map();
    for (const fp of foursomePlayers) {
      if (!ids.has(fp.foursome_id)) continue;
      m.set(fp.player_id, groups.find((g) => g.id === fp.foursome_id));
    }
    return m;
  }, [groups, foursomePlayers]);
  const membersOf = (f) =>
    foursomePlayers
      .filter((fp) => fp.foursome_id === f.id)
      .map((fp) => playerById.get(fp.player_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

  const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  // Run one change: show errors, otherwise reload the data and confirm.
  async function run(fn, okText = "Saved ✅") {
    if (busy) return false;
    setBusy(true);
    setMsg("Saving…");
    try {
      const err = await fn();
      if (err) {
        setMsg(err);
        return false;
      }
      await onChanged();
      setMsg(okText);
      return true;
    } catch (e) {
      console.error(e);
      setMsg(`Something went wrong: ${errToText(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // A player's game "team" follows their group name (same as the import does),
  // but only when it was following the old name, so a hand-set team is left alone.
  async function syncTeamLabel(playerIds, fromName, toName) {
    for (const id of playerIds) {
      const p = playerById.get(id);
      if (!p) continue;
      const label = String(p.team_label || "").trim();
      if (label && !sameName(label, fromName)) continue;
      const { error } = await supabase.from("players").update({ team_label: toName || null }).eq("id", id);
      if (error) return errToText(error);
    }
    return null;
  }

  function validateGroup(d, selfId) {
    const name = d.name.trim();
    if (!name) return { error: "Give the group a name." };
    if (groups.some((g) => g.id !== selfId && sameName(g.group_name, name))) return { error: `There is already a group called "${name}".` };
    const hole = Number(d.hole);
    if (!(hole >= 1 && hole <= 18)) return { error: "Starting hole must be 1 to 18." };
    return { name, hole: Math.trunc(hole), tee_time: d.time ? `${d.time}:00` : null };
  }

  const ops = {
    saveGroup: (f, d) =>
      run(async () => {
        const v = validateGroup(d, f.id);
        if (v.error) return v.error;
        const { error } = await supabase
          .from("foursomes")
          .update({ group_name: v.name, tee_time: v.tee_time, starting_hole: v.hole })
          .eq("id", f.id);
        if (error) return errToText(error);
        if (!sameName(f.group_name, v.name)) {
          return syncTeamLabel(membersOf(f).map((p) => p.id), f.group_name, v.name);
        }
        return null;
      }),

    removeMember: (f, p) =>
      run(async () => {
        const { error } = await supabase.from("foursome_players").delete().eq("foursome_id", f.id).eq("player_id", p.id);
        if (error) return errToText(error);
        return syncTeamLabel([p.id], f.group_name, null);
      }),

    // Moves (or adds) a player into a group, taking them out of any other group this round.
    addMember: (playerId, f) =>
      run(async () => {
        const p = playerById.get(playerId);
        if (!p) return "That player no longer exists.";
        if (membersOf(f).length >= MAX_GROUP_SIZE && groupOfPlayer.get(playerId)?.id !== f.id) {
          return `${f.group_name} is full (${MAX_GROUP_SIZE} players).`;
        }
        const from = groupOfPlayer.get(playerId);
        if (from?.id === f.id) return null;
        if (from) {
          const del = await supabase.from("foursome_players").delete().eq("foursome_id", from.id).eq("player_id", playerId);
          if (del.error) return errToText(del.error);
        }
        const ins = await supabase.from("foursome_players").insert({ foursome_id: f.id, player_id: playerId });
        if (ins.error) return errToText(ins.error);
        return syncTeamLabel([playerId], from ? from.group_name : null, f.group_name);
      }),

    moveMember: (p, toId) => {
      const to = groups.find((g) => g.id === toId);
      return to ? ops.addMember(p.id, to) : Promise.resolve(false);
    },

    deleteGroup: async (f, members) => {
      if (!confirm(`Delete "${f.group_name}"? Its ${members.length} player(s) stay in the event but won't be in a group.`)) return false;
      return run(async () => {
        const a = await supabase.from("foursome_players").delete().eq("foursome_id", f.id);
        if (a.error) return errToText(a.error);
        const b = await supabase.from("foursomes").delete().eq("id", f.id);
        if (b.error) return errToText(b.error);
        return syncTeamLabel(members.map((p) => p.id), f.group_name, null);
      }, "Group deleted ✅");
    },

    savePlayer: (p, v) =>
      run(async () => {
        const { error } = await supabase
          .from("players")
          .update({ name: v.name, handicap: v.handicap, charity: v.charity })
          .eq("id", p.id);
        return error ? errToText(error) : null;
      }),
  };

  async function createGroup() {
    const v = validateGroup(gDraft, null);
    if (v.error) return setMsg(v.error);
    if (!roundId) return setMsg("No round to add the group to yet — reload the page and try again.");
    const ok = await run(async () => {
      let created = false;
      for (let tries = 0; tries < 10 && !created; tries++) {
        const { error } = await supabase
          .from("foursomes")
          .insert({ group_name: v.name, code: makeCode(6), tee_time: v.tee_time, starting_hole: v.hole, round_id: roundId });
        if (!error) created = true;
      }
      return created ? null : "Could not create the group (try again).";
    }, `Added "${v.name}" ✅`);
    if (ok) {
      setGDraft({ name: "", time: "", hole: "1" });
      setAddingGroup(false);
    }
  }

  async function createPlayer() {
    const v = readPlayerDraft(pDraft, players, null);
    if (v.error) return setPErr(v.error);
    const group = groups.find((g) => g.id === pGroup) || null;
    if (group && membersOf(group).length >= MAX_GROUP_SIZE) return setPErr(`${group.group_name} is full (${MAX_GROUP_SIZE} players).`);
    const ok = await run(async () => {
      const { data, error } = await supabase
        .from("players")
        .insert({ name: v.name, handicap: v.handicap, charity: v.charity, team_label: group ? group.group_name : null })
        .select("id")
        .single();
      if (error) return errToText(error);
      if (group) {
        const ins = await supabase.from("foursome_players").insert({ foursome_id: group.id, player_id: data.id });
        if (ins.error) return errToText(ins.error);
      }
      return null;
    }, `Added ${v.name} ✅`);
    if (ok) {
      setPDraft(emptyPlayerDraft);
      setPGroup("");
      setPErr("");
      setAddingPlayer(false);
    }
  }

  const shownPlayers = players
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={styles.helpText}>
        Change a player or a group any time, even after the tournament has started. A player&apos;s scores stay with
        them. Existing 2-man / 4-man game teams are not changed.
      </div>

      {multiRound ? (
        <label style={styles.label}>
          Round
          <select style={field} value={roundId} onChange={(e) => setRoundPick(e.target.value)}>
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

      <div style={styles.sectionLabel}>Groups ({groups.length})</div>
      {groups.length === 0 ? <div style={styles.helpText}>No groups yet.</div> : null}
      {groups.map((f) => {
        const members = membersOf(f);
        const memberIds = new Set(members.map((p) => p.id));
        const others = players.filter((p) => !memberIds.has(p.id));
        return (
          <RosterGroupCard
            key={f.id}
            f={f}
            members={members}
            otherGroups={groups.filter((g) => g.id !== f.id)}
            unassigned={others.filter((p) => !groupOfPlayer.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))}
            inOtherGroups={others.filter((p) => groupOfPlayer.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))}
            ops={ops}
            busy={busy}
            multiRound={multiRound}
            roundLabel={rounds.find((r) => r.id === f.round_id)?.label || "—"}
          />
        );
      })}

      {addingGroup ? (
        <div style={{ ...styles.foursomeCard, display: "grid", gap: 10 }}>
          <div style={styles.sectionLabel}>New group</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 64px" }}>
            <label style={styles.label}>
              Group name
              <input style={field} value={gDraft.name} onChange={(e) => setGDraft({ ...gDraft, name: e.target.value })} />
            </label>
            <label style={styles.label}>
              Tee time
              <input type="time" style={field} value={gDraft.time} onChange={(e) => setGDraft({ ...gDraft, time: e.target.value })} />
            </label>
            <label style={styles.label}>
              Hole
              <input
                style={field}
                inputMode="numeric"
                value={gDraft.hole}
                onChange={(e) => setGDraft({ ...gDraft, hole: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...styles.bigBtn, flex: 1, minHeight: 48 }} disabled={busy} onClick={createGroup}>
              Add group
            </button>
            <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingGroup(false)}>
              Cancel
            </button>
          </div>
          <div style={styles.helpText}>A code is made for it automatically. Add players to it afterwards with Edit.</div>
        </div>
      ) : (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingGroup(true)}>
          + Add group
        </button>
      )}

      <div style={styles.hr} />
      <div style={styles.sectionLabel}>Players ({players.length})</div>

      {addingPlayer ? (
        <div style={{ ...styles.foursomeCard }}>
          <div style={{ ...styles.sectionLabel, marginBottom: 10 }}>New player</div>
          <PlayerFields
            draft={pDraft}
            setDraft={(d) => {
              setPDraft(d);
              setPErr("");
            }}
            busy={busy}
            submitLabel="Add player"
            onCancel={() => setAddingPlayer(false)}
            onSubmit={createPlayer}
          >
            <label style={styles.label}>
              Put in a group (optional)
              <select style={field} value={pGroup} onChange={(e) => setPGroup(e.target.value)}>
                <option value="">No group yet</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id} disabled={membersOf(g).length >= MAX_GROUP_SIZE}>
                    {g.group_name}
                    {membersOf(g).length >= MAX_GROUP_SIZE ? " (full)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {pErr ? <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{pErr}</div> : null}
          </PlayerFields>
        </div>
      ) : (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingPlayer(true)}>
          + Add player
        </button>
      )}

      {players.length > 8 ? (
        <input
          style={field}
          placeholder="Search players"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search players"
        />
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {shownPlayers.map((p) => (
          <RosterPlayerRow key={p.id} p={p} groupName={groupOfPlayer.get(p.id)?.group_name} players={players} ops={ops} busy={busy} />
        ))}
        {shownPlayers.length === 0 ? <div style={styles.helpText}>No players match.</div> : null}
      </div>
    </div>
  );
}

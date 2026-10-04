// The one writer behind both ways of starting a tournament (Excel upload and Build on my phone): players, groups, tee times and who is in which group.

import { clampInt } from "../../lib/golf";
import { supabase } from "../../lib/supabase";
import { excelTimeToDbTime, fullNameFromRow } from "../../lib/teeSheet";
import { errToText, makeCode } from "../../lib/util";

// `app` = what the writer needs from the running app: the current `foursomes` and the `initialLoad` that refreshes everything afterwards.
export async function runTeeSheetImport({ foursomes, initialLoad }, rows, { replace, targetRoundId, say }) {
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

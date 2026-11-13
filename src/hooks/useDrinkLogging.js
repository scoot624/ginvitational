// Logging drinks from the Enter Scores screen: add / undo, the maximum rule, and safe uploading.
// Everything is saved on the phone first and sent in the background (retrying every 10 seconds and when
// the phone comes back online), so a dropped signal never loses a drink. `drinksView` is what this phone
// should show and count: the database's drinks plus unsent ones, minus undone ones.

import { useEffect, useMemo, useRef, useState } from "react";
import { pendingDrinkKey, readPendingDrinks, writePendingDrinks } from "../features/scoring/pendingDrinks";
import { canLogDrink, drinksInRound, mergeDrinks, newDrinkId, queueDrinkAdd, queueDrinkUndo } from "../lib/drinks";
import { supabase } from "../lib/supabase";
import { errToText } from "../lib/util";

export function useDrinkLogging({ drinks, loadDrinks, drinking }) {
  const [ops, setOps] = useState(() => readPendingDrinks());
  const [error, setError] = useState("");
  const uploadingRef = useRef(false);
  const uploadAgainRef = useRef(false);

  const drinksView = useMemo(() => mergeDrinks(drinks, ops), [drinks, ops]);

  // Sends everything waiting. It stops at the first failure so an undo can never run before its drink was sent.
  async function uploadPendingDrinks() {
    if (uploadingRef.current) {
      uploadAgainRef.current = true; // something new was queued mid-upload: go round again
      return;
    }
    uploadingRef.current = true;
    try {
      do {
        uploadAgainRef.current = false;
        const queue = readPendingDrinks();
        if (queue.length === 0) break;
        const done = new Set();
        let lastError = "";
        for (const o of queue) {
          const res =
            o.op === "add"
              ? await supabase
                  .from("drinks")
                  .upsert(
                    { id: o.id, player_id: o.player_id, round_id: o.round_id, hole: o.hole, note: o.note ?? null, created_at: o.created_at },
                    { onConflict: "id" }
                  )
              : await supabase.from("drinks").delete().eq("id", o.id);
          if (res.error) {
            lastError = errToText(res.error);
            break;
          }
          done.add(pendingDrinkKey(o));
        }
        // Keep what has not gone up yet, plus anything queued while this upload was running.
        const remaining = readPendingDrinks().filter((c) => !done.has(pendingDrinkKey(c)));
        writePendingDrinks(remaining);
        setOps(remaining);
        setError(remaining.length ? lastError : "");
        if (done.size > 0) await loadDrinks();
      } while (uploadAgainRef.current);
    } finally {
      uploadingRef.current = false;
    }
  }

  // Log one drink for a player on a hole. Returns { ok, reason } — reason "max" when Stroke Credit's cap is reached.
  async function logDrink({ player_id, round_id, hole }) {
    const gate = canLogDrink(drinksInRound(mergeDrinks(drinks, readPendingDrinks()), player_id, round_id), drinking);
    if (!gate.ok) return gate;
    const next = queueDrinkAdd(readPendingDrinks(), { id: newDrinkId(), player_id, round_id, hole, created_at: new Date().toISOString() });
    writePendingDrinks(next);
    setOps(next);
    await uploadPendingDrinks();
    return { ok: true, reason: null };
  }

  // Undo the most recent drink for a player on a hole (for mis-taps).
  async function undoDrink({ player_id, round_id, hole }) {
    const current = readPendingDrinks();
    const { ops: next, undoneId } = queueDrinkUndo(current, mergeDrinks(drinks, current), { player_id, round_id, hole });
    if (!undoneId) return { ok: false };
    writePendingDrinks(next);
    setOps(next);
    await uploadPendingDrinks();
    return { ok: true };
  }

  // Throw away drinks still waiting to upload (for one round, or all), e.g. when the drinks are deleted in Admin.
  function clearPending(roundId = null) {
    const next = roundId ? readPendingDrinks().filter((o) => !(o.op === "add" && o.round_id === roundId)) : [];
    writePendingDrinks(next);
    setOps(next);
    setError("");
  }

  const hasPending = ops.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(uploadPendingDrinks, 10_000);
    window.addEventListener("online", uploadPendingDrinks);
    uploadPendingDrinks();
    return () => {
      clearInterval(id);
      window.removeEventListener("online", uploadPendingDrinks);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending]);

  return { drinksView, pendingCount: ops.length, error, logDrink, undoDrink, uploadPendingDrinks, clearPending };
}

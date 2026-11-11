// Drinks waiting to upload (and drink undos waiting to be deleted). Same idea as unsent scores:
// a drink is written to the phone first, then sent, so a dropped signal or a reload never loses it.
// Each entry is { op: "add", id, player_id, round_id, hole, created_at } or { op: "remove", id }.

const PENDING_DRINKS_KEY = "ginv_pending_drinks_v1";

let pendingDrinksFallback = [];

export function readPendingDrinks() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_DRINKS_KEY) || "[]");
    return Array.isArray(v) ? v : pendingDrinksFallback;
  } catch {
    return pendingDrinksFallback;
  }
}

export function writePendingDrinks(list) {
  pendingDrinksFallback = list; // blocked storage: still held until the page reloads
  try {
    if (list.length) localStorage.setItem(PENDING_DRINKS_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_DRINKS_KEY);
  } catch {
    /* private window / blocked storage */
  }
}

export const pendingDrinkKey = (o) => `${o.op}:${o.id}`;

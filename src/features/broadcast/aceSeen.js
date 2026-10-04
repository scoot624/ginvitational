// Hole-in-one popup bookkeeping: how long it shows, and which ones this phone has already dismissed.

/** Hole-in-one popup: shown for 10 minutes after the card is posted, once per phone. */
export const ACE_POPUP_MS = 10 * 60 * 1000;

const SEEN_ACES_KEY = "ginv_seen_aces";

let seenAcesFallback = [];

export function readSeenAces() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_ACES_KEY) || "[]");
    return Array.isArray(v) ? v : seenAcesFallback;
  } catch {
    return seenAcesFallback;
  }
}

export function rememberSeenAce(id) {
  seenAcesFallback = [...seenAcesFallback, id].slice(-50);
  try {
    localStorage.setItem(SEEN_ACES_KEY, JSON.stringify([...readSeenAces().filter((x) => x !== id), id].slice(-50)));
  } catch {
    /* blocked storage: the in-memory list still stops a repeat until the page reloads */
  }
}

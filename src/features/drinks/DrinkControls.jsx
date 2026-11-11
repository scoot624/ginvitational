// "+ Drink" / undo for one player on one hole, with their running count. Renders nothing when Drinking Mode is off.

import { useRef } from "react";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { canLogDrink, drinksInRound, drinksOnHole } from "../../lib/drinks";
import { THEME, styles } from "../../theme";

export function DrinkControls({ player, hole, roundId, showName }) {
  const { drinking, drinksView, drinkLog } = useEventDataContext();
  const lockRef = useRef(false); // a quick double-tap should log one drink, not two
  if (!drinking.enabled) return null;

  const onHole = drinksOnHole(drinksView, player.id, roundId, hole);
  const total = drinksInRound(drinksView, player.id, roundId);
  const gate = canLogDrink(total, drinking);

  const progress =
    drinking.variant === "credit"
      ? `${Math.min(total, drinking.maxDrinks)} of ${drinking.maxDrinks}`
      : total >= drinking.minDrinks
      ? `${total} ✓`
      : `${total} of ${drinking.minDrinks}`;

  async function run(fn) {
    if (lockRef.current) return;
    lockRef.current = true;
    try {
      await fn({ player_id: player.id, round_id: roundId, hole });
    } finally {
      setTimeout(() => {
        lockRef.current = false;
      }, 350);
    }
  }

  return (
    <div style={{ marginTop: showName ? 8 : 10 }}>
      {showName ? <div style={{ fontSize: 12, fontWeight: 700 }}>{player.name}</div> : null}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: showName ? 4 : 0 }}>
        {onHole > 0 ? (
          <button
            type="button"
            aria-label={`Undo a drink for ${player.name}`}
            style={{ ...styles.smallBtn, minWidth: 44, minHeight: 44, padding: 0, fontSize: 20 }}
            onClick={() => run(drinkLog.undoDrink)}
          >
            −
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Log a drink for ${player.name}`}
          disabled={!gate.ok}
          style={{ ...styles.smallBtn, minHeight: 44, opacity: gate.ok ? 1 : 0.55 }}
          onClick={() => run(drinkLog.logDrink)}
        >
          {gate.reason === "max" ? "Max reached" : "+ Drink"}
        </button>
        <span style={{ fontSize: 12, color: THEME.textMuted }}>
          {onHole > 0 ? `🍺 ×${onHole} this hole · ` : ""}
          {progress}
        </span>
      </div>
    </div>
  );
}

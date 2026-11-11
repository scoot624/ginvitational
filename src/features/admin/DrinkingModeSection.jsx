// Admin → Drinking Mode: turn it on for the event, pick Minimum Drinks or Stroke Credit, and set its numbers.

import { useEffect, useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { DrinkingSetupNotice } from "../../components/SetupNotices";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { describeDrinking, normalizeDrinking } from "../../lib/drinks";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

export function DrinkingModeSection({ adminOn, openAdminSection, setOpenAdminSection }) {
  const { drinking, drinkingSaved, drinkingReady, loadAppSettings } = useEventDataContext();

  // Typed values stay as text while editing; they are tidied into whole numbers on save.
  const [enabled, setEnabled] = useState(false);
  const [variant, setVariant] = useState("min");
  const [minDrinks, setMinDrinks] = useState("4");
  const [creditPerDrink, setCreditPerDrink] = useState("1");
  const [maxDrinks, setMaxDrinks] = useState("3");
  const [msg, setMsg] = useState("");

  // Keep the form in step with what is saved (on load, and after a save).
  useEffect(() => {
    setEnabled(drinkingSaved.enabled);
    setVariant(drinkingSaved.variant);
    setMinDrinks(String(drinkingSaved.minDrinks));
    setCreditPerDrink(String(drinkingSaved.creditPerDrink));
    setMaxDrinks(String(drinkingSaved.maxDrinks));
  }, [drinkingSaved]);

  async function save() {
    if (!adminOn) return alert("Admin only.");
    const next = normalizeDrinking({ enabled, variant, minDrinks, creditPerDrink, maxDrinks });
    setMsg("Saving…");
    const { error } = await supabase
      .from("app_settings")
      .update({ drinking: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) {
      console.error(error);
      setMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setMsg("Saved ✅");
  }

  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  const choice = (key, title, text) => (
    <label
      key={key}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: 12,
        border: `2px solid ${variant === key ? THEME.accent : THEME.border}`,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name="drinking-variant"
        style={{ width: 22, height: 22, flex: "none", marginTop: 2 }}
        checked={variant === key}
        onChange={() => {
          setVariant(key);
          setMsg("");
        }}
      />
      <span>
        <span style={{ fontWeight: 800, display: "block" }}>{title}</span>
        <span style={{ fontSize: 12, color: THEME.textMuted }}>{text}</span>
      </span>
    </label>
  );

  return (
    <AdminSection
      title="Drinking Mode"
      subtitle={describeDrinking(drinking)}
      open={openAdminSection === "drinking"}
      onToggle={() => setOpenAdminSection((k) => (k === "drinking" ? null : "drinking"))}
    >
      {!drinkingReady ? (
        <DrinkingSetupNotice />
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div style={styles.helpText}>
            An optional game for the event. Drinks are logged on the Enter Scores screen with <b>+ Drink</b>. Gross
            scores are never changed, and with this off the app works exactly as before.
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontSize: 15 }}>
            <input
              type="checkbox"
              style={{ width: 22, height: 22 }}
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setMsg("");
              }}
            />
            Turn on Drinking Mode for this event
          </label>

          {enabled && (
            <>
              <div style={{ display: "grid", gap: 8 }}>
                {choice("min", "Minimum Drinks", "Each player should reach a minimum by the end of the round. Players who fall short are flagged. Scores are not affected.")}
                {choice("credit", "Stroke Credit", "Each logged drink takes strokes off that player's net score on the hole where it was logged, up to a maximum.")}
              </div>

              {variant === "min" ? (
                <label style={styles.label}>
                  Minimum drinks each player should reach
                  <input
                    style={field}
                    inputMode="numeric"
                    value={minDrinks}
                    onChange={(e) => {
                      setMinDrinks(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
                      setMsg("");
                    }}
                  />
                </label>
              ) : (
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
                  <label style={styles.label}>
                    Strokes removed per drink
                    <input
                      style={field}
                      inputMode="numeric"
                      value={creditPerDrink}
                      onChange={(e) => {
                        setCreditPerDrink(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
                        setMsg("");
                      }}
                    />
                  </label>
                  <label style={styles.label}>
                    Most drinks that count per player
                    <input
                      style={field}
                      inputMode="numeric"
                      value={maxDrinks}
                      onChange={(e) => {
                        setMaxDrinks(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
                        setMsg("");
                      }}
                    />
                  </label>
                </div>
              )}
            </>
          )}

          <button style={{ ...styles.bigBtn, minHeight: 48 }} onClick={save}>
            Save
          </button>
          {msg ? <div style={styles.helpText}>{msg}</div> : null}
        </div>
      )}
    </AdminSection>
  );
}

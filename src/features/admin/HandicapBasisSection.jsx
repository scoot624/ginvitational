import { AdminSection } from "../../components/AdminSection";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

// Admin → Handicap Basis: course handicaps as entered, or relative to the lowest in the field.

export function HandicapBasisSection({ adminOn, openAdminSection, setOpenAdminSection }) {
  const {
    appSettings,
    loadAppSettings,
  } = useEventDataContext();

  // 'course': everyone's own handicap, as entered.
  // 'field_relative': everyone's handicap minus the lowest handicap among
  // every player imported for the event, so the best player in the field
  // plays to scratch. Affects the Leaderboard, print scorecards, and the
  // scorecard popup — see `fieldOffset` below.
  async function setHandicapBasis(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ handicap_basis: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  return (
          <AdminSection
            title="Handicap Basis"
            subtitle={appSettings.handicap_basis === "field_relative" ? "Field-Relative" : "Course Handicap"}
            open={openAdminSection === "handicapBasis"}
            onToggle={() => setOpenAdminSection((k) => (k === "handicapBasis" ? null : "handicapBasis"))}
          >
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={(appSettings.handicap_basis || "course") === "course"}
                  onChange={() => setHandicapBasis("course")}
                />
                Course Handicap — everyone plays off their own handicap.
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={appSettings.handicap_basis === "field_relative"}
                  onChange={() => setHandicapBasis("field_relative")}
                />
                Field-Relative — everyone plays off the lowest handicap among all imported players.
              </label>
            </div>

            <div style={styles.helpText}>
              Applies to the Leaderboard, print scorecards, and the scorecard popup. A plus handicap now correctly
              gives strokes back (marked with a "+") instead of being treated as scratch.
            </div>
          </AdminSection>
  );
}

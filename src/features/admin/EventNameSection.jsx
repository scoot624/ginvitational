import { useEffect, useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { styles } from "../../theme";

// Admin → Event Name: edit the tournament name shown on Home, the nav, print scorecards and the browser tab.

export function EventNameSection({ adminOn, eventName, openAdminSection, setOpenAdminSection }) {
  const {
    loadAppSettings,
  } = useEventDataContext();

  // Admin: editable event name
  const [eventNameDraft, setEventNameDraft] = useState("");

  const [eventNameMsg, setEventNameMsg] = useState("");

  async function saveEventName() {
    if (!adminOn) return alert("Admin only.");
    const name = eventNameDraft.trim() || "The Ginvitational";
    setEventNameMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ event_name: name, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setEventNameMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setEventNameMsg("Saved ✅");
  }

  // Keep the Admin draft in sync with the saved value (e.g. after a save,
  // or on initial load), without clobbering what's being typed elsewhere.
  useEffect(() => {
    setEventNameDraft(eventName);
  }, [eventName]);

  return (
          <AdminSection
            title="Event Name"
            subtitle={eventName || "Not set"}
            open={openAdminSection === "eventName"}
            onToggle={() => setOpenAdminSection((k) => (k === "eventName" ? null : "eventName"))}
          >
            <div style={styles.helpText}>Shown on Home, the top nav, print scorecards, and the browser tab.</div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                style={{ ...styles.input, flex: 1, minWidth: 200 }}
                value={eventNameDraft}
                onChange={(e) => {
                  setEventNameDraft(e.target.value);
                  setEventNameMsg("");
                }}
                placeholder="The Ginvitational"
              />
              <button style={styles.bigBtn} onClick={saveEventName}>
                Save
              </button>
            </div>

            {eventNameMsg ? <div style={styles.helpText}>{eventNameMsg}</div> : null}
          </AdminSection>
  );
}

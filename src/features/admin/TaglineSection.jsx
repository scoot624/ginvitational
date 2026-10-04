import { useEffect, useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { BrandingSetupNotice } from "../../components/SetupNotices";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { DEFAULT_TAGLINE } from "../../lib/branding";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { styles } from "../../theme";

// Admin → Tagline: edit the line under the tournament name (blank hides it).

export function TaglineSection({ adminOn, tagline, openAdminSection, setOpenAdminSection }) {
  const {
    brandingReady,
    loadAppSettings,
  } = useEventDataContext();

  // Admin: editable tagline + uploadable main logo. `brandingReady` is false
  // until the one-time database change (migration 0010) has been made.
  const [taglineDraft, setTaglineDraft] = useState("");

  const [taglineMsg, setTaglineMsg] = useState("");

  async function saveTagline() {
    if (!adminOn) return alert("Admin only.");
    setTaglineMsg("Saving…");

    // Blank is allowed and means "no tagline" (stored as "", not null — null
    // is reserved for "never set", which shows the default).
    const { error } = await supabase
      .from("app_settings")
      .update({ tagline: taglineDraft.trim(), updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setTaglineMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setTaglineMsg("Saved ✅");
  }

  useEffect(() => {
    setTaglineDraft(tagline);
  }, [tagline]);

  return (
          <AdminSection
            title="Tagline"
            subtitle={tagline || "None"}
            open={openAdminSection === "tagline"}
            onToggle={() => setOpenAdminSection((k) => (k === "tagline" ? null : "tagline"))}
          >
            <div style={styles.helpText}>
              Shown on the Home screen under the event name. Leave it blank to show no tagline.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 200 }}
                    value={taglineDraft}
                    onChange={(e) => {
                      setTaglineDraft(e.target.value);
                      setTaglineMsg("");
                    }}
                    placeholder={DEFAULT_TAGLINE}
                  />
                  <button style={styles.bigBtn} onClick={saveTagline}>
                    Save
                  </button>
                </div>
                {taglineMsg ? <div style={styles.helpText}>{taglineMsg}</div> : null}
              </>
            )}
          </AdminSection>
  );
}

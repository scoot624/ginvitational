import { useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { BrandingSetupNotice } from "../../components/SetupNotices";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { fileToLogoDataUrl } from "../../lib/branding";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { styles } from "../../theme";

// Admin → Logo: upload a new main logo, or go back to the built-in one.

export function LogoSection({ adminOn, customLogo, openAdminSection, setOpenAdminSection, logoSrc }) {
  const {
    brandingReady,
    loadAppSettings,
  } = useEventDataContext();

  const [logoDraft, setLogoDraft] = useState(null); // data URL awaiting "Save logo"

  const [logoMsg, setLogoMsg] = useState("");

  async function onLogoPicked(file) {
    if (!file) return;
    setLogoMsg("Processing…");
    try {
      setLogoDraft(await fileToLogoDataUrl(file));
      setLogoMsg("Preview above — click Save logo to use it everywhere.");
    } catch (e) {
      setLogoDraft(null);
      setLogoMsg(e.message || "Couldn't use that image.");
    }
  }

  async function saveLogo(nextLogoData) {
    if (!adminOn) return alert("Admin only.");
    setLogoMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ logo_data: nextLogoData, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setLogoMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    setLogoDraft(null);
    await loadAppSettings();
    setLogoMsg(nextLogoData ? "Saved ✅ — the new logo is live." : "Back to the default logo ✅");
  }

  return (
          <AdminSection
            title="Logo"
            subtitle={customLogo ? "Custom logo" : "Default logo"}
            open={openAdminSection === "logo"}
            onToggle={() => setOpenAdminSection((k) => (k === "logo" ? null : "logo"))}
          >
            <div style={styles.helpText}>
              Your main logo — shown on the Home screen, the printed scorecards, and as the browser tab icon. Any
              image works; it's resized automatically. A PNG with a transparent background looks best.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ ...styles.label, marginBottom: 6 }}>{logoDraft ? "Current" : "Current logo"}</div>
                    <img
                      src={logoSrc}
                      alt="Current logo"
                      style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                    />
                  </div>
                  {logoDraft ? (
                    <div>
                      <div style={{ ...styles.label, marginBottom: 6 }}>New logo (not saved yet)</div>
                      <img
                        src={logoDraft}
                        alt="New logo preview"
                        style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                      />
                    </div>
                  ) : null}
                </div>

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    onLogoPicked(e.target.files?.[0] || null);
                    e.target.value = ""; // picking the same file again should still fire
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {logoDraft ? (
                    <>
                      <button style={styles.bigBtn} onClick={() => saveLogo(logoDraft)}>
                        Save logo
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setLogoDraft(null);
                          setLogoMsg("");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                  {customLogo && !logoDraft ? (
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        if (confirm("Go back to the default logo?")) saveLogo(null);
                      }}
                    >
                      Use default logo
                    </button>
                  ) : null}
                </div>

                {logoMsg ? <div style={styles.helpText}>{logoMsg}</div> : null}
              </div>
            )}
          </AdminSection>
  );
}

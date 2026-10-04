import { AdminSection } from "../../components/AdminSection";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { styles } from "../../theme";

// Admin → Start a Tournament: two ways in (Excel upload, or build it on your phone).

export function StartTournamentSection({ openAdminSection, setOpenAdminSection, setPhoneSetupOn }) {
  const {
    foursomes,
  } = useEventDataContext();

  return (
          <AdminSection
            title="Start a Tournament"
            subtitle={foursomes.length > 0 ? `${foursomes.length} groups set up` : "Upload an Excel sheet or build it on your phone"}
            open={openAdminSection === "start"}
            onToggle={() => setOpenAdminSection((k) => (k === "start" ? null : "start"))}
          >
            <div style={styles.helpText}>Two ways to set up players, groups and tee times. Both give the same result.</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setPhoneSetupOn(true)}>
                📱 Build on my phone
              </button>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setOpenAdminSection("import")}>
                📄 Upload Excel sheet
              </button>
            </div>
          </AdminSection>
  );
}

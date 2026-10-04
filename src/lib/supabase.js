import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase via env vars (.env.local locally; set on the host for the live site). */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export { fetchAllRows } from "./paging.js";

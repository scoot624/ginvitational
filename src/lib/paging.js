// Paged loading for tables that can grow past the database's 1,000-rows-per-request limit.
// Kept separate from supabase.js so it can be tested without a database.

/**
 * Loads EVERY row of a query. The database returns at most 1,000 rows per
 * request (a project default), and a plain select silently stops there — so
 * once a table grew past that, the app quietly dropped rows (the oldest
 * scores first). This asks for pages until one comes back short.
 * `buildQuery` must return a FRESH query each call and be ordered by
 * something unique (add a tie-breaker like id), or pages can overlap.
 * Returns { data, error } like a normal Supabase call.
 */
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

-- ============================================================
-- Ginvitational: editable tagline + uploadable main logo
-- ============================================================
-- Adds two nullable columns to the existing app_settings singleton:
--   tagline    — NULL means "use the default tagline"; an empty string
--                means "show no tagline".
--   logo_data  — the main logo as a small (<= ~640px) PNG data URL,
--                resized in the browser before it is saved. NULL means
--                "use the built-in spool logo".
-- Safe to run more than once. Existing RLS policies on app_settings
-- already cover new columns, so no policy changes are needed.
-- ============================================================

alter table app_settings add column if not exists tagline text;
alter table app_settings add column if not exists logo_data text;

-- ============================================================
-- Ginvitational: Multi-Game Architecture — Stage 3 schema addition
-- ============================================================
-- Adds one nullable column to the existing players table.
-- Populated by the Excel tee-sheet import (optional "team" column),
-- same pattern as the existing "charity" column. Does not affect
-- any existing rows, queries, or RLS policies.
-- ============================================================

alter table players add column if not exists team_label text;

-- ============================================================
-- Ginvitational: Multi-Game Architecture — Stage 5 schema addition
-- ============================================================
-- Adds one nullable-safe column to the existing games table.
-- Defaults to false (unlocked) for every existing row, so nothing
-- currently visible changes. Locking hides that game's board on the
-- Leaderboard tab behind a passcode gate (the admin PIN) until
-- unlocked — score entry is unaffected either way.
-- ============================================================

alter table games add column if not exists locked boolean not null default false;

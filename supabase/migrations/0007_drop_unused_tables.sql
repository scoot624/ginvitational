-- ============================================================
-- Ginvitational: drop unused tables
-- ============================================================
-- admin_pin: never used by the app (the Admin PIN check happens in
-- the app's own code, not against this table), and its permissions
-- already block all access to everyone anyway.
-- test: leftover scratch table from early setup, unused.
-- Neither has any real data or is referenced anywhere in the app.
-- ============================================================

drop table if exists admin_pin;
drop table if exists test;

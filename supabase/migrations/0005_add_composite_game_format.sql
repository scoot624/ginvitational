-- ============================================================
-- Ginvitational: Composite (multi-format) game support
-- ============================================================
-- Adds one new allowed format ('composite') and one new nullable
-- column (segments) to the existing games table. Purely additive —
-- no existing rows or other tables are touched.
--
-- segments holds an array like:
-- [
--   {"holes":[1,2,3,4,5,6], "formatType":"individual", "label":"Best Ball",
--    "countingRule":{"scoresCounted":1,"slots":["net"]}, "handicapPct":100},
--   {"holes":[7,8,9,10,11,12], "formatType":"shared", "label":"Scramble",
--    "handicapAllowance":{"lowPct":35,"highPct":15}},
--   {"holes":[13,14,15,16,17,18], "formatType":"individual", "label":"Combined Score",
--    "countingRule":{"scoresCounted":2,"slots":["net","net"]}, "handicapPct":100}
-- ]
-- "individual" segments reuse the existing per-player counting-rule engine.
-- "shared" segments (Scramble) use one team score per hole + a blended
-- team handicap (lowPct applied to the lower-handicap partner, highPct
-- to the higher).
-- ============================================================

alter table games drop constraint if exists games_format_check;
alter table games add constraint games_format_check check (
  format in ('individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4', 'composite')
);

alter table games add column if not exists segments jsonb;

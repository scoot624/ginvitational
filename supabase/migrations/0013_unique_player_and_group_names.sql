-- ============================================================
-- Ginvitational: no two players with the same name, no two groups with
-- the same name in a round
-- ============================================================
-- The tee-sheet import and the Players & Groups editor both treat a name as
-- the identity (matching "Anna Ames" and "anna ames" as the same person, and
-- the same for group names within a round). Until now nothing in the database
-- enforced that, so a duplicate could slip in and confuse the import.
--
-- Checked against the live data before writing this: no duplicates exist, so
-- these will go in cleanly. If you ever see "could not create unique index",
-- it lists the duplicate name to rename first.
-- Safe to run more than once.
-- ============================================================

create unique index if not exists players_name_unique
  on players (lower(btrim(name)));

create unique index if not exists foursomes_round_name_unique
  on foursomes (round_id, lower(btrim(group_name)));

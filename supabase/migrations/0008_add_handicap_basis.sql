-- ============================================================
-- Ginvitational: handicap basis (Course Handicap vs Field-Relative)
-- ============================================================
-- Adds one column to the existing app_settings singleton table.
-- 'course'        - every player's own handicap, as entered (default,
--                    matches current/existing behavior exactly).
-- 'field_relative' - every player's handicap minus the lowest handicap
--                    among everyone imported for the event, so the
--                    best player in the field plays to scratch and
--                    everyone else's allowance shifts accordingly.
-- Defaults to 'course' so nothing currently displayed changes until
-- an admin switches it.
-- ============================================================

alter table app_settings
  add column if not exists handicap_basis text not null default 'course';

alter table app_settings
  add constraint app_settings_handicap_basis_check
  check (handicap_basis in ('course', 'field_relative'));

-- =========================================================================
-- Step 11.4 — database-level protection against two concurrent active
-- automation runs.
--
-- Previously, run-level concurrency protection was a check-then-insert in
-- application code (lib/automation/run-automation.ts's assertNoConcurrentRun):
-- select for an existing RUNNING row, then insert a new one if none was
-- found. Two simultaneous callers could both pass the check before either
-- had inserted, producing two coexisting RUNNING rows.
--
-- A partial unique index makes "at most one RUNNING row" a constraint the
-- database itself enforces atomically, independent of application-level
-- timing. Because the index's predicate is `where status = 'RUNNING'`, it
-- only ever applies to RUNNING rows — COMPLETED / PARTIAL / FAILED /
-- CANCELLED rows are untouched and unlimited in number, exactly as before.
-- No existing rows are modified or deleted by this migration, and no RLS
-- policy on automation_runs is changed.
-- =========================================================================

create unique index automation_runs_single_active_run_idx
  on public.automation_runs (status)
  where (status = 'RUNNING');

-- ============================================================
-- Fix email triage consistency constraint
--
-- REVIEW_REQUIRED ainda nao possui Contract Event.
-- EVENT_CREATED exige event_id.
-- ============================================================

alter table public.email_triage_results
  drop constraint if exists email_triage_results_check;

alter table public.email_triage_results
  drop constraint if exists email_triage_results_event_consistency_check;

alter table public.email_triage_results
  add constraint email_triage_results_event_consistency_check
  check (
    (
      decision in ('SKIPPED', 'REVIEW_REQUIRED')
      and event_id is null
    )
    or
    (
      decision = 'EVENT_CREATED'
      and event_id is not null
    )
  );

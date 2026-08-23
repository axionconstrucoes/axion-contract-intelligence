-- ============================================================
-- 20260823091500_startup_audit_triggers.sql
-- Auditoria específica do Start-up ACC (seção 20 do requisito):
-- PROJECT_STARTUP_REVIEW_STARTED, HISTORICAL_FINDING_DISMISSED,
-- HISTORICAL_FINDING_RESOLVED, HISTORICAL_FINDING_ACTION_CREATED,
-- PROJECT_STARTUP_COMPLETED. Sempre append-only (mesmo mecanismo de
-- audit_log_entries já existente) — nunca um segundo log paralelo.
-- ============================================================

-- Estende o trigger já existente (audit_ai_finding_status_changed, ver
-- migration 20260823080000) para emitir os nomes específicos do
-- Start-up quando aplicável — nunca duplica o registro genérico
-- AI_FINDING_STATUS_CHANGED (substitui a ação emitida, não adiciona uma
-- segunda linha).
create or replace function public.audit_ai_finding_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_action text;
begin
  if new.lifecycle_status is distinct from old.lifecycle_status then
    v_action := case new.lifecycle_status
      when 'DISMISSED_AT_STARTUP' then 'HISTORICAL_FINDING_DISMISSED'
      when 'RESOLVED_BEFORE_GO_LIVE' then 'HISTORICAL_FINDING_RESOLVED'
      when 'ACTION_CREATED' then 'HISTORICAL_FINDING_ACTION_CREATED'
      else 'AI_FINDING_STATUS_CHANGED'
    end;

    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.project_id,
      case when v_actor_user_id is null then 'SYSTEM' else 'USER' end,
      v_actor_user_id,
      null,
      v_action,
      'AI_FINDING',
      new.id::text,
      format('Finding %s (%s): status %s -> %s.', new.id, new.finding_type, old.lifecycle_status, new.lifecycle_status),
      now()
    );
  end if;
  return new;
end;
$$;

-- PROJECT_STARTUP_REVIEW_STARTED (project_start_date configurado pela
-- primeira vez) / PROJECT_STARTUP_COMPLETED (startup_completed_at
-- gravado) — mesmo trigger, dois eventos possíveis por UPDATE.
create or replace function public.audit_project_startup_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if old.project_start_date is null and new.project_start_date is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.id,
      case when v_actor_user_id is null then 'SYSTEM' else 'USER' end,
      v_actor_user_id,
      null,
      'PROJECT_STARTUP_REVIEW_STARTED',
      'PROJECT',
      new.id::text,
      format('Start-up ACC iniciado: project_start_date = %s, acc_operational_start_date = %s.', new.project_start_date, new.acc_operational_start_date),
      now()
    );
  end if;

  if old.startup_completed_at is null and new.startup_completed_at is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.id,
      case when v_actor_user_id is null then 'SYSTEM' else 'USER' end,
      v_actor_user_id,
      null,
      'PROJECT_STARTUP_COMPLETED',
      'PROJECT',
      new.id::text,
      format('Start-up ACC concluído: histórico revisado até %s.', new.historical_review_through),
      now()
    );
  end if;

  return new;
end;
$$;

create trigger projects_audit_startup_transitions
  after update on public.projects
  for each row execute function public.audit_project_startup_transitions();

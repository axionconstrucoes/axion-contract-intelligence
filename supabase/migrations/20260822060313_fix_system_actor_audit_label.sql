-- ============================================================
-- 20260822060313_fix_system_actor_audit_label.sql
-- Corrige um bug real descoberto por teste automatizado
-- (scripts/test-sla-escalation.mjs): audit_log_entries exige
-- actor_label IS NULL quando actor_type = 'SYSTEM' (ver constraint em
-- 20260819195713_audit_foundation.sql). Três funções inseriam um
-- actor_label não nulo ('sla-engine'/'esg_obligations') junto com
-- actor_type = 'SYSTEM', violando a constraint e fazendo a operação
-- inteira falhar (nenhum escalonamento real chegou a ser aplicado antes
-- desta correção).
--
-- review_esg_obligation_submission (de 20260822050000, já commitada)
-- tinha o mesmo bug — nunca testado porque o teste da fase ESG
-- deliberadamente usava status CUMPRIDO para não disparar aquele branch
-- (ver docs/esg-obligations.md, seção 7). Corrigida aqui via CREATE OR
-- REPLACE, nunca editando a migration original já aplicada.
-- ============================================================

create or replace function public.audit_sla_action_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.acknowledged_at is null and new.acknowledged_at is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.project_id, 'USER', new.acknowledged_by_user_id, null,
      'ACTION_ACKNOWLEDGED', 'SLA_ACTION', new.id::text,
      format('Ação "%s" assumida.', new.title), new.acknowledged_at
    );
  end if;

  if old.status is distinct from 'IN_PROGRESS' and new.status = 'IN_PROGRESS' then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    )
    values (
      new.project_id, 'USER', auth.uid(), null,
      'ACTION_STARTED', 'SLA_ACTION', new.id::text,
      format('Ação "%s" iniciada.', new.title)
    );
  end if;

  if old.completed_at is null and new.completed_at is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.project_id, 'USER', new.completed_by_user_id, null,
      'ACTION_COMPLETED', 'SLA_ACTION', new.id::text,
      format('Ação "%s" concluída.', new.title), new.completed_at
    );
  end if;

  if old.status is distinct from 'OVERDUE' and new.status = 'OVERDUE' then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    )
    values (
      new.project_id, 'SYSTEM', null, null,
      'ACTION_OVERDUE', 'SLA_ACTION', new.id::text,
      format('Ação "%s" marcada como vencida.', new.title)
    );
  end if;

  if old.responsible_user_id is distinct from new.responsible_user_id
     and old.responsible_user_id is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    )
    values (
      new.project_id, 'USER', auth.uid(), null,
      'ACTION_REASSIGNED', 'SLA_ACTION', new.id::text,
      format('Ação "%s" reatribuída de %s para %s.', new.title, old.responsible_user_id, coalesce(new.responsible_user_id::text, 'ninguém'))
    );
  end if;

  return new;
end;
$$;

create or replace function public.escalate_sla_action(
  p_action_id uuid,
  p_expected_current_level text,
  p_new_level text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.sla_actions%rowtype;
  v_notified_user_id uuid;
  v_escalation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_action
  from public.sla_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'SLA action not found';
  end if;

  if not public.is_project_member(v_action.project_id) then
    raise exception 'Not a project member';
  end if;

  if v_action.current_escalation_level <> p_expected_current_level then
    raise exception 'Escalation level changed concurrently — refresh and retry (expected %, found %)',
      p_expected_current_level, v_action.current_escalation_level;
  end if;

  if v_action.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Cannot escalate a completed/cancelled action';
  end if;

  if p_reason not in (
    'NO_ACKNOWLEDGMENT', 'NOT_RESPONDED', 'NOT_COMPLETED',
    'CONTRACTUAL_DEADLINE_NEAR', 'CONTRACTUAL_DEADLINE_MISSED',
    'NEW_EVIDENCE_INCREASED_RISK'
  ) then
    raise exception 'Invalid escalation reason';
  end if;

  v_notified_user_id := case p_new_level
    when 'ESCALAO_1' then (
      select escalation_1_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    when 'ESCALAO_2' then (
      select escalation_2_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    when 'DIRETORIA' then (
      select board_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    else null
  end;

  perform set_config('acc.allow_escalation_update', 'true', true);

  update public.sla_actions
  set
    current_escalation_level = p_new_level,
    status = 'ESCALATED'
  where id = p_action_id;

  perform set_config('acc.allow_escalation_update', 'false', true);

  insert into public.sla_action_escalations (
    action_id, project_id, from_level, to_level, reason, notified_user_id
  )
  values (
    p_action_id, v_action.project_id, p_expected_current_level, p_new_level, p_reason, v_notified_user_id
  )
  returning id into v_escalation_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_action.project_id, 'SYSTEM', null, null,
    'ACTION_ESCALATED', 'SLA_ACTION', p_action_id::text,
    format('Ação "%s" escalada de %s para %s (motivo: %s).', v_action.title, p_expected_current_level, p_new_level, p_reason)
  );

  return v_escalation_id;
end;
$$;

create or replace function public.review_esg_obligation_submission(
  p_submission_id uuid,
  p_new_status text,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_submission public.esg_obligation_submissions%rowtype;
  v_obligation public.esg_obligations%rowtype;
  v_previous_risk text;
  v_event_id uuid;
  v_event_title text;
  v_event_description text;
  v_category text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_submission
  from public.esg_obligation_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'ESG obligation submission not found';
  end if;

  if not public.has_project_permission(v_submission.project_id, 'ADMIN') then
    raise exception 'ADMIN permission required to review an ESG obligation submission';
  end if;

  if p_new_status not in (
    'CUMPRIDO', 'CUMPRIDO_PARCIALMENTE', 'PENDENTE',
    'NAO_CUMPRIDO', 'NAO_APLICAVEL', 'DISPENSADO'
  ) then
    raise exception 'Invalid status';
  end if;

  if p_new_status in ('NAO_APLICAVEL', 'DISPENSADO') and nullif(trim(p_review_note), '') is null then
    raise exception 'Review note (justification) is required for NAO_APLICAVEL/DISPENSADO';
  end if;

  select * into v_obligation
  from public.esg_obligations
  where id = v_submission.obligation_id;

  select risk_level into v_previous_risk
  from public.esg_obligation_submissions
  where obligation_id = v_submission.obligation_id
    and id <> p_submission_id
  order by created_at desc
  limit 1;

  update public.esg_obligation_submissions
  set
    status = p_new_status,
    reviewed_by_user_id = v_user_id,
    reviewed_at = now(),
    review_note = nullif(trim(p_review_note), '')
  where id = p_submission_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_submission.project_id, 'USER', v_user_id, null,
    'ESG_OBLIGATION_REVIEWED', 'ESG_OBLIGATION_SUBMISSION', p_submission_id::text,
    format('Comprovação revisada: status ajustado para %s.', p_new_status)
  );

  if p_new_status = 'NAO_CUMPRIDO' then
    v_event_title := format('Obrigação ESG/SSMA não cumprida: %s', v_obligation.title);
    v_event_description := coalesce(v_obligation.penalty_description, 'Obrigação contratual ESG/SSMA registrada como não cumprida.');
    v_category := 'RESPONSABILIDADES';
  elsif v_submission.risk_level in ('HIGH', 'CRITICAL') then
    v_event_title := format('Risco de penalidade ESG/SSMA: %s', v_obligation.title);
    v_event_description := coalesce(v_obligation.penalty_description, 'Obrigação contratual ESG/SSMA com risco relevante de penalidade.');
    v_category := 'PENALIDADES';
  elsif p_new_status in ('CUMPRIDO', 'CUMPRIDO_PARCIALMENTE') and v_previous_risk = 'CRITICAL' then
    v_event_title := format('Obrigação ESG/SSMA crítica regularizada: %s', v_obligation.title);
    v_event_description := 'Obrigação contratual ESG/SSMA anteriormente com risco crítico foi regularizada.';
    v_category := 'RESPONSABILIDADES';
  else
    v_event_title := null;
  end if;

  if v_event_title is not null then
    insert into public.contract_events (
      project_id, occurred_at, title, description, source_type, status,
      created_by_type, created_by_user_id
    )
    values (
      v_submission.project_id, now(), v_event_title, v_event_description, 'CONTRATO', 'NOVO',
      'SYSTEM', null
    )
    returning id into v_event_id;

    insert into public.event_categories (event_id, category)
    values (v_event_id, v_category);

    insert into public.event_evidence (
      event_id, source_type, label, locator
    )
    values (
      v_event_id, 'CONTRATO',
      format('Comprovação ESG/SSMA — %s', v_obligation.title),
      format('esg_obligation_submissions.id=%s', p_submission_id)
    );

    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    )
    values (
      v_submission.project_id, 'SYSTEM', null, null,
      'CONTRACT_EVENT_CREATED', 'CONTRACT_EVENT', v_event_id::text,
      format('Evento gerado a partir da revisão da comprovação ESG/SSMA %s.', p_submission_id)
    );
  end if;

  return v_event_id;
end;
$$;

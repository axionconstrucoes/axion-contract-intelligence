-- Matriz operacional de três níveis:
-- Nível 1 = responsável direto, Nível 2 = gerência, Nível 3 = diretoria.
-- Quando o Nível 2 não está configurado, o escalonamento vai direto ao
-- Nível 3. ESCALAO_2 permanece aceito apenas para registros legados.

create or replace function public.escalate_sla_action(
  p_action_id uuid,
  p_expected_current_level text,
  p_new_level text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.sla_actions%rowtype;
  v_effective_level text := p_new_level;
  v_level_2_user_id uuid;
  v_legacy_level_2_user_id uuid;
  v_level_3_user_id uuid;
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

  if not public.has_project_permission(v_action.project_id, 'ADMINISTRADOR') then
    raise exception 'ADMINISTRADOR permission required';
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
    'NEW_EVIDENCE_INCREASED_RISK', 'RELEVANT_RECOMMENDATION_REJECTED'
  ) then
    raise exception 'Invalid escalation reason';
  end if;

  select escalation_1_user_id, escalation_2_user_id, board_user_id
  into v_level_2_user_id, v_legacy_level_2_user_id, v_level_3_user_id
  from public.sla_area_responsibles
  where project_id = v_action.project_id and area = v_action.area;

  if p_new_level = 'ESCALAO_1' then
    if v_level_2_user_id is not null then
      v_notified_user_id := v_level_2_user_id;
    elsif v_level_3_user_id is not null then
      v_effective_level := 'DIRETORIA';
      v_notified_user_id := v_level_3_user_id;
    end if;
  elsif p_new_level = 'ESCALAO_2' then
    if v_legacy_level_2_user_id is not null then
      v_notified_user_id := v_legacy_level_2_user_id;
    elsif v_level_3_user_id is not null then
      v_effective_level := 'DIRETORIA';
      v_notified_user_id := v_level_3_user_id;
    end if;
  elsif p_new_level = 'DIRETORIA' then
    v_notified_user_id := v_level_3_user_id;
  end if;

  perform set_config('acc.allow_escalation_update', 'true', true);

  update public.sla_actions
  set current_escalation_level = v_effective_level, status = 'ESCALATED'
  where id = p_action_id;

  perform set_config('acc.allow_escalation_update', 'false', true);

  insert into public.sla_action_escalations (
    action_id, project_id, from_level, to_level, reason, notified_user_id
  )
  values (
    p_action_id, v_action.project_id, p_expected_current_level,
    v_effective_level, p_reason, v_notified_user_id
  )
  returning id into v_escalation_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_action.project_id, 'SYSTEM', null, null,
    'ACTION_ESCALATED', 'SLA_ACTION', p_action_id::text,
    format(
      'Ação "%s" escalada de %s para %s (motivo: %s).',
      v_action.title, p_expected_current_level, v_effective_level, p_reason
    )
  );

  return v_escalation_id;
end;
$$;

alter function public.escalate_sla_action(uuid, text, text, text) owner to postgres;
revoke all on function public.escalate_sla_action(uuid, text, text, text) from public;
revoke all on function public.escalate_sla_action(uuid, text, text, text) from anon;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to authenticated;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to service_role;

comment on function public.escalate_sla_action(uuid, text, text, text) is
  'Escalona ações de SLA com concorrência otimista. Quando o Nível 2 da área não está configurado, registra e notifica diretamente o Nível 3, sem reiniciar os prazos da ação.';

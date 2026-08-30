-- ============================================================
-- 20260830100500_restrict_sla_escalation_to_administrators.sql
--
-- Fecha o risco de autorização ALTA confirmado por teste em
-- 2026-08-30: escalate_sla_action() checava apenas
-- is_project_member(project_id) — QUALQUER papel com associação
-- ativa ao projeto (inclusive LEITURA, o papel mais restrito do
-- sistema) conseguia escalar o nível/status de uma ação de SLA.
-- Confirmado empiricamente em stack descartável (nunca no
-- remoto): LEITURA, COLABORADOR, GESTOR e GERENTE conseguiam
-- escalar; só ADMINISTRADOR era o comportamento pretendido.
--
-- Decisão final autorizada em 2026-08-30 (revisando uma decisão
-- intermediária anterior que permitia GESTOR/GERENTE): a
-- escalada fica restrita exclusivamente a ADMINISTRADOR.
-- GESTOR, GERENTE, COLABORADOR e LEITURA ficam bloqueados —
-- mesma regra corporativa já vigente em has_project_permission
-- ("só ADMINISTRADOR escreve", estabelecida em
-- 20260824232516_enforce_admin_only_write.sql e mantida
-- deliberadamente intocada nesta rodada, ver diagnóstico
-- 2026-08-30).
--
-- Por essa mesma razão, esta versão usa diretamente
-- has_project_permission(project_id, 'ADMINISTRADOR') — o helper
-- central já usado por toda outra function administrativa deste
-- sistema — em vez de uma checagem inline duplicada. A versão
-- anterior desta migration (que permitia GESTOR/GERENTE) não
-- podia reaproveitar has_project_permission porque sua tabela de
-- ranks trata GESTOR/GERENTE/COLABORADOR/LEITURA como
-- equivalentes (não existe um nível "GESTOR/GERENTE" real nela);
-- como a decisão final é ADMINISTRADOR-apenas, o helper central
-- já expressa exatamente essa regra, sem necessidade de duplicar
-- nada.
--
-- Owner, SECURITY DEFINER, search_path e ACL são reasserados
-- EXPLICITAMENTE abaixo (não apenas confiados à preservação
-- automática do Postgres em CREATE OR REPLACE), conforme
-- exigido no diagnóstico: owner=postgres; SECURITY DEFINER;
-- search_path=''; REVOKE ALL FROM PUBLIC e anon; GRANT EXECUTE
-- para authenticated e service_role; acesso do owner preservado
-- (postgres, como superusuário/owner, nunca precisa de GRANT
-- explícito para executar suas próprias functions).
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.escalate_sla_action(uuid, text, text, text)') is null then
    raise exception 'Assinatura esperada não encontrada: public.escalate_sla_action(uuid, text, text, text) — migration abortada.';
  end if;
end $$;

create or replace function public.escalate_sla_action(p_action_id uuid, p_expected_current_level text, p_new_level text, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
$function$;

-- Reasserção explícita — não apenas confiada à preservação
-- automática do CREATE OR REPLACE acima.
alter function public.escalate_sla_action(uuid, text, text, text) owner to postgres;

revoke all on function public.escalate_sla_action(uuid, text, text, text) from public;
revoke all on function public.escalate_sla_action(uuid, text, text, text) from anon;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to authenticated;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'escalate_sla_action'
      and p.prosecdef = true
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) cfg where cfg = 'search_path=""')
  ) then
    raise exception 'Reasserção pós-migration falhou: escalate_sla_action não está com owner=postgres/SECURITY DEFINER/search_path='''' — migration abortada.';
  end if;
end $$;

commit;

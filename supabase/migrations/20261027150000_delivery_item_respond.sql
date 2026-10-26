-- ============================================================
-- 20261027150000_delivery_item_respond.sql
-- Ações do ALERTA de providência (RESOLVIDO / EM ANDAMENTO / ENVIADO P/), com confirmação explícita
-- na página do ACC, sobre o MESMO registro da tabela de providências e do acompanhamento recorrente.
--
-- PROPOSTA — NÃO APLICADA. Aditiva (uma função nova). Depende de 20261027120000 e 20261027130000.
--
-- Quem pode agir: o responsável atual do alerta (acompanhamento aberto), o responsável da
-- providência ou um gestor/gerente/administrador da obra. Regras:
--   - EM ANDAMENTO: a providência passa a EM_ANDAMENTO (se estava pendente); o acompanhamento
--     recorrente continua e o calendário NÃO muda;
--   - ENVIADO P/: troca o responsável da providência (colaborador ATIVO da obra) e encaminha o
--     acompanhamento, sem concluir e sem reiniciar o prazo;
--   - RESOLVIDO: é a CONCLUSÃO da providência — exige confirmação de gestor/gerente/administrador
--     e evidência ou justificativa (as mesmas regras da tabela); resolve o acompanhamento. Um
--     colaborador sem essa autoridade recebe a orientação de usar EM ANDAMENTO ou ENVIADO P/.
-- ============================================================

create or replace function public.delivery_item_respond(
  p_item_id uuid,
  p_action text,
  p_assigned_user_id uuid default null,
  p_justification text default null,
  p_evidence text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.project_delivery_items%rowtype;
  v_follow public.alert_followups%rowtype;
  v_can_conclude boolean;
  v_evidence text;
  v_justification text;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;
  if coalesce(p_action, '') not in ('RESOLVIDO', 'EM_ANDAMENTO', 'ENVIADO_PARA') then raise exception 'Ação inválida.'; end if;

  select * into v_item from public.project_delivery_items where id = p_item_id for update;
  if not found then raise exception 'Providência não encontrada.'; end if;

  select * into v_follow
  from public.alert_followups
  where project_id = v_item.project_id and source_type = 'DELIVERY_ITEM' and source_id = p_item_id and status = 'OPEN';

  v_can_conclude := public.has_project_permission(v_item.project_id, 'GESTOR');

  -- coalesce(..., false): sem responsável a comparação é NULL e `not (false or null or false)` seria
  -- NULL (tratado como "não recusar") — sem isso um usuário de OUTRA obra passaria quando a
  -- providência ainda não tem responsável.
  if not (
    v_can_conclude
    or coalesce(v_item.responsible_user_id = v_actor, false)
    or coalesce(v_follow.responsible_user_id = v_actor, false)
  ) then
    raise exception 'Você não tem permissão para agir sobre esta providência.';
  end if;

  if v_item.status in ('CONCLUIDO', 'NAO_APLICAVEL') then
    raise exception 'Esta providência já está encerrada.';
  end if;

  if p_action = 'EM_ANDAMENTO' then
    if v_item.status = 'PENDENTE' then
      update public.project_delivery_items set status = 'EM_ANDAMENTO' where id = p_item_id;
      insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
      values (p_item_id, v_item.project_id, 'STATUS', v_actor, 'PENDENTE → EM_ANDAMENTO (confirmado no alerta)');
    end if;
    if v_follow.id is not null then
      update public.alert_followups
      set in_progress = true, in_progress_at = coalesce(in_progress_at, now()), in_progress_by_user_id = coalesce(in_progress_by_user_id, v_actor)
      where id = v_follow.id;
      insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id)
      values (v_follow.id, v_follow.project_id, 'IN_PROGRESS_CONFIRMED', v_actor);
    end if;

  elsif p_action = 'ENVIADO_PARA' then
    if p_assigned_user_id is null then raise exception 'Selecione um colaborador.'; end if;
    if p_assigned_user_id = coalesce(v_follow.responsible_user_id, v_item.responsible_user_id) then
      raise exception 'O alerta já está com este responsável.';
    end if;
    if not exists (
      select 1 from public.project_memberships pm
      where pm.project_id = v_item.project_id and pm.user_id = p_assigned_user_id and pm.status = 'ACTIVE'
    ) then
      raise exception 'O destinatário precisa ser um colaborador ativo vinculado à obra.';
    end if;
    update public.project_delivery_items set responsible_user_id = p_assigned_user_id where id = p_item_id;
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    values (p_item_id, v_item.project_id, 'FIELD', v_actor, 'Responsável alterado (ENVIADO P/ confirmado no alerta).');
    if v_follow.id is not null then
      update public.alert_followups set responsible_user_id = p_assigned_user_id where id = v_follow.id;
      insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id, from_user_id, to_user_id)
      values (v_follow.id, v_follow.project_id, 'FORWARDED', v_actor, v_follow.responsible_user_id, p_assigned_user_id);
    end if;

  else -- RESOLVIDO = conclusão da providência
    if not v_can_conclude then
      raise exception 'Concluir exige confirmação de um usuário autorizado (gestor, gerente ou administrador). Use EM ANDAMENTO ou ENVIADO P/ para encaminhar a um gestor.';
    end if;
    v_evidence := coalesce(nullif(btrim(p_evidence), ''), v_item.evidence);
    v_justification := coalesce(nullif(btrim(p_justification), ''), v_item.justification);
    if v_evidence is null and nullif(btrim(p_justification), '') is null then
      raise exception 'Concluir exige evidência/documento/protocolo ou uma justificativa.';
    end if;
    update public.project_delivery_items
    set status = 'CONCLUIDO', evidence = v_evidence, justification = v_justification, concluded_at = now(), concluded_by_user_id = v_actor
    where id = p_item_id;
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    values (p_item_id, v_item.project_id, 'STATUS', v_actor,
            v_item.status || ' → CONCLUIDO (confirmado no alerta)' || coalesce(': ' || nullif(btrim(p_justification), ''), ''));
    if v_follow.id is not null then
      update public.alert_followups
      set status = 'RESOLVED', next_reminder_at = null, claim_token = null, claimed_until = null,
          resolved_at = now(), resolved_by_user_id = v_actor
      where id = v_follow.id;
      insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id)
      values (v_follow.id, v_follow.project_id, 'RESOLVED', v_actor);
    end if;
  end if;
end;
$$;

revoke all on function public.delivery_item_respond(uuid, text, uuid, text, text) from public;
grant execute on function public.delivery_item_respond(uuid, text, uuid, text, text) to authenticated;

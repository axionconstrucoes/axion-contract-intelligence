-- ============================================================
-- 20261027140000_alert_batch_partial_responses.sql
-- Resposta PARCIAL de lote de alertas de contrato: cada ação confirmada é salva na hora.
--
-- PROPOSTA — NÃO APLICADA. Aditiva (uma função nova); não altera tabelas nem a função
-- submit_contract_alert_batch_response (20260921130000), que continua sendo a resposta FINAL
-- atômica e só é aceita com TODOS os alertas respondidos.
--
-- Regras:
--   - salvar uma ação grava só o item escolhido; os demais permanecem como estão (pendentes);
--   - EM ANDAMENTO e ENVIADO P/ contam como resposta ao lote, mas NÃO como resolução (o
--     acompanhamento recorrente continua até RESOLVIDO — ver 20261027120000);
--   - ENVIADO P/ exige colaborador ATIVO da obra;
--   - só o destinatário do lote ou um ADMINISTRADOR da obra salva; lote já respondido/falho não;
--   - idempotente: repetir a mesma ação não duplica nada (a auditoria registra cada confirmação);
--   - o mesmo alerta pendente em OUTRO lote aberto da mesma obra recebe a mesma ação (o lembrete
--     antigo não fica como pendência órfã).
-- ============================================================

create or replace function public.save_contract_alert_batch_item_response(
  p_batch_id uuid,
  p_event_id uuid,
  p_action text,
  p_assigned_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_batch public.contract_alert_batches%rowtype;
  v_item public.contract_alert_batch_items%rowtype;
  v_assigned uuid;
  v_total integer;
  v_answered integer;
begin
  if v_actor_id is null then
    raise exception 'Sessão expirada. Faça login novamente.';
  end if;

  if coalesce(p_action, '') not in ('RESOLVIDO', 'EM_ANDAMENTO', 'ENVIADO_PARA') then
    raise exception 'Ação inválida.';
  end if;

  select * into v_batch from public.contract_alert_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Lote de alertas não encontrado.';
  end if;

  if v_batch.recipient_user_id <> v_actor_id
     and not public.has_project_permission(v_batch.project_id, 'ADMINISTRADOR') then
    raise exception 'Você não tem permissão para responder este lote de alertas.';
  end if;

  if v_batch.status = 'RESPONDED' then
    raise exception 'Este lote de alertas já foi respondido.';
  end if;
  if v_batch.status <> 'SENT' then
    raise exception 'Este lote de alertas ainda não está disponível para resposta.';
  end if;

  select * into v_item
  from public.contract_alert_batch_items
  where batch_id = p_batch_id and event_id = p_event_id
  for update;
  if not found then
    raise exception 'O alerta não pertence a este lote.';
  end if;

  if p_action = 'ENVIADO_PARA' then
    v_assigned := p_assigned_user_id;
    if v_assigned is null or not exists (
      select 1 from public.project_memberships pm
      where pm.project_id = v_batch.project_id and pm.user_id = v_assigned and pm.status = 'ACTIVE'
    ) then
      raise exception 'Selecione um colaborador ativo do projeto para o alerta enviado.';
    end if;
  else
    v_assigned := null;
  end if;

  update public.contract_alert_batch_items
  set action = p_action, assigned_user_id = v_assigned, answered_at = now(), answered_by_user_id = v_actor_id
  where id = v_item.id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail
  ) values (
    v_batch.project_id, 'USER', v_actor_id, null,
    'CONTRACT_ALERT_BATCH_ITEM_RESPONDED', 'CONTRACT_EVENT', p_event_id::text,
    format('Alerta de contrato respondido individualmente no lote %s: %s%s (resposta parcial salva). CorrelationId=%s.',
      p_batch_id, p_action,
      case when v_assigned is not null then format(' para %s', v_assigned) else '' end,
      v_batch.correlation_id)
  );

  -- O mesmo alerta ainda sem resposta em OUTRO lote aberto da mesma obra (lembrete anterior)
  -- recebe a mesma ação, para não ficar como pendência órfã.
  update public.contract_alert_batch_items i
  set action = p_action, assigned_user_id = v_assigned, answered_at = now(), answered_by_user_id = v_actor_id
  from public.contract_alert_batches b
  where i.batch_id = b.id
    and b.id <> p_batch_id
    and b.project_id = v_batch.project_id
    and b.status = 'SENT'
    and i.event_id = p_event_id
    and i.action is null;

  select count(*), count(action) into v_total, v_answered
  from public.contract_alert_batch_items where batch_id = p_batch_id;

  return jsonb_build_object('batchId', p_batch_id, 'eventId', p_event_id, 'answered', v_answered, 'total', v_total, 'complete', v_answered = v_total);
end;
$$;

revoke all on function public.save_contract_alert_batch_item_response(uuid, uuid, text, uuid) from public;
grant execute on function public.save_contract_alert_batch_item_response(uuid, uuid, text, uuid) to authenticated;

-- Auditoria de ações SLA quando a mudança vem do WORKER (service_role), sem auth.uid().
--
-- Problema (detectado por teste contra o SQL real): audit_sla_action_updated() grava ACTION_STARTED e
-- ACTION_REASSIGNED com actor_type = 'USER' e actor_user_id = auth.uid(). Quando a transição é aplicada
-- pelo worker (ex.: resposta por e-mail do responsável -> TOMANDO PROVIDÊNCIAS / ENVIAR P/ via
-- record_risk_alert_action), auth.uid() é nulo e o INSERT viola audit_log_entries_check
-- (USER exige actor_user_id): a transação inteira falha e a resposta cai em revisão humana.
--
-- Correção: ator = auth.uid(); se nulo, quem agiu (acknowledged_by_user_id, que a RPC define a partir do
-- usuário identificado na resposta); se ainda nulo, SYSTEM (sem rótulo). Nenhuma outra regra muda.
-- CREATE OR REPLACE sobre a definição vigente (20260822060313); migrations já aplicadas não são editadas.

create or replace function public.audit_sla_action_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_actor uuid := coalesce(auth.uid(), new.acknowledged_by_user_id);
  v_reassign_actor uuid := auth.uid();
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
      new.project_id, case when v_started_actor is null then 'SYSTEM' else 'USER' end, v_started_actor, null,
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
      new.project_id, case when v_reassign_actor is null then 'SYSTEM' else 'USER' end, v_reassign_actor, null,
      'ACTION_REASSIGNED', 'SLA_ACTION', new.id::text,
      format('Ação "%s" reatribuída de %s para %s.', new.title, old.responsible_user_id, coalesce(new.responsible_user_id::text, 'ninguém'))
    );
  end if;

  return new;
end;
$$;

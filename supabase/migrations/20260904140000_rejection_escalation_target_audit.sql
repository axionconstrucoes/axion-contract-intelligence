-- ============================================================
-- 20260904140000_rejection_escalation_target_audit.sql
-- Fecha a Fase 4 do trabalho de escalonamento hierárquico: a ausência
-- de superior configurado (escalation_target_resolved = false) não
-- pode ficar silenciosa.
--
-- O que já existia (checkpoint 2, 20260904130000): a RPC devolvia
-- escalation_target_user_id/escalation_target_resolved ao CALLER, e o
-- dado já era estruturalmente reconstruível via
-- sla_action_escalations.notified_user_id IS NULL. O que faltava: uma
-- evidência de auditoria EXPLÍCITA (não só "ausência de valor"),
-- legível em audit_log_entries sem precisar saber consultar
-- sla_action_escalations.
--
-- CREATE OR REPLACE simples (a assinatura/retorno de
-- reject_relevant_finding NÃO muda nesta migration — só uma linha nova
-- de auditoria condicional é acrescentada ao corpo). Nenhum motor
-- paralelo, nenhuma duplicação: a auditoria continua sendo só
-- audit_log_entries, mesmo mecanismo de sempre.
--
-- CORRIGIDO após revisão estática pré-push: `search_path = ''` (não
-- `public`) — mesmo padrão do restante do projeto, ver nota equivalente
-- em 20260904130000.
-- ============================================================

create or replace function public.reject_relevant_finding(
  p_finding_id uuid,
  p_reviewer_note text,
  p_area text default null,
  p_assume_due_at timestamptz default null,
  p_respond_due_at timestamptz default null,
  p_complete_due_at timestamptz default null
)
returns table (
  sla_action_id uuid,
  escalation_id uuid,
  already_existed boolean,
  escalation_target_user_id uuid,
  escalation_target_resolved boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.ai_findings%rowtype;
  v_reviewer uuid := auth.uid();
  v_needs_escalation boolean;
  v_existing_action_id uuid;
  v_existing_target_user_id uuid;
  v_action_id uuid;
  v_escalation_id uuid;
  v_target_user_id uuid;
begin
  if v_reviewer is null then
    raise exception 'Authentication required';
  end if;

  select * into v_finding
  from public.ai_findings
  where id = p_finding_id
  for update;

  if not found then
    raise exception 'Finding not found';
  end if;

  if not public.has_project_permission(v_finding.project_id, 'EDITOR') then
    raise exception 'Insufficient permission';
  end if;

  -- Idempotência: já rejeitado (chamada repetida — double-click, retry,
  -- refresh, reenvio da Server Action) -> retorna o vínculo já
  -- existente E o superior já resolvido daquela vez, nunca cria uma
  -- segunda sla_action nem reprocessa a justificativa.
  if v_finding.lifecycle_status = 'REJECTED' then
    select sa.id into v_existing_action_id
    from public.sla_actions sa
    where sa.related_ai_finding_id = p_finding_id;

    if v_existing_action_id is not null then
      select sae.notified_user_id into v_existing_target_user_id
      from public.sla_action_escalations sae
      where sae.action_id = v_existing_action_id
      order by sae.escalated_at desc
      limit 1;
    end if;

    return query select
      v_existing_action_id,
      null::uuid,
      true,
      v_existing_target_user_id,
      v_existing_target_user_id is not null;
    return;
  end if;

  v_needs_escalation := v_finding.severity in ('HIGH', 'CRITICAL');

  -- coalesce ANTES do regex é essencial: "NULL !~ '\S'" avalia para NULL
  -- (não TRUE) em SQL, e "IF ... THEN" trata NULL como falso — sem o
  -- coalesce, uma justificativa NULL passaria pela checagem sem erro.
  -- Com coalesce(..., ''), NULL/''/'   ' avaliam todos para TRUE aqui.
  if v_needs_escalation and coalesce(p_reviewer_note, '') !~ '\S' then
    raise exception 'Justificativa obrigatória para rejeitar recomendação de severidade %.', v_finding.severity;
  end if;

  update public.ai_findings
  set
    lifecycle_status = 'REJECTED',
    reviewer_note = p_reviewer_note,
    reviewed_by_user_id = v_reviewer,
    reviewed_at = now(),
    updated_at = now()
  where id = p_finding_id;

  if not v_needs_escalation then
    return query select null::uuid, null::uuid, false, null::uuid, false;
    return;
  end if;

  if p_area is null or p_area not in (
    'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
    'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA'
  ) then
    raise exception 'Área válida é obrigatória para escalonar a rejeição de uma recomendação ALTO/CRÍTICO.';
  end if;

  if p_assume_due_at is null then
    raise exception 'assume_due_at é obrigatório para criar a ação de escalonamento.';
  end if;

  insert into public.sla_actions (
    project_id, origin, related_ai_finding_id, title, description,
    risk_level, area, status, assume_due_at, respond_due_at, complete_due_at,
    created_by_type, created_by_user_id
  )
  values (
    v_finding.project_id, 'AI_FINDING', p_finding_id,
    format('Recomendação rejeitada: %s', v_finding.finding_type),
    format('Finding %s rejeitado (severidade %s). Justificativa: %s', v_finding.id, v_finding.severity, p_reviewer_note),
    v_finding.severity, p_area, 'PENDING',
    p_assume_due_at, p_respond_due_at, p_complete_due_at,
    'USER', v_reviewer
  )
  returning id into v_action_id;

  -- Escalonamento imediato — a rejeição em si é o evento que exige
  -- escalonamento, nunca "esperar o SLA vencer depois" (reutiliza
  -- integralmente escalate_sla_action(), nenhuma lógica de nível/
  -- notificação duplicada aqui).
  v_escalation_id := public.escalate_sla_action(
    v_action_id, 'RESPONSAVEL', 'ESCALAO_1', 'RELEVANT_RECOMMENDATION_REJECTED'
  );

  -- Superior resolvido por escalate_sla_action() a partir de
  -- sla_area_responsibles — lido de volta via a linha de escalonamento
  -- que ele mesmo gravou (nunca recalculado aqui, nunca uma segunda
  -- lógica de resolução de responsável).
  select sae.notified_user_id into v_target_user_id
  from public.sla_action_escalations sae
  where sae.id = v_escalation_id;

  -- NOVO (Fase 4): evidência de auditoria EXPLÍCITA da falha de
  -- configuração — nunca só "o campo ficou NULL". A rejeição e o
  -- escalonamento continuam válidos e registrados (nada é revertido);
  -- esta linha só documenta, de forma legível e pesquisável em
  -- audit_log_entries, que NENHUM responsável foi de fato notificado.
  -- actor_type='SYSTEM' com actor_label=NULL (audit_log_entries exige
  -- actor_label IS NULL quando actor_type='SYSTEM' — mesma correção já
  -- aplicada a escalate_sla_action em 20260822060313, reaproveitada
  -- aqui desde a primeira versão, nunca reintroduzindo aquele bug) —
  -- isto não é uma decisão humana, é o motor constatando uma lacuna de
  -- configuração do projeto.
  if v_target_user_id is null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    )
    values (
      v_finding.project_id, 'SYSTEM', null, null,
      'ESCALATION_TARGET_NOT_CONFIGURED', 'SLA_ACTION', v_action_id::text,
      format(
        'Escalonamento da rejeição do finding %s (severidade %s, área %s) foi criado, mas NENHUM responsável está configurado em sla_area_responsibles.escalation_1_user_id para esta área — ninguém foi notificado. Configure os responsáveis do projeto em /acoes/configuracao.',
        v_finding.id, v_finding.severity, p_area
      )
    );
  end if;

  return query select
    v_action_id,
    v_escalation_id,
    false,
    v_target_user_id,
    v_target_user_id is not null;
end;
$$;

comment on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) is
  'Único caminho de domínio para rejeitar um ai_finding. HIGH/CRITICAL exige justificativa não vazia, cria a sla_action vinculada (origin=AI_FINDING) e escalona imediatamente RESPONSAVEL->ESCALAO_1 via escalate_sla_action(). Idempotente: chamada repetida sobre finding já REJECTED retorna o vínculo existente, nunca duplica. escalation_target_user_id/escalation_target_resolved sinalizam explicitamente se um superior real foi encontrado em sla_area_responsibles — nunca inventa um destinatário quando não há um configurado; quando ausente, grava também um audit_log_entries explícito (ESCALATION_TARGET_NOT_CONFIGURED).';

revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) to authenticated;

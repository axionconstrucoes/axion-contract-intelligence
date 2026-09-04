-- ============================================================
-- 20260904130000_rejection_escalation_governance_hardening.sql
-- Fecha as lacunas comprovadas pela auditoria de
-- 20260904120000_rejection_escalation_governance.sql:
--
--   1. Invariante de banco: hoje um UPDATE direto em ai_findings
--      (severity HIGH/CRITICAL, lifecycle_status REJECTED,
--      reviewer_note válido) passa pela CHECK constraint existente sem
--      nunca precisar criar a sla_action de escalonamento — a garantia
--      de atomicidade era só uma convenção de código (reject_relevant_
--      finding), nunca um invariante estrutural do banco.
--
--   2. Transparência do superior hierárquico: reject_relevant_finding
--      escalona via escalate_sla_action() mas descartava o
--      notified_user_id resolvido — o chamador não conseguia distinguir
--      "escalonamento com superior encontrado" de "escalonamento sem
--      ninguém configurado".
--
-- Não duplica o motor de SLA, não move compute-escalation.ts, não cria
-- segunda arquitetura de escalonamento — só fecha os dois pontos acima
-- em cima do que já existe.
--
-- CORRIGIDO após revisão estática pré-push: todas as funções novas
-- desta migration usavam `search_path = public`, defasado do padrão
-- real do projeto (`search_path = ''`, endurecido para as 38 funções
-- SECURITY DEFINER existentes em
-- 20260830100000_close_security_definer_search_path_gaps.sql). Todo o
-- corpo já era 100% qualificado com `public.` — a correção é só a
-- declaração `set search_path`, sem mudança de lógica.
-- ============================================================

-- ============================================================
-- 1. INVARIANTE DE BANCO — constraint triggers DEFERRABLE INITIALLY
--    DEFERRED (nunca um AFTER trigger imediato)
-- ============================================================
--
-- Por que não um AFTER UPDATE trigger imediato:
-- reject_relevant_finding() faz, na MESMA transação (a chamada de RPC é
-- uma única transação implícita): 1) UPDATE ai_findings (REJECTED) —
-- 2) [se HIGH/CRITICAL] INSERT sla_actions — 3) escalate_sla_action().
-- Um trigger AFTER UPDATE comum dispara imediatamente após o passo 1,
-- ANTES do passo 2 existir — checaria a invariante cedo demais e
-- quebraria a própria chamada legítima da RPC. DEFERRABLE INITIALLY
-- DEFERRED adia a checagem para o fim da transação (COMMIT), quando os
-- passos 1-3 já aconteceram — a chamada legítima passa; um UPDATE
-- direto isolado (sem os passos 2/3) falha ao tentar commitar.
--
-- Helper único, chamado dos dois lados (ai_findings e sla_actions) —
-- nunca duas regras divergentes do mesmo invariante.
--
-- Pré-voo: os novos triggers só validam linhas tocadas por INSERT/
-- UPDATE/DELETE a partir de agora — nunca escaneiam retroativamente
-- dados já existentes. Antes de criá-los, falha alto e cedo se algum
-- dado JÁ existente violar o invariante (nunca instala uma constraint
-- que o próprio banco já descumpre silenciosamente).

do $$
declare
  v_violation record;
begin
  for v_violation in
    select f.id, f.severity
    from public.ai_findings f
    where f.severity in ('HIGH', 'CRITICAL')
      and f.lifecycle_status = 'REJECTED'
      and not exists (select 1 from public.sla_actions sa where sa.related_ai_finding_id = f.id)
  loop
    raise exception
      'Dado pré-existente viola o invariante de governança: finding % (severidade %) está REJECTED sem sla_action vinculada — resolva manualmente antes de aplicar esta migration.',
      v_violation.id, v_violation.severity;
  end loop;
end;
$$;

create or replace function public.assert_high_risk_rejection_has_escalation(p_finding_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.ai_findings%rowtype;
begin
  select * into v_finding from public.ai_findings where id = p_finding_id;

  -- Finding não existe (nunca acontece hoje — sem DELETE em ai_findings
  -- — mas se acontecesse, nada resta para exigir escalonamento).
  if not found then
    return;
  end if;

  if v_finding.severity in ('HIGH', 'CRITICAL') and v_finding.lifecycle_status = 'REJECTED' then
    if not exists (
      select 1 from public.sla_actions where related_ai_finding_id = p_finding_id
    ) then
      raise exception
        'Invariante de governança violado: finding % (severidade %) está REJECTED sem nenhuma sla_action de escalonamento vinculada. Use reject_relevant_finding() — nunca UPDATE direto em ai_findings.lifecycle_status.',
        p_finding_id, v_finding.severity;
    end if;
  end if;
end;
$$;

comment on function public.assert_high_risk_rejection_has_escalation(uuid) is
  'Invariante único: finding HIGH/CRITICAL REJECTED precisa ter ao menos uma sla_action vinculada (related_ai_finding_id). Chamado por constraint triggers DEFERRABLE em ai_findings e sla_actions — nunca duplicar esta regra.';

revoke all on function public.assert_high_risk_rejection_has_escalation(uuid) from public;
revoke all on function public.assert_high_risk_rejection_has_escalation(uuid) from anon;
revoke all on function public.assert_high_risk_rejection_has_escalation(uuid) from authenticated;

-- ---------- lado ai_findings: toda linha nova/alterada é checada ----------

create or replace function public.enforce_high_risk_rejection_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_high_risk_rejection_has_escalation(new.id);
  return null; -- AFTER trigger: valor de retorno é ignorado pelo executor
end;
$$;

comment on function public.enforce_high_risk_rejection_escalation() is
  'Trigger function de public.assert_high_risk_rejection_has_escalation() para INSERT/UPDATE em ai_findings — sempre DEFERRED (ver comentário no topo da migration).';

revoke all on function public.enforce_high_risk_rejection_escalation() from public;
revoke all on function public.enforce_high_risk_rejection_escalation() from anon;
revoke all on function public.enforce_high_risk_rejection_escalation() from authenticated;

drop trigger if exists ai_findings_enforce_rejection_escalation on public.ai_findings;
create constraint trigger ai_findings_enforce_rejection_escalation
after insert or update on public.ai_findings
deferrable initially deferred
for each row
execute function public.enforce_high_risk_rejection_escalation();

-- ---------- lado sla_actions: proteção contra desvincular depois ----------
-- Só dispara quando related_ai_finding_id muda ou a linha é apagada —
-- nunca em toda atualização de sla_actions (assumir/concluir/escalonar
-- não tocam essa coluna, então nunca pagam o custo desta checagem).
-- Hoje sla_actions não tem policy de DELETE para authenticated (só
-- service_role/owner alcançam isso) e a policy de UPDATE não restringe
-- colunas — este trigger fecha ambos os caminhos no nível do banco,
-- nunca só confiando em RLS.

create or replace function public.enforce_sla_action_escalation_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.related_ai_finding_id is not null then
    perform public.assert_high_risk_rejection_has_escalation(old.related_ai_finding_id);
  end if;
  return null;
end;
$$;

comment on function public.enforce_sla_action_escalation_link() is
  'Impede que apagar uma sla_action, ou desvincular related_ai_finding_id dela, deixe um finding HIGH/CRITICAL REJECTED sem nenhuma sla_action de escalonamento — mesmo invariante de assert_high_risk_rejection_has_escalation(), lado sla_actions. Sempre DEFERRED.';

revoke all on function public.enforce_sla_action_escalation_link() from public;
revoke all on function public.enforce_sla_action_escalation_link() from anon;
revoke all on function public.enforce_sla_action_escalation_link() from authenticated;

drop trigger if exists sla_actions_enforce_rejection_escalation_link on public.sla_actions;
create constraint trigger sla_actions_enforce_rejection_escalation_link
after delete or update of related_ai_finding_id on public.sla_actions
deferrable initially deferred
for each row
execute function public.enforce_sla_action_escalation_link();

-- ============================================================
-- 2. TRANSPARÊNCIA DO SUPERIOR HIERÁRQUICO
-- ============================================================
-- reject_relevant_finding precisa mudar de forma de retorno (duas
-- colunas novas) — CREATE OR REPLACE não permite alterar o retorno de
-- uma função existente, por isso DROP + CREATE (mesma identidade de
-- parâmetros, nenhuma mudança de comportamento além do retorno mais
-- rico). Nenhum caller de produção existe ainda além do módulo TS desta
-- mesma branch (atualizado nesta etapa) — sem quebra de compatibilidade
-- real.

drop function if exists public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz);

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
  -- Superior determinado por escalate_sla_action() a partir de
  -- sla_area_responsibles — nunca inventado, nunca hardcoded. NULL
  -- quando a área não tem escalation_1_user_id configurado (ver
  -- escalation_target_resolved para o sinal explícito disso).
  escalation_target_user_id uuid,
  -- true SOMENTE quando escalation_target_user_id foi de fato
  -- resolvido a partir de sla_area_responsibles — nunca apenas "não é
  -- NULL por acidente". false quando não houve escalonamento (LOW/
  -- MEDIUM) OU quando houve escalonamento mas nenhum responsável está
  -- configurado para a área. O sistema nunca afirma que alguém foi
  -- avisado quando este campo é false.
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

  return query select
    v_action_id,
    v_escalation_id,
    false,
    v_target_user_id,
    v_target_user_id is not null;
end;
$$;

comment on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) is
  'Único caminho de domínio para rejeitar um ai_finding. HIGH/CRITICAL exige justificativa não vazia, cria a sla_action vinculada (origin=AI_FINDING) e escalona imediatamente RESPONSAVEL->ESCALAO_1 via escalate_sla_action(). Idempotente: chamada repetida sobre finding já REJECTED retorna o vínculo existente, nunca duplica. escalation_target_user_id/escalation_target_resolved sinalizam explicitamente se um superior real foi encontrado em sla_area_responsibles — nunca inventa um destinatário quando não há um configurado.';

revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) to authenticated;

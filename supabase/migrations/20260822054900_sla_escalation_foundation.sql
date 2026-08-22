-- ============================================================
-- 20260822054900_sla_escalation_foundation.sql
-- Matriz de Criticidade, SLA e Escalonamento — ver
-- docs/sla-escalation.md para a arquitetura completa.
--
-- Mapeamento contra o schema existente ANTES de criar qualquer coisa:
-- action_requests (fundacao existente) modela "solicitação + resposta"
-- (canal APP/EMAIL, assignees N:N, resposta como entidade própria) —
-- não tem risco, área, escalonamento, nível hierárquico nem os três
-- relógios exigidos aqui. NÃO é "estrutura adequada" para o que este
-- requisito pede (seção 6 do requisito só manda reaproveitar SE já
-- houver estrutura adequada) — por isso uma nova entidade (sla_actions)
-- é criada, mas com um vínculo opcional (related_action_request_id) para
-- quando uma Ação SLA nascer de uma ActionRequest existente, nunca
-- duplicando os dados dela. Da mesma forma, related_event_id/
-- related_document_version_id/related_esg_obligation_submission_id
-- reaproveitam contract_events/document_versions/
-- esg_obligation_submissions já existentes — nenhum sistema de evidência
-- novo foi criado; "evidência de conclusão" é sempre uma referência a
-- algo que já existe (ou o texto da observação de conclusão).
--
-- RLS via is_project_member/has_project_permission (identity_foundation),
-- auditoria via trigger SECURITY DEFINER (mesmo padrão de
-- event_notes_foundation.sql / esg_obligations_foundation.sql).
-- ============================================================

-- ============================================================
-- 1. SLA_AREA_RESPONSIBLES — responsáveis por área e escalão (seção 4)
-- ============================================================

create table public.sla_area_responsibles (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  area text not null
    check (area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA'
    )),

  -- Cada nível é opcional (nem todo projeto/área terá os quatro
  -- definidos) — a ausência de um nível é tratada na aplicação, nunca
  -- inventada. Cada usuário referenciado precisa ser membro real do
  -- mesmo projeto (garantido pelas FKs compostas abaixo).
  responsible_direct_user_id uuid,
  escalation_1_user_id uuid,
  escalation_2_user_id uuid,
  board_user_id uuid,

  updated_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, area),

  foreign key (project_id, responsible_direct_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,
  foreign key (project_id, escalation_1_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,
  foreign key (project_id, escalation_2_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,
  foreign key (project_id, board_user_id)
    references public.project_memberships (project_id, user_id) on delete set null
);

create index sla_area_responsibles_project_id_idx
  on public.sla_area_responsibles (project_id);

create or replace function public.set_sla_area_responsibles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sla_area_responsibles_set_updated_at
before update
on public.sla_area_responsibles
for each row
execute function public.set_sla_area_responsibles_updated_at();

-- ============================================================
-- 2. SLA_MATRIX_RULES — matriz configurável por projeto (seção 2/5)
-- ============================================================
-- Sem policy DELETE em nenhuma tabela desta migration abaixo: histórico
-- de configuração é preservado (active=false desativa, nunca apaga —
-- mesmo princípio de esg_obligations.active).

create table public.sla_matrix_rules (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  risk_level text not null
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

  -- null = regra vale para todas as áreas deste projeto/risco, salvo uma
  -- linha mais específica com a mesma área (resolvida na aplicação, ver
  -- apps/web/lib/sla/resolve-matrix-rule.ts).
  area text
    check (area is null or area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA'
    )),

  time_unit text not null
    check (time_unit in ('BUSINESS_HOURS', 'CLOCK_HOURS', 'BUSINESS_DAYS', 'CALENDAR_DAYS')),

  -- Relógio B (SLA interno) — três prazos independentes, todos medidos a
  -- partir de created_at (nunca confundidos com o relógio C).
  assume_deadline_value numeric not null check (assume_deadline_value > 0),
  respond_deadline_value numeric check (respond_deadline_value is null or respond_deadline_value > 0),
  complete_deadline_value numeric check (complete_deadline_value is null or complete_deadline_value > 0),

  -- Relógio C (escalonamento) — tempo SEM AÇÃO necessário para subir de
  -- nível, medido a partir do momento em que o nível anterior venceu sem
  -- ação (nunca a partir de created_at diretamente — ver
  -- apps/web/lib/sla/compute-escalation.ts).
  escalation_2_after_value numeric not null check (escalation_2_after_value > 0),
  board_after_value numeric not null check (board_after_value > 0),

  notify_by_email boolean not null default true,
  requires_acknowledgment_confirmation boolean not null default false,
  requires_delay_justification boolean not null default true,

  is_default boolean not null default false,

  active boolean not null default true,

  updated_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, risk_level, area)
);

create index sla_matrix_rules_project_id_idx
  on public.sla_matrix_rules (project_id, risk_level, active);

create or replace function public.set_sla_matrix_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sla_matrix_rules_set_updated_at
before update
on public.sla_matrix_rules
for each row
execute function public.set_sla_matrix_rules_updated_at();

-- ============================================================
-- 3. SLA_ACTIONS — a Ação/Tarefa sujeita à matriz (seção 6/7)
-- ============================================================

create table public.sla_actions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  origin text not null
    check (origin in (
      'MANUAL', 'EXPERT_RECOMMENDATION', 'ESG_OBLIGATION', 'EVENT',
      'ACTION_REQUEST', 'OTHER'
    )),

  -- Qual Expert sugeriu a ação, quando origin = EXPERT_RECOMMENDATION —
  -- nunca inventado; null para qualquer outra origem.
  origin_expert_id text,

  title text not null check (btrim(title) <> ''),
  description text not null default '',

  risk_level text not null
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

  area text not null
    check (area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA'
    )),

  responsible_user_id uuid,

  status text not null default 'PENDING'
    check (status in (
      'PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED',
      'OVERDUE', 'ESCALATED', 'CANCELLED'
    )),

  -- Nível hierárquico ATUAL — só muda via escalate_sla_action() (RPC
  -- SECURITY DEFINER) ou no INSERT (sempre RESPONSAVEL); protegido contra
  -- UPDATE direto por trigger (ver seção 6 abaixo).
  current_escalation_level text not null default 'RESPONSAVEL'
    check (current_escalation_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),

  -- Relógio A (prazo contratual) — independente do relógio B, nunca
  -- confundido com due_at (que é o prazo de conclusão do relógio B).
  contractual_deadline timestamptz,

  -- Relógio B (SLA interno) — prazos calculados no momento da criação a
  -- partir da matriz resolvida (apps/web/lib/sla/resolve-matrix-rule.ts +
  -- compute-deadline.ts), armazenados aqui para nunca recalcular
  -- "para trás" se a matriz mudar depois.
  assume_due_at timestamptz not null,
  respond_due_at timestamptz,
  complete_due_at timestamptz,

  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid
    references public.profiles (id) on delete restrict,

  completed_at timestamptz,
  completed_by_user_id uuid
    references public.profiles (id) on delete restrict,
  completion_note text,

  -- Vínculos opcionais a entidades já existentes — nunca duplicadas.
  related_event_id uuid
    references public.contract_events (id) on delete set null,
  related_document_version_id uuid
    references public.document_versions (id) on delete set null,
  related_esg_obligation_submission_id uuid
    references public.esg_obligation_submissions (id) on delete set null,
  related_action_request_id uuid
    references public.action_requests (id) on delete set null,

  created_by_type text not null
    check (created_by_type in ('SYSTEM', 'USER')),
  created_by_user_id uuid
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null)
    or (created_by_type = 'USER' and created_by_user_id is not null)
  ),
  check (
    (status = 'COMPLETED') = (completed_at is not null)
  ),
  check (
    (acknowledged_at is null) = (acknowledged_by_user_id is null)
  ),
  check (
    (completed_at is null) = (completed_by_user_id is null)
  ),
  -- "Considerar exigir evidência ou comentário de conclusão para
  -- ALTO/CRÍTICO" (seção 9) — comentário de conclusão sempre obrigatório
  -- quando concluído (mínimo seguro, sem bloquear risco BAIXO/MÉDIO por
  -- uma evidência que pode não fazer sentido para toda ação).
  check (
    completed_at is null or nullif(trim(coalesce(completion_note, '')), '') is not null
  ),
  check (
    origin = 'EXPERT_RECOMMENDATION' or origin_expert_id is null
  ),

  foreign key (project_id, responsible_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,
  foreign key (project_id, acknowledged_by_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,
  foreign key (project_id, completed_by_user_id)
    references public.project_memberships (project_id, user_id) on delete set null,

  constraint sla_actions_id_project_id_key unique (id, project_id)
);

create index sla_actions_project_id_status_idx
  on public.sla_actions (project_id, status);

create index sla_actions_project_id_risk_level_idx
  on public.sla_actions (project_id, risk_level);

create index sla_actions_responsible_user_id_idx
  on public.sla_actions (responsible_user_id)
  where responsible_user_id is not null;

create index sla_actions_assume_due_at_idx
  on public.sla_actions (project_id, assume_due_at)
  where status in ('PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS');

create or replace function public.set_sla_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sla_actions_set_updated_at
before update
on public.sla_actions
for each row
execute function public.set_sla_actions_updated_at();

-- Protege current_escalation_level contra alteração direta — só a RPC
-- escalate_sla_action() (que liga acc.allow_escalation_update antes do
-- UPDATE) pode mudar este campo. Mesma técnica de "flag de sessão" usada
-- para nenhuma outra tabela neste projeto até agora — documentada aqui
-- porque é a única forma limpa de impedir um UPDATE comum (mesmo de
-- ADMIN) de pular o registro de auditoria/histórico de escalonamento.
create or replace function public.protect_sla_action_escalation_level()
returns trigger
language plpgsql
as $$
begin
  if new.current_escalation_level is distinct from old.current_escalation_level
     and coalesce(current_setting('acc.allow_escalation_update', true), '') <> 'true' then
    raise exception 'current_escalation_level só pode ser alterado via escalate_sla_action()';
  end if;
  return new;
end;
$$;

create trigger sla_actions_protect_escalation_level
before update
on public.sla_actions
for each row
execute function public.protect_sla_action_escalation_level();

-- ============================================================
-- 4. SLA_ACTION_ESCALATIONS — histórico append-only (seção 10/11)
-- ============================================================

create table public.sla_action_escalations (
  id uuid primary key default gen_random_uuid(),

  action_id uuid not null
    references public.sla_actions (id) on delete cascade,

  project_id uuid not null
    references public.projects (id) on delete cascade,

  from_level text not null
    check (from_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),
  to_level text not null
    check (to_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),

  reason text not null
    check (reason in (
      'NO_ACKNOWLEDGMENT', 'NOT_RESPONDED', 'NOT_COMPLETED',
      'CONTRACTUAL_DEADLINE_NEAR', 'CONTRACTUAL_DEADLINE_MISSED',
      'NEW_EVIDENCE_INCREASED_RISK'
    )),

  notified_user_id uuid
    references public.profiles (id) on delete restrict,

  escalated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index sla_action_escalations_action_id_idx
  on public.sla_action_escalations (action_id, escalated_at desc);

-- ============================================================
-- 5. RLS
-- ============================================================

alter table public.sla_area_responsibles enable row level security;
alter table public.sla_matrix_rules enable row level security;
alter table public.sla_actions enable row level security;
alter table public.sla_action_escalations enable row level security;

create policy "sla_area_responsibles_select_project_members_only"
  on public.sla_area_responsibles
  for select
  using (public.is_project_member(project_id));

create policy "sla_area_responsibles_write_admin_only"
  on public.sla_area_responsibles
  for all
  to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'))
  with check (
    updated_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'ADMIN')
  );

create policy "sla_matrix_rules_select_project_members_only"
  on public.sla_matrix_rules
  for select
  using (public.is_project_member(project_id));

create policy "sla_matrix_rules_write_admin_only"
  on public.sla_matrix_rules
  for all
  to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'))
  with check (
    updated_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'ADMIN')
  );

create policy "sla_actions_select_project_members_only"
  on public.sla_actions
  for select
  using (public.is_project_member(project_id));

-- Criar uma ação exige EDITOR — mesmo nível de quem já pode registrar
-- documento/anotação/comprovação neste projeto.
create policy "sla_actions_insert_editor"
  on public.sla_actions
  for insert
  to authenticated
  with check (
    (created_by_type = 'USER' and created_by_user_id = auth.uid())
    and public.has_project_permission(project_id, 'EDITOR')
  );

-- UPDATE: o próprio responsável (EDITOR) pode assumir/concluir a
-- própria ação; ADMIN pode reatribuir/ajustar qualquer ação do projeto.
-- current_escalation_level continua protegido pelo trigger acima,
-- independente desta policy.
create policy "sla_actions_update_own_or_admin"
  on public.sla_actions
  for update
  to authenticated
  using (
    (responsible_user_id = auth.uid() and public.has_project_permission(project_id, 'EDITOR'))
    or public.has_project_permission(project_id, 'ADMIN')
  )
  with check (
    (responsible_user_id = auth.uid() and public.has_project_permission(project_id, 'EDITOR'))
    or public.has_project_permission(project_id, 'ADMIN')
  );

create policy "sla_action_escalations_select_project_members_only"
  on public.sla_action_escalations
  for select
  using (public.is_project_member(project_id));

-- Nenhuma policy INSERT/UPDATE/DELETE para sla_action_escalations —
-- append-only, escrito somente por escalate_sla_action() (SECURITY
-- DEFINER, seção 7 abaixo).

-- ============================================================
-- 6. AUDITORIA (trigger-based, mesmo padrão do restante do projeto)
-- ============================================================

create or replace function public.audit_sla_action_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail, occurred_at
  )
  values (
    new.project_id,
    case when new.created_by_type = 'SYSTEM' then 'SYSTEM' else 'USER' end,
    new.created_by_user_id, null,
    'ACTION_CREATED', 'SLA_ACTION', new.id::text,
    format('Ação "%s" criada (risco %s, área %s, origem %s).', new.title, new.risk_level, new.area, new.origin),
    new.created_at
  );
  return new;
end;
$$;

create trigger sla_actions_audit_created
after insert
on public.sla_actions
for each row
execute function public.audit_sla_action_created();

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

create trigger sla_actions_audit_updated
after update
on public.sla_actions
for each row
execute function public.audit_sla_action_updated();

-- ============================================================
-- 7. ESCALATE_SLA_ACTION — único caminho para subir de nível (seção 10)
-- ============================================================
-- Concorrência otimista: p_expected_current_level precisa bater com o
-- nível atual, senão a chamada falha sem efeito — isso é o que impede
-- escalonamento duplicado quando o motor roda mais de uma vez sobre a
-- mesma ação (seção "não duplicar escalonamento").

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

revoke all on function public.escalate_sla_action(uuid, text, text, text) from public;
revoke all on function public.escalate_sla_action(uuid, text, text, text) from anon;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to authenticated;

-- ============================================================
-- 8. SLA_CONFIGURATION_UPDATED — auditoria da matriz/responsáveis
-- ============================================================

create or replace function public.audit_sla_configuration_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_detail text;
begin
  v_project_id := coalesce(new.project_id, old.project_id);

  if tg_table_name = 'sla_matrix_rules' then
    v_detail := format('Regra de matriz SLA (risco %s) atualizada.', coalesce(new.risk_level, old.risk_level));
  else
    v_detail := format('Responsáveis da área %s atualizados.', coalesce(new.area, old.area));
  end if;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_project_id, 'USER', auth.uid(), null,
    'SLA_CONFIGURATION_UPDATED', tg_table_name, coalesce(new.id, old.id)::text,
    v_detail
  );

  return coalesce(new, old);
end;
$$;

create trigger sla_matrix_rules_audit_change
after insert or update
on public.sla_matrix_rules
for each row
execute function public.audit_sla_configuration_updated();

create trigger sla_area_responsibles_audit_change
after insert or update
on public.sla_area_responsibles
for each row
execute function public.audit_sla_configuration_updated();

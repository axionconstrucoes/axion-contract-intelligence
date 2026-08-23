-- ============================================================
-- 20260823070000_additional_proposal_lifecycle.sql
-- Fundação de "Propostas de Adicionais" (project_additional_proposals) +
-- vínculos polimórficos (project_additional_proposal_links), usados TANTO
-- para a origem da proposta (Fonte C — documento/e-mail/anexo/evento
-- existente) QUANTO para o checklist documental exigido ao marcar
-- CONTRATADO — mesma tabela, diferenciada por link_role, para nunca
-- duplicar o mesmo tipo de vínculo polimórfico em duas tabelas paralelas.
--
-- Governança: IA nunca pode marcar CONTRATADO/NÃO CONTRATADO, aprovar
-- preço/prazo, ou escrever nesta tabela — só humano, via RLS
-- (insert/update exigem EDITOR + auth.uid() como autor; sem policy de
-- delete, mesmo princípio de trilha de auditoria append-only já usado em
-- todo o projeto). scope_approval_status, commercial_approval_status,
-- schedule_extension_status e execution_status permanecem INDEPENDENTES
-- — nunca inferir que CONTRATADO implica PRAZO APROVADO.
-- ============================================================

create table public.project_additional_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  proposal_number text not null,
  title text not null,
  description text not null default '',

  source_type text not null check (source_type in ('DRIVE', 'MANUAL', 'EXISTING')),
  drive_url text,
  drive_file_id text,

  proposal_date date,
  proposed_value numeric(14, 2),
  note text,

  status text not null default 'POSSIBLE_ADDITIONAL'
    check (status in ('POSSIBLE_ADDITIONAL', 'UNDER_ANALYSIS', 'IN_NEGOTIATION', 'CONTRACTED', 'NOT_CONTRACTED', 'CANCELLED')),

  -- Seção "APROVAÇÕES INDEPENDENTES" — nunca inferidas umas das outras.
  scope_approval_status text not null default 'NOT_EVALUATED'
    check (scope_approval_status in ('NOT_EVALUATED', 'NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  commercial_approval_status text not null default 'NOT_EVALUATED'
    check (commercial_approval_status in ('NOT_EVALUATED', 'NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  schedule_extension_status text not null default 'NOT_EVALUATED'
    check (schedule_extension_status in ('NOT_EVALUATED', 'NOT_REQUIRED', 'TO_BE_REQUESTED', 'REQUESTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED')),
  execution_status text not null default 'NOT_STARTED'
    check (execution_status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),

  -- Preenchidos somente quando status = CONTRATADO (ver check abaixo).
  contracted_at timestamptz,
  contracted_value numeric(14, 2),
  formalization_type text
    check (formalization_type in ('ADITIVO_CONTRATUAL', 'EMAIL_APROVACAO', 'ORDEM_COMPRA_PO', 'ORDEM_SERVICO', 'CARTA_AUTORIZACAO_FORMAL', 'ATA_REGISTRO_FORMAL_ACEITO', 'OUTRO', 'NAO_IDENTIFICADO')),
  approval_evidence_note text,
  execution_started boolean,
  contracted_note text,

  -- "CONTRATADO — FORMALIZAÇÃO COM RESSALVA": nunca bloqueia a
  -- contratação já ocorrida só porque a forma exigida pelo contrato-base
  -- (ex.: aditivo assinado) não foi a forma real usada (ex.: e-mail).
  documental_state text
    check (documental_state in ('CONTRATADO_DOCUMENTACAO_COMPLETA', 'CONTRATADO_DOCUMENTACAO_PENDENTE', 'CONTRATADO_FORMALIZACAO_COM_RESSALVA')),
  reservation_conflicting_clause text,
  reservation_risk text,
  reservation_recommendation text,

  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (btrim(proposal_number) <> ''),
  check (btrim(title) <> ''),
  check (source_type <> 'DRIVE' or drive_url is not null or drive_file_id is not null),
  check (
    status = 'CONTRACTED'
    or (contracted_at is null and contracted_value is null and formalization_type is null and documental_state is null)
  )
);

comment on table public.project_additional_proposals is
  'Propostas de adicionais (escopo/preço/prazo) rastreadas por projeto — origem Drive, manual ou fonte já existente no ACC. IA nunca escreve aqui (ver RLS); marcar CONTRATADO/NÃO CONTRATADO é sempre ação humana.';

create index project_additional_proposals_project_id_idx
  on public.project_additional_proposals (project_id);
create index project_additional_proposals_project_id_status_idx
  on public.project_additional_proposals (project_id, status);

-- Sem trigger para updated_at (nenhuma tabela do projeto usa esse padrão
-- — ver sla_actions/esg_obligations): cada UPDATE do Server Action grava
-- updated_at explicitamente.

-- ---------- project_additional_proposal_links ----------
-- Vínculo polimórfico a exatamente UMA fonte (documento/e-mail/anexo/
-- evento) por linha — nunca duas ao mesmo tempo (mesmo princípio de
-- num_nonnulls já usado em event_evidence). link_role distingue:
--  - ORIGIN_SOURCE: como a proposta chegou ao ACC (Fonte C), nunca
--    NAO_APLICAVEL (é sempre uma referência real quando existe).
--  - EVIDENCIA_CONTRATACAO / PROPOSTA_FINAL_AXION / CRONOGRAMA_IMPACTO /
--    EVIDENCIA_VALOR / EVIDENCIA_PRAZO / ESCOPO_PROJETO: itens do
--    checklist documental exigido ao marcar CONTRATADO — cada um pode
--    ser marcado NAO_APLICAVEL com justificativa, em vez de bloquear a
--    contratação por falta de upload.
create table public.project_additional_proposal_links (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.project_additional_proposals (id) on delete cascade,

  link_role text not null check (
    link_role in ('ORIGIN_SOURCE', 'EVIDENCIA_CONTRATACAO', 'PROPOSTA_FINAL_AXION', 'CRONOGRAMA_IMPACTO', 'EVIDENCIA_VALOR', 'EVIDENCIA_PRAZO', 'ESCOPO_PROJETO')
  ),

  document_version_id uuid references public.document_versions (id) on delete restrict,
  email_id uuid references public.emails (id) on delete restrict,
  email_attachment_id uuid references public.email_attachments (id) on delete restrict,
  event_id uuid references public.contract_events (id) on delete restrict,

  not_applicable boolean not null default false,
  not_applicable_justification text,
  note text,

  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (link_role <> 'ORIGIN_SOURCE' or not_applicable = false),
  check (
    num_nonnulls(document_version_id, email_id, email_attachment_id, event_id)
    = case when not_applicable then 0 else 1 end
  ),
  check (not not_applicable or btrim(coalesce(not_applicable_justification, '')) <> '')
);

comment on table public.project_additional_proposal_links is
  'Vínculo polimórfico de uma proposta a document_versions/emails/email_attachments/contract_events — origem (ORIGIN_SOURCE) ou item do checklist de contratação. NAO_APLICAVEL exige justificativa, nunca bloqueia silenciosamente.';

create index project_additional_proposal_links_proposal_id_idx
  on public.project_additional_proposal_links (proposal_id);
create index project_additional_proposal_links_document_version_id_idx
  on public.project_additional_proposal_links (document_version_id) where document_version_id is not null;
create index project_additional_proposal_links_email_id_idx
  on public.project_additional_proposal_links (email_id) where email_id is not null;
create index project_additional_proposal_links_email_attachment_id_idx
  on public.project_additional_proposal_links (email_attachment_id) where email_attachment_id is not null;
create index project_additional_proposal_links_event_id_idx
  on public.project_additional_proposal_links (event_id) where event_id is not null;

-- ---------- RLS ----------

alter table public.project_additional_proposals enable row level security;
alter table public.project_additional_proposal_links enable row level security;

create policy "project_additional_proposals_select_project_members_only"
  on public.project_additional_proposals
  for select
  using (public.is_project_member(project_id));

-- Criar uma proposta exige EDITOR — mesmo nível de quem já pode registrar
-- documento/anotação/ação neste projeto.
create policy "project_additional_proposals_insert_editor"
  on public.project_additional_proposals
  for insert
  to authenticated
  with check (
    (created_by_type = 'USER' and created_by_user_id = auth.uid())
    and public.has_project_permission(project_id, 'EDITOR')
  );

-- UPDATE cobre toda a evolução de status (incluindo "Marcar como
-- CONTRATADO") — sempre EDITOR, sempre humano autenticado (RLS nunca é
-- bypassada por nenhuma função de IA, que só usa o client service-role
-- somente-leitura). Sem policy de DELETE — histórico de proposta nunca é
-- apagado.
create policy "project_additional_proposals_update_editor"
  on public.project_additional_proposals
  for update
  to authenticated
  using (public.has_project_permission(project_id, 'EDITOR'))
  with check (public.has_project_permission(project_id, 'EDITOR'));

create policy "project_additional_proposal_links_select_project_members_only"
  on public.project_additional_proposal_links
  for select
  using (
    exists (
      select 1
      from public.project_additional_proposals p
      where p.id = project_additional_proposal_links.proposal_id
        and public.is_project_member(p.project_id)
    )
  );

create policy "project_additional_proposal_links_insert_editor"
  on public.project_additional_proposal_links
  for insert
  to authenticated
  with check (
    (created_by_type = 'USER' and created_by_user_id = auth.uid())
    and exists (
      select 1
      from public.project_additional_proposals p
      where p.id = project_additional_proposal_links.proposal_id
        and public.has_project_permission(p.project_id, 'EDITOR')
    )
  );

-- Sem UPDATE/DELETE em links: um vínculo incorreto é substituído por um
-- novo registro (ex.: promover de NAO_APLICAVEL para uma referência
-- real), nunca editado silenciosamente — preserva rastreabilidade.

-- ---------- Auditoria ----------
-- PROJECT_ADDITIONAL_PROPOSAL_CREATED / _STATUS_CHANGED / _CONTRACTED /
-- _LINKED / DOCUMENT_LINKED — sempre metadata compacta (nunca o texto
-- integral de description/note), via trigger SECURITY DEFINER (mesmo
-- padrão de audit_timeline_export_created).

create or replace function public.audit_additional_proposal_created()
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
    new.created_by_type,
    new.created_by_user_id,
    new.created_by_label,
    'PROJECT_ADDITIONAL_PROPOSAL_CREATED',
    'PROJECT_ADDITIONAL_PROPOSAL',
    new.id::text,
    format('Proposta de adicional criada: %s (origem %s, status %s).', new.proposal_number, new.source_type, new.status),
    new.created_at
  );
  return new;
end;
$$;

create trigger project_additional_proposals_audit_created
  after insert on public.project_additional_proposals
  for each row execute function public.audit_additional_proposal_created();

create or replace function public.audit_additional_proposal_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.project_id,
      case when v_actor_user_id is null then 'SYSTEM' else 'USER' end,
      v_actor_user_id,
      null,
      case when new.status = 'CONTRACTED' then 'PROJECT_ADDITIONAL_PROPOSAL_CONTRACTED' else 'PROJECT_ADDITIONAL_PROPOSAL_STATUS_CHANGED' end,
      'PROJECT_ADDITIONAL_PROPOSAL',
      new.id::text,
      format('Proposta %s: status %s -> %s.', new.proposal_number, old.status, new.status),
      now()
    );
  end if;
  return new;
end;
$$;

create trigger project_additional_proposals_audit_updated
  after update on public.project_additional_proposals
  for each row execute function public.audit_additional_proposal_updated();

create or replace function public.audit_additional_proposal_linked()
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
  select
    p.project_id,
    new.created_by_type,
    new.created_by_user_id,
    new.created_by_label,
    case when new.link_role = 'ORIGIN_SOURCE' then 'PROJECT_ADDITIONAL_PROPOSAL_LINKED' else 'PROJECT_ADDITIONAL_DOCUMENT_LINKED' end,
    'PROJECT_ADDITIONAL_PROPOSAL_LINK',
    new.id::text,
    format('Vínculo %s na proposta %s (não aplicável: %s).', new.link_role, new.proposal_id, new.not_applicable),
    new.created_at
  from public.project_additional_proposals p
  where p.id = new.proposal_id;
  return new;
end;
$$;

create trigger project_additional_proposal_links_audit_created
  after insert on public.project_additional_proposal_links
  for each row execute function public.audit_additional_proposal_linked();

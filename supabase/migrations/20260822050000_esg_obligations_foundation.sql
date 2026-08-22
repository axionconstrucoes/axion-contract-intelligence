-- ============================================================
-- 20260822050000_esg_obligations_foundation.sql
-- Comprovação de Obrigações ESG/SSMA — escopo estritamente contratual:
-- OBRIGAÇÃO → PRAZO → COMPROVAÇÃO → EVIDÊNCIA → STATUS → RISCO DE
-- PENALIDADE → AÇÃO RECOMENDADA. Não é um sistema de ESG corporativo nem
-- de gestão operacional de segurança do trabalho.
--
-- Três entidades novas (mapeadas contra o schema existente antes de
-- criar qualquer coisa — nada aqui duplica documents/document_versions/
-- clauses/contract_events/event_notes/audit_log_entries):
--
--   esg_obligations            checklist configurável por projeto
--   esg_obligation_submissions comprovação (uma linha por período/registro)
--   esg_obligation_evidence    arquivos anexados a uma comprovação
--
-- Evidências reaproveitam o bucket 'project-documents' já existente
-- (mesmo bucket de documentos) e suas policies de storage.objects já
-- existentes (20260821004108_project_document_upload_foundation.sql) —
-- essas policies só checam bucket_id e se o primeiro segmento do path é
-- um project_id do qual o usuário é membro/EDITOR, então nenhuma policy
-- nova de storage é necessária aqui, só a convenção de path
-- "<projectId>/esg-evidence/<obligationId>/<submissionId>/<evidenceId>-<nome>".
--
-- RLS/auditoria seguem exatamente o padrão já validado do projeto:
-- is_project_member/has_project_permission (identity_foundation),
-- trigger SECURITY DEFINER para auditoria (mesmo padrão de
-- event_notes_foundation), e uma RPC SECURITY DEFINER só para a ação
-- sensível de revisão (mesmo padrão de
-- review_event_clause_confrontation_candidate).
-- ============================================================


-- ============================================================
-- 1. ESG_OBLIGATIONS — checklist configurável por projeto
-- ============================================================

create table public.esg_obligations (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  title text not null
    check (nullif(trim(title), '') is not null),

  category text not null
    check (category in (
      'DDS',
      'INTEGRACAO_SEGURANCA',
      'TREINAMENTO',
      'INSPECAO',
      'RELATORIO',
      'DOCUMENTACAO_TERCEIROS',
      'REGISTRO_ACIDENTE_INCIDENTE',
      'DESTINACAO_RESIDUOS',
      'COMPROVANTE_AMBIENTAL',
      'LICENCA',
      'CERTIFICADO',
      'PERMISSAO',
      'ENTREGA_EPI',
      'DOCUMENTO_CLIENTE',
      'FOTO_CAMPO',
      'OUTRO'
    )),

  description text,

  -- Origem contratual (seção 11) — nunca obrigatório um FK estruturado:
  -- source_reference é o fallback em texto livre quando a obrigação vem
  -- de um anexo/edital/RFI/RFP sem cláusula numerada extraída no sistema.
  source_document_version_id uuid
    references public.document_versions (id) on delete set null,

  clause_id uuid
    references public.clauses (id) on delete set null,

  source_reference text,

  responsible_user_id uuid
    references public.profiles (id) on delete set null,

  responsible_label text,

  periodicity text not null
    check (periodicity in (
      'UNICA', 'DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL',
      'POR_EVENTO', 'POR_MARCO', 'PERSONALIZADA'
    )),

  required_evidence_description text,

  penalty_description text,

  active boolean not null default true,

  created_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index esg_obligations_project_id_idx
  on public.esg_obligations (project_id, active);

create index esg_obligations_clause_id_idx
  on public.esg_obligations (clause_id)
  where clause_id is not null;

create or replace function public.set_esg_obligations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger esg_obligations_set_updated_at
before update
on public.esg_obligations
for each row
execute function public.set_esg_obligations_updated_at();

-- Garante que cláusula/documento-fonte, quando informados, pertencem ao
-- mesmo projeto da obrigação — mesmo padrão de
-- validate_event_clause_same_project (event_clause_confrontation_foundation).
create or replace function public.validate_esg_obligation_same_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_project_id uuid;
  v_clause_project_id uuid;
begin
  if new.source_document_version_id is not null then
    select d.project_id
    into v_document_project_id
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = new.source_document_version_id;

    if v_document_project_id is null then
      raise exception 'Source document version not found';
    end if;

    if v_document_project_id <> new.project_id then
      raise exception 'Source document version belongs to another project';
    end if;
  end if;

  if new.clause_id is not null then
    select d.project_id
    into v_clause_project_id
    from public.clauses c
    join public.document_versions dv on dv.id = c.document_version_id
    join public.documents d on d.id = dv.document_id
    where c.id = new.clause_id;

    if v_clause_project_id is null then
      raise exception 'Clause not found';
    end if;

    if v_clause_project_id <> new.project_id then
      raise exception 'Clause belongs to another project';
    end if;
  end if;

  return new;
end;
$$;

create trigger esg_obligations_validate_project
before insert or update of project_id, source_document_version_id, clause_id
on public.esg_obligations
for each row
execute function public.validate_esg_obligation_same_project();

alter table public.esg_obligations enable row level security;

create policy "esg_obligations_select_project_members_only"
  on public.esg_obligations
  for select
  using (public.is_project_member(project_id));

-- Configurar o checklist é uma ação de EDITOR/ADMIN — mesmo nível de
-- quem já pode enviar documentos (register_project_document_upload).
create policy "esg_obligations_insert_editor"
  on public.esg_obligations
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'EDITOR')
  );

create policy "esg_obligations_update_editor"
  on public.esg_obligations
  for update
  to authenticated
  using (public.has_project_permission(project_id, 'EDITOR'))
  with check (public.has_project_permission(project_id, 'EDITOR'));

-- Nenhuma policy DELETE: desativar via active=false, nunca apagar
-- (preserva histórico de comprovações já vinculadas).

create or replace function public.audit_esg_obligation_created()
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
    new.project_id, 'USER', new.created_by_user_id, null,
    'ESG_OBLIGATION_CREATED', 'ESG_OBLIGATION', new.id::text,
    format('Obrigação ESG/SSMA "%s" (categoria %s, periodicidade %s) configurada.', new.title, new.category, new.periodicity),
    new.created_at
  );
  return new;
end;
$$;

create trigger esg_obligations_audit_created
after insert
on public.esg_obligations
for each row
execute function public.audit_esg_obligation_created();


-- ============================================================
-- 2. ESG_OBLIGATION_SUBMISSIONS — comprovação (uma linha por registro)
-- ============================================================

create table public.esg_obligation_submissions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  obligation_id uuid not null
    references public.esg_obligations (id) on delete restrict,

  reference_date date not null,
  reference_period_label text,

  due_date date,

  filled_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  status text not null
    check (status in (
      'CUMPRIDO', 'CUMPRIDO_PARCIALMENTE', 'PENDENTE',
      'NAO_CUMPRIDO', 'NAO_APLICAVEL', 'DISPENSADO'
    )),

  description text,
  observation text,
  justification text,

  -- Calculado deterministicamente pelo app (ver
  -- apps/web/lib/esg/compute-obligation-risk.ts) antes do INSERT — nunca
  -- inventado pela IA, nunca calculado "às cegas" pelo banco.
  risk_level text
    check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

  -- Campos específicos de DDS (seção 7) — só usados quando a obrigação é
  -- categoria DDS; formato: {"tema": string, "publico": string|null,
  -- "numeroParticipantes": number|null}. JSONB em vez de uma tabela
  -- paralela: não é "sistema completo de gestão de DDS", é só um detalhe
  -- estruturado opcional da comprovação.
  dds_details jsonb,

  reviewed_by_user_id uuid
    references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (status in ('NAO_APLICAVEL', 'DISPENSADO') and nullif(trim(justification), '') is not null)
    or (status not in ('NAO_APLICAVEL', 'DISPENSADO'))
  )
);

create index esg_obligation_submissions_obligation_idx
  on public.esg_obligation_submissions (obligation_id, reference_date desc);

create index esg_obligation_submissions_project_idx
  on public.esg_obligation_submissions (project_id, status);

create or replace function public.set_esg_obligation_submissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger esg_obligation_submissions_set_updated_at
before update
on public.esg_obligation_submissions
for each row
execute function public.set_esg_obligation_submissions_updated_at();

-- Garante que a obrigação referenciada pertence ao mesmo projeto da
-- submissão (evita vincular comprovação de um projeto a checklist de outro).
create or replace function public.validate_esg_submission_same_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obligation_project_id uuid;
begin
  select project_id into v_obligation_project_id
  from public.esg_obligations
  where id = new.obligation_id;

  if v_obligation_project_id is null then
    raise exception 'ESG obligation not found';
  end if;

  if v_obligation_project_id <> new.project_id then
    raise exception 'ESG obligation belongs to another project';
  end if;

  return new;
end;
$$;

create trigger esg_obligation_submissions_validate_project
before insert or update of project_id, obligation_id
on public.esg_obligation_submissions
for each row
execute function public.validate_esg_submission_same_project();

alter table public.esg_obligation_submissions enable row level security;

create policy "esg_obligation_submissions_select_project_members_only"
  on public.esg_obligation_submissions
  for select
  using (public.is_project_member(project_id));

-- INSERT: EDITOR (técnico autorizado) no projeto, sempre autoautoria —
-- mesmo padrão de impersonation-block de event_notes.
create policy "esg_obligation_submissions_insert_editor_self_authored"
  on public.esg_obligation_submissions
  for insert
  to authenticated
  with check (
    filled_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'EDITOR')
  );

-- Nenhuma policy UPDATE/DELETE para usuário comum: ajuste de status só
-- via review_esg_obligation_submission (RPC, ADMIN) — nunca um UPDATE
-- direto que pudesse pular a auditoria/revisão.

create or replace function public.audit_esg_obligation_submission_created()
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
    new.project_id, 'USER', new.filled_by_user_id, null,
    'ESG_OBLIGATION_STATUS_UPDATED', 'ESG_OBLIGATION_SUBMISSION', new.id::text,
    format('Comprovação registrada para a obrigação %s: status %s.', new.obligation_id, new.status),
    new.created_at
  );
  return new;
end;
$$;

create trigger esg_obligation_submissions_audit_created
after insert
on public.esg_obligation_submissions
for each row
execute function public.audit_esg_obligation_submission_created();


-- ============================================================
-- 3. ESG_OBLIGATION_EVIDENCE — arquivos anexados a uma comprovação
-- ============================================================

create table public.esg_obligation_evidence (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  submission_id uuid not null
    references public.esg_obligation_submissions (id) on delete cascade,

  obligation_id uuid not null
    references public.esg_obligations (id) on delete restrict,

  evidence_kind text not null
    check (evidence_kind in ('FOTO', 'DOCUMENTO', 'PLANILHA', 'LISTA_PRESENCA', 'OUTRO')),

  storage_bucket text not null default 'project-documents',
  file_path text not null,
  original_file_name text not null,
  mime_type text not null,

  file_size_bytes bigint not null
    check (file_size_bytes > 0 and file_size_bytes <= 52428800),

  -- Nunca sobrescreve uma evidência anterior — quando uma nova evidência
  -- substitui/melhora outra (ex.: foto mais nítida), aponta para a
  -- anterior aqui, mas a anterior permanece intacta no banco e no Storage.
  replaces_evidence_id uuid
    references public.esg_obligation_evidence (id) on delete set null,

  uploaded_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  uploaded_at timestamptz not null default now(),

  unique (storage_bucket, file_path)
);

create index esg_obligation_evidence_submission_idx
  on public.esg_obligation_evidence (submission_id);

create index esg_obligation_evidence_obligation_idx
  on public.esg_obligation_evidence (obligation_id);

-- Garante que a submissão referenciada pertence ao mesmo projeto/obrigação.
create or replace function public.validate_esg_evidence_same_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_project_id uuid;
  v_submission_obligation_id uuid;
begin
  select project_id, obligation_id
  into v_submission_project_id, v_submission_obligation_id
  from public.esg_obligation_submissions
  where id = new.submission_id;

  if v_submission_project_id is null then
    raise exception 'ESG obligation submission not found';
  end if;

  if v_submission_project_id <> new.project_id then
    raise exception 'Submission belongs to another project';
  end if;

  if v_submission_obligation_id <> new.obligation_id then
    raise exception 'Evidence obligation_id must match the submission''s obligation';
  end if;

  return new;
end;
$$;

create trigger esg_obligation_evidence_validate_project
before insert
on public.esg_obligation_evidence
for each row
execute function public.validate_esg_evidence_same_project();

alter table public.esg_obligation_evidence enable row level security;

create policy "esg_obligation_evidence_select_project_members_only"
  on public.esg_obligation_evidence
  for select
  using (public.is_project_member(project_id));

create policy "esg_obligation_evidence_insert_editor_self_authored"
  on public.esg_obligation_evidence
  for insert
  to authenticated
  with check (
    uploaded_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'EDITOR')
  );

-- Nenhuma policy UPDATE/DELETE: evidência é imutável (mesmo padrão de
-- document_versions — arquivos originais nunca são substituídos/apagados).

create or replace function public.audit_esg_obligation_evidence_created()
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
    new.project_id, 'USER', new.uploaded_by_user_id, null,
    'ESG_OBLIGATION_EVIDENCE_SUBMITTED', 'ESG_OBLIGATION_EVIDENCE', new.id::text,
    format('Evidência "%s" (%s) anexada à comprovação %s.', new.original_file_name, new.evidence_kind, new.submission_id),
    new.uploaded_at
  );
  return new;
end;
$$;

create trigger esg_obligation_evidence_audit_created
after insert
on public.esg_obligation_evidence
for each row
execute function public.audit_esg_obligation_evidence_created();


-- ============================================================
-- 4. REVISÃO (ADMIN) — ajusta status, audita, e gera contract_event
--    SOMENTE quando o resultado é contratualmente relevante (nunca para
--    cumprimento rotineiro — seção 23/24 do requisito).
-- ============================================================

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

  -- Risco mais recente ANTES desta revisão, para detectar transição
  -- CRITICAL -> regularizado (seção 23, "OBRIGAÇÃO CRÍTICA REGULARIZADA").
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

  -- ---------------- Event Ledger: só para fatos relevantes ----------------

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
      v_submission.project_id, 'SYSTEM', null, 'esg_obligations',
      'CONTRACT_EVENT_CREATED', 'CONTRACT_EVENT', v_event_id::text,
      format('Evento gerado a partir da revisão da comprovação ESG/SSMA %s.', p_submission_id)
    );
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.review_esg_obligation_submission(uuid, text, text) from public;
revoke all on function public.review_esg_obligation_submission(uuid, text, text) from anon;
grant execute on function public.review_esg_obligation_submission(uuid, text, text) to authenticated;

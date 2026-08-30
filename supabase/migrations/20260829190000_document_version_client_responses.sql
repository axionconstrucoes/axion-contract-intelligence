-- ============================================================
-- 20260829190000_document_version_client_responses.sql
-- Bloco 6 (MVP controlado) — vínculo manual e auditável de uma
-- resposta do cliente (e-mail) a uma VERSÃO específica de documento
-- operacional (Diário de Obra / Ata de Reunião / Relatório Semanal,
-- mas sem restringir a esses — qualquer document_version pode receber
-- uma resposta do cliente).
--
-- Preserva a versão original por construção: esta tabela é só um
-- vínculo lateral, nunca reescreve document_versions/
-- document_version_files. "Vínculo inequívoco pode ser automático;
-- vínculo ambíguo exige escolha do documento, sem transformar isso em
-- aprovação do conteúdo" — por isso `relation_type` nunca é inferido
-- automaticamente (mesmo quando o vínculo email->versão é automático,
-- a RELAÇÃO — RESPONDE/DISCORDA/CORRIGE/RESSALVA/COMPLEMENTA — é
-- sempre uma decisão humana explícita).
-- ============================================================

create table public.document_version_client_responses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  document_version_id uuid not null references public.document_versions (id) on delete cascade,
  email_id uuid not null references public.emails (id) on delete cascade,

  relation_type text not null check (
    relation_type in ('RESPONDE', 'DISCORDA', 'CORRIGE', 'RESSALVA', 'COMPLEMENTA')
  ),

  -- Como o vínculo email->versão foi estabelecido — rastreável, nunca
  -- silencioso. INTERNAL_VERSION_ID/MESSAGE_ID_REFERENCES/THREAD/
  -- ATTACHMENT_HASH podem ser automáticos quando inequívocos;
  -- SUBJECT_CANDIDATE é SEMPRE escolha humana (nunca automático).
  link_method text not null check (
    link_method in ('INTERNAL_VERSION_ID', 'MESSAGE_ID_REFERENCES', 'THREAD', 'ATTACHMENT_HASH', 'SUBJECT_CANDIDATE')
  ),

  -- Trecho relevante do e-mail (nunca o corpo inteiro) — para exibição
  -- compacta no card, mesma filosofia de outros resumos do sistema.
  excerpt text,

  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  -- SUBJECT_CANDIDATE é o único método ambíguo por natureza — exige
  -- sempre USER (uma pessoa escolheu), nunca SYSTEM (nada automático
  -- some aqui sem confirmação humana).
  check (link_method <> 'SUBJECT_CANDIDATE' or created_by_type = 'USER')
);

comment on table public.document_version_client_responses is
  'Vínculo lateral e auditável entre um e-mail (resposta do cliente) e uma document_version específica — nunca reescreve a versão original. relation_type é sempre decisão humana explícita, mesmo quando link_method é automático.';

create index document_version_client_responses_version_idx on public.document_version_client_responses (document_version_id);
create index document_version_client_responses_email_idx on public.document_version_client_responses (email_id);
create index document_version_client_responses_project_idx on public.document_version_client_responses (project_id);

-- Mesmo e-mail nunca vinculado duas vezes à mesma versão (evita
-- duplicar o badge "CONTESTADO PELO CLIENTE" por reenvio acidental do
-- mesmo vínculo) — um novo vínculo com relation_type diferente para o
-- mesmo par exige remover e recriar (nunca update silencioso, ver
-- ausência de policy de UPDATE abaixo).
create unique index document_version_client_responses_unique_pair_idx
  on public.document_version_client_responses (document_version_id, email_id);

alter table public.document_version_client_responses enable row level security;

create policy "document_version_client_responses_select_project_members_only"
  on public.document_version_client_responses
  for select
  using (public.is_project_member(project_id));

create policy "document_version_client_responses_insert_editor"
  on public.document_version_client_responses
  for insert
  to authenticated
  with check (
    (created_by_type = 'USER' and created_by_user_id = auth.uid())
    and public.has_project_permission(project_id, 'EDITOR')
    and exists (
      select 1 from public.document_versions dv
      join public.documents d on d.id = dv.document_id
      where dv.id = document_version_id and d.project_id = document_version_client_responses.project_id
    )
    and exists (
      select 1 from public.emails e
      where e.id = email_id and e.project_id = document_version_client_responses.project_id
    )
  );

-- Sem UPDATE/DELETE — mesma filosofia de project_additional_proposal_links
-- e document_relations (rastreabilidade: um vínculo incorreto nunca é
-- editado/apagado, só documentado como tal por um novo registro se
-- necessário no futuro).

create or replace function public.audit_document_version_client_response_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    new.project_id,
    new.created_by_type,
    new.created_by_user_id,
    new.created_by_label,
    'DOCUMENT_VERSION_CLIENT_RESPONSE_LINKED',
    'DOCUMENT_VERSION',
    new.document_version_id::text,
    format(
      'Resposta do cliente vinculada: %s (método: %s, e-mail: %s).',
      new.relation_type, new.link_method, new.email_id::text
    )
  );
  return new;
end;
$$;

alter function public.audit_document_version_client_response_created() owner to postgres;

-- ACL de menor privilégio: função de trigger de auditoria, nunca
-- chamada diretamente (o mecanismo de trigger não depende de GRANT
-- EXECUTE ao role que fez o INSERT). Nenhum caller real encontrado
-- fora do próprio trigger — revogado de public/anon/authenticated/
-- service_role; só o owner (postgres) mantém acesso, implícito por
-- ownership, sem necessidade de GRANT explícito.
revoke all on function public.audit_document_version_client_response_created() from public;
revoke all on function public.audit_document_version_client_response_created() from anon;
revoke all on function public.audit_document_version_client_response_created() from authenticated;
revoke all on function public.audit_document_version_client_response_created() from service_role;

create trigger document_version_client_responses_audit_created
  after insert on public.document_version_client_responses
  for each row
  execute function public.audit_document_version_client_response_created();

notify pgrst, 'reload schema';

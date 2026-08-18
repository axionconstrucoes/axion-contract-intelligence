-- ============================================================
-- 20260818195206_project_documents_foundation.sql
-- Fundacao de Project Documents: documents, document_versions e RLS
-- baseada em is_project_member (helper ja existente na fundacao de
-- identidade). Escopo deste lote: SOMENTE documentos de projeto.
-- Corporate Policies, EvidenceRef, DocumentRelationship, lifecycle
-- status, Storage e current_version_id ficam para lotes futuros.
-- ============================================================

-- ---------- tabelas ----------
-- kind e source_type usam text + check (mesmo padrao de status/permission
-- na fundacao de identidade), refletindo exatamente as unions atuais de
-- packages/types (DocumentKind e SourceType) — nenhum valor novo criado.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null
    check (kind in (
      'CONTRATO_BASE', 'ADITIVO', 'EDITAL', 'RFI', 'RFP', 'ESPECIFICACAO',
      'DESENHO', 'PLANILHA', 'CRONOGRAMA_BASELINE', 'CRONOGRAMA_REVISAO',
      'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE'
    )),
  title text not null,
  created_at timestamptz not null default now()
);

create index documents_project_id_idx
  on public.documents (project_id);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version_label text not null,
  version_index integer not null check (version_index > 0),
  document_date date not null,
  source_type text not null
    check (source_type in (
      'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
      'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
      'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
    )),
  author text not null,
  summary text not null,
  file_path text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  notes text,
  unique (document_id, version_index),
  unique (document_id, version_label)
);

create index document_versions_document_id_version_index_idx
  on public.document_versions (document_id, version_index desc);

-- ---------- RLS ----------
-- current version (maior version_index de um document_id) e regra de
-- leitura da aplicacao, nao de banco, neste primeiro lote — nenhuma
-- coluna/derivacao de "versao atual" e criada aqui.

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

create policy "documents_select_project_members_only"
  on public.documents
  for select
  using (public.is_project_member(project_id));

create policy "document_versions_select_project_members_only"
  on public.document_versions
  for select
  using (
    exists (
      select 1
      from public.documents d
      where d.id = document_versions.document_id
        and public.is_project_member(d.project_id)
    )
  );

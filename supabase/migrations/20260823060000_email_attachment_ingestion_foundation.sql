-- Ingestão de anexos de e-mail (Gmail inbound) + preparação do
-- espelhamento em Google Drive.
--
-- Arquitetura: SUPABASE é a fonte operacional/autoritativa; GOOGLE DRIVE
-- é só um espelho documental (nunca a fonte de verdade). Um anexo é
-- considerado "ingerido com sucesso" assim que persistido aqui + no
-- Supabase Storage — a sincronização com o Drive é sempre best-effort e
-- nunca invalida a ingestão (ver drive_sync_status).
--
-- Reaproveita infraestrutura já existente (ver mapeamento desta fase):
--   - bucket "project-documents" (já existe, já tem RLS de
--     select/insert por projeto — nenhuma policy de Storage nova é
--     necessária aqui, pois o caminho do objeto sempre começa com
--     "{project_id}/…", já coberto pelas policies existentes);
--   - is_project_member(project_id) para SELECT (mesmo padrão de
--     emails/document_versions);
--   - o "SourceType" já existente ('EMAIL') continua sendo o valor
--     correto em document_versions.source_type quando um anexo é
--     promovido a documento — nenhum novo valor de enum foi necessário;
--   - audit_log_entries (actor_type='SYSTEM' exige actor_user_id E
--     actor_label nulos — bug já corrigido em
--     20260822060313_fix_system_actor_audit_label.sql; esta migration
--     não repete esse erro).
--
-- Escritas nesta tabela são sempre server-side (service role, mesmo
-- padrão de scripts/gmail-inbound-sync.mjs) — por isso não há policy de
-- INSERT/UPDATE para o role "authenticated": nenhuma RPC SECURITY
-- DEFINER foi necessária, e nenhuma foi criada (mais simples, sem
-- superfície nova de PL/pgSQL, mesmo padrão já usado por emails).

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email_id uuid not null references public.emails (id) on delete restrict,

  -- Proveniência Gmail — preservada mesmo que o e-mail original seja
  -- reconsultado/repaginado no futuro (nunca depende só do FK).
  gmail_message_id text not null,
  gmail_thread_id text,
  gmail_attachment_id text not null,

  original_file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 52428800),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),

  storage_bucket text not null default 'project-documents',
  storage_path text not null,

  received_at timestamptz not null,
  ingested_at timestamptz not null default now(),

  -- Ciclo de vida da PROMOÇÃO ao pipeline documental (nunca automático
  -- — ver link_email_attachment_to_document em
  -- apps/web/lib/email/attachments/link-email-attachment-to-document.ts):
  -- PENDING = ingerido, ainda não vinculado a um document_version;
  -- PROCESSED = vinculado (document_version_id preenchido), disponível
  -- para Context Builder/evidenceRef; FAILED = a tentativa de
  -- ingestão/promoção falhou.
  processing_status text not null default 'PENDING'
    check (processing_status in ('PENDING', 'PROCESSED', 'FAILED')),
  processing_error text,
  document_version_id uuid references public.document_versions (id) on delete set null,

  source_language text,

  -- Espelhamento Google Drive — sempre best-effort, nunca bloqueia nem
  -- invalida a ingestão Supabase. PENDING = ainda não tentado; SYNCED =
  -- espelhado com sucesso; FAILED = tentado e falhou (drive_sync_error
  -- preenchido); SKIPPED = Drive não está configurado para este
  -- ambiente/projeto (nunca chegou a tentar).
  drive_sync_status text not null default 'PENDING'
    check (drive_sync_status in ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED')),
  drive_file_id text,
  drive_synced_at timestamptz,
  drive_sync_error text,

  created_at timestamptz not null default now(),

  -- Idempotência: reingerir o mesmo anexo (mesmo e-mail + mesmo
  -- attachmentId do Gmail) nunca cria uma segunda linha nem sobrescreve
  -- a existente silenciosamente — o script de ingestão sempre confere
  -- esta unicidade antes de inserir.
  unique (email_id, gmail_attachment_id),
  -- Nunca dois anexos podem apontar para o mesmo objeto físico do
  -- Storage por engano (mesmo quando o hash de conteúdo é igual — cada
  -- anexo ainda tem seu próprio objeto nesta fase; deduplicação física
  -- por hash é evolução futura, não implementada agora).
  unique (storage_bucket, storage_path)
);

comment on table public.email_attachments is
  'Anexos de e-mail ingeridos via Gmail inbound sync — Supabase é a fonte autoritativa; drive_sync_status descreve só o espelho documental no Google Drive (nunca a fonte de verdade).';

create index email_attachments_project_id_idx on public.email_attachments (project_id);
create index email_attachments_email_id_idx on public.email_attachments (email_id);
create index email_attachments_processing_status_idx on public.email_attachments (processing_status);
create index email_attachments_drive_sync_status_idx on public.email_attachments (drive_sync_status);

alter table public.email_attachments enable row level security;

create policy "email_attachments_select_project_members_only"
  on public.email_attachments for select
  using (public.is_project_member(project_id));

-- Nenhuma policy de insert/update/delete para "authenticated": a
-- ingestão e a promoção ao pipeline documental são sempre operações de
-- sistema (service role), nunca acionadas diretamente pelo navegador
-- nesta fase — mesmo padrão já usado por public.emails.

-- ============================================================
-- 20260818221730_email_foundation.sql
-- Fundacao minima de Email: apenas o suficiente para que o futuro
-- Event Ledger tenha evidence/cross-reference com FK real para
-- emails. NAO e integracao Gmail/Outlook — sem OAuth, provider,
-- message_id, thread_id, mailbox/account, attachments, ingestao,
-- dedupe, monitoring ou envio. project_id direto (email nao deriva
-- de document/document_version — mesmo padrao ja usado em
-- schedule_versions/documents, sem redundancia desnecessaria aqui
-- pois nao ha document pai para emails).
-- ============================================================

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  from_address text not null,
  to_address text not null,
  subject text not null,
  sent_at timestamptz not null,
  snippet text not null,
  created_at timestamptz not null default now()
);

create index emails_project_id_idx
  on public.emails (project_id);

create index emails_project_id_sent_at_idx
  on public.emails (project_id, sent_at desc);

-- ---------- RLS ----------

alter table public.emails enable row level security;

create policy "emails_select_project_members_only"
  on public.emails
  for select
  using (public.is_project_member(project_id));

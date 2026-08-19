-- ============================================================
-- audit_foundation.sql
-- Trilha forense de auditoria do AXION Contract Intelligence.
--
-- Características:
-- - vinculada ao projeto;
-- - autoria estruturada SYSTEM / USER / LEGACY;
-- - append-only: UPDATE e DELETE proibidos;
-- - leitura limitada aos membros do projeto via RLS;
-- - escrita destinada a operações server-side autorizadas;
-- - entity_type/entity_id genéricos propositalmente.
-- ============================================================

create table public.audit_log_entries (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete restrict,

  occurred_at timestamptz not null default now(),

  actor_type text not null
    check (actor_type in ('SYSTEM', 'USER', 'LEGACY')),

  actor_user_id uuid
    references public.profiles (id) on delete restrict,

  actor_label text,

  action text not null,

  entity_type text not null,

  entity_id text not null,

  detail text not null,

  created_at timestamptz not null default now(),

  check (
    (
      actor_type = 'SYSTEM'
      and actor_user_id is null
      and actor_label is null
    )
    or
    (
      actor_type = 'USER'
      and actor_user_id is not null
      and actor_label is null
    )
    or
    (
      actor_type = 'LEGACY'
      and actor_user_id is null
      and actor_label is not null
    )
  )
);

-- ---------- Índices ----------

create index audit_log_entries_project_id_idx
  on public.audit_log_entries (project_id);

create index audit_log_entries_project_occurred_at_idx
  on public.audit_log_entries (project_id, occurred_at desc);

create index audit_log_entries_actor_user_id_idx
  on public.audit_log_entries (actor_user_id)
  where actor_user_id is not null;

create index audit_log_entries_entity_idx
  on public.audit_log_entries (entity_type, entity_id);


-- ============================================================
-- Append-only
-- ============================================================

create or replace function public.prevent_audit_log_entry_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_log_entries is append-only: UPDATE and DELETE are not allowed';
end;
$$;

create trigger audit_log_entries_prevent_update_delete
before update or delete
on public.audit_log_entries
for each row
execute function public.prevent_audit_log_entry_mutation();


-- ============================================================
-- RLS
-- ============================================================

alter table public.audit_log_entries enable row level security;

create policy "audit_log_entries_select_project_members_only"
  on public.audit_log_entries
  for select
  using (
    public.is_project_member(project_id)
  );

-- Não existe policy INSERT para usuários autenticados comuns.
-- Inserções devem ser feitas por operações server-side autorizadas.
--
-- Não existem policies UPDATE ou DELETE.
-- O trigger também impede alteração ou exclusão dos registros históricos.
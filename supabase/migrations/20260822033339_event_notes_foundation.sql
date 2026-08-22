-- ============================================================
-- 20260822033339_event_notes_foundation.sql
-- "Anotações do Evento" (event_notes): informação declarada
-- internamente por um usuário, distinta de evidência/documento/e-mail/
-- cláusula. Nunca tratada como fato documental — ver
-- apps/web/lib/ai/context/types.ts (evidentialStatus DECLARED_CONTEXT).
--
-- Segue o padrão já validado do projeto: RLS via is_project_member /
-- has_project_permission (identity_foundation), auditoria via trigger
-- SECURITY DEFINER (mesmo padrão de
-- audit_event_clause_confrontation_candidate_creation.sql). Sem policy de
-- UPDATE/DELETE nesta fase — anotações são append-only (nenhum DELETE
-- silencioso; edição fica para uma migration futura, se necessário).
-- ============================================================

create table public.event_notes (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null
    references public.contract_events (id) on delete cascade,

  author_user_id uuid not null
    references public.profiles (id) on delete restrict,

  category text not null
    check (category in (
      'CONTEXTO_OPERACIONAL',
      'INFORMACAO_COMERCIAL',
      'OBSERVACAO_JURIDICA',
      'PLANEJAMENTO',
      'FINANCEIRO',
      'OUTROS'
    )),

  text text not null
    check (nullif(trim(text), '') is not null),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index event_notes_event_id_idx
  on public.event_notes (event_id, created_at desc);

create index event_notes_author_user_id_idx
  on public.event_notes (author_user_id);

-- ---------- updated_at ----------

create or replace function public.set_event_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger event_notes_set_updated_at
before update
on public.event_notes
for each row
execute function public.set_event_notes_updated_at();

-- ---------- RLS ----------

alter table public.event_notes enable row level security;

create policy "event_notes_select_project_members_only"
  on public.event_notes
  for select
  using (
    exists (
      select 1
      from public.contract_events ce
      where ce.id = event_notes.event_id
        and public.is_project_member(ce.project_id)
    )
  );

-- INSERT: exige EDITOR (ou ADMIN) no projeto do evento, e o autor
-- declarado deve ser sempre o próprio usuário autenticado — impede que
-- alguém registre uma anotação em nome de outra pessoa.
create policy "event_notes_insert_editor_self_authored"
  on public.event_notes
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and exists (
      select 1
      from public.contract_events ce
      where ce.id = event_notes.event_id
        and public.has_project_permission(ce.project_id, 'EDITOR')
    )
  );

-- Nenhuma policy UPDATE/DELETE: anotações são append-only nesta fase.

-- ---------- Auditoria (EVENT_NOTE_CREATED) ----------

create or replace function public.audit_event_note_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select ce.project_id
  into v_project_id
  from public.contract_events ce
  where ce.id = new.event_id;

  if v_project_id is null then
    raise exception 'Project not found for event note';
  end if;

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail,
    occurred_at
  )
  values (
    v_project_id,
    'USER',
    new.author_user_id,
    null,
    'EVENT_NOTE_CREATED',
    'EVENT_NOTE',
    new.id::text,
    format(
      'Anotação (%s) registrada para o evento %s.',
      new.category,
      new.event_id
    ),
    new.created_at
  );

  return new;
end;
$$;

create trigger event_notes_audit_created
after insert
on public.event_notes
for each row
execute function public.audit_event_note_created();

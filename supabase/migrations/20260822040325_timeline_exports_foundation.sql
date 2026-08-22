-- ============================================================
-- 20260822040325_timeline_exports_foundation.sql
-- Rastreabilidade das exportações do Timeline filtrado (dossiês para
-- litígio/arbitragem/perícia). Cada exportação vira uma linha aqui,
-- permitindo responder no futuro "qual conjunto de fatos e documentos
-- foi utilizado nesta análise?" (reprodutibilidade).
--
-- Exportar é ação de LEITURA (o usuário só reempacota o que já pode
-- ver) — por isso qualquer membro do projeto pode inserir, não apenas
-- EDITOR/ADMIN. RLS nunca é contornada por service role: a geração do
-- pacote roda inteiramente com a sessão do próprio usuário.
-- ============================================================

create table public.timeline_exports (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete restrict,

  exported_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  exported_at timestamptz not null default now(),

  -- Critérios de seleção completos (fontes, categorias/impactos,
  -- período, participantes, eventIds selecionados manualmente) — a
  -- base da reprodutibilidade. Nunca conteúdo integral dos eventos.
  filters jsonb not null,

  event_ids uuid[] not null
    check (array_length(event_ids, 1) > 0),

  item_count integer not null
    check (item_count = array_length(event_ids, 1)),

  formats text[] not null
    check (array_length(formats, 1) > 0),

  created_at timestamptz not null default now()
);

create index timeline_exports_project_id_idx
  on public.timeline_exports (project_id, exported_at desc);

create index timeline_exports_exported_by_user_id_idx
  on public.timeline_exports (exported_by_user_id);

-- ---------- RLS ----------

alter table public.timeline_exports enable row level security;

create policy "timeline_exports_select_project_members_only"
  on public.timeline_exports
  for select
  using (public.is_project_member(project_id));

-- INSERT: qualquer membro do projeto (inclusive VIEWER — exportar é
-- reempacotar o que já se pode ver, não uma ação de edição) e sempre
-- autoautoria — impossível registrar exportação em nome de outro
-- usuário.
create policy "timeline_exports_insert_project_members_self_authored"
  on public.timeline_exports
  for insert
  to authenticated
  with check (
    exported_by_user_id = auth.uid()
    and public.is_project_member(project_id)
  );

-- Nenhuma policy UPDATE/DELETE: registro de exportação é append-only,
-- igual ao restante da trilha de auditoria do projeto.

-- ---------- Auditoria (CONTRACTUAL_TIMELINE_EXPORTED) ----------

create or replace function public.audit_timeline_export_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nunca grava o conteúdo integral (event_ids/filters) no audit log —
  -- só um resumo compacto. O detalhe completo, reprodutível, fica em
  -- timeline_exports (linkado por entity_id).
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
    new.project_id,
    'USER',
    new.exported_by_user_id,
    null,
    'CONTRACTUAL_TIMELINE_EXPORTED',
    'TIMELINE_EXPORT',
    new.id::text,
    format(
      'Timeline exportado: %s evento(s), formato(s) %s.',
      new.item_count,
      array_to_string(new.formats, ', ')
    ),
    new.exported_at
  );

  return new;
end;
$$;

create trigger timeline_exports_audit_created
after insert
on public.timeline_exports
for each row
execute function public.audit_timeline_export_created();

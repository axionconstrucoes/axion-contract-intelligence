-- ============================================================
-- 20260817191336_identity_foundation.sql
-- Fundacao de identidade: profiles, projects, project_memberships,
-- trigger de criacao de profile e RLS com funcoes auxiliares
-- anti-recursao.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- enum ----------
-- Somente user_origin usa enum, e corresponde exatamente aos valores de
-- packages/types (UserOrigin). status e permission usam text + check.

create type public.user_origin as enum ('AXION_INTERNO', 'TERCEIRO');

-- ---------- tabelas ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  origin public.user_origin not null default 'TERCEIRO',
  title text,
  avatar_initials text
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  client text not null,
  status text not null default 'ATIVO'
    check (status in ('ATIVO', 'SUSPENSO', 'ENCERRADO')),
  location text not null,
  contract_number text,
  start_date date not null,
  baseline_end_date date not null
);

create table public.project_memberships (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null
    check (permission in ('VIEWER', 'EDITOR', 'ADMIN')),
  primary key (project_id, user_id)
);

create index project_memberships_user_id_idx
  on public.project_memberships (user_id);

-- ---------- trigger: cria profile a partir de auth.users ----------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, origin, title, avatar_initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'origin')::public.user_origin, 'TERCEIRO'),
    new.raw_user_meta_data ->> 'title',
    new.raw_user_meta_data ->> 'avatar_initials'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- is_project_member ----------

create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_project_member(uuid) from public;
grant execute on function public.is_project_member(uuid) to authenticated;

-- ---------- has_project_permission ----------
-- Hierarquia explicita: VIEWER=1, EDITOR=2, ADMIN=3.

create function public.has_project_permission(p_project_id uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and (
        case pm.permission
          when 'ADMIN' then 3
          when 'EDITOR' then 2
          when 'VIEWER' then 1
          else 0
        end
      ) >= (
        case p_min
          when 'ADMIN' then 3
          when 'EDITOR' then 2
          when 'VIEWER' then 1
          else 0
        end
      )
  );
$$;

revoke all on function public.has_project_permission(uuid, text) from public;
grant execute on function public.has_project_permission(uuid, text) to authenticated;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;

create policy "profiles_select_self_or_project_peer"
  on public.profiles
  for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.project_memberships mine
      join public.project_memberships theirs
        on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid()
        and theirs.user_id = public.profiles.id
    )
  );

create policy "projects_select_members_only"
  on public.projects
  for select
  using (public.is_project_member(id));

create policy "project_memberships_select_members_only"
  on public.project_memberships
  for select
  using (public.is_project_member(project_id));

create policy "project_memberships_write_admin_only"
  on public.project_memberships
  for all
  using (public.has_project_permission(project_id, 'ADMIN'))
  with check (public.has_project_permission(project_id, 'ADMIN'));

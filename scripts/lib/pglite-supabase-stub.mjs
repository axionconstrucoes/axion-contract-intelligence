// Banco PostgreSQL LOCAL e descartável (PGlite, em memória) para testar migrations do ACC sem
// tocar em nenhum banco real. Recria só o mínimo do ambiente Supabase de que as migrations
// dependem (papéis, auth.uid(), tabelas-base e has_project_permission) — NÃO é o schema real.
//
// Limites: valida a sintaxe/semântica das funções e políticas NOVAS contra PostgreSQL de
// verdade (17), mas as tabelas-base são simplificadas; o comportamento contra o schema de
// produção continua sem validação até a migration ser aplicada em um ambiente de teste real.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.join(here, "..", "..", "supabase", "migrations");

const BASE_SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create table public.profiles (id uuid primary key, name text, email text);
create table public.projects (
  id uuid primary key,
  code text, name text, client text, status text default 'ATIVO', location text,
  start_date date, baseline_end_date date, project_start_date date,
  acc_operational_start_date date, workspace_type text default 'OBRA'
);
create table public.project_memberships (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  permission text not null default 'COLABORADOR',
  status text not null default 'ACTIVE',
  area text,
  primary key (project_id, user_id)
);

create function public.has_project_permission(p_project_id uuid, p_min text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_memberships pm
    where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.status = 'ACTIVE'
      and (pm.permission = 'ADMINISTRADOR' or (p_min <> 'ADMINISTRADOR' and pm.permission in ('GERENTE','GESTOR')))
  )
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function public.has_project_permission(uuid, text) to authenticated, service_role;
`;

export async function createLocalDb(migrationFiles = []) {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  for (const file of migrationFiles) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  // Tabelas criadas pelas migrations também precisam dos privilégios padrão do Supabase.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
    grant execute on all functions in schema public to postgres;
  `);
  return db;
}

/** Executa `fn` como um papel/usuário: role = 'authenticated' (com uid) ou 'service_role'. */
export async function as(db, { role, uid = null }, fn) {
  await db.exec(`select set_config('app.uid', '${uid ?? ""}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

export async function expectError(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    if (!pattern.test(String(error.message))) throw new Error(`erro inesperado: ${error.message}`);
    return;
  }
  throw new Error(`esperava erro ${pattern}, mas a operação foi aceita`);
}

// Reaplica TODAS as migrations do repositório, em ordem de nome, numa base PostgreSQL 17 em
// memória (PGlite) — descartável, sem rede e sem qualquer relação com o banco remoto/produção.
// Valida a ORDEM e a compatibilidade entre migrations (as pendentes dependem das anteriores).
//
// O que o ambiente simula (stub mínimo da plataforma Supabase): papéis anon/authenticated/
// service_role, auth.users/auth.uid(), schema storage (buckets/objects) e extensões básicas.
// O que NÃO cobre: GoTrue real, Storage real (políticas são criadas, não exercidas por HTTP),
// pg_cron/pg_net, extensões não suportadas pelo PGlite e o estado real do banco remoto (drift).
// Por isso NÃO substitui um banco de teste Supabase real.
//
// Uso: node scripts/test-migrations-full-replay.mjs [--list]

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const PENDING = [
  "20261027120000_alert_followups.sql",
  "20261027130000_project_delivery_items.sql",
  "20261027140000_alert_batch_partial_responses.sql",
  "20261027150000_delivery_item_respond.sql",
  "20261027160000_delivery_end_date_change_history.sql",
  "20261028120000_risk_classification_reviews.sql",
  "20261028130000_ssma_field_records.sql",
];

const PLATFORM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create schema if not exists extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
-- Plataforma Supabase: tabelas novas do schema public já nascem com privilégios amplos (as
-- migrations de hardening revogam/regravam o que for necessário).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

if (process.argv.includes("--list")) {
  console.log(files.join("\n"));
  process.exit(0);
}

let failed = 0;
const db = new PGlite();
try {
  await db.exec(PLATFORM);
} catch (error) {
  console.log(`FAIL plataforma simulada: ${error.message}`);
  process.exit(1);
}

const results = [];
for (const file of files) {
  try {
    // pgcrypto não existe no PGlite: gen_random_uuid() já é nativo (PG13+); o resto é stub abaixo.
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/^﻿/, "").replace(/create extension if not exists pgcrypto[^;]*;/gi, "-- pgcrypto: omitido no PGlite");
    await db.exec(sql);
    results.push({ file, ok: true });
  } catch (error) {
    results.push({ file, ok: false, error: String(error.message).split("\n")[0] });
    failed += 1;
    // Uma migration que não aplica invalida as seguintes; paramos no primeiro erro para o
    // diagnóstico ser claro (a causa-raiz costuma ser a primeira).
    break;
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`migrations aplicadas em ordem: ${ok}/${files.length}`);
for (const r of results.filter((x) => !x.ok)) console.log(`FAIL ${r.file}\n     ${r.error}`);

if (failed === 0) {
  const missing = PENDING.filter((p) => !files.includes(p));
  const order = PENDING.map((p) => files.indexOf(p));
  const sorted = order.every((v, i) => i === 0 || v > order[i - 1]);
  console.log(`${missing.length === 0 ? "OK  " : "FAIL"} as 7 migrations pendentes existem${missing.length ? ` (faltam: ${missing.join(", ")})` : ""}`);
  console.log(`${sorted ? "OK  " : "FAIL"} a ordem lexicográfica coincide com a ordem de dependência documentada`);
  const dup = files.map((f) => f.split("_")[0]).filter((v, i, a) => a.indexOf(v) !== i);
  console.log(`${dup.length === 0 ? "OK  " : "FAIL"} sem prefixo (versão) duplicado${dup.length ? `: ${[...new Set(dup)].join(", ")}` : ""}`);
  // Tabelas criadas pelas migrations pendentes precisam de RLS ligada (isolamento por obra).
  const newTables = [
    "alert_followups", "alert_followup_events", "project_delivery_items", "project_delivery_item_events",
    "ssma_field_records", "ssma_corrective_actions", "ssma_field_record_photos",
  ];
  const rls = (await db.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relname = any($1)", [newTables])).rows;
  const present = rls.map((r) => r.relname);
  const noRls = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  const absent = newTables.filter((t) => !present.includes(t));
  console.log(`${absent.length === 0 ? "OK  " : "FAIL"} tabelas novas presentes${absent.length ? ` (ausentes: ${absent.join(", ")})` : ""}`);
  console.log(`${noRls.length === 0 ? "OK  " : "FAIL"} RLS ligada em todas as tabelas novas${noRls.length ? ` (sem RLS: ${noRls.join(", ")})` : ""}`);
  if (missing.length || !sorted || dup.length || absent.length || noRls.length) failed += 1;
}

console.log("");
console.log(`RESULTADO: ${failed === 0 ? "OK" : "FALHOU"}`);
await db.close();
process.exit(failed ? 1 : 0);

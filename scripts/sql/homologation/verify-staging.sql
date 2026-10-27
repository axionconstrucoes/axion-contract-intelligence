-- Verificação SOMENTE LEITURA do banco de homologação depois das migrations.
-- Uma única consulta; cada linha = uma verificação (check_name, ok, detail).
-- ok = true  -> atende ao esperado;  ok = null -> informativo (conferir manualmente).
-- Pode ser executada no SQL Editor do projeto de HOMOLOGAÇÃO ou via PGlite (teste local).
-- NUNCA contém INSERT/UPDATE/DELETE/DDL.

with
pub_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
definer_fns as (
  select p.oid, p.proname, p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
),
policy_tables as (
  select distinct c.relname
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
)
select 'public_tables'::text as check_name, null::boolean as ok, count(*)::text as detail from pub_tables
union all
select 'tables_without_rls', count(*) = 0, coalesce(string_agg(relname, ', ' order by relname), '-')
  from pub_tables where not relrowsecurity
union all
select 'rls_tables_without_any_policy (service-role-only tables)', null, coalesce(string_agg(relname, ', ' order by relname), '-')
  from pub_tables where relrowsecurity and relname not in (select relname from policy_tables)
union all
select 'security_definer_functions', null, count(*)::text from definer_fns
union all
select 'security_definer_without_empty_search_path', count(*) = 0, coalesce(string_agg(proname, ', ' order by proname), '-')
  from definer_fns
  where not exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) cfg where cfg in ('search_path=""', 'search_path=')
                    or cfg ilike 'search_path=%')
union all
select 'anon_write_grants_on_public_tables (informativo: o Supabase concede ALL por padrão; a proteção é a RLS)', null::boolean, coalesce(string_agg(distinct table_name, ', '), '-')
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
union all
select 'authenticated_truncate_grants_on_public_tables (informativo)', null::boolean, coalesce(string_agg(distinct table_name, ', '), '-')
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
union all
select 'migration_history_rows',
       null,
       case when to_regclass('supabase_migrations.schema_migrations') is null
            then 'tabela de histórico ausente (esperado só no PGlite)'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from supabase_migrations.schema_migrations', false, true, '')))[1]::text end
union all
select 'storage_buckets',
       null,
       case when to_regclass('storage.buckets') is null then 'schema storage ausente'
            else (xpath('/row/c/text()', query_to_xml('select coalesce(string_agg(id, '', '' order by id), ''-'') as c from storage.buckets', false, true, '')))[1]::text end
union all
select 'default_privileges_postgres_public (hosted = anon/authenticated/service_role com ALL)',
       null,
       coalesce((select string_agg(defaclobjtype::text || ':' || coalesce(defaclacl::text, '-'), ' | ') from pg_default_acl d
                 join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public'), 'nenhum padrão definido')
order by 1;

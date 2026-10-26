-- Bootstrap de privilégios-padrão para INICIALIZAÇÃO LIMPA (Supabase local / projeto novo).
--
-- O projeto Supabase HOSPEDADO cria o schema public com DEFAULT PRIVILEGES do papel `postgres`
-- concedendo ALL em tabelas, sequências e funções a anon, authenticated e service_role. Várias
-- migrations do repositório (por exemplo 20260920170000_harden_weekly_report_database_permissions,
-- que REVOGA e depois confere o resultado) assumem esse padrão. Um stack local limpo (`supabase start`
-- / `supabase db reset`) não o tem — só `Dxtm` para esses papéis — e a migration 20260920170000 falha
-- com "hardening falhou: authenticated perdeu SELECT em project_weekly_schedule_ingestion_configs".
--
-- Este arquivo NÃO é uma migration versionada: ele NÃO entra em supabase/migrations/ e portanto NÃO
-- altera o histórico (nem o banco remoto). É injetado como versão 00000000000001 apenas na CÓPIA de
-- trabalho criada por scripts/sql/start-clean-local-stack.mjs, antes de todas as migrations.
-- Idempotente; espelha o estado já existente no projeto hospedado.

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

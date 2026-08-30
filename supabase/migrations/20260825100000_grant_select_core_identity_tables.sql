-- ============================================================
-- 20260825100000_grant_select_core_identity_tables.sql
--
-- GRANT minimo para authenticated alcancar as policies RLS de SELECT
-- ja existentes em projects/profiles/project_memberships/
-- audit_log_entries.
--
-- Causa raiz (confirmada empiricamente): essas 4 tabelas foram criadas
-- com RLS habilitado e policies de SELECT (20260817191336 e
-- 20260819195713), mas nunca receberam o GRANT SELECT explicito para
-- authenticated que o restante do schema sempre concede ao lado da
-- policy (ver document_version_files em
-- 20260825010713_document_version_file_packages.sql). Sem o GRANT,
-- o Postgres nega no nivel de privilegio ANTES de avaliar a RLS —
-- "permission denied for table X", nao um resultado vazio filtrado
-- por policy. Reproduzido em supabase_db local:
--   set local role authenticated;
--   select count(*) from public.projects;
--   -> ERROR: permission denied for table projects
--
-- Nao concede nada a anon. Nao concede INSERT/UPDATE/DELETE em nenhuma
-- tabela: toda escrita de project_memberships passa por RPCs
-- SECURITY DEFINER (add_project_member/update_project_member_role/
-- set_project_member_status/remove_project_member — ver
-- 20260824090000_project_membership_roles_status_area.sql), que
-- rodam com os privilegios do dono da function (nao do chamador) e
-- por isso nao dependem de GRANT direto na tabela para funcionar.
--
-- GRANT UPDATE em project_memberships removido (revisao de
-- 2026-08-29): nao existe nenhum teste ou caminho de aplicacao que
-- exercite UPDATE direto na tabela como authenticated — verificado
-- (nao existe diretorio supabase/tests neste repositorio); a policy
-- "project_memberships_update_admin_not_self" continua intocada e em
-- vigor, so deixa de ser alcancavel sem passar por uma RPC
-- SECURITY DEFINER, que nunca precisou do GRANT.
-- ============================================================

grant select on public.projects to authenticated;
grant select on public.profiles to authenticated;
grant select on public.project_memberships to authenticated;
grant select on public.audit_log_entries to authenticated;

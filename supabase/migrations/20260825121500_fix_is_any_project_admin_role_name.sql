-- ============================================================
-- 20260825121500_fix_is_any_project_admin_role_name.sql
-- BUG DE PRODUÇÃO DESCOBERTO durante esta etapa (nunca reportado antes):
-- is_any_project_admin() (20260823110000_controlled_gmail_ingestion_preparation)
-- ainda compara pm.permission = 'ADMIN' — o papel antigo, substituído
-- por 'ADMINISTRADOR' em todas as linhas reais desde
-- 20260824090000_project_membership_roles_status_area. Como o CHECK
-- constraint de project_memberships.permission só aceita
-- ADMINISTRADOR/GESTOR/COLABORADOR/LEITURA, NENHUMA linha real pode
-- mais satisfazer 'ADMIN' — is_any_project_admin() está retornando
-- FALSE para todo administrador real hoje, quebrando
-- register_email_account e disconnect_email_account (as duas únicas
-- RPCs que a usam).
--
-- Corrigido aqui via CREATE OR REPLACE, nunca editando a migration
-- original já aplicada — mesmo padrão de
-- 20260822060313_fix_system_actor_audit_label.sql.
-- ============================================================

create or replace function public.is_any_project_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
      and pm.permission = 'ADMINISTRADOR'
  );
$$;

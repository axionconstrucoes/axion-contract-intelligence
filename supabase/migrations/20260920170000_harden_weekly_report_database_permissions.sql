-- ============================================================
-- 20260920170000_harden_weekly_report_database_permissions.sql
-- Hardening de privilégios dos objetos criados por
-- 20260920120000_weekly_schedule_email_ingestion_foundation, ANTES da
-- ativação da feature (ACC_WEEKLY_REPORTS_ENABLED continua desligada).
--
-- Achados (consulta read-only a pg_class.relacl / pg_proc.proacl após a
-- aplicação da 120000 em produção):
--   1. As 9 tabelas novas herdaram os DEFAULT PRIVILEGES do schema public
--      do Supabase: anon, authenticated e service_role com
--      SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
--      A RLS já negava as linhas para anon e negava escrita para
--      authenticated onde não há policy — mas TRUNCATE/REFERENCES/TRIGGER
--      não passam pela RLS, e anon não tem nenhum uso legítimo.
--   2. As 2 trigger functions (set_weekly_schedule_row_updated_at,
--      audit_weekly_schedule_config_change) ficaram com EXECUTE para
--      PUBLIC/anon/authenticated/service_role (default do schema).
--      Funções `returns trigger` não são invocáveis diretamente, e o
--      PostgreSQL só verifica EXECUTE ao CRIAR o trigger, não ao dispará-lo
--      — logo nenhum papel precisa de EXECUTE para que os triggers
--      continuem funcionando.
--
-- Esta migration só REVOGA. Nada é criado, apagado ou alterado em dados,
-- colunas, corpos de função, assinaturas, search_path, owners, RLS ou
-- policies. Privilégios preservados (uso confirmado no código):
--   - authenticated: SELECT nas 9 tabelas (leitura via RLS pelo client de
--     sessão: registro documental, detalhe do e-mail, dashboard Financeiro);
--     INSERT + UPDATE em project_weekly_schedule_ingestion_configs
--     (UPDATE por coluna, como na 120000) e project_schedule_risk_thresholds
--     (policies *_admin_only); EXECUTE nas RPCs SECURITY DEFINER.
--   - service_role: tudo (worker weekly-schedule-email-ingest.mjs grava
--     intakes, comparações, workbooks/sheets, alertas).
--   - postgres: owner (implícito).
-- Escritas de authenticated nas outras 7 tabelas nunca existiram (sem
-- policy => já negadas pela RLS; toda escrita humana passa pelas RPCs).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Trigger functions: nenhum papel precisa de EXECUTE
-- ------------------------------------------------------------
revoke all on function public.set_weekly_schedule_row_updated_at() from public;
revoke all on function public.set_weekly_schedule_row_updated_at() from anon;
revoke all on function public.set_weekly_schedule_row_updated_at() from authenticated;
revoke all on function public.set_weekly_schedule_row_updated_at() from service_role;

revoke all on function public.audit_weekly_schedule_config_change() from public;
revoke all on function public.audit_weekly_schedule_config_change() from anon;
revoke all on function public.audit_weekly_schedule_config_change() from authenticated;
revoke all on function public.audit_weekly_schedule_config_change() from service_role;

-- ------------------------------------------------------------
-- 2. Tabelas: anon e PUBLIC sem nenhum privilégio
-- ------------------------------------------------------------
revoke all on table public.project_weekly_schedule_ingestion_configs from public, anon;
revoke all on table public.project_schedule_risk_thresholds from public, anon;
revoke all on table public.project_schedule_baselines from public, anon;
revoke all on table public.weekly_schedule_email_intakes from public, anon;
revoke all on table public.schedule_version_comparisons from public, anon;
revoke all on table public.weekly_report_workbooks from public, anon;
revoke all on table public.weekly_report_sheets from public, anon;
revoke all on table public.weekly_schedule_ingestion_alerts from public, anon;
revoke all on table public.email_document_review_events from public, anon;

-- ------------------------------------------------------------
-- 3. Tabelas: authenticated fica só com o que a aplicação usa
--    (DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN nunca são necessários
--    ao navegador; TRUNCATE/REFERENCES/TRIGGER não são cobertos pela RLS)
-- ------------------------------------------------------------
revoke delete, truncate, references, trigger, maintain on table public.project_weekly_schedule_ingestion_configs from authenticated;
revoke delete, truncate, references, trigger, maintain on table public.project_schedule_risk_thresholds from authenticated;

-- Tabelas sem policy de escrita para authenticated: só SELECT (RLS).
revoke insert, update, delete, truncate, references, trigger, maintain on table public.project_schedule_baselines from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.weekly_schedule_email_intakes from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.schedule_version_comparisons from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.weekly_report_workbooks from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.weekly_report_sheets from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.weekly_schedule_ingestion_alerts from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.email_document_review_events from authenticated;

-- ------------------------------------------------------------
-- 4. Registro do estado esperado (auto-verificação; falha => rollback
--    da migration inteira, nada fica meio aplicado)
-- ------------------------------------------------------------
do $$
declare
  v_table text;
  v_fn text;
begin
  foreach v_table in array array[
    'project_weekly_schedule_ingestion_configs', 'project_schedule_risk_thresholds',
    'project_schedule_baselines', 'weekly_schedule_email_intakes',
    'schedule_version_comparisons', 'weekly_report_workbooks', 'weekly_report_sheets',
    'weekly_schedule_ingestion_alerts', 'email_document_review_events'
  ] loop
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'hardening falhou: anon ainda tem privilégio em %', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception 'hardening falhou: authenticated perdeu SELECT em %', v_table;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_table, 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'hardening falhou: authenticated ainda tem DELETE/TRUNCATE/REFERENCES/TRIGGER em %', v_table;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'hardening falhou: service_role perdeu privilégio em %', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass) then
      raise exception 'hardening falhou: RLS desabilitada em %', v_table;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.project_weekly_schedule_ingestion_configs', 'INSERT')
     or not has_table_privilege('authenticated', 'public.project_schedule_risk_thresholds', 'INSERT, UPDATE')
     or not has_column_privilege('authenticated', 'public.project_weekly_schedule_ingestion_configs', 'enabled', 'UPDATE') then
    raise exception 'hardening falhou: privilégios administrativos de configuração perdidos';
  end if;

  foreach v_fn in array array['set_weekly_schedule_row_updated_at', 'audit_weekly_schedule_config_change'] loop
    if has_function_privilege('anon', ('public.' || v_fn || '()')::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', ('public.' || v_fn || '()')::regprocedure, 'EXECUTE')
       or has_function_privilege('service_role', ('public.' || v_fn || '()')::regprocedure, 'EXECUTE') then
      raise exception 'hardening falhou: % ainda executável por papel de aplicação', v_fn;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename in (
    'project_weekly_schedule_ingestion_configs', 'project_schedule_risk_thresholds',
    'project_schedule_baselines', 'weekly_schedule_email_intakes',
    'schedule_version_comparisons', 'weekly_report_workbooks', 'weekly_report_sheets',
    'weekly_schedule_ingestion_alerts', 'email_document_review_events')) <> 13 then
    raise exception 'hardening falhou: número de policies diferente de 13';
  end if;
end;
$$;

notify pgrst, 'reload schema';

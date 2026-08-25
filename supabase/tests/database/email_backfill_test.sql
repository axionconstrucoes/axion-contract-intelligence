-- ============================================================
-- email_backfill_test.sql
-- Testes pgTAP do backfill de e-mail acionado por inclusão/
-- reativação/remoção de membro (Tarefa 5).
--
-- Executar com: supabase test db
-- Roda inteiro dentro de uma transação revertida no final — nada
-- persiste, nenhuma chamada real ao Gmail acontece (não existe
-- nem é simulada aqui).
-- ============================================================

begin;

select plan(15);

create schema if not exists test_helpers;
grant usage on schema test_helpers to authenticated;

create or replace function test_helpers.login(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create or replace function test_helpers.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- ---------- fixtures ----------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('e1000000-0000-0000-0000-000000000001', 'email-admin@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000002', 'email-membro-a@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000003', 'email-membro-b@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000004', 'email-membro-c@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated');

insert into public.email_accounts (id, email_address, display_name, status)
values ('e2000000-0000-0000-0000-000000000001', 'contrato-teste@axion.com.br', 'AXION Teste', 'CONNECTED');

-- Projeto 1: SEM configuração de ingestão (cenário "não configurado").
insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date, project_start_date)
values ('e0000000-0000-0000-0000-000000000001', 'TEST-EMAIL-P1', 'Projeto E-mail 1 (sem config)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2027-01-01', '2026-03-01');

-- Projeto 2: COM configuração, mas SEM project_start_date (cenário "data ausente").
insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date, project_start_date)
values ('e0000000-0000-0000-0000-000000000002', 'TEST-EMAIL-P2', 'Projeto E-mail 2 (sem data contratual)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2027-01-01', null);

insert into public.project_email_ingestion_configs (project_id, enabled, window_mode, email_account_id)
values ('e0000000-0000-0000-0000-000000000002', true, 'FROM_PROJECT_START', 'e2000000-0000-0000-0000-000000000001');

-- Projeto 3: COM configuração e COM project_start_date (cenário "feliz").
insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date, project_start_date)
values ('e0000000-0000-0000-0000-000000000003', 'TEST-EMAIL-P3', 'Projeto E-mail 3 (completo)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2027-01-01', '2026-03-01');

insert into public.project_email_ingestion_configs (project_id, enabled, window_mode, email_account_id)
values ('e0000000-0000-0000-0000-000000000003', true, 'FROM_PROJECT_START', 'e2000000-0000-0000-0000-000000000001');

insert into public.project_memberships (project_id, user_id, permission, status)
values
  ('e0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE'),
  ('e0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE'),
  ('e0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE');

-- ---------- 1. projeto sem configuração de ingestão: não bloqueia a inclusão, não enfileira ----------

select test_helpers.login('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.add_project_member('e0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'COLABORADOR', null)$$,
  'Inclusão de membro funciona normalmente mesmo sem configuração de ingestão de e-mail'
);

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000001'),
  0,
  'Nenhum sync_run é criado quando o projeto não tem configuração de ingestão'
);

select test_helpers.logout();

select is(
  (select count(*)::int from public.audit_log_entries where project_id = 'e0000000-0000-0000-0000-000000000001' and action = 'EMAIL_BACKFILL_SKIPPED_NO_CONFIG'),
  1,
  'EMAIL_BACKFILL_SKIPPED_NO_CONFIG registrado em audit_log_entries'
);

-- ---------- 2. projeto com configuração mas sem data contratual: bloqueado, erro operacional registrado ----------

select test_helpers.login('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.add_project_member('e0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'COLABORADOR', null)$$,
  'Inclusão de membro funciona normalmente mesmo com o backfill bloqueado (data contratual ausente)'
);

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000002'),
  0,
  'Nenhum sync_run é criado quando project_start_date está ausente (nunca usa a data de inclusão silenciosamente)'
);

select test_helpers.logout();

select is(
  (select count(*)::int from public.audit_log_entries where project_id = 'e0000000-0000-0000-0000-000000000002' and action = 'EMAIL_BACKFILL_BLOCKED_MISSING_CONTRACT_DATE'),
  1,
  'EMAIL_BACKFILL_BLOCKED_MISSING_CONTRACT_DATE registrado em audit_log_entries'
);

-- ---------- 3. caminho feliz: inclusão aciona backfill desde project_start_date ----------

select test_helpers.login('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.add_project_member('e0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'COLABORADOR', null)$$,
  'Administrador inclui membro no projeto 3 (configuração completa)'
);

select is(
  (select status::text from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000003'),
  'PREPARING',
  'sync_run é criado com status PREPARING (nenhuma conclusão simulada — não existe worker real nesta base)'
);

select is(
  (select pip.enabled from public.project_email_ingestion_participants pip
     join public.project_email_ingestion_configs pic on pic.id = pip.config_id
     where pic.project_id = 'e0000000-0000-0000-0000-000000000003'
       and pip.email_address = 'email-membro-a@axion.com.br'),
  true,
  'E-mail do novo membro é adicionado como participante habilitado na configuração de ingestão'
);

-- ---------- 4. execução repetida sem duplicidade (idempotência) ----------

select test_helpers.login('e1000000-0000-0000-0000-000000000001');

select public.add_project_member('e0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'COLABORADOR', null);

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000003'),
  1,
  'Incluir um segundo membro no mesmo projeto NÃO cria um segundo sync_run enquanto o primeiro ainda está PREPARING/RUNNING (idempotente)'
);

-- ---------- 5. suspensão: interrompe buscas futuras, preserva o já importado ----------

select public.set_project_member_status('e0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'INACTIVE');

select is(
  (select pip.enabled from public.project_email_ingestion_participants pip
     join public.project_email_ingestion_configs pic on pic.id = pip.config_id
     where pic.project_id = 'e0000000-0000-0000-0000-000000000003'
       and pip.email_address = 'email-membro-a@axion.com.br'),
  false,
  'Desativar o membro desabilita seu e-mail na lista de participantes (para de considerar em buscas futuras)'
);

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000003'),
  1,
  'Desativar o membro NÃO apaga o sync_run já criado (evidência/histórico preservado)'
);

-- ---------- 6. remoção: mesma preservação, participante desabilitado ----------

select public.remove_project_member('e0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004');

select is(
  (select pip.enabled from public.project_email_ingestion_participants pip
     join public.project_email_ingestion_configs pic on pic.id = pip.config_id
     where pic.project_id = 'e0000000-0000-0000-0000-000000000003'
       and pip.email_address = 'email-membro-c@axion.com.br'),
  false,
  'Remover o membro desabilita seu e-mail na lista de participantes'
);

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000003'),
  1,
  'Remover o membro NÃO apaga nenhum sync_run já criado (nunca exclusão em cascata de evidências)'
);

-- ---------- 7. e-mail não relacionado a nenhum projeto de teste: isolamento entre projetos ----------

select is(
  (select count(*)::int from public.project_email_ingestion_sync_runs where project_id = 'e0000000-0000-0000-0000-000000000001'),
  0,
  'Projeto 1 (sem configuração) continua sem nenhum sync_run após toda a atividade nos projetos 2 e 3'
);

select test_helpers.logout();

select * from finish();

rollback;

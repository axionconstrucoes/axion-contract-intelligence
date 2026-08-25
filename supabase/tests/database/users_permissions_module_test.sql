-- ============================================================
-- users_permissions_module_test.sql
-- Testes pgTAP do módulo Usuários e Permissões (ACC).
--
-- Executar com: supabase test db
-- (requer Docker/instância local rodando as migrations — não
-- executado neste ambiente de análise; ver relatório da tarefa).
--
-- Convenção Supabase para simular RLS dentro de um teste: gravar
-- request.jwt.claims + `set local role authenticated` fazem
-- auth.uid() responder como o usuário de teste dentro da transação.
-- `reset role` volta para o superusuário (bypassa RLS e simula um
-- caminho de escrita direto na tabela, fora das RPCs/RLS — usado
-- para testar o trigger de proteção do último Administrador de forma
-- isolada de qualquer decisão de autorização da RPC).
-- ============================================================

begin;

select plan(47);

-- ---------- fixtures / helpers ----------

create schema if not exists test_helpers;

-- Sem isto, a resolução do nome test_helpers.logout() falha com
-- "permission denied for schema test_helpers" assim que o teste já
-- estiver rodando como authenticated (após o primeiro login()) — USAGE
-- em schema não tem default público como EXECUTE em função tem.
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

-- Dois projetos "normais" (para isolamento entre projetos) + um
-- terceiro isolado, com um único Administrador, dedicado ao teste do
-- trigger de proteção do último Administrador.
insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date)
values
  ('11111111-1111-1111-1111-111111111111', 'TEST-P1', 'Projeto Teste 1', 'Cliente Teste', 'ATIVO', 'Teste', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'TEST-P2', 'Projeto Teste 2', 'Cliente Teste', 'ATIVO', 'Teste', now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'TEST-P3', 'Projeto Teste 3', 'Cliente Teste', 'ATIVO', 'Teste', now(), now());

-- Usuários de teste — inserir em auth.users aciona handle_new_user(),
-- que cria o profile automaticamente (mesmo caminho do primeiro login
-- Google real).
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('a0000000-0000-0000-0000-000000000001', 'admin1@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'admin2@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', 'gestor@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000004', 'colaborador@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000005', 'leitura@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000006', 'fora@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000007', 'convidado@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated');

-- ---------- 1. domínio AXION válido ----------

select is(
  (select origin::text from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
  'AXION_INTERNO',
  'Login @axion.com.br classifica profile como AXION_INTERNO'
);

-- ---------- memberships base (fora de RLS, para montar o cenário) ----------

insert into public.project_memberships (project_id, user_id, permission, status, area)
values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE', 'DIRETORIA'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'ADMINISTRADOR', 'ACTIVE', 'FINANCEIRO'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003', 'GESTOR', 'ACTIVE', 'ENGENHARIA'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 'COLABORADOR', 'ACTIVE', 'JURÍDICO'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'LEITURA', 'ACTIVE', null),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE', 'COMERCIAL'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000004', 'LEITURA', 'ACTIVE', 'PLANEJAMENTO'),
  ('33333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE', null);

-- ---------- 2. não membro sem acesso ----------

select test_helpers.login('a0000000-0000-0000-0000-000000000006');

select is(
  (select count(*)::int from public.projects where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Não membro não enxerga o projeto via RLS (SELECT projects)'
);

select is(
  (select count(*)::int from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Não membro não enxerga memberships do projeto via RLS'
);

select throws_like(
  $$select public.add_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000007', 'LEITURA', null)$$,
  '%Apenas administradores do projeto%',
  'Não membro não consegue chamar add_project_member (alvo é outro usuário, não a própria membership)'
);

select test_helpers.logout();

-- ---------- 2b. compatibilidade ADMIN/EDITOR/VIEWER (legado) por papel ----------
-- has_project_permission continua aceitando os 3 rótulos antigos como
-- p_min (usados em dezenas de policies de outras features). Matriz
-- completa dos 4 papéis novos contra os 3 níveis legados — testada
-- aqui, com os fixtures ainda intocados (nenhuma mutação rodou
-- ainda), para não depender de estado alterado por seções
-- posteriores.
--   ADMINISTRADOR >= ADMIN, EDITOR e VIEWER
--   GESTOR        >= EDITOR e VIEWER, mas NÃO >= ADMIN
--   COLABORADOR   >= EDITOR e VIEWER, mas NÃO >= ADMIN (GESTOR é
--                    provisoriamente equivalente a COLABORADOR nas
--                    features antigas, até seu escopo ser definido)
--   LEITURA       >= VIEWER apenas

select test_helpers.login('a0000000-0000-0000-0000-000000000001'); -- ADMINISTRADOR

select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'ADMIN'), 'ADMINISTRADOR satisfaz p_min legado ADMIN');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'EDITOR'), 'ADMINISTRADOR satisfaz p_min legado EDITOR');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'VIEWER'), 'ADMINISTRADOR satisfaz p_min legado VIEWER');

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000003'); -- GESTOR

select ok(not public.has_project_permission('11111111-1111-1111-1111-111111111111', 'ADMIN'), 'GESTOR NÃO satisfaz p_min legado ADMIN');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'EDITOR'), 'GESTOR satisfaz p_min legado EDITOR');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'VIEWER'), 'GESTOR satisfaz p_min legado VIEWER');

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000004'); -- COLABORADOR

select ok(not public.has_project_permission('11111111-1111-1111-1111-111111111111', 'ADMIN'), 'COLABORADOR NÃO satisfaz p_min legado ADMIN');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'EDITOR'), 'COLABORADOR satisfaz p_min legado EDITOR');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'VIEWER'), 'COLABORADOR satisfaz p_min legado VIEWER');

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000005'); -- LEITURA

select ok(not public.has_project_permission('11111111-1111-1111-1111-111111111111', 'ADMIN'), 'LEITURA NÃO satisfaz p_min legado ADMIN');
select ok(not public.has_project_permission('11111111-1111-1111-1111-111111111111', 'EDITOR'), 'LEITURA NÃO satisfaz p_min legado EDITOR');
select ok(public.has_project_permission('11111111-1111-1111-1111-111111111111', 'VIEWER'), 'LEITURA satisfaz p_min legado VIEWER');

select test_helpers.logout();

-- ---------- 3. Administrador adiciona membro (+ auditoria) ----------

select test_helpers.login('a0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.add_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000006', 'LEITURA', 'COMERCIAL')$$,
  'Administrador consegue adicionar novo membro ao projeto'
);

select is(
  (select permission::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000006'),
  'LEITURA',
  'Membro adicionado com o papel correto'
);

select is(
  (select count(*)::int from public.audit_log_entries
    where project_id = '11111111-1111-1111-1111-111111111111'
      and action = 'MEMBER_ADDED'
      and entity_id = 'a0000000-0000-0000-0000-000000000006'),
  1,
  'MEMBER_ADDED registrado em audit_log_entries'
);

-- ---------- 4. duplicidade de membership rejeitada ----------

select throws_like(
  $$select public.add_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000006', 'COLABORADOR', null)$$,
  '%já é membro%',
  'add_project_member rejeita membership duplicada'
);

select test_helpers.logout();

-- ---------- 5. Gestor/Colaborador/Leitura não administram membros ----------

select test_helpers.login('a0000000-0000-0000-0000-000000000003');

select throws_like(
  $$select public.add_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000006', 'LEITURA', null)$$,
  '%Apenas administradores do projeto%',
  'Gestor não consegue adicionar membro via RPC'
);

update public.project_memberships
set permission = 'LEITURA'
where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000004';

select is(
  (select permission::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'COLABORADOR',
  'Gestor não consegue alterar papel de outro membro via UPDATE direto (RLS bloqueia — 0 linhas afetadas)'
);

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000004');

select throws_like(
  $$select public.update_project_member_role('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'COLABORADOR')$$,
  '%Apenas administradores do projeto%',
  'Colaborador não consegue alterar papel de outro membro via RPC'
);

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000005');

select throws_like(
  $$select public.remove_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004')$$,
  '%Apenas administradores do projeto%',
  'Leitura não consegue remover outro membro via RPC'
);

select test_helpers.logout();

-- ---------- 6. usuário não altera a própria membership ----------

select test_helpers.login('a0000000-0000-0000-0000-000000000001');

select throws_like(
  $$select public.update_project_member_role('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'GESTOR')$$,
  '%Não é permitido alterar o próprio papel%',
  'Administrador não consegue alterar o próprio papel via RPC'
);

select throws_like(
  $$select public.set_project_member_status('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'INACTIVE')$$,
  '%Não é permitido ativar/desativar a própria membership%',
  'Administrador não consegue desativar a própria membership via RPC'
);

select throws_like(
  $$select public.remove_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001')$$,
  '%Não é permitido remover a própria membership%',
  'Administrador não consegue remover a própria membership via RPC'
);

-- RLS de tabela também bloqueia autoalteração direta (defesa em
-- profundidade, além das RPCs) — UPDATE não gera erro, apenas afeta
-- 0 linhas, pois a policy exclui a própria linha do conjunto editável.
update public.project_memberships
set permission = 'GESTOR'
where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000001';

select is(
  (select permission::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000001'),
  'ADMINISTRADOR',
  'RLS bloqueia UPDATE direto da própria membership (0 linhas afetadas, papel inalterado)'
);

select test_helpers.logout();

-- ---------- 7. projeto não pode ficar sem Administrador ativo ----------
-- Testado diretamente no trigger (fora de RLS, como superusuário) —
-- via RPC isso nunca é alcançável por outra pessoa: para chamar a
-- RPC como Administrador sem alvejar a si mesmo é preciso um segundo
-- Administrador; e com 2 Administradores, rebaixar/remover um deles
-- nunca resulta em 0 (sempre resta o outro). A proteção do banco
-- existe justamente para o caminho direto (service role, bug futuro
-- em alguma RPC etc.) — daí testá-la isolada do RLS/self-block.

-- 7a. positivo: com 2 admins ativos, rebaixar um deles é permitido.
select test_helpers.login('a0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.update_project_member_role('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'GESTOR')$$,
  'Rebaixar um Administrador é permitido quando ainda resta outro Administrador ativo'
);

-- desfaz para não afetar o restante do arquivo
select public.update_project_member_role('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'ADMINISTRADOR');

select test_helpers.logout();

-- 7b. negativo: trigger bloqueia DELETE/UPDATE do único Administrador
-- ativo do projeto 3, independente de quem/como a operação é feita.
select throws_like(
  $$delete from public.project_memberships where project_id = '33333333-3333-3333-3333-333333333333' and user_id = 'a0000000-0000-0000-0000-000000000001'$$,
  '%sem nenhum Administrador ativo%',
  'Trigger bloqueia remover o último Administrador ativo do projeto (caminho direto na tabela)'
);

select throws_like(
  $$update public.project_memberships set permission = 'GESTOR' where project_id = '33333333-3333-3333-3333-333333333333' and user_id = 'a0000000-0000-0000-0000-000000000001'$$,
  '%sem nenhum Administrador ativo%',
  'Trigger bloqueia rebaixar o último Administrador ativo do projeto (caminho direto na tabela)'
);

select throws_like(
  $$update public.project_memberships set status = 'INACTIVE' where project_id = '33333333-3333-3333-3333-333333333333' and user_id = 'a0000000-0000-0000-0000-000000000001'$$,
  '%sem nenhum Administrador ativo%',
  'Trigger bloqueia desativar o último Administrador ativo do projeto (caminho direto na tabela)'
);

select is(
  (select permission::text from public.project_memberships where project_id = '33333333-3333-3333-3333-333333333333' and user_id = 'a0000000-0000-0000-0000-000000000001'),
  'ADMINISTRADOR',
  'Membership do último Administrador do projeto 3 permanece intacta após as tentativas bloqueadas'
);

-- ---------- 8. desativação afeta somente aquele projeto ----------

select test_helpers.login('a0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.set_project_member_status('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 'INACTIVE')$$,
  'Administrador consegue desativar um Colaborador no projeto 1'
);

select is(
  (select status::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'INACTIVE',
  'Membership do projeto 1 fica INACTIVE'
);

select is(
  (select status::text from public.project_memberships where project_id = '22222222-2222-2222-2222-222222222222' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'ACTIVE',
  'Membership do mesmo usuário no projeto 2 continua ACTIVE (desativação não vaza entre projetos)'
);

select test_helpers.logout();
select test_helpers.login('a0000000-0000-0000-0000-000000000004');

select is(
  (select count(*)::int from public.projects where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Usuário desativado no projeto 1 perde acesso de leitura ao projeto 1'
);

select is(
  (select count(*)::int from public.projects where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'Usuário desativado no projeto 1 continua acessando o projeto 2 normalmente'
);

select test_helpers.logout();

-- reativa para não afetar os testes seguintes
select test_helpers.login('a0000000-0000-0000-0000-000000000001');
select public.set_project_member_status('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 'ACTIVE');

-- ---------- 9. papel e área diferentes em projetos diferentes ----------
-- Mesmo usuário (0004): COLABORADOR/JURÍDICO no projeto 1,
-- LEITURA/PLANEJAMENTO no projeto 2 — papel e área são atributos da
-- membership (por projeto), nunca do profile.

select is(
  (select permission::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'COLABORADOR',
  'Papel do usuário no projeto 1 é COLABORADOR'
);

select is(
  (select permission::text from public.project_memberships where project_id = '22222222-2222-2222-2222-222222222222' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'LEITURA',
  'Mesmo usuário tem papel LEITURA no projeto 2'
);

select is(
  (select area::text from public.project_memberships where project_id = '11111111-1111-1111-1111-111111111111' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'JURÍDICO',
  'Área do usuário no projeto 1 é JURÍDICO'
);

select is(
  (select area::text from public.project_memberships where project_id = '22222222-2222-2222-2222-222222222222' and user_id = 'a0000000-0000-0000-0000-000000000004'),
  'PLANEJAMENTO',
  'Mesmo usuário tem área PLANEJAMENTO no projeto 2'
);

-- ---------- 10. auditoria de cada operação administrativa ----------

select lives_ok(
  $$select public.update_project_member_role('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'COLABORADOR')$$,
  'Administrador altera papel de Leitura para Colaborador'
);
select is(
  (select count(*)::int from public.audit_log_entries where project_id = '11111111-1111-1111-1111-111111111111' and action = 'MEMBER_ROLE_CHANGED' and entity_id = 'a0000000-0000-0000-0000-000000000005'),
  1,
  'MEMBER_ROLE_CHANGED registrado em audit_log_entries'
);

select public.set_project_member_status('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'INACTIVE');
select is(
  (select count(*)::int from public.audit_log_entries where project_id = '11111111-1111-1111-1111-111111111111' and action = 'MEMBER_DEACTIVATED' and entity_id = 'a0000000-0000-0000-0000-000000000005'),
  1,
  'MEMBER_DEACTIVATED registrado em audit_log_entries'
);

select public.set_project_member_status('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'ACTIVE');
select is(
  (select count(*)::int from public.audit_log_entries where project_id = '11111111-1111-1111-1111-111111111111' and action = 'MEMBER_REACTIVATED' and entity_id = 'a0000000-0000-0000-0000-000000000005'),
  1,
  'MEMBER_REACTIVATED registrado em audit_log_entries'
);

select public.remove_project_member('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.audit_log_entries where project_id = '11111111-1111-1111-1111-111111111111' and action = 'MEMBER_REMOVED' and entity_id = 'a0000000-0000-0000-0000-000000000005'),
  1,
  'MEMBER_REMOVED registrado em audit_log_entries'
);

select test_helpers.logout();

-- (a matriz completa de compatibilidade ADMIN/EDITOR/VIEWER por papel
-- já foi testada na seção 2b, com os fixtures ainda intocados)

select * from finish();

rollback;

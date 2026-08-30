-- ============================================================
-- Fixtures para a prova de concorrência do vínculo contratual
-- (migration 20260829090000). NÃO EXECUTADO NESTA RODADA — só roda
-- dentro do banco descartável do plano de validação (ver relatório),
-- nunca contra o Supabase local existente do projeto nem contra
-- remoto.
--
-- CONTRATO IMPLÍCITO COM O RUNNER: o runner
-- (run-contractual-link-concurrency-test.mjs) SEMPRE roda
-- contractual-link-concurrency-cleanup.sql imediatamente ANTES deste
-- arquivo, toda vez (nunca confia em ON CONFLICT DO UPDATE para
-- "resetar" um vínculo pré-existente — um UPDATE desses nas 4 colunas
-- contractual_* passaria pelo trigger de validação, que exige a GUC
-- interna E um auth.uid() válido, nenhum dos dois disponível fora de
-- uma chamada real às RPCs). Por isso os INSERTs abaixo são diretos
-- (sem ON CONFLICT DO UPDATE nas colunas contratuais) — se alguma
-- linha já existir quando este arquivo roda, é sinal de que a
-- pré-limpeza falhou, e o INSERT vai falhar com um erro determinístico
-- (unique_violation) em vez de silenciosamente aceitar um estado
-- desconhecido.
--
-- Pré-condição (mesma do supabase/seed.sql do próprio projeto): já
-- existe um usuário no Supabase Auth com email
-- auth-login-test@axion-test.local e profile correspondente (criado
-- pelo trigger public.handle_new_user() numa autenticação real) —
-- este arquivo NÃO cria usuário/profile, só reaproveita. AUSÊNCIA
-- dessa pré-condição produz um ERRO SQL real e detectável (RAISE
-- EXCEPTION dentro de um bloco DO, com SQLSTATE não-00000) — nunca um
-- `\quit` de psql, que encerraria a sessão persistente e nunca
-- emitiria o marcador de conclusão que o runner espera (o runner
-- ficaria pendurado esperando um marcador que nunca chega).
--
-- Cria DOIS pais contratuais válidos (contrato-base + aditivo — usados
-- pelo teste real de NULL/false/true em p_confirm_parent_change, que
-- precisa trocar de um pai para outro de verdade) e um documento filho
-- não contratual, ainda sem vínculo. UUIDs fixos e determinísticos
-- (prefixo 99999999-...) — nunca colidem com o UUID fixo do seed DEV
-- real (00000000-...).
-- ============================================================

do $$
declare
  v_test_user_id uuid;
begin
  select id
    into strict v_test_user_id
    from public.profiles
    where email = 'auth-login-test@axion-test.local';
exception
  when no_data_found then
    raise exception 'FIXTURE_PRECONDITION_MISSING: nenhum profile com email auth-login-test@axion-test.local. Crie o usuário Auth de teste antes (mesma pré-condição de supabase/seed.sql) — nunca insira direto em auth.users.';
  when too_many_rows then
    raise exception 'FIXTURE_PRECONDITION_AMBIGUOUS: mais de um profile com email auth-login-test@axion-test.local.';
end $$;

select id as test_user_id
from public.profiles
where email = 'auth-login-test@axion-test.local' \gset

-- PROJECTS/MEMBERSHIPS SÃO EFETIVAMENTE PERMANENTES nesta stack
-- descartável (descoberto rodando de verdade nesta rodada, nunca
-- presumido): audit_log_entries é append-only (trigger
-- prevent_audit_log_entry_mutation — DELETE nela é sempre recusado) e
-- toda chamada às RPCs de vínculo grava uma linha ali com este
-- project_id, então o projeto NUNCA fica sem linha de auditoria
-- associada para permitir seu DELETE (FK restrict); e a membership
-- ADMINISTRADOR não pode ser removida sozinha de qualquer forma
-- (trigger prevent_last_administrator_removal — "projeto ficaria sem
-- nenhum Administrador ativo"). Por isso projects/project_memberships
-- usam ON CONFLICT DO NOTHING (idempotente, cria só na primeira vez) e
-- NUNCA são apagados pelo cleanup — só os DOCUMENTOS (sem essas
-- proteções) são recriados a cada cenário.
insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date)
values
  ('99999999-9999-4999-8999-999999999901', 'CONC-TEST-A', 'Projeto de teste de concorrência A', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31'),
  ('99999999-9999-4999-8999-999999999902', 'CONC-TEST-B', 'Projeto de teste de concorrência B', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
on conflict (id) do nothing;

insert into public.project_memberships (project_id, user_id, permission, status)
values
  ('99999999-9999-4999-8999-999999999901', :'test_user_id', 'ADMINISTRADOR', 'ACTIVE'),
  ('99999999-9999-4999-8999-999999999902', :'test_user_id', 'ADMINISTRADOR', 'ACTIVE')
on conflict (project_id, user_id) do nothing;

insert into public.documents (id, project_id, kind, title)
values
  ('99999999-9999-4999-8999-999999999911', '99999999-9999-4999-8999-999999999901', 'CONTRATO_BASE', 'Contrato de teste de concorrência (pai A)'),
  ('99999999-9999-4999-8999-999999999913', '99999999-9999-4999-8999-999999999901', 'ADITIVO', 'Aditivo de teste de concorrência (pai B)'),
  ('99999999-9999-4999-8999-999999999912', '99999999-9999-4999-8999-999999999901', 'PROPOSTA_COMERCIAL', 'Proposta de teste de concorrência (filho)');

\echo ACC_KV test_user_id=:test_user_id
\echo 'Fixtures prontas.'

-- ============================================================
-- document_safe_delete_test.sql
-- Testes pgTAP de public.delete_project_document (Tarefa 3 —
-- validação funcional segura da exclusão documental).
--
-- Executar com: supabase test db
--
-- Roda inteiro dentro de uma transação revertida no final (rollback)
-- — nenhuma linha de fixture ou exclusão persiste após o teste.
-- ============================================================

begin;

select plan(13);

-- ---------- helpers (mesmo padrão de users_permissions_module_test.sql;
-- cada arquivo pgTAP roda em sua própria transação isolada, então o
-- schema/funções precisam ser recriados aqui também) ----------

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

insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date)
values
  ('d0000000-0000-0000-0000-000000000001', 'TEST-DEL-P1', 'Projeto Exclusão 1', 'Cliente Teste', 'ATIVO', 'Teste', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', 'TEST-DEL-P2', 'Projeto Exclusão 2', 'Cliente Teste', 'ATIVO', 'Teste', now(), now());

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('d1000000-0000-0000-0000-000000000001', 'docadmin@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated'),
  ('d1000000-0000-0000-0000-000000000002', 'doccolab@axion.com.br', '{}'::jsonb, 'authenticated', 'authenticated');

insert into public.project_memberships (project_id, user_id, permission, status, area)
values
  ('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'ADMINISTRADOR', 'ACTIVE', 'ENGENHARIA'),
  ('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'COLABORADOR', 'ACTIVE', 'ENGENHARIA');

-- doc-A: sem vínculo protegido — deve poder ser excluído.
-- doc-B: versão é evidência de um evento — exclusão deve ser bloqueada.
-- doc-C: referenciado diretamente no Event Ledger — exclusão bloqueada.
-- doc-D: documento não relacionado no MESMO projeto — deve sobreviver.
-- doc-E: documento em OUTRO projeto — deve permanecer intocado.
insert into public.documents (id, project_id, kind, title)
values
  ('d2000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'CONTRATO_BASE', 'Doc A — sem vínculo'),
  ('d2000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000001', 'ADITIVO', 'Doc B — evidência de evento'),
  ('d2000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000001', 'ADITIVO', 'Doc C — referenciado no Ledger'),
  ('d2000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000001', 'PLANILHA', 'Doc D — não relacionado (mesmo projeto)'),
  ('d2000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-000000000002', 'CONTRATO_BASE', 'Doc E — outro projeto');

insert into public.document_versions (id, document_id, version_label, version_index, document_date, source_type, author, summary)
values
  ('d3000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-00000000000a', '1.0', 1, current_date, 'CONTRATO', 'Teste', 'Versão A'),
  ('d3000000-0000-0000-0000-00000000000b', 'd2000000-0000-0000-0000-00000000000b', '1.0', 1, current_date, 'CONTRATO', 'Teste', 'Versão B'),
  ('d3000000-0000-0000-0000-00000000000c', 'd2000000-0000-0000-0000-00000000000c', '1.0', 1, current_date, 'CONTRATO', 'Teste', 'Versão C'),
  ('d3000000-0000-0000-0000-00000000000d', 'd2000000-0000-0000-0000-00000000000d', '1.0', 1, current_date, 'CONTRATO', 'Teste', 'Versão D'),
  ('d3000000-0000-0000-0000-00000000000e', 'd2000000-0000-0000-0000-00000000000e', '1.0', 1, current_date, 'CONTRATO', 'Teste', 'Versão E');

insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_label)
values
  ('d4000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', now(), 'Evento de teste', 'Descrição', 'CONTRATO', 'NOVO', 'LEGACY', 'Fixture de teste');

-- Doc B protegido por ser evidência de evento.
insert into public.event_evidence (event_id, source_type, label, locator, document_version_id)
values ('d4000000-0000-0000-0000-000000000001', 'CONTRATO', 'Evidência doc B', 'doc-b-locator', 'd3000000-0000-0000-0000-00000000000b');

-- Doc C protegido por referência direta no Event Ledger.
insert into public.event_cross_references (event_id, kind, document_id, note)
values ('d4000000-0000-0000-0000-000000000001', 'CONTRATO_ADITIVO', 'd2000000-0000-0000-0000-00000000000c', 'Referência direta ao doc C');

-- ---------- 1. autorização: não-Administrador não pode excluir ----------

select test_helpers.login('d1000000-0000-0000-0000-000000000002'); -- COLABORADOR

select throws_like(
  $$select public.delete_project_document('d2000000-0000-0000-0000-00000000000a')$$,
  '%Somente Administrador ativo%',
  'Colaborador não consegue excluir documento'
);

select test_helpers.logout();

select is(
  (select count(*)::int from public.documents where id = 'd2000000-0000-0000-0000-00000000000a'),
  1,
  'Doc A permanece após tentativa de exclusão sem autorização'
);

-- ---------- 2. documento inexistente ----------

select test_helpers.login('d1000000-0000-0000-0000-000000000001'); -- ADMINISTRADOR

select throws_like(
  $$select public.delete_project_document('d2000000-0000-0000-0000-00000000000f')$$,
  '%Documento não encontrado%',
  'Excluir documento inexistente falha com mensagem clara'
);

-- ---------- 3. proteção forense: evidência de evento ----------

select throws_like(
  $$select public.delete_project_document('d2000000-0000-0000-0000-00000000000b')$$,
  '%evidência de evento%',
  'Doc B (evidência de evento) não pode ser excluído'
);

select is(
  (select count(*)::int from public.documents where id = 'd2000000-0000-0000-0000-00000000000b'),
  1,
  'Doc B permanece após tentativa bloqueada'
);

-- ---------- 4. proteção forense: referência direta no Ledger ----------

select throws_like(
  $$select public.delete_project_document('d2000000-0000-0000-0000-00000000000c')$$,
  '%referência no Event Ledger%',
  'Doc C (referenciado no Ledger) não pode ser excluído'
);

select is(
  (select count(*)::int from public.documents where id = 'd2000000-0000-0000-0000-00000000000c'),
  1,
  'Doc C permanece após tentativa bloqueada'
);

-- ---------- 5. exclusão do documento correto (sem vínculo protegido) ----------

select lives_ok(
  $$select public.delete_project_document('d2000000-0000-0000-0000-00000000000a')$$,
  'Administrador ativo exclui Doc A (sem vínculo protegido) com sucesso'
);

select is(
  (select count(*)::int from public.documents where id = 'd2000000-0000-0000-0000-00000000000a'),
  0,
  'Doc A não existe mais após exclusão'
);

select is(
  (select count(*)::int from public.document_versions where document_id = 'd2000000-0000-0000-0000-00000000000a'),
  0,
  'Versões do Doc A foram removidas em cascata'
);

-- ---------- 6. preservação de documentos não relacionados ----------

select is(
  (select count(*)::int from public.documents where id = 'd2000000-0000-0000-0000-00000000000d'),
  1,
  'Doc D (mesmo projeto, não relacionado) permanece intacto'
);

-- Doc E fica em outro projeto, do qual o Administrador de teste não é
-- membro — checagem de integridade de dados (não de visibilidade RLS),
-- então faz sentido conferir como superusuário (test_helpers.logout()).
select test_helpers.logout();

select is(
  (select count(*)::int from public.documents where project_id = 'd0000000-0000-0000-0000-000000000002'),
  1,
  'Doc E (outro projeto) permanece intacto'
);

-- ---------- 7. auditoria ----------

select is(
  (select count(*)::int from public.audit_log_entries
    where project_id = 'd0000000-0000-0000-0000-000000000001'
      and action = 'DOCUMENT_DELETED'
      and entity_id = 'd2000000-0000-0000-0000-00000000000a'),
  1,
  'DOCUMENT_DELETED registrado em audit_log_entries para o Doc A'
);

select * from finish();

rollback;

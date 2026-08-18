-- ============================================================
-- supabase/seed.sql
--
-- Arquivo destinado a DESENVOLVIMENTO (ambiente DEV). Não contém dado
-- de cliente real.
--
-- Pré-condição obrigatória: já deve existir um usuário no Supabase Auth
-- (auth.users) com o e-mail auth-login-test@axion-test.local, e o
-- profile correspondente já deve ter sido criado automaticamente pelo
-- trigger public.handle_new_user(). Este seed NÃO cria usuário de
-- autenticação nem profile — só lê o profile já existente.
--
-- Aplicação ao banco DEV remoto é MANUAL, nunca automática. NÃO use
-- `supabase db reset --linked` para aplicar este arquivo — isso reseta
-- o banco inteiro. O comando previsto (não executado por este arquivo
-- em si, deve ser rodado explicitamente quando decidido):
--
--   npx supabase db query --linked -f supabase/seed.sql
--
-- ============================================================

do $$
declare
  dev_user_id uuid;
  dev_project_id constant uuid := '00000000-0000-4000-8000-000000000001';
  conflicting_id uuid;
begin
  -- Localiza o profile DEV pelo e-mail estável, exigindo exatamente uma linha.
  begin
    select id
      into strict dev_user_id
      from public.profiles
      where email = 'auth-login-test@axion-test.local';
  exception
    when no_data_found then
      raise exception 'Seed DEV abortado: nenhum profile encontrado com email auth-login-test@axion-test.local. O usuário Auth DEV é pré-condição — crie-o antes de rodar este seed.';
    when too_many_rows then
      raise exception 'Seed DEV abortado: mais de um profile encontrado com email auth-login-test@axion-test.local. O seed não pode escolher ambiguamente qual usar.';
  end;

  -- Protege contra conflito de identidade lógica: outro projeto já usando
  -- este code, mas com id diferente do UUID fixo deste seed. Não tenta
  -- trocar a PK de um projeto existente.
  select id
    into conflicting_id
    from public.projects
    where code = 'AXION-DEV-001'
      and id <> dev_project_id;

  if conflicting_id is not null then
    raise exception 'Seed DEV abortado: já existe public.projects com code = AXION-DEV-001 mas id % (diferente do UUID fixo esperado %). O seed não altera a PK de um projeto existente.', conflicting_id, dev_project_id;
  end if;

  insert into public.projects (
    id, code, name, client, status, location, contract_number, start_date, baseline_end_date
  )
  values (
    dev_project_id,
    'AXION-DEV-001',
    '[DEV] Projeto de Testes',
    'Cliente Fictício DEV',
    'ATIVO',
    'Ambiente de Desenvolvimento',
    null,
    '2026-01-01',
    '2026-12-31'
  )
  on conflict (id) do update set
    code = excluded.code,
    name = excluded.name,
    client = excluded.client,
    status = excluded.status,
    location = excluded.location,
    contract_number = excluded.contract_number,
    start_date = excluded.start_date,
    baseline_end_date = excluded.baseline_end_date;

  insert into public.project_memberships (project_id, user_id, permission)
  values (dev_project_id, dev_user_id, 'ADMIN')
  on conflict (project_id, user_id) do update set
    permission = excluded.permission;

  -- ---------- Project Documents DEV (PASSO 2.5G1A) ----------
  -- Espelha, com UUID determinístico, os documentos mock do projeto DEV
  -- em packages/mock-data/src/documents.ts (somente os ligados a
  -- dev_project_id — documentos mock do projeto "prj-industrial" ficam
  -- de fora deste lote, que não cria projeto industrial real).
  -- Mapeamento mock id -> UUID:
  --   doc-arena-contrato             -> 00000000-0000-4000-8000-000000000101
  --   doc-arena-cronograma-baseline  -> 00000000-0000-4000-8000-000000000102
  --   doc-arena-rfi-01               -> 00000000-0000-4000-8000-000000000103

  insert into public.documents (id, project_id, kind, title)
  values
    ('00000000-0000-4000-8000-000000000101', dev_project_id, 'CONTRATO_BASE',
     'Contrato de Empreitada CT-2025-0142'),
    ('00000000-0000-4000-8000-000000000102', dev_project_id, 'CRONOGRAMA_BASELINE',
     'Cronograma Baseline — Arena Multiuso Zona Norte'),
    ('00000000-0000-4000-8000-000000000103', dev_project_id, 'RFI',
     'RFI-01 — Especificação de Estrutura Metálica da Cobertura')
  on conflict (id) do update set
    project_id = excluded.project_id,
    kind = excluded.kind,
    title = excluded.title;

  -- Versão inicial (version_index = 1) de cada documento acima, espelhando
  -- os campos version/date/sourceType/author/summary do mock equivalente.
  insert into public.document_versions (
    id, document_id, version_label, version_index, document_date,
    source_type, author, summary
  )
  values
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101',
     '1.0', 1, '2025-02-05', 'CONTRATO', 'Fernanda Ribeiro',
     'Contrato de empreitada global para construção da Arena Multiuso Zona Norte.'),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102',
     'Baseline', 1, '2025-02-10', 'CRONOGRAMA', 'Carlos Eduardo Lima',
     'Cronograma físico-financeiro baseline aprovado no início do contrato.'),
    ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103',
     '1.0', 1, '2025-04-18', 'EDITAL_RFI_RFP', 'Roberto Nunes',
     'Cliente solicita esclarecimento sobre especificação técnica da estrutura metálica de cobertura.')
  on conflict (id) do update set
    document_id = excluded.document_id,
    version_label = excluded.version_label,
    version_index = excluded.version_index,
    document_date = excluded.document_date,
    source_type = excluded.source_type,
    author = excluded.author,
    summary = excluded.summary;

  -- ---------- Clauses DEV (PASSO 2.5G2B) ----------
  -- Espelha, com UUID determinístico, as cláusulas mock do contrato DEV em
  -- packages/mock-data/src/clauses.ts (somente as 3 ligadas ao contrato
  -- DEV — cls-ind-01/02, do projeto mock "prj-industrial", ficam de fora,
  -- mesma decisão já tomada para Project Documents). Todas apontam para a
  -- document_version REAL já seedada acima (contrato DEV, rev. 1.0):
  --   00000000-0000-4000-8000-000000000201
  -- Mapeamento mock id -> UUID:
  --   cls-arena-01 -> 00000000-0000-4000-8000-000000000301
  --   cls-arena-02 -> 00000000-0000-4000-8000-000000000302
  --   cls-arena-03 -> 00000000-0000-4000-8000-000000000303

  insert into public.clauses (id, document_version_id, clause_number, title, text)
  values
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201',
     '12.1', 'Prazo de execução e força maior',
     'O prazo de execução poderá ser prorrogado mediante comprovação de eventos de força maior, incluindo condições climáticas excepcionais.'),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201',
     '15.3', 'Multa por atraso injustificado',
     'Atraso injustificado na entrega sujeita a contratada a multa de 0,1% do valor contratual por dia, limitada a 10%.'),
    ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000201',
     '9.2', 'Prazo de resposta a RFIs',
     'A contratada tem prazo de 10 dias úteis para responder formalmente a solicitações de informação (RFIs) do contratante.')
  on conflict (id) do update set
    document_version_id = excluded.document_version_id,
    clause_number = excluded.clause_number,
    title = excluded.title,
    text = excluded.text;

  -- ---------- Schedule DEV (PASSO 2.5G3B) ----------
  -- Espelha, com UUID determinístico, o cronograma mock DEV em
  -- packages/mock-data/src/schedule.ts (somente as 3 atividades ligadas ao
  -- projeto DEV — sch-ind-01/02, do projeto mock "prj-industrial", ficam de
  -- fora, mesma decisão já tomada para Documents/Clauses). A ScheduleVersion
  -- aponta para a document_version REAL já seedada acima (documento
  -- CRONOGRAMA_BASELINE, rev. "Baseline"): 00000000-0000-4000-8000-000000000202.
  -- version_type = BASELINE / lifecycle_status = ISSUED / client_formalization_status
  -- = UNCLEAR (deliberado: o domínio mock atual não contém evidência suficiente
  -- para afirmar se houve formalização específica do cliente para este
  -- cronograma — não usar NOT_SUBMITTED apenas por ser o default).
  -- Mapeamento mock -> UUID:
  --   (ScheduleVersion única)         -> 00000000-0000-4000-8000-000000000401
  --   sch-arena-01 (Fundações)        -> 00000000-0000-4000-8000-000000000501
  --   sch-arena-02 (Estrutura/Cobert.) -> 00000000-0000-4000-8000-000000000502
  --   sch-arena-03 (Paisagismo)       -> 00000000-0000-4000-8000-000000000503
  -- Mapeamento de campos: mock baselineStart/baselineEnd -> baseline_start/end;
  -- mock currentStart/currentEnd -> planned_start/end (programação vigente,
  -- nunca execução real — ver decisão 2.5G3A.3); mock status -> status.

  insert into public.schedule_versions (
    id, document_version_id, version_type, lifecycle_status, client_formalization_status
  )
  values
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000202',
     'BASELINE', 'ISSUED', 'UNCLEAR')
  on conflict (id) do update set
    document_version_id = excluded.document_version_id,
    version_type = excluded.version_type,
    lifecycle_status = excluded.lifecycle_status,
    client_formalization_status = excluded.client_formalization_status;

  insert into public.schedule_activities (
    id, schedule_version_id, name, baseline_start, baseline_end, planned_start, planned_end, status
  )
  values
    ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401',
     'Fundações', '2025-02-10', '2025-04-30', '2025-02-10', '2025-05-08', 'CONCLUIDA'),
    ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000401',
     'Estrutura e Cobertura', '2025-05-01', '2025-09-30', '2025-05-01', '2025-10-20', 'ATRASADA'),
    ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000401',
     'Paisagismo', '2025-10-01', '2025-12-15', '2026-01-15', '2026-03-01', 'ATRASADA')
  on conflict (id) do update set
    schedule_version_id = excluded.schedule_version_id,
    name = excluded.name,
    baseline_start = excluded.baseline_start,
    baseline_end = excluded.baseline_end,
    planned_start = excluded.planned_start,
    planned_end = excluded.planned_end,
    status = excluded.status;
end $$;

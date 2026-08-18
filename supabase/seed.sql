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

  -- ---------- Email DEV (PASSO 2.5G4B) ----------
  -- Espelha, com UUID determinístico, os 3 e-mails mock do projeto DEV em
  -- packages/mock-data/src/emails.ts (em-ind-01/02, do projeto mock
  -- "prj-industrial", ficam de fora, mesma decisão já tomada para
  -- Documents/Clauses/Schedule). project_id direto (email não deriva de
  -- document/document_version).
  -- Mapeamento mock id -> UUID:
  --   em-arena-01 -> 00000000-0000-4000-8000-000000000601
  --   em-arena-02 -> 00000000-0000-4000-8000-000000000602
  --   em-arena-03 -> 00000000-0000-4000-8000-000000000603

  insert into public.emails (
    id, project_id, from_address, to_address, subject, sent_at, snippet
  )
  values
    ('00000000-0000-4000-8000-000000000601', dev_project_id,
     'roberto.nunes@itaguai.rj.gov.br', 'ana.souza@axion.com.br',
     'Notificação de Atraso Contratual', '2025-06-25T08:30:00-03:00',
     'Notificamos formalmente o atraso identificado no cronograma e solicitamos plano de recuperação em até 5 dias úteis.'),
    ('00000000-0000-4000-8000-000000000602', dev_project_id,
     'roberto.nunes@itaguai.rj.gov.br', 'fernanda.ribeiro@axion.com.br',
     'Aplicação de Multa Contratual', '2025-12-15T16:00:00-03:00',
     'Em referência à notificação anterior, comunicamos a aplicação da multa prevista na cláusula 15.3 do contrato.'),
    ('00000000-0000-4000-8000-000000000603', dev_project_id,
     'ana.souza@axion.com.br', 'roberto.nunes@itaguai.rj.gov.br',
     'RE: Notificação de Atraso Contratual', '2025-07-02T11:00:00-03:00',
     'Em resposta, informamos que o atraso decorre de evento climático excepcional registrado em Diário de Obra, conforme cláusula 12.1.')
  on conflict (id) do update set
    project_id = excluded.project_id,
    from_address = excluded.from_address,
    to_address = excluded.to_address,
    subject = excluded.subject,
    sent_at = excluded.sent_at,
    snippet = excluded.snippet;

  -- ---------- Event Ledger DEV (PASSO 2.5G4F) ----------
  -- Espelha, com UUID determinístico, os 5 eventos mock do projeto DEV em
  -- packages/mock-data/src/events.ts (evt-ind-01..05, do projeto mock
  -- "prj-industrial", ficam de fora, mesma decisão já tomada nos lotes
  -- anteriores). Autoria: evt-arena-01..04 = SYSTEM; evt-arena-05 = LEGACY
  -- com created_by_label = "João Pedro Alves" (createdBy mock "usr-joao"
  -- não corresponde a nenhum profile real — decisão 2.5G4E/2.5G4F, nunca
  -- inventar/substituir usuário real).
  --
  -- DEV FIXTURES ONLY. As linhas de event_ai_assessments abaixo espelham
  -- dados mock de UI e NÃO são evidência de execução real de IA.
  --
  -- Mapeamento mock id -> UUID:
  --   evt-arena-01 -> 00000000-0000-4000-8000-000000000701
  --   evt-arena-02 -> 00000000-0000-4000-8000-000000000702
  --   evt-arena-03 -> 00000000-0000-4000-8000-000000000703
  --   evt-arena-04 -> 00000000-0000-4000-8000-000000000704
  --   evt-arena-05 -> 00000000-0000-4000-8000-000000000705

  insert into public.contract_events (
    id, project_id, occurred_at, title, description, source_type, status,
    created_by_type, created_by_user_id, created_by_label
  )
  values
    ('00000000-0000-4000-8000-000000000701', dev_project_id,
     '2025-06-25T08:30:00-03:00',
     'Notificação formal do cliente sobre atraso no cronograma',
     'Prefeitura de Itaguaí notifica atraso e cobra plano de recuperação, citando possível multa contratual.',
     'EMAIL', 'EM_ANALISE', 'SYSTEM', null, null),
    ('00000000-0000-4000-8000-000000000702', dev_project_id,
     '2025-04-18T11:00:00-03:00',
     'RFI-01 recebida: especificação de estrutura metálica da cobertura',
     'Cliente formaliza RFI-01 questionando especificação técnica da estrutura metálica de cobertura.',
     'EDITAL_RFI_RFP', 'CONFRONTADO', 'SYSTEM', null, null),
    ('00000000-0000-4000-8000-000000000703', dev_project_id,
     '2025-12-15T16:00:00-03:00',
     'Cliente cobra aplicação de multa por atraso',
     'E-mail formal cobra aplicação de multa contratual por atraso, referenciando notificação anterior.',
     'EMAIL', 'EM_ANALISE', 'SYSTEM', null, null),
    ('00000000-0000-4000-8000-000000000704', dev_project_id,
     '2026-01-20T08:45:00-03:00',
     'Paralisação por falta de liberação de área pelo cliente',
     'Diário de Obra registra paralisação de 5 dias na frente de paisagismo por falta de liberação de área pelo cliente.',
     'DIARIO_OBRA', 'EM_ANALISE', 'SYSTEM', null, null),
    ('00000000-0000-4000-8000-000000000705', dev_project_id,
     '2025-02-10T09:00:00-03:00',
     'Cronograma baseline aprovado',
     'Cronograma físico-financeiro baseline aprovado formalmente no início do contrato.',
     'CRONOGRAMA', 'RESOLVIDO', 'LEGACY', null, 'João Pedro Alves')
  on conflict (id) do update set
    project_id = excluded.project_id,
    occurred_at = excluded.occurred_at,
    title = excluded.title,
    description = excluded.description,
    source_type = excluded.source_type,
    status = excluded.status,
    created_by_type = excluded.created_by_type,
    created_by_user_id = excluded.created_by_user_id,
    created_by_label = excluded.created_by_label;

  insert into public.event_categories (event_id, category)
  values
    ('00000000-0000-4000-8000-000000000701', 'NOTIFICACOES'),
    ('00000000-0000-4000-8000-000000000701', 'PRAZO'),
    ('00000000-0000-4000-8000-000000000701', 'MULTAS'),
    ('00000000-0000-4000-8000-000000000702', 'ESCOPO'),
    ('00000000-0000-4000-8000-000000000702', 'ALTERACOES_PROJETO'),
    ('00000000-0000-4000-8000-000000000703', 'MULTAS'),
    ('00000000-0000-4000-8000-000000000703', 'PENALIDADES'),
    ('00000000-0000-4000-8000-000000000703', 'NOTIFICACOES'),
    ('00000000-0000-4000-8000-000000000704', 'PRAZO'),
    ('00000000-0000-4000-8000-000000000704', 'RESPONSABILIDADES'),
    ('00000000-0000-4000-8000-000000000705', 'PRAZO')
  on conflict (event_id, category) do nothing;

  -- Evidence: doc-arena-rfi-01/doc-arena-cronograma-baseline apontam para a
  -- document_version real (não document_id), conforme decisão 2.5G4D.
  -- evt-arena-04 é locator-only (DIARIO_OBRA não tem entidade real hoje).
  insert into public.event_evidence (
    id, event_id, source_type, label, locator, document_version_id, email_id
  )
  values
    ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000701',
     'EMAIL', 'Gmail — Notificação de Atraso Contratual',
     'gmail://axion.com.br/inbox/msg-2025-0625-1', null,
     '00000000-0000-4000-8000-000000000601'),
    ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000702',
     'EDITAL_RFI_RFP', 'RFI-01 — Estrutura Metálica da Cobertura',
     'recebidos-cliente://prj-arena/RFI/RFI-01.pdf',
     '00000000-0000-4000-8000-000000000203', null),
    ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000703',
     'EMAIL', 'Gmail — Aplicação de Multa Contratual',
     'gmail://axion.com.br/inbox/msg-2025-1215-1', null,
     '00000000-0000-4000-8000-000000000602'),
    ('00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000704',
     'DIARIO_OBRA', 'Diário de Obra — Registro 2026-01-20',
     'diario-obra://prj-arena/registro/1298', null, null),
    ('00000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000705',
     'CRONOGRAMA', 'Cronograma Baseline',
     'drive://prj-arena/cronograma/baseline.pdf',
     '00000000-0000-4000-8000-000000000202', null)
  on conflict (id) do update set
    event_id = excluded.event_id,
    source_type = excluded.source_type,
    label = excluded.label,
    locator = excluded.locator,
    document_version_id = excluded.document_version_id,
    email_id = excluded.email_id;

  insert into public.event_ai_assessments (
    id, event_id, finding_type, severity, summary, confidence, requires_human_review
  )
  values
    ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000701',
     'IMPACTO_POTENCIAL', 'ALTA',
     'Notificação inicia prazo de defesa; recomenda-se resposta baseada em evento de força maior já registrado.',
     0.88, true),
    ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000702',
     'CONFLITO', 'MEDIA',
     'Especificação questionada diverge do memorial descritivo da proposta vigente.',
     0.81, true),
    ('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000703',
     'IMPACTO_POTENCIAL', 'CRITICA',
     'Cobrança formal exige resposta fundamentada nos eventos de força maior já documentados.',
     0.9, true),
    ('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000704',
     'IMPACTO_POTENCIAL', 'ALTA',
     'Atraso decorre de responsabilidade do cliente e fundamenta extensão de prazo sem ônus à Axion.',
     0.82, true)
  on conflict (id) do update set
    event_id = excluded.event_id,
    finding_type = excluded.finding_type,
    severity = excluded.severity,
    summary = excluded.summary,
    confidence = excluded.confidence,
    requires_human_review = excluded.requires_human_review;
  -- evt-arena-05 não tem linha aqui: aiAssessment é null no mock (Cronograma
  -- baseline aprovado sem achado de IA) — nunca inventar avaliação ausente.

  insert into public.event_cross_references (
    id, event_id, kind, document_id, clause_id, schedule_activity_id, email_id, note
  )
  values
    ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000701',
     'CONTRATO_ADITIVO', null, '00000000-0000-4000-8000-000000000302', null, null,
     'Cláusula de multa por atraso.'),
    ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000701',
     'CRONOGRAMA', null, null, '00000000-0000-4000-8000-000000000502', null,
     'Atividade em atraso.'),
    ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000702',
     'EDITAL_RFI_RFP', '00000000-0000-4000-8000-000000000103', null, null, null,
     'RFI original do cliente.'),
    ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000702',
     'CONTRATO_ADITIVO', null, '00000000-0000-4000-8000-000000000303', null, null,
     'Prazo contratual de resposta a RFIs.'),
    ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000703',
     'CONTRATO_ADITIVO', null, '00000000-0000-4000-8000-000000000302', null, null,
     'Cláusula de multa por atraso.'),
    ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000703',
     'COMUNICACAO', null, null, null, '00000000-0000-4000-8000-000000000601',
     'Notificação formal anterior.'),
    ('00000000-0000-4000-8000-000000001007', '00000000-0000-4000-8000-000000000704',
     'CRONOGRAMA', null, null, '00000000-0000-4000-8000-000000000503', null,
     'Impacto direto na atividade de paisagismo.'),
    ('00000000-0000-4000-8000-000000001008', '00000000-0000-4000-8000-000000000705',
     'CRONOGRAMA', '00000000-0000-4000-8000-000000000102', null, null, null,
     'Cronograma aprovado.')
  on conflict (id) do update set
    event_id = excluded.event_id,
    kind = excluded.kind,
    document_id = excluded.document_id,
    clause_id = excluded.clause_id,
    schedule_activity_id = excluded.schedule_activity_id,
    email_id = excluded.email_id,
    note = excluded.note;
end $$;

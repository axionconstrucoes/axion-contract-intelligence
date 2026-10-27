-- SEED DE HOMOLOGAÇÃO — projeto FICTÍCIO "WEG" (todos os dados são simulados).
--
-- Identificação inequívoca (impossível confundir com dado real):
--   * código do projeto  : SIM-WEG-001            (prefixo SIM- obrigatório)
--   * nome               : [HOMOLOGAÇÃO] WEG — Fábrica (FICTÍCIO)
--   * UUIDs              : 5eed0000-…  (prefixo "5eed" = seed; nenhum dado real usa esse prefixo)
--   * e-mails            : *.weg.teste@axion.com.br (nunca recebem nada: todo envio vai a crm@axion.com.br)
--   * nomes e textos     : sempre com "(SIMULADO)" / "(FICTÍCIO)"
--
-- Pré-requisito (feito FORA deste arquivo): os 4 usuários abaixo precisam existir em auth.users com
-- EXATAMENTE estes ids (Auth Admin API ou, no teste local, o stub do PGlite). Este seed NÃO escreve em auth.users.
--
-- Segurança: o seed ABORTA se o banco tiver qualquer projeto cujo código não comece com "SIM-"
-- (proteção contra execução acidental em produção) e é idempotente (ON CONFLICT DO NOTHING).
-- Não envia e-mails, não chama serviços externos.

do $guard$
begin
  if exists (select 1 from public.projects where code not like 'SIM-%') then
    raise exception 'SEED RECUSADO: o banco contém projetos que não são simulados (código sem prefixo SIM-). Este seed é exclusivo de homologação.';
  end if;
  if (select count(*) from auth.users where id in (
        '5eed0001-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000002',
        '5eed0001-0000-4000-8000-000000000003', '5eed0001-0000-4000-8000-000000000004')) <> 4 then
    raise exception 'SEED RECUSADO: crie antes os 4 usuários simulados em auth.users com os ids 5eed0001-…0001 a …0004.';
  end if;
end
$guard$;

-- Triggers de auditoria registram auth.uid() como autor: durante o seed a identidade é o usuário SIMULADO da Diretoria
-- (formato do Supabase: request.jwt.claim.sub / request.jwt.claims; app.uid = stub dos testes locais). Limpo no final.
select set_config('request.jwt.claim.sub', '5eed0001-0000-4000-8000-000000000003', false),
       set_config('request.jwt.claims', '{"sub": "5eed0001-0000-4000-8000-000000000003", "role": "authenticated"}', false),
       set_config('app.uid', '5eed0001-0000-4000-8000-000000000003', false);

-- ---------------------------------------------------------------- usuários (profiles)
insert into public.profiles (id, name, email, origin, title, avatar_initials) values
  ('5eed0001-0000-4000-8000-000000000001', 'Responsável WEG (SIMULADO)', 'responsavel.weg.teste@axion.com.br', 'AXION_INTERNO', 'Planejamento (FICTÍCIO)', 'RW'),
  ('5eed0001-0000-4000-8000-000000000002', 'Gestor WEG (SIMULADO)',      'gestor.weg.teste@axion.com.br',      'AXION_INTERNO', 'Gerência (FICTÍCIO)',      'GW'),
  ('5eed0001-0000-4000-8000-000000000003', 'Diretor WEG (SIMULADO)',     'diretor.weg.teste@axion.com.br',     'AXION_INTERNO', 'Diretoria (FICTÍCIO)',     'DW'),
  ('5eed0001-0000-4000-8000-000000000004', 'Colega fora da allowlist (SIMULADO)', 'colega.fora.allowlist@axion.com.br', 'AXION_INTERNO', 'Colaborador (FICTÍCIO)', 'CF')
-- Se um gatilho de auth.users já criou o profile (comportamento do Supabase), só os campos descritivos são atualizados.
on conflict (id) do update set name = excluded.name, origin = excluded.origin, title = excluded.title, avatar_initials = excluded.avatar_initials;

-- ---------------------------------------------------------------- projeto
insert into public.projects (id, code, name, client, status, location, contract_number, start_date, baseline_end_date, project_start_date, workspace_type)
values ('5eed0000-0000-4000-8000-000000000001', 'SIM-WEG-001', '[HOMOLOGAÇÃO] WEG — Fábrica (FICTÍCIO)', 'WEG (cliente FICTÍCIO — homologação)', 'ATIVO',
        'Local fictício — homologação', 'SIM-CT-0001', date '2026-08-01', date '2027-07-31', date '2026-08-01', 'OBRA')
on conflict (id) do nothing;

insert into public.project_memberships (project_id, user_id, permission, status, area) values
  ('5eed0000-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000001', 'COLABORADOR',   'ACTIVE', 'PLANEJAMENTO'),
  ('5eed0000-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000002', 'GESTOR',        'ACTIVE', 'PLANEJAMENTO'),
  ('5eed0000-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000003', 'ADMINISTRADOR', 'ACTIVE', 'DIRETORIA'),
  ('5eed0000-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000004', 'COLABORADOR',   'ACTIVE', 'ADMINISTRATIVO')
on conflict (project_id, user_id) do nothing;

-- ---------------------------------------------------------------- Matriz SLA (prazos REDUZIDOS só aqui) e responsáveis
insert into public.sla_project_settings (project_id, timezone, business_day_start_hour, business_day_end_hour, updated_by_user_id)
values ('5eed0000-0000-4000-8000-000000000001', 'America/Sao_Paulo', 8, 18, '5eed0001-0000-4000-8000-000000000003')
on conflict (project_id) do nothing;

-- BAIXO/MÉDIO: valores da matriz padrão (explícitos); ALTO/CRÍTICO: 1 h corrida em cada etapa (somente homologação).
insert into public.sla_matrix_rules (id, project_id, risk_level, area, time_unit, assume_deadline_value, respond_deadline_value, complete_deadline_value,
                                     escalation_2_after_value, board_after_value, notify_by_email, requires_acknowledgment_confirmation, requires_delay_justification,
                                     is_default, active, updated_by_user_id) values
  ('5eed0002-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'LOW',      null, 'BUSINESS_DAYS', 3, null, null, 3, 2, true, false, true, false, true, '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0002-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'MEDIUM',   null, 'BUSINESS_DAYS', 1, null, null, 1, 1, true, false, true, false, true, '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0002-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', 'HIGH',     null, 'CLOCK_HOURS',   1, null, null, 1, 1, true, true,  true, false, true, '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0002-0000-4000-8000-000000000004', '5eed0000-0000-4000-8000-000000000001', 'CRITICAL', null, 'CLOCK_HOURS',   1, null, null, 1, 1, true, true,  true, false, true, '5eed0001-0000-4000-8000-000000000003')
on conflict (id) do nothing;

-- Todos os alertas do módulo semanal nascem na área PLANEJAMENTO: Responsável → Gestor (Nível 2) → Diretoria (Nível 3).
insert into public.sla_area_responsibles (id, project_id, area, responsible_direct_user_id, escalation_1_user_id, board_user_id, updated_by_user_id)
values ('5eed0003-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'PLANEJAMENTO',
        '5eed0001-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000002', '5eed0001-0000-4000-8000-000000000003', '5eed0001-0000-4000-8000-000000000003')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- contrato, aditivo, cláusulas e obrigações (FICTÍCIOS)
insert into public.documents (id, project_id, kind, title) values
  ('5eed0004-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'CONTRATO_BASE', 'Contrato SIM-CT-0001 — WEG Fábrica (FICTÍCIO)'),
  ('5eed0004-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'ADITIVO',       'Aditivo 01 ao SIM-CT-0001 (FICTÍCIO)'),
  ('5eed0004-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', 'CRONOGRAMA_REVISAO', 'Cronograma semanal — SIM-WEG-001 (FICTÍCIO)')
on conflict (id) do nothing;

insert into public.document_versions (id, document_id, project_id, version_label, version_index, document_date, source_type, author, summary, processing_status, uploaded_by) values
  ('5eed0005-0000-4000-8000-000000000001', '5eed0004-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'v1', 1, date '2026-08-01', 'CONTRATO',   'Simulação', 'Contrato fictício para homologação. Nenhum dado real.', 'NOT_UPLOADED', '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0005-0000-4000-8000-000000000002', '5eed0004-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'v1', 1, date '2026-09-15', 'CONTRATO',   'Simulação', 'Aditivo fictício (prazo e escopo) para homologação.', 'NOT_UPLOADED', '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0005-0000-4000-8000-000000000003', '5eed0004-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', 'W44', 1, date '2026-10-30', 'CRONOGRAMA', 'Simulação', 'Cronograma fictício da semana 44.', 'NOT_UPLOADED', '5eed0001-0000-4000-8000-000000000001'),
  ('5eed0005-0000-4000-8000-000000000004', '5eed0004-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', 'W45', 2, date '2026-11-03', 'CRONOGRAMA', 'Simulação', 'Cronograma fictício da semana 45.', 'NOT_UPLOADED', '5eed0001-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.clauses (id, document_version_id, clause_number, title, text) values
  ('5eed0006-0000-4000-8000-000000000001', '5eed0005-0000-4000-8000-000000000001', '3.1', 'Prazo de execução (FICTÍCIA)',        'A CONTRATADA concluirá a obra em até 365 dias corridos da ordem de serviço. [TEXTO FICTÍCIO DE HOMOLOGAÇÃO]'),
  ('5eed0006-0000-4000-8000-000000000002', '5eed0005-0000-4000-8000-000000000001', '5.2', 'Multa por atraso (FICTÍCIA)',       'O atraso injustificado sujeita a CONTRATADA a multa de 0,1% ao dia sobre o valor do contrato. [TEXTO FICTÍCIO DE HOMOLOGAÇÃO]'),
  ('5eed0006-0000-4000-8000-000000000003', '5eed0005-0000-4000-8000-000000000001', '7.4', 'Medições mensais (FICTÍCIA)',        'As medições ocorrerão mensalmente, com entrega do relatório semanal até sexta-feira 18h. [TEXTO FICTÍCIO DE HOMOLOGAÇÃO]'),
  ('5eed0006-0000-4000-8000-000000000004', '5eed0005-0000-4000-8000-000000000001', '9.1', 'Segurança do trabalho (FICTÍCIA)',   'A CONTRATADA manterá DDS semanal e registro de ocorrências. [TEXTO FICTÍCIO DE HOMOLOGAÇÃO]'),
  ('5eed0006-0000-4000-8000-000000000005', '5eed0005-0000-4000-8000-000000000002', '2.1', 'Prorrogação de prazo (FICTÍCIA)',    'O prazo da cláusula 3.1 fica prorrogado em 30 dias. [TEXTO FICTÍCIO DE HOMOLOGAÇÃO]')
on conflict (id) do nothing;

insert into public.esg_obligations (id, project_id, title, category, description, source_document_version_id, clause_id, source_reference, responsible_user_id, periodicity, required_evidence_description, penalty_description, active, created_by_user_id) values
  ('5eed0007-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', 'DDS semanal (FICTÍCIA)', 'DDS', 'Diálogo diário de segurança — obrigação fictícia de homologação.',
   '5eed0005-0000-4000-8000-000000000001', '5eed0006-0000-4000-8000-000000000004', 'Cláusula 9.1 (FICTÍCIA)', '5eed0001-0000-4000-8000-000000000001', 'SEMANAL', 'Lista de presença (FICTÍCIA)', 'Multa fictícia', true, '5eed0001-0000-4000-8000-000000000003'),
  ('5eed0007-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', 'Relatório semanal ao cliente (FICTÍCIA)', 'RELATORIO', 'Entrega do relatório semanal — obrigação fictícia de homologação.',
   '5eed0005-0000-4000-8000-000000000001', '5eed0006-0000-4000-8000-000000000003', 'Cláusula 7.4 (FICTÍCIA)', '5eed0001-0000-4000-8000-000000000001', 'SEMANAL', 'E-mail com a planilha (FICTÍCIA)', 'Multa fictícia', true, '5eed0001-0000-4000-8000-000000000003')
on conflict (id) do nothing;

insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type) values
  ('5eed0008-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', timestamptz '2026-10-26 12:00+00', '[SIMULADO] Atraso de cronograma — cláusula 3.1',  'Evento fictício que contextualiza o alerta CRÍTICO da homologação.', 'CRONOGRAMA', 'NOVO', 'SYSTEM'),
  ('5eed0008-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', timestamptz '2026-10-27 12:00+00', '[SIMULADO] Relatório semanal ausente — cláusula 7.4', 'Evento fictício que contextualiza o alerta ALTO da homologação.', 'RELATORIO_SEMANAL', 'NOVO', 'SYSTEM')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- configuração do piloto (alertas de risco)
-- Todos os e-mails de alerta do projeto são ENTREGUES apenas em crm@axion.com.br (override de entrega);
-- o destinatário lógico (responsável/gestor/diretoria) é preservado. allowlist = os 3 papéis; o 4º usuário fica de fora.
insert into public.project_weekly_schedule_ingestion_configs (id, project_id, enabled, authorized_area, sender_domain, risk_alerts_enabled,
    pilot_recipient_allowlist_user_ids, risk_alert_severity_map, pilot_project_confirmed_at, pilot_project_confirmed_by_user_id, pilot_delivery_override_email,
    alert_recipient_user_ids, updated_by_user_id)
values ('5eed0009-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', true, 'PLANEJAMENTO', 'axion.com.br', true,
    array['5eed0001-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000002', '5eed0001-0000-4000-8000-000000000003']::uuid[],
    '{"MISSING_WEEKLY_SCHEDULE": "CRITICAL", "MISSING_WEEKLY_REPORT_WORKBOOK": "HIGH", "MISSING_S_CURVE": "MEDIUM"}'::jsonb,
    timestamptz '2026-10-27 12:00+00', '5eed0001-0000-4000-8000-000000000003', 'crm@axion.com.br',
    array['5eed0001-0000-4000-8000-000000000001']::uuid[], '5eed0001-0000-4000-8000-000000000003')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- FONTES dos alertas (o ciclo transforma cada fonte em um caso de risco)
-- CRÍTICO e ALTO e MÉDIO: alertas de ausência (severidade vem do mapa acima).
insert into public.weekly_schedule_ingestion_alerts (id, project_id, config_id, kind, week_start, deadline_at, recipient_user_ids, detail) values
  ('5eed000a-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '5eed0009-0000-4000-8000-000000000001', 'MISSING_WEEKLY_SCHEDULE',        date '2026-10-26', timestamptz '2026-10-30 21:00+00',
     array['5eed0001-0000-4000-8000-000000000001']::uuid[], '[SIMULADO] Cronograma semanal não recebido até o prazo (FICTÍCIO).'),
  ('5eed000a-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', '5eed0009-0000-4000-8000-000000000001', 'MISSING_WEEKLY_REPORT_WORKBOOK', date '2026-10-26', timestamptz '2026-10-30 21:00+00',
     array['5eed0001-0000-4000-8000-000000000001']::uuid[], '[SIMULADO] Planilha do relatório semanal não recebida (FICTÍCIO).'),
  ('5eed000a-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000001', '5eed0009-0000-4000-8000-000000000001', 'MISSING_S_CURVE',               date '2026-10-26', timestamptz '2026-10-30 21:00+00',
     array['5eed0001-0000-4000-8000-000000000001']::uuid[], '[SIMULADO] Curva S ausente na planilha (FICTÍCIO).')
on conflict (id) do nothing;

-- BAIXO e MÉDIO: comparações de cronograma (mais recente por tipo fica aberta).
insert into public.schedule_versions (id, document_version_id, version_type, lifecycle_status, extraction_status, extracted_at, status_date) values
  ('5eed000b-0000-4000-8000-000000000001', '5eed0005-0000-4000-8000-000000000003', 'UPDATE', 'SUPERSEDED', 'EXTRACTED', timestamptz '2026-10-30 12:00+00', timestamptz '2026-10-30 12:00+00'),
  ('5eed000b-0000-4000-8000-000000000002', '5eed0005-0000-4000-8000-000000000004', 'UPDATE', 'ISSUED',     'EXTRACTED', timestamptz '2026-11-03 12:00+00', timestamptz '2026-11-03 12:00+00')
on conflict (id) do nothing;

insert into public.schedule_version_comparisons (id, project_id, current_schedule_version_id, reference_schedule_version_id, comparison_type, status, metrics, risk_classification, risk_reasons, computed_at) values
  ('5eed000c-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001', '5eed000b-0000-4000-8000-000000000002', '5eed000b-0000-4000-8000-000000000001', 'PREVIOUS_WEEKLY',
     'COMPUTED', '{"deltaDays": 1}'::jsonb, 'LOW',    '["[SIMULADO] Variação de 1 dia no caminho crítico (FICTÍCIO)."]'::jsonb, timestamptz '2026-11-03 13:00+00'),
  ('5eed000c-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000001', '5eed000b-0000-4000-8000-000000000002', null, 'OFFICIAL_BASELINE',
     'COMPUTED', '{"deltaDays": 9}'::jsonb, 'MEDIUM', '["[SIMULADO] Desvio de 9 dias contra a linha de base (FICTÍCIO)."]'::jsonb, timestamptz '2026-11-03 13:00+00')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false), set_config('app.uid', '', false);

-- ============================================================
-- 20260822052500_esg_ssma_source_type.sql
-- Adiciona 'ESG_SSMA' à união de SourceType — necessário antes da
-- fundação de obrigações ESG/SSMA (próxima migration), pois eventos do
-- Event Ledger criados a partir de uma obrigação ESG/SSMA não cumprida
-- precisam de uma origem honesta: nenhum dos valores existentes
-- (EMAIL, DIARIO_OBRA, CONSTRUMANAGER, CONTRATO, GOOGLE_DRIVE,
-- RECEBIDOS_CLIENTE, EDITAL_RFI_RFP, CRONOGRAMA, RELATORIO_SEMANAL, ERP,
-- ORCAMENTO) descreve corretamente "o módulo de comprovação ESG/SSMA".
--
-- Três constraints afetadas (as únicas três com check(source_type in (...))
-- fora de project_integrations, que não é conceitualmente relacionada a
-- ESG/SSMA e foi deliberadamente deixada de fora):
--   contract_events.source_type
--   event_evidence.source_type
--   document_versions.source_type
-- ============================================================

alter table public.contract_events
  drop constraint if exists contract_events_source_type_check;

alter table public.contract_events
  add constraint contract_events_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO', 'ESG_SSMA'
  ));

alter table public.event_evidence
  drop constraint if exists event_evidence_source_type_check;

alter table public.event_evidence
  add constraint event_evidence_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO', 'ESG_SSMA'
  ));

alter table public.document_versions
  drop constraint if exists document_versions_source_type_check;

alter table public.document_versions
  add constraint document_versions_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO', 'ESG_SSMA'
  ));

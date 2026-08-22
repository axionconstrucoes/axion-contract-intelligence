-- ============================================================
-- 20260822053200_esg_ssma_source_type_revert.sql
-- Reverte 20260822052500_esg_ssma_source_type.sql.
--
-- Ao mapear o trabalho já existente da fundação ESG/SSMA
-- (20260822050000_esg_obligations_foundation.sql, escrita antes desta
-- migration), verificou-se que ela já resolveu a origem dos
-- contract_events gerados a partir de uma obrigação ESG/SSMA reutilizando
-- o valor 'CONTRATO' (ver review_esg_obligation_submission) em vez de
-- exigir um novo SourceType. Adicionar 'ESG_SSMA' à união ficaria como
-- uma capacidade nunca referenciada em nenhum lugar do código — revertido
-- para manter o schema e o código sempre consistentes entre si.
-- ============================================================

alter table public.contract_events
  drop constraint if exists contract_events_source_type_check;

alter table public.contract_events
  add constraint contract_events_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
  ));

alter table public.event_evidence
  drop constraint if exists event_evidence_source_type_check;

alter table public.event_evidence
  add constraint event_evidence_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
  ));

alter table public.document_versions
  drop constraint if exists document_versions_source_type_check;

alter table public.document_versions
  add constraint document_versions_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
  ));

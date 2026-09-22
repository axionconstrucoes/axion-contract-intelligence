-- ============================================================
-- 20260922090000_contract_alert_batches_weekly_auto.sql
-- Composição automática do lote semanal de alertas MÉDIO/BAIXO —
-- CRÍTICO/ALTO continuam no fluxo imediato existente (Enviar Alerta),
-- nunca entram aqui.
--
-- PROPOSTA — NÃO APLICADA nesta etapa. Puramente ADITIVA sobre
-- 20260921130000_contract_alert_batches_foundation.sql (já aplicada em
-- produção): duas colunas novas com default, mais um índice único
-- parcial. Nenhuma coluna/linha existente é alterada, nenhuma migration
-- antiga é modificada. Rollback seguro: "drop index" + "drop column"
-- (nenhuma delas é referenciada por FK de outra tabela).
--
-- Por que não basta (project_id, recipient_user_id) já ter FK composta
-- para project_memberships: essa FK garante que o par é um membership
-- válido, mas não impede dois lotes automáticos do MESMO projeto e
-- destinatário no MESMO fechamento (o requisito de idempotência
-- #4/#10-C do prompt). batch_kind distingue o lote administrativo
-- excepcional (MANUAL, comportamento e schema inalterados — cutoff_date
-- sempre null) do lote semanal automático (WEEKLY_AUTO); a chave do
-- fechamento (cutoff_date) é a data local (quarta-feira, 08:00, regra
-- aprovada) do projeto, calculada por
-- resolveContractAlertBatchWeeklyWindow
-- (apps/web/lib/email/contract-alert-batch-weekly-window.ts), que
-- reaproveita o MESMO mecanismo ICU (Intl, nunca offset fixo) já usado
-- pelo resumo semanal existente (risk-alerts/digest-window.ts) — nunca
-- um scheduler paralelo.
-- ============================================================

alter table public.contract_alert_batches
  add column batch_kind text not null default 'MANUAL'
    check (batch_kind in ('MANUAL', 'WEEKLY_AUTO'));

alter table public.contract_alert_batches
  add column cutoff_date date;

-- Consistência: só um lote WEEKLY_AUTO tem cutoff_date preenchida; um
-- lote MANUAL nunca tem (não pertence a nenhum fechamento semanal).
alter table public.contract_alert_batches
  add constraint contract_alert_batches_cutoff_date_matches_kind
  check ((batch_kind = 'WEEKLY_AUTO') = (cutoff_date is not null));

-- Idempotência real (nível de banco, não só aplicação): no máximo UM
-- lote WEEKLY_AUTO por (projeto, destinatário, fechamento) — a mesma
-- execução do job rodando duas vezes (ou duas execuções concorrentes)
-- nunca cria um segundo lote nem duplica itens, porque o segundo INSERT
-- viola esta constraint antes de qualquer item ser inserido.
create unique index contract_alert_batches_weekly_auto_idempotency_idx
  on public.contract_alert_batches (project_id, recipient_user_id, cutoff_date)
  where batch_kind = 'WEEKLY_AUTO';

comment on column public.contract_alert_batches.batch_kind is
  'MANUAL (ferramenta administrativa excepcional, sem envio automático) ou WEEKLY_AUTO (composição automática semanal de MÉDIO/BAIXO, com envio automático).';
comment on column public.contract_alert_batches.cutoff_date is
  'Data local (YYYY-MM-DD) da quarta-feira 08:00 em que este fechamento semanal ocorreu — somente para batch_kind = WEEKLY_AUTO. Calculada por resolveContractAlertBatchWeeklyWindow (lib/email/contract-alert-batch-weekly-window.ts).';

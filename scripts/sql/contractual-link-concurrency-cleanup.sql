-- ============================================================
-- Limpeza dos dados de scripts/sql/contractual-link-concurrency-fixtures.sql
-- — apaga SOMENTE as linhas com os UUIDs fixos 99999999-... criados
-- pelo fixture (nunca um DELETE amplo). Idempotente (seguro rodar de
-- novo, inclusive se o fixture nunca tiver rodado, ou se uma execução
-- anterior tiver sido interrompida no meio com dados parciais). NÃO
-- EXECUTADO NESTA RODADA.
--
-- ORDEM OBRIGATÓRIA (respeita as FKs reais do schema):
--   1. documento FILHO (referencia o pai via contractual_parent_document_id
--      ON DELETE RESTRICT — apagar o filho primeiro nunca viola essa FK,
--      já que é a linha REFERENCIANTE, não a referenciada);
--   2. documentos PAI (contrato-base + aditivo de teste).
--
-- projects/project_memberships/audit_log_entries NUNCA são apagados
-- aqui (descoberto rodando de verdade nesta rodada, não presumido):
--   - audit_log_entries é append-only — trigger
--     prevent_audit_log_entry_mutation recusa QUALQUER DELETE/UPDATE
--     nela, sempre, sem exceção;
--   - project_memberships da ADMINISTRADOR de teste não pode ser
--     removida sozinha — trigger prevent_last_administrator_removal
--     recusa deixar um projeto sem nenhum Administrador ativo;
--   - por isso projects também nunca pode perder sua última
--     audit_log_entries (FK restrict) nem sua membership de admin —
--     tentar apagá-los sempre falharia, então nem se tenta. Ver
--     CONTRATO IMPLÍCITO em contractual-link-concurrency-fixtures.sql
--     (ON CONFLICT DO NOTHING nos dois, criados só uma vez).
--
-- O runner (run-contractual-link-concurrency-test.mjs) chama isto:
--   (a) ANTES de cada fixture (pré-limpeza, nunca confia em
--       ON CONFLICT DO UPDATE para "resetar" um vínculo existente — um
--       reset desses passaria pelo trigger, que exigiria a GUC e um
--       auth.uid() válido, nenhum dos dois disponível fora de uma RPC);
--   (b) no finally de cada cenário, DEPOIS de garantir que as sessões
--       de trabalho (vínculo/mudança) já terminaram (commit/rollback)
--       e o PROCESSO psql delas já saiu de verdade — nunca antes disso,
--       senão o DELETE aqui pode ficar esperando um lock que uma dessas
--       sessões ainda segura.
--
-- Verificação final por CONTAGEM (não texto) — ver
-- run-contractual-link-concurrency-test.mjs:verifyCleanupComplete.
-- ============================================================

delete from public.documents
where id = '99999999-9999-4999-8999-999999999912'; -- filho

delete from public.documents
where id in (
  '99999999-9999-4999-8999-999999999911', -- contrato-base (pai A)
  '99999999-9999-4999-8999-999999999913'  -- aditivo (pai B)
);

-- Verificação determinística por CONTAGEM (nunca por texto de
-- confirmação localizado) — \gset captura para uma variável psql, que
-- o runner lê via \echo. Só documentos: projects/memberships/audit são
-- permanentes por design (ver acima), nunca fazem parte desta conta.
select count(*) as acc_remaining_fixture_count
from public.documents
where id in (
  '99999999-9999-4999-8999-999999999911',
  '99999999-9999-4999-8999-999999999912',
  '99999999-9999-4999-8999-999999999913'
) \gset

\echo ACC_KV remaining_fixture_count=:acc_remaining_fixture_count

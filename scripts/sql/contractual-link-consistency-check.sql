-- ============================================================
-- Verificação de estado final consistente — deveria SEMPRE contar
-- ZERO, em qualquer ponto, inclusive no meio/depois de uma corrida
-- concorrente mal-timed. Usado pelo runner após cada cenário
-- (run-contractual-link-concurrency-test.mjs) e disponível para rodar
-- manualmente. NÃO EXECUTADO NESTA RODADA.
--
-- Determinístico por CONTAGEM (\gset + \echo), nunca por texto de
-- confirmação localizado como "(0 rows)"/"(0 linhas)" — locale do
-- cliente psql nunca deveria decidir se um teste passou.
-- ============================================================

select count(*) as acc_invalid_link_count
from public.documents child
join public.documents parent on parent.id = child.contractual_parent_document_id
where child.contractual_parent_document_id is not null
  and (
    parent.kind not in ('CONTRATO_BASE', 'ADITIVO')
    or parent.project_id is distinct from child.project_id
  ) \gset

\echo ACC_KV invalid_link_count=:acc_invalid_link_count

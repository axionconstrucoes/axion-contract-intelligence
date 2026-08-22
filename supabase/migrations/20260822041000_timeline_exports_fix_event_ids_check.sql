-- ============================================================
-- 20260822041000_timeline_exports_fix_event_ids_check.sql
-- Corrige a constraint de event_ids não vazio em timeline_exports.
--
-- array_length(ARRAY[]::uuid[], 1) retorna NULL (não 0) para um array
-- vazio no Postgres, e "NULL > 0" é NULL — o que uma CHECK constraint
-- trata como satisfeita, não violada. Ou seja, a constraint original
-- ("array_length(event_ids, 1) > 0") NUNCA rejeitava event_ids = '{}'.
-- Descoberto por teste automatizado real (scripts/test-timeline-export.mjs)
-- contra o banco de desenvolvimento antes de qualquer exportação real ter
-- sido feita — nenhuma linha existente é afetada.
--
-- cardinality(array) retorna 0 (não NULL) para array vazio, então
-- "cardinality(event_ids) > 0" rejeita corretamente.
-- ============================================================

alter table public.timeline_exports
  drop constraint if exists timeline_exports_event_ids_check;

alter table public.timeline_exports
  add constraint timeline_exports_event_ids_check
  check (cardinality(event_ids) > 0);

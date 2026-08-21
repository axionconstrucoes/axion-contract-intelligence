-- ============================================================
-- 20260821132647_notification_initial_idempotency.sql
-- Garante no banco a regra ja documentada em
-- action-request-notification-core.ts: uma ActionRequest pode
-- ter no maximo uma Notification de kind = 'INITIAL'. A mitigacao
-- anterior (check-then-insert em codigo) nao era atomica; este
-- indice UNIQUE parcial e a autoridade final contra corrida entre
-- duas chamadas concorrentes. REMINDER e ESCALATION continuam sem
-- limite — a regra vale somente para a comunicacao inicial.
-- ============================================================

create unique index notifications_one_initial_per_action_request_idx
  on public.notifications (action_request_id)
  where kind = 'INITIAL';

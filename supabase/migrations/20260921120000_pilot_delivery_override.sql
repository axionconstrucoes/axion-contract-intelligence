-- ============================================================
-- 20260921120000_pilot_delivery_override.sql
-- Override de ENTREGA do piloto de alertas de risco, POR PROJETO.
--
-- Quando preenchido, TODOS os e-mails de alerta de risco do projeto são
-- entregues exclusivamente neste endereço institucional do ACC (ex.:
-- axion@axion.com.br). Só a entrega muda: destinatário lógico
-- (Matriz + allowlist por user_id), responsável, ações, permissões e
-- auditoria continuam sendo da pessoa; nenhum CC/BCC. NULL = entrega
-- normal. Aditiva; nenhum dado é escrito. O guard global do provider
-- (pilot-outbound-guard.ts) continua sendo a segunda camada.
-- ============================================================

alter table public.project_weekly_schedule_ingestion_configs
  add column pilot_delivery_override_email text
    check (
      pilot_delivery_override_email is null
      or (
        pilot_delivery_override_email = lower(btrim(pilot_delivery_override_email))
        and pilot_delivery_override_email ~ '^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      )
    );

comment on column public.project_weekly_schedule_ingestion_configs.pilot_delivery_override_email is
  'Piloto: quando preenchido, todos os e-mails de alerta de risco do projeto são entregues SOMENTE neste endereço (institucional), sem CC/BCC; destinatário lógico e auditoria permanecem da pessoa. NULL = entrega normal. Remover após o piloto.';

-- Mesmo modelo de privilégios da tabela (hardening 20260920170000): sem
-- UPDATE de coluna para authenticated — gravação só pelo script/worker
-- (service_role) ou INSERT admin-only já existente.
revoke update (pilot_delivery_override_email) on public.project_weekly_schedule_ingestion_configs from authenticated;

notify pgrst, 'reload schema';

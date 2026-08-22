-- ============================================================
-- 20260822123400_sla_project_settings.sql
-- Correção de timezone do motor de SLA (ver docs/sla-escalation.md,
-- "Timezone e horário útil"): o cálculo de horário útil não pode ficar
-- hardcoded em UTC — precisa considerar a timezone real do projeto.
--
-- sla_project_settings: uma linha por projeto (1:1), configurável,
-- default institucional da AXION (America/Sao_Paulo, 08:00–18:00).
-- Datas continuam armazenadas no banco em UTC (timestamptz) — só o
-- CÁLCULO de início/fim de expediente/horas úteis/dias úteis passa a
-- considerar esta timezone (ver apps/web/lib/sla/time-units.ts).
--
-- Sem calendário de feriados nesta fase — documentado explicitamente,
-- nunca fingido.
-- ============================================================

create table public.sla_project_settings (
  project_id uuid primary key
    references public.projects (id) on delete cascade,

  -- IANA timezone identifier (ex.: "America/Sao_Paulo") — validado na
  -- aplicação (Intl.DateTimeFormat lança para um identificador
  -- inválido), não pela constraint do banco.
  timezone text not null default 'America/Sao_Paulo'
    check (nullif(trim(timezone), '') is not null),

  business_day_start_hour smallint not null default 8
    check (business_day_start_hour >= 0 and business_day_start_hour <= 23),

  business_day_end_hour smallint not null default 18
    check (business_day_end_hour >= 0 and business_day_end_hour <= 23),

  check (business_day_end_hour > business_day_start_hour),

  updated_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_sla_project_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sla_project_settings_set_updated_at
before update
on public.sla_project_settings
for each row
execute function public.set_sla_project_settings_updated_at();

alter table public.sla_project_settings enable row level security;

create policy "sla_project_settings_select_project_members_only"
  on public.sla_project_settings
  for select
  using (public.is_project_member(project_id));

create policy "sla_project_settings_write_admin_only"
  on public.sla_project_settings
  for all
  to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'))
  with check (
    updated_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'ADMIN')
  );

-- Reaproveita o mesmo trigger de auditoria de configuração de SLA
-- (audit_sla_configuration_updated, de 20260822054900) — já genérico via
-- tg_table_name/coalesce(new.id, old.id); só precisa de um branch para
-- este nome de tabela específico.
create or replace function public.audit_sla_configuration_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_entity_id text;
  v_detail text;
begin
  if tg_table_name = 'sla_matrix_rules' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_detail := format('Regra de matriz SLA (risco %s) atualizada.', coalesce(new.risk_level, old.risk_level));
  elsif tg_table_name = 'sla_area_responsibles' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_detail := format('Responsáveis da área %s atualizados.', coalesce(new.area, old.area));
  else
    -- sla_project_settings: chave primária é project_id (sem coluna id própria).
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := v_project_id::text;
    v_detail := format(
      'Timezone/horário útil do projeto atualizado (timezone=%s, expediente=%s–%sh).',
      coalesce(new.timezone, old.timezone),
      coalesce(new.business_day_start_hour, old.business_day_start_hour),
      coalesce(new.business_day_end_hour, old.business_day_end_hour)
    );
  end if;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_project_id, 'USER', auth.uid(), null,
    'SLA_CONFIGURATION_UPDATED', tg_table_name, v_entity_id,
    v_detail
  );

  return coalesce(new, old);
end;
$$;

create trigger sla_project_settings_audit_change
after insert or update
on public.sla_project_settings
for each row
execute function public.audit_sla_configuration_updated();

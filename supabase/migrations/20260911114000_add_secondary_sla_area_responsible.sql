-- Engenharia e Planejamento podem ter um segundo responsável operacional
-- no Nível 1. O SLA e a cadeia de escalonamento continuam sendo únicos
-- para a área, e o responsável principal permanece preservado.

alter table public.sla_area_responsibles
  add column if not exists secondary_responsible_user_id uuid;

alter table public.sla_area_responsibles
  add constraint sla_area_responsibles_secondary_area_check
  check (
    secondary_responsible_user_id is null
    or area in ('ENGENHARIA', 'PLANEJAMENTO')
  );

alter table public.sla_area_responsibles
  add constraint sla_area_responsibles_secondary_distinct_check
  check (
    secondary_responsible_user_id is null
    or secondary_responsible_user_id is distinct from responsible_direct_user_id
  );

alter table public.sla_area_responsibles
  add constraint sla_area_responsibles_secondary_project_member_fkey
  foreign key (project_id, secondary_responsible_user_id)
  references public.project_memberships (project_id, user_id)
  on delete set null;

comment on column public.sla_area_responsibles.secondary_responsible_user_id is
  'Corresponsável de Nível 1, disponível somente para Engenharia e Planejamento.';

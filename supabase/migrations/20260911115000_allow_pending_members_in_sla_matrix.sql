-- Permite configurar a matriz antes do primeiro login do usuário.
-- Enquanto o pré-cadastro estiver pendente, a posição aponta para o
-- convite. No primeiro login, o vínculo é convertido automaticamente
-- para o profile/membership real, sem perder a configuração da matriz.

alter table public.sla_area_responsibles
  add column if not exists responsible_direct_invitation_id uuid
    references public.project_member_invitations (id) on delete set null,
  add column if not exists secondary_responsible_invitation_id uuid
    references public.project_member_invitations (id) on delete set null,
  add column if not exists escalation_1_invitation_id uuid
    references public.project_member_invitations (id) on delete set null,
  add column if not exists board_invitation_id uuid
    references public.project_member_invitations (id) on delete set null;

alter table public.sla_area_responsibles
  add constraint sla_area_responsibles_direct_single_source_check
    check (num_nonnulls(responsible_direct_user_id, responsible_direct_invitation_id) <= 1),
  add constraint sla_area_responsibles_secondary_single_source_check
    check (num_nonnulls(secondary_responsible_user_id, secondary_responsible_invitation_id) <= 1),
  add constraint sla_area_responsibles_escalation_1_single_source_check
    check (num_nonnulls(escalation_1_user_id, escalation_1_invitation_id) <= 1),
  add constraint sla_area_responsibles_board_single_source_check
    check (num_nonnulls(board_user_id, board_invitation_id) <= 1),
  add constraint sla_area_responsibles_secondary_invitation_area_check
    check (
      secondary_responsible_invitation_id is null
      or area in ('ENGENHARIA', 'PLANEJAMENTO')
    ),
  add constraint sla_area_responsibles_secondary_invitation_distinct_check
    check (
      secondary_responsible_invitation_id is null
      or secondary_responsible_invitation_id is distinct from responsible_direct_invitation_id
    );

create or replace function public.validate_sla_area_responsible_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.responsible_direct_invitation_id is not null and not exists (
    select 1 from public.project_member_invitations
    where id = new.responsible_direct_invitation_id
      and project_id = new.project_id
      and status = 'PENDING'
  ) then
    raise exception 'Pré-cadastro do responsável de Nível 1 inválido ou não pertence ao projeto.';
  end if;

  if new.secondary_responsible_invitation_id is not null and not exists (
    select 1 from public.project_member_invitations
    where id = new.secondary_responsible_invitation_id
      and project_id = new.project_id
      and status = 'PENDING'
  ) then
    raise exception 'Pré-cadastro do corresponsável de Nível 1 inválido ou não pertence ao projeto.';
  end if;

  if new.escalation_1_invitation_id is not null and not exists (
    select 1 from public.project_member_invitations
    where id = new.escalation_1_invitation_id
      and project_id = new.project_id
      and status = 'PENDING'
  ) then
    raise exception 'Pré-cadastro da gerência de Nível 2 inválido ou não pertence ao projeto.';
  end if;

  if new.board_invitation_id is not null and not exists (
    select 1 from public.project_member_invitations
    where id = new.board_invitation_id
      and project_id = new.project_id
      and status = 'PENDING'
  ) then
    raise exception 'Pré-cadastro da diretoria de Nível 3 inválido ou não pertence ao projeto.';
  end if;

  return new;
end;
$$;

create trigger sla_area_responsibles_validate_invitations
before insert or update of
  project_id,
  responsible_direct_invitation_id,
  secondary_responsible_invitation_id,
  escalation_1_invitation_id,
  board_invitation_id
on public.sla_area_responsibles
for each row
execute function public.validate_sla_area_responsible_invitations();

revoke all on function public.validate_sla_area_responsible_invitations() from public, anon, authenticated;

create or replace function public.resolve_sla_matrix_invitation_on_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ACTIVATED' and new.profile_id is not null then
    update public.sla_area_responsibles
    set
      responsible_direct_user_id = case
        when responsible_direct_invitation_id = new.id then new.profile_id
        else responsible_direct_user_id
      end,
      responsible_direct_invitation_id = case
        when responsible_direct_invitation_id = new.id then null
        else responsible_direct_invitation_id
      end,
      secondary_responsible_user_id = case
        when secondary_responsible_invitation_id = new.id then new.profile_id
        else secondary_responsible_user_id
      end,
      secondary_responsible_invitation_id = case
        when secondary_responsible_invitation_id = new.id then null
        else secondary_responsible_invitation_id
      end,
      escalation_1_user_id = case
        when escalation_1_invitation_id = new.id then new.profile_id
        else escalation_1_user_id
      end,
      escalation_1_invitation_id = case
        when escalation_1_invitation_id = new.id then null
        else escalation_1_invitation_id
      end,
      board_user_id = case
        when board_invitation_id = new.id then new.profile_id
        else board_user_id
      end,
      board_invitation_id = case
        when board_invitation_id = new.id then null
        else board_invitation_id
      end
    where project_id = new.project_id
      and (
        responsible_direct_invitation_id = new.id
        or secondary_responsible_invitation_id = new.id
        or escalation_1_invitation_id = new.id
        or board_invitation_id = new.id
      );
  elsif new.status = 'CANCELLED' then
    update public.sla_area_responsibles
    set
      responsible_direct_invitation_id = case when responsible_direct_invitation_id = new.id then null else responsible_direct_invitation_id end,
      secondary_responsible_invitation_id = case when secondary_responsible_invitation_id = new.id then null else secondary_responsible_invitation_id end,
      escalation_1_invitation_id = case when escalation_1_invitation_id = new.id then null else escalation_1_invitation_id end,
      board_invitation_id = case when board_invitation_id = new.id then null else board_invitation_id end
    where project_id = new.project_id
      and (
        responsible_direct_invitation_id = new.id
        or secondary_responsible_invitation_id = new.id
        or escalation_1_invitation_id = new.id
        or board_invitation_id = new.id
      );
  end if;

  return new;
end;
$$;

create trigger project_member_invitation_resolve_sla_matrix
after update of status, profile_id
on public.project_member_invitations
for each row
when (old.status is distinct from new.status or old.profile_id is distinct from new.profile_id)
execute function public.resolve_sla_matrix_invitation_on_activation();

revoke all on function public.resolve_sla_matrix_invitation_on_activation() from public, anon, authenticated;

comment on column public.sla_area_responsibles.responsible_direct_invitation_id is
  'Pré-cadastro pendente escolhido para o Nível 1; convertido em responsible_direct_user_id no primeiro login.';
comment on column public.sla_area_responsibles.secondary_responsible_invitation_id is
  'Pré-cadastro pendente escolhido como corresponsável do Nível 1; convertido no primeiro login.';
comment on column public.sla_area_responsibles.escalation_1_invitation_id is
  'Pré-cadastro pendente escolhido para o Nível 2; convertido em escalation_1_user_id no primeiro login.';
comment on column public.sla_area_responsibles.board_invitation_id is
  'Pré-cadastro pendente escolhido para o Nível 3; convertido em board_user_id no primeiro login.';

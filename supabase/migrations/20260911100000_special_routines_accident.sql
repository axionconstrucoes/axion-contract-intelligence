-- Rotina especial SSMA: ocorrência/acidente com dados obrigatórios,
-- evidências fotográficas e entrega idempotente das comunicações.

alter table public.ssma_form_submissions
  drop constraint if exists ssma_form_submissions_checklist_slug_check;
alter table public.ssma_form_submissions
  add constraint ssma_form_submissions_checklist_slug_check check (checklist_slug in (
    'dda', 'dds', 'fotos-diarias', 'apr', 'pt', 'integracao',
    'almoxarifado', 'riscos-apontados', 'limpeza', 'outros',
    'remessa-bota-fora', 'ocorrencia-acidente'
  ));

alter table public.ssma_form_submissions
  drop constraint if exists ssma_form_submissions_checklist_number_check;
alter table public.ssma_form_submissions
  add constraint ssma_form_submissions_checklist_number_check
  check (checklist_number between 1 and 12);

alter table public.ssma_submission_photos
  drop constraint if exists ssma_submission_photos_action_label_check;
alter table public.ssma_submission_photos
  add constraint ssma_submission_photos_action_label_check check (
    action_label in ('Tirar foto', 'Anexar foto', 'Anexar foto da lista',
      'Capturar assinatura', 'Foto antes', 'Foto depois', 'Foto da carga',
      'Anexar comprovante', 'Foto do local', 'Foto da remoção')
  );

create or replace function public.create_ssma_accident_submission(
  p_project_id uuid,
  p_occurred_at timestamptz,
  p_field_values jsonb,
  p_checklist_values jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission_id uuid;
  v_afastamento text := nullif(btrim(p_field_values->>'afastamento'), '');
  v_expected_checks text[] := array['Atendimento inicial registrado','Comunicação interna conferida'];
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  if jsonb_typeof(p_field_values) <> 'object' or jsonb_typeof(p_checklist_values) <> 'object' then
    raise exception 'INVALID_FORM_PAYLOAD';
  end if;
  if v_afastamento not in ('Sem afastamento', 'Com afastamento')
    or nullif(btrim(p_field_values->>'funcionario'), '') is null
    or nullif(btrim(p_field_values->>'causa'), '') is null
    or nullif(btrim(p_field_values->>'remocaoEm'), '') is null
  then raise exception 'ACCIDENT_REQUIRED_FIELDS_MISSING'; end if;
  if exists (select 1 from jsonb_each_text(p_checklist_values) where value not in ('FEITO', 'NA'))
    or (select array_agg(key order by key) from jsonb_object_keys(p_checklist_values) as key)
       is distinct from (select array_agg(item order by item) from unnest(v_expected_checks) as item)
  then raise exception 'INVALID_CHECKLIST_VALUE'; end if;

  insert into public.ssma_form_submissions (
    project_id, checklist_slug, checklist_number, checklist_title,
    drive_folder_name, occurred_at, technician_user_id,
    field_values, checklist_values, risk_level
  ) values (
    p_project_id, 'ocorrencia-acidente', 12, 'Ocorrência / acidente',
    '12 - OCORRÊNCIAS E ACIDENTES', p_occurred_at, v_user_id,
    p_field_values, p_checklist_values,
    case when v_afastamento = 'Com afastamento' then 'CRITICA' else 'ALTA' end
  ) returning id into v_submission_id;

  return v_submission_id;
end;
$$;

revoke all on function public.create_ssma_accident_submission(uuid,timestamptz,jsonb,jsonb) from public;
grant execute on function public.create_ssma_accident_submission(uuid,timestamptz,jsonb,jsonb) to authenticated;

create or replace function public.validate_ssma_accident_before_finalize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.checklist_slug = 'ocorrencia-acidente'
    and old.status = 'UPLOADING' and new.status = 'SUBMITTED'
  then
    if not exists (
      select 1 from public.ssma_submission_photos
      where submission_id = new.id and action_label = 'Foto do local'
    ) or not exists (
      select 1 from public.ssma_submission_photos
      where submission_id = new.id and action_label = 'Foto da remoção'
    ) then
      raise exception 'ACCIDENT_REQUIRED_PHOTOS_MISSING';
    end if;
  end if;
  return new;
end;
$$;

create trigger ssma_accident_validate_before_finalize
before update of status on public.ssma_form_submissions
for each row execute function public.validate_ssma_accident_before_finalize();

create table public.ssma_accident_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  submission_id uuid not null references public.ssma_form_submissions(id) on delete cascade,
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  recipient_name text,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED')),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (submission_id, recipient_email)
);

create index ssma_accident_deliveries_project_created_idx
  on public.ssma_accident_notification_deliveries(project_id, created_at desc);

alter table public.ssma_accident_notification_deliveries enable row level security;
create policy "ssma_accident_deliveries_select_admin"
  on public.ssma_accident_notification_deliveries for select to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'));
revoke insert, update, delete on public.ssma_accident_notification_deliveries from authenticated;
grant select on public.ssma_accident_notification_deliveries to authenticated;

-- Supervisão operacional: uma ocorrência por impressão digital impede uma
-- enxurrada de e-mails enquanto a mesma falha permanece ativa.
create table public.acc_system_health_incidents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null,
  fingerprint text not null,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  summary text not null,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  unique (project_id, fingerprint)
);
alter table public.acc_system_health_incidents enable row level security;
create policy "acc_health_incidents_select_admin"
  on public.acc_system_health_incidents for select to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'));
revoke insert, update, delete on public.acc_system_health_incidents from authenticated;
grant select on public.acc_system_health_incidents to authenticated;

-- Análise humana obrigatória quando o Construmanager detectar uma nova
-- versão vigente. Uma análise não substitui a anterior e fica vinculada à
-- transição que a originou, preservando a rastreabilidade documental.
create table public.construmanager_version_impact_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  transition_id uuid not null references public.construmanager_version_transitions(id) on delete cascade,
  planning_user_id uuid not null references public.profiles(id),
  schedule_impact text not null check (schedule_impact in ('SIM','NAO','INCONCLUSIVO')),
  price_impact text not null check (price_impact in ('SIM','NAO','INCONCLUSIVO')),
  planning_response text not null check (length(btrim(planning_response)) between 10 and 4000),
  send_to_budget boolean not null default false,
  budget_user_id uuid references public.profiles(id),
  budget_response text,
  budget_responded_at timestamptz,
  status text not null check (status in ('PENDENTE_ORCAMENTO','CONCLUIDA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transition_id),
  check ((send_to_budget and budget_user_id is not null and status = 'PENDENTE_ORCAMENTO')
    or (not send_to_budget and budget_user_id is null and status = 'CONCLUIDA'))
);

create index construmanager_version_reviews_project_idx
  on public.construmanager_version_impact_reviews(project_id, created_at desc);
alter table public.construmanager_version_impact_reviews enable row level security;
create policy "version_reviews_select_members"
  on public.construmanager_version_impact_reviews for select to authenticated
  using (public.is_project_member(project_id));
revoke insert, update, delete on public.construmanager_version_impact_reviews from authenticated;
grant select on public.construmanager_version_impact_reviews to authenticated;

create or replace function public.submit_construmanager_version_impact_review(
  p_project_id uuid,
  p_transition_id uuid,
  p_schedule_impact text,
  p_price_impact text,
  p_planning_response text,
  p_send_to_budget boolean,
  p_budget_user_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review_id uuid;
  v_area text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select area into v_area from public.project_memberships
    where project_id = p_project_id and user_id = v_user_id and status = 'ACTIVE';
  if v_area is null and not public.has_project_permission(p_project_id, 'ADMIN') then
    raise exception 'PROJECT_ACCESS_DENIED';
  end if;
  if coalesce(v_area, '') <> 'PLANEJAMENTO'
    and not public.has_project_permission(p_project_id, 'ADMIN') then
    raise exception 'PLANNING_ROLE_REQUIRED';
  end if;
  if not exists (select 1 from public.construmanager_version_transitions
    where id = p_transition_id and project_id = p_project_id) then
    raise exception 'VERSION_TRANSITION_NOT_FOUND';
  end if;
  if p_schedule_impact not in ('SIM','NAO','INCONCLUSIVO')
    or p_price_impact not in ('SIM','NAO','INCONCLUSIVO')
    or length(btrim(coalesce(p_planning_response, ''))) < 10 then
    raise exception 'REVIEW_INCOMPLETE';
  end if;
  if p_send_to_budget and (p_budget_user_id is null or not exists (
    select 1 from public.project_memberships where project_id = p_project_id
      and user_id = p_budget_user_id and status = 'ACTIVE' and area = 'ORÇAMENTO'
  )) then raise exception 'INVALID_BUDGET_RESPONSIBLE'; end if;

  insert into public.construmanager_version_impact_reviews (
    project_id, transition_id, planning_user_id, schedule_impact,
    price_impact, planning_response, send_to_budget, budget_user_id, status
  ) values (
    p_project_id, p_transition_id, v_user_id, p_schedule_impact,
    p_price_impact, btrim(p_planning_response), p_send_to_budget,
    case when p_send_to_budget then p_budget_user_id else null end,
    case when p_send_to_budget then 'PENDENTE_ORCAMENTO' else 'CONCLUIDA' end
  ) returning id into v_review_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  ) values (
    p_project_id, 'USER', v_user_id, 'CONSTRUMANAGER_VERSION_IMPACT_REVIEWED',
    'construmanager_version_impact_reviews', v_review_id::text,
    jsonb_build_object('transitionId', p_transition_id, 'scheduleImpact', p_schedule_impact,
      'priceImpact', p_price_impact, 'sentToBudget', p_send_to_budget)
  );
  return v_review_id;
end;
$$;
revoke all on function public.submit_construmanager_version_impact_review(uuid,uuid,text,text,text,boolean,uuid) from public;
grant execute on function public.submit_construmanager_version_impact_review(uuid,uuid,text,text,text,boolean,uuid) to authenticated;

create table public.construmanager_version_review_deliveries (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.construmanager_version_impact_reviews(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED')),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (review_id, recipient_email)
);
alter table public.construmanager_version_review_deliveries enable row level security;
create policy "version_review_deliveries_select_admin"
  on public.construmanager_version_review_deliveries for select to authenticated
  using (public.has_project_permission(project_id, 'ADMIN'));
revoke insert, update, delete on public.construmanager_version_review_deliveries from authenticated;
grant select on public.construmanager_version_review_deliveries to authenticated;

create or replace function public.submit_construmanager_budget_response(
  p_project_id uuid,
  p_review_id uuid,
  p_response text
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(p_response, ''))) < 10 then raise exception 'RESPONSE_INCOMPLETE'; end if;
  update public.construmanager_version_impact_reviews
    set budget_response = btrim(p_response), budget_responded_at = now(),
        status = 'CONCLUIDA', updated_at = now()
    where id = p_review_id and project_id = p_project_id
      and budget_user_id = v_user_id and status = 'PENDENTE_ORCAMENTO';
  if not found then raise exception 'BUDGET_REVIEW_NOT_AVAILABLE'; end if;
  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  ) values (
    p_project_id, 'USER', v_user_id, 'CONSTRUMANAGER_BUDGET_RESPONSE_RECORDED',
    'construmanager_version_impact_reviews', p_review_id::text,
    jsonb_build_object('status', 'CONCLUIDA')
  );
end;
$$;
revoke all on function public.submit_construmanager_budget_response(uuid,uuid,text) from public;
grant execute on function public.submit_construmanager_budget_response(uuid,uuid,text) to authenticated;

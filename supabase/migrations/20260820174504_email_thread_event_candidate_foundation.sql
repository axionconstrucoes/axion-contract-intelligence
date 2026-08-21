-- ============================================================
-- Email Thread Event Candidate Foundation
--
-- Um thread contratualmente relevante gera um CANDIDATO.
-- Nenhum Contract Event e criado nesta camada.
--
-- Aprovacao ou rejeicao exige revisao humana.
-- ============================================================

create table public.email_thread_event_candidates (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  provider_thread_id text not null,

  rule_version text not null,

  status text not null default 'PENDING_REVIEW'
    check (
      status in (
        'PENDING_REVIEW',
        'APPROVED',
        'REJECTED',
        'EVENT_CREATED'
      )
    ),

  priority text not null
    check (
      priority in (
        'BAIXA',
        'MEDIA',
        'ALTA',
        'CRITICA'
      )
    ),

  score integer not null
    check (score >= 0),

  categories text[] not null default '{}',

  subject text not null,

  message_count integer not null
    check (message_count > 0),

  first_message_at timestamptz not null,

  last_message_at timestamptz not null,

  event_id uuid
    references public.contract_events (id)
    on delete restrict,

  reviewed_by_user_id uuid
    references public.profiles (id)
    on delete restrict,

  reviewed_at timestamptz,

  review_note text,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  unique (
    project_id,
    provider_thread_id,
    rule_version
  ),

  check (
    first_message_at <= last_message_at
  ),

  check (
    (
      status = 'PENDING_REVIEW'
      and event_id is null
      and reviewed_by_user_id is null
      and reviewed_at is null
    )
    or
    (
      status in ('APPROVED', 'REJECTED')
      and event_id is null
      and reviewed_by_user_id is not null
      and reviewed_at is not null
    )
    or
    (
      status = 'EVENT_CREATED'
      and event_id is not null
      and reviewed_by_user_id is not null
      and reviewed_at is not null
    )
  )
);

create unique index email_thread_event_candidates_event_uidx
  on public.email_thread_event_candidates (event_id)
  where event_id is not null;

create index email_thread_event_candidates_project_status_idx
  on public.email_thread_event_candidates (
    project_id,
    status,
    priority
  );

create table public.email_thread_event_candidate_emails (
  candidate_id uuid not null
    references public.email_thread_event_candidates (id)
    on delete cascade,

  email_id uuid not null
    references public.emails (id)
    on delete restrict,

  created_at timestamptz not null default now(),

  primary key (
    candidate_id,
    email_id
  )
);

create index email_thread_event_candidate_emails_email_idx
  on public.email_thread_event_candidate_emails (email_id);


-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.set_email_thread_event_candidates_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_email_thread_event_candidates_updated_at
  before update on public.email_thread_event_candidates
  for each row
  execute function public.set_email_thread_event_candidates_updated_at();


-- ============================================================
-- RLS
-- ============================================================

alter table public.email_thread_event_candidates
  enable row level security;

alter table public.email_thread_event_candidate_emails
  enable row level security;

create policy "email_thread_event_candidates_select_members"
  on public.email_thread_event_candidates
  for select
  using (
    public.is_project_member(project_id)
  );

create policy "email_thread_event_candidate_emails_select_members"
  on public.email_thread_event_candidate_emails
  for select
  using (
    exists (
      select 1
      from public.email_thread_event_candidates c
      where c.id = email_thread_event_candidate_emails.candidate_id
        and public.is_project_member(c.project_id)
    )
  );


-- ============================================================
-- REGISTRO ATOMICO DO CANDIDATO
-- ============================================================

create or replace function public.register_email_thread_event_candidate(
  p_project_id uuid,
  p_provider_thread_id text,
  p_rule_version text,
  p_priority text,
  p_score integer,
  p_categories text[],
  p_subject text,
  p_email_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id uuid;
  v_valid_count integer;
  v_first_message_at timestamptz;
  v_last_message_at timestamptz;
  v_email_id uuid;
begin
  if cardinality(p_email_ids) is null
     or cardinality(p_email_ids) = 0 then
    raise exception 'Candidate must contain at least one email';
  end if;

  if p_priority not in (
    'BAIXA',
    'MEDIA',
    'ALTA',
    'CRITICA'
  ) then
    raise exception 'Invalid priority';
  end if;

  select
    count(*),
    min(e.sent_at),
    max(e.sent_at)
  into
    v_valid_count,
    v_first_message_at,
    v_last_message_at
  from public.emails e
  where e.id = any(p_email_ids)
    and e.project_id = p_project_id
    and coalesce(
      e.provider_thread_id,
      'email:' || e.id::text
    ) = p_provider_thread_id;

  if v_valid_count <> cardinality(p_email_ids) then
    raise exception
      'One or more emails do not belong to project/thread';
  end if;

  insert into public.email_thread_event_candidates (
    project_id,
    provider_thread_id,
    rule_version,
    status,
    priority,
    score,
    categories,
    subject,
    message_count,
    first_message_at,
    last_message_at
  )
  values (
    p_project_id,
    p_provider_thread_id,
    p_rule_version,
    'PENDING_REVIEW',
    p_priority,
    p_score,
    coalesce(p_categories, '{}'),
    p_subject,
    v_valid_count,
    v_first_message_at,
    v_last_message_at
  )
  on conflict (
    project_id,
    provider_thread_id,
    rule_version
  )
  do update set
    priority = excluded.priority,
    score = excluded.score,
    categories = excluded.categories,
    subject = excluded.subject,
    message_count = excluded.message_count,
    first_message_at = excluded.first_message_at,
    last_message_at = excluded.last_message_at,
    updated_at = now()
  where email_thread_event_candidates.status = 'PENDING_REVIEW'
  returning id into v_candidate_id;

  if v_candidate_id is null then
    select id
      into v_candidate_id
    from public.email_thread_event_candidates
    where project_id = p_project_id
      and provider_thread_id = p_provider_thread_id
      and rule_version = p_rule_version;
  end if;

  foreach v_email_id in array p_email_ids
  loop
    insert into public.email_thread_event_candidate_emails (
      candidate_id,
      email_id
    )
    values (
      v_candidate_id,
      v_email_id
    )
    on conflict do nothing;
  end loop;

  return v_candidate_id;
end;
$$;

revoke all
  on function public.register_email_thread_event_candidate(
    uuid,
    text,
    text,
    text,
    integer,
    text[],
    text,
    uuid[]
  )
  from public, anon, authenticated;

grant execute
  on function public.register_email_thread_event_candidate(
    uuid,
    text,
    text,
    text,
    integer,
    text[],
    text,
    uuid[]
  )
  to service_role;

comment on table public.email_thread_event_candidates is
  'Fila de candidatos contratuais derivados de threads de email. Requer revisao humana antes da criacao do Event Ledger.';

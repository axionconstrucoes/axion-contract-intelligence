-- Proteção contra duplicidade concorrente no produtor automático
-- de lotes de alertas contratuais.
--
-- Um grupo de eventos é reservado atomicamente. Ou TODOS os eventos
-- são adquiridos pela execução, ou NENHUM é adquirido.
-- Claims FAILED não bloqueiam retry.

create table public.contract_alert_batch_dispatch_claims (
  id uuid primary key default gen_random_uuid(),

  claim_group_id uuid not null,

  event_id uuid not null
    references public.contract_events (id) on delete cascade,

  project_id uuid not null
    references public.projects (id) on delete cascade,

  responsible_user_id uuid not null
    references public.profiles (id) on delete restrict,

  claimed_at timestamptz not null default now(),

  batch_id uuid
    references public.contract_alert_batches (id) on delete set null,

  state text not null default 'CLAIMED'
    check (state in ('CLAIMED', 'SENT', 'FAILED')),

  failure_reason text,

  updated_at timestamptz not null default now()
);

create unique index contract_alert_batch_dispatch_claims_active_event_uidx
  on public.contract_alert_batch_dispatch_claims (event_id)
  where state in ('CLAIMED', 'SENT');

create index contract_alert_batch_dispatch_claims_group_idx
  on public.contract_alert_batch_dispatch_claims (claim_group_id);

create index contract_alert_batch_dispatch_claims_project_idx
  on public.contract_alert_batch_dispatch_claims
  (project_id, state, claimed_at);

alter table public.contract_alert_batch_dispatch_claims enable row level security;

-- Sem policies para authenticated.
-- Uso exclusivo pelo worker/service-role.

create or replace function public.claim_contract_alert_batch_events(
  p_event_ids uuid[],
  p_project_id uuid,
  p_responsible_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_group_id uuid := gen_random_uuid();
  v_expected integer;
  v_inserted integer;
begin
  if p_event_ids is null or cardinality(p_event_ids) = 0 then
    return null;
  end if;

  select count(distinct ids.event_id)
  into v_expected
  from unnest(p_event_ids) as ids(event_id);

  insert into public.contract_alert_batch_dispatch_claims (
    claim_group_id,
    event_id,
    project_id,
    responsible_user_id,
    state
  )
  select
    v_claim_group_id,
    event_id,
    p_project_id,
    p_responsible_user_id,
    'CLAIMED'
  from (
    select distinct source.event_id
    from unnest(p_event_ids) as source(event_id)
    order by source.event_id
  ) ids
  on conflict (event_id)
    where state in ('CLAIMED', 'SENT')
  do nothing;

  get diagnostics v_inserted = row_count;

  -- Tudo ou nada.
  -- Se algum evento já estava reservado/enviado, remove os claims
  -- adquiridos nesta tentativa e não libera o envio.
  if v_inserted <> v_expected then
    delete from public.contract_alert_batch_dispatch_claims
    where claim_group_id = v_claim_group_id
      and state = 'CLAIMED';

    return null;
  end if;

  return v_claim_group_id;
end;
$$;

alter function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)
  owner to postgres;

revoke all on function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)
  from public;

revoke all on function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)
  from anon;

revoke all on function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)
  from authenticated;

grant execute on function public.claim_contract_alert_batch_events(uuid[], uuid, uuid)
  to service_role;

-- ============================================================
-- 20261027120000_alert_followups.sql
-- Acompanhamento RECORRENTE de alertas ("Repete: a cada N dia(s) até a conclusão"):
-- um registro por alerta aberto, com responsável atual, calendário de lembretes
-- ancorado na grade do primeiro envio e histórico de ações.
--
-- PROPOSTA — NÃO APLICADA. Puramente aditiva (duas tabelas novas e funções novas); nenhuma
-- tabela/coluna existente é alterada. Requer revisão humana e "supabase db push".
--
-- A especificação executável das regras está em apps/web/lib/alerts/followup-engine.ts
-- (testada com relógio e transporte simulados em scripts/test-alert-followup-engine.mjs);
-- as funções abaixo implementam a MESMA semântica no banco:
--   - abertura idempotente (um acompanhamento ABERTO por alerta);
--   - EM ANDAMENTO: idempotente, NÃO altera o calendário de lembretes;
--   - ENVIADO P/: troca o responsável (colaborador ATIVO da obra), não conclui, não reinicia prazo;
--   - RESOLVIDO: registra quem/quando e interrompe lembretes;
--   - claim atômico (FOR UPDATE SKIP LOCKED + token + validade) para execuções concorrentes;
--   - mark_sent avança o slot na grade SEM acumular lembretes de uma interrupção do agendador;
--   - mark_failed nunca marca como enviado.
-- ============================================================

create table public.alert_followups (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references public.projects (id) on delete cascade,

  -- Origem do alerta (polimórfica: evento do ledger ou providência de entrega da obra).
  source_type text not null check (source_type in ('CONTRACT_EVENT', 'DELIVERY_ITEM')),
  source_id uuid not null,

  severity text not null check (severity in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  -- Dias corridos: 1 / 2 / 4 / 7 dias.
  interval_hours integer not null check (interval_hours in (24, 48, 96, 168)),
  check (
    (severity = 'CRITICA' and interval_hours = 24) or
    (severity = 'ALTA' and interval_hours = 48) or
    (severity = 'MEDIA' and interval_hours = 96) or
    (severity = 'BAIXA' and interval_hours = 168)
  ),

  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),

  in_progress boolean not null default false,
  in_progress_at timestamptz,
  in_progress_by_user_id uuid references public.profiles (id) on delete restrict,

  responsible_user_id uuid not null,

  -- Próximo lembrete devido (null só quando RESOLVED) e controle de envio.
  next_reminder_at timestamptz,
  last_reminder_at timestamptz,
  last_sent_slot timestamptz,
  claim_token uuid,
  claimed_until timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),

  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, responsible_user_id)
    references public.project_memberships (project_id, user_id) on delete restrict,

  check ((status = 'OPEN') = (next_reminder_at is not null)),
  check ((status = 'RESOLVED') = (resolved_at is not null)),
  check ((resolved_at is null) = (resolved_by_user_id is null))
);

-- Um único acompanhamento ABERTO por alerta (idempotência da abertura).
create unique index alert_followups_one_open_per_source_idx
  on public.alert_followups (project_id, source_type, source_id)
  where status = 'OPEN';

create index alert_followups_due_idx
  on public.alert_followups (next_reminder_at)
  where status = 'OPEN';

create index alert_followups_responsible_idx
  on public.alert_followups (responsible_user_id, status);

create table public.alert_followup_events (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references public.alert_followups (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in (
    'CREATED', 'IN_PROGRESS_CONFIRMED', 'FORWARDED', 'RESOLVED', 'REMINDER_SENT', 'REMINDER_FAILED'
  )),
  actor_user_id uuid references public.profiles (id) on delete restrict,
  from_user_id uuid references public.profiles (id) on delete restrict,
  to_user_id uuid references public.profiles (id) on delete restrict,
  -- Códigos curtos (nunca conteúdo de e-mail, endereços ou tokens).
  detail text,
  created_at timestamptz not null default now()
);

create index alert_followup_events_followup_idx
  on public.alert_followup_events (followup_id, created_at);

create or replace function public.alert_followups_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger alert_followups_set_updated_at
before update on public.alert_followups
for each row execute function public.alert_followups_set_updated_at();

alter table public.alert_followups enable row level security;
alter table public.alert_followup_events enable row level security;

-- Leitura: o responsável atual ou um ADMINISTRADOR da obra. Sem policies de escrita — toda
-- mudança passa pelas funções abaixo (clientes nunca fazem UPDATE direto).
create policy "alert_followups_select_responsible_or_admin"
  on public.alert_followups for select to authenticated
  using (
    responsible_user_id = auth.uid()
    or public.has_project_permission(project_id, 'ADMINISTRADOR')
  );

create policy "alert_followup_events_select_responsible_or_admin"
  on public.alert_followup_events for select to authenticated
  using (
    exists (
      select 1 from public.alert_followups f
      where f.id = alert_followup_events.followup_id
        and (f.responsible_user_id = auth.uid() or public.has_project_permission(f.project_id, 'ADMINISTRADOR'))
    )
  );

-- ============================================================
-- Funções chamadas pelo SERVIDOR com service role (sem sessão de usuário):
-- abertura, claim, mark_sent, mark_failed. Nenhuma é executável por authenticated.
-- ============================================================

create or replace function public.alert_followup_open(
  p_project_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_severity text,
  p_responsible_user_id uuid,
  p_sent_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer;
  v_id uuid;
begin
  v_hours := case p_severity when 'CRITICA' then 24 when 'ALTA' then 48 when 'MEDIA' then 96 when 'BAIXA' then 168 end;
  if v_hours is null then
    raise exception 'Grau de risco inválido.';
  end if;

  insert into public.alert_followups (
    project_id, source_type, source_id, severity, interval_hours, responsible_user_id, next_reminder_at, created_at
  ) values (
    p_project_id, p_source_type, p_source_id, p_severity, v_hours, p_responsible_user_id,
    p_sent_at + make_interval(hours => v_hours), p_sent_at
  )
  on conflict (project_id, source_type, source_id) where status = 'OPEN'
  do nothing
  returning id into v_id;

  if v_id is null then
    -- Já existe um acompanhamento aberto: idempotente, nada muda (nem o calendário).
    select id into v_id from public.alert_followups
    where project_id = p_project_id and source_type = p_source_type and source_id = p_source_id and status = 'OPEN';
    return v_id;
  end if;

  insert into public.alert_followup_events (followup_id, project_id, kind, to_user_id, created_at)
  values (v_id, p_project_id, 'CREATED', p_responsible_user_id, p_sent_at);

  return v_id;
end;
$$;

create or replace function public.alert_followup_claim_due(
  p_limit integer default 50,
  p_now timestamptz default now()
)
returns table (
  followup_id uuid,
  project_id uuid,
  source_type text,
  source_id uuid,
  severity text,
  responsible_user_id uuid,
  slot timestamptz,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select f.id
    from public.alert_followups f
    where f.status = 'OPEN'
      and f.next_reminder_at <= p_now
      and (f.claimed_until is null or f.claimed_until <= p_now)
    order by f.next_reminder_at
    limit greatest(p_limit, 0)
    for update skip locked
  ),
  claimed as (
    update public.alert_followups f
    set claim_token = gen_random_uuid(),
        claimed_until = p_now + interval '10 minutes'
    from due
    where f.id = due.id
    returning f.id, f.project_id, f.source_type, f.source_id, f.severity,
              f.responsible_user_id, f.next_reminder_at, f.claim_token
  )
  select c.id, c.project_id, c.source_type, c.source_id, c.severity,
         c.responsible_user_id, c.next_reminder_at, c.claim_token
  from claimed c;
end;
$$;

create or replace function public.alert_followup_mark_sent(
  p_followup_id uuid,
  p_claim_token uuid,
  p_slot timestamptz,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.alert_followups%rowtype;
  v_interval_seconds double precision;
  v_missed bigint;
begin
  select * into v_f from public.alert_followups where id = p_followup_id for update;
  if not found or v_f.status <> 'OPEN' or v_f.claim_token is distinct from p_claim_token then
    raise exception 'Reivindicação inválida ou acompanhamento já concluído.';
  end if;

  v_interval_seconds := v_f.interval_hours * 3600;
  if p_slot > p_now then
    v_missed := 0;
  else
    v_missed := floor(extract(epoch from (p_now - p_slot)) / v_interval_seconds)::bigint + 1;
  end if;

  update public.alert_followups
  set last_sent_slot = p_slot,
      last_reminder_at = p_now,
      -- Próximo slot na grade, estritamente depois de agora: uma interrupção do agendador gera UM
      -- lembrete e pula os intermediários (sem acúmulo, sem deriva).
      next_reminder_at = p_slot + make_interval(secs => (v_missed * v_interval_seconds)),
      claim_token = null,
      claimed_until = null,
      failure_count = 0
  where id = p_followup_id;

  insert into public.alert_followup_events (followup_id, project_id, kind, to_user_id, created_at)
  values (p_followup_id, v_f.project_id, 'REMINDER_SENT', v_f.responsible_user_id, p_now);
end;
$$;

create or replace function public.alert_followup_mark_failed(
  p_followup_id uuid,
  p_claim_token uuid,
  p_reason text,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.alert_followups%rowtype;
begin
  select * into v_f from public.alert_followups where id = p_followup_id for update;
  if not found or v_f.claim_token is distinct from p_claim_token then
    return;
  end if;

  -- NÃO avança next_reminder_at e NÃO preenche last_reminder_at/last_sent_slot: o lembrete
  -- continua devido e será tentado de novo na próxima execução.
  update public.alert_followups
  set claim_token = null, claimed_until = null, failure_count = failure_count + 1
  where id = p_followup_id;

  insert into public.alert_followup_events (followup_id, project_id, kind, detail, created_at)
  values (p_followup_id, v_f.project_id, 'REMINDER_FAILED', left(coalesce(p_reason, 'ERRO'), 60), p_now);
end;
$$;

create or replace function public.alert_followup_release(
  p_followup_id uuid,
  p_claim_token uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.alert_followups
  set claim_token = null, claimed_until = null
  where id = p_followup_id and claim_token is not distinct from p_claim_token;
$$;

revoke all on function public.alert_followup_open(uuid, text, uuid, text, uuid, timestamptz) from public, authenticated;
revoke all on function public.alert_followup_claim_due(integer, timestamptz) from public, authenticated;
revoke all on function public.alert_followup_mark_sent(uuid, uuid, timestamptz, timestamptz) from public, authenticated;
revoke all on function public.alert_followup_mark_failed(uuid, uuid, text, timestamptz) from public, authenticated;
revoke all on function public.alert_followup_release(uuid, uuid) from public, authenticated;
grant execute on function public.alert_followup_open(uuid, text, uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.alert_followup_claim_due(integer, timestamptz) to service_role;
grant execute on function public.alert_followup_mark_sent(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.alert_followup_mark_failed(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.alert_followup_release(uuid, uuid) to service_role;

-- ============================================================
-- Funções chamadas pelo USUÁRIO autenticado (responsável atual ou ADMINISTRADOR da obra).
-- ============================================================

create or replace function public.alert_followup_apply_action(
  p_project_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_action text,
  p_assigned_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_f public.alert_followups%rowtype;
begin
  if v_actor is null then
    raise exception 'Sessão expirada. Faça login novamente.';
  end if;

  select * into v_f
  from public.alert_followups
  where project_id = p_project_id and source_type = p_source_type and source_id = p_source_id and status = 'OPEN'
  for update;

  if not found then
    -- Sem acompanhamento aberto (ex.: já concluído ou alerta anterior à funcionalidade):
    -- nada a fazer; a resposta do lote continua valendo por conta própria.
    return;
  end if;

  if v_f.responsible_user_id <> v_actor and not public.has_project_permission(v_f.project_id, 'ADMINISTRADOR') then
    raise exception 'Você não tem permissão para agir sobre este alerta.';
  end if;

  if p_action = 'EM_ANDAMENTO' then
    -- Idempotente: marca em andamento e registra a confirmação; o calendário NÃO muda.
    update public.alert_followups
    set in_progress = true,
        in_progress_at = coalesce(in_progress_at, now()),
        in_progress_by_user_id = coalesce(in_progress_by_user_id, v_actor)
    where id = v_f.id;
    insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id)
    values (v_f.id, v_f.project_id, 'IN_PROGRESS_CONFIRMED', v_actor);

  elsif p_action = 'ENVIADO_PARA' then
    if p_assigned_user_id is null then
      raise exception 'Selecione um colaborador.';
    end if;
    if p_assigned_user_id = v_f.responsible_user_id then
      raise exception 'O alerta já está com este responsável.';
    end if;
    if not exists (
      select 1 from public.project_memberships pm
      where pm.project_id = v_f.project_id and pm.user_id = p_assigned_user_id and pm.status = 'ACTIVE'
    ) then
      raise exception 'O destinatário precisa ser um colaborador ativo vinculado à obra.';
    end if;
    -- Troca o responsável. NÃO conclui e NÃO altera next_reminder_at (não reinicia o prazo).
    update public.alert_followups set responsible_user_id = p_assigned_user_id where id = v_f.id;
    insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id, from_user_id, to_user_id)
    values (v_f.id, v_f.project_id, 'FORWARDED', v_actor, v_f.responsible_user_id, p_assigned_user_id);

  elsif p_action = 'RESOLVIDO' then
    update public.alert_followups
    set status = 'RESOLVED', next_reminder_at = null, claim_token = null, claimed_until = null,
        resolved_at = now(), resolved_by_user_id = v_actor
    where id = v_f.id;
    insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id)
    values (v_f.id, v_f.project_id, 'RESOLVED', v_actor);

  else
    raise exception 'Ação inválida.';
  end if;
end;
$$;

revoke all on function public.alert_followup_apply_action(uuid, text, uuid, text, uuid) from public;
grant execute on function public.alert_followup_apply_action(uuid, text, uuid, text, uuid) to authenticated;

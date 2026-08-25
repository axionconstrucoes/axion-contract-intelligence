-- ============================================================
-- ACC
-- Termo de Ciência da Política de Uso de Recursos Corporativos
--
-- RPCs e histórico de envio/aprovação.
-- ============================================================


-- ============================================================
-- 1. Histórico imutável dos e-mails enviados
-- ============================================================

create table public.user_policy_acknowledgement_emails (
  id uuid primary key default gen_random_uuid(),

  acknowledgement_id uuid not null
    references public.user_policy_acknowledgements(id)
    on delete restrict,

  project_id uuid not null
    references public.projects(id)
    on delete restrict,

  sent_by_user_id uuid not null
    references public.profiles(id)
    on delete restrict,

  send_kind text not null
    check (send_kind in ('FIRST', 'REMINDER')),

  recipient_email text not null,

  provider text not null,

  provider_message_id text not null,

  provider_thread_id text not null,

  message_id_header text not null,

  sent_at timestamptz not null,

  created_at timestamptz not null default now(),

  unique (provider, provider_message_id)
);
create index user_policy_ack_email_ack_idx
  on public.user_policy_acknowledgement_emails (acknowledgement_id, sent_at);
alter table public.user_policy_acknowledgement_emails
  enable row level security;
create policy "user_policy_ack_email_select_self_or_shared_admin"
  on public.user_policy_acknowledgement_emails
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_policy_acknowledgements a
      where a.id = acknowledgement_id
        and (
          a.user_id = auth.uid()
          or public.is_shared_project_admin(a.user_id)
        )
    )
  );
-- ============================================================
-- 2. Helper: acrescentar dias úteis
--
-- Nesta primeira versão:
-- segunda a sexta = útil.
-- Feriados poderão ser acrescentados posteriormente.
-- ============================================================

create or replace function public.add_business_days(
  p_from timestamptz,
  p_days integer
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result timestamptz := p_from;
  v_added integer := 0;
begin
  if p_from is null then
    return null;
  end if;

  if p_days < 0 then
    raise exception 'Quantidade de dias úteis não pode ser negativa.';
  end if;

  while v_added < p_days loop
    v_result := v_result + interval '1 day';

    if extract(
      isodow from (v_result at time zone 'America/Sao_Paulo')
    ) between 1 and 5 then
      v_added := v_added + 1;
    end if;
  end loop;

  return v_result;
end;
$$;
-- ============================================================
-- 3. Garantir pendência da versão vigente
--
-- Chamado depois que o ADMINISTRADOR adiciona o usuário.
-- Se já aprovou a versão vigente, não cria outra pendência.
-- ============================================================

create or replace function public.ensure_current_policy_acknowledgement(
  p_project_id uuid,
  p_user_id uuid
)
returns table (
  acknowledgement_id uuid,
  acknowledgement_status text,
  term_id uuid,
  term_title text,
  term_version text,
  user_name text,
  user_email text,
  first_sent_at timestamptz,
  last_sent_at timestamptz,
  resend_available_at timestamptz,
  reminder_count integer,
  needs_send boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.corporate_policy_terms;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(
    p_project_id,
    'ADMINISTRADOR'
  ) then
    raise exception 'Apenas administradores podem iniciar o Termo de Ciência.';
  end if;

  if not exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.status = 'ACTIVE'
  ) then
    raise exception 'Usuário não é membro ativo deste projeto.';
  end if;

  select t.*
    into v_term
  from public.corporate_policy_terms t
  where t.code = 'RESOURCE_USE_POLICY'
    and t.is_current = true
  order by t.effective_at desc
  limit 1;

  if v_term.id is null then
    raise exception 'Nenhuma versão vigente do Termo foi configurada.';
  end if;

  insert into public.user_policy_acknowledgements (
    user_id,
    term_id,
    source_project_id,
    status,
    created_by_user_id
  )
  values (
    p_user_id,
    v_term.id,
    p_project_id,
    'AGUARDANDO_APROVACAO',
    auth.uid()
  )
  on conflict (user_id, term_id) do nothing;

  return query
  select
    a.id,
    a.status,
    t.id,
    t.title,
    t.version,
    p.name,
    p.email,
    a.first_sent_at,
    a.last_sent_at,
    a.resend_available_at,
    a.reminder_count,
    (
      a.status = 'AGUARDANDO_APROVACAO'
      and a.first_sent_at is null
    )
  from public.user_policy_acknowledgements a
  join public.corporate_policy_terms t
    on t.id = a.term_id
  join public.profiles p
    on p.id = a.user_id
  where a.user_id = p_user_id
    and a.term_id = v_term.id;
end;
$$;
-- ============================================================
-- 4. Pré-validação antes de enviar/re-enviar e-mail
-- ============================================================

create or replace function public.get_policy_acknowledgement_send_context(
  p_project_id uuid,
  p_acknowledgement_id uuid
)
returns table (
  acknowledgement_id uuid,
  user_id uuid,
  user_name text,
  user_email text,
  term_title text,
  term_version text,
  can_send boolean,
  is_reminder boolean,
  resend_available_at timestamptz,
  reminder_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(
    p_project_id,
    'ADMINISTRADOR'
  ) then
    raise exception 'Apenas administradores podem enviar este Termo.';
  end if;

  return query
  select
    a.id,
    a.user_id,
    p.name,
    p.email,
    t.title,
    t.version,

    (
      a.status = 'AGUARDANDO_APROVACAO'
      and (
        a.first_sent_at is null
        or (
          a.resend_available_at is not null
          and now() >= a.resend_available_at
        )
      )
    ) as can_send,

    (a.first_sent_at is not null) as is_reminder,

    a.resend_available_at,
    a.reminder_count

  from public.user_policy_acknowledgements a

  join public.profiles p
    on p.id = a.user_id

  join public.corporate_policy_terms t
    on t.id = a.term_id

  where a.id = p_acknowledgement_id

    and exists (
      select 1
      from public.project_memberships pm
      where pm.project_id = p_project_id
        and pm.user_id = a.user_id
        and pm.status = 'ACTIVE'
    );
end;
$$;
-- ============================================================
-- 5. Registrar e-mail efetivamente enviado
-- ============================================================

create or replace function public.register_policy_acknowledgement_email_sent(
  p_project_id uuid,
  p_acknowledgement_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_message_id_header text,
  p_sent_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ack public.user_policy_acknowledgements;
  v_email text;
  v_send_kind text;
  v_action text;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(
    p_project_id,
    'ADMINISTRADOR'
  ) then
    raise exception 'Apenas administradores podem registrar o envio deste Termo.';
  end if;

  select *
    into v_ack
  from public.user_policy_acknowledgements
  where id = p_acknowledgement_id
  for update;

  if v_ack.id is null then
    raise exception 'Registro do Termo não encontrado.';
  end if;

  if v_ack.status <> 'AGUARDANDO_APROVACAO' then
    raise exception 'Este Termo já foi aprovado.';
  end if;

  if not exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = v_ack.user_id
      and pm.status = 'ACTIVE'
  ) then
    raise exception 'Usuário não pertence a este projeto.';
  end if;

  if v_ack.first_sent_at is not null
     and (
       v_ack.resend_available_at is null
       or now() < v_ack.resend_available_at
     ) then
    raise exception 'O prazo mínimo de 2 dias úteis para reenvio ainda não foi atingido.';
  end if;

  select p.email
    into v_email
  from public.profiles p
  where p.id = v_ack.user_id;

  if v_ack.first_sent_at is null then
    v_send_kind := 'FIRST';
    v_action := 'USER_COMPLIANCE_TERM_SENT';
  else
    v_send_kind := 'REMINDER';
    v_action := 'USER_COMPLIANCE_TERM_RE_SENT';
  end if;

  insert into public.user_policy_acknowledgement_emails (
    acknowledgement_id,
    project_id,
    sent_by_user_id,
    send_kind,
    recipient_email,
    provider,
    provider_message_id,
    provider_thread_id,
    message_id_header,
    sent_at
  )
  values (
    v_ack.id,
    p_project_id,
    auth.uid(),
    v_send_kind,
    v_email,
    p_provider,
    p_provider_message_id,
    p_provider_thread_id,
    p_message_id_header,
    p_sent_at
  );

  update public.user_policy_acknowledgements
  set
    first_sent_at = coalesce(first_sent_at, p_sent_at),
    last_sent_at = p_sent_at,

    resend_available_at =
      public.add_business_days(p_sent_at, 2),

    reminder_count =
      case
        when first_sent_at is null then reminder_count
        else reminder_count + 1
      end,

    email_message_id = p_message_id_header,
    updated_at = now()

  where id = v_ack.id;

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    p_project_id,
    'USER',
    auth.uid(),
    null,
    v_action,
    'user_policy_acknowledgements',
    v_ack.id::text,
    case
      when v_send_kind = 'FIRST'
        then format(
          'Termo de Ciência enviado para %s. Próximo reenvio permitido após 2 dias úteis.',
          v_email
        )
      else format(
        'Lembrete do Termo de Ciência reenviado para %s.',
        v_email
      )
    end
  );
end;
$$;
-- ============================================================
-- 6. Registrar primeira visualização
-- ============================================================

create or replace function public.mark_policy_acknowledgement_viewed(
  p_acknowledgement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ack public.user_policy_acknowledgements;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select *
    into v_ack
  from public.user_policy_acknowledgements
  where id = p_acknowledgement_id
  for update;

  if v_ack.id is null then
    raise exception 'Registro do Termo não encontrado.';
  end if;

  if v_ack.user_id <> auth.uid() then
    raise exception 'Este Termo pertence a outro usuário.';
  end if;

  if v_ack.viewed_at is null then
    update public.user_policy_acknowledgements
    set
      viewed_at = now(),
      updated_at = now()
    where id = v_ack.id;

    insert into public.audit_log_entries (
      project_id,
      actor_type,
      actor_user_id,
      actor_label,
      action,
      entity_type,
      entity_id,
      detail
    )
    values (
      v_ack.source_project_id,
      'USER',
      auth.uid(),
      null,
      'USER_COMPLIANCE_TERM_VIEWED',
      'user_policy_acknowledgements',
      v_ack.id::text,
      'Usuário abriu o Termo de Ciência da Política de Uso de Recursos Corporativos.'
    );
  end if;
end;
$$;
-- ============================================================
-- 7. Aprovação formal pelo próprio usuário autenticado
-- ============================================================

create or replace function public.approve_policy_acknowledgement(
  p_acknowledgement_id uuid,
  p_approval_ip inet default null,
  p_user_agent text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ack public.user_policy_acknowledgements;
  v_approved_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select *
    into v_ack
  from public.user_policy_acknowledgements
  where id = p_acknowledgement_id
  for update;

  if v_ack.id is null then
    raise exception 'Registro do Termo não encontrado.';
  end if;

  if v_ack.user_id <> auth.uid() then
    raise exception 'Este Termo pertence a outro usuário.';
  end if;

  if v_ack.status = 'APROVADO' then
    return v_ack.approved_at;
  end if;

  if v_ack.first_sent_at is null then
    raise exception 'Este Termo ainda não foi formalmente enviado.';
  end if;

  v_approved_at := now();

  update public.user_policy_acknowledgements
  set
    status = 'APROVADO',
    viewed_at = coalesce(viewed_at, v_approved_at),
    approved_at = v_approved_at,
    approved_by_user_id = auth.uid(),
    approval_ip = p_approval_ip,
    approval_user_agent = left(p_user_agent, 1000),
    updated_at = v_approved_at
  where id = v_ack.id;

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    v_ack.source_project_id,
    'USER',
    auth.uid(),
    null,
    'USER_COMPLIANCE_TERM_APPROVED',
    'user_policy_acknowledgements',
    v_ack.id::text,
    'Usuário aprovou o Termo de Ciência da Política de Uso de Recursos Corporativos.'
  );

  return v_approved_at;
end;
$$;
-- ============================================================
-- 8. Permissões das RPCs
-- ============================================================

revoke all on function
  public.ensure_current_policy_acknowledgement(uuid, uuid)
from public;
revoke all on function
  public.get_policy_acknowledgement_send_context(uuid, uuid)
from public;
revoke all on function
  public.register_policy_acknowledgement_email_sent(
    uuid, uuid, text, text, text, text, timestamptz
  )
from public;
revoke all on function
  public.mark_policy_acknowledgement_viewed(uuid)
from public;
revoke all on function
  public.approve_policy_acknowledgement(uuid, inet, text)
from public;
grant execute on function
  public.ensure_current_policy_acknowledgement(uuid, uuid)
to authenticated;
grant execute on function
  public.get_policy_acknowledgement_send_context(uuid, uuid)
to authenticated;
grant execute on function
  public.register_policy_acknowledgement_email_sent(
    uuid, uuid, text, text, text, text, timestamptz
  )
to authenticated;
grant execute on function
  public.mark_policy_acknowledgement_viewed(uuid)
to authenticated;
grant execute on function
  public.approve_policy_acknowledgement(uuid, inet, text)
to authenticated;

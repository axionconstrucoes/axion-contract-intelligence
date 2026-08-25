-- Correção da ambiguidade PL/pgSQL:
-- column reference "term_id" is ambiguous.
-- A função RETURNS TABLE possui nomes que podem colidir com colunas SQL.
-- Preferimos explicitamente as colunas SQL nesses conflitos.

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
#variable_conflict use_column
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

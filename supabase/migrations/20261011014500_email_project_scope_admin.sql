
alter table public.project_email_ingestion_configs
  add column if not exists
    require_project_scope_match boolean not null default true,
  add column if not exists
    scope_keywords text[] not null default '{}'::text[],
  add column if not exists
    scope_exact_subjects text[] not null default '{}'::text[];

create or replace function public.save_project_email_scope_rules(
  p_project_id uuid,
  p_require_match boolean,
  p_keywords text[],
  p_exact_subjects text[]
)
returns void
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
    raise exception
      'Permissão ADMINISTRADOR é necessária para alterar o escopo de e-mails.';
  end if;

  update public.project_email_ingestion_configs
  set
    require_project_scope_match =
      coalesce(p_require_match, true),

    scope_keywords =
      coalesce(p_keywords, '{}'::text[]),

    scope_exact_subjects =
      coalesce(p_exact_subjects, '{}'::text[]),

    updated_at = now()

  where project_id = p_project_id;

  if not found then
    raise exception
      'Configuração de ingestão não encontrada para o projeto.';
  end if;
end;
$$;

revoke all on function
  public.save_project_email_scope_rules(
    uuid,
    boolean,
    text[],
    text[]
  )
from public, anon;

grant execute on function
  public.save_project_email_scope_rules(
    uuid,
    boolean,
    text[],
    text[]
  )
to authenticated;

-- Health check operacional do Construmanager.
-- last_sync_at permanece reservado exclusivamente para sincronização real.

alter table public.project_integrations
  add column if not exists last_connection_check_at timestamptz;

alter table public.project_integrations
  add column if not exists last_connection_error text;

comment on column public.project_integrations.last_connection_check_at is
  'Data/hora da última validação de conectividade da integração. Não representa sincronização de dados.';

comment on column public.project_integrations.last_connection_error is
  'Último erro sanitizado da validação de conectividade; null quando a última validação foi bem-sucedida.';


create or replace function public.record_integration_connection_check(
  p_project_id uuid,
  p_source_type text,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMIN') then
    raise exception 'Permissão ADMIN é necessária para validar uma integração.';
  end if;

  if p_source_type <> 'CONSTRUMANAGER' then
    raise exception 'Esta operação está habilitada somente para CONSTRUMANAGER.';
  end if;

  if p_status not in ('CONECTADO', 'PENDENTE', 'ATENCAO', 'ERRO') then
    raise exception 'Status de integração inválido.';
  end if;

  update public.project_integrations
     set status = p_status,
         last_connection_check_at = now(),
         last_connection_error =
           case
             when p_status = 'CONECTADO' then null
             else nullif(left(btrim(p_error), 1000), '')
           end,
         updated_at = now()
   where project_id = p_project_id
     and source_type = p_source_type;

  if not found then
    raise exception 'Integração não configurada para este projeto.';
  end if;
end;
$$;

revoke all on function public.record_integration_connection_check(uuid, text, text, text) from public;
revoke all on function public.record_integration_connection_check(uuid, text, text, text) from anon;
grant execute on function public.record_integration_connection_check(uuid, text, text, text) to authenticated;

-- ============================================================
-- 20260823110500_controlled_gmail_ingestion_config_rpc.sql
-- Complemento de 20260823110000: RPC para salvar a configuração de
-- ingestão por projeto (conta AXION, domínio do cliente, participantes,
-- período, incluir anexos) a partir da UI — mesmo padrão de RPC
-- SECURITY DEFINER já usado por register_project_document_upload e
-- promote_email_attachment_to_document, porque
-- project_email_ingestion_configs/_mailboxes/_domains foram desenhadas
-- desde a origem como "escrita só server-side" (ver
-- 20260820125550_email_ingestion_config_foundation.sql) — nunca
-- ampliamos a policy de escrita dessas tabelas para não fugir do
-- desenho original; em vez disso, uma RPC auditada e ADMIN-gated.
--
-- Também redefine start_email_sync_run para registrar os parâmetros
-- operacionais (projeto, conta, período, opção de anexos) no detalhe da
-- auditoria (seção 23 do requisito).
-- ============================================================

create or replace function public.save_project_email_ingestion_config(
  p_project_id uuid,
  p_email_account_id uuid,
  p_window_mode text,
  p_custom_start_at timestamptz default null,
  p_custom_end_at timestamptz default null,
  p_client_domains jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_include_attachments boolean default true,
  p_enabled boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_account_email text;
  v_config_id uuid;
  v_domain_item jsonb;
  v_participant_item jsonb;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMIN') then
    raise exception 'Permissão ADMIN é necessária para configurar a ingestão de e-mails deste projeto.';
  end if;

  if p_window_mode not in ('FROM_PROJECT_START', 'FROM_NOW', 'CUSTOM') then
    raise exception 'window_mode inválido: %', p_window_mode;
  end if;

  if p_window_mode = 'CUSTOM' and p_custom_start_at is null then
    raise exception 'Período personalizado exige data inicial.';
  end if;

  select email_address into v_account_email from public.email_accounts where id = p_email_account_id;
  if v_account_email is null then
    raise exception 'Conta AXION (id=%) não encontrada. Registre a conta antes de configurar o projeto.', p_email_account_id;
  end if;

  insert into public.project_email_ingestion_configs (
    project_id, enabled, window_mode, custom_start_at, custom_end_at,
    monitoring_started_at, include_attachments, email_account_id
  ) values (
    p_project_id, p_enabled, p_window_mode,
    case when p_window_mode = 'CUSTOM' then p_custom_start_at else null end,
    case when p_window_mode = 'CUSTOM' then p_custom_end_at else null end,
    case when p_window_mode = 'FROM_NOW' then now() else null end,
    p_include_attachments, p_email_account_id
  )
  on conflict (project_id) do update
    set enabled = p_enabled,
        window_mode = p_window_mode,
        custom_start_at = case when p_window_mode = 'CUSTOM' then p_custom_start_at else null end,
        custom_end_at = case when p_window_mode = 'CUSTOM' then p_custom_end_at else null end,
        monitoring_started_at = case
          when p_window_mode = 'FROM_NOW' and public.project_email_ingestion_configs.monitoring_started_at is null then now()
          else public.project_email_ingestion_configs.monitoring_started_at
        end,
        include_attachments = p_include_attachments,
        email_account_id = p_email_account_id,
        updated_at = now()
  returning id into v_config_id;

  -- Mailbox monitorada = a conta AXION escolhida (nunca "conta conectada
  -- = importar a caixa inteira": só habilita esta caixa como elegível,
  -- o perímetro real continua sendo domínio/participantes/período).
  insert into public.project_email_ingestion_mailboxes (config_id, mailbox_address, enabled)
  values (v_config_id, v_account_email, true)
  on conflict (config_id, mailbox_address) do update set enabled = true;

  -- Domínios: sempre reconstrói o conjunto a partir do payload atual.
  -- axion.com.br é sempre incluído automaticamente (seção 10: e-mail
  -- interno AXION↔AXION nunca é excluído só por não envolver o cliente).
  delete from public.project_email_ingestion_domains where config_id = v_config_id;

  insert into public.project_email_ingestion_domains (config_id, domain, domain_role, enabled)
  values (v_config_id, 'axion.com.br', 'AXION', true)
  on conflict (config_id, domain) do nothing;

  for v_domain_item in select jsonb_array_elements(coalesce(p_client_domains, '[]'::jsonb))
  loop
    insert into public.project_email_ingestion_domains (config_id, domain, domain_role, enabled)
    values (
      v_config_id,
      lower(btrim(v_domain_item ->> 'domain')),
      coalesce(v_domain_item ->> 'domainRole', 'CLIENT'),
      coalesce((v_domain_item ->> 'enabled')::boolean, true)
    )
    on conflict (config_id, domain) do update
      set domain_role = excluded.domain_role, enabled = excluded.enabled;
  end loop;

  -- Participantes: sempre reconstrói o conjunto a partir do payload atual.
  delete from public.project_email_ingestion_participants where config_id = v_config_id;

  for v_participant_item in select jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    insert into public.project_email_ingestion_participants (config_id, email_address, role_note, enabled)
    values (
      v_config_id,
      lower(btrim(v_participant_item ->> 'emailAddress')),
      nullif(btrim(v_participant_item ->> 'roleNote'), ''),
      coalesce((v_participant_item ->> 'enabled')::boolean, true)
    );
  end loop;

  return v_config_id;
end;
$$;

revoke all on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) from public;
revoke all on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) from anon;
grant execute on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) to authenticated;

-- ---------- start_email_sync_run: enriquecer detalhe de auditoria ----------

create or replace function public.start_email_sync_run(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_config record;
  v_account_email text;
  v_run_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select id, project_id, window_mode, custom_start_at, custom_end_at, include_attachments, email_account_id
    into v_config
    from public.project_email_ingestion_configs
    where id = p_config_id;

  if v_config.id is null then
    raise exception 'Configuração de ingestão (id=%) não encontrada.', p_config_id;
  end if;

  if not public.has_project_permission(v_config.project_id, 'ADMIN') then
    raise exception 'Permissão ADMIN é necessária para confirmar uma sincronização de e-mails.';
  end if;

  select email_address into v_account_email from public.email_accounts where id = v_config.email_account_id;

  insert into public.project_email_ingestion_sync_runs (config_id, project_id, status, started_by_user_id)
  values (p_config_id, v_config.project_id, 'PREPARING', v_actor_user_id)
  returning id into v_run_id;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  values (
    v_config.project_id, 'USER', v_actor_user_id, null, 'EMAIL_SYNC_STARTED', 'PROJECT_EMAIL_INGESTION_SYNC_RUN', v_run_id::text,
    format(
      'Sincronização confirmada por humano. project=%s account=%s window_mode=%s period=%s..%s attachments=%s',
      v_config.project_id, coalesce(v_account_email, 'n/a'), v_config.window_mode,
      coalesce(v_config.custom_start_at::text, 'n/a'), coalesce(v_config.custom_end_at::text, 'agora'),
      case when v_config.include_attachments then 'sim' else 'não' end
    )
  );

  return v_run_id;
end;
$$;

revoke all on function public.start_email_sync_run(uuid) from public;
revoke all on function public.start_email_sync_run(uuid) from anon;
grant execute on function public.start_email_sync_run(uuid) to authenticated;

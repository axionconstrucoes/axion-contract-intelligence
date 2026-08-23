-- ============================================================
-- 20260823120000_integration_origin_and_participant_classification.sql
-- Completa o pacote de Integrações:
-- - "Origem da fonte" genérica e editável para qualquer
--   project_integrations (Construmanager, Drive, Diário de Obra,
--   Cronograma, Relatórios, Contrato, Recebidos Cliente, RFI/RFP, ERP,
--   Orçamento) — sempre preenchida por humano, nunca inventada;
-- - novo status ATENCAO (badge "Atenção", distinto de ERRO/PENDENTE);
-- - novo source_type ESG_SSMA;
-- - classificação AXION/CLIENTE/TERCEIRO de participantes monitorados
--   (project_email_ingestion_participants), sempre com sugestão
--   automática por domínio, mas corrigível por humano.
--
-- Nenhuma credencial (token/secret/senha/refresh token) é adicionada em
-- nenhuma coluna nova aqui — mesmo princípio de todas as migrations
-- anteriores desta área.
-- ============================================================

-- ---------- project_integrations: origem da fonte (genérica) ----------

alter table public.project_integrations
  add column external_system_reference text,
  add column external_project_reference text,
  add column account_reference text,
  add column folder_reference text,
  add column file_reference text,
  add column responsible_reference text,
  add column drive_type text
    check (drive_type is null or drive_type in ('MEU_DRIVE', 'DRIVE_COMPARTILHADO', 'PASTA_COMPARTILHADA'));

comment on column public.project_integrations.external_system_reference is
  'Nome do sistema externo real (ex.: "Construmanager") — só preenchido por humano, nunca inferido.';
comment on column public.project_integrations.external_project_reference is
  'Identificação inequívoca da obra/projeto no sistema externo (ex.: "WEG — Fábrica de Fios") — evita ambiguidade quando o sistema externo tem várias obras.';

-- status: novo valor ATENCAO (autorização expirada, retry, falha não
-- bloqueante) — distinto de ERRO (não consegue operar) e de PENDENTE
-- (falta configuração obrigatória).
alter table public.project_integrations drop constraint project_integrations_status_check;
alter table public.project_integrations
  add constraint project_integrations_status_check
  check (status in ('CONECTADO', 'PENDENTE', 'ATENCAO', 'ERRO'));

-- source_type: novo valor ESG_SSMA.
alter table public.project_integrations drop constraint project_integrations_source_type_check;
alter table public.project_integrations
  add constraint project_integrations_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA', 'RELATORIO_SEMANAL',
    'ERP', 'ORCAMENTO', 'ESG_SSMA'
  ));

-- ---------- project_email_ingestion_participants: classificação ----------

alter table public.project_email_ingestion_participants
  add column participant_type text not null default 'TERCEIRO'
    check (participant_type in ('AXION', 'CLIENTE', 'TERCEIRO'));

comment on column public.project_email_ingestion_participants.participant_type is
  'Classificação do participante monitorado — sugerida automaticamente por domínio (ver classifyParticipantType), sempre corrigível por humano. Nunca concede acesso ao ACC (participante não precisa de profile/membership/login).';

-- ---------- RPC: salvar origem da fonte de uma integração ----------
-- Genérica o suficiente para Construmanager/Drive/Diário/Cronograma/
-- Relatórios/Contrato/Recebidos Cliente/RFI-RFP/ERP/Orçamento/ESG-SSMA
-- — cada card só mostra os campos que um humano de fato preencheu.

create or replace function public.save_integration_origin(
  p_project_id uuid,
  p_source_type text,
  p_external_system_reference text default null,
  p_external_project_reference text default null,
  p_account_reference text default null,
  p_folder_reference text default null,
  p_file_reference text default null,
  p_responsible_reference text default null,
  p_drive_type text default null,
  p_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_integration_id uuid;
  v_existing_status text;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMIN') then
    raise exception 'Permissão ADMIN é necessária para editar a origem de uma integração.';
  end if;

  select status into v_existing_status
    from public.project_integrations
    where project_id = p_project_id and source_type = p_source_type;

  insert into public.project_integrations (
    project_id, source_type, status, detail,
    external_system_reference, external_project_reference, account_reference,
    folder_reference, file_reference, responsible_reference, drive_type
  ) values (
    p_project_id, p_source_type, coalesce(p_status, coalesce(v_existing_status, 'PENDENTE')), '',
    nullif(btrim(p_external_system_reference), ''), nullif(btrim(p_external_project_reference), ''),
    nullif(btrim(p_account_reference), ''), nullif(btrim(p_folder_reference), ''),
    nullif(btrim(p_file_reference), ''), nullif(btrim(p_responsible_reference), ''), p_drive_type
  )
  on conflict (project_id, source_type) do update
    set status = coalesce(p_status, public.project_integrations.status),
        external_system_reference = nullif(btrim(p_external_system_reference), ''),
        external_project_reference = nullif(btrim(p_external_project_reference), ''),
        account_reference = nullif(btrim(p_account_reference), ''),
        folder_reference = nullif(btrim(p_folder_reference), ''),
        file_reference = nullif(btrim(p_file_reference), ''),
        responsible_reference = nullif(btrim(p_responsible_reference), ''),
        drive_type = p_drive_type,
        updated_at = now()
  returning id into v_integration_id;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  values (
    p_project_id, 'USER', v_actor_user_id, null, 'INTEGRATION_ORIGIN_UPDATED', 'PROJECT_INTEGRATION', v_integration_id::text,
    format(
      'Origem da fonte atualizada. type=%s system=%s external_project=%s account=%s folder=%s',
      p_source_type, coalesce(p_external_system_reference, 'n/a'), coalesce(p_external_project_reference, 'n/a'),
      coalesce(p_account_reference, 'n/a'), coalesce(p_folder_reference, 'n/a')
    )
  );

  return v_integration_id;
end;
$$;

revoke all on function public.save_integration_origin(uuid, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.save_integration_origin(uuid, text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.save_integration_origin(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------- save_project_email_ingestion_config: participant_type ----------

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

  insert into public.project_email_ingestion_mailboxes (config_id, mailbox_address, enabled)
  values (v_config_id, v_account_email, true)
  on conflict (config_id, mailbox_address) do update set enabled = true;

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

  delete from public.project_email_ingestion_participants where config_id = v_config_id;

  for v_participant_item in select jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    insert into public.project_email_ingestion_participants (config_id, email_address, role_note, enabled, participant_type)
    values (
      v_config_id,
      lower(btrim(v_participant_item ->> 'emailAddress')),
      nullif(btrim(v_participant_item ->> 'roleNote'), ''),
      coalesce((v_participant_item ->> 'enabled')::boolean, true),
      coalesce(v_participant_item ->> 'participantType', 'TERCEIRO')
    );
  end loop;

  return v_config_id;
end;
$$;

revoke all on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) from public;
revoke all on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) from anon;
grant execute on function public.save_project_email_ingestion_config(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, boolean, boolean) to authenticated;

-- ============================================================
-- 20260825140000_email_backfill_on_member_activation.sql
--
-- Tarefa 5 — backfill e monitoramento de e-mail acionado pela
-- inclusao/reativacao de membro.
--
-- Arquitetura reutilizada (nenhum pipeline paralelo criado):
--   public.project_email_ingestion_configs — configuracao de
--     ingestao por projeto (ja suporta window_mode =
--     'FROM_PROJECT_START', exatamente "desde a data de inicio do
--     contrato ate agora, depois incremental" pedido pela tarefa);
--   public.project_email_ingestion_participants — lista de
--     participantes considerados relevantes para a busca (endereco +
--     tipo + enabled) — ja existente, so passa a ser mantida tambem
--     pela automacao abaixo;
--   public.project_email_ingestion_sync_runs — fila/rastreamento de
--     execucao (PREPARING/RUNNING/COMPLETED/FAILED, contadores,
--     started_by_user_id, started_at/completed_at) — ja e o que a
--     tela Integracoes exibe (EmailSyncPanel) e o que
--     scripts/gmail-inbound-*.mjs ja processa;
--   public.audit_log_entries — auditoria, ja usada por toda a
--     gestao de membros e de sincronizacao.
--
-- Campo autoritativo de "data de inicio do contrato": inspecionado
-- (nao presumido) em apps/web/lib/startup/*, apps/web/lib/acc-go-live.ts
-- e 20260823090000_startup_historical_review.sql —
-- projects.project_start_date. E DISTINTO de projects.start_date
-- (preenchido na criacao do projeto, sem o mesmo papel de gate no
-- restante do sistema) e de projects.acc_operational_start_date
-- (quando o ACC passa a monitorar operacionalmente, nao retroativo —
-- usado para classificar findings historicos, nunca para cortar
-- backfill). project_start_date e nullable e so e preenchido ao
-- concluir o Start-up do projeto — exatamente por isso o requisito
-- pede para nao presumir a data de inclusao quando ausente.
--
-- Termo de Ciencia: deliberadamente NAO verificado em nenhum ponto
-- abaixo — nem PENDENTE nem ASSINADO bloqueiam o backfill, conforme
-- a regra aprovada ("nao use o aceite do Termo como condicao de
-- ingestao").
--
-- O que este arquivo NAO faz (por nao existir infraestrutura real
-- para isso nesta base — nunca simulado como concluido):
--   nao chama a API do Gmail; nao roda scripts/gmail-inbound-*.mjs;
--   nao agenda cron/worker algum. O sync_run criado fica em
--   PREPARING (mesmo estado que "Confirmar sincronizacao" manual ja
--   deixa hoje) ate que a infraestrutura de execucao real (fora do
--   escopo desta tarefa) o processe.
-- ============================================================


-- ============================================================
-- 1. trigger_project_email_backfill: nucleo compartilhado, chamado
--    pelas RPCs de gestao de membro abaixo (nunca exposto
--    diretamente a authenticated — sem GRANT EXECUTE para ele).
-- ============================================================

create or replace function public.trigger_project_email_backfill(
  p_project_id uuid,
  p_actor_user_id uuid,
  p_member_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_project_start_date date;
  v_member_email text;
  v_member_origin text;
  v_participant_type text;
  v_existing_run_id uuid;
  v_run_id uuid;
begin

  select id, project_id, enabled, window_mode
    into v_config
    from public.project_email_ingestion_configs
    where project_id = p_project_id;

  if v_config.id is null or not v_config.enabled then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
    )
    values (
      p_project_id, 'SYSTEM', null, 'EMAIL_BACKFILL_SKIPPED_NO_CONFIG', 'PROJECT_EMAIL_INGESTION_CONFIG', p_project_id::text,
      format(
        'Backfill de e-mail nao acionado para o membro incluido/reativado (%s): projeto nao tem configuracao de ingestao habilitada em Integracoes. Motivo: %s.',
        p_member_user_id, p_reason
      )
    );
    return null;
  end if;

  select project_start_date into v_project_start_date
    from public.projects
    where id = p_project_id;

  if v_project_start_date is null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
    )
    values (
      p_project_id, 'SYSTEM', null, 'EMAIL_BACKFILL_BLOCKED_MISSING_CONTRACT_DATE', 'PROJECT', p_project_id::text,
      format(
        'Backfill de e-mail NAO iniciado para o membro incluido/reativado (%s): projects.project_start_date (data de inicio do contrato) nao esta configurada para este projeto. Pendencia operacional: conclua o Start-up do projeto informando a data de inicio do contrato antes que o backfill possa rodar. Motivo do acionamento: %s.',
        p_member_user_id, p_reason
      )
    );
    return null;
  end if;

  -- Mantem a lista de participantes considerados na busca (escopo)
  -- atualizada com o novo membro — reabilita se ja existia desativado
  -- por uma remocao/suspensao anterior. Roda SEMPRE que config e data
  -- contratual existem, independente de ja haver um sync_run em
  -- andamento (ver idempotencia abaixo) — do contrario, incluir um
  -- segundo membro enquanto o backfill do primeiro ainda esta
  -- PREPARING deixaria o segundo membro de fora da lista.
  select email, origin::text into v_member_email, v_member_origin
    from public.profiles
    where id = p_member_user_id;

  if v_member_email is not null then
    v_participant_type := case when v_member_origin = 'AXION_INTERNO' then 'AXION' else 'TERCEIRO' end;

    insert into public.project_email_ingestion_participants (
      config_id, email_address, role_note, enabled, participant_type
    )
    values (
      v_config.id, lower(v_member_email), 'Membro do projeto (participante automatico)', true, v_participant_type
    )
    on conflict (config_id, email_address) do update
      set enabled = true;
  end if;

  -- Idempotencia: ja existe um sync_run em andamento (nao terminal)
  -- para esta config? Nao enfileira um segundo — evita duplicar
  -- e-mails/anexos/eventos/evidencias ao reprocessar a mesma janela
  -- (ver dedup real em scripts/gmail-inbound-ingest.mjs, que usa o
  -- identificador estavel da mensagem/thread do Gmail).
  select id into v_existing_run_id
    from public.project_email_ingestion_sync_runs
    where config_id = v_config.id
      and status in ('PREPARING', 'RUNNING')
    order by started_at desc
    limit 1;

  if v_existing_run_id is not null then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
    )
    values (
      p_project_id, 'SYSTEM', null, 'EMAIL_BACKFILL_ALREADY_QUEUED', 'PROJECT_EMAIL_INGESTION_SYNC_RUN', v_existing_run_id::text,
      format(
        'Backfill ja enfileirado (sync_run %s) ao incluir/reativar membro (%s) — nao duplicado. Motivo: %s.',
        v_existing_run_id, p_member_user_id, p_reason
      )
    );
    return v_existing_run_id;
  end if;

  insert into public.project_email_ingestion_sync_runs (
    config_id, project_id, status, started_by_user_id
  )
  values (
    v_config.id, p_project_id, 'PREPARING', p_actor_user_id
  )
  returning id into v_run_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', p_actor_user_id, 'EMAIL_BACKFILL_QUEUED', 'PROJECT_EMAIL_INGESTION_SYNC_RUN', v_run_id::text,
    format(
      'Backfill de e-mail enfileirado automaticamente (sync_run %s) para o membro incluido/reativado (%s). Janela: %s ate agora. Motivo: %s.',
      v_run_id, p_member_user_id, v_project_start_date, p_reason
    )
  );

  return v_run_id;
end;
$$;

revoke all on function public.trigger_project_email_backfill(uuid, uuid, uuid, text) from public;
revoke all on function public.trigger_project_email_backfill(uuid, uuid, uuid, text) from anon;
revoke all on function public.trigger_project_email_backfill(uuid, uuid, uuid, text) from authenticated;


-- ============================================================
-- 2. add_project_member: aciona o backfill apos incluir o membro
--    ativo (copia da versao aplicada em 20260824090000, so com o
--    papel invalido corrigido para aceitar GESTOR e GERENTE — ver
--    20260829200000_project_permission_gerente_compat.sql para o
--    contexto completo da transicao — e a chamada nova antes do
--    RETURN).
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_project_member(p_project_id uuid, p_user_id uuid, p_permission text, p_area text DEFAULT NULL::text)
 RETURNS project_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.project_memberships;
begin
  -- Redundante com a checagem de admin abaixo (quem chama já precisa
  -- ser Administrador do projeto-alvo, e portanto já teria uma
  -- membership própria ali, o que faria esta chamada colidir com a
  -- constraint de duplicidade) — mantido explícito mesmo assim, para
  -- não depender dessa dedução indireta caso a checagem de admin
  -- mude no futuro (mesmo padrão de bloqueio explícito das demais
  -- RPCs de gestão de membros).
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido usar esta operação para a própria membership.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem adicionar membros.';
  end if;

  if p_permission not in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_permission;
  end if;

  begin
    insert into public.project_memberships (project_id, user_id, permission, area, status)
    values (p_project_id, p_user_id, p_permission, p_area, 'ACTIVE')
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'Este usuário já é membro deste projeto.';
  end;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_ADDED', 'project_memberships', p_user_id::text,
    format(
      'Membro adicionado ao projeto com papel %s%s.',
      p_permission,
      case when p_area is not null then format(' (área: %s)', p_area) else '' end
    )
  );

  perform public.trigger_project_email_backfill(p_project_id, auth.uid(), p_user_id, 'MEMBER_ADDED');

  return v_row;
end;
$function$
;


-- ============================================================
-- 3. set_project_member_status: aciona backfill na reativacao
--    (ACTIVE); desabilita o e-mail do membro na lista de
--    participantes quando desativado (INACTIVE) — nunca apaga
--    e-mails/anexos/eventos/evidencias ja importados, so para de
--    considerar aquele endereco em buscas futuras.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_project_member_status(p_project_id uuid, p_user_id uuid, p_status text)
 RETURNS project_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.project_memberships;
  v_action text;
  v_detail text;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido ativar/desativar a própria membership no projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem ativar/desativar membros.';
  end if;

  if p_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'Status inválido: %', p_status;
  end if;

  if p_status = 'INACTIVE' then
    v_action := 'MEMBER_DEACTIVATED';
    v_detail := 'Membro desativado neste projeto.';
  else
    v_action := 'MEMBER_REACTIVATED';
    v_detail := 'Membro reativado neste projeto.';
  end if;

  update public.project_memberships
  set status = p_status
  where project_id = p_project_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (p_project_id, 'USER', auth.uid(), v_action, 'project_memberships', p_user_id::text, v_detail);

  if p_status = 'ACTIVE' then
    perform public.trigger_project_email_backfill(p_project_id, auth.uid(), p_user_id, 'MEMBER_REACTIVATED');
  else
    update public.project_email_ingestion_participants pip
    set enabled = false
    from public.project_email_ingestion_configs pic, public.profiles pr
    where pic.project_id = p_project_id
      and pip.config_id = pic.id
      and pr.id = p_user_id
      and pip.email_address = lower(pr.email);
  end if;

  return v_row;
end;
$function$
;


-- ============================================================
-- 4. remove_project_member: mesma desabilitacao de participante,
--    sem excluir nenhum dado ja importado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_project_member(p_project_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_permission text;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido remover a própria membership do projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem remover membros.';
  end if;

  select permission into v_old_permission
  from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  update public.project_email_ingestion_participants pip
  set enabled = false
  from public.project_email_ingestion_configs pic, public.profiles pr
  where pic.project_id = p_project_id
    and pip.config_id = pic.id
    and pr.id = p_user_id
    and pip.email_address = lower(pr.email);

  delete from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_REMOVED', 'project_memberships', p_user_id::text,
    format('Membro removido do projeto (papel anterior: %s).', v_old_permission)
  );
end;
$function$
;

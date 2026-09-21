-- ============================================================
-- 20260921120000_contract_alert_batches_foundation.sql
-- Lote de alertas de contrato — um único e-mail pode reunir vários
-- eventos (contract_events) para o mesmo destinatário/projeto. Cada
-- evento do lote tem estado de resposta PRÓPRIO (RESOLVIDO/EM_ANDAMENTO/
-- ENVIADO_PARA); "VER EVENTO" nunca é um estado — é só navegação e não é
-- representado nesta tabela. A resposta final ("RESPONDER AO ACC") só é
-- aceita quando TODOS os itens do lote tiverem uma ação válida, e essa
-- verificação é atômica (mesma transação, com locking) — nunca confia só
-- na interface.
--
-- PROPOSTA — NÃO APLICADA nesta etapa. Puramente aditiva: nenhuma
-- tabela/coluna existente é alterada ou removida. Requer revisão humana
-- e "supabase db push" (ou equivalente) antes de entrar em produção.
--
-- Decisão de design central: modelado como um agrupamento explícito
-- (contract_alert_batches + contract_alert_batch_items), no mesmo
-- espírito de weekly_alert_digests/weekly_alert_digest_items
-- (20260910230000) — não reaproveita email_alert_action_tokens/
-- email_alert_actions (20260826140000, também ainda não aplicada)
-- porque aquele desenho é 1 token = 1 (alerta, ação) isolado, sem
-- nenhum conceito de "conjunto de alertas que precisa ser respondido
-- por completo antes de liberar uma ação final" — inventar isso ali
-- reabriria o desenho já revisado daquela proposta. contract_events
-- não tem responsável/prazo/ação nativos (mesmo motivo documentado em
-- 20260826140000): por isso o estado de resposta do lote vive
-- inteiramente em contract_alert_batch_items, nunca em contract_events
-- (que mantém seu próprio status de ciclo de vida — NOVO/EM_ANALISE/
-- CONFRONTADO/RESOLVIDO — sem qualquer transição automática a partir de
-- uma resposta de lote; os dois nunca são confundidos).
-- ============================================================


-- ============================================================
-- 1. CONTRACT_ALERT_BATCHES — um lote por (projeto, destinatário, envio)
-- ============================================================

create table public.contract_alert_batches (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  recipient_user_id uuid not null,

  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'RESPONDED', 'FAILED')),

  -- Mesmo par intended/effective de pilot-outbound-guard.ts — nunca uma
  -- segunda fonte de verdade sobre quem de fato recebeu o e-mail.
  intended_recipient_email text not null,
  effective_recipient_email text,
  provider_message_id text,
  failure_reason text,

  -- Correlaciona o lote ao envio real (mesmo correlationId usado no
  -- SendEmailInput) — auditoria pede rastreabilidade até a origem do
  -- e-mail/token, nunca só o id interno do lote.
  correlation_id uuid not null default gen_random_uuid(),

  sent_at timestamptz,
  responded_at timestamptz,
  responded_by_user_id uuid
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, recipient_user_id)
    references public.project_memberships (project_id, user_id) on delete restrict,

  check ((status = 'RESPONDED') = (responded_at is not null)),
  check ((responded_at is null) = (responded_by_user_id is null))
);

create index contract_alert_batches_recipient_idx
  on public.contract_alert_batches (recipient_user_id, status, created_at desc);

create or replace function public.set_contract_alert_batch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contract_alert_batches_set_updated_at
before update on public.contract_alert_batches
for each row execute function public.set_contract_alert_batch_updated_at();


-- ============================================================
-- 2. CONTRACT_ALERT_BATCH_ITEMS — um item por evento dentro do lote
-- ============================================================
-- "RESOLVIDO"/"EM_ANDAMENTO"/"ENVIADO_PARA" aqui são o ESTADO DE
-- RESPOSTA AO E-MAIL — não confundir com contract_events.status (ciclo
-- de vida do evento em si, colunas/tabelas diferentes, nenhuma delas
-- escreve na outra). "ENVIADO_PARA" exige obrigatoriamente
-- assigned_user_id (verificado tanto pelo check abaixo quanto, de forma
-- redundante e autoritativa, pelo RPC de submissão).

create table public.contract_alert_batch_items (
  id uuid primary key default gen_random_uuid(),

  batch_id uuid not null
    references public.contract_alert_batches (id) on delete cascade,

  event_id uuid not null
    references public.contract_events (id) on delete restrict,

  position integer not null check (position > 0),

  -- Fotografia do momento do envio — mesmo padrão de title_snapshot em
  -- weekly_alert_digest_items: o e-mail já foi mandado com este texto;
  -- nunca busca o valor "atual" do evento (que pode ter mudado desde
  -- então) para decidir o que já foi respondido.
  severity text not null
    check (severity in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  title_snapshot text not null check (btrim(title_snapshot) <> ''),

  action text
    check (action in ('RESOLVIDO', 'EM_ANDAMENTO', 'ENVIADO_PARA')),
  assigned_user_id uuid
    references public.profiles (id) on delete restrict,

  answered_at timestamptz,
  answered_by_user_id uuid
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),

  unique (batch_id, event_id),
  unique (batch_id, position),

  check ((action is null) = (answered_at is null)),
  check ((answered_at is null) = (answered_by_user_id is null)),
  check ((action = 'ENVIADO_PARA') = (assigned_user_id is not null))
);

create index contract_alert_batch_items_batch_idx
  on public.contract_alert_batch_items (batch_id, position);

-- Isolamento entre projetos: a FK garante que event_id existe em
-- contract_events, mas NÃO garante, por si só, que esse evento pertence
-- ao MESMO projeto do lote (uma CHECK constraint não pode consultar
-- outra tabela). Este trigger fecha exatamente essa lacuna — nunca
-- permite um item cujo evento seja de outro projeto, mesmo que o
-- código de emissão do lote tenha um bug.
create or replace function public.contract_alert_batch_items_assert_same_project()
returns trigger
language plpgsql
as $$
declare
  v_batch_project_id uuid;
  v_event_project_id uuid;
begin
  select project_id into v_batch_project_id
  from public.contract_alert_batches
  where id = new.batch_id;

  select project_id into v_event_project_id
  from public.contract_events
  where id = new.event_id;

  if v_batch_project_id is null or v_event_project_id is null or v_batch_project_id <> v_event_project_id then
    raise exception 'O evento % não pertence ao mesmo projeto do lote %.', new.event_id, new.batch_id;
  end if;

  return new;
end;
$$;

create trigger contract_alert_batch_items_assert_same_project_trg
before insert or update of batch_id, event_id on public.contract_alert_batch_items
for each row execute function public.contract_alert_batch_items_assert_same_project();

alter table public.contract_alert_batches enable row level security;
alter table public.contract_alert_batch_items enable row level security;

create policy "contract_alert_batches_select_recipient_or_admin"
  on public.contract_alert_batches for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or public.has_project_permission(project_id, 'ADMIN')
  );

create policy "contract_alert_batch_items_select_recipient_or_admin"
  on public.contract_alert_batch_items for select to authenticated
  using (
    exists (
      select 1
      from public.contract_alert_batches b
      where b.id = contract_alert_batch_items.batch_id
        and (
          b.recipient_user_id = auth.uid()
          or public.has_project_permission(b.project_id, 'ADMIN')
        )
    )
  );

-- Não existem policies de INSERT/UPDATE/DELETE: quem monta e envia o
-- e-mail escreve com service role (admin client, mesmo padrão de
-- issueEmailAlertActionButtons) e a resposta humana passa exclusivamente
-- pela RPC abaixo — nunca um UPDATE direto de cliente, mesmo autenticado.


-- ============================================================
-- 3. SUBMIT_CONTRACT_ALERT_BATCH_RESPONSE — resposta final atômica
-- ============================================================
-- Espelha submit_weekly_alert_digest (20260910230000): carrega TODOS os
-- itens do lote com lock, recusa se a contagem/distinção não bater
-- exatamente com o esperado (requisito 5: "carregar todos os eventos
-- relacionados... recusar se existir qualquer evento sem ação válida"),
-- valida ENVIADO_PARA contra project_memberships ATIVO do mesmo projeto,
-- grava tudo (itens + lote + auditoria) na mesma transação, e só então
-- marca o lote como RESPONDED. Nunca aceita resposta parcial — não há
-- caminho de código que grave menos que o total de itens.

create or replace function public.submit_contract_alert_batch_response(
  p_batch_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_batch public.contract_alert_batches%rowtype;
  v_expected_count integer;
  v_received_count integer;
  v_distinct_count integer;
  v_item record;
  v_payload jsonb;
  v_action text;
  v_assigned_to uuid;
begin
  if v_actor_id is null then
    raise exception 'Sessão expirada. Faça login novamente.';
  end if;

  select * into v_batch
  from public.contract_alert_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Lote de alertas não encontrado.';
  end if;

  if v_batch.recipient_user_id <> v_actor_id
     and not public.has_project_permission(v_batch.project_id, 'ADMIN') then
    raise exception 'Você não tem permissão para responder este lote de alertas.';
  end if;

  if v_batch.status = 'RESPONDED' then
    raise exception 'Este lote de alertas já foi respondido.';
  end if;

  if v_batch.status <> 'SENT' then
    raise exception 'Este lote de alertas ainda não está disponível para resposta.';
  end if;

  if jsonb_typeof(p_responses) <> 'array' then
    raise exception 'Formato de respostas inválido.';
  end if;

  select count(*) into v_expected_count
  from public.contract_alert_batch_items
  where batch_id = p_batch_id;

  v_received_count := jsonb_array_length(p_responses);

  select count(distinct value ->> 'eventId') into v_distinct_count
  from jsonb_array_elements(p_responses);

  -- Nunca aceita resposta parcial: a contagem recebida (e distinta) tem
  -- que ser EXATAMENTE igual ao total de itens do lote.
  if v_expected_count = 0
     or v_received_count <> v_expected_count
     or v_distinct_count <> v_expected_count then
    raise exception 'Todos os alertas precisam ter uma ação definida antes do envio.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_responses) payload
    where coalesce(payload ->> 'action', '') not in ('RESOLVIDO', 'EM_ANDAMENTO', 'ENVIADO_PARA')
  ) then
    raise exception 'Existe uma ação inválida no lote de alertas.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_responses) payload
    where not exists (
      select 1
      from public.contract_alert_batch_items i
      where i.batch_id = p_batch_id
        and i.event_id::text = payload ->> 'eventId'
    )
  ) then
    raise exception 'O lote contém um evento que não pertence a esta mensagem.';
  end if;

  for v_item in
    select *
    from public.contract_alert_batch_items
    where batch_id = p_batch_id
    order by position
    for update
  loop
    select value into v_payload
    from jsonb_array_elements(p_responses)
    where value ->> 'eventId' = v_item.event_id::text;

    v_action := v_payload ->> 'action';
    v_assigned_to := nullif(v_payload ->> 'assignedUserId', '')::uuid;

    if v_action = 'ENVIADO_PARA' then
      if v_assigned_to is null or not exists (
        select 1 from public.project_memberships pm
        where pm.project_id = v_batch.project_id
          and pm.user_id = v_assigned_to
          and coalesce(pm.status, 'ACTIVE') = 'ACTIVE'
      ) then
        raise exception 'Selecione um colaborador ativo do projeto para cada evento enviado.';
      end if;
    else
      v_assigned_to := null;
    end if;

    update public.contract_alert_batch_items
    set action = v_action,
        assigned_user_id = v_assigned_to,
        answered_at = now(),
        answered_by_user_id = v_actor_id
    where id = v_item.id;

    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    ) values (
      v_batch.project_id, 'USER', v_actor_id, null,
      'CONTRACT_ALERT_BATCH_ITEM_RESPONDED', 'CONTRACT_EVENT', v_item.event_id::text,
      format(
        'Alerta de contrato respondido no lote %s: %s%s. Origem: e-mail de lote (correlationId=%s).',
        p_batch_id,
        v_action,
        case when v_assigned_to is not null then format(' para %s', v_assigned_to) else '' end,
        v_batch.correlation_id
      )
    );
  end loop;

  update public.contract_alert_batches
  set status = 'RESPONDED', responded_at = now(), responded_by_user_id = v_actor_id
  where id = p_batch_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  ) values (
    v_batch.project_id, 'USER', v_actor_id, null,
    'CONTRACT_ALERT_BATCH_RESPONDED', 'CONTRACT_ALERT_BATCH', p_batch_id::text,
    format(
      'Resposta final ao ACC liberada e enviada: %s evento(s) respondido(s). CorrelationId=%s.',
      v_expected_count, v_batch.correlation_id
    )
  );

  return jsonb_build_object(
    'batchId', p_batch_id,
    'respondedItems', v_expected_count,
    'correlationId', v_batch.correlation_id
  );
end;
$$;

alter function public.submit_contract_alert_batch_response(uuid, jsonb) owner to postgres;
revoke all on function public.submit_contract_alert_batch_response(uuid, jsonb) from public;
grant execute on function public.submit_contract_alert_batch_response(uuid, jsonb) to authenticated;

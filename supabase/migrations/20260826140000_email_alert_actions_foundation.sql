-- ============================================================
-- 20260826140000_email_alert_actions_foundation.sql
-- E-mail acionável (MVP) — DAR_CIENCIA / ASSUME_RESPONSIBILITY /
-- SET_DEADLINE / RESPOND para os três fluxos existentes de e-mail
-- (alerta de contrato -> contract_events, escalonamento SLA ->
-- sla_actions, solicitação de ação -> action_requests).
--
-- PROPOSTA — NÃO APLICADA nesta etapa. Ver relatório da Fase B para a
-- justificativa completa. Puramente aditiva: nenhuma tabela/coluna
-- existente é alterada ou removida.
--
-- Decisão de design central: "alerta" é modelado de forma polimórfica
-- (alert_kind + alert_id, mesmo espírito de audit_log_entries.entity_type/
-- entity_id e event_cross_references — nunca uma FK tipada, porque o
-- destino varia por linha). O RPC de confirmação é quem valida, no
-- servidor, que alert_id realmente pertence a alert_kind e a project_id
-- (requisito 4/8/14 do prompt) — nunca uma FK declarativa (impossível
-- para uma referência polimórfica) nem confiança na query string.
--
-- SINCRONIZAÇÃO COM O ESTADO OPERACIONAL: confirm_email_alert_action
-- escreve, na MESMA transação do ledger, na fonte operacional real que
-- cada tela já lê hoje (sla_actions/action_request_assignees/
-- action_requests.due_at/action_request_responses/event_notes) — nunca
-- só em email_alert_actions quando existe um lugar operacional
-- correspondente. Onde não existe (contract_events não tem
-- responsável/prazo/ciência nativos), email_alert_actions passa a ser o
-- próprio estado central, e as telas (Ledger) foram atualizadas para
-- lê-lo — nunca duas fontes divergentes. Mapa completo e exato dentro do
-- comentário de confirm_email_alert_action (seção 5.3) e no relatório
-- desta etapa.
-- ============================================================


-- ============================================================
-- 1. EMAIL_ALERT_ACTION_TOKENS — um token de uso único por (alerta, ação)
-- ============================================================
-- Nunca grava o token bruto — só token_hash (sha256 hex, calculado pelo
-- caller antes de qualquer chamada ao banco). O token bruto só existe em
-- memória do processo que monta o e-mail e na URL que o destinatário
-- recebe — nunca em audit_log_entries, nunca em log, nunca em coluna.

create table public.email_alert_action_tokens (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  alert_kind text not null
    check (alert_kind in ('CONTRACT_EVENT', 'SLA_ACTION', 'ACTION_REQUEST')),
  alert_id uuid not null,

  action text not null
    check (action in ('ACKNOWLEDGE', 'ASSUME_RESPONSIBILITY', 'SET_DEADLINE', 'RESPOND')),

  token_hash text not null,

  -- Destinatário para quem o e-mail FOI COMPOSTO (pode nunca ter
  -- recebido de verdade, se o piloto redirecionou — ver
  -- effective_recipient_email logo abaixo). Nunca usado para
  -- autorização — só contexto/auditoria.
  intended_recipient_email text not null,

  -- Destinatário que de fato recebe o e-mail — calculado no momento da
  -- emissão a partir do MESMO piloto (resolveOutboundMode/
  -- ACC_PILOT_RECIPIENT, apps/web/lib/email/pilot-outbound-guard.ts,
  -- nunca reimplementado aqui) que o provider aplica no envio real.
  -- Igual a intended_recipient_email fora do piloto.
  effective_recipient_email text not null,

  -- E-mail de origem, quando o token foi emitido a partir de um envio já
  -- registrado em public.emails (nem todo alerta tem e-mail associado
  -- hoje — ex.: um SLA ainda não notificado). Nunca obrigatório.
  source_email_id uuid
    references public.emails (id) on delete set null,
  provider_message_id text,

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- Preenchido no primeiro (e único) consumo bem-sucedido.
  consumed_at timestamptz,
  consumed_by_user_id uuid
    references public.profiles (id) on delete restrict,
  -- FK para email_alert_actions adicionada depois (seção 2), pois a
  -- tabela ainda não existe neste ponto do arquivo.
  consumed_email_action_id uuid,

  created_at timestamptz not null default now(),

  check (expires_at > issued_at),
  check ((consumed_at is null) = (consumed_by_user_id is null))
);

create index email_alert_action_tokens_alert_idx
  on public.email_alert_action_tokens (alert_kind, alert_id);

create index email_alert_action_tokens_project_id_idx
  on public.email_alert_action_tokens (project_id);

-- Autoridade de idempotência/lookup: um hash nunca colide entre dois
-- tokens (probabilidade desprezível por construção, mas a constraint é
-- quem realmente garante).
create unique index email_alert_action_tokens_token_hash_key
  on public.email_alert_action_tokens (token_hash);


-- ============================================================
-- 2. EMAIL_ALERT_ACTIONS — ledger append-only, rico o suficiente para
--    nunca precisar de uma segunda tabela de auditoria específica desta
--    feature (ainda espelha um resumo em audit_log_entries — ver RPC).
-- ============================================================

create table public.email_alert_actions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete restrict,

  alert_kind text not null
    check (alert_kind in ('CONTRACT_EVENT', 'SLA_ACTION', 'ACTION_REQUEST')),
  alert_id uuid not null,

  action text not null
    check (action in ('ACKNOWLEDGE', 'ASSUME_RESPONSIBILITY', 'SET_DEADLINE', 'RESPOND')),

  -- Quem de fato autenticou e confirmou — nunca o destinatário original
  -- do e-mail por si só (esse é intended_recipient_email abaixo).
  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  intended_recipient_email text not null,
  -- Espelha email_alert_action_tokens.effective_recipient_email do
  -- token consumido (pode divergir do pretendido só durante o piloto —
  -- ACC_PILOT_RECIPIENT/reynaldo@axion.com.br).
  effective_recipient_email text not null,

  comment text,

  previous_due_at timestamptz,
  new_due_at timestamptz,

  previous_responsible_user_id uuid
    references public.profiles (id) on delete set null,
  new_responsible_user_id uuid
    references public.profiles (id) on delete set null,

  origin text not null default 'EMAIL_ACTION'
    check (origin = 'EMAIL_ACTION'),

  source_email_id uuid
    references public.emails (id) on delete set null,
  provider_message_id text,

  token_id uuid not null
    references public.email_alert_action_tokens (id) on delete restrict,

  -- Chave de idempotência exposta para o caller (não precisa ser
  -- adivinhada) — hoje sempre igual a token_id::text, porque um token é
  -- de uso único por construção; mantida como coluna própria (em vez de
  -- só reaproveitar token_id) para nunca prender o conceito de
  -- idempotência à forma de implementação do token no futuro.
  idempotency_key text not null,

  requires_human_review boolean not null default true,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  check (action <> 'RESPOND' or (comment is not null and length(btrim(comment)) between 3 and 4000)),
  check (action <> 'SET_DEADLINE' or new_due_at is not null),
  check (action <> 'ASSUME_RESPONSIBILITY' or new_responsible_user_id is not null)
);

-- Autoridade final de idempotência a nível de banco (defesa em
-- profundidade além da checagem "already consumed" no RPC): um token
-- nunca produz duas linhas de ledger, mesmo sob concorrência real.
create unique index email_alert_actions_token_id_key
  on public.email_alert_actions (token_id);

create unique index email_alert_actions_idempotency_key_key
  on public.email_alert_actions (idempotency_key);

create index email_alert_actions_alert_idx
  on public.email_alert_actions (alert_kind, alert_id, occurred_at desc);

create index email_alert_actions_project_id_idx
  on public.email_alert_actions (project_id);

alter table public.email_alert_action_tokens
  add constraint email_alert_action_tokens_consumed_email_action_id_fkey
  foreign key (consumed_email_action_id)
  references public.email_alert_actions (id) on delete set null;


-- ============================================================
-- 3. Append-only em email_alert_actions (mesmo padrão de
--    audit_log_entries/sla_action_escalations)
-- ============================================================

create or replace function public.prevent_email_alert_action_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'email_alert_actions is append-only: UPDATE and DELETE are not allowed';
end;
$$;

create trigger email_alert_actions_prevent_update_delete
before update or delete
on public.email_alert_actions
for each row
execute function public.prevent_email_alert_action_mutation();


-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.email_alert_action_tokens enable row level security;
alter table public.email_alert_actions enable row level security;

-- Leitura ampla o bastante para a própria UI de confirmação (via RPC,
-- não select direto — ver seção 5) precisar; nenhuma policy de
-- INSERT/UPDATE/DELETE para authenticated/anon em nenhuma das duas
-- tabelas — toda escrita passa pelas RPCs SECURITY DEFINER abaixo.
create policy "email_alert_action_tokens_select_project_members_only"
  on public.email_alert_action_tokens
  for select
  using (public.is_project_member(project_id));

create policy "email_alert_actions_select_project_members_only"
  on public.email_alert_actions
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- 5. RPCs
-- ============================================================

-- ---------- 5.1 issue_email_alert_action_tokens ----------
-- Chamada só pelo código server-side que MONTA o e-mail (admin client,
-- nunca por um usuário autenticado comum) — por isso EXECUTE é
-- concedido só a service_role, nunca a authenticated/anon. Gera um
-- token aleatório de 32 bytes por ação pedida, devolve o token BRUTO
-- (só nesta chamada, só em memória) junto da ação — o chamador embute
-- cada token na URL correspondente do e-mail e descarta a variável.
create or replace function public.issue_email_alert_action_tokens(
  p_project_id uuid,
  p_alert_kind text,
  p_alert_id uuid,
  p_intended_recipient_email text,
  p_effective_recipient_email text,
  p_actions text[],
  p_expires_in_days numeric default 7,
  p_source_email_id uuid default null,
  p_provider_message_id text default null
)
returns table (action text, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_raw_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  if p_alert_kind not in ('CONTRACT_EVENT', 'SLA_ACTION', 'ACTION_REQUEST') then
    raise exception 'Invalid alert_kind: %', p_alert_kind;
  end if;

  if p_expires_in_days is null or p_expires_in_days <= 0 then
    raise exception 'p_expires_in_days must be positive';
  end if;

  v_expires_at := now() + make_interval(days => p_expires_in_days::int);

  foreach v_action in array p_actions loop
    if v_action not in ('ACKNOWLEDGE', 'ASSUME_RESPONSIBILITY', 'SET_DEADLINE', 'RESPOND') then
      raise exception 'Invalid action: %', v_action;
    end if;

    -- 32 bytes aleatórios, hex — gerado no banco (pgcrypto, já usado em
    -- todo o projeto via gen_random_uuid()/gen_random_bytes) para nunca
    -- depender de uma fonte de aleatoriedade fora do controle do RPC.
    -- Qualificado explicitamente (extensions.*): pgcrypto está instalado
    -- no schema "extensions" neste projeto (nunca "public"), e as
    -- funções desta migration usam search_path = public — nunca
    -- depender do search_path de sessão para uma chamada de segurança.
    v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

    insert into public.email_alert_action_tokens (
      project_id, alert_kind, alert_id, action, token_hash,
      intended_recipient_email, effective_recipient_email,
      source_email_id, provider_message_id,
      expires_at
    )
    values (
      p_project_id, p_alert_kind, p_alert_id, v_action, v_token_hash,
      p_intended_recipient_email, p_effective_recipient_email,
      p_source_email_id, p_provider_message_id,
      v_expires_at
    );

    action := v_action;
    token := v_raw_token;
    expires_at := v_expires_at;
    return next;
  end loop;
end;
$$;

alter function public.issue_email_alert_action_tokens(
  uuid, text, uuid, text, text, text[], numeric, uuid, text
) owner to postgres;

revoke all on function public.issue_email_alert_action_tokens(
  uuid, text, uuid, text, text, text[], numeric, uuid, text
) from public, anon, authenticated;
grant execute on function public.issue_email_alert_action_tokens(
  uuid, text, uuid, text, text, text[], numeric, uuid, text
) to service_role;


-- ---------- 5.2 get_email_alert_action_context ----------
-- Só leitura — nunca muda estado (requisito 1: GET nunca altera
-- estado). Chamada pela página /email-actions/[token] (GET) com o
-- usuário já autenticado. Devolve o mesmo "não encontrado" tanto para
-- token inexistente/expirado/consumido quanto para token válido de um
-- projeto ao qual o usuário não tem acesso — nunca revela a diferença
-- (requisito "nunca revelar se um token válido pertence a projeto
-- inacessível").
create or replace function public.get_email_alert_action_context(
  p_token_hash text
)
returns table (
  alert_kind text,
  alert_id uuid,
  action text,
  project_id uuid,
  project_name text,
  expires_at timestamptz,
  is_expired boolean,
  is_consumed boolean,
  can_execute boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_token public.email_alert_action_tokens%rowtype;
  v_permission text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_token
  from public.email_alert_action_tokens
  where token_hash = p_token_hash;

  if not found or not public.is_project_member(v_token.project_id) then
    -- Mensagem idêntica ao caso "token realmente não existe" — ver
    -- comentário da função.
    raise exception 'Token not found or not accessible';
  end if;

  select pm.permission into v_permission
  from public.project_memberships pm
  where pm.project_id = v_token.project_id
    and pm.user_id = auth.uid()
    and pm.status = 'ACTIVE';

  alert_kind := v_token.alert_kind;
  alert_id := v_token.alert_id;
  action := v_token.action;
  project_id := v_token.project_id;
  select p.name into project_name from public.projects p where p.id = v_token.project_id;
  expires_at := v_token.expires_at;
  is_expired := v_token.expires_at <= now();
  is_consumed := v_token.consumed_at is not null;
  can_execute :=
    not is_expired
    and not is_consumed
    and (
      (v_token.action in ('ACKNOWLEDGE', 'RESPOND') and v_permission is not null)
      or (v_token.action in ('ASSUME_RESPONSIBILITY', 'SET_DEADLINE') and v_permission in ('ADMINISTRADOR', 'GESTOR'))
    );

  return next;
end;
$$;

alter function public.get_email_alert_action_context(text) owner to postgres;
revoke all on function public.get_email_alert_action_context(text) from public, anon;
grant execute on function public.get_email_alert_action_context(text) to authenticated;


-- ---------- 5.3 confirm_email_alert_action ----------
-- Único caminho de escrita real desta feature. POST-only por
-- construção (só é chamada pelo Server Action por trás do botão
-- "Confirmar" — nunca por um handler GET). Idempotente: se o token já
-- foi consumido, devolve a MESMA linha de ledger em vez de duplicar ou
-- lançar erro (requisito "duplo clique/retry nunca duplica").
--
-- SINCRONIZAÇÃO COM O ESTADO OPERACIONAL (mapa completo no relatório):
--   CONTRACT_EVENT — contract_events não tem responsável/prazo/ciência
--     nativos; email_alert_actions É o estado central para os 4 (nunca
--     duas fontes: nada mais escreve isso hoje). RESPOND também grava em
--     event_notes (categoria OUTROS) — mesma tabela já lida pela tela
--     do Ledger (EventNotesSection), então aparece lá de verdade.
--   SLA_ACTION — sla_actions.responsible_user_id (ASSUME),
--     acknowledged_at/acknowledged_by_user_id/status (ACKNOWLEDGE, só
--     avança PENDING->ACKNOWLEDGED, nunca regride um status mais
--     avançado), e um dos três relógios de prazo conforme o status atual
--     (SET_DEADLINE — ver bloco abaixo). RESPOND não tem tabela de
--     comentário própria em sla_actions; cai no mesmo fallback de estado
--     central de CONTRACT_EVENT (email_alert_actions), exibido na tela
--     de Ações e Escalonamentos.
--   ACTION_REQUEST — action_request_assignees (ASSUME, insert
--     idempotente), action_requests.due_at (SET_DEADLINE),
--     action_request_responses (ACKNOWLEDGE e RESPOND — mesma tabela já
--     lida pela tela de detalhe da Solicitação).
--
-- Toda a função roda dentro da transação da própria chamada (nenhum
-- COMMIT interno) — qualquer exceção em qualquer parte (validação,
-- escrita operacional, ledger, auditoria) desfaz TUDO que essa chamada
-- fez, automaticamente (requisito "estado operacional + Ledger +
-- auditoria, ou nada" — comportamento nativo de função PL/pgSQL, nunca
-- reimplementado manualmente).
create or replace function public.confirm_email_alert_action(
  p_token_hash text,
  p_comment text default null,
  p_new_due_at timestamptz default null
)
returns public.email_alert_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.email_alert_action_tokens%rowtype;
  v_permission text;
  v_previous_due_at timestamptz;
  v_previous_responsible uuid;
  v_new_responsible uuid;
  v_result public.email_alert_actions%rowtype;
  v_alert_project_id uuid;
  v_sla_status text;
  v_sla_assume_due_at timestamptz;
  v_sla_respond_due_at timestamptz;
  v_sla_complete_due_at timestamptz;
  v_comment text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Trava a linha do token para toda a duração da transação: garante
  -- que dois cliques concorrentes no mesmo token nunca corram a mesma
  -- decisão "ainda não consumido" duas vezes (requisito de
  -- idempotência sob concorrência real, não só sob retry sequencial).
  select * into v_token
  from public.email_alert_action_tokens
  where token_hash = p_token_hash
  for update;

  if not found or not public.is_project_member(v_token.project_id) then
    raise exception 'Token not found or not accessible';
  end if;

  if v_token.expires_at <= now() then
    raise exception 'Token expired';
  end if;

  -- Idempotência: já consumido -> devolve a linha existente, não cria
  -- uma segunda (nunca reprocessa o efeito, mesmo com payload diferente
  -- no segundo clique) e nunca repete as escritas operacionais abaixo.
  if v_token.consumed_at is not null then
    select * into v_result
    from public.email_alert_actions
    where token_id = v_token.id;

    if found then
      return v_result;
    end if;
    -- Estado inconsistente (não deveria acontecer: consumed_at setado
    -- sem linha de ledger correspondente) — trata como não consumido
    -- não é seguro; falha alto e visível em vez de mascarar.
    raise exception 'Token marked as consumed but no ledger entry found (inconsistent state)';
  end if;

  -- Confirma, no servidor, que o alerta referenciado pelo token
  -- realmente existe e pertence ao mesmo projeto do token (requisito
  -- "alerta pertencente ao projeto" — nunca confiar só no que está
  -- embutido no token/URL). Trava a linha operacional (SLA_ACTION/
  -- ACTION_REQUEST) já aqui via FOR UPDATE mais abaixo, quando aplicável.
  v_alert_project_id := case v_token.alert_kind
    when 'CONTRACT_EVENT' then (select ce.project_id from public.contract_events ce where ce.id = v_token.alert_id)
    when 'SLA_ACTION' then (select sa.project_id from public.sla_actions sa where sa.id = v_token.alert_id)
    when 'ACTION_REQUEST' then (select ar.project_id from public.action_requests ar where ar.id = v_token.alert_id)
  end;

  if v_alert_project_id is null or v_alert_project_id <> v_token.project_id then
    raise exception 'Alert not found or does not belong to the token project';
  end if;

  select pm.permission into v_permission
  from public.project_memberships pm
  where pm.project_id = v_token.project_id
    and pm.user_id = auth.uid()
    and pm.status = 'ACTIVE';

  if v_permission is null then
    raise exception 'Not an active project member';
  end if;

  if v_token.action in ('ASSUME_RESPONSIBILITY', 'SET_DEADLINE') and v_permission not in ('ADMINISTRADOR', 'GESTOR') then
    raise exception 'Insufficient permission for this action';
  end if;

  v_comment := nullif(btrim(coalesce(p_comment, '')), '');

  -- ---------- validações + leitura do estado operacional ATUAL ----------
  -- "previous" vem sempre da fonte operacional real quando ela existe
  -- (nunca do histórico de email_alert_actions) — é o valor que a tela
  -- correspondente está mostrando agora, o único que importa para a
  -- regra "reduzir prazo exige comentário".

  if v_token.action = 'RESPOND' then
    if v_comment is null or length(v_comment) < 3 or length(v_comment) > 4000 then
      raise exception 'A resposta precisa ter entre 3 e 4000 caracteres';
    end if;
  end if;

  if v_token.action = 'SET_DEADLINE' then
    if p_new_due_at is null then
      raise exception 'p_new_due_at is required for SET_DEADLINE';
    end if;
    if p_new_due_at <= now() then
      raise exception 'O prazo não pode ser no passado';
    end if;

    if v_token.alert_kind = 'SLA_ACTION' then
      select status, assume_due_at, respond_due_at, complete_due_at
        into v_sla_status, v_sla_assume_due_at, v_sla_respond_due_at, v_sla_complete_due_at
      from public.sla_actions
      where id = v_token.alert_id
      for update;

      -- Mesma prioridade de checkpoints do motor de escalonamento
      -- (apps/web/lib/sla/compute-escalation.ts): antes de assumida, o
      -- prazo ativo é assume_due_at; depois, complete_due_at (se
      -- definido) tem prioridade sobre respond_due_at — nunca os três
      -- relógios distintos tratados como um só campo genérico.
      if v_sla_status = 'PENDING' then
        v_previous_due_at := v_sla_assume_due_at;
      elsif v_sla_complete_due_at is not null then
        v_previous_due_at := v_sla_complete_due_at;
      else
        v_previous_due_at := v_sla_respond_due_at;
      end if;
    elsif v_token.alert_kind = 'ACTION_REQUEST' then
      select due_at into v_previous_due_at
      from public.action_requests
      where id = v_token.alert_id
      for update;
    else
      -- CONTRACT_EVENT: sem campo operacional — email_alert_actions é o
      -- próprio estado central (ver cabeçalho da função).
      select ea.new_due_at into v_previous_due_at
      from public.email_alert_actions ea
      where ea.alert_kind = v_token.alert_kind
        and ea.alert_id = v_token.alert_id
        and ea.action = 'SET_DEADLINE'
      order by ea.occurred_at desc
      limit 1;
    end if;

    if v_previous_due_at is not null and p_new_due_at < v_previous_due_at and v_comment is null then
      raise exception 'Reduzir um prazo já existente exige um comentário';
    end if;
  end if;

  if v_token.action = 'ASSUME_RESPONSIBILITY' then
    if v_token.alert_kind = 'SLA_ACTION' then
      select responsible_user_id into v_previous_responsible
      from public.sla_actions
      where id = v_token.alert_id
      for update;
    elsif v_token.alert_kind = 'ACTION_REQUEST' then
      -- action_requests não tem "o" responsável (é N:N via
      -- action_request_assignees) — não há um único "anterior" para
      -- reportar; documentado, nunca inventado.
      v_previous_responsible := null;
    else
      select ea.new_responsible_user_id into v_previous_responsible
      from public.email_alert_actions ea
      where ea.alert_kind = v_token.alert_kind
        and ea.alert_id = v_token.alert_id
        and ea.action = 'ASSUME_RESPONSIBILITY'
      order by ea.occurred_at desc
      limit 1;
    end if;

    v_new_responsible := auth.uid();
  end if;

  -- ---------- efeito: ledger (sempre) ----------

  insert into public.email_alert_actions (
    project_id, alert_kind, alert_id, action, actor_user_id,
    intended_recipient_email, effective_recipient_email, comment,
    previous_due_at, new_due_at,
    previous_responsible_user_id, new_responsible_user_id,
    source_email_id, provider_message_id,
    token_id, idempotency_key, requires_human_review
  )
  values (
    v_token.project_id, v_token.alert_kind, v_token.alert_id, v_token.action, auth.uid(),
    v_token.intended_recipient_email, v_token.effective_recipient_email,
    v_comment,
    v_previous_due_at, case when v_token.action = 'SET_DEADLINE' then p_new_due_at else null end,
    v_previous_responsible, v_new_responsible,
    v_token.source_email_id, v_token.provider_message_id,
    v_token.id, v_token.id::text, true
  )
  returning * into v_result;

  -- ---------- efeito: estado operacional (por alert_kind × ação) ----------
  -- Mesma transação do ledger acima — uma falha aqui propaga a exceção e
  -- desfaz o INSERT do ledger também (nenhum COMMIT parcial possível).

  if v_token.alert_kind = 'SLA_ACTION' then
    if v_token.action = 'ACKNOWLEDGE' then
      update public.sla_actions
      set acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_by_user_id = coalesce(acknowledged_by_user_id, auth.uid()),
          status = case when status = 'PENDING' then 'ACKNOWLEDGED' else status end
      where id = v_token.alert_id;
    elsif v_token.action = 'ASSUME_RESPONSIBILITY' then
      update public.sla_actions
      set responsible_user_id = auth.uid()
      where id = v_token.alert_id;
    elsif v_token.action = 'SET_DEADLINE' then
      if v_sla_status = 'PENDING' then
        update public.sla_actions set assume_due_at = p_new_due_at where id = v_token.alert_id;
      elsif v_sla_complete_due_at is not null then
        update public.sla_actions set complete_due_at = p_new_due_at where id = v_token.alert_id;
      else
        update public.sla_actions set respond_due_at = p_new_due_at where id = v_token.alert_id;
      end if;
    end if;
    -- RESPOND: sem tabela de comentário própria em sla_actions — fica só
    -- no ledger (email_alert_actions), exibido na tela de Ações e
    -- Escalonamentos a partir de lá (ver relatório).

  elsif v_token.alert_kind = 'ACTION_REQUEST' then
    if v_token.action = 'ACKNOWLEDGE' then
      insert into public.action_request_responses (
        action_request_id, project_id, channel, responder_user_id, content, responded_at
      )
      values (
        v_token.alert_id, v_token.project_id, 'APP', auth.uid(),
        'Ciência confirmada via e-mail ACC.', now()
      );
    elsif v_token.action = 'ASSUME_RESPONSIBILITY' then
      insert into public.action_request_assignees (action_request_id, project_id, user_id)
      values (v_token.alert_id, v_token.project_id, auth.uid())
      on conflict (action_request_id, user_id) do nothing;
    elsif v_token.action = 'SET_DEADLINE' then
      update public.action_requests set due_at = p_new_due_at where id = v_token.alert_id;
    elsif v_token.action = 'RESPOND' then
      insert into public.action_request_responses (
        action_request_id, project_id, channel, responder_user_id, content, responded_at
      )
      values (v_token.alert_id, v_token.project_id, 'APP', auth.uid(), v_comment, now());
    end if;

  elsif v_token.alert_kind = 'CONTRACT_EVENT' then
    if v_token.action = 'RESPOND' then
      insert into public.event_notes (event_id, author_user_id, category, text)
      values (
        v_token.alert_id, auth.uid(), 'OUTROS',
        format('[Resposta via e-mail ACC] %s', v_comment)
      );
    end if;
    -- ACKNOWLEDGE/ASSUME_RESPONSIBILITY/SET_DEADLINE: contract_events não
    -- tem campo operacional nativo — email_alert_actions é o próprio
    -- estado central (ver cabeçalho da função e relatório).
  end if;

  update public.email_alert_action_tokens
  set consumed_at = now(),
      consumed_by_user_id = auth.uid(),
      consumed_email_action_id = v_result.id
  where id = v_token.id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_token.project_id, 'USER', auth.uid(), null,
    'EMAIL_ACTION_' || v_token.action, v_token.alert_kind, v_token.alert_id::text,
    format('Ação de e-mail "%s" confirmada via link acionável.', v_token.action)
  );

  return v_result;
end;
$$;

alter function public.confirm_email_alert_action(
  text, text, timestamptz
) owner to postgres;
revoke all on function public.confirm_email_alert_action(
  text, text, timestamptz
) from public, anon;
grant execute on function public.confirm_email_alert_action(
  text, text, timestamptz
) to authenticated;

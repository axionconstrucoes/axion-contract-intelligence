-- ============================================================
-- 20260829200000_project_permission_gerente_compat.sql
--
-- Transição compatível GESTOR → GERENTE (nome do papel, não a
-- hierarquia): a partir desta migration, o valor 'GERENTE' é aceito
-- em todo lugar onde 'GESTOR' já era aceito, com exatamente o mesmo
-- perfil de autorização — nenhum poder novo, nenhuma restrição nova.
--
-- Escopo (o que este arquivo faz):
--   - amplia os dois CHECK constraints que fixam os valores válidos
--     de "permission" (project_memberships, project_member_invitations)
--     para aceitar GERENTE além de GESTOR;
--   - redefine (CREATE OR REPLACE, corpo completo, já aplicado em
--     produção) as 6 funções que hoje tratam 'GESTOR' de forma
--     especial, adicionando 'GERENTE' com o EXATO MESMO efeito em
--     cada uma: has_project_permission, can_manage_project_documents,
--     update_project_member_role, pre_register_project_member,
--     get_email_alert_action_context, confirm_email_alert_action.
--
-- O que este arquivo deliberadamente NÃO faz:
--   - não converte nenhuma linha existente (nenhum UPDATE em
--     project_memberships/project_member_invitations) — os membros
--     reais que hoje têm permission='GESTOR' continuam com
--     permission='GESTOR' até uma decisão e migração de dados
--     separadas, explícitas e autorizadas;
--   - não amplia o que GESTOR podia fazer nem o que GERENTE poderá
--     fazer — GERENTE é, por construção, um sinônimo de GESTOR em
--     toda checagem de autorização abaixo;
--   - não toca em add_project_member/set_project_member_status/
--     remove_project_member (20260825140000, ainda pendente de
--     aplicação — corrigido diretamente lá, nesta mesma leva, para
--     aceitar GESTOR e GERENTE) nem em nenhuma outra função já
--     aplicada que NÃO faça checagem por 'GESTOR' (ex.: qualquer
--     has_project_permission(id, 'EDITOR'/'ADMINISTRADOR') — esses
--     call sites não mudam de comportamento com GERENTE, porque não
--     comparam o papel atual contra o literal 'GESTOR');
--   - não altera nenhuma policy de RLS — nenhuma delas compara
--     pm.permission contra 'GESTOR' diretamente, todas passam por
--     has_project_permission() ou can_manage_project_documents(),
--     ambas redefinidas abaixo.
-- ============================================================


-- ============================================================
-- 1. CHECK constraints — aceitar GERENTE além de GESTOR
-- ============================================================

alter table public.project_memberships
  drop constraint project_memberships_permission_check;
alter table public.project_memberships
  add constraint project_memberships_permission_check
  check (permission in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA'));

alter table public.project_member_invitations
  drop constraint project_member_invitations_permission_check;
alter table public.project_member_invitations
  add constraint project_member_invitations_permission_check
  check (permission in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA'));


-- ============================================================
-- 2. has_project_permission — corpo vigente (20260824232516),
--    GERENTE mapeado EXATAMENTE como GESTOR nos dois lados da
--    comparação (papel atual = 1, mínimo exigido = 2 — a mesma
--    técnica de "só ADMINISTRADOR escreve" já em vigor para GESTOR
--    permanece idêntica para GERENTE).
-- ============================================================

create or replace function public.has_project_permission(
  p_project_id uuid,
  p_min text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
      and (
        case pm.permission
          when 'ADMINISTRADOR' then 3

          -- Todos os demais perfis são somente leitura.
          when 'GESTOR' then 1
          when 'GERENTE' then 1
          when 'COLABORADOR' then 1
          when 'LEITURA' then 1

          -- Compatibilidade defensiva com dados antigos.
          when 'ADMIN' then 3
          when 'EDITOR' then 1
          when 'VIEWER' then 1
          else 0
        end
      ) >= (
        case p_min
          -- Escrita/administração.
          when 'ADMINISTRADOR' then 3
          when 'ADMIN' then 3

          -- Qualquer chamada histórica que exigia edição
          -- passa a ser satisfeita somente por ADMINISTRADOR.
          when 'GESTOR' then 2
          when 'GERENTE' then 2
          when 'COLABORADOR' then 2
          when 'EDITOR' then 2

          -- Leitura.
          when 'LEITURA' then 1
          when 'VIEWER' then 1

          else 999
        end
      )
  );
$$;


-- ============================================================
-- 3. can_manage_project_documents — corpo vigente (20260825130000),
--    GERENTE adicionado ao lado de GESTOR na mesma decisão de
--    negócio isolada (upload/múltiplo-upload/promoção de anexo em
--    Documentos).
-- ============================================================

create or replace function public.can_manage_project_documents(
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
      and pm.permission in ('ADMINISTRADOR', 'GESTOR', 'GERENTE')
  );
$$;


-- ============================================================
-- 4. update_project_member_role — corpo vigente (20260824090000),
--    p_new_permission passa a aceitar GERENTE além de GESTOR (um
--    ADMINISTRADOR já podia atribuir GESTOR a um membro; agora
--    também pode atribuir GERENTE, com o mesmo efeito).
-- ============================================================

create or replace function public.update_project_member_role(
  p_project_id uuid,
  p_user_id uuid,
  p_new_permission text
)
returns public.project_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_permission text;
  v_row public.project_memberships;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido alterar o próprio papel no projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem alterar papéis.';
  end if;

  if p_new_permission not in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_new_permission;
  end if;

  select permission into v_old_permission
  from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  update public.project_memberships
  set permission = p_new_permission
  where project_id = p_project_id and user_id = p_user_id
  returning * into v_row;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_ROLE_CHANGED', 'project_memberships', p_user_id::text,
    format('Papel do membro alterado de %s para %s.', v_old_permission, p_new_permission)
  );

  return v_row;
end;
$$;


-- ============================================================
-- 5. pre_register_project_member — corpo vigente (20260825120500),
--    p_permission passa a aceitar GERENTE além de GESTOR no
--    pré-cadastro.
-- ============================================================

create or replace function public.pre_register_project_member(
  p_project_id uuid,
  p_email text,
  p_name text,
  p_job_title text,
  p_area text,
  p_permission text
)
returns public.project_member_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.project_member_invitations;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem pré-cadastrar usuários.';
  end if;

  v_email := lower(btrim(p_email));

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido: %', p_email;
  end if;

  if split_part(v_email, '@', 2) <> 'axion.com.br' then
    raise exception 'Pré-cadastro restrito a e-mails @axion.com.br.';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Nome é obrigatório.';
  end if;

  if p_permission not in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_permission;
  end if;

  if p_area is not null and p_area not in (
    'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
    'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO'
  ) then
    raise exception 'Área inválida: %', p_area;
  end if;

  -- Já existe profile real (já logou alguma vez)? Pré-cadastro não é
  -- o caminho certo — o admin deveria usar a busca/adição direta
  -- (add_project_member), nunca duplicar o caminho de entrada.
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Este e-mail já tem um profile — use a busca por e-mail em vez do pré-cadastro.';
  end if;

  if exists (
    select 1
    from public.project_member_invitations
    where project_id = p_project_id
      and email = v_email
      and status <> 'CANCELLED'
  ) then
    raise exception 'Já existe um pré-cadastro pendente ou ativado para este e-mail neste projeto.';
  end if;

  insert into public.project_member_invitations (
    project_id, email, name, job_title, area, permission, status, created_by
  )
  values (
    p_project_id, v_email, btrim(p_name), nullif(btrim(coalesce(p_job_title, '')), ''), p_area, p_permission, 'PENDING', auth.uid()
  )
  on conflict (project_id, email) do update
  set
    name = excluded.name,
    job_title = excluded.job_title,
    area = excluded.area,
    permission = excluded.permission,
    status = 'PENDING',
    created_by = excluded.created_by,
    created_at = now(),
    activated_at = null,
    cancelled_at = null,
    profile_id = null
  returning * into v_row;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_PRE_REGISTERED', 'project_member_invitations', v_row.id::text,
    format('Pré-cadastro criado para %s (papel %s).', v_email, p_permission)
  );

  return v_row;
end;
$$;


-- ============================================================
-- 6. get_email_alert_action_context — corpo vigente (20260826140000),
--    ASSUME_RESPONSIBILITY/SET_DEADLINE passam a aceitar GERENTE
--    além de GESTOR (mesmo efeito: can_execute = true).
-- ============================================================

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
      or (v_token.action in ('ASSUME_RESPONSIBILITY', 'SET_DEADLINE') and v_permission in ('ADMINISTRADOR', 'GESTOR', 'GERENTE'))
    );

  return next;
end;
$$;


-- ============================================================
-- 7. confirm_email_alert_action — corpo vigente (20260826140000),
--    mesma adição de GERENTE ao lado de GESTOR na checagem de
--    ASSUME_RESPONSIBILITY/SET_DEADLINE.
-- ============================================================

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

  if v_token.action in ('ASSUME_RESPONSIBILITY', 'SET_DEADLINE') and v_permission not in ('ADMINISTRADOR', 'GESTOR', 'GERENTE') then
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

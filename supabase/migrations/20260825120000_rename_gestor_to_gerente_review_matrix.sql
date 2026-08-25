-- ============================================================
-- 20260825120000_rename_gestor_to_gerente_review_matrix.sql
--
-- Tarefa 4 — nomenclatura oficial e matriz de permissoes aprovada.
--
-- 1) Renomeia o papel GESTOR -> GERENTE (idempotente: so afeta linhas
--    que ainda estejam com o valor antigo; reexecucao e um no-op).
--    Nenhum membership e excluido, nenhum outro papel e alterado.
--
-- 2) Redefine has_project_permission() com uma hierarquia de 4 niveis
--    (ADMINISTRADOR=4 > GERENTE=3 > COLABORADOR=2 > LEITURA=1) em vez
--    dos 3 niveis anteriores. Isto e necessario porque a matriz
--    aprovada exige uma distincao que o esquema numerico anterior nao
--    conseguia representar:
--      - ADMINISTRADOR e GERENTE tem os MESMOS direitos de conteudo
--        (editar, anotar, aprovar/rejeitar revisao contratual);
--      - mas GERENTE NAO deve herdar os poderes exclusivos de
--        ADMINISTRADOR (gestao de membros do projeto, configuracao de
--        SLA, integracoes) — esses continuam checados via
--        isProjectAdministrator()/has_project_permission(p,
--        'ADMINISTRADOR'), que so o nivel 4 satisfaz.
--    Os tokens de compatibilidade legada (ADMIN/EDITOR/VIEWER) sao
--    preservados com o mesmo mapeamento numerico de sempre (ADMIN=4,
--    EDITOR=2, VIEWER=1) — nenhuma das dezenas de policies/RPCs de
--    outras features que chamam has_project_permission(p, 'EDITOR')
--    precisa mudar: COLABORADOR continua satisfazendo esse patamar
--    (como sempre satisfez), e GERENTE passa a satisfaze-lo tambem
--    (novo, exatamente o que a matriz pede — "GERENTE pode editar
--    conteudo").
--
-- 3) As duas RPCs que efetivamente aprovam/rejeitam "revisao
--    contratual" (candidatos de evento derivados de email e
--    candidatos de confronto evento x clausula) passam a exigir o
--    novo patamar 'GERENTE' (ADMINISTRADOR ou GERENTE), em vez do
--    'EDITOR' anterior (que COLABORADOR tambem satisfazia) — a
--    matriz aprovada e explicita: "COLABORADOR ... nao pode aprovar
--    nem rejeitar revisao contratual". As definicoes abaixo sao
--    copias exatas (via pg_get_functiondef no banco local, antes de
--    qualquer edicao manual) das funcoes ja aplicadas em
--    20260820180344_contract_review_workflow.sql e
--    20260821021746_event_clause_confrontation_foundation.sql, com
--    apenas o argumento de permissao (e, na segunda, a mensagem de
--    erro) trocados de 'EDITOR' para 'GERENTE' — nenhuma outra linha
--    de logica de negocio foi alterada.
--
-- A autorizacao de "criar anotacoes" (event_notes) ja usa
-- has_project_permission(project_id, 'EDITOR') — ver
-- 20260822033339_event_notes_foundation.sql — e portanto ja fica
-- correta automaticamente com a nova hierarquia (ADMINISTRADOR,
-- GERENTE e COLABORADOR passam a poder anotar; LEITURA continua sem
-- poder).
--
-- 4) add_project_member() e update_project_member_role() (mesma
--    migration 20260824090000) validam o papel recebido contra uma
--    lista fixa que ainda incluia 'GESTOR' — sem esta correcao, a
--    API/RPC rejeitaria qualquer tentativa de definir 'GERENTE'
--    ("Papel invalido: GERENTE"), tornando o papel novo inatingivel
--    por essas duas RPCs. Copias exatas (pg_get_functiondef, banco
--    local) com apenas o literal da lista trocado.
-- ============================================================


-- ============================================================
-- 1. Migrar dados: GESTOR -> GERENTE
-- ============================================================

update public.project_memberships
set permission = 'GERENTE'
where permission = 'GESTOR';


-- ============================================================
-- 2. Atualizar a constraint de permission
-- ============================================================

alter table public.project_memberships
  drop constraint if exists project_memberships_permission_check;

alter table public.project_memberships
  add constraint project_memberships_permission_check
  check (permission in ('ADMINISTRADOR', 'GERENTE', 'COLABORADOR', 'LEITURA'));


-- ============================================================
-- 3. has_project_permission: nova hierarquia de 4 niveis
-- ============================================================

create or replace function public.has_project_permission(p_project_id uuid, p_min text)
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
          when 'ADMINISTRADOR' then 4
          when 'GERENTE' then 3
          when 'COLABORADOR' then 2
          when 'LEITURA' then 1
          -- valores legados: nenhuma linha deveria mais existir com
          -- estes valores, mas mantemos o mapeamento por
          -- seguranca/defesa em profundidade (mesmo padrao das
          -- migrations anteriores desta funcao).
          when 'ADMIN' then 4
          when 'GESTOR' then 3
          when 'EDITOR' then 2
          when 'VIEWER' then 1
          else 0
        end
      ) >= (
        case p_min
          when 'ADMINISTRADOR' then 4
          when 'ADMIN' then 4
          when 'GERENTE' then 3
          when 'COLABORADOR' then 2
          when 'EDITOR' then 2
          when 'LEITURA' then 1
          when 'VIEWER' then 1
          else 999
        end
      )
  );
$$;


-- ============================================================
-- 4. review_email_thread_event_candidate: exigir GERENTE (nao mais
--    apenas EDITOR/COLABORADOR) para aprovar/rejeitar
-- ============================================================

CREATE OR REPLACE FUNCTION public.review_email_thread_event_candidate(p_candidate_id uuid, p_action text, p_review_note text DEFAULT NULL::text, p_event_title text DEFAULT NULL::text, p_event_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_candidate public.email_thread_event_candidates%rowtype;
  v_user_id uuid;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_candidate
  from public.email_thread_event_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'Candidate not found';
  end if;

  if not public.has_project_permission(
    v_candidate.project_id,
    'GERENTE'
  ) then
    raise exception 'Insufficient project permission';
  end if;

  if v_candidate.status <> 'PENDING_REVIEW' then
    raise exception
      'Candidate is not pending review';
  end if;


  -- ========================================================
  -- REJEICAO
  -- ========================================================

  if p_action = 'REJECT' then

    if nullif(
      btrim(coalesce(p_review_note, '')),
      ''
    ) is null then
      raise exception
        'Review note is required for rejection';
    end if;

    update public.email_thread_event_candidates
    set
      status = 'REJECTED',
      reviewed_by_user_id = v_user_id,
      reviewed_at = now(),
      review_note = btrim(p_review_note)
    where id = v_candidate.id;

    insert into public.audit_log_entries (
      project_id,
      actor_type,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      detail
    )
    values (
      v_candidate.project_id,
      'USER',
      v_user_id,
      'CONTRACT_REVIEW_CANDIDATE_REJECTED',
      'EMAIL_THREAD_EVENT_CANDIDATE',
      v_candidate.id::text,
      concat(
        'Candidato rejeitado. Thread: ',
        v_candidate.provider_thread_id,
        '. Justificativa: ',
        btrim(p_review_note)
      )
    );

    return null;
  end if;


  -- ========================================================
  -- APROVACAO
  -- ========================================================

  if p_action <> 'APPROVE' then
    raise exception 'Invalid review action';
  end if;

  if nullif(
    btrim(coalesce(p_event_title, '')),
    ''
  ) is null then
    raise exception
      'Event title is required';
  end if;

  if nullif(
    btrim(coalesce(p_event_description, '')),
    ''
  ) is null then
    raise exception
      'Event description is required';
  end if;


  -- ========================================================
  -- CRIAR EVENTO
  -- ========================================================

  insert into public.contract_events (
    project_id,
    occurred_at,
    title,
    description,
    source_type,
    status,
    created_by_type,
    created_by_user_id
  )
  values (
    v_candidate.project_id,
    v_candidate.first_message_at,
    btrim(p_event_title),
    btrim(p_event_description),
    'EMAIL',
    'NOVO',
    'USER',
    v_user_id
  )
  returning id into v_event_id;


  -- ========================================================
  -- CATEGORIAS
  -- ========================================================

  insert into public.event_categories (
    event_id,
    category
  )
  select
    v_event_id,
    category
  from (
    select distinct
      unnest(v_candidate.categories) as category
  ) c
  on conflict do nothing;


  -- ========================================================
  -- TODAS AS MENSAGENS DO THREAD COMO EVIDENCIA
  -- ========================================================

  insert into public.event_evidence (
    event_id,
    source_type,
    label,
    locator,
    email_id
  )
  select
    v_event_id,
    'EMAIL',
    left(
      concat(
        'Gmail - ',
        coalesce(
          nullif(e.subject, ''),
          '(sem assunto)'
        )
      ),
      500
    ),
    concat(
      'gmail://',
      coalesce(
        e.mailbox_address,
        'unknown'
      ),
      '/',
      coalesce(
        e.provider_message_id,
        e.id::text
      )
    ),
    e.id
  from public.email_thread_event_candidate_emails ce
  join public.emails e
    on e.id = ce.email_id
  where ce.candidate_id = v_candidate.id
  order by e.sent_at;


  -- ========================================================
  -- FINALIZAR CANDIDATO
  -- ========================================================

  update public.email_thread_event_candidates
  set
    status = 'EVENT_CREATED',
    event_id = v_event_id,
    reviewed_by_user_id = v_user_id,
    reviewed_at = now(),
    review_note = coalesce(
      nullif(
        btrim(coalesce(p_review_note, '')),
        ''
      ),
      btrim(p_event_description)
    )
  where id = v_candidate.id;


  -- ========================================================
  -- AUDITORIA
  -- ========================================================

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    v_candidate.project_id,
    'USER',
    v_user_id,
    'CONTRACT_EVENT_CREATED_FROM_EMAIL_THREAD',
    'EMAIL_THREAD_EVENT_CANDIDATE',
    v_candidate.id::text,
    concat(
      'Candidato aprovado e convertido no Event Ledger. ',
      'Evento: ',
      v_event_id::text,
      '; thread: ',
      v_candidate.provider_thread_id,
      '; mensagens/evidencias: ',
      v_candidate.message_count,
      '.'
    )
  );

  return v_event_id;
end;
$function$
;


-- ============================================================
-- 5. review_event_clause_confrontation_candidate: exigir GERENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.review_event_clause_confrontation_candidate(p_candidate_id uuid, p_action text, p_review_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;

  v_candidate
    public.event_clause_confrontation_candidates%rowtype;

  v_project_id uuid;
  v_document_kind text;
  v_clause_number text;
  v_reference_kind text;
  v_cross_reference_id uuid;
begin

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  select *
  into v_candidate
  from public.event_clause_confrontation_candidates
  where id = p_candidate_id
  for update;


  if not found then
    raise exception
      'Confrontation candidate not found';
  end if;


  select ce.project_id
  into v_project_id
  from public.contract_events ce
  where ce.id = v_candidate.event_id;


  if not public.has_project_permission(
    v_project_id,
    'GERENTE'
  ) then
    raise exception
      'ADMINISTRADOR or GERENTE permission required';
  end if;


  if v_candidate.status
     <> 'PENDING_REVIEW' then
    raise exception
      'Candidate has already been reviewed';
  end if;


  if upper(trim(p_action)) = 'REJECT' then

    if nullif(trim(p_review_note), '') is null then
      raise exception
        'Review note is required for rejection';
    end if;


    update
    public.event_clause_confrontation_candidates
    set
      status = 'REJECTED',
      reviewed_by_user_id =
        v_user_id,
      reviewed_at = now(),
      review_note =
        trim(p_review_note)
    where id = p_candidate_id;


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
      v_project_id,
      'USER',
      v_user_id,
      null,
      'EVENT_CLAUSE_CONFRONTATION_REJECTED',
      'EVENT_CLAUSE_CONFRONTATION_CANDIDATE',
      p_candidate_id::text,
      format(
        'Confrontation candidate rejected. Reason: %s',
        trim(p_review_note)
      )
    );


    return null;


  elsif upper(trim(p_action)) = 'APPROVE' then

    select
      d.kind,
      c.clause_number
    into
      v_document_kind,
      v_clause_number
    from public.clauses c
    join public.document_versions dv
      on dv.id =
        c.document_version_id
    join public.documents d
      on d.id =
        dv.document_id
    where
      c.id =
        v_candidate.clause_id;


    v_reference_kind :=
      case

        when v_document_kind in (
          'CONTRATO_BASE',
          'ADITIVO'
        )
        then 'CONTRATO_ADITIVO'

        when v_document_kind in (
          'EDITAL',
          'RFI',
          'RFP'
        )
        then 'EDITAL_RFI_RFP'

        when v_document_kind =
          'PROPOSTA_AXION'
        then 'PROPOSTA_AXION'

        when v_document_kind in (
          'CRONOGRAMA_BASELINE',
          'CRONOGRAMA_REVISAO'
        )
        then 'CRONOGRAMA'

        when v_document_kind in (
          'ESPECIFICACAO',
          'DESENHO',
          'PLANILHA'
        )
        then 'PROJETO_TECNICO'

        else 'COMUNICACAO'

      end;


    insert into public.event_cross_references (
      event_id,
      kind,
      clause_id,
      note
    )
    values (
      v_candidate.event_id,
      v_reference_kind,
      v_candidate.clause_id,
      format(
        'Confronto humano aprovado. Clausula %s. %s',
        v_clause_number,
        v_candidate.summary
      )
    )

    on conflict (
      event_id,
      clause_id
    )
    where clause_id is not null
    do nothing

    returning id
    into v_cross_reference_id;


    if v_cross_reference_id is null then

      select id
      into v_cross_reference_id
      from public.event_cross_references
      where
        event_id =
          v_candidate.event_id
        and clause_id =
          v_candidate.clause_id;

    end if;


    update
    public.event_clause_confrontation_candidates
    set
      status = 'APPROVED',
      cross_reference_id =
        v_cross_reference_id,
      reviewed_by_user_id =
        v_user_id,
      reviewed_at = now(),
      review_note =
        nullif(
          trim(p_review_note),
          ''
        )
    where id = p_candidate_id;


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
      v_project_id,
      'USER',
      v_user_id,
      null,
      'EVENT_CLAUSE_CONFRONTATION_APPROVED',
      'EVENT_CROSS_REFERENCE',
      v_cross_reference_id::text,
      format(
        'Confrontation candidate %s approved for clause %s.',
        p_candidate_id,
        v_clause_number
      )
    );


    return v_cross_reference_id;


  else

    raise exception
      'Action must be APPROVE or REJECT';

  end if;

end;
$function$
;


-- ============================================================
-- 6. add_project_member: aceitar 'GERENTE' como papel valido
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

  if p_permission not in ('ADMINISTRADOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
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

  return v_row;
end;
$function$


;


-- ============================================================
-- 7. update_project_member_role: aceitar 'GERENTE' como papel valido
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_project_member_role(p_project_id uuid, p_user_id uuid, p_new_permission text)
 RETURNS project_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if p_new_permission not in ('ADMINISTRADOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
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
$function$


;

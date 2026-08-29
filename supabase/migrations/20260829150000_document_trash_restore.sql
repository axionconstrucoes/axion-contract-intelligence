-- ============================================================
-- 20260829150000_document_trash_restore.sql
-- Exclusão REVERSÍVEL de documentos (lixeira) — alternativa segura ao
-- hard-delete já existente (delete_project_document, migration
-- 20260825011148/20260825030844), que NUNCA foi conectado a nenhuma
-- tela (verificado nesta rodada: nenhuma referência a
-- delete_project_document em apps/web) e continua existindo,
-- inalterado, para o caso de uso dele (purga definitiva).
--
-- Trash/restore é sempre reversível — nada é apagado, nenhum arquivo
-- de Storage é tocado, nenhuma versão/cláusula/evidência muda. Por
-- isso NÃO herda as proteções forenses de delete_project_document
-- (evidência de evento, cross-reference): essas existem porque aquele
-- caminho é destrutivo; aqui nunca há perda de dado, só um flag
-- reversível — preserva rastreabilidade (CLAUDE.md #10/#11) por
-- construção, não por checagem.
--
-- Somente ADMINISTRADOR ativo do PROJETO do documento (mesmo padrão de
-- delete_project_document — checagem inline, nunca uma permissão
-- global do usuário) pode enviar para a lixeira ou restaurar.
-- ============================================================

alter table public.documents
  add column deleted_at timestamptz,
  add column deleted_by_user_id uuid
    references public.profiles (id) on delete restrict;

comment on column public.documents.deleted_at is
  'Momento em que o documento foi enviado para a lixeira (trash_project_document). NULL = documento ativo. Nunca apagado de verdade — restore_project_document reverte.';
comment on column public.documents.deleted_by_user_id is
  'ADMINISTRADOR que enviou o documento para a lixeira — sempre auth.uid() no momento, nunca aceito como parâmetro do cliente.';

create index documents_deleted_at_idx
  on public.documents (project_id, deleted_at);

-- ---------- is_active_project_administrator (helper CANÔNICO, exclusivo) ----------
--
-- Deliberadamente uma function NOVA e DEDICADA — nunca
-- has_project_permission(project_id, 'ADMINISTRADOR') (migration
-- 20260824090000), que é um helper HIERÁRQUICO genérico (aceita
-- qualquer p_min: 'GESTOR', 'COLABORADOR' etc.) — mesmo que hoje
-- 'ADMINISTRADOR' seja o topo da hierarquia e portanto
-- has_project_permission(id,'ADMINISTRADOR') já seja funcionalmente
-- exclusivo, essa função continua representando "no mínimo este
-- nível", não "exclusivamente ADMINISTRADOR" — um call site futuro
-- passando a string errada (ou uma mudança futura na hierarquia)
-- silenciosamente ampliaria quem pode excluir/ver a
-- lixeira/restaurar. is_active_project_administrator() não recebe
-- nível nenhum: só existe UM resultado possível, sem ambiguidade.
--
-- language sql + stable (nunca plpgsql aqui — sem necessidade de
-- controle de fluxo, mesmo estilo de has_project_permission).
create or replace function public.is_active_project_administrator(
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
      and pm.permission = 'ADMINISTRADOR'
  );
$$;

alter function public.is_active_project_administrator(uuid) owner to postgres;
revoke all on function public.is_active_project_administrator(uuid) from public;
revoke all on function public.is_active_project_administrator(uuid) from anon;
grant execute on function public.is_active_project_administrator(uuid) to authenticated;

-- ---------- trash_project_document ----------

create or replace function public.trash_project_document(
  p_document_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_document_title text;
  v_deleted_at timestamptz;
  v_kind text;
  v_parent_document_id uuid;
  v_active_children_count int;
  v_reason text;
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select d.project_id, d.title, d.deleted_at, d.kind, d.contractual_parent_document_id
    into v_project_id, v_document_title, v_deleted_at, v_kind, v_parent_document_id
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found then
    raise exception 'Documento não encontrado.';
  end if;

  -- ADMIN-ONLY, sempre resolvido no servidor via o helper CANÔNICO
  -- (auth.uid() interno, nunca um parâmetro do cliente; membership
  -- ACTIVE; permission EXATAMENTE 'ADMINISTRADOR' — GESTOR/
  -- COLABORADOR/LEITURA recusados, membership suspensa/removida
  -- recusada, usuário de outro projeto recusado, já que o próprio
  -- v_project_id resolvido acima é o do documento real). service_role
  -- chamando sem sessão (auth.uid() null) já foi recusado acima; um
  -- JWT forjado exigiria comprometer o JWT_SECRET, fora do escopo de
  -- uma checagem de aplicação.
  if not public.is_active_project_administrator(v_project_id) then
    raise exception
      'Somente Administrador ativo do projeto pode enviar documentos para a lixeira.';
  end if;

  if v_deleted_at is not null then
    raise exception 'Documento já está na lixeira.';
  end if;

  -- Mesmo mínimo/máximo de unlink_document_contractual_attachment —
  -- justificativa é sempre exigida para ENVIAR à lixeira (ação com
  -- efeito real na visibilidade do documento); RESTAURAR não exige
  -- justificativa própria, é sempre reversão pura de uma decisão já
  -- justificada.
  v_reason := public.normalize_contractual_text(p_reason);
  if v_reason is null or length(v_reason) < 20 then
    raise exception 'Justificativa da lixeira precisa ter pelo menos 20 caracteres úteis.';
  end if;
  if length(p_reason) > 2000 then
    raise exception 'Justificativa da lixeira não pode passar de 2000 caracteres.';
  end if;

  -- Nunca esconder um contrato-base/aditivo que ainda tem anexos
  -- contratuais ATIVOS vinculados — evita que a aba Documentos mostre
  -- anexos "órfãos" (o pai sumiria da lista principal, os filhos
  -- ficariam sem contexto visual). Mesma filosofia de
  -- documents_protect_contractual_link_integrity (migration
  -- 20260829090000), aplicada aqui à lixeira via checagem simples
  -- (não precisa de trigger: só este caminho seta deleted_at).
  if v_kind in ('CONTRATO_BASE', 'ADITIVO') then
    select count(*)
      into v_active_children_count
      from public.documents child
      where child.contractual_parent_document_id = p_document_id
        and child.deleted_at is null;

    if v_active_children_count > 0 then
      raise exception
        'Não é possível enviar para a lixeira: este documento ainda tem % anexo(s) contratual(is) vinculado(s). Desvincule-os primeiro.',
        v_active_children_count;
    end if;
  end if;

  -- Documento é ELE PRÓPRIO um anexo contratual ativo de outro
  -- instrumento — nunca esconder um anexo sem primeiro desvincular
  -- (link_document_as_contractual_attachment/unlink_...), senão o
  -- contrato/aditivo pai continuaria "achando" que tem esse anexo
  -- vinculado, mas ele sumiria da listagem.
  if v_parent_document_id is not null then
    raise exception
      'Não é possível enviar para a lixeira: este documento é um anexo contratual vinculado. Desvincule-o primeiro (documento pai: %).',
      v_parent_document_id;
  end if;

  -- As MESMAS 3 proteções forenses de delete_project_document (migration
  -- 20260825030844) — nunca desvincula automaticamente, sempre recusa
  -- com a mensagem exata do vínculo impeditivo. Trash é reversível,
  -- mas mesmo assim não deveria conseguir ESCONDER (mesmo
  -- temporariamente) um documento que sustenta evidência/cross-reference
  -- do Event Ledger sem ação humana explícita de desvínculo primeiro.
  if exists (
    select 1
    from public.event_evidence ee
    join public.document_versions dv
      on dv.id = ee.document_version_id
    where dv.document_id = p_document_id
  ) then
    raise exception
      'Não é possível enviar para a lixeira: uma versão deste documento é evidência de um evento do Event Ledger.';
  end if;

  if exists (
    select 1
    from public.event_cross_references ecr
    where ecr.document_id = p_document_id
  ) then
    raise exception
      'Não é possível enviar para a lixeira: existe referência direta a este documento no Event Ledger.';
  end if;

  if exists (
    select 1
    from public.event_cross_references ecr
    join public.clauses c
      on c.id = ecr.clause_id
    join public.document_versions dv
      on dv.id = c.document_version_id
    where dv.document_id = p_document_id
  ) then
    raise exception
      'Não é possível enviar para a lixeira: uma cláusula deste documento está referenciada no Event Ledger (evento, finding ou confronto).';
  end if;

  -- Vínculo com uma Proposta de Adicional (ação contratual real, ver
  -- migration 20260823070000, project_additional_proposal_links —
  -- coluna com ON DELETE RESTRICT, mesma convenção de "referência
  -- protegida" das 3 checagens acima).
  if exists (
    select 1
    from public.project_additional_proposal_links papl
    join public.document_versions dv
      on dv.id = papl.document_version_id
    where dv.document_id = p_document_id
  ) then
    raise exception
      'Não é possível enviar para a lixeira: uma versão deste documento está vinculada a uma Proposta de Adicional.';
  end if;

  update public.documents
  set deleted_at = now(),
      deleted_by_user_id = v_user_id
  where id = p_document_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_project_id, 'USER', v_user_id, null,
    'DOCUMENT_TRASHED', 'DOCUMENT', p_document_id::text,
    format(
      'Documento enviado para a lixeira. Título: %s. Estado anterior: ativo. Estado novo: lixeira. Justificativa: %s',
      coalesce(v_document_title, '(sem título)'),
      v_reason
    )
  );
end;
$$;

alter function public.trash_project_document(uuid, text) owner to postgres;
revoke all on function public.trash_project_document(uuid, text) from public;
revoke all on function public.trash_project_document(uuid, text) from anon;
grant execute on function public.trash_project_document(uuid, text) to authenticated;

-- ---------- restore_project_document ----------

create or replace function public.restore_project_document(
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_document_title text;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select d.project_id, d.title, d.deleted_at
    into v_project_id, v_document_title, v_deleted_at
    from public.documents d
    where d.id = p_document_id
    for update;

  if not found then
    raise exception 'Documento não encontrado.';
  end if;

  if not public.is_active_project_administrator(v_project_id) then
    raise exception
      'Somente Administrador ativo do projeto pode restaurar documentos da lixeira.';
  end if;

  if v_deleted_at is null then
    raise exception 'Documento não está na lixeira.';
  end if;

  update public.documents
  set deleted_at = null,
      deleted_by_user_id = null
  where id = p_document_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_project_id, 'USER', v_user_id, null,
    'DOCUMENT_RESTORED', 'DOCUMENT', p_document_id::text,
    format(
      'Documento restaurado da lixeira. Título: %s. Estado anterior: lixeira. Estado novo: ativo.',
      coalesce(v_document_title, '(sem título)')
    )
  );
end;
$$;

alter function public.restore_project_document(uuid) owner to postgres;
revoke all on function public.restore_project_document(uuid) from public;
revoke all on function public.restore_project_document(uuid) from anon;
grant execute on function public.restore_project_document(uuid) to authenticated;

-- ---------- RLS: documentos na lixeira só visíveis para ADMINISTRADOR ----------
--
-- A policy de SELECT existente (documents_select_project_members_only,
-- migration 20260818195206) permite QUALQUER membro do projeto ler
-- TODOS os documentos — nunca distinguiu lixeira. Isto NUNCA foi
-- corrigido só na UI/aplicação: uma policy RESTRITIVA aqui garante que
-- nenhum caller alternativo (REST direto, um script, uma tela futura)
-- consiga ver um documento na lixeira sem ser ADMINISTRADOR do
-- projeto, mesmo contornando toda a camada de aplicação. Policies
-- RESTRICTIVE são combinadas com AND às PERMISSIVE existentes — nunca
-- ampliam acesso, só podem negar.
create policy "documents_trash_visible_to_administrator_only"
  on public.documents
  as restrictive
  for select
  using (
    deleted_at is null
    or public.is_active_project_administrator(project_id)
  );

-- ---------- list_trashed_project_documents ----------
--
-- Mesma checagem ADMIN-only das duas RPCs acima, mas para LISTAGEM —
-- "visualizar a lixeira" também é ADMIN-only no servidor, nunca só uma
-- tela escondida (ver item 1 do relatório desta rodada). A policy
-- RESTRICTIVE acima já bloquearia um SELECT direto de não-admin, mas
-- esta RPC é o caminho real usado pela aplicação (get_trashed_documents
-- em document-management.ts) e falha com uma mensagem clara em vez de
-- simplesmente devolver uma lista vazia (que seria ambíguo: "lixeira
-- vazia" vs "sem permissão").
create or replace function public.list_trashed_project_documents(
  p_project_id uuid
)
returns table (
  id uuid,
  kind text,
  title text,
  deleted_at timestamptz,
  deleted_by_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.is_active_project_administrator(p_project_id) then
    raise exception
      'Somente Administrador ativo do projeto pode visualizar a lixeira.';
  end if;

  return query
    select d.id, d.kind, d.title, d.deleted_at, d.deleted_by_user_id
    from public.documents d
    where d.project_id = p_project_id
      and d.deleted_at is not null
    order by d.deleted_at desc;
end;
$$;

alter function public.list_trashed_project_documents(uuid) owner to postgres;
revoke all on function public.list_trashed_project_documents(uuid) from public;
revoke all on function public.list_trashed_project_documents(uuid) from anon;
grant execute on function public.list_trashed_project_documents(uuid) to authenticated;

notify pgrst, 'reload schema';

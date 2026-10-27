-- ============================================================
-- 20261027130000_project_delivery_items.sql
-- Tabela "Providências e pendências para entrega" de cada obra.
--
-- PROPOSTA — NÃO APLICADA. Aditiva (duas tabelas e funções novas). Depende de
-- 20261027120000_alert_followups.sql (acompanhamento recorrente compartilhado: a tabela e os
-- alertas usam o MESMO registro de acompanhamento, sem controles duplicados).
--
-- Regras (espelho de apps/web/lib/delivery/delivery-items.ts, testadas em
-- scripts/test-delivery-items.mjs e, no banco, em scripts/test-project-delivery-items-sql.mjs):
--   - nada é inventado: o checklist nasce sem datas, responsáveis, risco, evidência ou
--     aplicabilidade confirmada;
--   - responsável INTERNO = colaborador ATIVO da obra; dependência externa é registrada à parte;
--   - NÃO APLICÁVEL exige justificativa; CONCLUÍDO exige usuário autorizado + evidência ou
--     justificativa; registrar evidência sozinho NUNCA altera a situação;
--   - toda mudança fica no histórico (autor, data, detalhe);
--   - encerrar (concluído/não aplicável) resolve o acompanhamento recorrente; trocar o responsável
--     encaminha o acompanhamento (sem reiniciar o prazo).
-- ============================================================

create table public.project_delivery_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  title text not null check (btrim(title) <> ''),
  phase text not null check (phase in ('INICIO', 'ENTREGA')),
  -- Chave estável do checklist inicial (null = providência específica da obra).
  checklist_key text,

  deadline date,
  internal_deadline date,

  responsible_user_id uuid,
  dependency_kind text check (dependency_kind in ('CLIENTE', 'CONCESSIONARIA', 'TERCEIRO')),
  dependency_name text,

  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDO', 'NAO_APLICAVEL')),
  risk text check (risk in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),

  evidence text,
  justification text,
  blocks_delivery boolean not null default false,
  applicability_confirmed boolean not null default false,
  cno_number text,

  concluded_at timestamptz,
  concluded_by_user_id uuid references public.profiles (id) on delete restrict,

  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, responsible_user_id)
    references public.project_memberships (project_id, user_id) on delete restrict,

  check ((dependency_kind is null) = (dependency_name is null)),
  check (status <> 'NAO_APLICAVEL' or btrim(coalesce(justification, '')) <> ''),
  check (status <> 'CONCLUIDO' or btrim(coalesce(evidence, '')) <> '' or btrim(coalesce(justification, '')) <> ''),
  check ((status = 'CONCLUIDO') = (concluded_at is not null))
);

create unique index project_delivery_items_checklist_key_idx
  on public.project_delivery_items (project_id, checklist_key)
  where checklist_key is not null;

create index project_delivery_items_project_idx
  on public.project_delivery_items (project_id, phase, status);

create table public.project_delivery_item_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.project_delivery_items (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('CREATED', 'STATUS', 'FIELD', 'EVIDENCE', 'END_DATE_CHANGED')),
  actor_user_id uuid references public.profiles (id) on delete restrict,
  detail text not null,
  created_at timestamptz not null default now()
);

create index project_delivery_item_events_item_idx
  on public.project_delivery_item_events (item_id, created_at);

create or replace function public.project_delivery_items_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger project_delivery_items_set_updated_at
before update on public.project_delivery_items
for each row execute function public.project_delivery_items_set_updated_at();

alter table public.project_delivery_items enable row level security;
alter table public.project_delivery_item_events enable row level security;

-- Leitura: membros ATIVOS da obra. Escrita: somente pelas funções abaixo.
create policy "project_delivery_items_select_members"
  on public.project_delivery_items for select to authenticated
  using (
    exists (
      select 1 from public.project_memberships pm
      where pm.project_id = project_delivery_items.project_id
        and pm.user_id = auth.uid() and pm.status = 'ACTIVE'
    )
  );

create policy "project_delivery_item_events_select_members"
  on public.project_delivery_item_events for select to authenticated
  using (
    exists (
      select 1 from public.project_memberships pm
      where pm.project_id = project_delivery_item_events.project_id
        and pm.user_id = auth.uid() and pm.status = 'ACTIVE'
    )
  );

-- ------------------------------------------------------------
-- Funções (usuário autenticado; escrita exige gestor/gerente/administrador da obra)
-- ------------------------------------------------------------

create or replace function public.delivery_items_seed_checklist(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted integer;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;
  if not public.has_project_permission(p_project_id, 'GESTOR') then
    raise exception 'Você não tem permissão para configurar as providências desta obra.';
  end if;

  with template(key, title, phase) as (
    values
      ('CNO', 'Inscrição da obra no CNO — matrícula da obra no INSS', 'INICIO'),
      ('AS_BUILT', 'As-built', 'ENTREGA'),
      ('DATABOOK', 'Databook — consolidação final', 'ENTREGA'),
      ('CATALOGOS_MANUAIS', 'Catálogos e manuais', 'ENTREGA'),
      ('TERMOS_GARANTIA', 'Termos de garantia', 'ENTREGA'),
      ('NOTAS_FISCAIS_DATABOOK', 'Notas fiscais pertinentes ao databook', 'ENTREGA'),
      ('ISS', 'Quitação/regularização do ISS', 'ENTREGA'),
      ('AVCB', 'AVCB — Auto de Vistoria do Corpo de Bombeiros', 'ENTREGA'),
      ('AGUA_PEDIDO', 'Água: pedido protocolado', 'ENTREGA'),
      ('AGUA_LIGACAO', 'Água: ligação efetivada', 'ENTREGA'),
      ('ESGOTO_PEDIDO', 'Esgoto: pedido protocolado', 'ENTREGA'),
      ('ESGOTO_LIGACAO', 'Esgoto: ligação efetivada', 'ENTREGA'),
      ('ENERGIA_PEDIDO', 'Energia: pedido protocolado', 'ENTREGA'),
      ('ENERGIA_LIGACAO', 'Energia: ligação efetivada', 'ENTREGA')
  ),
  ins as (
    insert into public.project_delivery_items (project_id, title, phase, checklist_key, created_by_user_id)
    select p_project_id, t.title, t.phase, t.key, v_actor
    from template t
    on conflict (project_id, checklist_key) where checklist_key is not null do nothing
    returning id
  )
  select count(*) into v_inserted from ins;

  insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
  select i.id, i.project_id, 'CREATED', v_actor, 'Item do checklist inicial (aplicabilidade e responsabilidade contratual a confirmar).'
  from public.project_delivery_items i
  where i.project_id = p_project_id
    and i.checklist_key is not null
    and not exists (select 1 from public.project_delivery_item_events e where e.item_id = i.id and e.kind = 'CREATED');

  return v_inserted;
end;
$$;

create or replace function public.delivery_item_add_custom(
  p_project_id uuid,
  p_title text,
  p_phase text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;
  if not public.has_project_permission(p_project_id, 'GESTOR') then
    raise exception 'Você não tem permissão para configurar as providências desta obra.';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Informe o nome da providência.'; end if;
  if p_phase not in ('INICIO', 'ENTREGA') then raise exception 'Fase inválida.'; end if;

  insert into public.project_delivery_items (project_id, title, phase, created_by_user_id)
  values (p_project_id, btrim(p_title), p_phase, v_actor)
  returning id into v_id;

  insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
  values (v_id, p_project_id, 'CREATED', v_actor, 'Providência específica da obra.');
  return v_id;
end;
$$;

create or replace function public.delivery_item_update_fields(
  p_item_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.project_delivery_items%rowtype;
  v_new_responsible uuid;
  v_changed text[] := '{}';
  v_evidence_changed boolean := false;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;

  select * into v_item from public.project_delivery_items where id = p_item_id for update;
  if not found then raise exception 'Providência não encontrada.'; end if;
  if not public.has_project_permission(v_item.project_id, 'GESTOR') then
    raise exception 'Você não tem permissão para editar as providências desta obra.';
  end if;

  if p_fields ? 'responsible_user_id' then
    v_new_responsible := nullif(p_fields ->> 'responsible_user_id', '')::uuid;
    if v_new_responsible is not null and not exists (
      select 1 from public.project_memberships pm
      where pm.project_id = v_item.project_id and pm.user_id = v_new_responsible and pm.status = 'ACTIVE'
    ) then
      raise exception 'O responsável interno precisa ser um colaborador ativo da obra.';
    end if;
  end if;

  if p_fields ? 'dependency_kind' and nullif(p_fields ->> 'dependency_kind', '') is not null
     and btrim(coalesce(p_fields ->> 'dependency_name', '')) = '' then
    raise exception 'Informe quem é a parte externa (cliente, concessionária ou terceiro).';
  end if;

  update public.project_delivery_items i
  set
    deadline = case when p_fields ? 'deadline' then nullif(p_fields ->> 'deadline', '')::date else i.deadline end,
    internal_deadline = case when p_fields ? 'internal_deadline' then nullif(p_fields ->> 'internal_deadline', '')::date else i.internal_deadline end,
    responsible_user_id = case when p_fields ? 'responsible_user_id' then v_new_responsible else i.responsible_user_id end,
    dependency_kind = case when p_fields ? 'dependency_kind' then nullif(p_fields ->> 'dependency_kind', '') else i.dependency_kind end,
    dependency_name = case when p_fields ? 'dependency_kind'
                           then case when nullif(p_fields ->> 'dependency_kind', '') is null then null else btrim(p_fields ->> 'dependency_name') end
                           else i.dependency_name end,
    risk = case when p_fields ? 'risk' then nullif(p_fields ->> 'risk', '') else i.risk end,
    blocks_delivery = case when p_fields ? 'blocks_delivery' then (p_fields ->> 'blocks_delivery')::boolean else i.blocks_delivery end,
    applicability_confirmed = case when p_fields ? 'applicability_confirmed' then (p_fields ->> 'applicability_confirmed')::boolean else i.applicability_confirmed end,
    cno_number = case when p_fields ? 'cno_number' then nullif(btrim(p_fields ->> 'cno_number'), '') else i.cno_number end,
    evidence = case when p_fields ? 'evidence' then nullif(btrim(p_fields ->> 'evidence'), '') else i.evidence end
  where i.id = p_item_id;

  v_evidence_changed := p_fields ? 'evidence' and nullif(btrim(p_fields ->> 'evidence'), '') is distinct from v_item.evidence;

  select coalesce(array_agg(k order by k), '{}') into v_changed
  from jsonb_object_keys(p_fields) k where k <> 'evidence';

  if array_length(v_changed, 1) > 0 then
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    values (p_item_id, v_item.project_id, 'FIELD', v_actor, 'Campos atualizados: ' || array_to_string(v_changed, ', '));
  end if;
  if v_evidence_changed then
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    values (p_item_id, v_item.project_id, 'EVIDENCE', v_actor, 'Evidência registrada (a situação não foi alterada).');
  end if;

  -- Registro COMPARTILHADO com os alertas: trocar o responsável encaminha o acompanhamento
  -- recorrente aberto, sem reiniciar o calendário.
  if p_fields ? 'responsible_user_id' and v_new_responsible is not null
     and v_new_responsible is distinct from v_item.responsible_user_id then
    update public.alert_followups
    set responsible_user_id = v_new_responsible
    where project_id = v_item.project_id and source_type = 'DELIVERY_ITEM' and source_id = p_item_id and status = 'OPEN';
    insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id, from_user_id, to_user_id)
    select f.id, f.project_id, 'FORWARDED', v_actor, v_item.responsible_user_id, v_new_responsible
    from public.alert_followups f
    where f.project_id = v_item.project_id and f.source_type = 'DELIVERY_ITEM' and f.source_id = p_item_id and f.status = 'OPEN';
  end if;
end;
$$;

create or replace function public.delivery_item_change_status(
  p_item_id uuid,
  p_status text,
  p_justification text default null,
  p_evidence text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.project_delivery_items%rowtype;
  v_evidence text;
  v_justification text;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;
  if p_status not in ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDO', 'NAO_APLICAVEL') then raise exception 'Situação inválida.'; end if;

  select * into v_item from public.project_delivery_items where id = p_item_id for update;
  if not found then raise exception 'Providência não encontrada.'; end if;
  if not public.has_project_permission(v_item.project_id, 'GESTOR') then
    raise exception 'Concluir ou alterar a situação exige confirmação de um usuário autorizado (gestor, gerente ou administrador).';
  end if;
  if v_item.status = p_status then raise exception 'A providência já está nesta situação.'; end if;

  v_evidence := coalesce(nullif(btrim(p_evidence), ''), v_item.evidence);
  v_justification := coalesce(nullif(btrim(p_justification), ''), v_item.justification);

  if p_status = 'CONCLUIDO' and v_evidence is null and nullif(btrim(p_justification), '') is null then
    raise exception 'Concluir exige evidência/documento/protocolo ou uma justificativa.';
  end if;
  if p_status = 'NAO_APLICAVEL' and nullif(btrim(p_justification), '') is null then
    raise exception 'Não aplicável exige justificativa.';
  end if;

  update public.project_delivery_items
  set status = p_status,
      evidence = v_evidence,
      justification = v_justification,
      concluded_at = case when p_status = 'CONCLUIDO' then now() else null end,
      concluded_by_user_id = case when p_status = 'CONCLUIDO' then v_actor else null end
  where id = p_item_id;

  insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
  values (p_item_id, v_item.project_id, 'STATUS', v_actor,
          v_item.status || ' → ' || p_status || coalesce(': ' || nullif(btrim(p_justification), ''), ''));

  -- Registro COMPARTILHADO com os alertas: encerrar a providência resolve o acompanhamento.
  if p_status in ('CONCLUIDO', 'NAO_APLICAVEL') then
    with closed as (
      update public.alert_followups
      set status = 'RESOLVED', next_reminder_at = null, claim_token = null, claimed_until = null,
          resolved_at = now(), resolved_by_user_id = v_actor
      where project_id = v_item.project_id and source_type = 'DELIVERY_ITEM' and source_id = p_item_id and status = 'OPEN'
      returning id, project_id
    )
    insert into public.alert_followup_events (followup_id, project_id, kind, actor_user_id)
    select id, project_id, 'RESOLVED', v_actor from closed;
  end if;
end;
$$;

revoke all on function public.delivery_items_seed_checklist(uuid) from public;
revoke all on function public.delivery_item_add_custom(uuid, text, text) from public;
revoke all on function public.delivery_item_update_fields(uuid, jsonb) from public;
revoke all on function public.delivery_item_change_status(uuid, text, text, text) from public;
grant execute on function public.delivery_items_seed_checklist(uuid) to authenticated;
grant execute on function public.delivery_item_add_custom(uuid, text, text) to authenticated;
grant execute on function public.delivery_item_update_fields(uuid, jsonb) to authenticated;
grant execute on function public.delivery_item_change_status(uuid, text, text, text) to authenticated;

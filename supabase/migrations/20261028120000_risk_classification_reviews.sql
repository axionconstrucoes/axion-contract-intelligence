-- ============================================================
-- 20261028120000_risk_classification_reviews.sql
-- Revisão HUMANA do grau de risco (CRÍTICO/ALTO/MÉDIO/BAIXO) de alertas contratuais e providências,
-- com justificativa obrigatória e histórico imutável.
--
-- PROPOSTA — NÃO APLICADA. Aditiva (uma tabela, uma função de revisão, um gatilho de histórico).
-- Depende de: contract_events / event_ai_assessments (20260818224157), alert_followups
-- (20261027120000) e project_delivery_items (20261027130000). Ordem: depois de 20261027150000.
--
-- Princípios:
--   - a classificação da IA (event_ai_assessments.severity) NUNCA é sobrescrita: a revisão humana é
--     um registro separado; o grau EFETIVO é a revisão mais recente (ou, sem revisão, o da IA);
--   - revisar exige gestor/gerente/administrador da obra DONA do alerta (a obra vem do próprio
--     registro, nunca do navegador), justificativa preenchida e grau diferente do atual;
--   - o histórico é append-only (gatilho impede UPDATE/DELETE, inclusive para o service role);
--   - alterações diretas do risco de uma providência (tabela de providências) também entram no
--     histórico, marcadas como "sem justificativa informada" — nada muda de grau sem rastro;
--   - a revisão ajusta o acompanhamento recorrente ABERTO ao novo grau (1/2/4/7 dias) sem mudar
--     o próximo lembrete já agendado.
-- ============================================================

create table public.risk_classification_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_type text not null check (source_type in ('CONTRACT_EVENT', 'DELIVERY_ITEM')),
  source_id uuid not null,

  previous_level text check (previous_level in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  new_level text not null check (new_level in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  -- Grau sugerido pelo sistema no momento (pode ser nulo: sugestão indeterminada) e o retrato
  -- completo da sugestão (fatos/inferências/recomendações/informações faltantes).
  suggested_level text check (suggested_level in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  suggestion jsonb,

  justification text not null check (btrim(justification) <> ''),
  -- Referência verificável informada pelo revisor (cláusula, documento, protocolo...).
  reference text,

  origin text not null default 'REVISAO_HUMANA' check (origin in ('REVISAO_HUMANA', 'ALTERACAO_DIRETA_PROVIDENCIA')),
  reviewer_user_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),

  check (suggestion is null or pg_column_size(suggestion) < 40000)
);

create index risk_classification_reviews_source_idx
  on public.risk_classification_reviews (project_id, source_type, source_id, created_at desc);

-- Histórico imutável: nenhuma atualização/remoção, nem pelo service role.
create or replace function public.risk_classification_reviews_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico de classificação de risco não pode ser alterado nem apagado.';
end;
$$;

create trigger risk_classification_reviews_no_update
before update or delete on public.risk_classification_reviews
for each row execute function public.risk_classification_reviews_immutable();

alter table public.risk_classification_reviews enable row level security;

-- Leitura: membros ATIVOS da obra. Escrita: somente pela função de revisão (e pelo gatilho).
create policy "risk_classification_reviews_select_members"
  on public.risk_classification_reviews for select to authenticated
  using (
    exists (
      select 1 from public.project_memberships pm
      where pm.project_id = risk_classification_reviews.project_id
        and pm.user_id = auth.uid() and pm.status = 'ACTIVE'
    )
  );

-- ------------------------------------------------------------
-- Revisão humana
-- ------------------------------------------------------------
create or replace function public.review_risk_classification(
  p_source_type text,
  p_source_id uuid,
  p_new_level text,
  p_justification text,
  p_reference text default null,
  p_suggestion jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_project uuid;
  v_previous text;
  v_suggested text;
  v_id uuid;
  v_hours integer;
begin
  if v_actor is null then raise exception 'Sessão expirada. Faça login novamente.'; end if;
  if coalesce(p_source_type, '') not in ('CONTRACT_EVENT', 'DELIVERY_ITEM') then raise exception 'Origem de alerta inválida.'; end if;
  if coalesce(p_new_level, '') not in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') then raise exception 'Grau de risco inválido.'; end if;
  if btrim(coalesce(p_justification, '')) = '' then raise exception 'Informe a justificativa da classificação de risco.'; end if;

  -- A obra vem do PRÓPRIO registro: um id de outra obra nunca é aceito por um gestor desta.
  if p_source_type = 'CONTRACT_EVENT' then
    select e.project_id into v_project from public.contract_events e where e.id = p_source_id;
    if not found then raise exception 'Alerta não encontrado.'; end if;
    select coalesce(
      (select r.new_level from public.risk_classification_reviews r
        where r.source_type = 'CONTRACT_EVENT' and r.source_id = p_source_id
        order by r.created_at desc, r.id desc limit 1),
      (select a.severity from public.event_ai_assessments a where a.event_id = p_source_id)
    ) into v_previous;
  else
    select i.project_id, i.risk into v_project, v_previous
    from public.project_delivery_items i where i.id = p_source_id for update;
    if not found then raise exception 'Providência não encontrada.'; end if;
  end if;

  if not public.has_project_permission(v_project, 'GESTOR') then
    raise exception 'Revisar o grau de risco exige gestor, gerente ou administrador da obra.';
  end if;
  if v_previous is not distinct from p_new_level then raise exception 'O grau de risco já é este.'; end if;

  v_suggested := nullif(p_suggestion ->> 'level', '');
  if v_suggested is not null and v_suggested not in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') then v_suggested := null; end if;

  insert into public.risk_classification_reviews (
    project_id, source_type, source_id, previous_level, new_level, suggested_level, suggestion,
    justification, reference, origin, reviewer_user_id
  ) values (
    v_project, p_source_type, p_source_id, v_previous, p_new_level, v_suggested, p_suggestion,
    btrim(p_justification), nullif(btrim(coalesce(p_reference, '')), ''), 'REVISAO_HUMANA', v_actor
  ) returning id into v_id;

  if p_source_type = 'DELIVERY_ITEM' then
    -- Sinaliza ao gatilho de histórico que esta alteração JÁ foi registrada (com justificativa).
    perform set_config('app.risk_review_logged', '1', true);
    update public.project_delivery_items set risk = p_new_level where id = p_source_id;
    perform set_config('app.risk_review_logged', '', true);
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    values (p_source_id, v_project, 'FIELD', v_actor,
            'Risco revisado: ' || coalesce(v_previous, 'a definir') || ' → ' || p_new_level || ' (ver histórico de classificação)');
  end if;

  -- Acompanhamento recorrente ABERTO passa ao intervalo do novo grau. O próximo lembrete já
  -- agendado NÃO muda (next_reminder_at intocado): a revisão nunca adia nem antecipa um envio.
  v_hours := case p_new_level when 'CRITICA' then 24 when 'ALTA' then 48 when 'MEDIA' then 96 else 168 end;
  update public.alert_followups
  set severity = p_new_level, interval_hours = v_hours
  where project_id = v_project and source_type = p_source_type and source_id = p_source_id and status = 'OPEN';

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- Histórico também para alterações DIRETAS do risco de uma providência
-- ------------------------------------------------------------
create or replace function public.project_delivery_items_log_risk_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.risk_review_logged', true), '') = '1' then return new; end if;
  insert into public.risk_classification_reviews (
    project_id, source_type, source_id, previous_level, new_level, justification, origin, reviewer_user_id
  ) values (
    new.project_id, 'DELIVERY_ITEM', new.id, old.risk, new.risk,
    'Alteração direta na tabela de providências (sem justificativa informada).',
    'ALTERACAO_DIRETA_PROVIDENCIA', auth.uid()
  );
  return new;
end;
$$;

-- Só registra quando há grau novo (limpar o risco de volta a "a definir" não é uma classificação).
create trigger project_delivery_items_log_risk_change
after update of risk on public.project_delivery_items
for each row
when (old.risk is distinct from new.risk and new.risk is not null)
execute function public.project_delivery_items_log_risk_change();

revoke all on function public.review_risk_classification(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.review_risk_classification(text, uuid, text, text, text, jsonb) to authenticated;

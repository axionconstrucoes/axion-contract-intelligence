-- ============================================================
-- 20260819002246_contract_change_foundation.sql
-- Fundacao de ContractChange: entidade propria, distinta de
-- aprovacao do cliente, aditivo, entitlement e claim. Event NAO
-- vira ContractChange automaticamente (fluxo futuro via Potential
-- Change, nao implementado agora). Sem campos financeiros, sem
-- entitlement_status, sem aditivo/ScheduleVersion/ActionRequest,
-- sem seed. contract_change_events e contract_change_evidence sao
-- relacoes N:N; a evidencia vinculada a um ContractChange precisa
-- pertencer a um Event que tambem esteja vinculado ao mesmo
-- ContractChange (garantido por FK composta, ver abaixo).
-- ============================================================

create table public.contract_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  code text not null,
  title text not null,
  description text not null,
  -- workflow status operacional (NAO confundir com aceitacao/rejeicao
  -- do cliente, que vive em client_formalization_status).
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED', 'CANCELLED')),
  identified_at timestamptz not null,
  created_by_type text not null
    check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid
    references public.profiles (id) on delete restrict,
  created_by_label text,
  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  -- Mesmo conjunto de estados ja usado em schedule_versions
  -- (client_formalization_status). Nao criar sexto estado aqui.
  client_formalization_status text not null default 'NOT_SUBMITTED'
    check (client_formalization_status in (
      'NOT_SUBMITTED', 'PENDING', 'FORMALIZED', 'REJECTED', 'UNCLEAR'
    )),
  -- Impacto tecnico de prazo, distinto de entitlement contratual a
  -- extensao (entitlement_status fica para lote futuro).
  schedule_impact_status text not null default 'PENDING_ASSESSMENT'
    check (schedule_impact_status in (
      'PENDING_ASSESSMENT', 'NO_IMPACT',
      'ABSORBABLE_WITHIN_CONTRACT_TERM', 'EXTENSION_REQUIRED'
    )),
  -- Estimativa tecnica de dias adicionais; nunca inferida
  -- automaticamente, sempre informada por revisao humana.
  technical_additional_days integer
    check (technical_additional_days is null or technical_additional_days >= 0),
  created_at timestamptz not null default now(),
  check (btrim(code) <> ''),
  check (btrim(title) <> ''),
  check (btrim(description) <> ''),
  unique (project_id, code),
  -- Redundante em relacao ao PK(id); existe exclusivamente para
  -- servir de alvo da FK composta de contract_change_events,
  -- garantindo que a junction nao possa apontar para um
  -- ContractChange de projeto diferente do ContractEvent vinculado.
  constraint contract_changes_id_project_id_key unique (id, project_id)
);

create index contract_changes_project_id_idx
  on public.contract_changes (project_id);

create index contract_changes_project_id_identified_at_idx
  on public.contract_changes (project_id, identified_at desc);

-- ---------- contract_change_events (N:N) ----------
-- project_id nesta tabela NAO existe por conveniencia de RLS (a
-- autorizacao continua derivada via contract_changes pai). Existe
-- exclusivamente para permitir as FKs compostas abaixo, que
-- impedem declarativamente (sem trigger) que um ContractChange de
-- um projeto seja vinculado a um ContractEvent de outro projeto.

-- Redundante em relacao ao PK(id) de contract_events; necessario
-- como alvo da FK composta. Nao alteramos a migration antiga do
-- Event Ledger — este constraint aditivo e criado aqui.
alter table public.contract_events
  add constraint contract_events_id_project_id_key unique (id, project_id);

create table public.contract_change_events (
  contract_change_id uuid not null,
  event_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contract_change_id, event_id),
  foreign key (contract_change_id, project_id)
    references public.contract_changes (id, project_id)
    on delete cascade,
  foreign key (event_id, project_id)
    references public.contract_events (id, project_id)
    on delete cascade
);

create index contract_change_events_event_id_project_id_idx
  on public.contract_change_events (event_id, project_id);

-- ---------- contract_change_evidence (N:N) ----------
-- A Evidence citada por um ContractChange nao e copiada aqui: os
-- dados (source_type/label/locator/document_version_id/email_id)
-- continuam pertencendo exclusivamente a event_evidence. Esta
-- tabela guarda apenas a relacao.
--
-- Integridade forense: e proibido vincular a este ContractChange
-- uma Evidence cujo Event nao esteja, ele proprio, vinculado ao
-- mesmo ContractChange. Isso e garantido declarativamente (sem
-- trigger) por duas FKs compostas:
--   (contract_change_id, event_id) -> contract_change_events(...)
--   (event_evidence_id, event_id)  -> event_evidence(id, event_id)
-- A segunda FK exige um UNIQUE(id, event_id) em event_evidence, que
-- nao existe na migration original; adicionamos esse constraint
-- aditivo aqui (nao alteramos a migration antiga).

alter table public.event_evidence
  add constraint event_evidence_id_event_id_key unique (id, event_id);

create table public.contract_change_evidence (
  contract_change_id uuid not null,
  event_id uuid not null,
  event_evidence_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contract_change_id, event_evidence_id),
  foreign key (contract_change_id, event_id)
    references public.contract_change_events (contract_change_id, event_id)
    on delete cascade,
  foreign key (event_evidence_id, event_id)
    references public.event_evidence (id, event_id)
    on delete restrict
);

-- ---------- RLS ----------

alter table public.contract_changes enable row level security;
alter table public.contract_change_events enable row level security;
alter table public.contract_change_evidence enable row level security;

create policy "contract_changes_select_project_members_only"
  on public.contract_changes
  for select
  using (public.is_project_member(project_id));

create policy "contract_change_events_select_project_members_only"
  on public.contract_change_events
  for select
  using (
    exists (
      select 1
      from public.contract_changes cc
      where cc.id = contract_change_events.contract_change_id
        and public.is_project_member(cc.project_id)
    )
  );

create policy "contract_change_evidence_select_project_members_only"
  on public.contract_change_evidence
  for select
  using (
    exists (
      select 1
      from public.contract_changes cc
      where cc.id = contract_change_evidence.contract_change_id
        and public.is_project_member(cc.project_id)
    )
  );

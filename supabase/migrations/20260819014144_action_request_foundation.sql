-- ============================================================
-- 20260819014144_action_request_foundation.sql
-- Fundacao de ActionRequest: solicitacao rastreavel distinta de
-- Alert (notificacao passiva), Email (canal), Event (fato ja
-- ocorrido) e ContractChange (a alteracao em si). Response e
-- entidade propria (nunca coluna unica), suportando canal APP ou
-- EMAIL — o corpo do email permanece em public.emails, nunca
-- duplicado aqui. Assignee exige membership real no mesmo projeto.
-- ContractChange->ActionRequest e relacao aditiva opcional (1:N,
-- uma ActionRequest pertence a no maximo um ContractChange nesta
-- versao). Sem Notifications, sem Gmail/Google Workspace, sem
-- contatos externos, sem interpretacao de IA, sem Event Ledger
-- automatico, sem writes de aplicacao, sem UI, sem seed.
-- ============================================================

create table public.action_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  title text not null,
  description text not null,
  -- Workflow operacional minimo. "Resposta recebida" nao fecha a
  -- solicitacao automaticamente — isso e derivavel de
  -- action_request_responses, nunca um status proprio (ex.: ANSWERED).
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED', 'CANCELLED')),
  requested_at timestamptz not null,
  due_at timestamptz,
  closed_at timestamptz,
  created_by_type text not null
    check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid
    references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),
  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (btrim(title) <> ''),
  check (btrim(description) <> ''),
  check (
    (status = 'OPEN' and closed_at is null)
    or (status in ('CLOSED', 'CANCELLED') and closed_at is not null)
  ),
  -- Redundante em relacao ao PK(id); alvo das FKs compostas das
  -- tabelas filhas e da junction com ContractChange.
  constraint action_requests_id_project_id_key unique (id, project_id)
);

create index action_requests_project_id_idx
  on public.action_requests (project_id);

create index action_requests_project_id_requested_at_idx
  on public.action_requests (project_id, requested_at desc);

create index action_requests_project_id_due_at_idx
  on public.action_requests (project_id, due_at);

-- ---------- action_request_assignees (N:N com profiles) ----------
-- O responsavel deve ser membro real do MESMO projeto da
-- ActionRequest — garantido declarativamente pela FK composta
-- abaixo, sem trigger. Sem departamento/role/especialidade.

create table public.action_request_assignees (
  action_request_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (action_request_id, user_id),
  foreign key (action_request_id, project_id)
    references public.action_requests (id, project_id)
    on delete cascade,
  foreign key (project_id, user_id)
    references public.project_memberships (project_id, user_id)
    on delete restrict
);

create index action_request_assignees_user_id_project_id_idx
  on public.action_request_assignees (user_id, project_id);

-- ---------- integridade email <-> project ----------
-- Redundante em relacao ao PK(id) de emails; necessario como alvo
-- da FK composta de action_request_responses. Nao alteramos a
-- migration antiga de Email.
alter table public.emails
  add constraint emails_id_project_id_key unique (id, project_id);

-- ---------- action_request_responses ----------
-- Resposta e fato separado do ActionRequest, suportando multiplas
-- respostas, de pessoas diferentes, pelo sistema ou por email.
-- Conteudo original (content) nunca e interpretacao de IA — essa
-- distincao fica para uma futura entidade separada, nunca coluna
-- aqui. Corpo do email permanece exclusivamente em public.emails;
-- esta tabela guarda somente a referencia (email_id), nunca copia.
create table public.action_request_responses (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null,
  project_id uuid not null,
  channel text not null
    check (channel in ('APP', 'EMAIL')),
  responder_user_id uuid,
  email_id uuid,
  content text,
  responded_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (action_request_id, project_id)
    references public.action_requests (id, project_id)
    on delete cascade,
  foreign key (project_id, responder_user_id)
    references public.project_memberships (project_id, user_id)
    on delete restrict,
  foreign key (email_id, project_id)
    references public.emails (id, project_id)
    on delete restrict,
  check (
    (
      channel = 'APP'
      and responder_user_id is not null
      and email_id is null
      and content is not null
      and btrim(content) <> ''
    )
    or (
      channel = 'EMAIL'
      and email_id is not null
      and content is null
    )
  ),
  -- Impede o mesmo email de virar duas respostas da mesma
  -- ActionRequest; multiplos NULLs (respostas APP) permanecem
  -- permitidos pela semantica padrao de UNIQUE no Postgres.
  unique (action_request_id, email_id)
);

-- ---------- contract_change_action_requests (1:N opcional) ----------
-- Relacao aditiva: ActionRequest continua podendo existir sem
-- nenhum ContractChange. UNIQUE(action_request_id) garante que uma
-- ActionRequest pertenca a no maximo um ContractChange nesta versao.
-- Consistencia de projeto garantida declarativamente pelas duas FKs
-- compostas, sem trigger — mesmo padrao ja usado em
-- contract_change_events.
create table public.contract_change_action_requests (
  contract_change_id uuid not null,
  action_request_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contract_change_id, action_request_id),
  foreign key (contract_change_id, project_id)
    references public.contract_changes (id, project_id)
    on delete cascade,
  foreign key (action_request_id, project_id)
    references public.action_requests (id, project_id)
    on delete cascade,
  unique (action_request_id)
);

-- ---------- RLS ----------

alter table public.action_requests enable row level security;
alter table public.action_request_assignees enable row level security;
alter table public.action_request_responses enable row level security;
alter table public.contract_change_action_requests enable row level security;

create policy "action_requests_select_project_members_only"
  on public.action_requests
  for select
  using (public.is_project_member(project_id));

create policy "action_request_assignees_select_project_members_only"
  on public.action_request_assignees
  for select
  using (
    exists (
      select 1
      from public.action_requests ar
      where ar.id = action_request_assignees.action_request_id
        and public.is_project_member(ar.project_id)
    )
  );

create policy "action_request_responses_select_project_members_only"
  on public.action_request_responses
  for select
  using (
    exists (
      select 1
      from public.action_requests ar
      where ar.id = action_request_responses.action_request_id
        and public.is_project_member(ar.project_id)
    )
  );

create policy "contract_change_action_requests_select_project_members_only"
  on public.contract_change_action_requests
  for select
  using (
    exists (
      select 1
      from public.contract_changes cc
      where cc.id = contract_change_action_requests.contract_change_id
        and public.is_project_member(cc.project_id)
    )
  );

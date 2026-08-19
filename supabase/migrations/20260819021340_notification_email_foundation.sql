-- ============================================================
-- 20260819021340_notification_email_foundation.sql
-- Fundacao de Notification + Email Delivery: Notification e o
-- registro de como o sistema comunica um ActionRequest (inicial,
-- lembrete, escalonamento) — distinta do proprio ActionRequest (o
-- que precisa ser feito) e de Email (a mensagem efetivamente
-- enviada/recebida, que continua vivendo em public.emails).
-- notification_email_deliveries e infraestrutura de mensagem:
-- unico lugar onde metadata de provider (Gmail/etc.) pode viver
-- futuramente — nunca em action_requests/action_request_responses/
-- notifications. Nenhum fluxo inbound real, nenhuma integracao
-- Gmail/Google Workspace, nenhuma UI, nenhum write de aplicacao,
-- nenhum seed neste lote.
-- ============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  action_request_id uuid not null,
  kind text not null
    check (kind in ('INITIAL', 'REMINDER', 'ESCALATION')),
  -- Sem FAILED aqui: falha de entrega pertence ao delivery/canal
  -- (notification_email_deliveries.status), nunca a Notification
  -- abstrata.
  status text not null
    check (status in ('PENDING', 'SENT', 'CANCELLED')),
  subject text not null,
  body text not null,
  created_by_type text not null
    check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid
    references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (btrim(subject) <> ''),
  check (btrim(body) <> ''),
  check (
    (status = 'PENDING' and sent_at is null)
    or (status = 'SENT' and sent_at is not null)
    or (status = 'CANCELLED')
  ),
  foreign key (action_request_id, project_id)
    references public.action_requests (id, project_id)
    on delete cascade,
  -- Redundante em relacao ao PK(id); alvo das FKs compostas das
  -- tabelas filhas.
  constraint notifications_id_project_id_key unique (id, project_id)
);

create index notifications_project_id_idx
  on public.notifications (project_id);

create index notifications_action_request_id_idx
  on public.notifications (action_request_id);

create index notifications_project_id_created_at_idx
  on public.notifications (project_id, created_at desc);

-- ---------- notification_recipients ----------
-- Sem coluna id propria: recipient_user_id e recipient_email sao
-- mutuamente exclusivos (nunca ambos preenchidos), o que impede um
-- PK composto simples. A deduplicacao por Notification e garantida
-- por dois indices UNIQUE parciais abaixo, um para cada tipo.

create table public.notification_recipients (
  notification_id uuid not null,
  project_id uuid not null,
  recipient_type text not null
    check (recipient_type in ('USER', 'EMAIL')),
  recipient_user_id uuid,
  -- Endereco de destino apenas — NAO e cadastro de contato externo,
  -- NAO concede acesso ao projeto, NAO cria profile/membership.
  recipient_email text,
  created_at timestamptz not null default now(),
  check (
    (recipient_type = 'USER' and recipient_user_id is not null and recipient_email is null)
    or (
      recipient_type = 'EMAIL'
      and recipient_user_id is null
      and recipient_email is not null
      and btrim(recipient_email) <> ''
    )
  ),
  foreign key (notification_id, project_id)
    references public.notifications (id, project_id)
    on delete cascade,
  foreign key (project_id, recipient_user_id)
    references public.project_memberships (project_id, user_id)
    on delete restrict
);

create unique index notification_recipients_notification_user_key
  on public.notification_recipients (notification_id, recipient_user_id)
  where recipient_type = 'USER';

create unique index notification_recipients_notification_email_key
  on public.notification_recipients (notification_id, recipient_email)
  where recipient_type = 'EMAIL';

-- ---------- notification_email_deliveries ----------
-- Infraestrutura de mensagem: unico lugar com metadata de provider
-- (provider/provider_message_id/provider_thread_id/message_id_header),
-- sempre nullable — preenchidos somente quando a integracao real de
-- envio/recebimento existir (fora de escopo deste lote). Nao duplica
-- o corpo do email (isso continua em public.emails via email_id).
create table public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null,
  project_id uuid not null,
  recipient_email text not null,
  direction text not null
    check (direction in ('OUTBOUND', 'INBOUND')),
  status text not null
    check (status in ('PENDING', 'SENT', 'DELIVERED', 'RECEIVED', 'FAILED', 'BOUNCED', 'IGNORED')),
  email_id uuid,
  -- Identificador interno estavel para correlacao futura de reply
  -- (Reply-To/token/cabecalho apontarao para isto). Nao e prova de
  -- identidade/autoridade por si so.
  correlation_id uuid not null default gen_random_uuid(),
  provider text,
  provider_message_id text,
  provider_thread_id text,
  message_id_header text,
  -- Para INBOUND, pode apontar ao delivery OUTBOUND original; para
  -- OUTBOUND, permanece NULL. Nao obrigatorio: algumas mensagens
  -- podem ser correlacionadas posteriormente.
  reply_to_delivery_id uuid
    references public.notification_email_deliveries (id) on delete restrict,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  check (btrim(recipient_email) <> ''),
  foreign key (notification_id, project_id)
    references public.notifications (id, project_id)
    on delete cascade,
  foreign key (email_id, project_id)
    references public.emails (id, project_id)
    on delete restrict,
  constraint notification_email_deliveries_correlation_id_key unique (correlation_id)
);

-- ---------- RLS ----------

alter table public.notifications enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.notification_email_deliveries enable row level security;

create policy "notifications_select_project_members_only"
  on public.notifications
  for select
  using (public.is_project_member(project_id));

create policy "notification_recipients_select_project_members_only"
  on public.notification_recipients
  for select
  using (
    exists (
      select 1
      from public.notifications n
      where n.id = notification_recipients.notification_id
        and public.is_project_member(n.project_id)
    )
  );

create policy "notification_email_deliveries_select_project_members_only"
  on public.notification_email_deliveries
  for select
  using (
    exists (
      select 1
      from public.notifications n
      where n.id = notification_email_deliveries.notification_id
        and public.is_project_member(n.project_id)
    )
  );

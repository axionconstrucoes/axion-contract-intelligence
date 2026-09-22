-- ============================================================
-- 20260922100000_contract_alert_responsible_foundation.sql
-- "Responsável pelos alertas contratuais" — configuração EXPLÍCITA por
-- projeto, decisão aprovada para destravar o destinatário do lote
-- semanal automático (ver relatório enviado ao usuário na rodada
-- anterior). Substitui o gap documentado em
-- run-weekly-contract-alert-batches.ts: NÃO infere ADMINISTRADOR, NÃO
-- infere criador do evento, NÃO infere último responsável, NÃO usa
-- crm@axion.com.br como destinatário lógico (o mecanismo institucional
-- do piloto continua cuidando só da entrega física, inalterado).
--
-- PROPOSTA — NÃO APLICADA nesta etapa. Nova tabela, aditiva, mesmo
-- padrão de sla_area_responsibles (20260822054900): FK composta para
-- project_memberships garante no banco que o responsável é sempre um
-- membro real do MESMO projeto — nunca um usuário de outro projeto.
-- Status ACTIVE/INACTIVE não é garantido por esta FK (membership pode
-- mudar de status depois de configurado) — a aplicação revalida ACTIVE
-- a cada resolução (ver resolveWeeklyContractAlertBatchRecipients),
-- nunca confiando apenas no que foi válido no momento do cadastro.
-- ============================================================

create table public.contract_alert_responsibles (
  -- Um responsável por projeto (não por área/severidade) — chave
  -- primária é o próprio project_id, nunca um id sintético separado.
  project_id uuid primary key
    references public.projects (id) on delete cascade,

  responsible_user_id uuid not null,

  updated_by_user_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Garantia de banco (requisito 1/9): o responsável só pode ser um
  -- membership real do MESMO projeto. on delete cascade: se o membro
  -- for removido do projeto, a configuração é removida com ele —
  -- o projeto volta ao estado "sem responsável configurado" (nunca um
  -- ponteiro morto para um membro que não existe mais).
  foreign key (project_id, responsible_user_id)
    references public.project_memberships (project_id, user_id) on delete cascade
);

create or replace function public.set_contract_alert_responsibles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contract_alert_responsibles_set_updated_at
before update
on public.contract_alert_responsibles
for each row
execute function public.set_contract_alert_responsibles_updated_at();

alter table public.contract_alert_responsibles enable row level security;

create policy "contract_alert_responsibles_select_project_members_only"
  on public.contract_alert_responsibles
  for select
  using (public.is_project_member(project_id));

create policy "contract_alert_responsibles_write_admin_only"
  on public.contract_alert_responsibles
  for all
  to authenticated
  using (public.has_project_permission(project_id, 'ADMINISTRADOR'))
  with check (
    updated_by_user_id = auth.uid()
    and public.has_project_permission(project_id, 'ADMINISTRADOR')
  );

comment on table public.contract_alert_responsibles is
  'Responsável pelos alertas contratuais — configuração explícita por projeto (1 por projeto). Fonte de recipient_user_id para o lote semanal automático (BAIXO/MÉDIO); nunca inferido. Requer membership ACTIVE do usuário no projeto, revalidado a cada resolução, não só no cadastro.';
comment on column public.contract_alert_responsibles.responsible_user_id is
  'Usuário responsável pelos alertas contratuais deste projeto — precisa ter membership no projeto (FK composta) e status ACTIVE (revalidado em tempo de resolução, não garantido por esta FK).';

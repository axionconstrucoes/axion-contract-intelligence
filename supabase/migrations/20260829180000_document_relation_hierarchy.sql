-- ============================================================
-- 20260829180000_document_relation_hierarchy.sql
-- Bloco 4 (rodada "produção") — hierarquia documental do BID:
-- Edital/RFP/RFI -> Questionário -> Resposta oficial -> Complemento ->
-- Proposta comercial -> Contrato/Aditivo. Modela a RELAÇÃO entre dois
-- documentos (nunca a data de upload) — RESPONDE, COMPLEMENTA, ALTERA,
-- SUBSTITUI ou INCORPORA — para que o Especialista Jurídico IA possa
-- citar documento, versão, item afetado e regra aplicada, em vez de
-- reconstruir a cadeia por inferência de nome/data.
--
-- Achado real desta rodada: NENHUM tipo de relação (RESPONDE/
-- COMPLEMENTA/ALTERA/SUBSTITUI/INCORPORA) existia em nenhum lugar do
-- código — isto é inteiramente novo, não uma correção.
-- ============================================================

-- ---------- novos DocumentKind necessários ao BID ----------
-- EDITAL/RFI/RFP, ESPECIFICACAO, PROPOSTA_COMERCIAL, PLANILHA_CONTRATUAL,
-- CRONOGRAMA_BASELINE/REVISAO já cobrem a maior parte da cadeia (ver
-- documents_kind_check). Só faltam 2 valores genuinamente novos:
-- QUESTIONARIO_BID (pergunta enviada pelos licitantes) e
-- COMPLEMENTO_CIRCULAR (errata/circular/complemento pós-resposta).
alter table public.documents
  drop constraint documents_kind_check;

alter table public.documents
  add constraint documents_kind_check
  check (kind in (
    'CONTRATO_BASE', 'ADITIVO', 'EDITAL', 'RFI', 'RFP', 'ESPECIFICACAO',
    'DESENHO', 'PLANILHA', 'CRONOGRAMA_BASELINE', 'CRONOGRAMA_REVISAO',
    'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE',
    'ATA_REUNIAO', 'PROPOSTA_COMERCIAL', 'PROPOSTA_TECNICA',
    'PLANILHA_CONTRATUAL', 'RELATORIO', 'NOTIFICACAO', 'ESG_SSMA',
    'DIARIO_OBRA', 'QUESTIONARIO_BID', 'COMPLEMENTO_CIRCULAR', 'OUTRO'
  ));

-- ---------- document_relations ----------
create table public.document_relations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- "Documento de origem" e "documento respondido/alterado" — sempre
  -- documentos REAIS do projeto, nunca texto livre. from = quem age
  -- (a resposta/complemento/proposta/contrato); to = quem é afetado
  -- (o edital, a resposta anterior, o documento incorporado).
  from_document_id uuid not null references public.documents (id) on delete cascade,
  to_document_id uuid not null references public.documents (id) on delete cascade,

  relation_type text not null check (
    relation_type in ('RESPONDE', 'COMPLEMENTA', 'ALTERA', 'SUBSTITUI', 'INCORPORA')
  ),

  -- "assunto/cláusula afetada" — nunca a substituição do documento
  -- INTEIRO por causa de uma resposta pontual (seção 4 do requisito:
  -- "não substituir o edital inteiro por causa de uma resposta
  -- pontual") — o escopo da relação é sempre este campo, nunca implícito.
  subject text not null check (btrim(subject) <> ''),

  issued_at date,
  revision text,
  issuer text,

  -- "evidência de aceitação" — obrigatória só para INCORPORA (é o
  -- requisito específico de "premissas da proposta prevalecem sobre o
  -- edital QUANDO a aceitação/incorporação estiver comprovada"); nos
  -- demais tipos, a existência da própria relação (resposta oficial,
  -- complemento formal) já é a evidência.
  acceptance_evidence text,

  -- "documento posterior que o substituiu" — auto-referência dentro da
  -- mesma cadeia (nunca outra tabela): quando uma relação SUBSTITUI é
  -- registrada, ela pode apontar para a relação anterior que deixou de
  -- valer, preservando a cadeia completa (nunca apagada).
  superseded_by_relation_id uuid references public.document_relations (id) on delete set null,

  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (relation_type <> 'INCORPORA' or nullif(btrim(coalesce(acceptance_evidence, '')), '') is not null),
  check (from_document_id <> to_document_id)
);

comment on table public.document_relations is
  'Hierarquia documental do BID (Edital -> Questionário -> Resposta -> Complemento -> Proposta -> Contrato/Aditivo). from_document_id RESPONDE/COMPLEMENTA/ALTERA/SUBSTITUI/INCORPORA to_document_id, escopado sempre a um subject/cláusula específico — nunca ao documento inteiro.';

create index document_relations_project_id_idx on public.document_relations (project_id);
create index document_relations_from_document_id_idx on public.document_relations (from_document_id);
create index document_relations_to_document_id_idx on public.document_relations (to_document_id);

alter table public.document_relations enable row level security;

create policy "document_relations_select_project_members_only"
  on public.document_relations
  for select
  using (public.is_project_member(project_id));

-- Registrar uma relação exige EDITOR — mesmo nível de quem já registra
-- documento/proposta neste projeto (nunca IA, sempre humano).
create policy "document_relations_insert_editor"
  on public.document_relations
  for insert
  to authenticated
  with check (
    (created_by_type = 'USER' and created_by_user_id = auth.uid())
    and public.has_project_permission(project_id, 'EDITOR')
    and exists (
      select 1 from public.documents d
      where d.id = from_document_id and d.project_id = document_relations.project_id
    )
    and exists (
      select 1 from public.documents d
      where d.id = to_document_id and d.project_id = document_relations.project_id
    )
  );

-- Sem UPDATE/DELETE — mesma filosofia de project_additional_proposal_links
-- (rastreabilidade: uma relação incorreta é substituída por um novo
-- registro apontando superseded_by_relation_id, nunca editada/apagada).

-- ---------- Auditoria ----------
create or replace function public.audit_document_relation_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    new.project_id,
    new.created_by_type,
    new.created_by_user_id,
    new.created_by_label,
    'DOCUMENT_RELATION_CREATED',
    'DOCUMENT_RELATION',
    new.id::text,
    format(
      'Relação documental registrada: %s %s (assunto: %s).',
      new.relation_type, new.to_document_id::text, new.subject
    )
  );
  return new;
end;
$$;

alter function public.audit_document_relation_created() owner to postgres;

create trigger document_relations_audit_created
  after insert on public.document_relations
  for each row
  execute function public.audit_document_relation_created();

notify pgrst, 'reload schema';

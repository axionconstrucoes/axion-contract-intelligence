
alter table public.project_email_ingestion_configs
  add column if not exists
    require_project_scope_match boolean not null default true,
  add column if not exists
    scope_keywords text[] not null default '{}'::text[],
  add column if not exists
    scope_exact_subjects text[] not null default '{}'::text[];

comment on column
  public.project_email_ingestion_configs.require_project_scope_match
is
  'Quando true, a ingestão exige vínculo com o projeto por domínio CLIENT, palavra-chave configurada ou assunto exato aprovado.';

comment on column
  public.project_email_ingestion_configs.scope_keywords
is
  'Termos configuráveis por projeto usados para reconhecer conversas internas relacionadas ao projeto.';

comment on column
  public.project_email_ingestion_configs.scope_exact_subjects
is
  'Assuntos explicitamente aprovados para o projeto, comparados após normalização.';

update public.project_email_ingestion_configs
set
  require_project_scope_match = true,
  scope_keywords = array[
    'weg',
    'fabrica de fios',
    'fabrica de fiols',
    'linhares',
    'rfq-1015661',
    'lanternim',
    'implantacao de canteiro',
    'cronograma anexo contratual',
    'projeto executivo - fabrica de fios'
  ],
  scope_exact_subjects = array[
    'enc: negociacao - planilha de custos opcao 5 - alt 17,22m cobertura metalica'
  ]
where project_id =
  '00000000-0000-4000-8000-000000000001';

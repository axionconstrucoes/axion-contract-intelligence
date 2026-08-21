-- ============================================================
-- AXION Contract Intelligence
-- Document Processing Foundation
--
-- Armazena texto extraido de documentos com rastreabilidade.
-- Nenhuma conclusao contratual ou juridica e criada aqui.
-- ============================================================


-- ============================================================
-- 1. EXECUCOES DE EXTRACAO
-- ============================================================

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),

  document_version_id uuid not null
    references public.document_versions (id)
    on delete cascade,

  extractor text not null,

  extractor_version text not null,

  status text not null
    check (
      status in (
        'PROCESSING',
        'PROCESSED',
        'FAILED'
      )
    ),

  text_content text,

  page_count integer
    check (
      page_count is null
      or page_count >= 0
    ),

  character_count integer
    check (
      character_count is null
      or character_count >= 0
    ),

  error_message text,

  started_at timestamptz not null
    default now(),

  completed_at timestamptz,

  created_at timestamptz not null
    default now()
);


create index
  document_extractions_document_version_idx
on public.document_extractions (
  document_version_id,
  created_at desc
);


-- ============================================================
-- 2. SEGMENTOS DE TEXTO RASTREAVEIS
--
-- page_number pode ser NULL para formatos sem paginas,
-- como XLSX, CSV ou TXT.
-- ============================================================

create table public.document_text_segments (
  id uuid primary key default gen_random_uuid(),

  extraction_id uuid not null
    references public.document_extractions (id)
    on delete cascade,

  segment_index integer not null
    check (segment_index >= 0),

  page_number integer
    check (
      page_number is null
      or page_number > 0
    ),

  locator text,

  text_content text not null,

  character_start integer
    check (
      character_start is null
      or character_start >= 0
    ),

  character_end integer
    check (
      character_end is null
      or character_end >= 0
    ),

  created_at timestamptz not null
    default now(),

  unique (
    extraction_id,
    segment_index
  )
);


create index
  document_text_segments_extraction_idx
on public.document_text_segments (
  extraction_id,
  segment_index
);


-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.document_extractions
  enable row level security;

alter table public.document_text_segments
  enable row level security;


create policy
  "document_extractions_select_project_members"
on public.document_extractions
for select
to authenticated
using (
  exists (
    select 1
    from public.document_versions dv
    join public.documents d
      on d.id = dv.document_id
    where
      dv.id =
        document_extractions.document_version_id
      and public.is_project_member(
        d.project_id
      )
  )
);


create policy
  "document_text_segments_select_project_members"
on public.document_text_segments
for select
to authenticated
using (
  exists (
    select 1
    from public.document_extractions de
    join public.document_versions dv
      on dv.id = de.document_version_id
    join public.documents d
      on d.id = dv.document_id
    where
      de.id =
        document_text_segments.extraction_id
      and public.is_project_member(
        d.project_id
      )
  )
);


-- Nao existem policies INSERT / UPDATE / DELETE para usuarios.
-- O processamento sera executado apenas pelo worker server-side.

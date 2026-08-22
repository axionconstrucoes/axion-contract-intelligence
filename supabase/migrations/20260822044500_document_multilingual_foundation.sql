-- ============================================================
-- 20260822044500_document_multilingual_foundation.sql
-- Metadados de idioma para document_versions — o ACC deve aceitar e
-- analisar contratos/RFI/RFP/editais/memoriais/propostas/aditivos/atas
-- em qualquer idioma, sempre preservando o arquivo original como fonte
-- autoritativa (originalIsAuthoritative é um invariante fixo, tratado no
-- código como um tipo literal `true` — igual a AiAssessment.requiresHumanReview
-- — e por isso não vira coluna aqui: nunca pode variar).
--
-- source_language é preenchido pelo worker de processamento
-- (scripts/process-document-version.mjs, service role) após a extração
-- de texto, via detecção real (apps/web/lib/documents/detect-source-language.ts) —
-- nunca pelo upload em si (o idioma só é detectável a partir do texto
-- extraído). translation_language/translation_status ficam preparados
-- para a fase futura de tradução sob demanda — "não traduzir tudo
-- automaticamente no upload": nenhuma tradução acontece nesta fase.
-- ============================================================

alter table public.document_versions
  add column source_language text,
  add column translation_language text,
  add column translation_status text not null default 'NOT_TRANSLATED';

alter table public.document_versions
  add constraint document_versions_translation_status_check
  check (
    translation_status in (
      'NOT_TRANSLATED',
      'REQUESTED',
      'AVAILABLE'
    )
  );

-- translation_language só faz sentido quando uma tradução foi de fato
-- solicitada/gerada — nunca preenchido "adiantado" sem status correspondente.
alter table public.document_versions
  add constraint document_versions_translation_language_consistency_check
  check (
    (translation_status = 'NOT_TRANSLATED' and translation_language is null)
    or (translation_status in ('REQUESTED', 'AVAILABLE') and translation_language is not null)
  );

comment on column public.document_versions.source_language is
  'Idioma detectado do texto extraído do documento original (ISO 639-1, ex.: pt, en, es) — null quando ainda não processado/detectado. Nunca traduzido automaticamente.';

comment on column public.document_versions.translation_language is
  'Idioma de uma tradução sob demanda (fase futura) — null enquanto translation_status = NOT_TRANSLATED.';

comment on column public.document_versions.translation_status is
  'NOT_TRANSLATED (padrão, nenhuma tradução) | REQUESTED (pedida, ainda não disponível) | AVAILABLE (tradução de apoio existe) — a tradução nunca substitui o original, que permanece a fonte autoritativa.';

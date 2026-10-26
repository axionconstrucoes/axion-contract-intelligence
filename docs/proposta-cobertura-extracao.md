# Proposta — campos próprios de cobertura e revisão das extrações

Status: **proposta, não aplicada.** O SQL abaixo fica fora de `supabase/migrations/` de propósito, para não ser aplicado por engano. Para adotar: revisar, mover para uma migration datada, aplicar no ambiente correto e só então trocar os leitores (ordem na seção 4).

## 1. Situação atual

O schema não tem onde registrar cobertura. Hoje o worker (`scripts/process-document-version.mjs` + `scripts/lib/pdf-ocr.mjs`) grava assim:

| Informação | Onde fica hoje | Problema |
|---|---|---|
| Cobertura parcial | `document_extractions.error_message` = "COBERTURA PARCIAL: …" numa extração `PROCESSED` | Campo de erro usado para aviso; leitores comparam prefixo de texto |
| Página, arquivo, método, confiança do OCR, revisão visual | Texto do `document_text_segments.locator` | Exige interpretar texto (regex) para filtrar ou contar |
| Página não lida | Segmento-marcador "[ACC — CONTEUDO NAO LIDO …]" | Mistura metadado com texto do documento |
| Revisão humana | `document_versions.requires_human_review` | Não diz o motivo nem quais páginas |
| Camada normalizada (codificação de fonte) | Calculada na leitura (`repair-font-encoding.ts`) | Recalculada em toda leitura; sem versão persistida |

## 2. Leitores da extração e como tratam a cobertura parcial

| Leitor | Reconhece cobertura parcial? | Situação após esta rodada |
|---|---|---|
| Tela da versão (`app/[projectId]/documentos/versoes/[documentVersionId]/page.tsx`) | **Sim** | Usa `PROCESSED`, mostra a extração mais recente, cobertura N/M, pendentes, revisão visual e link para arquivo e página originais |
| Busca da Timeline (`timeline-search-actions.ts`) | **Sim** (pelo prefixo de `error_message`) | Só a extração mais recente; busca na camada normalizada; resultado marcado como "leitura parcial" |
| Detecção de cláusulas (`scripts/detect-clause-candidates.mjs`) | **Sim** (aviso pelo prefixo) | Ignora marcadores de página pendente; detecta sobre a camada normalizada. **Não grava** a cobertura junto dos candidatos |
| Revisão de cláusulas (`lib/clause-review.ts`) | **Não** | Mostra candidatos e o segmento de origem; não avisa que o documento foi lido parcialmente |
| Card de documentos (`components/documents/document-card.tsx`) | **Não** | Não lê extração; nenhum aviso de cobertura na lista |

## 3. Campos propostos

```sql
-- document_extractions: cobertura da extração como dado estruturado
alter table public.document_extractions
  add column coverage_status text
    check (coverage_status in ('INTEGRAL', 'PARCIAL', 'NAO_AVALIADA')),
  add column pages_total integer check (pages_total is null or pages_total >= 0),
  add column pages_read integer check (pages_read is null or pages_read >= 0),
  add column pending_pages integer[] not null default '{}',
  add column visual_review_pages integer[] not null default '{}',
  add column ocr_engine text,                 -- ex.: 'tesseract.js 7.0.0 por 4.0.0_best_int 300dpi'
  add column normalization_version text,      -- ex.: 'macroman-latin1-v1'
  add constraint document_extractions_pages_read_le_total
    check (pages_read is null or pages_total is null or pages_read <= pages_total);

-- Extrações existentes ficam 'NAO_AVALIADA' (nunca 'INTEGRAL' por omissão).
update public.document_extractions set coverage_status = 'NAO_AVALIADA' where coverage_status is null;
alter table public.document_extractions alter column coverage_status set not null;
alter table public.document_extractions alter column coverage_status set default 'NAO_AVALIADA';

-- document_text_segments: rastreabilidade por trecho sem depender do locator
alter table public.document_text_segments
  add column source_file_id uuid references public.document_version_files (id) on delete restrict,
  add column local_page integer check (local_page is null or local_page > 0),
  add column extraction_method text
    check (extraction_method in ('TEXTO_NATIVO', 'OCR', 'MARCADOR_PENDENTE')),
  add column ocr_confidence smallint check (ocr_confidence is null or ocr_confidence between 0 and 100),
  add column page_status text,                -- TEXTO_NATIVO, OCR, OCR_BAIXA_CONFIANCA, GRAFICO_SEM_TEXTO, FALHA_OCR...
  add column visual_review_reasons text[] not null default '{}',
  -- Camada normalizada persistida; text_content continua sendo o original (evidência).
  add column normalized_text_content text;

create index document_text_segments_pending_idx
  on public.document_text_segments (extraction_id)
  where extraction_method = 'MARCADOR_PENDENTE';
```

Princípios:
- `text_content` continua sendo o texto original (evidência), nunca sobrescrito; `normalized_text_content` é derivado e versionado por `normalization_version`.
- `coverage_status = 'PARCIAL'` substitui o uso de `error_message` em extrações `PROCESSED`; `error_message` volta a significar só falha.
- Nenhum default otimista: extração antiga fica `NAO_AVALIADA`, que as telas tratam como "não integral".

## 4. Ordem segura de adoção

1. Aplicar a migration (só colunas novas e nullable/default; nenhum leitor quebra).
2. Worker passa a gravar os campos novos **e** continua gravando o formato atual (locator, marcador, `error_message`) durante a transição.
3. Reprocessar com `--reprocess` as versões que precisarem dos campos (histórico preservado).
4. Trocar os leitores (tela da versão, Timeline, detecção e revisão de cláusulas, card de documentos) para os campos estruturados.
5. Só então deixar de gravar a cobertura em `error_message`.

# Exportação do Timeline Filtrado

Este documento descreve a arquitetura da exportação do Timeline filtrado
do ACC (`/[projectId]/timeline`), usada para preparar dossiês para
litígio, arbitragem, perícia, defesas, claims e revisão por assessoria
jurídica externa.

## 1. Princípio central

**A exportação nunca inclui nada fora do filtro ativo na tela.** A mesma
função pura (`applyTimelineFilters`, em
`apps/web/lib/timeline-export/apply-filters.ts`) decide o que aparece na
tela e o que é exportado — não existem dois caminhos de filtragem que
possam divergir.

## 2. Estrutura de diretórios

```
apps/web/lib/timeline-export/
├── types.ts                  # TimelineFilterCriteria, TimelineExportRow, TimelineExportManifest, etc.
├── apply-filters.ts          # applyTimelineFilters + sortChronological (puro, sem I/O)
├── derive-participants.ts    # deriveParticipants — só a partir de e-mails reais vinculados
├── build-export-rows.ts      # monta as 22 colunas do índice estruturado
├── build-manifest.ts         # monta o manifesto (reprodutibilidade)
├── build-csv.ts               # índice em CSV
├── build-xlsx.ts              # índice em XLSX (ExcelJS)
├── build-pdf-dossie.ts        # dossiê PDF (jsPDF), ordem cronológica
├── build-manifesto-pdf.ts     # resumo humano da exportação (jsPDF)
├── email-representation.ts    # representação textual honesta de um e-mail + sanitização de nome de arquivo
├── resolve-evidence-files.ts  # "use client" — resolve arquivos originais via Storage (signed URL)
└── build-zip-package.ts       # "use client" — monta o pacote ZIP final (JSZip)
```

Componentes de UI: `apps/web/components/timeline/timeline-filters.tsx`,
`timeline-list.tsx`, `timeline-export-panel.tsx`,
`timeline-page-client.tsx`. Server Action de auditoria:
`apps/web/app/[projectId]/timeline/timeline-export-actions.ts`.

Os módulos de `lib/timeline-export/*.ts` que **não** têm `"use client"`
são puros/sem I/O e deliberadamente não importam `"server-only"` nem usam
o alias `@/`: isso permite testá-los tanto pelo bundler do Next.js quanto
por um script Node standalone (`scripts/test-timeline-export.mjs`, via o
loader `scripts/ts-module-resolver.mjs`), o mesmo padrão já usado pelos
context builders de `apps/web/lib/ai/`.

## 3. Por que a geração roda no browser

Não existe, nesta base de código, nenhum Route Handler que sirva bytes de
arquivo — o único caminho estabelecido para acessar o Storage é
client-side, via signed URL (`document-download-button.tsx`). A
exportação segue o mesmo caminho: PDF/XLSX/ZIP são montados inteiramente
no browser, com a sessão do próprio usuário. **Nunca é usada
`service_role`** para gerar uma exportação — se um documento não está
liberado pela RLS para o usuário, o `createSignedUrl` falha, e a
evidência entra no manifesto como `UNAVAILABLE`, nunca é obtida por outro
caminho.

## 4. Mapeamento fonte real vs. `FUTURE_SOURCE`

| Campo/recurso | Situação real nesta fase |
| --- | --- |
| Eventos, evidências, categorias, cross-references | Reais (`contract_events` e tabelas relacionadas) |
| E-mails (From/To/Subject/Date/Snippet) | Reais (`emails`) |
| CC de e-mail | **Não existe no schema** — nunca aparece na representação nem no CSV |
| Anexos de e-mail | **Não modelados nesta fase** — declarado explicitamente como indisponível |
| Corpo integral do e-mail (.eml original) | **Não armazenado** — só o `snippet`; a representação gerada é rotulada como tal, nunca apresentada como o arquivo original |
| Arquivo original de documento | Real, via `document_versions.file_path`/`storage_bucket`, quando presentes |
| Participantes do Timeline | Derivados de e-mails reais vinculados como evidência — **nunca** um campo inventado em `ContractEvent` |
| `sourceLanguage` | Sem fonte real no schema atual — sempre `null` |
| Checksum do pacote | Nenhuma ferramenta de hash implementada — sempre `null`, nunca inventado |
| `TimelineSelectionContext` para os Experts (Diretor Comercial IA etc.) | **`FUTURE_SOURCE`** — os tipos de filtro (`TimelineFilterCriteria`) já são reaproveitáveis como estão, mas a integração Timeline → Expert → Exportação usando o mesmo universo documental ainda não foi conectada |

## 5. Manifesto e reprodutibilidade

Cada exportação gera um `exportId` (UUID) client-side, usado tanto no
`manifest.json` embutido no ZIP quanto como `id` da linha inserida em
`timeline_exports` — os dois são sempre o mesmo identificador, o que
permite responder "quais fatos e documentos foram usados nesta análise"
a partir de qualquer um dos dois.

`timeline_exports` (migração
`supabase/migrations/20260822040325_timeline_exports_foundation.sql`,
corrigida em
`20260822041000_timeline_exports_fix_event_ids_check.sql`) é append-only
— sem policy de UPDATE/DELETE — e grava `project_id`, `exported_by_user_id`,
`filters` (jsonb), `event_ids`, `item_count`, `formats`. Um trigger
`AFTER INSERT` grava a ação `CONTRACTUAL_TIMELINE_EXPORTED` em
`audit_log_entries` com um resumo compacto (contagem + formatos) —
**nunca** o conteúdo integral dos eventos exportados.

> Nota de correção: a constraint original de `event_ids` usava
> `array_length(event_ids, 1) > 0`, que no Postgres retorna `NULL` (não
> `false`) para um array vazio — permitindo silenciosamente exportações
> vazias. Corrigido para `cardinality(event_ids) > 0` na migração de
> `20260822041000`, descoberto por teste automatizado real antes de
> qualquer exportação de produção existir.

O INSERT é permitido a **qualquer membro do projeto** (inclusive
VIEWER), não só EDITOR/ADMIN: exportar é reempacotar o que o usuário já
pode ver, não uma ação de edição.

## 6. Evidências ausentes

Toda evidência de todo evento exportado recebe uma entrada em
`manifest.evidence`, classificada como `INCLUDED`,
`GENERATED_REPRESENTATION` (e-mails, cuja representação é gerada, não o
arquivo original) ou `UNAVAILABLE`. Uma evidência sem arquivo real
resolvível **nunca é omitida silenciosamente** — sua entrada usa
exatamente a frase "Fonte referenciada, arquivo original não disponível
para exportação.", conforme exigido.

## 7. Anotações internas

Anotações do evento (`event_notes`) incluídas no conjunto filtrado
aparecem no índice (coluna `notes`) e no dossiê PDF sempre com o prefixo
"ANOTAÇÃO INTERNA — INFORMAÇÃO DECLARADA" — nunca listadas como
evidência documental.

## 8. Limitações conhecidas

- `resolve-evidence-files.ts` (resolução real de bytes via Storage) não
  é exercitado pelo teste automatizado (`scripts/test-timeline-export.mjs`)
  porque depende de `createSupabaseBrowserClient` num ambiente de browser
  real — foi validado por leitura de código e pelo mesmo padrão já usado
  em `document-download-button.tsx`, não por execução automatizada.
- A verificação visual da UI (`/[projectId]/timeline`) em um browser real
  autenticado não foi concluída nesta rodada: o bootstrap de sessão via
  magic link foi bloqueado pela extensão do browser usada para automação
  (permissão de execução de JavaScript negada). O build de produção
  (`next build`, com checagem de tipos completa da árvore de componentes)
  passou sem erros, e a lógica de dados foi validada por 25 testes
  automatizados — mas a confirmação visual final na UI real fica pendente
  de um teste manual.
- Não há checksum do pacote (nenhuma ferramenta de hash foi implementada
  nesta fase).

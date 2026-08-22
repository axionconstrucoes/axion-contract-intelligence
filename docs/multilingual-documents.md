# Documentos em Múltiplos Idiomas — Política e Arquitetura

O ACC aceita e analisa normalmente contratos, RFI, RFP, editais,
memoriais, cadernos de encargos, escopos, propostas, aditivos, atas e
demais documentos em português, inglês, espanhol ou outros idiomas
suportados pelo detector/futuro modelo de IA.

## Princípios (não negociáveis)

1. **O arquivo original é sempre preservado e é a fonte autoritativa.**
   Nada neste lote grava, sobrescreve ou modifica o arquivo original.
2. **Nenhuma tradução acontece automaticamente no upload.** O documento é
   armazenado e processado (extração de texto) exatamente como enviado.
3. **Uma tradução, quando existir no futuro, nunca substitui o
   original** — é só apoio à leitura.
4. **Idioma é detectado, nunca adivinhado por um Expert/LLM.** A detecção
   usa uma biblioteca determinística e offline (`franc-min`), rodando
   sobre o texto já extraído.

## O que é real nesta fase

| Peça | Status |
| --- | --- |
| `document_versions.source_language` | **Real** — preenchido pelo worker de processamento após a extração de texto (migração `20260822044500_document_multilingual_foundation.sql`) |
| `document_versions.translation_language` / `translation_status` | **Real como coluna**, mas `translation_status` sempre `NOT_TRANSLATED` nesta fase — nenhuma tradução é gerada |
| `apps/web/lib/documents/detect-source-language.ts` | **Real** — detecção offline via `franc-min`, testada com trechos reais de contrato/RFP/especificação em pt/en/es |
| `originalIsAuthoritative` | **Invariante de tipo** (`true` literal em `ManagedDocumentVersion`, igual a `AiAssessment.requiresHumanReview`) — nunca uma coluna, porque nunca pode variar |
| Badge de idioma na tela de Documentos | **Real** — `apps/web/app/[projectId]/documentos/page.tsx` mostra "Idioma: <rótulo>" quando `source_language` está preenchido |
| Tradução PT-BR sob demanda | **`FUTURE_SOURCE`** — não implementada. `translation_status` já modela `REQUESTED`/`AVAILABLE` para quando existir |
| Expert citando página/seção do documento original em outro idioma | **`FUTURE_SOURCE`** — o context builder dos Experts (`apps/web/lib/ai/context/**`) ainda não inclui `source_language` no contexto nem instrui o Expert a preservar a citação no idioma original |

## Como a detecção funciona

`scripts/process-document-version.mjs` (worker service-role) já extrai o
texto do documento (`document-extractors.mjs`) antes de qualquer análise
contratual. Depois da extração:

```
canonicalText (texto extraído)
  → detectSourceLanguage(canonicalText)   [franc-min, offline, determinístico]
  → document_versions.source_language     [ISO 639-1 quando mapeado: pt/en/es/fr/de/it/... ]
```

Textos muito curtos (< 20 caracteres) ou ambíguos retornam
`code: null` (indeterminado) em vez de arriscar um palpite —
nunca um idioma inventado.

## Citações em outro idioma (regra para análise futura)

Quando um Expert (Diretor Comercial IA, e os futuros Consultor Jurídico
IA etc.) analisar um documento cujo `source_language` não é `pt`, a
referência a um trecho deve:

- apontar para o documento original (nunca só a tradução);
- incluir página/seção original quando disponível
  (`document_text_segments.page_number`/`locator`, já existentes);
- marcar qualquer tradução usada como apoio, nunca como texto oficial;
- destacar termos jurídicos/técnicos ambíguos em vez de traduzir
  silenciosamente.

Esta regra ainda não está implementada em código (nenhum Expert lê
`source_language` hoje) — é a próxima extensão natural do context
builder quando a tradução sob demanda for implementada.

## Metadata conceitual — mapeamento para o schema real

| Conceito pedido | Implementação real |
| --- | --- |
| `sourceLanguage` | `document_versions.source_language` (`ManagedDocumentVersion.sourceLanguage`) |
| `translationLanguage` | `document_versions.translation_language` |
| `translationStatus` | `document_versions.translation_status` (`NOT_TRANSLATED \| REQUESTED \| AVAILABLE`) |
| `originalIsAuthoritative = true` | Tipo literal `true` em `ManagedDocumentVersion.originalIsAuthoritative` — nunca gravável como `false` |

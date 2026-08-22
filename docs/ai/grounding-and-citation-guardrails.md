# Grounding / Citation Guardrails — ACC

Camada determinística que impede que análises e rascunhos (drafts) do
Diretor Comercial IA introduzam afirmações factuais, contratuais ou
legais sem suporte rastreável no contexto recebido. Complementa
`docs/ai/anthropic-provider.md` (provider real) e
`docs/ai/experts.md` (arquitetura geral dos AI Experts) — não os
substitui.

## 1. Motivação — o incidente real

O primeiro teste real do Diretor Comercial IA com Anthropic funcionou
corretamente em toda a infraestrutura (contexto real, structured
output, schema validado, `requiresHumanReview=true`, nenhuma escrita no
banco), mas dois riscos de fidelidade textual (*grounding*) foram
observados:

1. A fonte dizia "incluímos no item o valor pago para projeto de
   fundação"; o rascunho escreveu "passou a compor a apólice" — uma
   afirmação semanticamente mais forte, introduzindo uma relação
   contratual (a integração à apólice) que a fonte não afirma
   diretamente.
2. A resposta mencionou a cláusula 5.2 numa informação faltante sem que
   essa cláusula estivesse entre as bases contratuais citadas na
   resposta.

Este documento descreve a camada de guardrails criada para impedir que
isso se repita — a autoridade final não é o prompt, é o código
determinístico.

## 2. Princípio — quatro categorias de suporte

Toda afirmação relevante é classificada em uma de quatro categorias
(`ClaimSupportStatus`, `apps/web/lib/ai/grounding/types.ts`):

| Status | Significado |
| ------ | ----------- |
| `SUPPORTED` | Há suporte direto no contexto/evidência/base contratual. |
| `INFERENCE` | Interpretação razoável derivada de fatos suportados — nunca apresentada como fato. |
| `UNSUPPORTED` | Não há suporte suficiente no contexto fornecido. |
| `HUMAN_INPUT_REQUIRED` | Depende de decisão, dado interno ou autorização humana inexistente no contexto (ex.: desconto, margem). |

## 3. Onde o guardrail atua

Aplicado a todo rascunho (`DRAFT_EMAIL`, `DRAFT_LETTER`,
`DRAFT_NOTIFICATION`, `DRAFT_PROPOSAL`, `DRAFT_COUNTERPROPOSAL`)
produzido pelo **Diretor Comercial IA via provider Anthropic** — tanto
na análise em lote (`runCommercialDirectorExpert`,
`negotiation.draftCommunication`) quanto na consulta conversacional
(`answerCommercialDirectorQuery`, `rascunhoSugerido`).

**Deliberadamente não aplicado ao FakeAiProvider**: suas frases
estruturais ("[RASCUNHO GERADO PELO PROVIDER DETERMINÍSTICO…]") são
placeholders autodeclarados, nunca conteúdo comercial real — checá-las
seria ruído, não proteção. O guardrail só roda quando
`response.providerId === "anthropic"`.

**Não conectado a outros Experts nesta fase** — nem ao Diretor de ESG
IA (que só usa o fake provider hoje), nem a nenhum Expert planejado. A
arquitetura é genérica e reutilizável quando isso mudar.

## 4. Arquitetura (`apps/web/lib/ai/grounding/`)

```
grounding/
├── types.ts                          # ClaimSupportStatus, ClaimCategory, GroundedClaim,
│                                      # GroundingValidationResult, GroundingSource, ResponseGroundingSummary
├── tokenize.ts                       # tokenização determinística (sem embeddings/NLP real)
├── extract-claims.ts                 # split em frases + regex de cláusula/valor/data + classificação de categoria
├── build-grounding-source.ts         # monta o "vocabulário-fonte" a partir do Context Builder + resposta já validada
├── evaluate-claim.ts                 # avalia uma frase contra o GroundingSource (dispatch por categoria)
├── validate-draft-grounding.ts       # ponto de entrada: divide o draft e avalia cada frase
├── apply-safe-correction.ts          # correção determinística segura (nunca via LLM)
├── adjust-confidence.ts              # ajuste simples e documentado de confiança
├── build-response-grounding-summary.ts # monta o campo `grounding` anexado à resposta
└── index.ts                          # barrel
```

Todos os módulos são puros (sem I/O, sem `"server-only"`) — testáveis
tanto pelo bundler do Next.js quanto por scripts Node standalone, mesmo
padrão já usado no restante de `apps/web/lib/ai/`.

## 5. Tipos principais

```ts
interface GroundedClaim {
  text: string;
  category: "FACTUAL" | "CONTRACTUAL" | "LEGAL" | "NUMERIC";
  supportStatus: ClaimSupportStatus;
  evidenceRefs: string[];
  contractualBasisRefs: string[];
  legalSourceRefs: string[];
  reasoningNote: string; // curto e operacional — nunca chain-of-thought
}

interface GroundingValidationResult {
  valid: boolean; // false quando há ao menos uma unsupportedClaim não corrigida
  supportedClaims: GroundedClaim[];
  inferredClaims: GroundedClaim[];
  unsupportedClaims: GroundedClaim[];
  humanInputRequiredClaims: GroundedClaim[];
  warnings: string[];
}
```

## 6. O validator (`validateDraftGrounding`)

1. `splitIntoSentences(draftBody)` — divide o rascunho em frases
   candidatas (heurística por pontuação/quebra de linha).
2. Para cada frase, `evaluateClaimGrounding` classifica a **categoria
   primária** (prioridade `LEGAL > CONTRACTUAL > NUMERIC > FACTUAL` —
   a mais específica/rígida vence) e avalia o suporte.
3. As frases são agrupadas em `supportedClaims`/`inferredClaims`/
   `unsupportedClaims`/`humanInputRequiredClaims`.
4. `valid = unsupportedClaims.length === 0`.

## 7. Regras por categoria

### 7.1. Factual (regra de fidelidade — o caso "apólice")

Sem embeddings: comparação por **overlap de vocabulário** contra todo o
texto-fonte disponível (evento, evidências, e-mails, cláusulas,
anotações, fatos já documentados), com um truque simples de tolerância
morfológica (prefixo de 5 caracteres, para lidar com
"incluímos"/"incluído" sem um stemmer real).

- Nenhum token novo → `SUPPORTED`.
- Marcador de interpretação presente ("relacionado", "sugere",
  "pode ser"...) → `INFERENCE`, independentemente da proporção de
  termos novos (a frase já se apresenta como interpretação).
- ≥30% dos termos significativos são novos, sem marcador → `UNSUPPORTED`.
- Caso intermediário → `INFERENCE`.

Exemplo real (fonte: *"incluímos no item o valor pago para projeto de
fundação"*):

| Afirmação | Resultado |
| --------- | --------- |
| "Foi incluído no item o valor pago para projeto de fundação." | `SUPPORTED` |
| "O projeto de fundação está relacionado ao aumento informado." | `INFERENCE` |
| "O projeto de fundação passou a compor a apólice." | `UNSUPPORTED` — introduz "apólice"/"compor", ausentes da fonte |

### 7.2. Contratual (cláusulas, multa, retenção, reajuste, garantia...)

Se a frase citar um **número de cláusula** (`\d{1,3}(\.\d{1,3}){1,3}`,
ex. "5.2"), a checagem é **exata**: o número precisa estar em
`GroundingSource.availableClauseNumbers` (cláusulas relacionadas do
contexto + base contratual já citada na resposta). Cláusula ausente →
`UNSUPPORTED`, sempre — nunca citada como fato contratual.

Exemplo (o caso real da cláusula 5.2): contexto contém `5.1`, `5.6`,
`5.11`; draft menciona `5.2` → `UNSUPPORTED`.

Termos contratuais sem número explícito (ex.: "multa") com valor
numérico associado delegam para a checagem numérica (7.3); sem número,
usam a checagem factual (7.1).

### 7.3. Numérico (R$, %, datas)

Cada valor monetário/percentual/data extraído por regex precisa
aparecer **literalmente** (após normalização de espaços/acentos) em
algum texto-fonte. Se não aparecer:

- com termo de limite comercial na mesma frase (desconto, margem,
  limite, mínimo, máximo, autorizado) → `HUMAN_INPUT_REQUIRED`.
- caso contrário → `UNSUPPORTED`.

`"NÃO DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA."` continua sendo a
frase padrão para este caso (mesmo padrão já usado em
`CommercialFieldValue`/`CommercialImpactAssessment`).

### 7.4. Legal

Regra mais rígida: se a frase citar um marcador legal ("art.",
"código civil", "súmula", "jurisprudência"...) e não houver nenhuma
`LegalSource` oficial no contexto (`availableLegalReferences` vazio) →
`UNSUPPORTED`, com a nota `"NÃO DISPONÍVEL — FONTE LEGAL OFICIAL NÃO
FORNECIDA NO CONTEXTO."`. Nunca validado por memória do modelo. Se
houver `LegalSource` e a citação corresponder a ela → `SUPPORTED`.

## 8. Correção automática segura (`applySafeGroundingCorrection`)

**Nunca via um segundo LLM.** Puramente determinística, e só atua
sobre claims **FACTUAL** — a categoria do caso real "apólice":

```
"O projeto passou a compor a apólice."
  →
"[CONFIRMAR INTERNAMENTE: "O projeto passou a compor a apólice." — não suportado diretamente pelo contexto fornecido]"
```

Claims **CONTRACTUAL/LEGAL/NUMERIC sem suporte nunca são corrigidas
automaticamente** — uma citação de cláusula/lei/número errada é um
risco alto demais para "consertar" com um substituto genérico; força
sempre a rejeição/supressão do draft.

## 9. Draft inválido — o que acontece (seção 8 do requisito)

Reutiliza a estrutura já existente (`| null`) em vez de criar um
enum/status concorrente (`CommercialDraftCommunication.status`/
`ExpertQueryDraft.status` continuam travados em
`"DRAFT_PENDING_REVIEW"` — nenhum `DRAFT_REQUIRES_CORRECTION` foi
criado):

1. `validateDraftGrounding` roda sobre o rascunho.
2. Se `valid === false`, `applySafeGroundingCorrection` tenta corrigir.
3. **Se a correção resolve tudo** (só havia claims FACTUAL corrigíveis)
   → o rascunho é mantido com o corpo corrigido (marcadores
   `[CONFIRMAR INTERNAMENTE…]`).
4. **Se sobra alguma claim não corrigível** (CONTRACTUAL/LEGAL/NUMERIC)
   → o rascunho inteiro é **suprimido** (`draftCommunication`/
   `rascunhoSugerido` viram `null`) e uma entrada é adicionada a
   `uncertainties`/`informacoesFaltantes` explicando o motivo. O resto
   da resposta (fatos, riscos, recomendações) é preservado — falhar a
   resposta inteira só porque o draft não passou seria
   desproporcional.

`grounding.valid` no resumo anexado reflete sempre o estado **antes**
da correção — nunca finge que não havia problema.

## 10. Integração com o Diretor Comercial IA

`experts/commercial-director/index.ts` (`runCommercialDirectorExpert`)
e `experts/commercial-director/query.ts`
(`answerCommercialDirectorQuery`), sempre **depois** da validação de
schema já ter passado, e só quando `response.providerId === "anthropic"`:

1. `buildGroundingSource({ eventContext, projectContext, documentedFacts, contractualBasis, legalCitations })`.
2. `validateDraftGrounding(draft.body, source)`.
3. Corrige/suprime conforme a seção 9.
4. `adjustConfidenceForGrounding` (seção 11).
5. `buildResponseGroundingSummary` anexa o resultado ao campo
   `grounding` da resposta (seção 12).
6. O `audit` (em memória, não persistido) ganha contagens —
   `{ performed, valid, supportedClaimCount, inferredClaimCount,
   unsupportedClaimCount, humanInputRequiredClaimCount }` — nunca o
   texto completo das afirmações (seção 14).

### 10.1. Reforço de prompt (não é a única proteção)

`COMMERCIAL_DIRECTOR_INSTRUCTIONS` (`identity.ts`, bump para
`COMMERCIAL_DIRECTOR_VERSION = "v2"`) ganhou a seção "Fidelidade
textual (grounding)": nunca transformar inferência em fato, nunca
introduzir relação causal/contratual/jurídica ausente da fonte, nunca
citar cláusula ausente, usar linguagem condicional para interpretação
— com o exemplo real "apólice" incluído no prompt. **O guardrail
determinístico é sempre a autoridade final, independentemente do que o
modelo escrever.**

## 11. Ajuste de confiança (regra simples, não uma fórmula complexa)

`adjustConfidenceForGrounding(baseConfidence, result, { draftSuppressed, correctionApplied })`:

| Situação | Efeito |
| -------- | ------ |
| Draft suprimido | `confidence = min(base, 0.2)` |
| Draft corrigido automaticamente | `confidence = min(base, 0.5)` |
| Só inferências (sem correção/supressão) | `confidence -= 0.05 × nº de inferências` (piso 0.1) |
| Só fatos suportados | `confidence` inalterada |

## 12. Extensão do schema de resposta (`grounding`)

`ExpertAssessment`/`ExpertQueryResponse` (`apps/web/lib/ai/types.ts`/
`query/types.ts`) ganharam um campo opcional compatível —
**nenhum segundo schema concorrente foi criado**:

```ts
grounding?: ResponseGroundingSummary | null;
```

```ts
interface ResponseGroundingSummary {
  performed: boolean; // false quando não havia draft para checar
  valid: boolean;
  supported: GroundedClaim[];
  inferred: GroundedClaim[];
  unsupported: GroundedClaim[];
  missingSupport: GroundedClaim[]; // = humanInputRequiredClaims
  warnings: string[];
  correctionApplied: boolean;
  draftSuppressed: boolean;
}
```

**Segurança:** `grounding` nunca é lido da saída bruta do provider —
`validateExpertAssessment`/`validateExpertQueryResponse` ignoram
`candidate.grounding` de propósito e sempre retornam `null` (um
provider nunca pode se autodeclarar "grounded"); o valor real só é
calculado depois, pelo próprio Expert.

## 13. UI (`ExpertQueryPanel`)

Sem redesign geral — uma seção adicional ("Checagem de fidelidade
(grounding) do rascunho"), exibida só quando `grounding.performed`:

- Claims agrupadas com os rótulos exatos pedidos: **"Fato
  documentado"** (`SUPPORTED`), **"Interpretação da IA"**
  (`INFERENCE`), **"Informação não comprovada"** (`UNSUPPORTED`),
  "Depende de definição humana" (`HUMAN_INPUT_REQUIRED`).
- Aviso quando o draft foi suprimido ou corrigido automaticamente.
- Nunca expõe segredo nenhum — só o já presente na resposta.

## 14. Auditoria

Nunca é gravado o texto completo do draft no audit log. A metadata em
memória (`CommercialDirectorRunResult.audit.grounding`/
`CommercialDirectorQueryResult.audit.grounding`) contém apenas
contagens: `performed`, `valid`, `supportedClaimCount`,
`inferredClaimCount`, `unsupportedClaimCount`,
`humanInputRequiredClaimCount` (+ `expertId`/`expertVersion` já
presentes no restante do objeto `audit`). Persistir isso em
`audit_log_entries` é trabalho futuro (mesma pendência já documentada
em `docs/ai/experts.md`, seção 11).

## 15. O que este guardrail deliberadamente NÃO faz nesta fase

- **Não usa embeddings, vector database, segundo LLM "juiz" nem RAG
  paralelo** — só regras determinísticas sobre o contexto já
  recuperado pelos Context Builders existentes.
- **Não garante detecção semântica perfeita.** A checagem factual
  (7.1) é um heurística de overlap de vocabulário com tolerância
  morfológica simples (prefixo de 5 caracteres) — paráfrases muito
  distantes lexicalmente do texto-fonte podem ser sinalizadas como
  `INFERENCE`/`UNSUPPORTED` mesmo sendo corretas (falso positivo), e
  frases curtas/genéricas que reaproveitam palavras comuns da fonte
  podem passar como `SUPPORTED` mesmo alterando o sentido (falso
  negativo raro, mitigado por checar termos de conteúdo, não
  stopwords). Evolução futura, se necessário: comparação semântica
  real (embeddings) — deliberadamente fora de escopo agora.
- **Extração de claims é por frase, não por sub-cláusula.** Uma frase
  longa com uma claim suportada e outra não misturadas é classificada
  pelo pior caso da frase inteira — não há split sub-frasal.
- **Categoria primária única por frase** (`LEGAL > CONTRACTUAL >
  NUMERIC > FACTUAL`) — uma frase que mistura, por exemplo, uma
  cláusula E um valor numérico só é checada pela regra CONTRACTUAL
  (que, quando não há citação de cláusula, delega para a checagem
  numérica — ver 7.2/7.3), nunca pelas duas de forma independente.
- **Não conectado a nenhum outro Expert** nesta fase (ver seção 3).

## 16. Testes

`scripts/test-grounding.mjs` (31 testes, nunca chama a API real):
fixture exata do incidente (SUPPORTED/INFERENCE/UNSUPPORTED); fixture
exata da cláusula 5.2; bateria completa (factual suportado/inferido/sem
suporte, cláusula existente/ausente, número/percentual/data
existente/inventado, legal claim sem/com `LegalSource`, draft
válido/inválido, inferência rotulada, correção segura FACTUAL vs.
rejeição forçada CONTRACTUAL/LEGAL/NUMERIC, ajuste de confiança nos
três cenários); integração completa com `runCommercialDirectorExpert`
via Anthropic mockado (correção automática preserva
`requiresHumanReview=true` e não envia/executa nada; supressão de
draft não corrigível; draft totalmente suportado passa sem alteração).
Regressões: `scripts/test-anthropic-provider.mjs`,
`scripts/test-commercial-director-expert.mjs`,
`scripts/test-expert-query.mjs`, `scripts/test-esg-director.mjs`,
`scripts/test-expert-capabilities.mjs`, `scripts/test-ai-foundation.mjs`
— todas passando sem alteração de comportamento (fake provider e ESG
inalterados).

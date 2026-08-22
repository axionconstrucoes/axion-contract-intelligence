# AI Experts do ACC — Arquitetura e Experts Oficiais

Este documento descreve a fundação técnica dos **AI Experts** do AXION
Acompanhamento de Contratos (ACC): a arquitetura de código em
`apps/web/lib/ai/`, distinta das skills interativas do Claude Code
descritas em `docs/ai/specialist-framework.md` (aquelas guiam análises
feitas *com* Claude Code por um humano; estas são um subsistema do
próprio produto ACC, pensado para eventualmente rodar de forma
autônoma/assistida dentro da aplicação).

Todas as regras comuns de `docs/ai/specialist-framework.md` (decisão
final humana, cadeia de análise, anti-alucinação, farol, controle de
ruído) valem integralmente para os AI Experts também — este documento
não as repete, apenas descreve como elas são aplicadas em código.

## 1. Experts oficiais do ACC

| # | Expert | ID técnico | Status |
| - | ------ | ----------- | ------ |
| 1 | CEO IA | *(não definido)* | Planejado |
| 2 | **Diretor Comercial IA** | `commercial-director` | **Implementado (v1)** |
| 3 | Consultor Jurídico IA | *(não definido)* | Planejado |
| 4 | Diretor de Planejamento IA | *(não definido)* | Planejado |
| 5 | Diretor de ESG IA | *(não definido)* | Planejado — fase futura |

Nenhum ID técnico é reservado antecipadamente para os Experts planejados
— eles só entram em `ExpertId` (`apps/web/lib/ai/types.ts`) quando
realmente implementados, para nunca sugerir que algo existe antes de
existir.

> Um Expert chamado "Advogado Especialista em Contratos"
> (`contract-lawyer`) chegou a ser implementado e foi **removido por
> decisão de produto** antes de qualquer publicação — não faz parte da
> lista oficial acima e não deve ser recriado sob esse nome.

## 2. Por que esta arquitetura existe

O objetivo é permitir adicionar os próximos Experts oficiais (tabela
acima) sem duplicar código de contexto, validação, provider ou
auditoria. Nenhum prompt grande fica solto dentro de componentes React —
toda instrução versionada vive em
`apps/web/lib/ai/experts/<expert>/identity.ts`.

## 3. Estrutura de diretórios

```
apps/web/lib/ai/
├── types.ts                      # ExpertAssessment e tipos genéricos da saída estruturada
├── index.ts                      # ponto único de import (barrel)
├── context/
│   ├── types.ts                  # EventAnalysisContext e tipos relacionados
│   └── build-event-context.ts    # context builder somente-leitura (genérico, reutilizável por qualquer Expert)
├── providers/
│   ├── types.ts                  # interface AiProvider (genérica)
│   ├── fake-provider.ts          # provider determinístico genérico (default desta fase)
│   └── get-ai-provider.ts        # seleção fail-closed via AXION_AI_PROVIDER
├── schemas/
│   └── validate-expert-assessment.ts  # validação/normalização da parte genérica da saída
└── experts/
    └── commercial-director/
        ├── identity.ts            # nome, id, versão, instruções versionadas
        ├── types.ts                # CommercialDirectorAssessment (schema específico)
        ├── schema.ts               # validação da parte específica (negotiation)
        ├── fake-negotiation-analysis.ts  # derivação determinística de `negotiation` p/ o fake provider
        └── index.ts                # runCommercialDirectorExpert()
```

Harnesses de linha de comando (somente leitura):
`scripts/analyze-event-with-commercial-director.mjs`.

Testes: `scripts/test-ai-foundation.mjs` (fundação genérica) e
`scripts/test-commercial-director-expert.mjs` (específico deste Expert)
— ver seção 10.

### Genérico vs específico — onde cada coisa vive

A fundação genérica (`types.ts`, `context/`, `providers/`, `schemas/`)
**nunca** conhece um Expert específico. Isso já foi corrigido uma vez
nesta fase: a primeira versão do `fake-provider.ts` tinha o nome/id do
Expert então em desenvolvimento hardcoded dentro do provider "genérico"
— um provider genérico de verdade nunca deve saber qual Expert o está
chamando; ele só usa o que vem em `AiProviderRequest` (`expertId`,
`expertName`, `analysisType`, etc.). Qualquer novo Expert reutiliza a
fundação sem precisar alterá-la.

Lógica de derivação determinística *específica* de um Expert (como
`fake-negotiation-analysis.ts` do Diretor Comercial IA) vive dentro da
pasta do próprio Expert, nunca dentro de `providers/fake-provider.ts`.

### Como o harness Node importa TypeScript sem mudar tsconfig.json

Os módulos de `apps/web/lib/ai/**` usam imports relativos **sem
extensão** (`from "./fake-provider"`), exatamente como o resto do
projeto sob o bundler do Next.js. O Node puro, ao contrário do bundler,
exige o especificador de módulo completo — por isso os harnesses/testes
registram um pequeno loader ESM (`scripts/ts-module-resolver.mjs`, via
`node:module`'s `register()`) que tenta de novo com `.ts` quando a
resolução falha, e usam `import()` dinâmico *depois* do `register()`
para os módulos de `apps/web/lib/ai/**` (imports estáticos são
resolvidos antes do corpo do módulo executar, então `register()` teria
que já estar ativo antes disso).

Uma alternativa considerada foi adicionar `.ts` explícito nos imports
relativos do próprio código-fonte + `allowImportingTsExtensions: true`
no `tsconfig.json` de `apps/web`. Essa alternativa foi revertida nesta
correção: exigiria espalhar extensões `.ts` (uma convenção nova, só
usada nesses arquivos) por toda a fundação, além de uma mudança de
compilador que afeta o projeto inteiro para resolver um problema que só
existe nos harnesses standalone. O loader mantém o código-fonte
100% consistente com o resto do projeto e isola a peculiaridade do Node
puro nos dois pontos que realmente precisam dela.

## 4. Diretor Comercial IA (`commercial-director`)

- **Nome**: Diretor Comercial IA
- **ID técnico**: `commercial-director`
- **Versão atual**: `v1`
- **Status**: primeiro AI Expert oficial implementado do ACC.

### Missão

Apoiar decisões e negociações comerciais relacionadas aos contratos e
projetos: estratégia de negociação, posição atual/desejada, pontos
negociáveis/não negociáveis, concessões, contrapartidas, cenários,
prioridades, riscos comerciais, impactos financeiros/de prazo/
contratuais, preparação para reuniões, argumentos e sua ordem, objeções
prováveis do cliente e respostas sugeridas, propostas/contrapropostas,
condições comerciais, respostas a pleitos, aditivos, alterações de
escopo, preço, medição, retenção, reajuste, multas, garantias, prazo e
formas de pagamento (ver `identity.ts` para o texto completo das
instruções).

Nunca inventa limite econômico, margem, preço, autorização ou condição
que não exista nas fontes — quando ausente, declara explicitamente
"Necessária definição humana." (ver seção 6).

### Capacidade de redação

Pode produzir rascunhos completos (e-mails, propostas, contrapropostas,
respostas comerciais, cartas, pautas de reunião, roteiros de negociação,
memorandos, minutas comerciais, textos para aditivos, solicitações de
informação, respostas a pleitos) — sempre em
`negotiation.draftCommunication`, sempre com
`status: "DRAFT_PENDING_REVIEW"`. Nunca envia nada automaticamente.

## 5. Fontes autorizadas

O Expert só recebe o que o context builder (genérico, reutilizado sem
alteração) monta a partir das tabelas reais do projeto:
`contract_events`, `event_evidence`, `clauses` (via
`event_clause_confrontation_candidates` e `event_cross_references`),
`document_versions`/`documents` e `emails`. Nenhum outro conhecimento é
injetado no contexto.

Distinção obrigatória em toda saída:

- **FATO** → `finding.facts` (sempre com `evidenceRefs`/`contractualBasis`
  correspondente).
- **INTERPRETAÇÃO** → `finding.interpretation`.
- **SUGESTÃO** → `recommendedActions` e os campos de `negotiation`.

## 6. Saída estruturada

### Genérica (`ExpertAssessment`, `apps/web/lib/ai/types.ts`)

```
expertId, expertName, expertVersion, analysisType,
finding { facts[], interpretation },
severity (LOW|MEDIUM|HIGH|CRITICAL),
confidence (0..1),
executiveSummary, contractualBasis[], eventBasis[], evidenceRefs[],
possibleImpacts[], recommendedActions[], uncertainties[],
requiresHumanReview (sempre true nesta fase)
```

### Específica do Diretor Comercial IA (`CommercialDirectorAssessment`,
`experts/commercial-director/types.ts`) — estende a genérica com:

```
negotiation: {
  negotiationObjective, currentPosition, targetPosition,
  minimumAcceptablePosition: CommercialFieldValue<string>,
  nonNegotiableItems[], negotiableItems[], possibleConcessions[],
  requiredCounterparts[], counterpartyLikelyInterests[],
  recommendedStrategy, arguments[], anticipatedObjections[],
  suggestedResponses[], recommendedSequence[], commercialRisks[],
  financialImpact | scheduleImpact | contractualImpact: CommercialImpactAssessment,
  draftCommunication: CommercialDraftCommunication | null,
}
```

`CommercialFieldValue<T>` é um tipo com três estados explícitos —
`AVAILABLE` (com `value`+`basis` obrigatórios), `UNAVAILABLE` e
`REQUIRES_HUMAN_DEFINITION` (ambos com `value`/`basis` sempre `null`).
Usado em `minimumAcceptablePosition`: nunca um valor econômico solto.

`CommercialImpactAssessment` segue o mesmo princípio para impacto
financeiro/prazo/contratual — `estimatedValue` só pode ser não-nulo
quando `status` é `AVAILABLE` (validado, nunca só por convenção).

`CommercialDraftCommunication.status` é travado em
`"DRAFT_PENDING_REVIEW"` — o validador rejeita qualquer outro valor,
igual ao tratamento de `requiresHumanReview`. É a garantia em nível de
tipo/validação de que nenhuma comunicação é considerada enviada.

Nenhuma saída textual livre é aceita como resposta única.

## 7. Limites de autoridade

```
IA ANALISA → IA SUGERE → IA PODE REDIGIR A MINUTA →
HUMANO REVISA/EDITA → HUMANO APROVA OU REJEITA →
SISTEMA EXECUTA SOMENTE O QUE FOI AUTORIZADO
```

O Diretor Comercial IA PODE: sugerir decisão, sugerir aprovação, sugerir
rejeição, recomendar ação, criar estratégia, preparar textos.

NÃO PODE: aprovar sua própria recomendação, enviar e-mail autonomamente,
assumir compromisso pela AXION, alterar contrato, aceitar proposta,
conceder desconto, criar obrigação vinculante, ou alterar estado
definitivo sem decisão humana. `requiresHumanReview` é sempre `true`
nesta versão.

## 8. Provider abstraction

`apps/web/lib/ai/providers/types.ts` define a interface `AiProvider`.
Nenhum Expert conhece Anthropic/OpenAI/Gemini diretamente.

Seleção via `getAiProvider()` (`providers/get-ai-provider.ts`), controlada
pela variável de ambiente `AXION_AI_PROVIDER` (mesmo padrão de
`AXION_EMAIL_PROVIDER` já usado no projeto):

- Ausente ou `"fake"` → `FakeAiProvider` (determinístico, sem rede, sem
  custo, genérico — ver seção 3).
- `anthropic|openai|gemini` → falha fechado explicitamente ("ainda não
  implementado nesta fase").
- Qualquer outro valor → falha fechado.

Nenhuma chave de API existe no código. Quando um provider real for
implementado, sua configuração (chave, modelo) virá de environment
variables, nunca hardcoded.

## 9. Context builder

`apps/web/lib/ai/context/build-event-context.ts` — somente leitura,
recebe `projectId`, `eventId` e opcionalmente `candidateId`. Genérico:
usado pelo Diretor Comercial IA sem nenhuma alteração, e reutilizável
por qualquer Expert futuro.

Ordem de prioridade: `Evento → Evidências → Cláusulas relacionadas →
Documentos fonte → E-mails`. Com `candidateId`, o contexto é restrito a
esse único candidato e sua cláusula (controle de token/custo).

## 10. Testes

- `scripts/test-ai-foundation.mjs` — genéricos: schema aceita saída
  válida; `confidence` fora de 0..1; `severity`/`analysisType`
  inválidos; `requiresHumanReview` não pode virar `false`/ficar ausente;
  `evidenceRefs` tipados; saída textual livre rejeitada; provider
  ausente/desconhecido falha fechado; fake provider é genérico (ecoa
  `expertId`/`expertName`/`analysisType` da requisição, nunca hardcoda);
  fake provider determinístico; context builder contra o evento de
  referência real não altera dados (completo e restrito a um candidato).
- `scripts/test-commercial-director-expert.mjs` — específicos: schema
  `negotiation` aceita saída válida; `minimumAcceptablePosition` nunca
  aceita valor sem `basis` nem valor quando não `AVAILABLE`;
  `financialImpact`/`scheduleImpact`/`contractualImpact` nunca aceitam
  `estimatedValue` fora de `AVAILABLE`; categoria de impacto não pode
  ser trocada; `draftCommunication` só aceita `DRAFT_PENDING_REVIEW`;
  execução real contra o evento de referência não altera candidatos nem
  envia nada.

Nenhum teste executa write em dado produtivo.

## 11. Auditoria — desenho (não implementado nesta fase)

Nenhuma tabela nova foi criada e nenhum registro foi inserido em
`audit_log_entries` por esta fundação. Desenho para quando a auditoria de
execuções do Expert for implementada:

- `expert_id`, `expert_version` — rastreabilidade quando `identity.ts`
  mudar.
- `provider_id`, `model` — qual provider/modelo gerou a saída (`fake`
  por enquanto; `model` nulo até haver provider real).
- `timestamp`, `project_id`, `event_id`, `focus_candidate_id`.
- Evidências (`evidenceRefs`) usadas.
- `confidence`, `requires_human_review`.

Esse formato já existe como `CommercialDirectorRunResult.audit` (ver
`experts/commercial-director/index.ts`) — em memória, apenas impresso
pelo harness. Persistir isso exigirá uma migration nova e uma decisão de
produto sobre onde essa trilha aparece na UI — nenhuma das duas coisas
foi feita nesta fase.

## 12. O que falta para conectar um LLM real

1. Implementar um provider real (ex.: `AnthropicAiProvider`) que
   implemente `AiProvider`, monte o prompt a partir de
   `instructions` + `context` e faça parsing da resposta para JSON — a
   validação (`validateExpertAssessment` + `validateCommercialDirectorAssessment`)
   continua a mesma, sem alteração.
2. Adicionar o(s) valor(es) do provider real a
   `KNOWN_UNIMPLEMENTED_PROVIDERS`/`getAiProvider()` só quando de fato
   implementado.
3. Definir e documentar as environment variables necessárias (chave,
   modelo) — nunca no código, nunca no frontend.
4. Implementar a persistência de auditoria (seção 11) via migration
   nova.
5. Expor a análise na UI (ex.: botão "Analisar com IA" na página do
   evento) chamando `runCommercialDirectorExpert` a partir de uma Server
   Action — nenhuma UI foi criada nesta fase, apenas o harness CLI.
6. Definir estratégia de custo/token para contextos maiores.
7. Implementar os próximos Experts oficiais da tabela da seção 1
   reutilizando a mesma fundação genérica.

# Catálogo Formal de Habilidades dos Experts — ACC

Este documento é a especificação formal, tipada e versionada dos cinco
Experts oficiais do AXION Acompanhamento de Contratos (ACC). É uma das
fontes oficiais previstas para um futuro **Manual PDF A4 retrato** e uma
**apresentação executiva (PowerPoint)** — por isso a estrutura abaixo
segue uma ordem estável, pensada para conversão direta.

O código-fonte desta especificação vive em
`apps/web/lib/ai/expert-definitions/` (`types.ts`, `shared.ts`,
`definitions.ts`). Este documento descreve o mesmo conteúdo em
linguagem natural; em caso de divergência, **o código é a fonte de
verdade**.

> Esta fase define apenas o CATÁLOGO — missão, fontes, capacidades,
> saídas, limites, escalonamento, colaboração e versionamento. Nenhum
> LLM real foi conectado para CEO IA, Consultor Jurídico IA ou Diretor
> de Planejamento IA nesta fase, e nenhuma UI nova foi criada. Diretor
> Comercial IA e Diretor de ESG IA já são operacionais (ver
> `docs/ai/experts.md` e `docs/esg-obligations.md`) e mantêm essa
> operação inalterada — este documento apenas formaliza o que eles já
> fazem.

## 1. Experts oficiais registrados

| # | Expert | ID técnico | Status | Versão |
| - | ------ | ----------- | ------ | ------ |
| 1 | CEO IA | `ceo` | Planejado | v1 |
| 2 | Diretor Comercial IA | `commercial-director` | **Implementado** | v2 |
| 3 | Consultor Jurídico IA | `legal-consultant` | Planejado | v1 |
| 4 | Diretor de Planejamento IA | `planning-director` | Planejado | v1 |
| 5 | Diretor de ESG IA | `esg-director` | **Implementado** | v1 |

`contract-lawyer` ("Advogado Especialista em Contratos") foi rejeitado
em decisão de produto anterior e **não** faz parte deste catálogo, sob
nenhum ID.

Este catálogo (`OfficialExpertId`, 5 valores) é deliberadamente
separado da união operacional `ExpertId`
(`apps/web/lib/ai/types.ts`, hoje só `"commercial-director" |
"esg-director"`) — registrar um Expert aqui nunca implica que ele já
tem `generateAssessment`/`answerQuery` reais ligados.

## 2. Estrutura padrão de uma definição de Expert

Todo Expert oficial é descrito pelo mesmo formato
(`ExpertDefinition`, `apps/web/lib/ai/expert-definitions/types.ts`):

```
ExpertDefinition {
  expertId              // OfficialExpertId
  expertName
  version                // ex.: "v1"
  status                 // "IMPLEMENTED" | "PLANNED"
  mission
  authorizedSources      // AuthorizedSourceRef[] (AVAILABLE | FUTURE_SOURCE)
  capabilities           // string[]
  typicalQuestions       // string[]
  outputTypes            // ExpertOutputType[]
  limitations            // string[]
  escalationRules        // ExpertEscalationRule[]
  collaborationRules     // ExpertCollaborationRule[]
  confidenceRules        // ExpertConfidenceRule[]
  requiresHumanReview    // sempre true (tipo literal)
}
```

`requiresHumanReview` é `true` para os cinco Experts, sem exceção,
nesta fase. Cada definição é versionada de forma independente — a tag
completa é `expertId:version` (ex.: `commercial-director:v2`, via
`formatExpertVersionTag()`).

## 3. Diretor Comercial IA (`commercial-director:v2` — implementado)

**Missão:** apoiar decisões e negociações comerciais relacionadas aos
contratos e projetos da AXION.

**Capacidades:** estratégia de negociação; análise de posição da AXION
e da contraparte; objetivos, cenários e prioridades; concessões
possíveis e contrapartidas; propostas e contrapropostas; Change Orders
e aditivos; alterações de escopo, preço, medição, pagamento, retenção,
reajuste, multas e garantias; impactos financeiros e comerciais;
preparação de reuniões; antecipação de objeções e sugestão de
respostas; redação de e-mails, cartas, propostas e minutas comerciais
(sempre como rascunho).

**Pergunta típica:** *"Qual estratégia recomenda para este aditivo?"*

**Saídas:** `ANALYSIS`, `RECOMMENDATION`, `RISK_ASSESSMENT`,
`DRAFT_EMAIL`, `DRAFT_PROPOSAL`, `DRAFT_COUNTERPROPOSAL`,
`DRAFT_LETTER`.

**Limites:** nunca inventa margem, desconto autorizado, limite de
negociação, preço ou condição comercial não presente nas fontes;
quando o dado está ausente, declara exatamente **"NÃO DISPONÍVEL —
NECESSÁRIA DEFINIÇÃO HUMANA."**; nunca aprova a própria recomendação
nem assume compromisso pela AXION.

## 4. Consultor Jurídico IA (`legal-consultant:v1` — planejado)

**Missão:** realizar análise jurídica aprofundada de contratos, fatos,
comunicações e evidências dos projetos da AXION.

**Fontes prioritárias:** contrato, aditivos, anexos, edital, RFI/RFP,
proposta comercial/técnica, e-mails, atas, Diário de Obra,
Construmanager, relatórios semanais, notificações, Change Orders,
alterações de projeto, Timeline Contratual/Jurídico, anotações de
evento, evidências, fontes normativas oficiais.

**Capacidades:** interpretar contrato e aditivos; reconstruir
cronologia factual; identificar direitos e obrigações; identificar
descumprimentos; identificar lacunas documentais; detectar
contradições entre documentos; diferenciar fato, interpretação e
alegação; avaliar posição favorável/desfavorável à AXION; avaliar
risco jurídico; preparar estratégia jurídica; sugerir
notificação/resposta; preparar minutas de carta, notificação e
resposta a notificação; preparar cronologia de disputa; apoiar
litígio/arbitragem/perícia; identificar documentos que sustentam uma
tese.

**Pergunta típica:** *"Quais documentos sustentam nossa posição?"*

**Saídas:** `ANALYSIS`, `RECOMMENDATION`, `RISK_ASSESSMENT`,
`DRAFT_LETTER`, `DRAFT_NOTIFICATION`, `DOCUMENT_GAP_ANALYSIS`,
`TIMELINE_ANALYSIS`.

**Base legal:** fonte inicial prevista é o Código Civil brasileiro
aplicável, sempre por meio de fontes oficiais versionadas
(`LegalSource`/`LegalCitation`, `apps/web/lib/ai/legal/types.ts`).
Nenhum corpus normativo está carregado nesta fase — enquanto isso for
verdade, este Expert **nunca inventa um artigo de lei**; declara a
limitação explicitamente em vez de citar norma.

**Distinção obrigatória em toda saída:** `LEGAL_REQUIREMENT` (exigência
legal) × `CONTRACTUAL_REQUIREMENT` (exigência contratual) ×
`NEGOTIATION_PRACTICE` (prática negocial) × `AI_RECOMMENDATION`
(recomendação da IA) — já modelado como `RequirementSourceKind`
(`apps/web/lib/ai/query/types.ts`).

## 5. Diretor de Planejamento IA (`planning-director:v1` — planejado, escopo reduzido)

**Missão (reduzida nesta fase):** analisar exclusivamente atrasos e
acelerações de cronograma que possam gerar consequência econômica ou
contratual relevante para a AXION.

**Capacidades:** identificar atraso ou aceleração relevante; identificar
impacto potencial sobre prazo contratual; identificar risco de
multa/penalidade por atraso; identificar custo adicional; identificar
possível ganho comercial de aceleração; identificar oportunidade de
aceleração com benefício claro; correlacionar evento do Event Ledger
com o cronograma; sugerir comunicação/ação; preparar resumo de
impacto.

**Pergunta típica:** *"Este atraso pode gerar penalidade?"*

**Saídas:** `ANALYSIS`, `RECOMMENDATION`, `RISK_ASSESSMENT`,
`ACTION_SUGGESTION`, `TIMELINE_ANALYSIS`.

**Fora de escopo nesta fase:** Lean Construction, Last Planner System,
PPC, Pull Planning, Lookahead, gestão operacional de produção detalhada,
planejamento de produção amplo.

**Princípio:** PRAZO → IMPACTO ECONÔMICO/CONTRATUAL → RECOMENDAÇÃO. Sem
consequência econômica/contratual identificável, a análise não é
aprofundada.

## 6. Diretor de ESG IA (`esg-director:v1` — implementado, escopo reduzido)

**Missão (reduzida, já implementada):** gerenciar e analisar
exclusivamente obrigações ESG/SSMA de origem contratual cujo
descumprimento possa gerar consequência econômica ou contratual para a
AXION.

**Capacidades:** identificar obrigação e prazo; identificar evidência
exigida; verificar comprovação (fotos, documentos, DDS); identificar
pendência/vencimento; identificar risco de multa, penalidade, retenção
ou paralisação; sugerir regularização/cobrança; preparar e-mail ou
documento de cobrança/regularização.

**Pergunta típica:** *"Quais obrigações estão sem comprovação?"*

**Saídas:** `ANALYSIS`, `RECOMMENDATION`, `RISK_ASSESSMENT`,
`ACTION_SUGGESTION`, `DRAFT_EMAIL`.

**Fora de escopo:** ESG corporativo amplo, sustentabilidade genérica,
gestão operacional completa de SSMA. O risco (BAIXO/MÉDIO/ALTO/CRÍTICO)
é sempre calculado por regra determinística
(`apps/web/lib/esg/compute-obligation-risk.ts`) antes de qualquer
interpretação da IA.

## 7. CEO IA (`ceo:v1` — planejado)

**Missão:** atuar como camada executiva e integradora sobre os demais
Experts — nunca substitui uma análise especializada.

**Capacidades:** solicitar/receber análises dos demais Experts;
consolidar conclusões; identificar divergências entre Experts;
identificar conflitos entre áreas; priorizar riscos; identificar
decisões pendentes; comparar cenários; apresentar alternativas;
recomendar uma decisão executiva; apontar informação faltante;
destacar riscos ALTO/CRÍTICO; destacar ações já escaladas à Diretoria.

**Pergunta típica:** *"Qual é a situação executiva deste problema e
qual alternativa recomenda?"*

**Saídas:** `EXECUTIVE_SUMMARY`, `ANALYSIS`, `RECOMMENDATION`,
`RISK_ASSESSMENT`.

**Formato obrigatório do resumo executivo (ordem fixa):**

1. SITUAÇÃO
2. FATOS PRINCIPAIS
3. POSIÇÃO DO DIRETOR COMERCIAL IA
4. POSIÇÃO DO CONSULTOR JURÍDICO IA
5. POSIÇÃO DO DIRETOR DE PLANEJAMENTO IA
6. POSIÇÃO DO DIRETOR DE ESG IA
7. DIVERGÊNCIAS
8. RISCOS
9. ALTERNATIVAS
10. RECOMENDAÇÃO
11. DECISÕES HUMANAS NECESSÁRIAS

**Limite central:** o CEO IA nunca executa uma decisão — apenas
recomenda. `requiresHumanReview = true` sempre.

## 8. Consultas conversacionais

Todos os cinco Experts suportam consultas conversacionais (uma pergunta
livre sobre um evento/projeto), com a mesma pergunta de exemplo listada
nas seções 3–7. Diretor Comercial IA e Diretor de ESG IA já respondem
de fato (`answerCommercialDirectorQuery`/`answerEsgDirectorQuery`); os
demais têm a pergunta registrada no catálogo, sem execução real ainda.

## 9. Catálogo de fontes autorizadas

Cada fonte é classificada como `AVAILABLE` (real e consultável hoje) ou
`FUTURE_SOURCE` (mencionada no requisito do produto, sem
tabela/integração real) — nunca finge uma integração que não existe.
Fonte de verdade: `SHARED_SOURCE_CATALOG`
(`apps/web/lib/ai/expert-definitions/shared.ts`).

| Fonte | Status |
| ----- | ------ |
| Event Ledger (eventos contratuais) | AVAILABLE |
| Evidências de evento | AVAILABLE |
| Anotações do Evento (contexto declarado) | AVAILABLE |
| Cláusulas contratuais | AVAILABLE |
| Documentos (contrato, aditivos, anexos, edital, RFI/RFP, propostas) | AVAILABLE |
| E-mails | AVAILABLE |
| Timeline Contratual/Jurídico | AVAILABLE |
| Obrigações ESG/SSMA | AVAILABLE |
| Evidências ESG/SSMA | AVAILABLE |
| Cronograma (atividades) | AVAILABLE |
| Change Orders / alterações contratuais | AVAILABLE |
| Ações e Escalonamentos (SLA) | AVAILABLE |
| Fontes legais oficiais (ex.: Código Civil) | FUTURE_SOURCE |
| Atas de reunião | FUTURE_SOURCE |
| Diário de Obra | FUTURE_SOURCE |
| Construmanager | FUTURE_SOURCE |
| Relatórios semanais | FUTURE_SOURCE |
| Notificações formais | FUTURE_SOURCE |

## 10. Fato × Contexto × Interpretação

Toda saída de todo Expert deve distinguir obrigatoriamente estas oito
categorias (`FactCategory`):

1. **FATO DOCUMENTADO**
2. **CONTEXTO INTERNO DECLARADO**
3. **BASE CONTRATUAL**
4. **BASE LEGAL**
5. **PRÁTICA NEGOCIAL**
6. **INTERPRETAÇÃO DA IA**
7. **RECOMENDAÇÃO DA IA**
8. **INFORMAÇÃO AUSENTE**

Já implementado como campos reais e distintos em
`ExpertQueryResponse`/`ExpertAssessment`
(`fatosDocumentados`/`contextoInternoDeclarado`/`baseContratual`/
`baseLegal`/`praticasNegociais`/`interpretacao`/`recomendacoes`/
`informacoesFaltantes`) — este catálogo apenas nomeia formalmente a
mesma distinção.

## 11. Saídas possíveis

`ExpertOutputType`: `ANALYSIS`, `RECOMMENDATION`, `RISK_ASSESSMENT`,
`ACTION_SUGGESTION`, `DRAFT_EMAIL`, `DRAFT_LETTER`,
`DRAFT_NOTIFICATION`, `DRAFT_PROPOSAL`, `DRAFT_COUNTERPROPOSAL`,
`EXECUTIVE_SUMMARY`, `TIMELINE_ANALYSIS`, `DOCUMENT_GAP_ANALYSIS`.

Todo `DRAFT_*` implica `status: "DRAFT_PENDING_REVIEW"` — nunca enviado
automaticamente. Nos Experts já implementados essa garantia é reforçada
por tipo/schema (`CommercialDraftCommunication`, `ExpertQueryDraft`,
`validateExpertQueryResponse`); nos planejados, é um requisito
documentado a ser preservado quando forem implementados.

## 12. Colaboração entre Experts

| Tema | Expert principal | Experts auxiliares |
| ---- | ----------------- | ------------------- |
| NEGOCIAÇÃO | Diretor Comercial IA | Consultor Jurídico IA (quando houver risco legal) |
| DISPUTA | Consultor Jurídico IA | Diretor Comercial IA; Diretor de Planejamento IA (quando houver prazo) |
| ATRASO COM MULTA | Diretor de Planejamento IA | Consultor Jurídico IA, Diretor Comercial IA |
| SSMA COM PENALIDADE | Diretor de ESG IA | Consultor Jurídico IA |
| DECISÃO EXECUTIVA | CEO IA | Consulta os Experts necessários ao tema |

Fonte de verdade: `EXPERT_COLLABORATION_MATRIX` +
`getCollaborationRulesForExpert()`
(`apps/web/lib/ai/expert-definitions/shared.ts`).

## 13. Escalonamento para decisão humana

Todo Expert deve declarar **"DECISÃO HUMANA NECESSÁRIA"** (ou, no caso
específico do Diretor Comercial IA para dado econômico ausente, **"NÃO
DISPONÍVEL — NECESSÁRIA DEFINIÇÃO HUMANA"**) nas seguintes situações,
no mínimo:

- informação insuficiente para concluir;
- conflito entre documentos/fontes;
- valor econômico não disponível nas fontes;
- decisão que gera obrigação para a AXION;
- concessão comercial;
- envio de qualquer comunicação;
- interpretação jurídica crítica;
- risco classificado como ALTO ou CRÍTICO;
- ação já escalada à Diretoria (Matriz de SLA).

## 14. Relação com a Matriz de SLA e Escalonamento

```
EXPERT RECOMENDA AÇÃO → HUMANO APROVA (quando necessário) →
SLA ENGINE CONTROLA PRAZO E ESCALONAMENTO DETERMINÍSTICO
```

Nenhum Expert controla o relógio ou a lógica de escalonamento do
Sistema de SLA (`apps/web/lib/sla/`, ver `docs/sla-escalation.md`) — o
motor de SLA é inteiramente determinístico e independente de LLM. Um
Expert pode, no máximo, **sugerir** que uma ação entre no fluxo de SLA;
a criação efetiva da ação e sua entrada no relógio dependem sempre de
aprovação humana.

## 15. Testes

`scripts/test-expert-capabilities.mjs` cobre: presença dos cinco
`OfficialExpertId`; ausência de `contract-lawyer` em qualquer forma;
`requiresHumanReview` sempre `true`; `outputTypes` restritos ao
conjunto formal; rascunhos sempre associados à garantia de
`DRAFT_PENDING_REVIEW`; escopo reduzido do Diretor de Planejamento
(sem Lean/LPS/PPC/Pull Planning/Lookahead); escopo reduzido do Diretor
de ESG (sem ESG corporativo amplo/gestão operacional completa de
SSMA); CEO IA nunca declara execução de decisão; fontes `FUTURE_SOURCE`
nunca apresentadas como integração real; Consultor Jurídico IA nunca
cita artigo de lei específico; matriz de colaboração completa;
regras de escalonamento presentes para os cinco Experts; frase exata
do Diretor Comercial IA para dado econômico ausente; compatibilidade
de `expertId`/`version`/`status` com os Experts já implementados
(`identity.ts` real).

## 16. Versionamento

Cada `ExpertDefinition` é versionada de forma independente
(`expertId:version`, ex. `commercial-director:v2`,
`legal-consultant:v1`). Alterar substancialmente missão, capacidades,
limites ou saídas de um Expert deve sempre vir acompanhado de um bump
de versão, para rastreabilidade em auditoria futura — mesmo princípio
já usado para `COMMERCIAL_DIRECTOR_VERSION`/`ESG_DIRECTOR_VERSION`
(commercial-director passou de v1 para v2 ao reforçar o prompt com a
seção de fidelidade textual/grounding — ver
docs/ai/grounding-and-citation-guardrails.md).

## 17. O que esta fase deliberadamente NÃO fez

- Não conectou nenhum provider real de LLM (Anthropic/OpenAI/Gemini) —
  `AXION_AI_PROVIDER` continua fail-closed por padrão.
- Não implementou CEO IA, Consultor Jurídico IA nem Diretor de
  Planejamento IA de forma operacional (sem `generateAssessment`/
  `answerQuery` reais) — apenas a definição formal deste documento e do
  código em `expert-definitions/`.
- Não criou nenhuma tela nova nem alterou a UI existente.
- Não alterou o comportamento real do Diretor Comercial IA nem do
  Diretor de ESG IA — apenas formalizou, em catálogo, o que eles já
  fazem.

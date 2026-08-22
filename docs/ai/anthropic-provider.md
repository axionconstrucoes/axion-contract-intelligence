# Provider Anthropic — ACC

Primeiro provider real de IA do AXION Acompanhamento de Contratos
(ACC), conectado **somente ao Diretor Comercial IA** (`commercial-director`)
nesta fase. Complementa `docs/ai/experts.md` (arquitetura geral dos AI
Experts), `docs/ai/expert-capabilities.md` (catálogo formal dos cinco
Experts oficiais) e `docs/ai/grounding-and-citation-guardrails.md`
(camada determinística que valida rascunhos/análises reais contra o
contexto antes de serem considerados prontos para revisão) — não os
substitui.

## 1. SDK

`@anthropic-ai/sdk` (SDK oficial TypeScript/Node da Anthropic),
dependência direta de `apps/web/package.json`. O ACC consome a API
Anthropic diretamente pelo provider — **nunca** via Claude Code CLI/SDK.

## 2. Escopo desta fase

Conectado: **Diretor Comercial IA** (`commercial-director`) — análise em
lote (`runCommercialDirectorExpert`) e consulta conversacional
(`answerCommercialDirectorQuery`, usada pelo `ExpertQueryPanel`).

**Não conectado ainda** (decisão de produto, não limitação técnica):
CEO IA, Consultor Jurídico IA, Diretor de Planejamento IA, Diretor de
ESG IA. Essa restrição é reforçada em **runtime** por
`AnthropicAiProvider` (`ANTHROPIC_ALLOWED_EXPERT_IDS`,
`apps/web/lib/ai/providers/anthropic-provider.ts`) — mesmo que
`AXION_AI_PROVIDER=anthropic` esteja configurado globalmente, qualquer
Expert fora dessa lista é rejeitado com um erro explícito antes de
qualquer chamada de rede.

O `FakeAiProvider` continua funcionando normalmente e é o default
(`AXION_AI_PROVIDER` ausente ou `"fake"`).

## 3. Configuração (environment variables)

Nenhuma chave é hardcoded, versionada, logada ou exposta ao frontend —
o provider roda inteiramente server-side (dentro de Server Actions
`"use server"`, nunca importado por um Client Component).

| Variável | Obrigatória | Default | Descrição |
| -------- | ----------- | ------- | --------- |
| `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR` | Não | *(usa `AXION_AI_PROVIDER`)* | `fake` ou `anthropic` — provider específico do Diretor Comercial IA. |
| `AXION_AI_PROVIDER_ESG_DIRECTOR` | Não | *(usa `AXION_AI_PROVIDER`)* | `fake` ou `anthropic` — provider específico do Diretor de ESG IA. |
| `AXION_AI_PROVIDER_CEO` | Não | *(usa `AXION_AI_PROVIDER`)* | Preparada; CEO IA ainda não é operacional (ver seção 2). |
| `AXION_AI_PROVIDER_LEGAL_CONSULTANT` | Não | *(usa `AXION_AI_PROVIDER`)* | Preparada; Consultor Jurídico IA ainda não é operacional. |
| `AXION_AI_PROVIDER_PLANNING_DIRECTOR` | Não | *(usa `AXION_AI_PROVIDER`)* | Preparada; Diretor de Planejamento IA ainda não é operacional. |
| `AXION_AI_PROVIDER` | Não | `fake` | Default de **compatibilidade** — só usado quando a variável específica do Expert está ausente (ver seção 3.1). |
| `ANTHROPIC_API_KEY` | Sim, quando algum Expert resolve `anthropic` | — | Nunca logada, nunca aparece em mensagens de erro. |
| `ANTHROPIC_MODEL` | Sim, quando algum Expert resolve `anthropic` | — | Nenhum modelo é escolhido silenciosamente. |
| `ANTHROPIC_MAX_TOKENS` | Não | `4096` | Deve ser um número positivo. |
| `ANTHROPIC_TIMEOUT_MS` | Não | `60000` | Deve ser um número positivo (milissegundos). |

Fail-closed: se um Expert resolve `anthropic` (via variável específica
ou via o fallback `AXION_AI_PROVIDER`) e `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`
estiverem ausentes, a resolução lança um erro imediatamente — **nunca**
cai de volta para `fake` silenciosamente. Ver
`apps/web/lib/ai/providers/anthropic-config.ts` (`loadAnthropicConfig`).

### 3.1. Provider por Expert (`resolveAiProviderForExpert`)

**Problema que esta seção resolve:** `AXION_AI_PROVIDER` sozinho é
global — ativá-lo para `anthropic` afetaria *todos* os Experts que
usassem essa seleção, inclusive o Diretor de ESG IA, que deve continuar
no fake provider nesta fase. Ativar um Expert real nunca pode desativar
outro.

`apps/web/lib/ai/providers/resolve-provider-for-expert.ts` expõe
`resolveAiProviderForExpert(expertId: OfficialExpertId)`, o ponto de
entrada correto usado por todo Expert (nunca `getAiProvider()`
diretamente — ver seção 4). Resolução, em ordem, por Expert:

1. variável específica do Expert (`AXION_AI_PROVIDER_<EXPERT>`, tabela
   acima);
2. se ausente, `AXION_AI_PROVIDER` (default de compatibilidade);
3. se ambas ausentes, `"fake"`.

**Configuração desejada para esta etapa (Diretor Comercial IA real,
Diretor de ESG IA fake, deliberadamente):**

```
AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic
AXION_AI_PROVIDER_ESG_DIRECTOR=fake
```

Isso não é um fallback silencioso — é uma escolha explícita e auditável
por Expert. A seleção nunca "recupera" um erro trocando `anthropic` por
`fake` sozinha: se `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic` e
faltar `ANTHROPIC_API_KEY`, a resolução falha — ela não tenta `fake`
como plano B. `esg-director` só usa `fake` porque isso foi
deliberadamente configurado (ou é o default de ausência total de
configuração), nunca como recuperação de uma falha do Anthropic.

## 4. Seleção de provider

- **Por Expert (uso correto, todo Expert deve usar isto):**
  `resolveAiProviderForExpert(expertId)` (seção 3.1) —
  `apps/web/lib/ai/providers/resolve-provider-for-expert.ts`.
- **Global (mantida por compatibilidade, não usar em código de Expert
  novo):** `getAiProvider()` — `apps/web/lib/ai/providers/get-ai-provider.ts`,
  lê só `AXION_AI_PROVIDER`, sem noção de qual Expert está chamando.

Ambas compartilham o mesmo núcleo de instanciação
(`apps/web/lib/ai/providers/instantiate-provider.ts`), para nunca
divergir sobre quais valores são válidos:

- `"fake"` (ou ausente, quando aplicável) → `FakeAiProvider`.
- `"anthropic"` → `AnthropicAiProvider` (`createAnthropicAiProvider()`,
  que já valida a configuração ao ser construído).
- `"openai"`/`"gemini"` → falha fechada explícita ("ainda não
  implementado nesta fase").
- Qualquer outro valor → falha fechada.

## 5. Saída estruturada (sem regex frágil)

O provider usa **tool-use forçado** da API Anthropic: uma única
ferramenta (`emit_expert_structured_output`) cujo `input_schema` é o
JSON Schema do Expert chamador (`tool_choice` fixo nessa ferramenta).
O SDK já devolve `input` como objeto JavaScript parseado — nenhum
parsing manual de texto, nenhuma tentativa de "consertar" JSON com
regex.

JSON Schemas usados nesta fase:

- `apps/web/lib/ai/experts/commercial-director/json-schema.ts` —
  `COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA` (análise em lote,
  espelha `CommercialDirectorAssessment`).
- `apps/web/lib/ai/query/json-schema.ts` —
  `EXPERT_QUERY_RESPONSE_JSON_SCHEMA` (consulta conversacional,
  genérico — espelha `ExpertQueryResponse`, reutilizável por qualquer
  Expert que implemente `answerQuery`).
- `apps/web/lib/ai/schemas/{json-schema-fragments.ts,expert-assessment-json-schema.ts}`
  — fragmentos compartilhados (ex.: `CommercialFieldValue` tri-state,
  `CommercialImpactAssessment`, `ExpertContractualBasisRef`).

Estes schemas são fornecidos pelo próprio Expert (via
`AiProviderRequest.outputSchema`/`AiProviderQueryRequest.outputSchema`)
— o provider nunca hardcoda o formato de um Expert específico.

**Importante:** este JSON Schema só orienta o modelo. A validação real
e definitiva continua sendo os validadores TypeScript já existentes
(`validateExpertAssessment`, `validateCommercialDirectorAssessment`,
`validateExpertQueryResponse`) — nenhuma resposta "passa" só porque a
tool-call foi aceita pela API.

## 6. Instruções do Expert

O prompt é montado a partir das instruções versionadas já existentes do
Diretor Comercial IA (`COMMERCIAL_DIRECTOR_INSTRUCTIONS`,
`apps/web/lib/ai/experts/commercial-director/identity.ts` — mesma fonte
de verdade usada pelo catálogo formal em
`apps/web/lib/ai/expert-definitions/definitions.ts`), com um bloco de
reforço de governança anexado pelo provider (ver seção 7) — nenhuma
segunda definição gigantesca é duplicada dentro do provider.

## 7. Governança obrigatória

Toda chamada real inclui, no `system` prompt:

```
IA ANALISA → IA SUGERE → IA PODE REDIGIR → HUMANO REVISA →
HUMANO APROVA OU REJEITA → SISTEMA EXECUTA SOMENTE O AUTORIZADO
```

O modelo é instruído explicitamente a nunca aprovar, enviar e-mail,
assumir compromisso, conceder desconto, aceitar condição comercial,
alterar contrato, criar obrigação vinculante, executar action request,
alterar SLA, alterar Event Ledger, ou escrever diretamente no banco —
o `AnthropicAiProvider` em si também nunca tem acesso a um client de
banco de dados (`createAnthropicAiProvider` não recebe um client
Supabase). `requiresHumanReview` é sempre `true`, validado como
invariante de tipo depois da chamada.

## 8. Fontes e contexto

O provider nunca consulta o banco diretamente. Fluxo:
`projectId`/`eventId` → Context Builder (`build-event-context.ts`/
`build-project-context.ts`, já existentes e reutilizados sem alteração)
→ fontes autorizadas recuperadas → provider. O contexto é serializado
como JSON e enviado como a única fonte de fatos permitida — a mensagem
do sistema instrui explicitamente o modelo a nunca tratar conhecimento
geral como fato deste projeto.

## 9. Distinção obrigatória

A mesma distinção formalizada em `docs/ai/expert-capabilities.md`
(seção 10: FATO DOCUMENTADO / CONTEXTO INTERNO DECLARADO / BASE
CONTRATUAL / BASE LEGAL / PRÁTICA NEGOCIAL / INTERPRETAÇÃO DA IA /
RECOMENDAÇÃO DA IA / INFORMAÇÃO AUSENTE) é reforçada no prompt e
continua implementada como campos reais e distintos em
`ExpertQueryResponse`/`ExpertAssessment`. Anotações do Evento
(`event_notes`, `USER_NOTE`) são sempre enviadas como
`DECLARED_CONTEXT` — nunca como evidência documental.

## 10. Base legal

Sem corpus normativo oficial carregado nesta fase (ver
`apps/web/lib/ai/legal/types.ts`) — o prompt instrui explicitamente o
modelo a nunca citar um artigo de lei de memória; quando não houver
`LegalSource` no contexto, `baseLegal` deve ser `[]`.

## 11. "Não inventar números" (regra crítica)

O modelo é instruído a nunca inventar preço, desconto, margem, valor
máximo/mínimo, percentual, condição de pagamento, prazo autorizado ou
posição mínima aceitável. Os tipos tri-state já existentes
(`CommercialFieldValue`/`CommercialImpactAssessment`, com estados
`AVAILABLE`/`UNAVAILABLE`/`REQUIRES_HUMAN_DEFINITION`) são preservados
e descritos no JSON Schema via `oneOf` — o validador rejeita qualquer
combinação inconsistente (ex.: `status: "AVAILABLE"` com `value: null`,
ou `estimatedValue` preenchido fora de `AVAILABLE`).

## 12. Resposta estruturada — sem schema concorrente

A resposta do Anthropic é sempre convertida pelos validadores já
existentes (`validateExpertAssessment` + `validateCommercialDirectorAssessment`
para análise em lote; `validateExpertQueryResponse` para consulta
conversacional) — nenhum segundo schema de validação foi criado. Se a
validação falhar, o erro sobe integralmente (fail-closed); nenhuma
resposta parcialmente validada é tratada como análise oficial.

## 13. Stop reasons

Tratados explicitamente antes mesmo de procurar o bloco `tool_use`:

- `max_tokens` (truncamento) → erro explícito, nunca tratado como
  avaliação válida.
- `refusal` → erro controlado e informativo, nunca um crash opaco.
- Ausência do bloco `tool_use` esperado (qualquer outro `stop_reason`
  sem a ferramenta chamada) → erro explícito citando o `stop_reason`
  recebido.

## 14. Timeout / retry

**Incidente que motivou esta seção:** o primeiro live test pareceu
travar (o processo só terminou por Ctrl+C, `$LASTEXITCODE` =
`-1073741510` / `STATUS_CONTROL_C_EXIT` no PowerShell). Investigação:
o SDK documenta explicitamente que *"request timeouts are retried by
default"* — ou seja, o `timeout` passado na construção do client é por
tentativa, e com `maxRetries: 2` o tempo de espera total podia, na
prática, chegar a até `(1 + maxRetries) × ANTHROPIC_TIMEOUT_MS` sem
nenhum limite de parede total garantido pelo SDK sozinho.

**Correção:** `callAnthropic` (`apps/web/lib/ai/providers/anthropic-provider.ts`)
agora envolve toda a chamada (incluindo qualquer retry interno do SDK)
em um `Promise.race` contra um temporizador de aplicação
(`raceWithHardTimeout`) que dispara exatamente em `ANTHROPIC_TIMEOUT_MS`
— **essa garantia não depende do client honrar nada**: mesmo que
`messages.create()` nunca resolva nem rejeite, a chamada de
`callAnthropic` sempre se resolve (sucesso ou erro) dentro de
`ANTHROPIC_TIMEOUT_MS`. Um `AbortController` é criado por chamada; seu
`signal` é repassado como segundo argumento ao client (cortesia, para
um client real cancelar a requisição HTTP em vez de deixá-la pendurada
em segundo plano) e é abortado quando o temporizador dispara. Testado
em `scripts/test-anthropic-provider.mjs` com um client mockado cujo
`create()` nunca resolve — a chamada é cancelada em ~80ms (timeout
curto de teste), nunca ficando pendurada.

`ANTHROPIC_TIMEOUT_MS` (default 60s) continua também sendo passado ao
client do SDK (`timeout`) como primeira linha de defesa. Retries além
disso são delegados ao próprio SDK (`maxRetries: 2`), que só repete
falhas de rede/HTTP transitórias (5xx, 429, timeout) — erros de
schema/config, `refusal` e HTTP 4xx não transitórios (400/401/403/404/422)
nunca são repetidos automaticamente, evitando multiplicar custo. Nunca
streaming (`stream` nunca é `true`) — o tool-use forçado precisa da
mensagem completa para extrair `input`.

Erros são sempre convertidos em mensagens claras (nunca a chave, nunca
um valor de configuração) via `wrapAnthropicError`, que também
preserva `status`/`code`/`name` originais como campos estruturados no
erro (`error.anthropicStatus`/`anthropicCode`/`anthropicOriginalName`)
— quem chama (ex.: o harness) pode logar esses campos individualmente
sem reparsear a mensagem.

### 14.1. Diagnóstico de bloqueio (marcadores `LIVE STEP N/7`)

`scripts/test-anthropic-commercial-director.mjs --live` imprime 7
marcadores (`LIVE STEP 1/7` a `LIVE STEP 7/7`, via
`scripts/lib/run-anthropic-live-test.mjs`) antes/depois de cada etapa:
carregar o Context Builder → resolver o provider → iniciar a chamada
Anthropic → resposta recebida → validar contra o schema → resultado
pronto. Isso permite atribuir exatamente onde uma execução real parou:

- para entre STEP 1 e STEP 2 → Context Builder/Supabase.
- para entre STEP 4 e STEP 5 → Anthropic/rede (agora limitado por
  `ANTHROPIC_TIMEOUT_MS`, nunca indefinido).
- para entre STEP 5 e STEP 6 → saída estruturada/schema.
- para depois do STEP 6 → harness/impressão do resultado.

Nenhum marcador imprime a chave, o prompt integral, documentos/e-mails
integrais nem headers de autenticação. A ordem exata dos marcadores (e
o corte correto em caso de falha em cada etapa) é testada offline em
`scripts/test-anthropic-live-steps.mjs`, sem nenhuma chamada de rede.

## 15. Metadata / tokens

`AiProviderResponse` inclui `stopReason` e `usage.{inputTokens,outputTokens}`
quando disponíveis (sempre `null` no `FakeAiProvider`). Propagado até
`CommercialDirectorRunResult.audit`/`CommercialDirectorQueryResult.audit`.
Nenhum chain-of-thought é armazenado; nenhum prompt/resposta completo é
logado automaticamente — apenas esta metadata estruturada, pensada para
uma futura persistência de auditoria (`docs/ai/experts.md`, seção 11) e
para um futuro cálculo de custo por análise/projeto/Expert (nenhum
sistema financeiro foi criado nesta fase).

## 16. Privacidade / logs

Nada além da metadata estruturada acima é logado por este módulo:
nenhum contrato inteiro, e-mail completo, documento, chave de API,
prompt completo ou resposta completa em console/auditoria.

## 17. UI (`ExpertQueryPanel`)

A metadata exibida (`providerId`, `providerLabel`, `model`,
`isRealProvider`) vem de uma única função,
`buildAiProviderUiMetadata()` (`apps/web/lib/ai/provider-ui-metadata.ts`),
usada por `expert-query-action.ts` e `esg-query-action.ts` — nunca
recalculada de forma diferente por Expert, e nunca lida de
`AXION_AI_PROVIDER`/`process.env` diretamente pelo componente
(client-side). Sempre derivada do `providerId`/`model` já retornados
pelo `audit` de `answerCommercialDirectorQuery`/`answerEsgDirectorQuery`
— por sua vez resolvidos via `resolveAiProviderForExpert` (nunca
`getAiProvider()` global).

Estados do banner: antes da primeira consulta (`meta === null`) mostra
um aviso neutro ("o provider será exibido após a primeira consulta") —
nunca assume "Fake/Teste" antes de qualquer resposta real ter chegado.
Depois de uma consulta: `meta.isRealProvider` decide entre "Provider:
Anthropic · Modelo: `<configurado>`" (nunca a chave) ou "Provider:
Fake/Teste". Ambos os casos sempre reforçam a revisão humana
obrigatória.

**Nota operacional:** o Next.js (`next dev`) só lê `.env.local` na
inicialização do processo — alterar `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR`/
`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` com o servidor de desenvolvimento
já rodando exige reiniciar o `next dev` para o novo valor ser
efetivamente lido; isso não é um bug de código, é comportamento padrão
do Next.js.

## 18. Escopos PROJECT/EVENT

Reutilizam integralmente `buildProjectAnalysisContext`/
`buildEventAnalysisContext` já existentes — nenhum despejo
indiscriminado do projeto inteiro (mesmos limites de seleção já
documentados em `docs/ai/experts.md`).

## 19. TimelineSelectionContext

Ainda **não conectado** a nenhum Expert (nem fake, nem Anthropic) nesta
fase — não existe arquitetura paralela para isso. Evolução futura: se
uma seleção de itens da Timeline Contratual/Jurídico
(`docs/timeline-export.md`) precisar alimentar um Expert, deve reutilizar
o mesmo padrão de context builder somente-leitura já estabelecido, nunca
um caminho novo.

## 20. Citações/rastreabilidade

Toda conclusão relevante deve apontar para `evidenceRefs`/`contractualBasis`
reais (IDs de evento/cláusula/documento/e-mail, nunca "fonte: contrato"
genérica) — reforçado no prompt de governança. Suporte a novos tipos de
locator (página, mensagem, anexo, atividade de cronograma) é evolução
futura do context builder, não deste provider.

## 21. Harness e testes

- `scripts/test-provider-per-expert.mjs` — testes da resolução por
  Expert (seção 3.1), **nunca** chamam a API real. Cobre: nomes de
  variável preparados para os 5 Experts oficiais; sem configuração,
  ambos os Experts implementados resolvem `fake`; ativar
  `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic` **não** afeta
  `esg-director` (continua `fake`) — o teste central desta correção;
  variável específica prevalece sobre `AXION_AI_PROVIDER` global;
  ausência de variável específica cai para `AXION_AI_PROVIDER`;
  `anthropic` sem `ANTHROPIC_API_KEY` continua fail-closed mesmo via
  variável específica (nunca cai para `fake`); valor inválido em
  variável específica falha fechado; CEO IA continua bloqueado pelo
  `AnthropicAiProvider` mesmo com `AXION_AI_PROVIDER_CEO=anthropic`
  configurada (dupla proteção: resolução prepara o nome, o provider
  ainda recusa o Expert); fake provider continua funcionando.
- `scripts/test-anthropic-provider.mjs` — testes automatizados, **nunca**
  chamam a API real: o client do SDK é sempre substituído por um mock
  (`createAnthropicAiProvider({ client, config })`). Cobre: seleção de
  provider; fake continua funcionando; fail-closed sem chave/modelo; a
  chave nunca aparece em erro/log; request enviado contém as instruções
  corretas do Diretor Comercial IA, o `outputSchema` recebido, nenhuma
  stream (`stream` nunca `true`) e um `AbortSignal` repassado ao client;
  `requiresHumanReview`; JSON válido/inválido; `max_tokens`; `refusal`;
  timeout do client; rate limit (429); 5xx; 4xx não transitório
  (400/401/404, com `status`/`code` estruturados preservados no erro);
  **request que nunca resolve nem rejeita é cancelada pelo timeout de
  aplicação em vez de ficar pendurada indefinidamente** (o teste direto
  do incidente que motivou a seção 14); o `AbortSignal` repassado ao
  client é de fato abortado nesse cancelamento; usage metadata; nenhuma
  escrita no banco; nenhum Expert não autorizado é ativado
  (`esg-director`, `contract-lawyer`); integração completa com
  `runCommercialDirectorExpert` (aceita saída válida, rejeita inválida).
- `scripts/test-anthropic-live-steps.mjs` — testes dos marcadores `LIVE
  STEP N/7` (seção 14.1), com todas as dependências mockadas via
  `scripts/lib/run-anthropic-live-test.mjs`, **nunca** chamam rede.
  Cobre: caminho de sucesso imprime os 7 marcadores na ordem correta;
  falha no Context Builder para entre STEP 1/STEP 2; falha na chamada
  Anthropic para entre STEP 4/STEP 5; falha na validação de schema para
  entre STEP 5/STEP 6.
- `scripts/test-anthropic-commercial-director.mjs` — harness real, dois
  modos:
  - **A. CONFIG CHECK** (default, sem `--live`): nunca chama rede.
    Reporta `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR`, `AXION_AI_PROVIDER`
    (fallback), o provider resolvido para `commercial-director`,
    presença de `ANTHROPIC_API_KEY` (nunca o valor), `ANTHROPIC_MODEL`,
    se o SDK carrega e se `loadAnthropicConfig()` passa.
  - **B. LIVE TEST** (`--live`): só chama a API real quando a flag é
    passada explicitamente, e só quando o provider resolvido para
    `commercial-director` é de fato `"anthropic"` (senão reporta "LIVE
    TEST PENDENTE" sem chamar rede). Usa o evento de referência
    (`58988a54-092c-442f-a79a-638b53bc088e`, projeto
    `00000000-0000-4000-8000-000000000001`) em modo somente leitura —
    nunca envia e-mail, nunca cria action, nunca grava no Event Ledger.
    Imprime os marcadores `LIVE STEP N/7` (seção 14.1). Em caso de
    falha, captura o erro e imprime apenas `name`/`status`/`code`/
    mensagem sanitizada (`describeErrorSafely`), com `exitCode = 1` —
    nunca deixa a falha aparecer como um crash opaco nem como um
    processo que nunca termina. Se `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`
    não estiverem configurados, reporta "LIVE TEST PENDENTE" e sai sem
    chamar rede — **nunca pede a chave no chat**.

```
node --env-file=apps/web/.env.local scripts/test-anthropic-commercial-director.mjs
node --env-file=apps/web/.env.local scripts/test-anthropic-commercial-director.mjs --live
```

> O aviso `MODULE_TYPELESS_PACKAGE_JSON` que aparece ao rodar estes
> scripts é do carregador de módulos Node para arquivos `.ts` sem
> `"type"` declarado em `package.json` — não tem relação com o
> incidente do live test (`STATUS_CONTROL_C_EXIT`) nem com nenhum
> travamento. `apps/web/package.json` não foi alterado para
> `"type": "module"` só para remover esse aviso — isso arriscaria o
> Next.js/monorepo sem necessidade real.

## 22. Como adicionar um provider alternativo futuramente

1. Implementar `AiProvider` (`generateAssessment` + `answerQuery`) em
   `apps/web/lib/ai/providers/<nome>-provider.ts`, aceitando
   `outputSchema` do request (nunca inventando outro schema).
2. Config fail-closed própria (`<nome>-config.ts`, mesmo padrão de
   `anthropic-config.ts`/`loadGmailConfig`).
3. Adicionar o valor em `instantiate-provider.ts` (`instantiateAiProviderByName`)
   e remover de `KNOWN_UNIMPLEMENTED_PROVIDERS` — automaticamente
   disponível tanto em `getAiProvider()` quanto em
   `resolveAiProviderForExpert()`.
4. Documentar as environment variables (nunca no código/frontend).
5. Testes mockados (nunca dependem de rede) + harness com modo
   CONFIG CHECK / `--live`.

# Testes sem chamadas a provedores de IA reais

Regra: as suítes de rotina (`npm test`, `test:scripts`, `test:email`, `test:sql`, `test:ssma`) **nunca**
falam com um provedor de IA real. Usam o provedor simulado (`fake`) ou um client falso injetado.

## O que impede a chamada

1. `scripts/lib/block-live-ai.mjs`, carregado por `node --import` em **todo** `node` dessas suítes (e no
   `npm test` de `apps/web`): remove `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`AXION_AI_PROVIDER*` do ambiente e
   faz `fetch`/`http(s).request` para `anthropic.com`, `openai.com`, `generativelanguage.googleapis.com` etc.
   **falhar alto** (`ACC_LIVE_AI_BLOCKED`).
2. `scripts/test-no-live-ai-in-routine.mjs` (dentro de `test:scripts`) prova: os comandos de rotina não
   referenciam testes live e todos carregam o guarda; o guarda remove chaves e bloqueia as requisições; sem
   chave o resolvedor devolve `fake` para os cinco Experts; o teste live exige habilitação.

## Teste real (separado, opt-in)

`npm run test:live-ai` — só executa com `ACC_ALLOW_LIVE_AI_TESTS=1` **e** `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`.
Sem isso termina com exit 0 sem nenhuma chamada. O harness `scripts/test-anthropic-commercial-director.mjs
--live` também exige a habilitação. Agentes e rotinas de CI **não** devem definir essa variável.

## Incidente que motivou isto

`scripts/test-provider-per-expert.mjs` (caso "CEO/Consultor Jurídico/Diretor de Planejamento…") ainda esperava
que o `AnthropicAiProvider` rejeitasse esses Experts e, por isso, chamava `answerQuery()` com o provider REAL e
a chave de mentira `sk-test-fake-key-not-real`. Depois que os cinco Experts passaram a ser autorizados
(`ANTHROPIC_ALLOWED_EXPERT_IDS`), a chamada passou a sair de verdade para `api.anthropic.com` (HTTP 401,
sem custo). Sob o guarda ela vira `Connection error`, o que provou o caminho. O teste agora usa um client falso
injetado (`createAnthropicAiProvider({ client, config })`).

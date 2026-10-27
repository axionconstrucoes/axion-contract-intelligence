# Variáveis e serviços do ACC — por nome (sem valores)

> **Este documento lista só NOMES.** Nenhum valor foi lido de `.env*`, nenhum segredo está aqui. A lista foi obtida
> por busca de `process.env.*` em `apps/web`, `scripts` e `packages`, de `secrets.*` em `.github/workflows` e do
> `apps/web/.env.example` (todo comentado). "Obrigatória" só é afirmada quando o código falha sem a variável;
> nos demais casos está marcado **a confirmar**.

## Onde cada valor é configurado

| Destino | Quando |
|---|---|
| **Vercel** (Project → Environment Variables) | Tudo que o app Next.js lê em produção/preview (`apps/web`). |
| **GitHub Actions → Secrets** | Tudo que os workflows (`.github/workflows/*.yml`) usam: workers, cron de e-mail/Drive/Gmail/Construmanager/Diário. |
| **Supabase** (Dashboard → Settings/Auth) | URL e chaves do projeto; provedores OAuth do login; Storage e RLS vivem no banco (migrations). |
| **Arquivo local `apps/web/.env.local`** (não versionado) | Só desenvolvimento; obter com `vercel env pull`, nunca copiar por canal inseguro. |

Regra do projeto (CLAUDE.md): nenhum segredo no frontend nem no Git. Só `NEXT_PUBLIC_*` pode chegar ao navegador.

## 1. Supabase (banco, Auth, Storage)

| Nome | Uso | Visibilidade | Configurar em | Obrigatória |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | pública | Vercel; GitHub Secrets (workers) | sim |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chave pública (cliente + RLS) | pública | Vercel | sim |
| `SUPABASE_SECRET_KEY` | chave de serviço (ignora RLS) para rotas de servidor e workers | **server-only** | Vercel; GitHub Secrets | sim |

## 2. Endereços e modo do aplicativo

| Nome | Uso | Visibilidade | Configurar em | Obrigatória |
|---|---|---|---|---|
| `AXION_APP_BASE_URL` | URL base para links absolutos em e-mails (botões, CONSULTAR IA); em produção o código **falha sem ela** (`lib/app-base-url.ts`) | server-only | Vercel | sim em produção |
| `NEXT_PUBLIC_APP_URL` | URL pública do app (OAuth/redirects) | pública | Vercel | a confirmar |
| `ACC_SSMA_PWA_URL` | URL do app de campo para QR/link de instalação; sem ela usa `AXION_APP_BASE_URL` + `/ssma`; sem nenhuma, a tela avisa e não gera QR | server-only | Vercel | opcional |
| `NEXT_PUBLIC_ACC_TEST_MODE` | banner/modo de teste | pública | Vercel | opcional |
| `ACC_WEEKLY_REPORTS_ENABLED` | liga o processamento de relatórios semanais | server-only | Vercel / GitHub | opcional |

## 3. Saída de e-mail e modo piloto

| Nome | Uso | Visibilidade | Configurar em | Obrigatória |
|---|---|---|---|---|
| `ACC_OUTBOUND_MODE` | só o valor exato `production` libera envio externo; qualquer outro = **piloto** (tudo vai para a caixa piloto com prefixo `[TESTE CONTROLADO]`). **Não alterar sem decisão explícita** | server-only | Vercel | sim (define o modo) |
| `ACC_PILOT_RECIPIENT` | destinatário efetivo do piloto | server-only | Vercel | em piloto |
| `ACC_PILOT_ADDITIONAL_RECIPIENTS` | extensão controlada da allowlist (mesmo domínio corporativo) | server-only | Vercel | opcional |
| `AXION_EMAIL_PROVIDER` | seleção do provedor de envio | server-only | Vercel | a confirmar |
| `GOOGLE_GMAIL_SENDER_EMAIL` | remetente das mensagens | server-only | Vercel | a confirmar |

## 4. Agendamentos (Cron)

| Nome | Uso | Configurar em |
|---|---|---|
| `CRON_SECRET` | autentica `/api/cron/*` (inclui `alert-reminders` e lotes); **fail-closed** | Vercel **e** GitHub Secrets (workflows `alert-reminders`, `contract-alert-batches`) |
| `ACC_RISK_ALERTS_CRON_SECRET` | segredo dedicado do ciclo de alertas de risco | Vercel e GitHub Secrets (`weekly-schedule-email-ingestion`) |

Agendadores reais (nomes de arquivo, agenda lida do repositório): Vercel (`apps/web/vercel.json`: `weekly-alert-digest` quartas 10:00 UTC, `system-health` diário 10:30 UTC) e GitHub Actions (tabela da seção 9).

## 5. Google — Gmail

| Nome | Uso | Configurar em |
|---|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` / `GOOGLE_GMAIL_CLIENT_SECRET` / `GOOGLE_GMAIL_REFRESH_TOKEN` | OAuth do envio Gmail pelo app | Vercel |
| `GOOGLE_GMAIL_INBOUND_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MAILBOX` | leitura da caixa de entrada oficial (ingestão semanal, respostas) | Vercel; GitHub Secrets |
| `ACC_RISK_ALERTS_INBOUND_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MAILBOX` | OAuth dedicado para respostas aos alertas de risco | Vercel; GitHub Secrets |
| `GOOGLE_GMAIL_REYNALDO_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | credenciais usadas só pelo workflow `gmail-inbound-sync` | GitHub Secrets |

Os arquivos `client_secret_*.json` na raiz do repositório local são **credenciais OAuth locais, não versionadas** (ver `guia-configuracao-e-recuperacao.md`, seção "Arquivos que só existem neste computador"). Recriar/obter pelo Google Cloud Console, nunca pelo Git.

## 6. Google — Drive (SSMA)

| Nome | Uso | Configurar em |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | leitura da pasta SSMA/ESG (somente leitura) | Vercel; GitHub Secrets (`ssma-drive-photo-sync`) |

## 7. IA (somente servidor)

| Nome | Uso | Obrigatória |
|---|---|---|
| `ANTHROPIC_API_KEY` | chave do provedor real | só para IA real; **testes de rotina removem esta variável** (`scripts/lib/block-live-ai.mjs`) |
| `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS`, `ANTHROPIC_TIMEOUT_MS` | modelo, limite de tokens e timeout | opcionais |
| `AXION_AI_PROVIDER` | provedor padrão (`fake` simulado quando ausente) | opcional |
| `AXION_AI_PROVIDER_CEO`, `AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR`, `AXION_AI_PROVIDER_ESG_DIRECTOR` (e equivalentes por especialista) | provedor por especialista | opcionais |
| `ACC_ALLOW_LIVE_AI_TESTS` | habilita o teste de IA real (`npm run test:live-ai`) — **nunca** em rotina/CI | só desenvolvimento |

Onde configurar: Vercel (produção). Custo: não existe orçamento por usuário; só o limite de tokens do provedor e 2000 caracteres por pergunta na consulta (docs/testes-sem-ia-real.md, resumo da frente de consulta).

## 8. Integrações externas (workers)

| Nome | Serviço | Configurar em |
|---|---|---|
| `CONSTRUMANAGER_BASE_URL`, `CONSTRUMANAGER_LOGIN`, `CONSTRUMANAGER_PASSWORD` | Construmanager | GitHub Secrets |
| `CONSTRUMANAGER_AUTO_KILL_SWITCH`, `_TIME_BUDGET_MS`, `_MAX_ITEMS`, `_MAX_FILE_BYTES`, `_DRY_RUN`, `_DOWNLOAD_ENABLED` | limites/chaves de segurança do worker | variáveis do workflow |
| `DIARIO_DE_OBRA_API_TOKEN`, `DIARIO_DE_OBRA_SYNC_ENABLED` | Diário de Obra | GitHub Secrets / variável do workflow |

## 9. Workflows e seus segredos (nomes)

| Workflow | Agenda (cron UTC) | Segredos usados |
|---|---|---|
| `alert-reminders` | `*/30 * * * *` | `CRON_SECRET` |
| `contract-alert-batches` | `10 10 * * 3` | `CRON_SECRET` |
| `document-processing-worker` | `*/5 * * * *` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` |
| `mpp-document-worker` | `*/5 * * * *` | idem |
| `gmail-inbound-sync` | `*/15 * * * *` | `GOOGLE_GMAIL_REYNALDO_*`, Supabase |
| `weekly-schedule-email-ingestion` | `20 * * * *` | `GOOGLE_GMAIL_INBOUND_*`, `ACC_RISK_ALERTS_*`, Supabase |
| `ssma-drive-photo-sync` | `0 */2 * * *` | `GOOGLE_DRIVE_*`, Supabase |
| `diario-de-obra-sync` | `43 0 * * *` | `DIARIO_DE_OBRA_API_TOKEN`, Supabase |
| `construmanager-content-ingestion` | `17 */6 * * *` | `CONSTRUMANAGER_*`, Supabase |
| `construmanager-credential-validation`, `construmanager-file-list-validation`, `diario-de-obra-api-validation` | manual (sem cron) | conforme o nome |
| `construmanager-monitoring-watchdog`, `diario-de-obra-monitoring-watchdog` | disparados por outros workflows | nenhum segredo próprio |

Workflows agendados só rodam a partir da branch padrão (`main`). O GitHub não garante pontualidade (observado ~2–5 h de intervalo real no sync do Gmail; ver `docs/alertas-recorrentes-e-providencias.md`).

## 10. Somente desenvolvimento/teste (não configurar em produção)

| Nome | Uso |
|---|---|
| `ACC_CLEAN_STACK_*` | stack Supabase local descartável (`scripts/sql/start-clean-local-stack.mjs`) |
| `ACC_*_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE`, `ACC_*_TEST_DB_CONTAINER`, `ACC_*_TEST_API_URL`, `ACC_CONCURRENCY_TEST_DATABASE_URL`, `ACC_SECDEF_AUDIT_*` | runners `scripts/sql/run-*-test.mjs`, que **recusam** container/URL que não sejam descartáveis |
| `CHROME_PATH` | capturas/medições com Chrome |
| `TZ`, `NODE_ENV`, `GITHUB_ACTIONS`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_EVENT_NAME` | ambiente/CI (automáticas) |
| `VERCEL_OIDC_TOKEN` | gerado por `vercel env pull` no `.env.local`; é temporário |

## Lacunas

- `apps/web/.env.example` tem todos os itens comentados e cobre só parte desta lista; vale completá-lo com os **nomes** acima (sem valores).
- Quais variáveis estão de fato definidas hoje na Vercel/GitHub não foi verificado (exige acesso aos painéis). Conferir cada linha "obrigatória/a confirmar" lá.

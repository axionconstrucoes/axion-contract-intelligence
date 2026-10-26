# Guia de configuração e recuperação — trabalhar o ACC em outro computador

> Complementa `docs/SETUP-NOVO-PC.md` (retomada em outro PC Windows) e as regras de `CLAUDE.md`.
> **Sem segredos aqui.** Nomes de variáveis em `variaveis.md`. Estado das frentes em `estado-das-frentes.md`
> e branches em `organizacao-de-branches.md`.
> **O ACC só está independente deste notebook depois que o fluxo completo for verificado em ambiente remoto**
> (veja "O que ainda não foi comprovado").

## 1. Pré-requisitos

| Item | Versão/observação (verificada no repositório) |
|---|---|
| Git | 2.x; acesso ao repositório `axionconstrucoes/axion-contract-intelligence` (remoto `origin`) |
| Node.js | **24.x** (todos os workflows usam `node-version: "24"`; `SETUP-NOVO-PC.md` cita 24.19.0). O repositório **não** tem `engines` nem `.nvmrc` |
| npm | 11.x (npm workspaces: `apps/*`, `packages/*`; `package-lock.json` na raiz). Use `npm ci` |
| Supabase CLI | vem em `node_modules/.bin/supabase(.cmd)` após `npm ci`; não precisa instalar global |
| Docker Desktop | **opcional** — só para o banco/Supabase local descartável (seção 6) |
| Vercel CLI | opcional (`npm i -g vercel`) — para `vercel link` / `vercel env pull` |
| Google Chrome | opcional — capturas e testes de navegador do SSMA (`CHROME_PATH`) |

## 2. Clonar e instalar

```powershell
git clone https://github.com/axionconstrucoes/axion-contract-intelligence.git
cd axion-contract-intelligence
git fetch --all --prune
git switch main            # ou a branch de trabalho combinada (ver organizacao-de-branches.md)
npm ci
```

`scripts/setup-new-pc.ps1` automatiza instalação e checagens no Windows (ver `docs/SETUP-NOVO-PC.md`).
Não copie a pasta `.git` entre computadores.

## 3. Variáveis de ambiente

1. Entre na conta da Vercel autorizada e vincule: `vercel login` → `vercel link` (a pasta `.vercel` **não** é
   versionada).
2. Gere o arquivo local com `vercel env pull apps/web/.env.local` — **não** envie `.env.local` por e-mail, chat
   ou pasta compartilhada; o arquivo é ignorado pelo Git (`.gitignore`: `.env*`).
3. Segredos dos workflows ficam em **GitHub → Settings → Secrets and variables → Actions**; não são lidos
   localmente. A lista por nome está em `variaveis.md`.
4. Para testes de rotina **não é necessária nenhuma chave de IA**; as suítes removem `ANTHROPIC_API_KEY` do
   ambiente de propósito (`docs/testes-sem-ia-real.md`).

### Arquivos que só existem neste computador (não versionados)

- `.env.local` na raiz e `apps/web/.env.local` — recriar com `vercel env pull`.
- `client_secret_*.json` na raiz — credenciais OAuth do Google. Estão fora do Git por uma regra em
  `.git/info/exclude`, que é **local a este clone e não vai para outro computador**. Não copie esses arquivos
  para o novo clone; obtenha/rotacione as credenciais no Google Cloud Console. **Recomendação (não aplicada):**
  acrescentar `client_secret_*.json` ao `.gitignore` versionado.
- `.vercel/`, `supabase/.temp/` (vínculos com projetos remotos) — refazer com `vercel link` / `supabase link`.
- Logs e rascunhos soltos na raiz (`next-dev-*.log`, `patch-*.py`, `diagnostico-*.txt`, `LEIA-ME-ANTES.txt`) e
  PDFs de contratos em `.claude/` — ver `pendencias.md`/`inventario.md` (outros documentos desta pasta); PDFs de
  contratos e dados pessoais **não** devem entrar no repositório.

## 4. Validar o checkout

```powershell
npx tsc --noEmit -p apps/web
npm run lint
npm test
npm run test:scripts
npm run test:email
npm run test:sql        # usa PGlite em memória (sem Docker)
npm run test:ssma
npm run build
```

Todos os comandos de rotina carregam `scripts/lib/block-live-ai.mjs` e **não chamam provedores de IA reais**.
Resultado de referência na última rodada: tsc limpo; lint 0 erros (12 avisos antigos); `npm test` 8/8; as
quatro suítes com exit 0; build ok.

## 5. Rodar localmente

```powershell
npm run dev        # next dev --turbopack em http://localhost:3000
```

Precisa das variáveis do Supabase (URL, chave publicável) em `apps/web/.env.local`. Para não tocar em dados
reais, prefira um Supabase local descartável (seção 6) ou um projeto de teste.

## 6. Banco local descartável (opcional)

- **Rápido, sem Docker:** `npm run test:sql` (PGlite). Inclui `scripts/test-migrations-full-replay.mjs`, que
  reaplica **todas** as migrations em ordem numa base descartável. É validação **parcial** (stub do Supabase; sem
  GoTrue/Storage/extensões).
- **Completo, com Docker:** `node scripts/sql/start-clean-local-stack.mjs up` sobe um stack
  `acc-disposable-clean` (portas 57xxx, containers `supabase_*_acc-disposable-clean`) com as migrations em ordem e
  o bootstrap de privilégios; `node scripts/sql/run-clean-stack-auth-storage-check.mjs` verifica Auth/RLS/Storage;
  `... down` remove tudo. O script recusa nomes que não comecem com `acc-disposable-` e nunca usa `link`,
  `db push` ou `--linked`.
- **Por que o bootstrap existe:** `docs/migration-privilegios-inicializacao-limpa.md` (a migration
  `20260920170000` assume privilégios-padrão do projeto hospedado; stacks limpos falham sem o bootstrap).
- Detalhes e identificação dos bancos locais: `docs/banco-de-teste-local.md`.

## 7. Migrations: ordem e aplicação

- 117 arquivos em `supabase/migrations/` (+ 1 não versionada, veja abaixo). O Supabase registra só versão/nome,
  **sem hash**: nunca edite migration já aplicada.
- **Pendentes desta frente (preparadas, não aplicadas em nenhum banco real), nesta ordem:**
  1. `20261027120000_alert_followups.sql`
  2. `20261027130000_project_delivery_items.sql`
  3. `20261027140000_alert_batch_partial_responses.sql` (depende das tabelas de lote `20260921130000`)
  4. `20261027150000_delivery_item_respond.sql`
  5. `20261027160000_delivery_end_date_change_history.sql`
  6. `20261028120000_risk_classification_reviews.sql`
  7. `20261028130000_ssma_field_records.sql`
- **Atenção:** `supabase/migrations/20261014190000_create_project_workspace.sql` (frente "Novo projeto") está
  **sem versionar** neste computador. Se for liberada, entra **antes** da lista acima; se não, ficou de fora
  (verificar dependências antes).
- Como aplicar (somente com autorização e contra o projeto CERTO):
  ```powershell
  npx supabase login
  npx supabase link --project-ref <ref-do-projeto>     # confirmar o ref no painel; não usar o de produção sem decisão
  npx supabase migration list                          # compara local × remoto
  npx supabase db push --dry-run                       # ver o que seria aplicado
  ```
  Só então `db push`, depois das verificações da seção 8. Se `migration list` mostrar versão local **anterior**
  à última do remoto, `db push` exige `--include-all` — pare e reavalie.

## 8. Implantação

- **Produção:** `https://acc.axion.com.br` (Vercel). O repositório tem `apps/web/vercel.json` (crons
  `weekly-alert-digest` e `system-health`); não há `vercel.ts`. O fluxo de deploy exato (integração Git da Vercel ×
  `vercel deploy`) **não está documentado no repositório** — confirmar no painel da Vercel.
- **Workers e e-mails agendados:** GitHub Actions (`.github/workflows/*.yml`); só valem a partir da `main`.
- **Ordem sugerida** (detalhe em `organizacao-de-branches.md`): migrations em banco de teste → merge → migrations
  em produção (com autorização) → deploy do código → conferir variáveis → verificações abaixo.
- **Verificações posteriores:** login; abrir uma obra de teste; `/api/cron/*` sem `CRON_SECRET` responde recusa
  (fail-closed); página `/{projeto}/providencias`; `/alertas/consulta-ia/...` exige login; `/ssma` e
  `/ssma/offline`; envio de teste **somente em modo piloto** (`ACC_OUTBOUND_MODE` ≠ `production`) para a caixa
  piloto; workflows com execução manual (`workflow_dispatch`).

## 9. Recuperação — reabrir o projeto em outro computador autorizado

1. Contas e permissões (a pessoa responsável concede): GitHub (repositório), Vercel (projeto), Supabase (projeto),
   Google Cloud (OAuth, se for rotacionar credenciais).
2. Clonar, `npm ci`, `vercel link`, `vercel env pull`, validar (seção 4).
3. **Histórico de decisões** (está no repositório): `CLAUDE.md` (regras permanentes e arquitetura),
   `docs/` (alertas recorrentes, classificação de risco, PWA/SSMA, testes sem IA, banco de teste, roteiro de testes
   reais, ingestão semanal, e-mails) e o histórico de commits.
4. **O que NÃO está versionado e precisa ser replicado conscientemente:** a memória do Claude Code
   (`~/.claude/projects/.../memory`) — é por usuário/computador; as decisões duráveis estão em `CLAUDE.md` e
   `docs/`. Para o Claude Code em outro computador, abrir a pasta do repositório e pedir a leitura de `CLAUDE.md`
   e dos documentos desta pasta.
5. Pendências do trabalho local (não commitadas): ver `pendencias.md` e `inventario.md`.

## 10. O que ainda não foi comprovado

- Nenhum deploy, migration em banco real, e-mail real, nem acesso de outro computador foi testado nesta etapa.
- Quais variáveis estão realmente definidas na Vercel/GitHub; qual projeto Supabase corresponde a
  `acc.axion.com.br` (o `SETUP-NOVO-PC.md` cita o projeto `axion-contract-intelligence-dev`).
- O modo de deploy da Vercel (automático por branch ou manual).

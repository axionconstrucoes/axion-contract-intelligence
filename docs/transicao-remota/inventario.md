# Inventário para operar o ACC sem este notebook

> Levantamento **somente leitura** (Git, arquivos, `schtasks`). Não houve conexão ao Supabase remoto, ao
> GitHub, à Vercel nem a nenhum serviço; **nenhum valor de variável/credencial foi lido ou impresso** — só
> nomes. Onde o repositório não permite saber o estado remoto, está marcado **"verificar no painel"**.
> Data do levantamento: 2026-10-26, HEAD `feat/novo-projeto-acc`.

Legenda de destino: **GitHub** (repositório/Actions/Secrets), **Vercel** (hospedagem + env), **Supabase**
(banco/Auth/Storage), **Servidor** (configuração segura server-side), **Gerenciador de senhas** (fora do Git).

## 1. Git: branches, commits, worktrees, stash

Remoto único: `origin` = `https://github.com/axionconstrucoes/axion-contract-intelligence.git`.
`origin/main` = `ad6a7c3` (igual ao `main` local).

| Item | Onde está hoje | Onde precisa estar | Observação |
|---|---|---|---|
| **`feat/novo-projeto-acc`** (branch atual) | **Só neste computador** — sem upstream; **51 commits à frente de `origin/main`** | GitHub | **Todo o trabalho recente (alertas, providências, risco, consulta de IA, SSMA/PWA, migrations 20261027+, testes, docs) existe somente aqui.** É o item mais crítico da transição. Precisa de `git push -u origin feat/novo-projeto-acc` (autorização do dono). |
| `fix/gmail-ata-404` (worktree `...-gmail-ata-404`, `458c82a`) | Só local, +1 commit vs `origin/main` | GitHub (após revisão) | Correção isolada do worker de atas do Gmail. Não publicar junto com a branch principal sem decisão. |
| `prep/revert-xlsx-in-memory-read` (`4ac8ff2`) | Só local | GitHub (opcional) | Reversão preparada, **não aplicada**, do leitor de XLSX em memória. A branch contém também a cadeia anterior (35 commits); o commit exclusivo é o `4ac8ff2`. |
| `feat/schedule-mpp-extraction-recovery` (`70cd6e4`) | Local, +1 vs `origin/main`; o **stash** nasceu nela | GitHub (revisar) | Recuperação de extração de cronograma MPP. |
| `feat/rejection-escalation-governance` | Só local, +2 | Descartável se `-v2` (remota) já cobre | Versão `-v2` já está no remoto. Conferir antes de apagar. |
| `backup/contract-alert-batches-before-cleanup` | Só local, +2 | Manter como backup ou subir | Backup anterior a uma limpeza. |
| `fix/contract-alert-batch-email-copy` | Só local, +1 | Provavelmente superada por `...-final` (remota) | Conferir. |
| Branches só locais **sem commits próprios** (0 à frente) | Local | Nada a fazer | `chore/recover-remote-migrations`, `feat/construmanager-foundation`, `feat/global-test-mode-banner`, `feat/multi-document-upload`, `feat/pilot-email-recipient-guard`, `feat/user-management-and-brand-layout`, `fix/global-status-and-risk-colors`, `fix/medium-risk-color-blue`, `fix/vercel-franc-min-dependency`, `fix/web-runtime-dependencies`. |
| Demais ~48 branches `feat/*`/`fix/*` | Local **e** remoto (rastreadas) | GitHub | Histórico de entregas já publicadas; não há trabalho exclusivo local. |
| **Stash** `stash@{0}` "checkpoint-email-pilot-2026-09-23" | **Só neste computador** (stash não vai para o remoto) | Branch de arquivo no GitHub, se ainda for necessário | Conteúdo não inspecionado nesta tarefa. Para torná-lo portátil: criar uma branch a partir dele (`git stash branch`) **com autorização**, ou descartá-lo conscientemente. |
| Pendências na árvore de trabalho | Neste computador | Ver `pendencias.md` | 35 itens classificados; 28 viraram commits locais, o restante é local por escolha. |

Estado do `.git` que **não** é portátil: `.git/info/exclude` (regras só locais — ver §6), configuração de
usuário (`user.name=Axion Engenharia`, `user.email=reynaldo@axion.com.br`), `core.autocrlf=true`.

## 2. Workflows, workers e tarefas agendadas

Todos rodam em **GitHub Actions (`ubuntu-latest`) ou na Vercel — não dependem do notebook**. Nenhuma tarefa
agendada do Windows relacionada ao ACC foi encontrada (`schtasks /query`: nenhuma entrada com ACC/Axion/Gmail/
Claude/Supabase/Vercel). O que o notebook faz hoje é apenas **desenvolvimento e execução manual de scripts**.

| Função | Onde roda | Gatilho | Segredos/variáveis (nomes) | Observação |
|---|---|---|---|---|
| Sync Gmail de entrada | GitHub Actions `gmail-inbound-sync.yml` | `*/15 * * * *` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GOOGLE_GMAIL_REYNALDO_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}` | Intervalo real observado de ~2–5 h (GitHub não garante pontualidade). |
| Worker de documentos (PDF/DOCX/XLS) | `document-processing-worker.yml` | `*/5` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Extração/OCR de documentos. |
| Worker MPP | `mpp-document-worker.yml` | `*/5` | idem | Cronograma MPP. |
| Ingestão de relatórios semanais | `weekly-schedule-email-ingestion.yml` | `20 * * * *` + `vars.ACC_WEEKLY_REPORTS_ENABLED=='true'` | Supabase, `GOOGLE_GMAIL_INBOUND_*`, `ACC_RISK_ALERTS_INBOUND_*` | Só roda com a variável ligada. |
| Lotes de alertas de contrato | `contract-alert-batches.yml` | `10 10 * * 3` | `CRON_SECRET`; var `ACC_APP_BASE_URL` | Chama a rota `/api/cron/contract-alert-batches`. |
| **Lembretes recorrentes** | `alert-reminders.yml` | `*/30` | `CRON_SECRET`; var `ACC_APP_BASE_URL` | **Existe só nesta branch** — o agendamento só vale depois do merge na `main`. |
| Fotos do SSMA no Drive | `ssma-drive-photo-sync.yml` | `0 */2 * * *` | Supabase, `GOOGLE_DRIVE_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}` | Origem Drive (distinto do PWA de campo). |
| Construmanager (metadados) | `construmanager-content-ingestion.yml` (+ watchdog, validações manuais) | `17 */6 * * *` | Supabase, `CONSTRUMANAGER_{LOGIN,PASSWORD,BASE_URL}`; vars `CONSTRUMANAGER_*` | Validações são `workflow_dispatch`. |
| Diário de Obra | `diario-de-obra-sync.yml` (+ watchdog, validação) | `43 0 * * *` | Supabase, `DIARIO_DE_OBRA_API_TOKEN`; vars `DIARIO_DE_OBRA_{PROJECT_ID,OBRA_ID,SYNC_ENABLED}` | |
| Resumo semanal de riscos | **Vercel Cron** (`apps/web/vercel.json`) → `/api/cron/weekly-alert-digest` | `0 10 * * 3` | `CRON_SECRET` | |
| Saúde do sistema | **Vercel Cron** → `/api/cron/system-health` | `30 10 * * *` | `CRON_SECRET` | |
| Ciclo de alertas de risco | rota `/api/cron/risk-alerts` (chamada pelo workflow semanal) | — | `ACC_RISK_ALERTS_CRON_SECRET` | |

Não há daemon, serviço Windows nem worker permanente neste computador.

## 3. Migrations e banco

| Item | Situação | Destino |
|---|---|---|
| `supabase/migrations/` | **117 arquivos**. `origin/main` tem **109** (último: `20261011014500_email_project_scope_admin`). | Supabase (remoto) |
| 8 migrations só nesta branch | `20261014190000_create_project_workspace` (**antes só local/não rastreada, agora versionada**), `20261027120000`, `130000`, `140000`, `150000`, `160000`, `20261028120000_risk_classification_reviews`, `20261028130000_ssma_field_records` | Aplicar **em ordem** após revisão; **nenhuma foi aplicada** em banco real. |
| Estado do remoto | **Verificar no painel/`supabase migration list`** — o repositório não prova o que está aplicado. `supabase/.temp/project-ref` indica que esta cópia está **vinculada** a um projeto remoto (arquivo ignorado pelo Git). | — |
| Inicialização limpa | A migration `20260920170000` exige privilégios-padrão do projeto hospedado; ver `docs/migration-privilegios-inicializacao-limpa.md` (bootstrap fora do histórico). | Supabase novo/local |
| Bancos locais (Docker) | dev `supabase_db_axion-contract-intelligence` (95 migrations, porta 54322) e descartável (117, porta 56322). **Existem só neste notebook.** | Recriáveis a partir das migrations; **não** são fonte de verdade. |
| Dados reais (obras, e-mails, documentos, extrações) | Supabase remoto | Já remoto — nada a migrar. |

## 4. Arquivos, documentos e configuração

| Item | Hoje | Deve estar | Observação |
|---|---|---|---|
| Código do app (`apps/web`, `packages/*`) | Git (branch local) | GitHub | Ver §1. |
| Documentos/anexos de contratos (PDF, DOCX, XLSX) | **Supabase Storage** (bucket `project-documents`, privado) + registros no banco | Supabase Storage | O repositório **não** deve conter PDFs de contratos. |
| PDFs do contrato NEWPORT em `.claude/` (2 arquivos, ~66 MB) | **Só neste computador, não rastreados** | Supabase Storage (já é onde o ACC os lê) / gerenciador de arquivos da empresa | **Não versionar.** Ver `pendencias.md`. |
| Planilhas semanais (ex.: relatório WEG) | Caixa de e-mail → Supabase Storage via ingestão | Idem | Cópias em `Downloads` são artefatos locais. |
| Ícones/branding (`apps/web/public/branding`, `brand`) | Git | GitHub | Logos derivados por script versionado. |
| Skills do Claude Code (`.claude/skills/*`) | Git (3 `SKILL.md`) | GitHub | `.claude/settings.local.json` é local (ignorado). |
| Documentação (`docs/`, `CLAUDE.md`) | Git | GitHub | |
| `.vercel/` (vínculo com o projeto da Vercel) | **Só local**, ignorado | Recriar com `vercel link` | Contém IDs do projeto, não segredos. |
| `supabase/.temp/` | **Só local**, ignorado | Recriar com `supabase link` | Identifica o projeto remoto. |
| `.env.local` (raiz e `apps/web`) | **Só local**, ignorados | Vercel env / GitHub Secrets / gerenciador de senhas | Ver §5. |
| Saídas de dev (`.next/`, `node_modules/`, logs `next-dev-*.log`) | Local | — | Regeneráveis. |

## 5. Variáveis e credenciais necessárias (por NOME; nenhum valor foi lido)

`apps/web/.env.example` documenta `NEXT_PUBLIC_ACC_TEST_MODE`, `ACC_OUTBOUND_MODE` e `ACC_PILOT_RECIPIENT`
(o restante não está listado nele — **lacuna**: ver tabela). Usado no código (`process.env`) e/ou nos workflows:

| Nome | Escopo | Usado em | Deve estar em |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Público (build) | app web, workflows | Vercel env; `NEXT_PUBLIC_SUPABASE_URL` também em GitHub Secrets |
| `SUPABASE_SECRET_KEY` | **Servidor/segredo** | app (admin client), workers | Vercel env + GitHub Secrets |
| `NEXT_PUBLIC_APP_URL`, `AXION_APP_BASE_URL`, `ACC_APP_BASE_URL` | URL base | links de e-mail, cron, PWA | Vercel env; GitHub **Variables** (`ACC_APP_BASE_URL`) |
| `ACC_SSMA_PWA_URL` | URL do PWA (opcional) | tela de instalação/QR | Vercel env |
| `CRON_SECRET`, `ACC_RISK_ALERTS_CRON_SECRET` | **Segredo** | rotas `/api/cron/*` | Vercel env + GitHub Secrets |
| `ACC_OUTBOUND_MODE`, `ACC_PILOT_RECIPIENT`, `ACC_PILOT_ADDITIONAL_RECIPIENTS` | Guard de envio | `pilot-outbound-guard` | Vercel env (**só `production` libera destinatários reais**) |
| `AXION_EMAIL_PROVIDER` | Provedor de e-mail | envio | Vercel env |
| `GOOGLE_GMAIL_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/SENDER_EMAIL` | **Segredo** | envio de alertas | Vercel env |
| `GOOGLE_GMAIL_REYNALDO_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN` | **Segredo** | sync Gmail (Actions) | GitHub Secrets |
| `GOOGLE_GMAIL_INBOUND_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/MAILBOX` | **Segredo** | ingestão semanal / respostas | GitHub Secrets + Vercel env |
| `ACC_RISK_ALERTS_INBOUND_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/MAILBOX` | **Segredo** | respostas de alertas | GitHub Secrets (+ Vercel env) |
| `GOOGLE_DRIVE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN` | **Segredo** | sync de fotos SSMA (Drive) | GitHub Secrets + Vercel env |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS`, `ANTHROPIC_TIMEOUT_MS` | **Segredo** (chave) | especialistas de IA | Vercel env (nunca no navegador) |
| `AXION_AI_PROVIDER`, `AXION_AI_PROVIDER_CEO/COMMERCIAL_DIRECTOR/ESG_DIRECTOR` | Config | seleção de provedor (`fake` por padrão sem chave) | Vercel env |
| `CONSTRUMANAGER_BASE_URL/LOGIN/PASSWORD`; vars `CONSTRUMANAGER_*_ENABLED`, `CONSTRUMANAGER_AUTO_KILL_SWITCH` | **Segredo**/config | workers Construmanager | GitHub Secrets/Variables |
| `DIARIO_DE_OBRA_API_TOKEN`; vars `DIARIO_DE_OBRA_{PROJECT_ID,OBRA_ID,SYNC_ENABLED}` | **Segredo**/config | sync Diário de Obra | GitHub Secrets/Variables |
| `ACC_WEEKLY_REPORTS_ENABLED` (var) | Config | ingestão semanal | GitHub Variables |
| `NEXT_PUBLIC_ACC_TEST_MODE` | Público | faixa "SISTEMA EM TESTE" | Vercel env |
| `VERCEL_OIDC_TOKEN` (em `.env.local` da raiz) | Gerado pela Vercel | CLI local | Local; regenerável com `vercel env pull` |
| Somente testes/ferramentas locais | — | `ACC_ALLOW_LIVE_AI_TESTS`, `ACC_*_TEST_DB_CONTAINER`, `ACC_*_I_UNDERSTAND_THIS_IS_DISPOSABLE`, `ACC_CLEAN_STACK_*`, `CHROME_PATH` | Não precisam existir em produção |

Arquivos de credencial **locais** que não podem ir ao Git: `client_secret_*.json` (2 arquivos OAuth do Google na
raiz, ignorados) — guardar no gerenciador de senhas; sem eles não se refaz a autorização do Gmail
(`scripts/gmail-inbound-oauth.mjs`, `scripts/autorizar-gmail-reynaldo.mjs`).

## 6. Dependências locais conhecidas (visão geral; detalhe em `dependencias-locais.md`)

| Item | Natureza | Observação |
|---|---|---|
| `.git/info/exclude`: `*.backup-*`, `patch-*.py`, `fix-formalizedVariation.py`, `next-dev-*.log`, `client_secret_*.json`, `scripts/autorizar-gmail-reynaldo.mjs`, `.claude/settings.local.json` | **Só neste computador** | Em outro computador os backups/patches não existem e **não aparecem** — mas se forem copiados, o Git os mostraria. Regras portáteis relevantes foram adicionadas ao `.gitignore`. |
| 50 `patch-*.py` na raiz e 47 arquivos `*.backup-*` (12 deles em `scripts/`) | Artefatos de desenvolvimento (outubro/2026) | Não são necessários à operação; sem efeito em produção. |
| `scripts/autorizar-gmail-reynaldo.mjs` | Ferramenta de OAuth (sem segredos no arquivo) | Excluída localmente; lê `client_secret_reynaldo.json` e grava refresh token em `.env.local`. Decidir se vira script versionado. |
| `scripts/generate-alert-email-preview.mjs` | Dev | Grava prévias em `C:\Users\User\axion-acc-previews`. |
| `scripts/lib/cdp-chrome.mjs` | Dev | Usa `CHROME_PATH` ou o caminho padrão do Chrome no Windows. |
| `scripts/setup-new-pc.ps1` | Dev | Assume `C:\VIBE\PROJETOS`. |
| `scripts/**/*.mjs` com `--env-file=apps/web/.env.local` | Ferramentas manuais (análise, reprocessamento) | Exigem o `.env.local`; em produção os equivalentes rodam nos workflows com Secrets. |

## 7. Scripts

- **204** `.mjs` em `scripts/` (**164 testes** `test-*.mjs`) e **18** em `scripts/sql` (runners/ferramentas de banco descartável).
- **Operacionais (rodam em produção via Actions):** `gmail-inbound-sync.mjs`, `gmail-ata-ingestion-worker.mjs`, `construmanager-*-worker.mjs`, `diario-de-obra-sync-worker.mjs`, `sync-ssma-drive-photos.mjs` e os workers de documento/MPP (`document-extractors.mjs`, `extract-mpp.py`, `extract-xls.py`).
- **Ferramentas manuais de manutenção:** `analyze-event-*.mjs`, `detect-clause-candidates.mjs`, `process-document-version.mjs`, `retry-email-attachment-drive-sync.mjs`, `gmail-*-backfill/ingest/oauth.mjs`, `configure-*.mjs`.
- **Somente desenvolvimento/teste:** `test-*.mjs`, `scripts/sql/*`, `generate-*`, `derive-acc-logo-inverted.mjs`.
- Há 12 arquivos `scripts/*.backup-*` ignorados (resíduos de edição).

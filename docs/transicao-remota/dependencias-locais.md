# Dependências locais — auditoria (itens 2 e 3 da transição remota)

> Auditoria feita sobre o código do repositório (apps/web, packages, scripts, `.github/workflows`,
> `apps/web/vercel.json`) em 26/10/2026, **sem acessar produção, sem credenciais e sem chamadas pagas**.
> Tudo que depende de confirmação no ambiente real (Vercel, Supabase, GitHub) está marcado "confirmar".
> **Este documento não declara o ACC independente do notebook**: isso só se confirma com o fluxo completo
> num ambiente remoto, acessado de outro computador.

## 1. Resumo dos achados

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | O código de produção (`apps/web`, `packages`) **não** tem caminho absoluto deste notebook, nem lê `.env.local`; só usa `process.cwd()` para o logo (incluído no bundle por `outputFileTracingIncludes`). | — | Verificado por varredura e por teste (`test-no-local-absolute-paths`). |
| 2 | **A branch `feat/novo-projeto-acc` (43 commits à frente de `origin/main`) e `fix/gmail-ata-404` só existem neste notebook** (sem upstream), além de 35 arquivos pendentes e 1 stash. | **Alta** | Pendência: publicar as branches (decisão sua; nenhum push feito). Detalhe no inventário. |
| 3 | O workflow `alert-reminders.yml` (lembretes recorrentes) **não existe em `main`**; as migrations de lembretes, providências, risco e SSMA (8 a mais que as 109 de `main`) também só existem aqui. | Alta | Só passam a valer após merge e aplicação em ordem. |
| 4 | Credenciais OAuth `client_secret_*.json` ficam na raiz do repositório e eram ignoradas **só** por `.git/info/exclude` (arquivo local deste computador). Em outro computador um `git add .` as versionaria. | Média | **Corrigido:** regra versionada em `.gitignore` (`client_secret_*.json`, `next-dev-*.log`) + teste. |
| 5 | Scripts de desenvolvimento com caminhos absolutos do usuário: `autorizar-gmail-reynaldo.mjs` (`C:/VIBE/...`) e `generate-alert-email-preview.mjs` (+ teste) (`C:\Users\User\...`). | Média (só dev) | **Corrigido** (nota: `autorizar-gmail-reynaldo.mjs` está excluído do Git por `.git/info/exclude` deste computador, ou seja, só existe aqui; a versão corrigida é portátil, mas não é versionada — decidir se entra no repositório): caminhos relativos à raiz do repositório / pasta temporária, com variáveis de ambiente para trocar. |
| 6 | O token Gmail gerado por `autorizar-gmail-reynaldo.mjs` é gravado em `apps/web/.env.local` (arquivo local). Em produção os tokens vivem em segredos do GitHub Actions e variáveis do Vercel. | Média | Procedimento documentado; confirmar que os segredos estão cadastrados (nomes na seção 5). |
| 7 | `AXION_APP_BASE_URL` (usada pelo app para montar links de e-mail) e `ACC_APP_BASE_URL` (variável do GitHub usada pelos workflows para chamar os crons) são **duas variáveis diferentes** com o mesmo endereço. Esquecer uma quebra links de e-mail ou os crons. | Média | Documentado; confirmar as duas. |
| 8 | Custo de minutos do GitHub Actions: `document-processing-worker` e `mpp-document-worker` rodam a cada 5 min e `gmail-inbound-sync` a cada 15 min ≈ 8.640 + 8.640 + 2.880 execuções/mês (cada uma cobra ao menos 1 min). Em repositório privado o plano gratuito inclui 2.000 min/mês. | Média | Estimativa pelo `cron`; **confirmar o plano** do GitHub. |
| 9 | Um worker falho no GitHub Actions só aparece como execução vermelha; não há alerta ativo por e-mail para o job de documentos. | Baixa | Existem watchdogs para Construmanager/Diário de Obra; para documentos/MPP é pendência. |
| 10 | Ferramentas de captura (Chrome em `C:/Program Files/...`) e `setup-new-pc.ps1` (`C:\VIBE\PROJETOS`) são de desenvolvimento no Windows, com `CHROME_PATH`/`-TargetRoot` como alternativa. | Baixa | Mantidas como exceção documentada. |

## 2. Produção × desenvolvimento, por função

Legenda de "onde roda": **Vercel** (app Next.js + `crons` do `apps/web/vercel.json`), **GH Actions** (workflows
agendados), **Supabase** (Postgres, Auth, Storage), **Notebook** (somente aqui).

| Função | Produção ou dev | Onde roda hoje | Depende deste notebook? | Falha e estado | Limites / custos |
|---|---|---|---|---|---|
| Upload de documentos e anexos | Produção | App (Vercel) → Supabase Storage (`project-documents`), registro em `document_versions` | **Não** (sem disco local; ver nota de `/tmp`) | `processing_status` (`AWAITING_PROCESSING` → `PROCESSED`/`FAILED` + `processing_error`) | 50 MB por arquivo (`MAX_FILE_SIZE_BYTES`) e limite do bucket; armazenamento Supabase |
| Extração de texto / OCR / cláusulas | Produção | **GH Actions** `document-processing-worker` (5 min, 20 min de timeout) → `scripts/process-document-version.mjs`; revisão de cláusulas no app (Vercel) | **Não** (precisa de Node 24, Python 3.12 + `xlrd`; OCR com tesseract.js e canvas nativo no runner) | Falha grava `FAILED` + evento de auditoria `DOCUMENT_PROCESSING_FAILED`; sem limite de tentativas automático (a versão fica `FAILED` até reprocesso manual) | Até 50 documentos por rodada; minutos do GitHub (item 8 acima) |
| Cronograma `.mpp` | Produção | **GH Actions** `mpp-document-worker` (5 min; Java 21 + `mpxj` 16.7 + `JPype1`) | **Não** | Mesma rotina de status do documento | Idem; 20 min de timeout |
| Relatórios semanais / XLSX | Produção | **GH Actions** `weekly-schedule-email-ingestion` (a cada hora, só com `ACC_WEEKLY_REPORTS_ENABLED=true`) + passo de alertas de risco via `/api/cron/risk-alerts` | **Não** (Gmail inbound por segredos) | Estado em tabelas de ingestão; fail-closed pela variável; guarda de tamanho real do XLSX | Arquivo 50 MB; descompactado até 256 MB (128 MB por parte); leitura em memória só até 2 MB; usa `/tmp` do runner |
| Gmail — leitura (inbound) | Produção | **GH Actions** `gmail-inbound-sync` (15 min) → `scripts/gmail-inbound-sync.mjs` e worker de atas | **Não** (refresh token em segredo do GitHub; **não** em `.env.local`) | Até 7 tentativas com espera exponencial por chamada; 404 classificados | Cota da API Gmail |
| Gmail — envio de alertas | Produção | App (Vercel) com `GOOGLE_GMAIL_*` | **Não** | Lote com estados `PENDING/SENT/FAILED`; modo piloto fail-closed (`ACC_OUTBOUND_MODE`) | Cota do Gmail |
| Recorrência de alertas | Produção | **GH Actions** `alert-reminders` (30 min) → `POST /api/cron/alert-reminders` (`CRON_SECRET`) + `contract-alert-batches` (semanal) + Vercel crons (`weekly-alert-digest`, `system-health`) | **Não**, mas `alert-reminders.yml` **só existe nesta branch** | Claim com lease, `failure_count`, eventos `REMINDER_FAILED` | `maxDuration` 300 s; agendador do GitHub atrasa 2–5 h (documentado) |
| Consulta aos especialistas de IA | Produção | App (Vercel), servidor, `ANTHROPIC_*` | **Não** (chave só no servidor) | Erro seguro sem vazar detalhe; resposta truncada recusada | **Custo por token** (Anthropic); `ANTHROPIC_MAX_TOKENS`, `ANTHROPIC_TIMEOUT_MS`; pergunta ≤ 2000 caracteres; sem orçamento por usuário. Nenhuma chamada paga foi feita nesta auditoria |
| SSMA/PWA, fotos, fila e sincronização | Produção | PWA no celular (fila IndexedDB) → RPCs/Storage do Supabase; painel no ACC (Vercel) | **Não** | Estados no aparelho (salvo/aguardando/sincronizado/falha) e idempotência por id de cliente | JPG/PNG ≤ 15 MB, ≤ 20 por registro; Storage Supabase |
| Fotos do SSMA no Drive | Produção | **GH Actions** `ssma-drive-photo-sync` (2 h, `GOOGLE_DRIVE_*`) | **Não** | Exit code do job | Cota da API do Drive |
| Construmanager / Diário de Obra | Produção (monitoramento) | **GH Actions** (`diario-de-obra-sync` diário; Construmanager só `workflow_dispatch`, sem `schedule`, interruptores `*_ENABLED`) + watchdogs | **Não** | Watchdogs, interruptores fail-closed | Timeouts de 10–20 min |
| Configurações de obras, colaboradores, riscos e prazos | Produção | Postgres (Supabase) | **Não** | Histórico em tabelas de eventos/auditoria | — |
| Migrations e implantação | Produção/dev | `supabase/migrations` (117 arquivos aqui; 109 em `main`); Vercel faz o deploy do `apps/web` | **Não**, mas as 8 migrations novas e o workflow só existem nesta branch | Ordem documentada | Aplicar em ordem; ver `docs/migration-privilegios-inicializacao-limpa.md` |
| Logo dos e-mails | Produção | Arquivos em `public/branding` lidos com `fs` | Não | `null` se ausente (e-mail sai sem imagem) | Incluídos no bundle por `outputFileTracingIncludes` (confirmar na primeira implantação) |
| Ferramentas de captura, previews, backup, `setup-new-pc.ps1`, `autorizar-gmail-*.mjs`, `scripts/test-*` | **Somente desenvolvimento** | Notebook | Sim, por natureza | — | — |

### Nota sobre disco local em produção
O app (Vercel) só escreve em disco no `construmanager/download-content.ts` e em `read-workbook.ts` (ambos usam
`os.tmpdir()`, que no Vercel é `/tmp` efêmero — e hoje rodam nos workflows do GitHub, não em rotas do app).
Não há escrita em disco local do notebook em nenhuma rota de produção.

## 3. Correções implementadas

| Assunto | Arquivos | Teste |
|---|---|---|
| Credenciais OAuth e logs locais deixam de depender de `.git/info/exclude` | `.gitignore` | `scripts/test-no-local-absolute-paths.mjs` |
| Caminhos absolutos removidos das ferramentas de desenvolvimento | `scripts/autorizar-gmail-reynaldo.mjs` (`ACC_GMAIL_CLIENT_SECRET_FILE`, `ACC_ENV_FILE`), `scripts/generate-alert-email-preview.mjs` e `scripts/test-generate-alert-email-preview.mjs` (`ACC_PREVIEW_OUT_DIR`, padrão: pasta temporária) | idem; `test-generate-alert-email-preview` 6/6 |
| Guarda contra regressão (caminhos de usuário, workflows dependentes de arquivo local, `.gitignore`) | `scripts/test-no-local-absolute-paths.mjs`, `package.json` (`test:scripts`) | roda em `test:scripts` |

Nenhum agendamento, segredo ou configuração remota foi criado ou alterado.

## 4. Pendências para disponibilizar remotamente (sem ativar nada nesta etapa)

1. Publicar `feat/novo-projeto-acc` (e a decisão sobre `fix/gmail-ata-404`) — único repositório com esse trabalho é este notebook.
2. Revisar e commitar (ou descartar com decisão sua) os 35 arquivos pendentes antes de qualquer publicação.
3. Após merge: o workflow `alert-reminders` passa a existir em `main`; só então criar/conferir `CRON_SECRET` e `ACC_APP_BASE_URL` (GitHub) e `AXION_APP_BASE_URL` (Vercel).
4. Aplicar as 8 migrations novas em banco de teste real e depois produção, na ordem do guia (decisão da migration `20260920170000` em aberto).
5. Confirmar no GitHub: plano e minutos disponíveis (item 8) e se os segredos listados abaixo existem.
6. Criar alerta ativo para falha dos workers de documentos/MPP (item 9).
7. Testar o fluxo completo num ambiente remoto e acessá-lo de outro computador (único modo de declarar independência).

## 5. Segredos e variáveis por NOME (sem valores)

- **GitHub Actions (secrets):** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `ACC_RISK_ALERTS_CRON_SECRET`, `GOOGLE_GMAIL_REYNALDO_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN`, `GOOGLE_GMAIL_INBOUND_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN/_MAILBOX`, `ACC_RISK_ALERTS_INBOUND_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN/_MAILBOX`, `GOOGLE_DRIVE_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN`, `CONSTRUMANAGER_LOGIN/_PASSWORD/_BASE_URL`, `DIARIO_DE_OBRA_API_TOKEN`.
- **GitHub Actions (variables):** `ACC_APP_BASE_URL`, `ACC_WEEKLY_REPORTS_ENABLED`, `DIARIO_DE_OBRA_*`, `CONSTRUMANAGER_*_ENABLED`.
- **Vercel (server):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `AXION_APP_BASE_URL`, `ACC_OUTBOUND_MODE`, `ACC_PILOT_RECIPIENT`, `ACC_PILOT_ADDITIONAL_RECIPIENTS`, `AXION_EMAIL_PROVIDER`, `AXION_AI_PROVIDER`, `ANTHROPIC_API_KEY/_MODEL/_MAX_TOKENS/_TIMEOUT_MS`, `GOOGLE_GMAIL_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN/_SENDER_EMAIL`, `GOOGLE_DRIVE_*`, `CRON_SECRET`, `ACC_SSMA_PWA_URL`, `NEXT_PUBLIC_ACC_TEST_MODE`.
- Valores **nunca** no repositório. O inventário completo e o guia de configuração são mantidos em `variaveis.md` e nos guias de manutenção (outros trabalhos).

## 6. Não confirmado nesta auditoria
- Segredos e variáveis realmente cadastrados no GitHub/Vercel e plano de minutos.
- Comportamento do OCR (tesseract/canvas) no runner `ubuntu-latest` com documentos reais e tempo de processamento.
- Que o Vercel inclui os arquivos de `public/branding` e `pdfjs-dist` no bundle (a configuração existe e foi verificada localmente pelo rastreamento do Next).

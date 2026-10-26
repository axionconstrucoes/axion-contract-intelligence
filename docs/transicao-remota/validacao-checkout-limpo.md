# Validação em checkout limpo (simulação de um computador novo)

> Objetivo: provar que o que está **versionado** basta para instalar, validar e construir o ACC, sem depender de
> arquivos, scripts ou configurações que existam só no notebook atual. Esta validação **não** prova que o ACC já
> opera de forma independente do notebook: isso exige o fluxo completo num ambiente remoto e acesso a partir de
> outro computador (ver "O que continua dependendo de serviços reais ou aparelhos").

## Ambiente e método

- Clone: `git clone --no-hardlinks --branch feat/novo-projeto-acc <repositório local> <diretório novo e vazio>`,
  HEAD `bdc9ac3` (depois atualizado para `2cdd72f` com a correção descrita abaixo). `git status` limpo.
- Sem `.env*`, sem `client_secret*`, sem `.claude/` (só `.claude/skills`, que é versionado), sem `node_modules`
  e sem `.next` copiados. O ambiente do processo não tinha nenhuma variável de Supabase, Google, Anthropic,
  `CRON_SECRET`, `AXION_APP_BASE_URL` nem Vercel (conferido com `env | grep`).
- Windows 11, Node `v24.19.0`, npm `11.17.0` (o repositório não define `engines` nem `.nvmrc`; os workflows usam Node 24).
- Nenhum push, e-mail, chamada de IA, conexão remota ou uso de produção. Todos os comandos de teste rodaram com
  `env -u ANTHROPIC_API_KEY` e o guard `scripts/lib/block-live-ai.mjs` (0 ocorrências de `ACC_LIVE_AI_BLOCKED`).

## Resultados por etapa

| Etapa | Comando | Resultado | Tempo |
|---|---|---|---|
| Instalação | `npm ci` | exit 0 | 83 s |
| Tipos | `npx tsc --noEmit -p apps/web` | limpo | 25 s |
| Lint | `npm run lint` | 0 erros, 12 avisos antigos | 25 s |
| Build | `npm run build` (sem nenhuma variável de ambiente) | exit 0 | 60 s |
| Caminhos locais | `node scripts/test-no-local-absolute-paths.mjs` | 3/3 | — |
| Scripts | `npm run test:scripts` | exit 0 | 12 s |
| E-mails | `npm run test:email` | exit 0 | 4 s |
| Banco (PGlite) | `npm run test:sql` | exit 0 (após a correção abaixo) | 11 s |
| SSMA | `npm run test:ssma` (inclui IndexedDB e service worker reais em Chrome) | exit 0 | 13 s |
| Unitários do app | `npm test` | 8/8 | — |
| Arquivos fictícios | `run-fixtures.mjs` (abaixo) | 7/7 | — |
| Stack Supabase descartável | `start-clean-local-stack.mjs up`, verificação de Auth/RLS/Storage | 118 versões aplicadas, 8/8 | 65 s para subir |

Avisos do `npm ci`: 11 vulnerabilidades reportadas pelo `npm audit` (3 moderadas, 6 altas, 2 críticas; não tratadas
nesta etapa), pacotes depreciados transitivos (`inflight`, `glob@7`, `rimraf@2`, `lodash.isequal`) e
`allow-scripts`: 3 pacotes com scripts de instalação sem política (`core-js`, `tesseract.js`, `unrs-resolver`).
Nenhum impediu a instalação.

### Build sem variáveis de ambiente

O build passou **sem nenhuma variável**. Ou seja, nenhuma variável de ambiente é exigida em tempo de build; todas
as variáveis (Supabase, Google, e-mail, `CRON_SECRET`, `AXION_APP_BASE_URL` etc.) são exigidas só em execução
(falham fechado quando ausentes). A relação por nome está em `docs/transicao-remota/variaveis.md`.

## Falha encontrada e corrigida

- `scripts/test-clean-local-stack-config.mjs` falhou no clone: lia o `.sql` e o `.mjs` com `\r` porque o checkout em
  Windows com `core.autocrlf=true` converte as quebras de linha. O teste agora normaliza CRLF (como os demais).
  Commit `2cdd72f`. Em Linux/macOS o problema não ocorria; era uma dependência implícita do formato de linha.
- Não há `.gitattributes` no repositório. Recomendação (não aplicada): `* text=auto eol=lf` evitaria divergências
  entre computadores. Decisão sua, pois reescreve normalização de linhas.

## Arquivos referenciados que não vieram no clone

Nenhum arquivo ausente foi necessário: `tsc`, o build e todas as suítes passaram sem `ENOENT`.
`test-no-local-absolute-paths` confirma ausência de `C:\VIBE`, `C:\Users`, `AppData`, `Desktop`, `Downloads`,
dependência de `.env.local`/`client_secret` nos workflows e a regra versionada no `.gitignore`.

### Scripts `test-*.mjs` fora das suítes npm

Das 164 `scripts/test-*.mjs`, 46 estão ligadas às suítes (`test:*`). Rodei as outras 118 (exceto as de IA real) no clone
e na árvore original. **20 falham, e as mesmas 20 falham na árvore original**; portanto não são causadas por
arquivos ausentes no clone nem por esta frente (nenhuma falha é `ENOENT`). São expectativas antigas de interface ou
fixtures que não fazem parte de nenhuma suíte e que ninguém executa:

`test-brand-background`, `test-confrontation-review-note-amendment`, `test-construmanager-connection` (tenta conexão real
e é abortado pelo guard), `test-contractual-document-group-layout`, `test-dashboard-visual`,
`test-document-contractual-attachment-linkage`, `test-document-kind-card-appearance`, `test-document-kind-card-colors`,
`test-integrations-package`, `test-multi-document-upload`, `test-oauth-callback-preview-fix`, `test-pilot-delivery-override`,
`test-pilot-risk-alert-actions`, `test-pilot-risk-alert-audit`, `test-pilot-risk-alerts`, `test-sidebar-and-go-live`,
`test-ssma-app-foundation` (espera 11 telas; o app tem 12 e há outras expectativas antigas), `test-ssma-drive-only-source`,
`test-weekly-reports-feature-flag`, `test-weekly-schedule-email-ingestion` (`checkAsync is not defined`).

Os dois `test-ssma-*` fora das suítes (`app-foundation` e `drive-only-source`) falham por expectativa antiga, não pelo
PWA novo, cujos testes (`test:ssma`) passam. Não foram corrigidos aqui. Recomendação: ou migrar para as suítes
depois de atualizar, ou arquivá-los.

## Upload e processamento com arquivos fictícios (sem rede, sem banco, sem IA)

Script usado: `run-fixtures.mjs` (no scratchpad, não versionado), que gera os arquivos e importa os módulos de
produção do checkout limpo:

```
node --import ./scripts/lib/block-live-ai.mjs <script> <clone> <saída>
```

| Caso | Módulo de produção | Resultado |
|---|---|---|
| PDF de 1 página (639 B) | `extractDocumentText` (pdfjs-dist) | 64 caracteres, 1 página |
| DOCX (1,5 KB) | `extractDocumentText` (mammoth) | 88 caracteres |
| TXT | `extractDocumentText` | 48 caracteres |
| `.zip` | `extractDocumentText` | `UnsupportedDocumentFormatError` (nunca texto vazio silencioso) |
| PDF sem texto (equivale a digitalizado) | `extractDocumentText` | `EmptyDocumentTextError` |
| XLSX de 5 abas (10,5 KB; 5 fórmulas) | `readWorkbookSafely` | 5 abas, 5 fórmulas preservadas, 14 linhas por aba |
| XLSX corrompido | `readWorkbookSafely` | erro controlado |

Além disso, passam no clone: `test-contract-attachments`, `test-extraction-coverage`, `test-weekly-workbook-reader`
(planilhas sintéticas, caminhos em memória e streaming, ZIP falsificado) e `test-font-encoding-repair`.

## Fluxos de alerta, entrega e SSMA com serviços simulados

Todos passam no clone, dentro das suítes: `test-alert-*`, `test-contract-alert-batch*` (inclui o lote 3 de 4,
recorrência e execução atrasada), `test-delivery-*`, `test-risk-*`, `test-ssma-*` das suítes (regras, fila offline,
migration em PGlite, IndexedDB e service worker em Chrome, consulta de IA com provedor simulado, QR). A consulta de IA
usa só o provedor simulado.

## Stack Supabase local descartável (reprodutibilidade das migrations)

A partir do clone, com o Docker Desktop ativo:

```
node scripts/sql/start-clean-local-stack.mjs up   --name acc-disposable-clean --port 57320 --workdir <dir>
ACC_CLEAN_STACK_WORKDIR=<dir> ACC_CLEAN_STACK_DB_CONTAINER=supabase_db_acc-disposable-clean \
  ACC_CLEAN_STACK_I_UNDERSTAND_THIS_IS_DISPOSABLE=true node scripts/sql/run-clean-stack-auth-storage-check.mjs
node scripts/sql/start-clean-local-stack.mjs down --name acc-disposable-clean --workdir <dir>
```

- Ambiente identificado: containers `supabase_*_acc-disposable-clean`, API `127.0.0.1:57321`, banco `127.0.0.1:57322`.
  Os stacks de desenvolvimento (54322) e descartável antigo (56322) **não** foram tocados e continuam ativos.
- **PostgreSQL:** 118 versões registradas (bootstrap + 117 do repositório, incluindo as 7 pendentes e a
  `20261014190000_create_project_workspace`), 0 tabelas de `public` sem RLS, seed aplicado.
- **Auth (GoTrue):** health, signup/login com e-mails fictícios (sem SMTP), gatilho de perfil, JWT real via PostgREST.
- **RLS/Storage:** anon não lê projetos, cada usuário vê só a própria obra, RPC de SSMA aceita o membro e recusa o de
  outra obra, bucket `project-documents` privado, upload da própria obra permitido, de outra obra negado, download
  negado para outra obra e anon. Resultado 8/8.
- Limpeza: `down` executado, 0 containers e 0 volumes `acc-disposable-clean` restantes.

## O que continua dependendo de serviços reais ou aparelhos

Não foi possível (nem permitido) exercitar sem serviços reais:

- **OCR** (tesseract) e processamento de documentos no runner do GitHub Actions; só o caminho "sem texto → erro explícito"
  foi testado.
- **Supabase Storage real** do projeto (limites, políticas no remoto) e o banco remoto: só o stack local isolado.
- **Gmail** (OAuth, inbound, envio), **Google Drive**, Construmanager, Diário de Obra e agendamentos (GitHub Actions, crons
  da Vercel): dependem de segredos e de execução remota.
- **Consulta de IA real** e seu custo; `CRON_SECRET`, `ACC_APP_BASE_URL`, `AXION_APP_BASE_URL`, `ACC_SSMA_PWA_URL`.
- **Clientes de e-mail** (Gmail, Outlook, celulares) e **aparelhos** iPhone/Android para o PWA, câmera, fila offline
  e sincronização (roteiro em `docs/roteiro-testes-reais.md`).
- Implantação (Vercel), aplicação das migrations em banco de teste remoto e produção, e acesso a partir de outro
  computador: ver `docs/transicao-remota/guia-configuracao-e-recuperacao.md`.

## Conclusão

Um checkout limpo da branch instala, passa nos tipos, no lint, no build e em todas as suítes com serviços simulados, e
reproduz as 117 migrations num Supabase local isolado. A única dependência implícita encontrada foi o formato de
quebra de linha em um teste (corrigida). **Isto não torna o ACC independente do notebook:** a branch ainda não existe
no GitHub, e o fluxo completo em ambiente remoto não foi verificado.

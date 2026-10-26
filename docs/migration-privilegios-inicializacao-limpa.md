# Migration 20260920170000 e a inicialização limpa (privilégios-padrão)

> **Nada foi aplicado em remoto/produção.** Tudo foi testado em um stack Supabase local descartável
> (`acc-disposable-clean`, 127.0.0.1:57321/57322), criado e removido durante o teste.

## O problema (reproduzido num stack realmente limpo)

`supabase/migrations/20260920170000_harden_weekly_report_database_permissions.sql` (commit `d4a6f2c`,
2026-09-20) **só revoga** privilégios e termina com um bloco `DO $$` de auto-verificação. Esse bloco exige, por
exemplo, que `authenticated` ainda tenha `SELECT` nas 9 tabelas de `20260920120000`. Em produção isso é verdade
porque o projeto Supabase **hospedado** cria o schema `public` com `DEFAULT PRIVILEGES` do papel `postgres`
concedendo `ALL` a `anon`, `authenticated` e `service_role` (a própria migration documenta isso no cabeçalho).

Um stack local limpo (`supabase start` / `supabase db reset`) **não tem** esse padrão para o papel `postgres` em
`public` (verificado em `pg_default_acl`: só existem os padrões de `supabase_admin`). Resultado, reproduzido com
a CLI 2.114.0 e as 117 migrations do repositório:

```
Applying migration 20260920170000_harden_weekly_report_database_permissions.sql...
ERROR: hardening falhou: authenticated perdeu SELECT em project_weekly_schedule_ingestion_configs (SQLSTATE P0001)
```

Efeito: **nenhum ambiente novo** (dev local limpo, CI, projeto Supabase novo com padrões restritivos) consegue
chegar ao fim das migrations. O banco remoto existente não é afetado, porque a migration já foi aplicada nele.
(A migration `20260920031000_document_worker_service_role_grants` mostra que o projeto já teve de compensar o
mesmo desvio em outro ponto.)

## Como o projeto protege migrations já aplicadas

- A CLI do Supabase guarda em `supabase_migrations.schema_migrations` apenas `version`, `name` e `statements`
  (confirmado nas strings do binário local da CLI): **não há hash/checksum do conteúdo**. Editar um arquivo já
  aplicado **não é detectado** pela CLI e **não é reexecutado** no remoto — o remoto e o histórico divergiriam
  silenciosamente (o arquivo no Git diria uma coisa, o remoto teria rodado outra).
- Não há CI nem script no repositório que compare hash de migrations ou execute `db push` (grep em `.github/`,
  `scripts/`, `docs/`). A regra do projeto é de processo: não reescrever histórico aplicado.
- Ordem: a CLI recusa `db push` quando há migration local com versão **anterior** à última aplicada no remoto
  ("Found local migration files to be inserted before the last migration on remote database. Rerun the command
  with --include-all flag to apply these migrations").

## Opções

| | O que é | Prós | Contras / impacto |
|---|---|---|---|
| **A** | Editar a migration antiga (conceder `GRANT` antes dos `REVOKE`) | Conserta `db reset` sem passo extra | **Reescreve histórico aplicado**; remoto e Git passam a divergir sem detecção; viola a regra do projeto. Só efeito em bancos novos. |
| **B** | Nova migration com versão **anterior** (ex.: `20260920165900`) com `ALTER DEFAULT PRIVILEGES` | `db reset` funciona sem passo extra; histórico antigo intacto | No remoto a versão fica antes da última aplicada: o próximo `db push` **falha** até alguém rodar com `--include-all` (que também reaplicaria qualquer outra pendência fora de ordem). O conteúdo seria um no-op lá (o padrão já existe), mas o processo de deploy muda. Não recomendado sem decisão de quem faz o deploy. |
| **C** | **Bootstrap versionado fora das migrations**, injetado só na cópia de trabalho do stack descartável | Não toca o histórico nem o remoto; reproduz o estado do projeto hospedado; testável | Quem usa `supabase db reset` direto no diretório `supabase/` continua sem o bootstrap (precisa usar o script). |
| **D** | Nova migration **posterior** que reaplica os grants corretos | Seguro no remoto | **Não resolve**: a migration antiga continua falhando (e para o `supabase start`) antes de chegar à nova. Só serve como correção de estado em bancos já migrados. |

## Recomendação

**Opção C agora** (implementada, sem risco para o remoto) e **decidir B só se vocês quiserem que
`supabase db reset` funcione no diretório do repositório sem script** — ao custo de usar `--include-all` no
próximo `db push` de produção (a migration seria um no-op, mas a mudança de processo é de vocês). **Não usar A**.

## Solução preparada (Opção C)

- `scripts/sql/bootstrap-default-privileges.sql`: três `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
  public GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS TO anon, authenticated, service_role` (idempotente; espelha o
  projeto hospedado). **Não** está em `supabase/migrations/`.
- `scripts/sql/start-clean-local-stack.mjs up|down`: cria um diretório de trabalho **novo e vazio** com cópia
  das migrations, injeta o bootstrap como versão `00000000000001` (só na cópia), gera um `config.toml` com
  `project_id = acc-disposable-*` e portas 57xxx, e sobe só db + Auth + Storage + API. Guardas: nome obrigatório
  `acc-disposable-*`; porta base 57000+; recusa diretório com `.temp/project-ref`; nunca usa
  `link`/`--linked`/`db push`/`db remote`. `--no-bootstrap` reproduz a falha.
- `scripts/sql/lib/clean-stack-config.mjs` + `scripts/test-clean-local-stack-config.mjs` (6 casos, em `test:sql`).
- `scripts/sql/run-clean-stack-auth-storage-check.mjs`: verificação de Auth, RLS e Storage no stack descartável.

Como usar (Docker Desktop ligado; ver `docs/banco-de-teste-local.md`):

```
node scripts/sql/start-clean-local-stack.mjs up --name acc-disposable-clean --port 57320 --workdir <dir novo>
node scripts/sql/start-clean-local-stack.mjs down --name acc-disposable-clean --workdir <dir>
```

## Resultados no stack isolado (2026-10-26, CLI 2.114.0)

**Identificação antes de qualquer migration:** containers `supabase_{db,auth,storage,kong,rest}_acc-disposable-clean`;
API `127.0.0.1:57321`, banco `127.0.0.1:57322`; sem vínculo remoto; o stack de desenvolvimento (54322) e o
descartável antigo (56322) não foram tocados.

- **Sem o bootstrap:** falha em `20260920170000` (acima), reproduzido.
- **Com o bootstrap:** **118/118** versões aplicadas em ordem (bootstrap + as 117 do repositório).

**PostgreSQL**
- 0 tabelas de `public` sem RLS (117 tabelas, 147 policies); auto-verificação de `20260920170000` passa; as
  tabelas/funções/gatilhos das 7 migrations pendentes existem.
- `run-security-fix-authorization-test.mjs`: 19/19.
- `run-security-definer-search-path-audit.mjs`: 329 OK / **12 falhas** — **idênticas** no descartável antigo
  (56322), logo **não** causadas pelo bootstrap. Oito são funções antigas (`create_ssma_*`, `finalize_ssma_*`,
  `register_ssma_submission_photo`, `discard_unregistered_ssma_photo`, `can_upload_ssma_photo_object`,
  `submit_construmanager_*`). **Quatro são da migration nova `20261028130000_ssma_field_records`**
  (`can_upload_ssma_field_photo_object`, `ssma_field_record_submit`, `ssma_field_record_register_photo`,
  `ssma_corrective_action_update`): `SECURITY DEFINER` com `search_path = public[, storage]`, que a auditoria do
  próprio projeto rejeita. Ela ainda **não foi aplicada em lugar nenhum**: vale corrigir (`search_path = ''` com
  nomes qualificados) antes de aplicar. Não alterei, por ser trabalho de outra frente.
- Os runners com nome de container fixo (`run-single-active-contract-base-test`, `run-gerente-compat-…`)
  recusam outro container por desenho; não foram executados.

**Auth (GoTrue)**
- `/auth/v1/health` ok; signup e login com e-mails fictícios `@exemplo.invalid` (sem SMTP; confirmação desligada);
  o gatilho `on_auth_user_created` criou os perfis.
- PostgREST com **JWT real**: anon não lê projetos; cada usuário vê só a própria obra; INSERT direto em
  `ssma_field_records` e DELETE em `project_memberships` são negados; RPC `ssma_field_record_submit` aceita o
  membro, recusa membro de outra obra e `USER_MISMATCH`.

**Storage**
- Bucket `project-documents` existe e é privado. Upload da foto do registro em
  `{obra}/ssma-registros/{registro}/…` aceito para o autor; **negado** para o caminho da outra obra e para
  usuário de outra obra; download: autor baixa, usuário de outra obra e anon **não**.
- Os registros e usuários de teste foram removidos ao final (Storage pela API, pois o banco recusa `DELETE`
  direto em `storage.objects`).

## Limites

- Realtime, Studio, Analytics, Edge Runtime e e-mail local ficaram desligados no stack descartável.
- Não houve teste contra o projeto remoto (por desenho) e nenhuma migration foi aplicada em produção.
- A decisão entre B e C (e a correção do `search_path` da migration de SSMA) é sua.

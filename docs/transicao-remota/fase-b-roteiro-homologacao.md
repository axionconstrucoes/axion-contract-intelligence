# Fase B — Roteiro executável da homologação (Supabase separado + Preview isolado)

> **Estado:** preparado e testado **localmente**. Nenhum recurso externo foi criado e nenhuma variável foi alterada por este roteiro.
> Complementa `fase-b-homologacao-checklist.md` (o quê) com o **como**, em ordem. Itens **[AUTORIZAÇÃO]** mudam sistemas externos.
> Só nomes de variáveis aparecem aqui — nunca valores, refs reais ou connection strings.

## 0. Pré-requisitos já satisfeitos

- Variáveis Supabase de produção **fora do alvo Preview** (passo V1 executado em 27/10/2026): novos Previews não recebem credenciais Supabase.
- `npm run test:homologation` verde: trava de alvo, cópia de trabalho com todas as migrations e SQL de verificação (117 tabelas com RLS, funções `SECURITY DEFINER` com `search_path`).
- Ferramentas locais: `scripts/homologation/staging-guard.mjs`, `prepare-workdir.mjs`, `apply-migrations.mjs` e `scripts/sql/homologation/verify-staging.sql`.

## 1. Criar o projeto de homologação **[AUTORIZAÇÃO]**

1. Criar um projeto Supabase novo (nome sugerido: `acc-homologacao`), região e plano aprovados. Anotar o **project ref**.
2. Guardar, no cofre de senhas, a senha do banco e as chaves (URL, *publishable*, *secret*). **Nunca** no Git nem no chat.
3. Verificar que o ref é **diferente** do de produção.

## 2. Preparar o ambiente local (somente neste terminal, nada versionado)

```
ACC_HML_PROJECT_REF=<ref da homologação>
ACC_PROD_PROJECT_REF=<ref(s) de PRODUÇÃO, separados por vírgula>   # obrigatório: a trava recusa esses refs
ACC_HML_CONFIRM=STAGING-ONLY-NOT-PRODUCTION
HML_DB_URL=<connection string da homologação>                       # só variável de ambiente; nunca argumento
```

Regra de ouro: **não rodar `supabase link`, `--linked` nem `db push` sem `--db-url` neste repositório.** O checkout principal está vinculado à produção (`supabase/.temp/project-ref`); por isso a aplicação usa uma **cópia de trabalho** sem esse vínculo.

## 3. Aplicar as migrations (119, incluindo as de 29/10: lease da outbox e auditoria do worker)

1. **Plano (não conecta):** `node scripts/homologation/apply-migrations.mjs --workdir <dir-temporário>` — valida a trava (`staging-guard`), monta a cópia (`prepare-workdir`: 117 migrations + bootstrap de privilégios como versão `00000000000001`, **só na cópia**) e imprime o plano.
2. Conferir os privilégios-padrão do projeto novo (`pg_default_acl` em `public`). Se o projeto hospedado já concede `ALL` a `anon/authenticated/service_role`, o bootstrap é um no-op idempotente; se não, ele é o que evita a falha da migration `20260920170000` (ver `docs/migration-privilegios-inicializacao-limpa.md`, opção C).
3. **Aplicar:** repetir com `--apply` **[AUTORIZAÇÃO]** (executa `supabase db push --db-url ... --workdir ...`). Em um banco novo **não** é necessário `--include-all`; se o CLI pedir `--include-all`, **pare** e investigue (indica histórico fora de ordem).
4. Registrar o resultado (versões aplicadas) sem imprimir a connection string.

## 4. Verificar permissões e RLS (somente leitura)

Executar `scripts/sql/homologation/verify-staging.sql` no SQL Editor **do projeto de homologação**. Esperado:

| Verificação | Esperado |
|---|---|
| `tables_without_rls` | `-` (nenhuma) |
| `security_definer_without_empty_search_path` | `-` (nenhuma) |
| `public_tables` | 117 (conferir contra o replay local; as migrations 20261029* não criam tabelas) |
| `migration_history_rows` | 120 se o bootstrap foi aplicado (119 + bootstrap), ou 119 (confira `ls supabase/migrations`) |
| `storage_buckets` | `construmanager-content`, `project-documents` |
| `rls_tables_without_any_policy` | apenas `contract_alert_batch_dispatch_claims` (uso exclusivo do serviço, por desenho) |
| grants de `anon`/`authenticated` | informativos: o Supabase concede privilégios amplos; a proteção é a RLS |

## 5. Auth, Storage e dados fictícios **[AUTORIZAÇÃO]**

- Auth: provedor Google, `site_url` e `additional_redirect_urls` = URL do Preview de homologação; incluir o *callback* do projeto novo nos URIs autorizados do cliente OAuth.
- **Usuários simulados:** criar em Auth os 4 usuários com os ids e e-mails descritos no cabeçalho de `scripts/sql/homologation/seed-weg-staging.sql` (ids `5eed0001-0000-4000-8000-00000000000{1..4}`; e-mails `*.weg.teste@axion.com.br` e `colega.fora.allowlist@axion.com.br`). O seed **não escreve em `auth.users`** e recusa executar se os 4 não existirem. Confirmar na documentação do Auth Admin API se `createUser` aceita informar o `id`; se não aceitar, criar os usuários e ajustar os ids no seed antes de rodar.
- **Seed:** executar `scripts/sql/homologation/seed-weg-staging.sql` no SQL Editor **do projeto de homologação**. É idempotente, usa o prefixo `SIM-` (projeto `SIM-WEG-001`) e UUIDs `5eed…`, **recusa** qualquer banco com projeto sem o prefixo `SIM-` (proteção contra execução em produção) e não envia e-mails. Cria o projeto fictício WEG, 4 usuários/papéis (Responsável, Gestor, Diretoria e um fora da allowlist), matriz SLA com prazos reduzidos **apenas aqui**, contrato + aditivo, 5 cláusulas, 2 obrigações, 2 eventos, o override de entrega `crm@axion.com.br` com allowlist e confirmação do piloto, e as fontes dos alertas BAIXO, MÉDIO, ALTO e CRÍTICO. Validado por `npm run test:staging-seed` (SQL real em PGlite com o ciclo de alertas, as RPCs e o consolidado). Nada é copiado da produção.

## 6. Vercel **[AUTORIZAÇÃO]**

- V3: criar as variáveis da homologação (URL/chaves do projeto novo, `AXION_APP_BASE_URL` do Preview, `ACC_OUTBOUND_MODE=pilot`, `ACC_PILOT_RECIPIENT=crm@axion.com.br`, segredos de cron **novos**), restritas à branch de teste (`gitBranch`) ou a um *Custom Environment*. `AXION_EMAIL_PROVIDER` **ausente** (provider fake) até a etapa B3.
- V2: remover `CONSTRUMANAGER_*` e `ANTHROPIC_MODEL` do alvo Preview.
- Redeploy do Preview de homologação **[AUTORIZAÇÃO]** (deployments antigos mantêm as variáveis com que foram construídos; ver T1b).

## 7. Testes de isolamento

| # | Teste | Execução | Esperado |
|---|---|---|---|
| T1 | Preview sem credenciais de produção | Listar variáveis por alvo (nomes/metadados) | Nenhuma variável Supabase de produção em Preview |
| T1b | Deployments de Preview **antigos** | Listar previews; os criados antes da V1 ainda têm as credenciais antigas | Apagar/substituir (decisão do administrador) |
| T2 | Host do banco do Preview | Rota de diagnóstico que devolve só o *fingerprint* do ref (a implementar, com autorização) | = homologação, ≠ produção |
| T3 | Canário de escrita | Gravar linha marcada na homologação | Existe só lá |
| T4 | Produção intacta | Contagens somente-leitura antes/depois | Sem variação causada pelos testes |
| T5 | Modo de saída | Evento como admin no Preview | Aviso "Modo piloto ativo" |
| T6 | Provider fake | Ciclo com `?dryRun=1` e real | `provider = FAKE` |
| T7 | Destinatário único | 1 envio real (etapa B3) | Só `crm@axion.com.br`, `[TESTE CONTROLADO]` |
| T8 | Allowlist | Alerta a usuário fora da allowlist | `SUPPRESSED` |
| T9 | Crons de produção | Workflows do GitHub usam só segredos de produção | Nenhum toca a homologação |
| T10 | Respostas | Responder do e-mail de usuário cadastrado | Aceita uma vez; do `crm@` = `IGNORED_SELF` |
| T11 | Idempotência | Dois ciclos, simultâneos inclusive | Sem duplicidade |
| T12 | Reversão | Remover as variáveis da homologação | Preview deixa de funcionar; produção inalterada |

## 8. Reversão

- Remover as variáveis de homologação na Vercel e pausar/excluir o projeto Supabase novo **[AUTORIZAÇÃO]**. Nada na produção é tocado em nenhum passo; não há dados a restaurar.
- Se a V1 precisar ser desfeita, restaurar o alvo Preview das três variáveis (não recomendado: reabre o acesso à produção).

## 9. Limites do que foi testado

- A trava, a cópia de trabalho e o SQL de verificação foram testados localmente (PGlite com a plataforma Supabase simulada). **Não** foi executado `supabase db push` contra nenhum banco remoto, nem existe banco de homologação ainda.
- O PGlite não reproduz GoTrue, Storage real, `pg_cron`/`pg_net` nem os privilégios-padrão do projeto hospedado; por isso a verificação do passo 4 deve ser repetida no projeto real.
- `supabase db push --db-url` expõe a connection string na lista de processos da máquina local durante a execução; usar apenas em máquina de confiança.

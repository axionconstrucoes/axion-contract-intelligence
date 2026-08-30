# Procedimento de backup e restauração — ACC

Este documento descreve o procedimento correto para gerar um backup completo do banco Supabase remoto do ACC e restaurá-lo com segurança numa stack local descartável, incluindo a correção de um problema real de fidelidade de ACL descoberto e diagnosticado em 2026-08-30.

## O problema: ACL fica mais permissiva depois de restaurar

Restaurar um backup (`supabase db dump`) numa stack local nova reproduz o schema e os dados corretamente, mas **não reproduz fielmente as revogações de `EXECUTE` em funções `SECURITY DEFINER`** que várias migrations aplicam explicitamente contra `anon`/`authenticated`. Depois de restaurar, essas funções ficam **mais permissivas** do que no remoto real — nunca mais restritivas.

### Causa raiz (comprovada, não especulada)

Toda stack Supabase (local ou hospedada) tem, desde a criação do projeto, fora de qualquer migration:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

Confirmado idêntico nos dois lados via `pg_default_acl`. Toda `CREATE FUNCTION` nova em `public` já nasce com essas 3 roles podendo executá-la.

`supabase db dump` (schema-only) reconstrói a ACL de cada função usando o idioma padrão do `pg_dump`: `REVOKE ALL ... FROM PUBLIC;` seguido de `GRANT` só para quem deveria ter acesso. Isso funciona apenas se o alvo da restauração **não tiver privilégio default próprio** — porque `REVOKE ALL FROM PUBLIC` nunca atinge concessões feitas a `anon`/`authenticated` por nome (só ao pseudo-role `PUBLIC`). Como o alvo real (qualquer stack Supabase) sempre tem esse default, a concessão a `anon`/`authenticated` sobrevive intacta, mesmo depois do dump aplicar seu `REVOKE ALL FROM PUBLIC`.

O `pg_dump` não tem como saber que o alvo terá esse default — ele assume um Postgres "de fábrica", sem privilégios padrão nomeados.

### O que NÃO é a causa

- **Não é migration perdida.** Todo REVOKE historicamente aplicado no remoto está corretamente registrado numa migration já aplicada — confirmado função a função via `git log --all -S`/`-G` e leitura direta dos arquivos (algumas migrations quebram a assinatura da função em várias linhas, o que exige busca multi-linha, não grep de linha única).
- **Não é alteração manual/drift não rastreado.** Nenhum arquivo de migration foi apagado ou renomeado em nenhum ponto do histórico (`git log --all --diff-filter=D/R`).
- **É, também, uma lacuna real em migrations novas.** Três funções trigger (`audit_document_relation_created`, `audit_document_version_client_response_created`, `enforce_single_active_contract_base`) foram escritas sem nenhum REVOKE — corrigido diretamente nessas migrations (ainda pendentes, nunca aplicadas no remoto) em 2026-08-30, adicionando ACL de menor privilégio logo após cada `CREATE FUNCTION`.

## O procedimento corrigido

```
1. Capturar e SALVAR o pg_default_acl atual do alvo (nunca assumir
   um valor fixo — restaurar exatamente o que já havia).
2. ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM
   anon, authenticated, service_role;  (neutraliza temporariamente)
3. Restaurar, nesta ordem exata, sempre os 5 arquivos:
   roles.sql → schema.sql → history_schema.sql → data.sql
   (com session_replication_role = replica) → history_data.sql.
4. SEMPRE — sucesso ou falha em qualquer passo do meio — reinstalar
   o pg_default_acl salvo no passo 1.
5. Verificar: pg_default_acl do alvo == estado salvo no passo 1.
6. Comparar automaticamente a ACL de toda função de public contra um
   snapshot da ORIGEM (capturado no momento do backup, não
   consultado ao vivo — útil mesmo se o remoto estiver indisponível).
```

`ALTER DEFAULT PRIVILEGES` é persistente no catálogo (não é escopo de sessão) — por isso os passos 1 e 4 são obrigatórios, nunca opcionais, e o passo 4 precisa rodar mesmo em caminho de erro (implementado via `trap ... EXIT` no restaurador).

## Ferramentas

### `scripts/backup/capture-acl-snapshot.mjs`

Captura um snapshot de ACL — nunca inclui segredos, só metadados de permissão:

```bash
# da origem (remoto), read-only:
node scripts/backup/capture-acl-snapshot.mjs --linked --out origin-snapshot.json --backup-dir <pasta-do-backup>

# de um alvo local (container docker):
node scripts/backup/capture-acl-snapshot.mjs --container <nome> --out target-snapshot.json
```

Campos capturados por função: `schema`, `function_name`, `identity_args`, `owner`, `normalized_acl` (conjunto de roles com EXECUTE, sem o grantor), `security_definer`, `search_path`. Além disso: `pg_default_acl` do schema `public`, `postgres_version`, `project_ref`, `captured_at`, e (quando `--backup-dir` é passado) os SHA-256 dos 5 arquivos do backup, lidos do `checksums-sha256.txt` já existente — nunca recalculados, nunca alterando o backup original.

### `scripts/backup/compare-acl-snapshot.mjs`

```bash
node scripts/backup/compare-acl-snapshot.mjs origin-snapshot.json target-snapshot.json
```

Compara os dois snapshots função a função (ACL, owner, SECURITY DEFINER, search_path) e o `pg_default_acl` — `exit 0` só se tudo bater. Funções que existem só no alvo (de migrations pendentes ainda não refletidas no snapshot de origem) não contam como divergência.

### `scripts/backup/restore-disposable-stack.sh`

Implementa o procedimento completo, com todas as guardas de segurança:

```bash
scripts/backup/restore-disposable-stack.sh \
  --backup-dir <pasta com os 5 arquivos> \
  --container <nome do container Postgres do docker> \
  --db-host 127.0.0.1 \
  --origin-snapshot origin-snapshot.json \
  --i-understand-this-is-disposable
```

- Recusa `--linked` ou qualquer `--db-host` fora de `localhost`/`127.0.0.1`/`::1` — sem exceção, sem flag de bypass.
- Exige `--i-understand-this-is-disposable` explicitamente.
- Exige PostgreSQL 17 no alvo (confirma antes de tocar em qualquer coisa).
- Nunca imprime senha nem connection string — toda conexão é `docker exec <container> psql -U postgres -d postgres` (trust auth local).
- Ao final, roda `capture-acl-snapshot.mjs` + `compare-acl-snapshot.mjs` automaticamente contra o snapshot de origem — falha (`exit 1`) se algo divergir.
- Aceita `--inject-failure-after-schema`, só para validar (nunca usar num restore real) que o bloco `finally` (`trap`) reinstala o `pg_default_acl` mesmo quando a restauração é interrompida no meio.

## O backup validado (`remote-full-backup-20260829-183726`) nunca é alterado

Os 5 dumps, `MANIFEST.md` e `RESTORE_VALIDATION.md` dentro de `C:\Users\User\axion-acc-backups\remote-full-backup-20260829-183726\` são evidência histórica imutável — nenhuma ferramenta aqui escreve dentro dessa pasta. Snapshots de ACL gerados para validar este procedimento ficam fora dela (repositório ou pasta temporária), nunca misturados aos artefatos originais.

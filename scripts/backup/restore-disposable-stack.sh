#!/usr/bin/env bash
# Restaura um backup (roles.sql, schema.sql, history_schema.sql,
# data.sql, history_data.sql — nessa ordem exata, sempre os 5) numa
# stack Postgres LOCAL E DESCARTÁVEL, com neutralização temporária e
# reinstalação GARANTIDA do ALTER DEFAULT PRIVILEGES do schema public
# — a causa raiz diagnosticada da lacuna de ACL (ver
# docs/backup-restore-procedure.md).
#
# ALTER DEFAULT PRIVILEGES é persistente no catálogo (não é escopo de
# sessão) — por isso este script SEMPRE grava o estado anterior antes
# de tocar nele, e SEMPRE o restaura ao final, mesmo se qualquer passo
# do meio falhar (via `trap ... EXIT`, que roda em qualquer saída,
# sucesso ou erro).
#
# Segurança de ambiente (obrigatória, nunca contornável por flag):
#   - só aceita --db-host em {localhost, 127.0.0.1, ::1};
#   - recusa explicitamente --linked ou qualquer host fora da lista;
#   - exige --i-understand-this-is-disposable;
#   - exige PostgreSQL 17 no alvo (mesma versão do remoto real);
#   - nunca imprime senha nem connection string completa — a conexão é
#     sempre `docker exec <container> psql -U postgres -d postgres`
#     (trust auth local, sem senha nenhuma envolvida).
#
# Uso:
#   scripts/backup/restore-disposable-stack.sh \
#     --backup-dir <pasta com os 5 arquivos> \
#     --container <nome do container Postgres do docker> \
#     --db-host 127.0.0.1 \
#     --origin-snapshot <snapshot .json capturado da origem> \
#     --i-understand-this-is-disposable
#
# Flags só para validação (nunca usar num restore real):
#   --inject-failure-after-schema   força uma falha logo depois de
#     restaurar schema.sql, para provar que o `trap` reinstala o
#     pg_default_acl mesmo assim.
#   --inject-failure-after-data     força uma falha logo depois de
#     restaurar data.sql (ou seja, DEPOIS de schema.sql já ter aplicado
#     seus próprios ALTER DEFAULT PRIVILEGES de FUNCTIONS/TABLES/
#     SEQUENCES) — prova que o `trap` reverte as TRÊS categorias, não só
#     FUNCTIONS, mesmo quando a falha acontece depois delas já terem
#     mudado.
#
# Os dois estados finais possíveis são tratados de forma DIFERENTE
# (corrigido em 2026-08-30, ver diagnóstico da mesma data):
#   - SUCESSO (os 5 arquivos restaurados + ACL do alvo comparada e igual
#     à ORIGEM por compare-acl-snapshot.mjs, que já cobre FUNCTIONS,
#     TABLES e SEQUENCES sem filtro de tipo): o pg_default_acl final
#     DEVE divergir do estado do container vazio pré-restore — isso é
#     esperado e correto, porque agora reflete a configuração real da
#     origem. O `trap` não reinstala nem recompara nada nesse caminho
#     (já está provado, reinstalar seria destrutivo sobre um estado
#     correto).
#   - FALHA (qualquer passo no meio falhou, ou a comparação contra a
#     origem não bateu): o alvo pode estar num estado parcialmente
#     alterado. A única promessa possível é devolver o pg_default_acl
#     — FUNCTIONS, TABLES e SEQUENCES, as três, não só FUNCTIONS — ao
#     estado exato que o alvo tinha ANTES de qualquer passo desta
#     restauração, nunca ao estado da origem (nunca atingido).

set -u

BACKUP_DIR=""
CONTAINER=""
DB_HOST=""
ORIGIN_SNAPSHOT=""
CONFIRMED=""
LINKED_REQUESTED=""
INJECT_FAILURE=""
INJECT_FAILURE_AFTER_DATA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --db-host) DB_HOST="$2"; shift 2 ;;
    --origin-snapshot) ORIGIN_SNAPSHOT="$2"; shift 2 ;;
    --i-understand-this-is-disposable) CONFIRMED="true"; shift ;;
    --linked) LINKED_REQUESTED="true"; shift ;;
    --inject-failure-after-schema) INJECT_FAILURE="true"; shift ;;
    --inject-failure-after-data) INJECT_FAILURE_AFTER_DATA="true"; shift ;;
    *) echo "Flag desconhecida: $1" >&2; exit 1 ;;
  esac
done

# ---------- guarda-corpos, nunca contornáveis ----------

if [ -n "$LINKED_REQUESTED" ]; then
  echo "RECUSADO: --linked nunca é aceito por este script — ele só restaura em stacks locais descartáveis, nunca no remoto." >&2
  exit 1
fi

case "$DB_HOST" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "RECUSADO: --db-host precisa ser exatamente localhost, 127.0.0.1 ou ::1 (recebido: \"${DB_HOST:-<vazio>}\")." >&2
    exit 1
    ;;
esac

if [ "$CONFIRMED" != "true" ]; then
  echo "RECUSADO: passe --i-understand-this-is-disposable explicitamente — este script restaura sobre o container informado, que precisa ser uma stack descartável, nunca a stack local real do projeto nem o remoto." >&2
  exit 1
fi

# Defesa em profundidade: todo argumento externo já vai para docker/psql
# sempre como elemento separado de array (nunca concatenado numa linha
# de shell), então injeção via metacaractere já não tem caminho — mas
# validamos o formato mesmo assim, para recusar cedo e com uma
# mensagem clara, em vez de deixar docker/psql decidirem o que fazer
# com um valor claramente malformado. Nome de container Docker: só
# alfanumérico/._- , começando por alfanumérico (mesma regra do
# próprio Docker).
case "$CONTAINER" in
  [a-zA-Z0-9]*)
    case "$CONTAINER" in
      *[!a-zA-Z0-9._-]*)
        echo "RECUSADO: --container contém caractere fora do formato aceito por nomes de container Docker (só alfanumérico, '.', '_', '-')." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "RECUSADO: --container precisa começar com letra ou número (recebido: \"${CONTAINER:-<vazio>}\")." >&2
    exit 1
    ;;
esac

if [ -z "$BACKUP_DIR" ] || [ -z "$CONTAINER" ] || [ -z "$ORIGIN_SNAPSHOT" ]; then
  echo "Uso: $0 --backup-dir <pasta> --container <nome> --db-host <localhost|127.0.0.1|::1> --origin-snapshot <arquivo.json> --i-understand-this-is-disposable" >&2
  exit 1
fi

for f in roles.sql schema.sql history_schema.sql data.sql history_data.sql; do
  if [ ! -f "$BACKUP_DIR/$f" ]; then
    echo "RECUSADO: $BACKUP_DIR/$f não existe — os 5 arquivos são obrigatórios, nunca um subconjunto." >&2
    exit 1
  fi
done

if [ ! -f "$ORIGIN_SNAPSHOT" ]; then
  echo "RECUSADO: snapshot de origem \"$ORIGIN_SNAPSHOT\" não encontrado — gere com capture-acl-snapshot.mjs antes de restaurar." >&2
  exit 1
fi

echo "=== Verificando PostgreSQL 17 no alvo ==="
PG_VERSION_LINE=$(docker exec "$CONTAINER" psql -U postgres -d postgres -t -A -c "select version();" 2>&1)
if ! echo "$PG_VERSION_LINE" | grep -q "PostgreSQL 17"; then
  echo "RECUSADO: alvo não está em PostgreSQL 17 (esperado, para bater com o remoto real)." >&2
  exit 1
fi
echo "OK — PostgreSQL 17 confirmado."

# ---------- captura do estado atual de pg_default_acl (antes de tocar em nada) ----------

STATE_DIR=$(mktemp -d)
PRE_DEFAULT_ACL_FILE="$STATE_DIR/pre-default-acl.txt"
RESTORE_LOG="$STATE_DIR/restore.log"

echo "=== Capturando pg_default_acl atual do alvo (antes de qualquer alteração) ==="
docker exec "$CONTAINER" psql -U postgres -d postgres -t -A -F'|' -c "
  select pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype,
         coalesce(string_agg(distinct split_part(a.acl::text, '/', 1), ',' order by split_part(a.acl::text, '/', 1)), '')
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  left join unnest(d.defaclacl) as a(acl) on true
  where n.nspname = 'public'
  group by 1, 2, 3
  order by 1, 3;
" > "$PRE_DEFAULT_ACL_FILE"
echo "Estado anterior salvo em $PRE_DEFAULT_ACL_FILE ($(wc -l < "$PRE_DEFAULT_ACL_FILE") linha(s))."

RESTORE_FAILED=""
RESTORE_SUCCEEDED=""

# Letra de aclitem -> palavra-chave de privilégio, por tipo de objeto de
# default privilege (f=FUNCTIONS, S=SEQUENCES, r=TABLES — os únicos 3
# tipos que este projeto usa). Uma letra sem mapeamento aqui NUNCA vira
# GRANT (falha silenciosa seria pior que não conceder) — ver uso abaixo.
default_acl_privilege_for_letter() {
  local objtype="$1" letter="$2"
  case "$objtype:$letter" in
    f:X) echo "EXECUTE" ;;
    S:r) echo "SELECT" ;;
    S:w) echo "UPDATE" ;;
    S:U) echo "USAGE" ;;
    r:r) echo "SELECT" ;;
    r:a) echo "INSERT" ;;
    r:w) echo "UPDATE" ;;
    r:d) echo "DELETE" ;;
    r:D) echo "TRUNCATE" ;;
    r:x) echo "REFERENCES" ;;
    r:t) echo "TRIGGER" ;;
    r:m) echo "MAINTAIN" ;;
    *) echo "" ;;
  esac
}

# Restaura TODAS as 3 categorias (FUNCTIONS, SEQUENCES, TABLES) do
# pg_default_acl do schema public para exatamente o que está gravado no
# arquivo de snapshot passado (formato "grantor_role|nspname|objtype|
# roles_csv", mesmo formato de PRE_DEFAULT_ACL_FILE) — usado só no
# caminho de FALHA, nunca no de sucesso (ver cabeçalho do script). Um
# default é sempre definido "FOR ROLE <grantor>" — este projeto tem, no
# mínimo, 2 grantors distintos (postgres e supabase_admin), cada um com
# sua própria linha por objtype no snapshot; iterar só a primeira linha
# (bug do script original, restrito a FUNCTIONS/postgres) deixaria
# qualquer default de supabase_admin sem restaurar. Para cada (grantor,
# objtype) do snapshot: revoga tudo dos 4 grantees conhecidos (escopado a
# esse grantor específico) antes de reconceder, para que a reconstituição
# seja exata mesmo que schema.sql já tenha alterado o default no meio do
# caminho.
restore_full_default_acl_from_snapshot() {
  local snapshot_file="$1"
  local objtype type_name line grantor roles_field role_letters role letters priv privs
  for objtype in f S r; do
    case "$objtype" in
      f) type_name="FUNCTIONS" ;;
      S) type_name="SEQUENCES" ;;
      r) type_name="TABLES" ;;
    esac

    while IFS= read -r line; do
      [ -z "$line" ] && continue
      grantor=$(echo "$line" | cut -d'|' -f1)
      roles_field=$(echo "$line" | cut -d'|' -f4)
      [ -z "$grantor" ] && continue

      docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
        "alter default privileges for role ${grantor} in schema public revoke all on ${type_name} from public, anon, authenticated, service_role;" \
        >> "$RESTORE_LOG" 2>&1

      [ -z "$roles_field" ] && continue
      IFS=',' read -ra role_letters <<< "$roles_field"
      for pair in "${role_letters[@]}"; do
        role="${pair%%=*}"
        letters="${pair#*=}"
        [ "$role" = "postgres" ] && continue
        [ "$role" = "supabase_admin" ] && continue
        privs=""
        for ((i = 0; i < ${#letters}; i++)); do
          priv=$(default_acl_privilege_for_letter "$objtype" "${letters:$i:1}")
          [ -n "$priv" ] && privs="${privs}${priv},"
        done
        privs="${privs%,}"
        if [ -n "$privs" ]; then
          docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
            "alter default privileges for role ${grantor} in schema public grant ${privs} on ${type_name} to ${role};" \
            >> "$RESTORE_LOG" 2>&1
        fi
      done
    done < <(grep "|${objtype}|" "$snapshot_file")
  done
}

# ---------- bloco finally: trata sucesso e falha de forma DIFERENTE ----------
cleanup_and_restore_defaults() {
  local exit_code=$?
  echo ""

  if [ -n "$RESTORE_SUCCEEDED" ] && [ -z "$RESTORE_FAILED" ]; then
    # Sucesso real: a comparação contra a ORIGEM (FUNCTIONS+TABLES+
    # SEQUENCES, sem filtro de tipo) já rodou e já passou via
    # compare-acl-snapshot.mjs, mais acima no script. Reinstalar aqui
    # sobrescreveria um estado CORRETO (que legitimamente diverge do
    # container vazio pré-restore) com um estado incorreto — não fazer
    # nada é o comportamento certo.
    echo "=== [finally] Restauração concluída com sucesso — pg_default_acl (FUNCTIONS/TABLES/SEQUENCES) já confirmado idêntico à origem acima, nada a reinstalar. ==="
    echo ""
    echo "Log completo em: $RESTORE_LOG"
    echo "Estado pré-restauração (referência) em: $PRE_DEFAULT_ACL_FILE"
    exit "$exit_code"
  fi

  echo "=== [finally] Restauração NÃO concluída — restaurando pg_default_acl (FUNCTIONS, TABLES e SEQUENCES) ao estado exato de antes de qualquer alteração ==="
  restore_full_default_acl_from_snapshot "$PRE_DEFAULT_ACL_FILE"

  echo "=== Verificando pg_default_acl pós-restauração contra o estado pré-restauração (as 3 categorias) ==="
  docker exec "$CONTAINER" psql -U postgres -d postgres -t -A -F'|' -c "
    select pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype,
           coalesce(string_agg(distinct split_part(a.acl::text, '/', 1), ',' order by split_part(a.acl::text, '/', 1)), '')
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    left join unnest(d.defaclacl) as a(acl) on true
    where n.nspname = 'public'
    group by 1, 2, 3
    order by 1, 3;
  " > "$STATE_DIR/post-default-acl.txt"

  if diff -q "$PRE_DEFAULT_ACL_FILE" "$STATE_DIR/post-default-acl.txt" > /dev/null 2>&1; then
    echo "OK — pg_default_acl idêntico ao estado anterior à restauração."
  else
    echo "FAIL — pg_default_acl DIVERGE do estado anterior:" >&2
    diff "$PRE_DEFAULT_ACL_FILE" "$STATE_DIR/post-default-acl.txt" >&2
    exit_code=1
  fi

  echo ""
  echo "Log completo em: $RESTORE_LOG"
  echo "Estado (pré/pós) em: $STATE_DIR"

  if [ -n "$RESTORE_FAILED" ]; then
    echo "" >&2
    echo "RESULTADO FINAL: FAIL — a restauração falhou no meio (ver log), mas o pg_default_acl foi restaurado com sucesso." >&2
    exit 1
  fi

  exit "$exit_code"
}
trap cleanup_and_restore_defaults EXIT

# ---------- neutraliza os 3 defaults (única mudança persistente feita antes do restore) ----------
# Evita que objetos criados por schema.sql, momentaneamente, herdem o
# default do container vazio (que já concede acesso a anon/authenticated/
# service_role — a mesma causa raiz documentada em
# docs/backup-restore-procedure.md) antes de schema.sql aplicar suas
# PRÓPRIAS ALTER DEFAULT PRIVILEGES (normalmente ao final do dump). Cobre
# as 3 categorias, não só FUNCTIONS — o mesmo risco existe, em menor
# grau, para TABLES/SEQUENCES criadas antes das linhas correspondentes de
# schema.sql serem alcançadas.

echo ""
echo "=== Neutralizando temporariamente ALTER DEFAULT PRIVILEGES (FUNCTIONS/TABLES/SEQUENCES) em public ==="
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
  alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
  alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
" >> "$RESTORE_LOG" 2>&1
echo "OK — defaults neutralizados."

# ---------- copia os 5 arquivos para o container ----------

echo ""
echo "=== Copiando os 5 arquivos do backup para o container ==="
docker exec "$CONTAINER" mkdir -p //tmp/restore
for f in roles.sql schema.sql history_schema.sql data.sql history_data.sql; do
  docker cp "$BACKUP_DIR/$f" "$CONTAINER://tmp/restore/$f" >> "$RESTORE_LOG" 2>&1
done
echo "OK — arquivos copiados."

# ---------- restauração, na ordem exata e obrigatória ----------

echo ""
echo "=== 1/5 roles.sql ==="
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f //tmp/restore/roles.sql >> "$RESTORE_LOG" 2>&1
echo "(erros aqui são esperados só para roles de plataforma desligados nesta stack, ex.: supabase_realtime_admin — ver log)"

echo ""
echo "=== 2/5 schema.sql ==="
if ! docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f //tmp/restore/schema.sql >> "$RESTORE_LOG" 2>&1; then
  echo "FALHA em schema.sql — ver $RESTORE_LOG" >&2
  RESTORE_FAILED="true"
  exit 1
fi
echo "OK."

if [ -n "$INJECT_FAILURE" ]; then
  echo "" >&2
  echo "=== FALHA INJETADA DELIBERADAMENTE (--inject-failure-after-schema) — validando o bloco finally ===" >&2
  RESTORE_FAILED="true"
  exit 1
fi

echo ""
echo "=== 3/5 history_schema.sql ==="
if ! docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f //tmp/restore/history_schema.sql >> "$RESTORE_LOG" 2>&1; then
  echo "FALHA em history_schema.sql — ver $RESTORE_LOG" >&2
  RESTORE_FAILED="true"
  exit 1
fi
echo "OK."

echo ""
echo "=== 4/5 data.sql (triggers desativados via session_replication_role) ==="
if ! docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica;" -f //tmp/restore/data.sql >> "$RESTORE_LOG" 2>&1; then
  echo "FALHA em data.sql — ver $RESTORE_LOG" >&2
  RESTORE_FAILED="true"
  exit 1
fi
echo "OK."

if [ -n "$INJECT_FAILURE_AFTER_DATA" ]; then
  echo "" >&2
  echo "=== FALHA INJETADA DELIBERADAMENTE (--inject-failure-after-data) — validando que o bloco finally reverte FUNCTIONS/TABLES/SEQUENCES, não só FUNCTIONS ===" >&2
  RESTORE_FAILED="true"
  exit 1
fi

echo ""
echo "=== 5/5 history_data.sql ==="
if ! docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f //tmp/restore/history_data.sql >> "$RESTORE_LOG" 2>&1; then
  echo "FALHA em history_data.sql — ver $RESTORE_LOG" >&2
  RESTORE_FAILED="true"
  exit 1
fi
echo "OK — os 5 arquivos restaurados, nenhum omitido."

# ---------- comparação automática de ACL contra o snapshot de origem ----------

echo ""
echo "=== Capturando snapshot de ACL do alvo restaurado e comparando contra a origem ==="
TARGET_SNAPSHOT="$STATE_DIR/target-snapshot.json"
if ! node "$(dirname "$0")/capture-acl-snapshot.mjs" --container "$CONTAINER" --out "$TARGET_SNAPSHOT" >> "$RESTORE_LOG" 2>&1; then
  echo "FALHA ao capturar snapshot do alvo — ver $RESTORE_LOG" >&2
  RESTORE_FAILED="true"
  exit 1
fi

if ! node "$(dirname "$0")/compare-acl-snapshot.mjs" "$ORIGIN_SNAPSHOT" "$TARGET_SNAPSHOT"; then
  echo "FALHA — ACL do alvo restaurado diverge do snapshot de origem." >&2
  RESTORE_FAILED="true"
  exit 1
fi

# Marca sucesso real só aqui — depois que TUDO (os 5 arquivos + a
# comparação completa de ACL/pg_default_acl contra a origem, via
# compare-acl-snapshot.mjs, que cobre FUNCTIONS/TABLES/SEQUENCES sem
# filtro de tipo) passou. O trap usa esta flag para decidir entre os
# dois caminhos (não reinstalar nada vs. reverter tudo ao estado
# pré-restore) — nunca mascarando uma divergência real.
RESTORE_SUCCEEDED="true"

echo ""
echo "RESTAURAÇÃO CONCLUÍDA — ACL do alvo (FUNCTIONS/TABLES/SEQUENCES) bate com a origem."
exit 0

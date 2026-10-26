#!/usr/bin/env bash
# Aplica, EM ORDEM, as migrations pendentes ao Postgres DESCARTÁVEL LOCAL (container Docker "supabase_db_acc-disposable-*").
# supabase_db_acc-disposable-test-e2, porta local 56322). Nunca toca banco remoto/produção.
set -u
D=supabase_db_acc-disposable-test-e2
case "$D" in supabase_db_acc-disposable-*) ;; *) echo "container inesperado: $D"; exit 2;; esac
cd /c/VIBE/PROJETOS/AXION-CONTRACT-INTELLIGENCE
docker exec "$D" psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations order by version" > /tmp/e2_applied.txt
ok=0
for f in $(ls supabase/migrations/*.sql | sort); do
  base=$(basename "$f" .sql); ver=${base%%_*}; name=${base#*_}
  if grep -qx "$ver" /tmp/e2_applied.txt; then continue; fi
  if docker exec -i "$D" psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -q -f - < "$f" > /tmp/mig_out.txt 2>&1; then
    docker exec "$D" psql -U postgres -d postgres -q -c "insert into supabase_migrations.schema_migrations(version,name,statements) values ('$ver','$name', array[]::text[])" >/dev/null
    ok=$((ok+1)); echo "OK   $ver $name"
  else
    echo "FAIL $ver $name"; head -8 /tmp/mig_out.txt; echo "aplicadas nesta execução: $ok"; exit 1
  fi
done
echo "aplicadas nesta execução: $ok"

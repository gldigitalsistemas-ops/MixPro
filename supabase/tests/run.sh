#!/bin/sh
# Sobe um Postgres descartável e aplica shim + migrações + seed + testes.
set -e
cd "$(dirname "$0")/.."
docker rm -f mixpro-sqltest >/dev/null 2>&1 || true
docker run -d --name mixpro-sqltest -e POSTGRES_PASSWORD=pg postgres:16-alpine >/dev/null
until docker exec mixpro-sqltest pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
run() { docker exec -i mixpro-sqltest psql -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
run < tests/00_supabase_shim.sql
for f in migrations/*.sql; do echo "== $f"; run < "$f"; done
echo "== seed.sql"; run < seed.sql
for f in tests/[1-9]*.sql; do echo "== $f"; run < "$f"; done
docker rm -f mixpro-sqltest >/dev/null
echo "OK"

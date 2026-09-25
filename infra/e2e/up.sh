#!/bin/sh
# Sobe a stack de teste, aplica migrações e escreve apps/web/.env.local apontando para ela.
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

if [ ! -f .env ]; then node keys.mjs > .env; fi
set -a; . ./.env; set +a

docker compose up -d db auth rest gateway minio minio-init

echo "aguardando auth (migrações do GoTrue)…"
i=0; until curl -sf http://localhost:54321/auth/v1/health >/dev/null; do i=$((i+1)); [ $i -gt 90 ] && { docker compose logs auth --tail 20; exit 1; }; sleep 1; done

psql_run() { docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
if ! psql_run -tAc "select 1 from pg_tables where schemaname='public' and tablename='profiles'" | grep -q 1; then
  for f in "$ROOT"/supabase/migrations/*.sql; do echo "== $(basename "$f")"; psql_run < "$f"; done
  psql_run < "$ROOT/supabase/seed.sql"
  psql_run < dev-presets.sql
  psql_run -c "grant usage on schema auth to anon, authenticated, service_role;
               grant execute on all functions in schema auth to anon, authenticated, service_role;"
fi
psql_run -c "notify pgrst, 'reload schema';"

cat > "$ROOT/apps/web/.env.local" <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=mixpro-audio
S3_ACCESS_KEY_ID=mixpro
S3_SECRET_ACCESS_KEY=mixpro-secret
EOF

docker compose --profile worker up -d --build worker
echo "stack pronta: gateway http://localhost:54321 · minio http://localhost:9001"

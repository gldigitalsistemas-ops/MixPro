#!/usr/bin/env bash
# Acesso da Vercel ao Google SEM chave (Workload Identity Federation com o OIDC da Vercel).
# Use quando a organização bloqueia chaves de conta de serviço (iam.disableServiceAccountKeyCreation).
# Rode no Cloud Shell, depois do deploy.sh:
#
#   export GCP_PROJECT_ID=mixpro-export
#   export VERCEL_TEAM=<slug do time na Vercel>        # o que aparece em vercel.com/<slug>
#   export VERCEL_PROJECT=<nome do projeto na Vercel>  # ex.: mix-pro-20
#   export VERCEL_ISSUER_MODE=team                     # ou "global" (veja em Settings → Security na Vercel)
#   bash infra/gcp/wif-vercel.sh
#
# Só o projeto VERCEL_PROJECT do time VERCEL_TEAM consegue assumir a conta export-enqueuer, que por sua
# vez só cria tarefas na fila de exportação. É idempotente.
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?defina GCP_PROJECT_ID}"
TEAM="${VERCEL_TEAM:?defina VERCEL_TEAM}"
VPROJECT="${VERCEL_PROJECT:?defina VERCEL_PROJECT}"
MODE="${VERCEL_ISSUER_MODE:-team}"
POOL="vercel"
PROVIDER="vercel"
ENQUEUER="export-enqueuer@${PROJECT}.iam.gserviceaccount.com"
[[ "$TEAM" =~ ^[a-z0-9-]+$ && "$VPROJECT" =~ ^[a-z0-9._-]+$ ]] || { echo "VERCEL_TEAM/VERCEL_PROJECT com caracteres inesperados"; exit 1; }

if [[ "$MODE" == "global" ]]; then ISSUER="https://oidc.vercel.com"; else ISSUER="https://oidc.vercel.com/${TEAM}"; fi
AUDIENCE="https://vercel.com/${TEAM}"

gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')"
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com >/dev/null

echo "==> 1/3 Pool de identidade"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location global --display-name "Vercel"

echo "==> 2/3 Provedor OIDC (só o projeto ${VPROJECT} do time ${TEAM})"
PFLAGS=(--location global --workload-identity-pool "$POOL"
  --issuer-uri "$ISSUER" --allowed-audiences "$AUDIENCE"
  --attribute-mapping "google.subject=assertion.sub,attribute.owner=assertion.owner,attribute.project=assertion.project,attribute.environment=assertion.environment"
  --attribute-condition "assertion.owner == '${TEAM}' && assertion.project == '${VPROJECT}'")
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" "${PFLAGS[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" "${PFLAGS[@]}"
fi

echo "==> 3/3 Permissão: esse projeto da Vercel pode assumir a conta export-enqueuer"
gcloud iam service-accounts add-iam-policy-binding "$ENQUEUER" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.project/${VPROJECT}" >/dev/null

cat <<EOF

PRONTO. Na Vercel (Production e Preview):
  GCP_WIF_PROVIDER=//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
  (apague GCP_SERVICE_ACCOUNT_JSON se existir)
E ligue em Project Settings → Security → "Secure Backend Access with OIDC Federation" (modo: ${MODE}).
Depois faça Redeploy.
EOF

#!/usr/bin/env bash
# Implantação do serviço de exportação no Google Cloud (Etapa 4, fatias 6 e 7).
# Rode no CLOUD SHELL (console.cloud.google.com, ícone ">_"), dentro do repositório clonado:
#
#   git clone <url-do-repositorio> mixpro && cd mixpro && git checkout feat/export-server
#   export GCP_PROJECT_ID=<id-do-projeto>
#   bash infra/gcp/deploy.sh
#
# É idempotente: pode rodar de novo (atualiza o que mudou). Nada aqui apaga dados.
# Os segredos são pedidos no terminal (sem eco) e vão direto para o Secret Manager:
# não ficam no histórico do shell, em arquivo nem em argumento de comando.
#
# O que cria (região us-central1, faixa 1 de preço; confirme os preços na página oficial do Cloud Run
# antes de ligar o servidor para todos):
#   - APIs: Cloud Run, Cloud Tasks, Cloud Build, Artifact Registry, Secret Manager, IAM
#   - Contas de serviço: export-runner (identidade do Cloud Run), export-invoker (token OIDC das
#     tarefas) e export-enqueuer (a Vercel cria tarefas; só isso)
#   - Cloud Run "mixpro-export": FECHADO ao público, 2 GiB, 1 CPU, 1 requisição por instância,
#     no máximo 2 instâncias, 15 min por requisição
#   - Fila do Cloud Tasks "mixpro-export": 2 em paralelo, 3 tentativas, espera crescente
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?defina GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${EXPORT_SERVICE_NAME:-mixpro-export}"
QUEUE="${EXPORT_TASKS_QUEUE:-mixpro-export}"
REPO="mixpro"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"
RUNNER="export-runner@${PROJECT}.iam.gserviceaccount.com"
INVOKER="export-invoker@${PROJECT}.iam.gserviceaccount.com"
ENQUEUER="export-enqueuer@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null

echo "==> 1/8 APIs"
gcloud services enable run.googleapis.com cloudtasks.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com

echo "==> 2/8 Contas de serviço"
for sa in export-runner export-invoker export-enqueuer; do
  gcloud iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$sa" --display-name "Mix Pro: $sa"
done

echo "==> 3/8 Segredos (digite os valores; não aparecem na tela)"
put_secret() { # nome, descrição
  local name="$1" label="$2" value
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    read -r -p "   $label já existe. Atualizar? [s/N] " ans
    [[ "${ans:-n}" =~ ^[sS]$ ]] || return 0
  else
    gcloud secrets create "$name" --replication-policy=automatic >/dev/null
  fi
  read -r -s -p "   $label: " value; echo
  [[ -n "$value" ]] || { echo "valor vazio; abortando"; exit 1; }
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$name" --member "serviceAccount:${RUNNER}" --role roles/secretmanager.secretAccessor >/dev/null
}
put_secret export-supabase-service-role "Supabase SERVICE ROLE KEY (projeto de PRODUÇÃO)"
put_secret export-r2-access-key-id "R2 Access Key ID"
put_secret export-r2-secret-access-key "R2 Secret Access Key"

read -r -p "   NEXT_PUBLIC_SUPABASE_URL (https://xxxx.supabase.co): " SUPABASE_URL
read -r -p "   NEXT_PUBLIC_SUPABASE_ANON_KEY: " SUPABASE_ANON
read -r -p "   R2_ACCOUNT_ID: " R2_ACCOUNT_ID
read -r -p "   R2_BUCKET [mixpro-exports]: " R2_BUCKET; R2_BUCKET="${R2_BUCKET:-mixpro-exports}"
[[ "$SUPABASE_URL" == https://*.supabase.co ]] || { echo "URL do Supabase inesperada"; exit 1; }

echo "==> 4/8 Imagem (Cloud Build; o Dockerfile é o de apps/export-service)"
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION"
cat > /tmp/cloudbuild-export.yaml <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "-f", "apps/export-service/Dockerfile", "-t", "${IMAGE}:latest", "."]
images: ["${IMAGE}:latest"]
EOF
gcloud builds submit --config /tmp/cloudbuild-export.yaml .

echo "==> 5/8 Cloud Run (fechado ao público)"
gcloud run deploy "$SERVICE" \
  --image "${IMAGE}:latest" --region "$REGION" \
  --service-account "$RUNNER" \
  --no-allow-unauthenticated \
  --memory 2Gi --cpu 1 --concurrency 1 --timeout 900 --min-instances 0 --max-instances 2 \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL},NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL},NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON},R2_ACCOUNT_ID=${R2_ACCOUNT_ID},R2_BUCKET=${R2_BUCKET}" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=export-supabase-service-role:latest,R2_ACCESS_KEY_ID=export-r2-access-key-id:latest,R2_SECRET_ACCESS_KEY=export-r2-secret-access-key:latest"
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"

echo "==> 6/8 Fila do Cloud Tasks"
QFLAGS=(--max-concurrent-dispatches=2 --max-dispatches-per-second=2 --max-attempts=3 --min-backoff=10s --max-backoff=120s --max-doublings=3)
if gcloud tasks queues describe "$QUEUE" --location "$REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$QUEUE" --location "$REGION" "${QFLAGS[@]}"
else
  gcloud tasks queues create "$QUEUE" --location "$REGION" "${QFLAGS[@]}"
fi

echo "==> 7/8 Permissões (mínimas)"
# só o invocador chama o Cloud Run
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member "serviceAccount:${INVOKER}" --role roles/run.invoker >/dev/null
# a Vercel (export-enqueuer) só cria tarefas nesta fila, e só "como" o invocador
gcloud tasks queues add-iam-policy-binding "$QUEUE" --location "$REGION" \
  --member "serviceAccount:${ENQUEUER}" --role roles/cloudtasks.enqueuer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$INVOKER" \
  --member "serviceAccount:${ENQUEUER}" --role roles/iam.serviceAccountUser >/dev/null

echo "==> 8/8 Conferência"
echo -n "   chamada sem autenticação (deve ser 403): "
curl -s -o /dev/null -w '%{http_code}\n' "${SERVICE_URL}/healthz"
echo -n "   chamada com a sua identidade (deve ser 200): "
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${SERVICE_URL}/healthz"

cat <<EOF

PRONTO. Valores para a Vercel (somente Production):
  GCP_PROJECT_ID=${PROJECT}
  GCP_REGION=${REGION}
  EXPORT_TASKS_QUEUE=${QUEUE}
  EXPORT_SERVICE_URL=${SERVICE_URL}

Falta a chave da conta "export-enqueuer" (GCP_SERVICE_ACCOUNT_JSON). Ela é um segredo: crie, copie e apague.
  gcloud iam service-accounts keys create /tmp/enqueuer.json --iam-account ${ENQUEUER}
  cat /tmp/enqueuer.json | tr -d '\n'     # copie esta linha para a Vercel
  rm /tmp/enqueuer.json
Se a sua organização bloquear chaves de conta de serviço, use Workload Identity Federation (docs/DEPLOYMENT.md).

O interruptor continua DESLIGADO (export_server_enabled = false). Ligue só depois dos testes.
EOF

# Serviço de exportação (worker de áudio)

`apps/export-service`: um servidor HTTP mínimo em Node 22 que executa um job por vez. O DSP é o do app (`apps/web/lib`), empacotado com esbuild; o FFmpeg decodifica a entrada e codifica MP3 e M4A. (O worker em Python de `apps/worker` e o `docs/worker.md` pertencem à arquitetura antiga e não são usados por este fluxo.)

## Endpoints

| Método | Rota | Resposta |
|---|---|---|
| `POST` | `/run` com `{"job_id": "<uuid>"}` | 200 (`done`/`failed`, falha definitiva), 404, 409 (já rodando), 429 (instância ocupada), 503 (falha passageira: o Cloud Tasks tenta de novo) |
| `GET` | `/healthz` | `{ ok, dsp_version }` |

O job é sempre lido do banco; o corpo da requisição só diz qual. No Cloud Run a autenticação é do IAM (OIDC do Cloud Tasks); `EXPORT_SERVICE_TOKEN` é opcional, para uso fora do Cloud Run.

## Pipeline de um job

validar (esquema + `p_ref`) → conferir a entrada no R2 (tamanho) → decodificar em fluxo com FFmpeg (limites de duração, formatos permitidos) → conferir contra `job.source` (duração, taxa, canais, início) → carregar samples e IRs por ID no catálogo → `processJobAudio` (DSP + cortes) → medir (LUFS, pico, SHA-256) → gravar WAV/MP3/M4A → salvar no R2 → `commit` (débito + âncora, na mesma transação). Em alvo de vídeo, a saída é só o áudio em AAC: quem junta ao vídeo é o aparelho.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secreta) | jobs pelas RPCs; sem elas, usa um arquivo JSON local (`JOBS_FILE`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | catálogo de presets e bucket público `drum-samples` (só leitura) |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | armazenamento; sem `R2_BUCKET`, usa `STORAGE_DIR` (pasta local) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | caminhos dos binários (padrão: do PATH) |
| `PORT` | padrão 8080 |
| `MAX_CONCURRENT_JOBS` | não existe como variável: a concorrência é 1 por instância e o limite global vem do Cloud Run (`--max-instances`) e da fila (`maxConcurrentDispatches`). Para subir de 2 para 4, mude os dois valores em `infra/gcp/deploy.sh` |

## Rodar localmente

```
# serviço (usa pasta local e JSON se não houver R2/Supabase)
node packages/contracts/node_modules/tsx/dist/cli.mjs apps/export-service/src/server.ts

# testes (precisam de FFmpeg para a maior parte)
cd apps/export-service
FFMPEG_PATH=... FFPROBE_PATH=... node ../../packages/contracts/node_modules/tsx/dist/cli.mjs --test test/*.test.ts
```

- `service.test.ts`: o serviço de ponta a ponta com pasta local.
- `supabase.test.ts`: banco e crédito contra o projeto de **teste** (`.env.export-test`; recusa rodar se a URL for a de produção).
- `e2e-nuvem.test.ts`: rotas + R2 real + banco de teste + serviço (precisa de `.env.export-test`, das chaves `R2_*` em `apps/web/.env.local` e do FFmpeg).

A imagem Docker (`Dockerfile`) é construída e testada no GitHub Actions; não é construída na máquina de desenvolvimento.

## Observabilidade

Uma linha JSON por job em stdout, só com `job_id`, `status`, `error_code`, duração, canais, taxa, alvo, `cpu_ms`, `rss_mb`, `wall_ms`, `etapas_ms` e `dsp_version`. Nunca conteúdo do job, nome de arquivo, chave ou URL.

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| `INPUT_MISSING` | o envio ao R2 não terminou antes do `start`; o app envia de novo |
| `REF_MISMATCH` | o mesmo pedido já foi pago com outro áudio; o app oferece o aparelho |
| `VERSION_MISMATCH` | o app e o serviço estão em versões diferentes do DSP (`DSP_VERSION`): publique os dois juntos |
| 403 ao chamar o Cloud Run | esperado sem token; o Cloud Tasks usa a conta `export-invoker` |
| Jobs parados em `queued` | upload abandonado (a limpeza libera em 15 min) ou fila pausada: veja `gcloud tasks queues describe` |

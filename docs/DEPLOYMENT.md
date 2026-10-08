# Implantação

Frontend na **Vercel**; Auth, banco e créditos no **Supabase**; arquivos temporários no **Cloudflare R2**; o serviço de exportação no **Google Cloud Run**, acionado pelo **Cloud Tasks**. Sem o servidor o app funciona por inteiro no aparelho; o servidor é uma camada opcional que se liga por conta e se desliga com um interruptor.

Para o básico de Supabase e Vercel (projeto, login, domínio) veja [deploy.md](deploy.md). Esta página cobre o que a exportação no servidor acrescenta.

## Variáveis de ambiente

| Variável | Onde | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` | Vercel | públicas |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (Production), Secret Manager | secreta; nunca no navegador |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Vercel (Production), Secret Manager | token do R2 só com acesso a `mixpro-exports` |
| `GCP_PROJECT_ID`, `GCP_REGION`, `EXPORT_TASKS_QUEUE`, `EXPORT_SERVICE_URL` | Vercel (Production) | `deploy.sh` imprime os valores |
| `GCP_SERVICE_ACCOUNT_JSON` | Vercel (Production) | chave da conta `export-enqueuer`; alternativa sem chave: Workload Identity Federation |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Vercel | pagamentos (não relacionado a esta etapa) |

Nunca coloque segredos no código nem em variáveis `NEXT_PUBLIC_*`. Modelo: `apps/web/.env.example`. Para testar localmente use `apps/web/.env.local` e `.env.export-test` (ambos ignorados pelo git).

## Ordem

1. **Banco (primeiro no projeto de teste).** Aplique `supabase/migrations/` em ordem. A migração `20261007000001_export_jobs.sql` cria as tabelas, as RPCs, o `pg_cron` (limpeza a cada 5 min) e os ajustes, com o servidor **desligado**. Ative a extensão `pg_cron` em Database → Extensions. Rode a bateria: `apps/export-service/test/supabase.test.ts`. Só depois aplique em produção, com a sua aprovação.
2. **R2.** Bucket privado `mixpro-exports` (sem domínio público nem `r2.dev`). Token *Object Read & Write* limitado a esse bucket. No bucket:
   - **CORS** (origens: o domínio da Vercel e, se usar, `http://localhost:3000`):
     ```json
     [{ "AllowedOrigins": ["https://SEU-DOMINIO"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
     ```
   - **Regra de ciclo de vida:** apagar objetos após 1 dia e abortar uploads incompletos após 1 dia.
3. **Google Cloud (Cloud Shell).** Crie o projeto com faturamento e, **antes de tudo**, um alerta de orçamento. Depois: `export GCP_PROJECT_ID=... && bash infra/gcp/deploy.sh`. O roteiro cria as APIs, as três contas de serviço (`export-runner`, `export-invoker`, `export-enqueuer`), os segredos (pedidos no terminal, sem eco), a imagem, o Cloud Run **fechado ao público** (2 GiB, 1 CPU, 1 requisição por instância, até 2 instâncias, 15 min) e a fila (2 em paralelo, 3 tentativas). Ele termina conferindo que a chamada sem autenticação dá 403.
4. **Vercel.** Cadastre as variáveis da tabela acima em Production e faça um novo deploy.
5. **Liberar só a sua conta.** No Supabase (projeto de produção), em `system_settings`, ponha o seu id de usuário em `export_server_users` (e deixe `export_server_enabled = false`). Rode o roteiro de fumaça: [roteiro-fumaca-exportacao.md](roteiro-fumaca-exportacao.md). Confira o custo por job (`cpu_ms`, `rss_mb`, `wall_ms` em `export_jobs`) e se ficou perto do previsto.
6. **Abrir para todos:** `export_server_enabled = true`. **Revisão marcada para 2027-01-15:** decidir se a exportação final no aparelho é aposentada (condições em `ETAPA4_PLANO.md`).

## Reversão

- **Parar já:** `export_server_enabled = false` e esvaziar `export_server_users`. O app volta a processar tudo no aparelho, como antes; jobs em andamento terminam ou são limpos pelo `pg_cron`.
- **Parar o custo:** `gcloud run services update mixpro-export --max-instances 0 --region us-central1`, ou apagar o serviço.
- **Desfazer o banco:** `supabase/rollback/20261007000001_export_jobs_down.sql`, à mão.

## Custos (confirme os preços oficiais antes de abrir para todos)

Cloud Run (região `us-central1`, faixa 1) escala a zero e tem cota grátis; Cloud Tasks e Secret Manager têm cota grátis pequena; o R2 não cobra saída de dados. O banco limita o uso pelos ajustes `export_user_*` e `export_server_daily_*`. Os preços mudam: use as páginas oficiais de Cloud Run, Cloud Tasks e R2.

## Solução de problemas

| Sintoma | Verifique |
|---|---|
| O app sempre processa no aparelho | `GET /api/export/config` devolve `enabled: false`: o interruptor/lista, as variáveis `R2_*` e `GCP_*` na Vercel |
| Erro de CORS no envio | a origem exata do app no CORS do bucket |
| `403` ao enviar ao R2 | o tamanho enviado é diferente do informado (o `Content-Length` é assinado) ou a URL passou de 15 min |
| Job fica em `queued` | o `start` não foi chamado (aba fechada no envio) ou a fila está pausada; a limpeza libera em 15 min |
| Cloud Tasks recebe 403 do Cloud Run | `export-invoker` sem `roles/run.invoker` ou `audience` diferente da URL do serviço |
| Falha ao criar tarefa (rota devolve CAPACITY) | `export-enqueuer` sem `roles/cloudtasks.enqueuer` na fila ou sem `serviceAccountUser` no invocador; chave `GCP_SERVICE_ACCOUNT_JSON` inválida |

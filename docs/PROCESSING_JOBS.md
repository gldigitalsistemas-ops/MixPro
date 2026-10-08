# Jobs de processamento (exportação no servidor)

Migração: `supabase/migrations/20261007000001_export_jobs.sql`. Reversão (manual, fora de `migrations/`): `supabase/rollback/20261007000001_export_jobs_down.sql`. As tabelas antigas `processing_jobs` e relacionadas (do worker Python) não são usadas por este fluxo e foram deixadas como estão.

## Tabelas

| Tabela | Para quê | Quem lê |
|---|---|---|
| `export_jobs` | o job: estado, crédito, chaves no R2, medidas, custo | só o servidor (service role) |
| `export_job_status` | espelho sem dados sensíveis (status, progresso, crédito, código de erro) para Realtime | o dono (RLS) |
| `my_export_jobs` | visão do dono para "Meus projetos" (sem `job_text`, chaves, hashes) | o dono |
| `export_ref_anchors` | amarra o `p_ref` ao conteúdo do áudio decodificado (fingerprint + SHA-256) | só o servidor |

O cliente não escreve em nenhuma delas. Toda mudança passa por RPCs `security definer` que só o `service_role` executa.

## Estados

```
queued ──start──► running ──commit──► done ──(24 h)──► expired
   │                 │
   └──cancel/limpeza─┴──release──► failed (error_code fechado)
```

| `status` | Significado |
|---|---|
| `queued` | criado e crédito reservado; aguardando o envio e o serviço |
| `running` | o serviço pegou o job (`attempts + 1`) |
| `done` | saída gravada no R2 e crédito debitado (mesma transação) |
| `failed` | falha definitiva, cancelamento ou prazo; reserva liberada e `job_text` apagado |
| `expired` | passou de 24 h: arquivos apagados, só o registro fica |

O **progresso** é real: 10% depois de decodificar a entrada, de 10 a 90% conforme o DSP avança, 100% ao entregar. A tela traduz em etapas ("Analisando o áudio", "Processando o som", "Exportando o arquivo"); o banco guarda apenas o número e, no fim, o tempo de cada etapa (`etapas_ms`).

## Crédito

`credit_state`: `none` → `reserved` (ao criar) → `charged` (ao entregar) ou `released` (falha, cancelamento ou prazo). A reserva não debita: o saldo disponível é `saldo − reservas ativas`. O débito usa a chave de idempotência `export:<usuário>:<p_ref>`, a mesma do `spend_export_credit` do app: baixar de novo o mesmo resultado não cobra de novo, e o app pode chamar o `spend` depois do servidor sem cobrança dupla.

Âncora do `p_ref`: no commit, o serviço grava fingerprint e SHA-256 do áudio decodificado. O mesmo `p_ref` com outro áudio dá `REF_MISMATCH` (nada é cobrado) e o app oferece processar no aparelho.

## Limites e liberação (`system_settings`)

| Chave | Padrão | Efeito |
|---|---|---|
| `export_server_enabled` | `false` | liga para todos |
| `export_server_users` | vazio | ids (separados por vírgula) liberados mesmo com o interruptor geral desligado |
| `export_user_active` | 1 | jobs ativos por usuário |
| `export_user_per_hour` / `per_day` | 10 / 40 | taxa por usuário |
| `export_server_daily_cpu_s` | 6000 | teto de CPU por dia (Brasília) |
| `export_server_daily_jobs` | 300 | teto de jobs por dia (Brasília) |

Limites do serviço: entrada de até 40 MB e 10 min, uma requisição por instância, 2 instâncias, 15 min por requisição.

## Retentativas, cancelamento e limpeza

- **Retentativa.** Falhas passageiras (`ASSET_FAILED`, `STORAGE_FAILED`, `TIMEOUT`, `INTERNAL`) devolvem o job à fila (HTTP 503 ao Cloud Tasks) até 3 tentativas. Falhas definitivas (formato, arquivo corrompido, crédito, `REF_MISMATCH`) terminam o job na hora: nunca ficam em loop.
- **Cancelamento.** `POST /api/export/jobs/:id/cancel` → `cancel_export_job`: só o dono, só `queued`/`running`; libera a reserva, apaga o JSON e o arquivo enviado. Se o serviço ainda estiver processando, o commit responde `CANCELLED`, não cobra e a saída é apagada.
- **Limpeza.** `cleanup_export_jobs`, no `pg_cron` a cada 5 min: `running` parado há 30 min e `queued` sem envio há 15 min viram `TIMEOUT` (reserva liberada); jobs com `expires_at` vencido viram `expired`. O R2 também apaga objetos com 1 dia (regra do bucket). O arquivo original do usuário nunca é guardado: só a trilha enviada, por no máximo 24 h.

## Códigos de erro

Sempre fechados (`apps/export-service/src/errors.ts`); o texto livre do FFmpeg ou do job nunca sai do serviço. A tela mostra a frase de `apps/web/lib/export/error-messages.ts` e, quando o aparelho consegue assumir (`device`), oferece processar nele.

## Segurança

- Rotas: sessão obrigatória, job validado com o mesmo esquema do serviço, dono conferido em toda operação (outro usuário recebe "não encontrado").
- R2: bucket privado; envio por PUT com tamanho assinado; download por URL de 60 s; chaves aleatórias.
- Cloud Run fechado ao público (só o `export-invoker`, via OIDC do Cloud Tasks). Logs com campos fixos: sem job, CTA, nome de arquivo, chave ou URL (`lib/export/privacy.test.ts`).
- `SUPABASE_SERVICE_ROLE_KEY` e as chaves do R2 só no Secret Manager e na Vercel (Production).

## VS (preparação)

O VS continua no navegador. Para levá-lo ao servidor, o caminho previsto é: novo `kind = 'vs'` em `export_jobs` (e `output_keys` com um arquivo por stem), um serviço próprio com GPU atrás da mesma fila (a interface `QueueService` não muda, só a URL de entrega) e as mesmas regras de crédito, limite e limpeza. Antes de adicionar um modelo: licença, custo por minuto de áudio, memória e qualidade medida (há medições em `mixpro-cloud-gpu` na memória do projeto). Nenhum código de VS no servidor existe ainda, de propósito.

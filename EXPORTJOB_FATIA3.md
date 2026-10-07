# ExportJob — Etapa 4, fatia 3: serviço de exportação local

Branch `feat/export-server`. Um job roda de ponta a ponta **localmente, sem nuvem e sem Docker**:
o serviço é executado com tsx + FFmpeg portátil, o armazenamento é uma pasta, os jobs ficam num
arquivo JSON, e o catálogo de samples é a tabela pública (ou uma lista fixa nos testes).

- **App web:** nenhuma mudança em `app/` ou `components/`.
- **Código compartilhado alterado:** `lib/export` (só módulos do servidor).
- **Novo:** o serviço `apps/export-service`.

Marcações: [MEDIDO] = medido nesta fatia; [CÓDIGO] = lido no código; [ESTIMATIVA].

## Resumo

- **Paridade:** o serviço gera **o mesmo áudio** (`sha256_f32`) que o `run-export-job.ts` da
  Etapa 3 e que o caminho do app, em todos os cenários e entradas testados [MEDIDO].
- **12 recusas:** cada uma com o código certo, apagando o JSON do job e liberando a reserva.
- **Idempotência:** rodar `/run` de novo não duplica nada.
- **Privacidade:** o teste cobre o serviço e pegou 3 vazamentos injetados.
- **Memória:** 10 min estéreo com remoção de ruído = **1.361 MB** de pico [MEDIDO], abaixo dos
  1,8 GB. Nenhuma redução é necessária agora.
- **Defeito encontrado e corrigido:** o MP3 gravado **por pipe** saía sem o cabeçalho LAME/Xing
  completo, e os players tocavam 23 ms deslocado. Agora vai por arquivo temporário.

## O que foi construído

| Arquivo | O quê |
|---|---|
| `apps/export-service/src/server.ts` | HTTP mínimo (`node:http`) com `POST /run {job_id}` e `GET /healthz`. A primeira linha é o `WorkerGlobalScope` para o RNNoise. Uma execução por vez por instância. Respostas: 200 (done/failed), 404, 409 (o mesmo job já rodando), 429 (ocupado), 503 (falha passageira). |
| `src/pipeline.ts` | Job lido do adaptador, nunca do corpo da requisição → `serverExportJobSchema` + p_ref recalculado → tamanho → ffprobe + limites + decodificação **em fluxo** → conferência com `job.source` → assets **só por ID** → `processJobAudio` (DSP + cortes) → WAV (`exportAudio`, mesmo dither) ou MP3/M4A (FFmpeg) → armazenamento → commit. |
| `src/adapters/storage.ts` | Interface `Storage` (`read` em fluxo, `head`, `put` atômico, `delete`) e `LocalStorage` (pasta). Chaves `in/<uuid>` e `out/<uuid>.<ext>`, validadas. |
| `src/adapters/jobs.ts` | Interface `JobStore`, espelho das RPCs do plano (`start`, `reportProgress`, `commit`, `release`, `requeue`), e `LocalJobStore` (JSON). O commit **só marca done**. O JSON do job (com o CTA) é apagado no done e na falha. |
| `src/adapters/catalog.ts` | `AssetCatalog`: `RestCatalog` (tabelas públicas `drum_samples`/`cab_irs`, só leitura, cache de 5 min) e `StaticCatalog`. |
| `src/errors.ts` | 24 códigos de erro fechados; `RETRYABLE` = asset, armazenamento, timeout e interno. |
| `src/log.ts` | O **único** ponto que escreve no stdout: uma linha JSON por job, só com `job_id`, `status`, `error_code`, duração, canais, taxa, alvo, `cpu_ms`, `rss_mb`, `wall_ms`, `etapas_ms` e `dsp_version`. |
| `lib/export/ffmpeg-decode.ts` | Entrada por arquivo **ou fluxo**; `-protocol_whitelist pipe/file`, `-threads 1` e timeout por processo; lista de contêineres e codecs; códigos novos (`codec`, `layout`, `truncated`, `timeout`). A duração do WAV vem do cabeçalho mesmo em fluxo. As regras de paridade da fatia 2 não mudaram. |
| `lib/export/mp4-edits.ts` | A edit list também é lida em fluxo; avisa quando o índice (`moov`) vem depois dos dados. |
| `lib/export/node-assets.ts` | Cache em **memória** por caminho (Map); disco opcional; caminho do bucket validado; tamanho máximo. |
| `lib/export/ffmpeg-encode.ts` | Módulo compartilhado (era um script): MP3 e M4A por **arquivo temporário**, flags de segurança, timeout. |
| `apps/export-service/Dockerfile`, `.dockerignore` | Imagem (não construída aqui) e exclusões. |
| `scripts/build.mjs`, `scripts/selftest.ts`, `scripts/e2e-local.ts` | Empacotamento (esbuild do tsx), autoteste da imagem e ponta a ponta local. |

**MP4 em fluxo exige o índice no início.**
- O FFmpeg não lê pelo stdin um MP4 com o `moov` no fim. É o caso do MOV original do iPhone e dos
  M4A que o próprio FFmpeg grava sem `+faststart` [MEDIDO].
- **Pela decisão 3 do plano, o aparelho envia só a trilha de áudio**, copiada pelo mediabunny com
  `fastStart`, ou seja, com o índice no início.
- O serviço recusa o outro caso com `UNSUPPORTED_LAYOUT`.
- A cópia da trilha do MOV, feita como o aparelho fará, **decodifica igual ao MOV original**:
  3.018.688 amostras e início 0 nos dois [MEDIDO].

## (a) Paridade: serviço × `run-export-job.ts`

Jobs e entradas da Etapa 3 (`apps/web/.cache/parity`), com o catálogo real e samples/IRs do
bucket público [MEDIDO]:

| Cenário | Amostras | LUFS | Pico | `sha256_f32` serviço = script | Assets do Storage |
|---|---|---|---|---|---|
| Voz com ruído (RNNoise 0,9) | 384000 | -16,1174 | 0,891251 | **IGUAL** | 0 |
| Guitarra: amp + caixa enviada | 288000 | -14,0000 | 0,512913 | **IGUAL** | 1 |
| Bateria com reforço (samples reais) | 288000 | -16,1936 | 0,891251 | **IGUAL** | 4 |
| Bateria a 44,1 kHz (samples reamostrados) | 264600 | -16,1094 | 0,891251 | **IGUAL** | 4 |
| Voz com cortes | 345600 | -14,0000 | 0,635353 | **IGUAL** | 0 |

**Testes automáticos sem rede** (`test/service.test.ts`, no CI): voz com ruído, guitarra com caixa
embutida e bateria sintetizada dão o mesmo `sha256_f32` do caminho do app [MEDIDO].

## (b) Três formatos de saída

Com voz real (`Cantando.mp4`, 48,7 s). O LUFS e o pico do arquivo foram medidos como um player o
toca [MEDIDO]:

| Formato | Duração arquivo × áudio | LUFS arquivo × áudio | Pico arquivo × áudio | Bytes |
|---|---|---|---|---|
| WAV | 48,691 × 48,691 s | -14,330 × -14,330 (Δ 0,000) | -1,00 × -1,00 dBFS | 4.294.572 |
| MP3 320 kbps | 48,691 × 48,691 s | -14,329 × -14,330 (Δ 0,001) | -0,99 × -1,00 dBFS | 1.949.822 |
| M4A AAC 192 kbps | 48,691 × 48,691 s | -14,330 × -14,330 (Δ 0,000) | -0,99 × -1,00 dBFS | 1.173.679 |

Dois achados nos sinais **sintéticos** dos testes:
- **Defeito real, corrigido:** MP3 gravado por pipe ficava sem o cabeçalho LAME/Xing completo.
  Sem ele o player não desconta o atraso do codificador (1.105 amostras, 23 ms). Num sinal que
  liga e desliga, esse deslocamento muda os blocos de 400 ms da medição de LUFS: o mesmo áudio
  mediu -14,023 sem o atraso e -14,225 com ele [MEDIDO]. Hoje o MP3 é gravado em arquivo
  temporário.
- **Limite do formato, não do serviço:** com conteúdo acima de ~20 kHz (ruído branco), o MP3 e o
  AAC cortam essa faixa e o LUFS do arquivo cai 0,07 a 0,23 dB [MEDIDO]. O codificador do app
  também é LAME, então deve acontecer o mesmo [ESTIMATIVA]. Com voz real a diferença foi 0,001 dB.

## (c) Entradas

O serviço lê em fluxo, e a comparação é com o caminho do app em processo, sobre o mesmo arquivo
decodificado [MEDIDO]:

| Entrada | Contêiner / codec | Resultado | `sha256_f32` | Tempo |
|---|---|---|---|---|
| MP4 compartilhado (`Cantando.mp4`) | mov,mp4 / aac | done | **IGUAL** | 1,7 s |
| MOV do iPhone → trilha M4A (como o aparelho enviará) | mov,mp4 / aac | done | **IGUAL** | 4,0 s |
| WAV 16 bits 22,05 kHz mono (projeto) | wav / pcm_s16le | done | **IGUAL** | 0,2 s |
| MP3 CBR (`05 Desire.mp3`, 3 min 43 s) | mp3 / mp3 | done | **IGUAL** | 13,1 s |

## (d) Recusas

Testes automáticos [MEDIDO]. Em todas, o job vira `failed`, o JSON é apagado e a reserva fica
`released`:

| Caso | Código |
|---|---|
| Fora do escopo (legendas no job) | `OUT_OF_SCOPE` |
| Duração medida ≠ declarada | `DURATION_MISMATCH` |
| Taxa medida ≠ declarada | `RATE_MISMATCH` |
| Mais de 10 min medidos (o job declarava 9 min 50 s) | `TOO_LONG` (pelo cabeçalho, antes de decodificar) |
| Contêiner fora da lista (AIFF) | `UNSUPPORTED_FORMAT` |
| Asset por caminho em vez de id | `INVALID_JOB` |
| Sample (id) que não existe no catálogo | `ASSET_NOT_FOUND` |
| Job adulterado (intensidade, com o p_ref antigo) | `REF_INVALID` |
| Arquivo corrompido (bytes aleatórios) | `UNSUPPORTED_FORMAT` |
| MP4 truncado (metade) | `TRUNCATED_INPUT` |
| WAV truncado (60%) | `TRUNCATED_INPUT` |
| MP4 com o índice no fim | `UNSUPPORTED_LAYOUT` |
| `job_id` inexistente | HTTP 404 `JOB_NOT_FOUND` |

Também testado: **caminhos de arquivo no job são ignorados.** Um job com o caminho da IR trocado
gera o mesmo áudio do job limpo, porque o servidor usa só os IDs.

## (e) Retentativa e concorrência

[MEDIDO, testes automáticos]
- **`/run` duas vezes no mesmo job:** a segunda resposta é `done` sem reprocessar (`attempts = 1`),
  com **um commit só** (`commits = 1`) e a saída intacta (mesma data de modificação).
- **Dois `/run` simultâneos:** um processa; o outro recebe 429 (instância ocupada) ou 409 (job já
  rodando); um commit só.
- **Chave de saída fixa por job** (`out/<job_id>.<ext>`): repetir sobrescreve, nunca duplica.

## (f) Privacidade

- O teste estático (`apps/web/lib/export/privacy.test.ts`) cobre o serviço inteiro (`src` e
  `scripts`).
- Nos argumentos de qualquer log, evento ou `fetch` do serviço, ficam proibidos:
  - o job, `job_json`, CTA e `.handle`, legendas;
  - `idempotency_ref`, `audio_ref` e `file_ref`, slug;
  - chaves de armazenamento, nome de arquivo e URLs (em `fetch`, só a URL do próprio pedido é
    permitida).
- Também verifica que **só `src/log.ts` escreve** no stdout/console.
- **3 vazamentos injetados de propósito foram pegos:**
  - JSON do job no log;
  - chave de armazenamento no log;
  - `console.log` fora do `log.ts`.

  Um `job` injetado no `track` do app também foi pego.
- Linha real do serviço, do job de 10 min:
  `{"evento":"export_job","job_id":"cb645a5a-…","status":"done","error_code":null,"duracao_s":600,"canais":2,"taxa":48000,"alvo":"m4a","cpu_ms":100907,"rss_mb":1361,"wall_ms":116302,"etapas_ms":{…},"dsp_version":"2026.10.03"}`
- **Observação (não alterada, código antigo do app):** o painel manda o **slug do preset** para o
  `beginTask` (registro de quedas). Para o app vale a regra anterior, que permite isso; a regra
  mais rígida vale para o serviço. Fica para a branch de limpeza.

## (g) Memória e tempo

10 min estéreo, voz + remoção de ruído, alvo M4A, entrada AAC 256 kbps com índice no início (como
o aparelho enviará). Serviço num **processo próprio** (`tsx src/server.ts`), Windows, i3-10105
[MEDIDO]:

| Medida | Valor |
|---|---|
| Pico de RSS durante o job | **1.361 MB** |
| CPU | 100,9 s |
| Relógio | 116,3 s |
| Etapas | validar 0,02 s · decodificar 1,1 s · assets 0,004 s · **DSP 96,7 s** · **gravar 18,4 s** · armazenar 0,007 s |

- **1.361 MB está abaixo do limite de 1,8 GB:** cabe numa instância de 2 GiB com ~0,6 GiB de folga.
  Não proponho redução agora.
- **No Cloud Run, o `/tmp` fica na RAM** [ESTIMATIVA, confirmar]. O M4A temporário de 10 min tem
  ~14 MB [ESTIMATIVA: 192 kbps]. Se a memória apertar, a primeira redução seria escrever o PCM
  para o FFmpeg direto do `Float32Array`, sem a cópia intercalada, e liberar a entrada logo depois
  do DSP (a referência já é solta).
- **A gravação (18,4 s) pesa:** a conversão para o pipe em JavaScript, amostra por amostra, mais o
  AAC do FFmpeg. Pode ser otimizada depois; não muda o resultado.

## Dockerfile e CI

O que cobrem (a rodar no GitHub Actions; **não foi rodado aqui**):
- **Imagem:**
  - `node:22-bookworm-slim` com FFmpeg do Debian **travado na série 5.1**; o build falha se não
    for 5.1;
  - para fixar a versão exata, passar a string que o CI imprime em `FFMPEG_VERSION`;
  - usuário `node` (sem privilégios);
  - serviço e autoteste num arquivo só cada (7,4 MB).
- **CI, job `testes`:** tipos e testes do serviço com FFmpeg obrigatório, além dos testes do app e
  do contracts.
- **CI, job `imagem-servico`:**
  - constrói a imagem e imprime a versão do FFmpeg;
  - roda o **autoteste dentro da imagem**: job de ponta a ponta nos 3 formatos, mais a
    decodificação do FFmpeg 5.1 contra a referência do app (WAV bit a bit; AAC/MP3 com
    tolerância);
  - sobe o serviço, confere o `/healthz` e se o processo **não roda como root**.
- **Localmente**, o autoteste **empacotado** rodou com Node puro (sem tsx) e passou: WAV e AAC
  idênticos bit a bit, MP3 com ΔLUFS ~1e-6 [MEDIDO, com o FFmpeg portátil desta máquina].

## O que ficou sem testar

- **Docker não foi construído nem rodado aqui** (por decisão). O CI é que vai mostrar se a imagem
  constrói e se o FFmpeg 5.1 do Debian decodifica igual ao FFmpeg desta máquina (versão de
  2026-10). O autoteste aponta isso arquivo por arquivo.
- **O serviço não tem ESLint:** a configuração do app só cobre `apps/web`. Ele tem typecheck
  estrito (`tsc -p apps/export-service`), e o teste de privacidade cobre o código.
- **`LocalJobStore` é seguro só dentro de um processo** (trava em memória). No Cloud Run, com
  várias instâncias, a garantia vem das RPCs do banco (fatia 4).
- **`RestCatalog` e o bucket** só foram exercitados no ponta a ponta local (com rede). O CI usa
  apenas a lista fixa.
- **Sem medição em Linux nem em vCPU de nuvem** (tempo e memória vieram deste Windows).
- **Formatos de entrada ainda PENDENTES de arquivo real** (fatia 2): MP4 original de Android, M4A
  do Gravador do iPhone, MP3 VBR, OGG/Opus e FLAC.

## O que a fatia 4 (banco e crédito) precisa substituir

| Adaptador / ponto | Hoje (fatia 3) | Fatia 4 |
|---|---|---|
| `JobStore.create` | Só nos testes e no e2e | RPC `create_export_job`: lock por usuário, "já pago?", job ativo com o mesmo ref, **reserva**, limites por usuário e diário de CPU (seção 3.2 do plano) |
| `JobStore.start` | JSON: queued → running, `attempts++`, "busy" se recente | RPC `start_export_job`, com a mesma regra de job parado (`staleMs`) |
| `JobStore.reportProgress` | JSON | RPC `report_export_progress` + **Realtime** (só status/progresso) |
| `JobStore.commit` | Só marca done (+ medidas, custo, JSON apagado) | RPC `commit_export_credit`: **débito** com a chave `export:uid:p_ref` + done **na mesma transação**; `INSUFFICIENT_CREDITS` → failed e saída apagada |
| `JobStore.release` | failed + released + JSON apagado | RPC `release_export_credit` (nunca mexe num `charged`) |
| `JobStore.requeue` | Volta a queued | Retentativa do **Cloud Tasks** (503) + limpeza de job parado |
| Âncora do p_ref | `measures.content_fingerprint` já é calculado e gravado | Gravar no primeiro uso do ref e recusar `REF_MISMATCH` (decisão 1); o painel oferece o aparelho |
| Telemetria de divergência | — | `diff_samples`, `diff_duration_ms`, `diff_audio_start_ms`, plataforma (seção 5.5 do plano) |
| Custo diário | `cost.cpu_ms` por job | Somar no dia e recusar `CAPACITY` acima de 6.000 vCPU-s/dia |
| Expiração | `expires_at` gravado, sem limpeza | Cron: `expired`, JSON nulo, objetos removidos |
| `Storage` | Pasta local | R2 com URLs pré-assinadas (fatia 5), mesma interface |
| `AssetCatalog` | REST público (anon) ou lista fixa | Pode continuar no REST público; ou ler pela service role com as RPCs |
| Autenticação do `/run` | `EXPORT_SERVICE_TOKEN` opcional (Bearer) | OIDC do Cloud Tasks (fatias 6 e 7) |

## Mudança de escopo (2026-10-07)

Registrada em `ETAPA4_PLANO.md` (seção 0.1): o app passa a focar só em tratamento de áudio.

- Nada do app foi removido nesta branch.
- O serviço já não faz render nem remux. O `serverExportJobSchema` não mudou e continua recusando
  os campos de vídeo.
- A seção 0.1 também lista os riscos da auditoria que deixam de existir: memória de legendas e de
  render no celular, Whisper e transformers.js, render quadro a quadro e quadros para capa/cor.

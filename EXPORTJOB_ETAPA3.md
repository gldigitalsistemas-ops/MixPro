# ExportJob — Etapa 3: áudio do job rodando em Node

Branch `feat/export-job`. Objetivo: provar que a parte de **áudio** de um ExportJob roda em Node,
sem DOM, com o mesmo resultado do app, e medir o custo para dimensionar um serviço no servidor.
Nada do comportamento do app mudou (ver "O que mudou no código").

## Resumo

- **Paridade exata:** em 5 cenários, o caminho do app e o script Node lendo o job em JSON dão o
  mesmo áudio, amostra por amostra. O WAV gravado também é igual quando o dither é fixado.
- **Samples e caixas do Storage:** o Node agora decodifica igual ao Chrome a 48 kHz. Corrigi a
  regra de conversão de 16 bits depois de comparar com o navegador.
- **Formatos:** WAV roda em Node sem mudanças. MP3 e M4A não rodam com o codificador do app; o
  protótipo com FFmpeg nativo funciona.
- **Bloqueios por DOM no áudio:** nenhum que impeça. Há uma checagem de ambiente no RNNoise,
  contornada com uma linha.
- **Custo:** um job usa 1 vCPU e roda 5 a 25× mais rápido que o tempo real. O mais caro é a remoção de ruído (~10 s de CPU por minuto de áudio). O pico de memória chega a ~1,7 GB em 10 min estéreo. A estimativa é de ~230 a ~750 minutos de áudio estéreo por vCPU-hora de nuvem, conforme a cadeia.

## 1. Script `apps/web/scripts/run-export-job.ts`

```
cd apps/web
../../packages/contracts/node_modules/.bin/tsx --env-file=.env.local scripts/run-export-job.ts \
  --job job.json --in entrada.wav --out saida.wav [--music musica.wav] [--seed 123] [--ffmpeg /usr/bin/ffmpeg]
```

1. Valida o job com o schema zod (`exportJobSchema`).
2. Lê o WAV de entrada e confere a taxa e os canais contra o job.
3. Carrega samples e IRs.
4. Roda `processAudio` (`lib/export/process-audio.ts`), o mesmo código do worker do app.
5. Aplica os cortes (`spliceAudio`) e a música de fundo (`mixMusic` + `safeCeiling`), na mesma
   ordem do `executeExportJob`.
6. Grava o arquivo:
   - WAV pelo `exportAudio` do app, com o mesmo dither;
   - MP3/M4A pelo FFmpeg (`--ffmpeg`).
7. Imprime um JSON com: duração, amostras, canais, LUFS integrado, pico de amostra, `sha256_f32`
   (impressão digital do áudio float antes do dither), hash do arquivo, uso dos assets e custo
   (relógio, CPU, pico de RSS e tempo por etapa).

## 2. Samples de bateria e IRs em Node — `lib/export/node-assets.ts`

- **Bucket:** `drum-samples` é **público**. O download funciona sem chave (HTTP 200) e o script é
  só leitura.
- **Cache em disco:** fica em `.cache/export-assets`, que está no `.gitignore`. Os arquivos do
  Storage nunca mudam, porque cada envio grava com um UUID novo no caminho, então o cache não
  precisa de invalidação.
- **Mesmo tratamento do app:** extraí de `lib/drums/library.ts` para `lib/drums/asset-process.ts`
  (mono, recorte do ataque e da cauda, camadas, normalização da IR), só movendo o código. O app
  continua decodificando com `OfflineAudioContext`; o Node lê o WAV direto.
- **Decodificação comparada com o Chrome**, com os 5 arquivos reais usados nos cenários:

| Taxa do áudio | Resultado |
|---|---|
| 48 kHz (a dos arquivos da biblioteca) | **idêntico** amostra a amostra nos 5 arquivos |
| 44,1 kHz (reamostragem) | **não idêntico**: o Chrome tem 1 amostra a mais em 4 dos 5 arquivos; erro relativo de -55 a -82 dB, diferença máxima de 3,1e-3 |

- **A primeira versão divergia** em até 1 nível de 16 bits. O Chrome converte inteiro de 16 bits
  em float de forma assimétrica e em float32: positivos × (1/32767), negativos × (1/32768). Com
  essa regra, a diferença caiu de 9.605 amostras para 0. Ela está em `lib/export/wav.ts`, com teste.
- **A 44,1 kHz:** o Chrome reamostra com o algoritmo dele e o Node usa o do app
  (`lib/dsp/resample`). O script avisa com `"aproximado": true`. Para ficar idêntico, os dois
  lados teriam de usar o mesmo reamostrador (ver "Riscos").
- **IRs da biblioteca:** samples e IRs enviados são WAV mono de 16 bits a 48 kHz. As caixas do
  Mix Pro (`mp:`) são geradas em código, iguais nos dois lados.

## 3. Paridade

Os cenários são montados com o `buildExportJob` do app e a biblioteca real do banco (só leitura).

- **(a)** Caminho do app em processo: job em memória → `processAudio` → cortes → `exportAudio`.
- **(b)** `run-export-job.ts` num processo separado: lê o job do JSON e o WAV do disco, e baixa os
  samples e IRs do Storage (com cache).

Comparação:
- impressão digital exata do áudio float;
- hash do WAV gravado, com o mesmo dither fixado (`--seed`);
- se não bater, tolerância: amostras exatas, LUFS ±1e-5 dB, pico 1e-6 relativo.

Para repetir: `tsx --env-file=.env.local scripts/parity-export-job.ts`.

| Cenário | Taxa | Amostras | LUFS | Pico | Float (exato) | WAV (dither fixo) | Tolerância | Reamostrado | Assets do Storage |
|---|---|---|---|---|---|---|---|---|---|
| Voz com ruído (RNNoise 0,9 + redes) | 48 kHz | 384000 | -16,1174 | 0,891251 | **igual** | **igual** | ok | não | 0 |
| Guitarra: amp + caixa enviada (IR) | 48 kHz | 288000 | -14,0000 | 0,512913 | **igual** | **igual** | ok | não | 1 |
| Bateria com reforço (samples reais) | 48 kHz | 288000 | -16,1936 | 0,891251 | **igual** | **igual** | ok | não | 4 |
| Bateria a 44,1 kHz | 44,1 kHz | 264600 | -16,1094 | 0,891251 | **igual** | **igual** | ok | sim | 4 |
| Voz com cortes | 48 kHz | 345600 | -14,0000 | 0,635353 | **igual** | **igual** | ok | não | 0 |

Nenhum cenário divergiu, então não houve etapa de divergência a apontar.

**Elo com o navegador.** A tabela compara o caminho do app e o script, ambos em Node. A
equivalência com o navegador vem de três provas somadas:
- o `processAudio` é o mesmo código que o worker do app executa, e os golden da Etapa 1/2 batem
  bit a bit;
- a decodificação de samples e IRs é idêntica à do Chrome a 48 kHz (seção 2);
- o WAV de saída usa o mesmo `encodeWav`.

O que não está provado bit a bit é o áudio de 44,1 kHz com samples ou IRs enviados, por causa da
reamostragem.

## 4. Gravação do arquivo final

| Formato | Em Node sem mudanças? | Detalhe |
|---|---|---|
| **WAV** | **Sim** | `exportAudio(…, "wav")` usa `encodeWav` (DataView + Blob, ambos existem em Node 22). |
| **MP3** | **Não** | Ver os dois motivos abaixo. |
| **M4A (AAC)** | **Não** | Mesmos dois motivos. |

Por que MP3 e M4A não rodam:
1. Sob o tsx, os codificadores em WebAssembly do mediabunny se registram numa **segunda cópia** do
   pacote ("Mediabunny was loaded twice"). O `canEncodeAudio` dá falso
   (`lib/media/export.ts:31-36`) e o app lança "não consegue gerar MP3" (`:166`).
2. Mesmo resolvendo isso, o envio do áudio cria `new AudioBuffer(...)` (`lib/media/export.ts:45`),
   da Web Audio, que não existe em Node. O render de vídeo faz o mesmo (`lib/media/render.ts:39`).

**Protótipo com FFmpeg nativo** (`apps/web/scripts/ffmpeg-encode.ts`):
- Recebe o áudio float **já processado** (sem tocar no DSP) e codifica nas mesmas taxas do app.
  O `QUALITY_HIGH` do mediabunny dá MP3 a ~320 kbps e AAC a 192 kbps.
- O MP3 sai pelo pipe. O M4A vai para um arquivo temporário, porque o índice no início do arquivo
  (faststart) exige voltar ao começo dele.
- Testado com um build oficial do FFmpeg baixado só para a pasta temporária (nada no projeto),
  no cenário de voz de 8 s:

| Formato | Tamanho | Duração lida | LUFS lido (float: -16,12) | Pico | Tempo de gravação |
|---|---|---|---|---|---|
| MP3 320 kbps (libmp3lame) | 321.644 B | 8,04 s (atraso do codificador MP3) | -16,2 | — | ~0,2 s |
| M4A AAC 192 kbps | 191.173 B | 8,00 s | -16,1 | -1,0 dBFS | ~0,3 s |

- MP3 e AAC são com perda, então nunca vão bater bit a bit com o arquivo do navegador. O
  navegador usa o codificador do sistema ou o WebAssembly do mediabunny, e o servidor usa o
  libmp3lame/aac do FFmpeg. A aceitação deve ser por medida: duração, LUFS ±0,1 e pico.

**Dither**
- O app grava o WAV com dither aleatório: `(Math.random() - Math.random()) / 32768` em cada
  amostra (`lib/media/export.ts:142`). Por isso **dois WAVs do mesmo job nunca são iguais byte a
  byte**: a diferença é um ruído em torno de -96 dBFS.
- MP3 e AAC são codificados a partir do float, sem esse dither.

Como o servidor deve se comportar:
- **Manter o dither aleatório em produção**, como no app; não alterei `lib/media/export.ts`.
- **Não usar o hash do arquivo para nada que exija igualdade** (cache, deduplicação, verificação).
  A cobrança já usa o `idempotency_ref`.
- **Guardar o arquivo gerado** e servir o mesmo arquivo num novo download, em vez de gerar de novo.
- **Para conferir o resultado**, usar o `sha256_f32` do áudio float antes do dither, que é
  determinístico e o script imprime, ou um teste de nulo.

Para testes, há duas opções:
1. **Já disponível:** `--seed N` no script troca o `Math.random` só naquele processo, durante a
   gravação. Os testes de paridade usam isso.
2. **Proposta, não feita:** um parâmetro opcional `random` em `encodeWav`/`exportAudio`, com padrão
   `Math.random`. Assim o teste injeta um gerador fixo sem mexer em globais, e o comportamento do
   app não muda.

## 5. Dependências de DOM/Web APIs no caminho de áudio

Nenhuma impede a execução em Node:

| Arquivo:linha | O quê | Em Node | O que trocar (não feito) |
|---|---|---|---|
| `node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js:17` | Recusa rodar sem `window` ou `WorkerGlobalScope` ("not compiled for this environment"). | Contornado com 1 linha: `globalThis.WorkerGlobalScope = function(){}` antes de carregar, no script. Testado: determinístico. | Num serviço, deixar essa linha no ponto de entrada, ou usar um build do RNNoise compilado para Node. |
| `lib/media/export.ts:31-36, 45` | Codificadores MP3/AAC do mediabunny e `AudioBuffer`. | Não roda. | FFmpeg (seção 4), ou trocar `AudioBufferSource` por `AudioSampleSource` + um codificador que rode em Node. |
| `lib/drums/library.ts` (`decode`, `loadIR`) | `OfflineAudioContext.decodeAudioData` e `fetch(..., { cache: "force-cache" })`. | Não é usado no servidor. | Substituído por `lib/export/node-assets.ts` (feito). |
| `lib/dsp/runner.ts:35`, `lib/dsp/dsp.worker.ts:30-33` | `new Worker` e `self.postMessage` (só o empacotamento do app). | Não é usado. | O Node chama `processAudio` direto (feito). |
| `lib/media/load.ts:85, 136-168` | Decodificação do arquivo do usuário (mediabunny/WebCodecs e `decodeAudioData`). | Não roda. | O servidor recebe um WAV ou decodifica a mídia enviada com FFmpeg. Necessário para jobs reais. |
| `lib/mix.ts` → `lib/user-presets.ts` | Importa o cliente Supabase do navegador no nível do módulo. | Carrega sem erro; não é executado. | Mover `freezeChain` para um módulo sem Supabase, só por higiene. |

## 6. Tempo e memória

**Máquina [MEDIDO]:** Intel Core i3-10105 @ 3,70 GHz, 4 núcleos / 8 threads, 11,6 GB de RAM, Windows 10, Node 22.15.0.

**Como foi medido:**
- `scripts/bench-export-job.ts` roda cada caso num **processo novo** do `run-export-job.ts`, então
  o pico de RSS de um caso não contamina o outro.
- O tempo vai da leitura do WAV à gravação do WAV final, incluindo os samples e IRs (já em cache).
- A partida do tsx não entra na conta.
- Entradas: WAV de 16 bits a 48 kHz, com material sintético repetido até a duração pedida.
- Todas as cadeias com intensidade 75 e "Volume ideal para redes" ligado.

**[MEDIDO]** 24 casos, todos sem falha:

| Cadeia | Áudio | Canais | Relógio | CPU | × tempo real | Pico RSS |
|---|---|---|---|---|---|---|
| Voz (leve) | 1 min | mono | 2,6 s | 2,6 s | 22,7× | 204 MB |
| Voz (leve) | 1 min | estéreo | 3,7 s | 3,8 s | 16,1× | 267 MB |
| Voz (leve) | 3 min | mono | 7,3 s | 7,2 s | 24,5× | 361 MB |
| Voz (leve) | 3 min | estéreo | 10,4 s | 10,1 s | 17,4× | 619 MB |
| Voz (leve) | 10 min | mono | 23,7 s | 23,7 s | 25,4× | 971 MB |
| Voz (leve) | 10 min | estéreo | 33,6 s | 33,3 s | 17,8× | 1401 MB |
| Voz + remoção de ruído | 1 min | mono | 11,5 s | 11,3 s | 5,2× | 269 MB |
| Voz + remoção de ruído | 1 min | estéreo | 11,4 s | 11,8 s | 5,3× | 328 MB |
| Voz + remoção de ruído | 3 min | mono | 30,4 s | 30,3 s | 5,9× | 429 MB |
| Voz + remoção de ruído | 3 min | estéreo | 33,5 s | 33,4 s | 5,4× | 723 MB |
| Voz + remoção de ruído | 10 min | mono | 99,5 s | 99,4 s | 6,0× | 1124 MB |
| Voz + remoção de ruído | 10 min | estéreo | 109,3 s | 108,9 s | 5,5× | 1672 MB |
| Guitarra: amp + caixa enviada | 1 min | mono | 4,1 s | 4,3 s | 14,5× | 213 MB |
| Guitarra: amp + caixa enviada | 1 min | estéreo | 7,4 s | 7,9 s | 8,1× | 267 MB |
| Guitarra: amp + caixa enviada | 3 min | mono | 11,9 s | 12,1 s | 15,1× | 454 MB |
| Guitarra: amp + caixa enviada | 3 min | estéreo | 21,1 s | 21,5 s | 8,5× | 548 MB |
| Guitarra: amp + caixa enviada | 10 min | mono | 39,4 s | 39,6 s | 15,2× | 1295 MB |
| Guitarra: amp + caixa enviada | 10 min | estéreo | 72,6 s | 73,0 s | 8,3× | 1624 MB |
| Bateria com reforço (samples) | 1 min | mono | 2,7 s | 2,9 s | 22,0× | 223 MB |
| Bateria com reforço (samples) | 1 min | estéreo | 4,0 s | 4,4 s | 14,8× | 285 MB |
| Bateria com reforço (samples) | 3 min | mono | 7,7 s | 8,2 s | 23,3× | 444 MB |
| Bateria com reforço (samples) | 3 min | estéreo | 11,1 s | 11,7 s | 16,3× | 640 MB |
| Bateria com reforço (samples) | 10 min | mono | 24,7 s | 25,4 s | 24,3× | 1014 MB |
| Bateria com reforço (samples) | 10 min | estéreo | 36,5 s | 37,1 s | 16,4× | 1447 MB |

**O que os números mostram [MEDIDO]:**
- **Uma linha de execução por job:** CPU/relógio ficou entre 0,97 e 1,08 em todos os casos.
  Um job ocupa **1 vCPU**, e dá para rodar vários jobs em paralelo, um por vCPU.
- **O mais caro é a remoção de ruído (RNNoise):** cerca de 10 s de CPU por minuto de áudio, 4 a 5
  vezes o custo da cadeia de voz sozinha. Na voz com ruído ele domina; o estéreo quase não pesa,
  porque o RNNoise trabalha na média dos canais.
- **A guitarra com amplificador** custa ~4 s/min em mono e ~7 s/min em estéreo.
- **Memória:** cresce com a duração. 10 min em estéreo chegam a **1,4–1,7 GB** de pico, porque
  ficam na memória a entrada e as cópias intermediárias de cada etapa.
- **Gravação MP3/M4A pelo FFmpeg [MEDIDO, só 8 s de áudio]:** 0,2–0,3 s. Projetando de forma
  linear **[ESTIMATIVA]**, dá ~1,5–2,5 s por minuto de áudio, quase tudo na conversão para o pipe
  em JavaScript. Vale medir com áudio longo antes de dimensionar.

**Capacidade [ESTIMATIVA]:**
- Conta: 3600 s ÷ (s de CPU por minuto de áudio), usando os casos de 10 min.
- A coluna "vCPU de nuvem" desconta 30%, porque uma vCPU típica (meio núcleo físico, 2,5–3,5 GHz)
  costuma render menos que uma thread deste i3 a 3,7 GHz.

| Cadeia | Mono (min de áudio / vCPU-hora, nesta máquina) | Estéreo | Estéreo, vCPU de nuvem (×0,7) |
|---|---|---|---|
| Voz (leve) | ~1.520 | ~1.080 | **~750** |
| Voz + remoção de ruído | ~360 | ~330 | **~230** |
| Guitarra: amp + caixa | ~910 | ~490 | **~340** |
| Bateria com reforço | ~1.420 | ~970 | **~680** |

**Dimensionamento sugerido [ESTIMATIVA]:**
- Reservar **~2 GB de RAM por job simultâneo** até 10 min em estéreo (pico medido: 1,7 GB).
- Exemplo: um container de 2 vCPU e 4 GB processa 2 jobs ao mesmo tempo.
- No pior caso (voz com ruído, estéreo), isso dá ~460 minutos de áudio por hora; num mix típico
  de voz sem ruído, ~1.500.
- Esses números precisam ser confirmados na máquina de destino (Linux, vCPU real) com o mesmo
  `bench-export-job.ts`.

## 7. Recomendação: como o serviço deve gravar o arquivo final

1. **Áudio:**
   - rodar `processAudio` + cortes + música em Node (este script é o núcleo);
   - gravar **WAV** pelo `exportAudio` do app, o mesmo código, com o mesmo dither;
   - gravar **MP3/M4A** com **FFmpeg nativo** a partir do áudio float final (`ffmpeg-encode.ts`):
     `libmp3lame` 320 kbps e `aac` 192 kbps com `+faststart`;
   - aceitar por medida (duração, LUFS ±0,1 dB, pico), nunca por hash;
   - colocar no contêiner um FFmpeg de versão fixa: o build estático da imagem ou o pacote da
     distribuição, sempre com a mesma versão.
2. **Entrada:**
   - o cliente envia o arquivo original, e o servidor decodifica com FFmpeg para float na taxa do
     job (`-f f32le`);
   - para paridade com o app, a decodificação do servidor precisa ser validada contra a do
     navegador, como foi feito aqui com os samples. É o maior risco de diferença.
3. **Samples e IRs:** usar `loadJobAssets` com um volume de cache persistente. Os arquivos não
   mudam, então é seguro guardar para sempre.
4. **Verificação:** registrar o `sha256_f32` e as medidas de cada job (sem o conteúdo do job nos
   logs, como na regra de privacidade da Etapa 2).

## 8. O que falta para o servidor executar jobs de VÍDEO

1. **Decodificar o vídeo do usuário.** `lib/media/load.ts` e `render.ts:79,111` usam
   mediabunny + WebCodecs (`BlobSource`, `CanvasSink`). Em Node: FFmpeg para quadros e áudio.
2. **Compor os quadros.** `lib/media/compose.ts` (`composeFrame`, desfoque, selo, antes/depois,
   CTA) e `lib/captions/model.ts` (`drawCaptions`) desenham com Canvas 2D e `OffscreenCanvas`
   (`render.ts:90-91`, `compose.ts:185-192`). Há três caminhos possíveis:
   - **(a)** Chrome headless (Puppeteer) rodando o mesmo `renderVideo`: maior fidelidade, custo
     alto de CPU e RAM;
   - **(b)** um canvas para Node (`skia-canvas` ou `@napi-rs/canvas`) com a mesma API de desenho,
     mais FFmpeg para codificar. Exige trocar `OffscreenCanvas` por uma fábrica de canvas
     injetável e registrar as fontes;
   - **(c)** reescrever como filtros do FFmpeg: fidelidade baixa, não recomendado.
3. **Cor, nitidez e vinheta.** `ColorGrader` usa WebGL (`color.ts:209-229`). No servidor, usar o
   `CpuGrader`, que já existe, ou WebGL headless. Validar que o resultado da CPU bate com o do
   WebGL.
4. **Fontes das legendas.** `lib/captions/font.ts` (`ensureCaptionFont`, `captionFontFamily` lido
   do CSS). O servidor precisa dos mesmos arquivos de fonte e da mesma `font_family` do job
   (licença verificada).
5. **Codificar vídeo e áudio.** `CanvasSource` / `AudioBufferSource` (WebCodecs,
   `render.ts:93-94`) dão lugar ao FFmpeg (libx264 + aac). Os quadros nunca vão bater bit a bit
   com o H.264 do navegador; definir aceitação por SSIM/PSNR por quadro e sincronia.
6. **Só trocar o áudio** (`exportVideo`, `export.ts:58-109`, `Conversion` do mediabunny). Em Node
   vira um remux do FFmpeg: `-c:v copy` com o áudio novo em AAC, respeitando `audio_start_s`.
7. **Enviar os arquivos.** Hoje `upload_ref` é sempre null: falta subir para o Storage o vídeo
   original, a música de fundo e a imagem do audiograma, e preencher `upload_ref`.
8. **Fila, débito e limpeza.** Executar o job no servidor, debitar só na entrega
   (`spend_export_credit` com o `idempotency_ref`, alteração ainda não feita), guardar o arquivo
   para novos downloads e apagar os temporários.
9. **Testes de vídeo no servidor.** Hashes de quadros ou SSIM contra o navegador para os
   formatos 9:16, 1:1, 4:5 e 16:9, legendas, CTA, selo e antes/depois.

## O que mudou no código (Etapa 3)

| Arquivo | O quê | Muda o app? |
|---|---|---|
| `lib/drums/asset-process.ts` (novo) + `lib/drums/library.ts` | Tratamento de samples/IR extraído, sem mudança, para servir ao navegador e ao Node. | Não (código movido) |
| `lib/export/wav.ts` (novo) + teste | Leitura de WAV igual ao Chrome; WAV float para testes. | Não (só usado em Node) |
| `lib/export/node-assets.ts` (novo) | Samples e IRs do Storage em Node, com cache. | Não |
| `scripts/run-export-job.ts`, `scripts/ffmpeg-encode.ts`, `scripts/parity-export-job.ts`, `scripts/bench-export-job.ts` (novos) | Script, protótipo de codificação, paridade e medição. | Não |
| `.gitignore` | `apps/web/.cache/` | Não |

**Suíte [MEDIDO]:**
- 148 testes do app (eram 144, mais 4 de `wav.test.ts`) e 7 do contracts passam.
- Os golden passam nos níveis exato e de tolerância, sem edição nos arquivos golden.
- Typecheck e lint limpos, build de produção ok.
- O único arquivo do app que mudou foi `lib/drums/library.ts`, por extração de código; os testes
  e a paridade com o Chrome cobrem esse ponto.

## Riscos restantes

- **44,1 kHz com samples ou IRs enviados:** o servidor não fica bit a bit igual ao navegador,
  com erro de -55 a -82 dB. Para igualar, os dois lados precisam decodificar a 48 kHz e
  reamostrar com o reamostrador do app. Isso muda o som do app de forma ínfima e exige
  regenerar o golden.
- **Decodificação da mídia do usuário no servidor:** o FFmpeg × WebCodecs/`decodeAudioData`
  ainda não foi validado e é a maior fonte provável de diferença.
- **24 e 32 bits inteiros:** a conversão para float em `wav.ts` não foi conferida contra o
  Chrome. Os arquivos da biblioteca são todos de 16 bits.
- **Checagem de ambiente do RNNoise:** depende de uma linha no ponto de entrada do serviço.

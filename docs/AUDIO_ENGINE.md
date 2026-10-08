# Motor de áudio (Audio Engine)

Código em `apps/web/lib/dsp` e `apps/web/lib/export`. O mesmo código roda no navegador (Web Worker) e no Node (serviço de exportação). Alterar o som de propósito exige subir `DSP_VERSION` (`lib/dsp/version.ts`) e regenerar os golden de `lib/export/fixtures`.

## Pipeline

```
decodificar (taxa original, até 2 canais) → [remoção de ruído, só fala]
→ cadeia do preset (runChain, intensidade 25/50/75/100) → [reverb/bateria/master do usuário]
→ ajuste final de volume (destino) → cortes → gravar (WAV 16 bits com dither, MP3 ou M4A)
```

Processamento em ponto flutuante; a conversão final é a única etapa com perda. `processAudio` (`lib/export/process-audio.ts`) é o ponto de entrada comum.

## Módulos (cada um é independente)

| Grupo | Módulos (`@mixpro/contracts` `MODULES`) | Arquivo |
|---|---|---|
| Ganho e tom | `gain`, `normalize`, `saturation`, `soft_clip` | `tone.ts` |
| Filtros e EQ | `highpass`, `lowpass`, `eq_peak`, `eq_shelf` | `filters.ts` |
| Dinâmica | `compressor`, `gate`, `limiter` (lookahead) | `dynamics.ts` |
| Espaço | `reverb`, `delay`, `stereo_width` | `space.ts` |
| Guitarra e baixo | `amp`, `overdrive`, `chorus`, `octaver`, caixas/IR (`cab-ir.ts`, `convolve.ts`) | `amp.ts`, `pedals.ts` |
| Bateria | `drum_studio`: detecta bumbo, caixa, tons e surdo e mistura os samples | `drums/` |
| Ruído | RNNoise (WASM), só para fala | `denoise.ts` |
| Medição | LUFS (BS.1770-4), true peak, LRA, bandas, DC, estéreo | `loudness.ts`, `diagnose.ts` |

Um preset é uma lista de módulos com parâmetros `{value, neutral}`; a intensidade interpola entre o neutro e o valor.

## Análise e diagnóstico

- `analyze.ts` classifica o conteúdo (fala, canto, bateria, instrumento, música) e escolhe preset, intensidade e remoção de ruído (Mix Pro Auto). O palpite de instrumento (baixo, violão, guitarra) e de gravação (microfone ou plugado) pode ser trocado pela pessoa.
- `diagnose.ts` mede o áudio e gera achados com limites explícitos: clipping, ruído de fundo, volume baixo ou alto, excesso de graves e agudos, dinâmica comprimida ou aberta, estéreo desequilibrado ou em fases opostas, DC offset e silêncio. Roda num Web Worker, no trecho de até 90 s do meio do arquivo (avisado na tela quando é só um trecho). O contexto do conteúdo evita falso alarme (graves em bateria ou baixo).

## Masterização: destinos de volume

O ajuste final leva a loudness integrada ao alvo e garante o teto de pico com o limiter. Os destinos ficam em `packages/contracts/src/delivery.ts`:

| Destino | LUFS | Teto | Uso |
|---|---|---|---|
| Natural | -18 | -1 dBFS | sobe o volume sem esmagar a dinâmica |
| Podcast e fala | -16 | -1 dBFS | podcast e áudio falado |
| Redes, YouTube e streaming (padrão) | -14 | -1 dBFS | Instagram, TikTok, YouTube, Spotify |
| Alto (impacto) | -9 | -1 dBFS | bem mais forte; as plataformas podem abaixar o volume |

O destino padrão tem exatamente a chave de cache e o `p_ref` de sempre; os outros acrescentam um sufixo à chave do áudio. O limiter limita pico de amostra; o **true peak** (oversampling de 4×) é medido e mostrado, mas ainda não é um limitador de true peak.

## Preservação do original

O áudio original nunca é alterado: a prévia usa cópias e a exportação gera um arquivo novo. O A/B (`components/audio/ab-player.tsx`) alterna original e tratado com igualização de volume opcional.

## Testes

`pnpm --filter @mixpro/web test` não existe como atalho; os testes usam `node:test` com `tsx`:

```
node packages/contracts/node_modules/tsx/dist/cli.mjs --test apps/web/lib/**/*.test.ts
```

Incluem: golden de áudio (paridade bit a bit com o app), decodificação contra o Chrome, diagnóstico (sinais sintéticos com resposta conhecida), destinos de volume, cadeia por tipo. Os que precisam do FFmpeg são pulados sem `FFMPEG_PATH`/`FFPROBE_PATH` (e falham com `REQUIRE_FFMPEG=1`, como no CI).

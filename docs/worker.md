# Worker de áudio: rodar no seu PC, depois na VPS

O worker é um programa independente que **busca trabalhos na fila** (no Supabase), processa o áudio e devolve o resultado ao storage. Ele só precisa de internet de saída: nenhuma porta aberta, nenhum IP fixo, nenhum túnel.

```
Supabase (fila) ◄── worker pergunta "tem trabalho?" a cada 1–5 s
Storage R2      ◄── worker baixa o original e envia o resultado
```

Se o worker estiver desligado, os pedidos ficam na fila, o app avisa "Processamento temporariamente indisponível" e tudo é processado quando ele voltar.

## 1. No seu PC (Windows, com Docker Desktop)

Docker é o caminho recomendado. Ele usa a mesma imagem Linux da VPS, já vem com ffmpeg e Python 3.12 e não depende da versão de Python instalada no Windows.

1. Abra o Docker Desktop.
2. Em `apps\worker`, copie `.env.example` para `.env` e preencha:
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API)
   - `S3_*` (Cloudflare R2 → R2 → Manage API Tokens)
3. No terminal, dentro de `apps\worker`:
   ```powershell
   docker compose up -d --build
   docker compose logs -f     # acompanhar
   ```
4. No app, **Admin → Jobs** mostra o worker online.

Para parar: `docker compose down`. Com `restart: unless-stopped`, ele volta sozinho quando o Docker Desktop inicia.

> Observação desta máquina: a pasta do usuário tem acento ("Cartório Tanguá") e o Docker não encontra o helper de credenciais nesse caminho. Se `docker compose up --build` falhar com `docker-credential-desktop`, abra o Docker Desktop → Settings → e faça login, ou rode o comando pelo terminal do próprio Docker Desktop.

## 2. Numa VPS Linux (quando quiser tirar do PC)

Qualquer VPS com 2 vCPU e 4 GB de RAM atende bem no início (Hetzner, Contabo, DigitalOcean, Oracle Free Tier).

```bash
curl -fsSL https://get.docker.com | sh
git clone <seu-repo> mixpro && cd mixpro/apps/worker
cp .env.example .env && nano .env      # mesmas variáveis
docker compose up -d --build
```

Pronto. Nenhuma mudança no app. Pode até manter o worker do PC ligado ao mesmo tempo: a fila garante que **cada trabalho é pego por um único worker** (`FOR UPDATE SKIP LOCKED`).

## 3. Mais capacidade

```bash
docker compose up -d --scale worker=3
```

Cada worker processa um trabalho por vez. Previews têm prioridade sobre exportações completas.

## Desenvolvimento (sem Docker)

Requer Python 3.11–3.13 (o Python 3.14 desta máquina ainda não tem todas as bibliotecas de áudio) e ffmpeg no PATH.

```powershell
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
pytest
python -m mixpro_worker
```

## O que o worker faz

| Job | O que é |
|---|---|
| `analyze` | Valida o upload (corrompido? silêncio? duração?), extrai metadados, gera a waveform, sugere o melhor trecho para preview e converte WAV/AIFF para FLAC sem perdas. |
| `preview` | Processa um trecho de 30 s com o preset e a intensidade, e gera o trecho original equivalente para o A/B. Usa pré-roll de 2 s para compressores e reverbs "aquecerem". |
| `render` | Processa o arquivo inteiro e exporta em WAV (16 ou 24 bits, igual à fonte) ou MP3 320 kbps, com controle de qualidade. |
| manutenção | A cada 10 min (um único worker por vez): apaga previews e renders expirados, uploads abandonados e projetos excluídos. |

Os logs saem em JSON, uma linha por evento, com `job_id`, `user_id`, `project_id`, tipo, preset, duração, status e erro.

## Motor DSP

Determinístico: a mesma entrada gera exatamente a mesma saída. Módulos:

`gain · highpass · lowpass · eq_peak · eq_shelf · compressor · limiter · gate · saturation · soft_clip · stereo_width · delay · reverb · normalize`

- Filtros Butterworth e EQ biquad (RBJ Cookbook)
- Compressor feed-forward com knee suave (Giannoulis/Massberg/Reiss) e limiter com lookahead sem overshoot, compilados com numba
- Saturação e soft clip com oversampling 4x (menos aliasing)
- Reverb Freeverb (pedalboard) e delay com feedback filtrado
- Loudness ITU-R BS.1770 (pyloudnorm), true peak com oversampling 4x

A duração do áudio é sempre preservada: caudas de reverb e delay além do fim são cortadas, para manter o alinhamento com vídeo e outras pistas.

Mudou o comportamento de algum módulo? Aumente `dsp_engine_version` no admin. Isso invalida o cache de previews antigos.

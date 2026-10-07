# Etapa 4: plano do servidor de exportação de ÁUDIO

Só o plano. Nenhum código de produção, migração, alteração no app ou deploy foi feito.
Escopo: jobs `kind: "audio"` e vídeo "só trocar o áudio" (remux, sem render).

Legenda das marcações:
- **[CÓDIGO]**: lido no código ou nas migrações do repositório.
- **[MEDIDO]**: medido nas Etapas 1 a 3.
- **[ESTIMATIVA]**: conta ou suposição minha.
- Preços públicos foram consultados em 2026-10-03. Os do R2 vêm da página oficial. Os do Cloud
  Run vêm de uma busca, porque a página oficial não carregou: **confirme antes de decidir**.
- Câmbio usado nas contas: **R$ 5,50 / US$ [ESTIMATIVA]**.

---

## 0. O que já existe e muda o desenho

- **Cobrança hoje:** `spend_export_credit(p_ref, p_kind)` chama `grant_credits(uid, 'download',
  'DOWNLOAD', -1, …, idempotency_key = 'export:' || uid || ':' || p_ref)`
  [CÓDIGO: `20260929000001_free_app.sql:75-94`, `20260924000001_foundation.sql:147-183`].
  - O ledger tem `idempotency_key` **único**, com lock por usuário (`pg_advisory_xact_lock`).
  - Repetir o mesmo `p_ref` devolve a transação já existente e não cobra de novo.
  - **O plano usa exatamente essa chave**, para que pagar no aparelho e no servidor seja a mesma
    coisa.
- **Formato do `p_ref`:** precisa casar com `^[a-zA-Z0-9:_-]{8,128}$` [CÓDIGO]. O
  `idempotency_ref` do job já segue esse formato [MEDIDO na Etapa 2: ex.
  `57e8e170_vocal-pop-limpo_75_1_n0_x43cd0b20_e6da8012a_wav`].
- **Tabelas legadas** `processing_jobs`, `audio_files`, `download_grants` e `download_events`
  [CÓDIGO: `20260924000002_audio.sql`]:
  - foram feitas para o worker Python antigo (projetos, faixas, heartbeat de worker, `job_type`
    = analyze/preview/render…);
  - o app atual só cita `processing_jobs` numa tela do admin [CÓDIGO].
- **Decodificação no app** [CÓDIGO: `lib/media/load.ts`]: tem 3 caminhos.
  1. **Principal:** WebCodecs via mediabunny, na **taxa original** do arquivo. Descarta o
     pré-enchimento do AAC (`first < 0`) e define `audioStart = max(0, primeiro timestamp)`.
  2. **Cópia da trilha + `decodeAudioData`** (iPhone antigo).
  3. **`decodeAudioData` do arquivo inteiro a 48 kHz** (reamostra).

  Os três ficam com no máximo 2 canais, e um **estéreo com os dois canais idênticos vira mono**.
  O servidor precisa reproduzir **essas regras**, não só "decodificar".
- **Limites atuais do app** [CÓDIGO: `load.ts:33`]: no celular, 5 min para vídeo e 10 min para
  áudio; no computador, 15 min.
- **Jobs do escopo nunca levam legendas nem CTA** [CÓDIGO: `needsRender`]. Legenda e CTA forçam o
  render, que está fora do escopo. Para arquivo de áudio o painel nem os aplica. Então **o
  servidor pode recusar** qualquer job com `captions` ou `look.cta` não nulos, e o maior risco de
  privacidade (letra inédita) não chega ao servidor nesta etapa.
- **Memória:** a decisão registrada até aqui era "processar 100% no aparelho". Este plano mantém
  o aparelho como **caminho alternativo** e liga o servidor por feature flag (seções 3.6 e 10).

---

## 1. Arquitetura

### 1.1 Fluxo

```
APARELHO (navegador)             VERCEL (Next.js)                 SUPABASE (Postgres+Realtime)   CLOUD TASKS     CLOUD RUN (Node 22 + FFmpeg)          R2 (bucket privado)
────────────────────             ────────────────                 ────────────────────────────   ───────────     ────────────────────────────          ───────────────────
1. buildExportJob (já existe)
   extrai a trilha de áudio ──►
   (cópia, sem recodificar)
2. POST /api/export/jobs ──────► valida sessão + schema estrito
                                 rate limit ─────────────────────► create_export_job():
                                                                    • job já pago? → reaproveita
                                                                    • reserva 1 crédito
                                                                    • linha export_jobs (queued)
                                 URL pré-assinada de PUT (5 min) ◄─
3. PUT da trilha ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────► exports/in/<uuid>
4. POST /api/export/jobs/:id/start
                                 confere o objeto (HEAD) ─────────────────────────────────────────► cria a task ──► POST /run (OIDC)
                                                                                                                  │ baixa a entrada ◄──────────────────── GET
                                                                                                                  │ ffprobe + limites
                                                                                                                  │ FFmpeg → float, regras do load.ts
                                                                                                                  │ confere contra job.source
                                                                                                                  │ samples/IRs (cache em memória)
                                                                                                                  │ processAudio → cortes
                                                                                                                  │ WAV (exportAudio) | MP3/M4A (FFmpeg)
                                                                    progresso (UPDATE) ◄──────────┤ a cada ~10%
5. Realtime (linha do job) ◄─────────────────────────────────────── status/progresso
                                                                                                                  │ PUT da saída ─────────────────────► exports/out/<uuid>
                                                                    commit_export_credit() ◄──────┤ debita (mesma chave do app)
                                                                    status = done ◄────────────────┘
6. GET /api/export/jobs/:id/download
                                 done + debitado? → URL de GET (60 s) ◄──────────────────────────────────────────────────────────────── exports/out/<uuid>
7. download direto do R2 ◄────────────────────────────────────────────────────────────────────────────────────────────────────────────
8. LIMPEZA: regra do bucket apaga exports/* com 1 dia; cron diário marca expired e apaga o JSON do job
```

**Onde roda cada parte:**
- **Vercel:** rotas finas que autenticam, validam, falam com o Supabase (service role, só no
  servidor), assinam URLs do R2 e criam a task.
- **Cloud Run:** só processa. Não fala com o cliente.
- **R2:** guarda arquivos temporários; nada é público.
- **Supabase:** estado, crédito e Realtime.

### 1.2 Como o serviço recebe trabalho: **push via Cloud Tasks**

| Opção | Ocioso | Prós | Contras |
|---|---|---|---|
| **Cloud Tasks → POST no Cloud Run (recomendado)** | **zero**: o Cloud Run escala a 0 e as tasks só existem quando há job | retentativas com backoff; **teto global de concorrência** (`maxConcurrentDispatches`); autenticação OIDC sem deixar o serviço público; 1 milhão de operações/mês grátis [ESTIMATIVA, confirmar] | mais um produto do GCP para configurar |
| Vercel chama o Cloud Run direto | zero | o mais simples | sem retentativa nem teto de concorrência; a função da Vercel teria de esperar ou "disparar e esquecer" (frágil) |
| Polling da fila no banco | **não é zero**: alguém tem de rodar o tempo todo (instância mínima 1 ou agendador) | sem produto extra | custa mesmo sem uso; atrasa o início do job |

A escolha é o push via Cloud Tasks porque cumpre o "custo zero ocioso" e ainda dá retentativa e
um teto global, que é a principal proteção de orçamento (seção 8).

---

## 2. Banco

### 2.1 Tabelas legadas ou novas? **Novas** (`export_jobs`)

As legadas assumem outro modelo e têm colunas e enums sem sentido aqui. Exemplos:
`project_id`/`track_id`, `job_type` = analyze/preview/render, heartbeat de `workers`,
`audio_files.original_name`, que eu **não quero guardar** por privacidade [CÓDIGO]. Reaprovei-las
exigiria mudar enums e políticas usadas pelo admin.

A proposta é criar `export_jobs` e deixar as legadas intocadas. Elas podem ser removidas numa
limpeza futura, com decisão sua.

### 2.2 Rascunho (NÃO aplicar)

```sql
create type public.export_status as enum ('queued', 'running', 'done', 'failed', 'expired');
create type public.export_credit_state as enum ('none', 'reserved', 'charged', 'released');

create table public.export_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  status           public.export_status not null default 'queued',
  progress         smallint not null default 0 check (progress between 0 and 100),
  kind             text not null check (kind in ('audio', 'video_remux')),
  target           text not null check (target in ('wav', 'mp3', 'm4a', 'video')),
  idempotency_ref  text not null check (idempotency_ref ~ '^[a-zA-Z0-9:_-]{8,128}$'),
  -- prova de que o p_ref corresponde a este conteúdo (seção 3.4)
  content_sha256   text,
  credit_state     public.export_credit_state not null default 'none',
  credit_tx_id     uuid references public.credit_transactions (id) on delete set null,
  -- arquivos: só chaves aleatórias no R2, nunca o nome original
  input_key        text unique,
  output_key       text unique,
  output_bytes     bigint,
  -- JSON do job (sem legendas nem CTA, que são recusados). Apagado em expires_at.
  job              jsonb,
  -- medidas do resultado
  duration_s       numeric(10, 3),
  lufs             numeric(7, 3),
  peak             numeric(9, 6),
  sha256_f32       text,
  -- custo (nunca conteúdo)
  cpu_ms           integer,
  peak_rss_mb      integer,
  wall_ms          integer,
  error_code       text,          -- código fechado (ex.: DURATION_MISMATCH), nunca texto livre do usuário
  attempts         smallint not null default 0,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  expires_at       timestamptz not null default now() + interval '24 hours'
);

-- um job ativo por resultado: dois cliques simultâneos caem no mesmo job (seção 3.3)
create unique index export_jobs_active_ref on public.export_jobs (user_id, idempotency_ref)
  where status in ('queued', 'running');
create index export_jobs_user_recent on public.export_jobs (user_id, created_at desc);
create index export_jobs_expiry on public.export_jobs (expires_at) where status <> 'expired';

alter table public.export_jobs enable row level security;

-- o dono LÊ as próprias linhas, sem o JSON do job (as colunas expostas ficam numa view)
create policy "export_jobs: dono lê" on public.export_jobs for select using (user_id = auth.uid());
-- nenhuma política de insert/update/delete: o cliente não escreve; o servidor usa service role
revoke insert, update, delete on public.export_jobs from anon, authenticated;
-- a coluna job não é lida pelo cliente
revoke select (job, input_key, output_key) on public.export_jobs from anon, authenticated;

-- Realtime: só status/progresso chegam ao cliente (publicação com lista de colunas)
-- alter publication supabase_realtime add table public.export_jobs (id, user_id, status, progress, error_code, credit_state);
```

Para avaliar com teste antes de aplicar:
- **A revogação por coluna** (`revoke select (job…)`) funciona no Postgres, mas exige que as
  consultas do cliente listem colunas, e o `select *` passa a falhar. Alternativa: uma view
  `my_export_jobs` sem as colunas sensíveis.
- **A publicação Realtime com lista de colunas** existe no Postgres 15+ [ESTIMATIVA]. Precisa ser
  testada com o Realtime do Supabase. Se não funcionar, o cliente recebe só o evento e busca a
  linha pela view.

### 2.3 Privacidade do JSON do job

- **Onde fica:** na coluna `export_jobs.job`, e não no R2. O job é pequeno: a cadeia tem até 80
  módulos [CÓDIGO], o que dá poucos KB [ESTIMATIVA].
- **O que pode conter:** nesta etapa, **sem legendas e sem CTA**, porque são recusados (seção 4).
  Sobra cadeia, slug do preset, níveis, segmentos de corte e hashes, sem texto do usuário.
- **Por quanto tempo:**
  - **até `expires_at` (24 h)**: um cron diário (`pg_cron`, ou a rota de limpeza já agendada no
    projeto) faz `update … set job = null, status = 'expired'` e remove do R2;
  - **em falha**: `job = null` logo ao falhar, porque não há reprocessamento automático depois de
    `failed`;
  - **em sucesso**: o JSON pode ser anulado já no `done`; para depuração, guardar só as medidas.
    **Recomendo anular no `done`.**
- **Nome do arquivo:** nunca vai ao servidor. A chave no R2 é UUID, o PUT é feito com nome
  genérico, e o `file_ref` do job já é um hash [CÓDIGO].
- **Quando vier o render de vídeo**, com legendas: o JSON com a letra fica 24 h, é apagado no
  `done`, e nunca vai para logs (mesma regra da Etapa 2, com teste).

---

## 3. Crédito

### 3.1 Princípios

1. **A mesma chave do app.** O débito é `grant_credits(..., idempotency_key = 'export:' || uid ||
   ':' || p_ref)` [CÓDIGO]. Quem já pagou aquele `p_ref`, no aparelho ou no servidor, **nunca
   paga de novo**.
2. **Reservar ao criar, debitar ao entregar, liberar ao falhar.** A reserva **não entra no
   ledger**: o saldo exibido continua o mesmo. Ela só reduz o "disponível para novos jobs".
3. **Tudo dentro do mesmo lock por usuário** do `grant_credits` (`pg_advisory_xact_lock(hashtext
   ('credits:' || uid))`) [CÓDIGO], para não existir corrida entre reservar, debitar e o saldo.

### 3.2 RPCs (rascunho; só service role, sem `grant` para authenticated)

| RPC | Quem chama | O que faz |
|---|---|---|
| `create_export_job(uid, p_ref, kind, target, job jsonb, content_sha256)` | rota da Vercel | Ver o algoritmo abaixo da tabela. |
| `start_export_job(job_id)` | serviço | `queued → running`, `attempts + 1`, `started_at`. Recusa se não for `queued`/`running` (retentativa). |
| `report_export_progress(job_id, pct)` | serviço | Só aumenta; no máximo 1 escrita a cada ~10% [ESTIMATIVA]. |
| `commit_export_credit(job_id, medidas…)` | serviço, **depois** de a saída estar no R2 e conferida | `grant_credits(-1, chave do app)`, que é idempotente → `charged`, `status = done`, grava as medidas e o `output_key`. Se o saldo não bastar (gastou em outro aparelho no meio), `failed` + `INSUFFICIENT_CREDITS`, e o serviço apaga a saída. |
| `release_export_credit(job_id, error_code)` | serviço ou a limpeza | `reserved → released`, `status = failed`. **Nunca** mexe num `charged`. |
| `refund_export(job_id)` | só o admin | Para o caso raro de cobrar e perder a saída: `grant_credits(+1, 'REFUND', idempotency 'refund:' || job_id)`. |

`create_export_job`, passo a passo:
1. Pega o lock do usuário.
2. **Já pago?** Se existe `credit_transactions.idempotency_key = 'export:uid:p_ref'`, cria o job
   com `credit_state = 'charged'`, sem reserva.
3. **Job ativo com o mesmo ref?** Devolve esse job.
4. **Disponível = saldo − reservas ativas ≥ 1?** Cria o job com `credit_state = 'reserved'`;
   senão, `INSUFFICIENT_CREDITS`.
5. **Limites por usuário e global** (seção 8): se estourou, `RATE_LIMITED` ou `CAPACITY`.

### 3.3 Corridas e falhas

| Situação | O que acontece |
|---|---|
| **Dois jobs com o mesmo `p_ref` ao mesmo tempo** (dois cliques ou duas abas) | O lock serializa. O segundo encontra o ativo (índice único parcial) e **recebe o mesmo `job_id`**. Um só processamento, uma só cobrança. |
| **Mesmo `p_ref` depois de pronto** | Se o `output_key` ainda existe (menos de 24 h), devolve o job `done` e o download, sem novo processamento nem cobrança. Se expirou, cria job novo como `charged` (já pago): processa de novo **sem cobrar**. |
| **Mesmo `p_ref` já pago no aparelho** (antes do servidor existir) | `charged` desde o início: processa e entrega sem cobrar. |
| **Falha antes do débito** (arquivo inválido, timeout, FFmpeg) | `release_export_credit` → `failed` + `released`. A reserva some e o usuário não perde nada. |
| **Falha depois do débito, antes do `done`** (queda entre o `grant_credits` e o update) | Não acontece em partes: débito e `done` ficam **na mesma transação** do `commit_export_credit`. Se a transação cai, nada é gravado e a retentativa do Cloud Tasks refaz o commit. O `grant_credits` é idempotente pela chave. |
| **Saída perdida depois do débito** (o R2 apagou antes do download) | O usuário pede de novo e o `p_ref` já está pago: novo job `charged`, sem cobrança. Só precisa enviar o arquivo de novo (seção 7). |
| **Sem saldo ao criar** | `INSUFFICIENT_CREDITS`: o cliente mostra "comprar créditos", como hoje (`onNeedCredits`). |
| **Saldo some entre reservar e debitar** (gastou no aparelho em paralelo) | O commit falha com `INSUFFICIENT_CREDITS`: `failed`, saída apagada. Raro, porque a reserva já tira 1 do disponível no servidor; o gasto no aparelho não enxerga a reserva. Aceitável. |
| **Job preso** (instância morreu) | A task do Cloud Tasks é retentada até N vezes [ESTIMATIVA: 3]. Depois, a limpeza marca `failed` + `released` todo `running` com `started_at` acima de 2× o timeout. |
| **Job expirado** (`expires_at`) | `expired`, `job = null`, objetos removidos. Reserva não debitada → `released`. Débito feito continua (ele recebeu o arquivo ou pode refazer de graça). |

### 3.4 O `p_ref` vem do cliente: como não virar uma brecha

Hoje o cliente escolhe o `p_ref`, e a mesma brecha já existe no app [CÓDIGO]. Quem repete um
`p_ref` pago com **outro** conteúdo (outro arquivo ou outro preset) exporta de graça, porque o
`p_ref` é um hash calculado no aparelho. No servidor dá para fechar isso sem quebrar a regra de
"o mesmo resultado não cobra duas vezes":
- **No primeiro uso de um `p_ref` no servidor**, gravar `content_sha256` = SHA-256 de
  `(cadeia, intensidade, ruído, redes, cortes, alvo)` + SHA-256 do **arquivo recebido**.
- **Num novo job com o mesmo `p_ref` e um `content_sha256` diferente**, recusar com `REF_MISMATCH`.
  O cliente honesto nunca cai nisso, porque o mesmo resultado gera o mesmo conteúdo.
- **Decisão sua (seção 11, item 1)**, porque `p_ref`s pagos **no aparelho** não têm conteúdo
  registrado: no primeiro uso no servidor eles são "ancorados" ao que chegar.

### 3.5 Estados e transições

| De \ evento | criar | iniciar | progresso | commit OK | commit sem saldo | erro | expira |
|---|---|---|---|---|---|---|---|
| — | `queued` / (`reserved` ou `charged`) | | | | | | |
| `queued` | (mesmo job) | `running` | | | | `failed` / `released` | `expired` / `released` |
| `running` | (mesmo job) | (retentativa) | `running` | `done` / `charged` | `failed` / `released` | `failed` / `released` | `failed` / `released` (preso) |
| `done` | (devolve o mesmo, se a saída existir) | | | (idempotente) | | | `expired` (continua `charged`) |
| `failed` | novo job | | | | | | `expired` |
| `expired` | novo job (`charged` se já pago) | | | | | | |

Invariante: `credit_state = 'charged'` ⇔ existe a transação `export:uid:p_ref` no ledger.
Confirmação por teste SQL.

### 3.6 O que muda no cliente (`export-panel.tsx`) e o que continua

- **Continua igual:**
  - o `buildExportJob`, o `idempotency_ref`, a interface, o resumo e as mensagens;
  - o processamento **no aparelho** (`executeExportJob` + `spend_export_credit`).
- **Novo, atrás de uma feature flag** (`export_server` em `system_settings` + lista de usuários;
  primeiro só a sua conta). Num alvo do escopo (áudio ou vídeo sem render), o painel:
  1. extrai só a trilha de áudio (cópia sem recodificar, como `decodeViaAudioCopy` já faz:
     ~1 MB/min [CÓDIGO, comentário em `load.ts`]);
  2. `POST /api/export/jobs` e faz o PUT;
  3. assina o Realtime da linha e mostra o progresso na mesma barra;
  4. no `done`, pede a URL e baixa ou compartilha como hoje.
- **O débito sai do cliente nesse caminho.** O `spend()` não é chamado; o servidor debita. O fluxo
  "sem internet → arquivo guardado" (`unpaid`) não se aplica, porque sem internet não há servidor.
- **O aparelho continua como alternativa? Sim. Recomendo manter por pelo menos 3 meses
  [ESTIMATIVA]:**
  - é o único caminho para render de vídeo (fora do escopo);
  - é o plano B se o servidor cair, ficar sem orçamento (seção 8) ou recusar o arquivo;
  - custa zero;
  - regra: o servidor é tentado primeiro quando a flag está ligada e o job é do escopo; se o
    servidor responder `CAPACITY` ou estiver fora do ar, o painel processa no aparelho como hoje.
    Na mesma chave não há cobrança dupla.

---

## 4. Schema estrito do job no servidor (o cliente não é confiável)

Um `serverExportJobSchema` estende o `exportJobSchema` (zod) [CÓDIGO]. Ele é usado na Vercel, na
criação, **e de novo** no serviço:

| Item | Regra | Por quê |
|---|---|---|
| Escopo | `output.render = false`; `captions = null`; `look.audiogram = null`; `audio.music = null`; `look.before_after = false`; **CTA só em alvo de áudio** (ver "Mudança da fatia 1" abaixo); em alvo de vídeo também `look.cta = null` e nenhum visual que exija render (recalculado com `rendersVideo`) | Fora disso precisa de render. Legendas continuam recusadas (podem ser letra inédita). |
| Música de fundo | v1: `audio.music = null` (seção 11, item 5) | Exige um segundo upload. |
| Duração | **medida no arquivo** (ffprobe + amostras decodificadas), nunca o `duration_s` do job. Máximo **15 min** [CÓDIGO: limite do computador]; recusa se `|medida − job| > 0,1 s` [ESTIMATIVA] | O job pode mentir; a medida decide o custo. |
| Taxa e canais | medidos; recusa se diferirem do `job.source`. Aplicar a regra do app: no máximo 2 canais, estéreo idêntico vira mono | O app faz assim [CÓDIGO]. |
| `audio_start_s` | recalculado (primeiro timestamp do FFmpeg); tolerância de 1 amostra | Sincronia do remux. |
| `content_fingerprint` | recalculado com `signalFingerprint` sobre o áudio do servidor; **não** recusa se divergir enquanto a paridade (seção 5) não for bit a bit, mas registra | Só bate se a decodificação for idêntica. |
| Tamanho do arquivo | trilha de áudio: ≤ 40 MB [ESTIMATIVA: 15 min de AAC 256 kbps ≈ 29 MB]; vídeo para remux: ≤ 600 MB [ESTIMATIVA], seção 11, item 4 | DoS e custo de banda. |
| Contêiner e codec | só os que o app aceita: MP4/MOV/M4A (AAC, ALAC), MP3, WAV (PCM 16/24/32 e float), WebM/Ogg (Opus/Vorbis), FLAC; verificado pelo **ffprobe**, nunca pela extensão | Superfície do FFmpeg (seção 9). |
| Cadeia | `jobChainSchema` [CÓDIGO], com módulos conhecidos e faixas validadas, mais **≤ 41 módulos** (32 do editor + 9 do master [CÓDIGO]); ≤ 2 `amp`, ≤ 1 `drum_studio`, ≤ 4 `reverb` [ESTIMATIVA] | O custo cresce com módulos pesados. |
| Intensidade e ruído | `intensity ∈ {25, 50, 75, 100}` e `denoise ∈ [0, 1]` [CÓDIGO] | — |
| Assets | **ignorar `files`/`file` do job.** Para cada id, buscar `drum_samples`/`cab_irs` **ativos** no banco e usar os caminhos de lá. Só aceitar ids `synth` e `mp:` que existam em `CABS`. Downloads só de `<SUPABASE_URL>/storage/v1/object/public/drum-samples/` | Impede apontar o servidor para outro lugar (SSRF) e reaproveitar caminhos alheios. |
| IR | depois de decodificar, ≤ 250 ms [CÓDIGO: `irFromChannels`]; arquivo ≤ 2 MB [ESTIMATIVA] | — |
| Samples | ≤ 12 camadas por peça [CÓDIGO: check da tabela]; arquivo ≤ 2 MB cada [ESTIMATIVA] | — |
| Cortes | `segments` ordenados, sem sobreposição, dentro de `[audio_start, audio_start + duração medida]`, ≤ 1.000 trechos (cabe nos 64 KB do JSON; ajustado na fatia 1). No nível "dinâmico", projetado para 10 min [MEDIDO]: 127–157 trechos nos arquivos reais, 166 numa fala sintética e 588 num pior caso artificial (falas e pausas curtas o tempo todo) | `spliceAudio` com entradas absurdas. |
| `idempotency_ref` | regex do `spend_export_credit` [CÓDIGO] **e** igual ao recalculado com `audioRef`/`editRef` a partir do próprio job [CÓDIGO: `lib/export/refs.ts`]. Exceção: o `fileKey` usa nome e data, que o servidor não tem; ele é aceito como veio | Garante que o ref corresponde à cadeia e às opções enviadas. |
| Tamanho do JSON | ≤ 64 KB [ESTIMATIVA] | Sem legendas, um job real tem poucos KB. |
| `engine.dsp_version` | precisa ser igual ao do serviço; se não, `VERSION_MISMATCH` e o cliente usa o aparelho | Evita som diferente do que a prévia mostrou. |

---

### Mudança da fatia 1: CTA em alvo de áudio (aprovada em 2026-10-03)

- **Por quê:** o CTA vem **ligado por padrão** em todo vídeo [CÓDIGO: `defaultVideoTools`].
  Recusá-lo mandaria para o aparelho quase todo "vídeo → MP3/WAV/M4A".
- **Regra:** o CTA é aceito **só quando o alvo é áudio** (wav/mp3/m4a). Em alvo de vídeo (remux)
  continua recusado, porque força render.
- **Inerte para o som:** o CTA só entra no p_ref (`editRef`). Um teste prova que o mesmo job com e
  sem CTA, em alvo de áudio, dá o **mesmo `sha256_f32`** pelo caminho do executor
  (`lib/export/audio-job.ts`, usado também pelo script).
- **Limites:** texto ≤ **70** e @ ≤ **32** unidades UTF-16. São os da interface [CÓDIGO:
  `video-tools.tsx`: texto `slice(0, 70)`; @ `slice(0, 31)` + "@"]. A maior sugestão pronta tem 47
  [MEDIDO]. Acima disso (só por job forjado ou sessão muito antiga), o job é recusado (`LIMIT`) e
  cai no aparelho.
- **Privacidade:** o CTA fica no JSON do job e é **apagado junto com ele no `done`**. Nunca vai
  para logs, `reportError` ou `track`. O teste estático cobre `lib/export`, o painel e os scripts
  do servidor, e procura `cta`, `.handle`, `job` e `idempotency_ref` nos argumentos de log. Ele
  detectou um vazamento injetado de propósito. O apagar no `done` será testado na fatia 4, no banco.
- **Antes → depois em alvo de áudio:** confirmado no código que **não altera o áudio**. O
  `executeExportJob` só usa `before_after` no ramo de vídeo [CÓDIGO]. Ele muda só o p_ref
  (`"antes-depois"` no `editRef`), e um teste prova o mesmo `sha256_f32`. **Por decisão, continua
  recusado em qualquer alvo** (`OUT_OF_SCOPE` → aparelho). Pode ser liberado em alvo de áudio no
  futuro sem risco para o som.

## 5. Decodificação da mídia do usuário no servidor

### 5.1 O que reproduzir [CÓDIGO: `load.ts`]

1. FFmpeg → `f32le` planar, **na taxa original** (sem `-ar`), como o caminho principal do app.
2. **Pré-enchimento do AAC:** o app descarta o trecho antes de t=0 e usa
   `audioStart = max(0, primeiro timestamp)`. No FFmpeg, comparar o padrão (edit lists e
   `skip_samples` aplicados) com `-ignore_editlist 1` e escolher o que bate.
3. **No máximo 2 canais;** estéreo com canais idênticos amostra a amostra vira **mono**.
4. **Áudio com menos de 0,5 s** → `no_audio`.

### 5.2 Teste de paridade proposto (fatia 2)

- **Navegador:** uma página de teste fora do app. Um script empacota `lib/media/load.ts` com
  esbuild e a abre no Chrome headless (Puppeteer, como nas Etapas 2 e 3), chamando `loadMedia`.
  O app não muda. Ela grava `channels`, `sampleRate`, `audioStart` e `duration`.
- **Servidor:** o mesmo arquivo pelo módulo de decodificação do serviço (FFmpeg da versão fixa).
- **Comparação por arquivo:**
  - número de amostras e canais;
  - **atraso inicial** (correlação cruzada nos primeiros 2 s; precisa dar 0 amostra);
  - LUFS e pico;
  - **diferença amostra a amostra**: máxima e SNR do erro, em dB.
- **Critério:**
  - **Bit a bit:** PCM/WAV e FLAC precisam bater exatamente.
  - **AAC/MP3/Opus, aceite proposto:**
    - 0 amostra de atraso;
    - número de amostras igual (±1 quadro do codec);
    - SNR do erro ≥ 90 dB [ESTIMATIVA];
    - LUFS ±0,01 dB.
  - **Expectativa:** o Chrome usa decodificadores do próprio FFmpeg para AAC e MP3, então pode
    até sair idêntico [ESTIMATIVA]. O Safari e o iPhone usam os decodificadores da Apple, e **o
    próprio app já dá resultados diferentes conforme o navegador**. A paridade de referência é o
    Chrome no computador, e o Safari entra só como medida informativa (seção 11, item 9).
- **Saída:** uma tabela por arquivo, mais um teste automático que roda os WAV e FLAC no CI e os
  arquivos grandes só localmente.

### 5.3 Arquivos de teste

**Já no repositório:**

| Arquivo | Formato [MEDIDO com ffprobe] |
|---|---|
| `Cantando.mp4` | AAC-LC 44,1 kHz estéreo, 48,7 s |
| `Bateria com Click.mp4` | AAC-LC 44,1 kHz estéreo, 36,6 s |
| `Antes e Depois.mp4` | AAC-LC 44,1 kHz estéreo, 22,9 s |
| `Baixo.mp4` | AAC-LC 48 kHz estéreo, 2 min 07 s |
| `lib/dsp/fixtures/bateria-celular-real.wav` | PCM 16 bits, 22,05 kHz, mono |
| `lib/dsp/fixtures/bateria-com-clique-real.wav` | PCM 16 bits, 24 kHz, mono |

Os quatro MP4 parecem ter passado por compartilhamento, porque o áudio está a ~60 kbps [MEDIDO].
Não são gravações originais da câmera.

**Preciso que você forneça** (30 s a 2 min cada, conteúdo seu):
1. **Vídeo MOV gravado pela câmera do iPhone**, original, sem passar por WhatsApp (o mais
   importante: edit list e pré-enchimento reais).
2. **Áudio do app Gravador do iPhone** (`.m4a`).
3. **Vídeo de celular Android**, original da câmera (`.mp4`).
4. **MP3** de 128 ou 320 kbps (CBR) e, se tiver, um **MP3 VBR**.
5. **WAV de 24 bits a 48 kHz**, estéreo (exportado de um DAW).
6. **WAV de 16 bits a 44,1 kHz**, estéreo.
7. (Opcional) **Áudio de WhatsApp** (`.ogg`/Opus) e um **FLAC**.

Os WAV 5 e 6 eu também posso gerar sinteticamente, mas arquivos reais pegam detalhes de cabeçalho
(chunks extras, `WAVE_FORMAT_EXTENSIBLE`).

---

### 5.4 Resultado da fatia 2 (2026-10-07)

Regras do servidor, cada uma confirmada contra o app (Chrome + `load.ts`) [MEDIDO]:

| Formato | Regra no servidor (`lib/export/ffmpeg-decode.ts`) | Resultado |
|---|---|---|
| WAV (PCM 16/24 bits, float, `EXTENSIBLE`) | Taxa original, sem conversões extras | **Idêntico** bit a bit, inclusive float acima de 1 (o app **não** limita) |
| MP4/MOV com AAC | `-ignore_editlist` + **regra de edit list do mediabunny** (`lib/export/mp4-edits.ts`): descarta só o trecho antes de t=0 (pré-enchimento), **não corta o fim**, `audio_start = max(0, primeiro instante)` | **Idêntico**, inclusive amostras e `audio_start`, e AAC com 50.819 picos acima de 1 (o app **não** limita) |
| MP3 | `-flags2 +skip_manual` (mantém o atraso e o enchimento do LAME, como o app); `audio_start = 0`; **limite a ±1** (o decodificador de MP3 do Chrome limita) | **Dentro**: mesmas amostras, início 0, SNR 121–123 dB, diferença máx. 2,7e-6 a 4,3e-6 (não é bit a bit) |

- **Edit lists dos arquivos reais:** todas com `media_time = 2112` e **nenhuma edição vazia**, ou
  seja, nenhum atraso de áudio [MEDIDO]. O teste avisa quando aparecer `audio_start > 0`.
- **CI:** compara o servidor com `lib/export/fixtures/decode-reference.json`, a referência do app
  com 14 arquivos (sintéticos e do repositório), sem rodar o Chrome. Os arquivos de
  `fixtures-local` não existem no CI e ficam PENDENTES. Para regravar a referência:
  `scripts/parity-decode.ts --gravar-referencia`.

### 5.5 Para a fatia 4: medir a divergência por aparelho (anotado, NÃO implementado)

- **O risco:** a maioria dos usuários está no celular. No iPhone o app decodifica com os
  decodificadores da Apple e pode cair nos caminhos alternativos do `load.ts` (cópia da trilha +
  `decodeAudioData`, ou `decodeAudioData` a 48 kHz). Nesses casos o servidor (paridade com o
  Chrome) pode divergir do que a pessoa ouviu na prévia.
- **Na fatia 4, o servidor grava em `export_jobs`, sem conteúdo, a diferença entre o que mediu e o
  que o job declarou:**
  - `diff_samples`: amostras medidas − amostras declaradas (`duration_s × sample_rate`);
  - `diff_duration_ms`;
  - `diff_audio_start_ms`;
  - `diff_channels` e `diff_sample_rate` (0 quando iguais);
  - `client_platform`: só a categoria (`ios` / `android` / `desktop`) e a família do navegador
    (`safari` / `chrome` / `firefox` / `outro`), derivadas do user-agent na rota da Vercel. **O
    user-agent completo não é gravado.**
  - **Proposta (decidir na fatia 4):** o cliente informar no job qual caminho do `load.ts` usou
    (`webcodecs` / `copia+webaudio` / `webaudio`). Isso exige um campo novo no schema, por exemplo
    `source.decode_path`, e é o dado que mais explicaria as divergências do iPhone.
- **Para que serve:** um painel do admin agrupa por plataforma e caminho, e mostra onde e quanto o
  servidor diverge do celular.
- **Política inicial proposta:** só medir. Divergência acima de um limite (ex.: > 1 quadro de
  codec ou `audio_start` diferente) gera alerta para revisão, não recusa.

## 6. Serviço

### 6.1 Container

- **Imagem:** `node:22-bookworm-slim` + FFmpeg **de versão fixa**. Opções: o pacote da
  distribuição travado pela versão do Debian, ou um build estático com hash conferido no
  `Dockerfile`.
- **Usuário:** não-root, sistema de arquivos só leitura, exceto `/tmp`.
- **Código:** o mesmo monorepo. O serviço importa `lib/export/process-audio.ts`, `node-assets.ts`,
  `wav.ts`, `lib/dsp/*` e `@mixpro/contracts`, empacotados com esbuild num único arquivo. Isso
  evita levar o Next.js para o container.
- **Ponto de entrada:** `apps/export-service/src/server.ts`, um HTTP mínimo (`node:http`) com:
  - `POST /run`, autenticado por OIDC do Cloud Tasks, corpo `{ job_id }`; o serviço busca o job
    no banco, **não** confia no corpo da task;
  - `GET /healthz`.
- **Primeira linha do ponto de entrada:**
  `globalThis.WorkerGlobalScope ??= function WorkerGlobalScope() {}`, para o RNNoise
  [MEDIDO na Etapa 3: necessário e determinístico].

### 6.2 Recursos e limites (com os números da Etapa 3)

| Parâmetro | Valor proposto | Base |
|---|---|---|
| CPU por instância | **1 vCPU** | Um job usa 1 linha de execução (CPU/relógio de 0,97 a 1,08) [MEDIDO] |
| Concorrência por instância | **1** | Um job ocupa a CPU inteira; dois na mesma instância só dobrariam o tempo de cada um. |
| Memória | **4 GiB** | 10 min estéreo: pico de 1,40–1,67 GB [MEDIDO]; 15 min estéreo ≈ 2,4 GB [ESTIMATIVA linear]; FFmpeg e buffers ~0,3 GB [ESTIMATIVA]; e o **`/tmp` do Cloud Run fica na RAM** [ESTIMATIVA, confirmar], então arquivos temporários contam. Com 1 vCPU o máximo são 4 GiB [ESTIMATIVA, confirmar]. |
| `max-instances` | **2** | Teto de gasto e de paralelismo (seção 8). |
| `min-instances` | **0** | Custo zero ocioso. |
| Timeout da requisição | **15 min** | Pior caso medido: 10 min estéreo com remoção de ruído = 109 s de CPU [MEDIDO]; 15 min ≈ 165 s, mais download, decodificação e gravação ≈ 4 min [ESTIMATIVA]. Sobra muita margem. |
| Prazo da task (Cloud Tasks) | 15 min, 3 tentativas com backoff | — |
| Região | `us-central1` (seção 11, item 6) | Faixa de preço 1 e cota grátis [ESTIMATIVA, confirmar]. A latência para o Brasil (~150 ms [ESTIMATIVA]) não importa num job em lote; o R2 é global. |

**Jobs de 10 e 15 min:**
- O tempo não é problema: 2 min de CPU no pior caso [MEDIDO/ESTIMATIVA].
- A memória é o limite. Para não guardar o arquivo inteiro duas vezes:
  - o download do R2 vai **em fluxo** para o stdin do FFmpeg, sem gravar em `/tmp`;
  - a saída do FFmpeg vai direto para os `Float32Array`;
  - o MP3 sai pelo pipe;
  - só o M4A usa um arquivo temporário (~1,5 MB/min [ESTIMATIVA: 192 kbps]).

### 6.3 Autenticação

| Trecho | Como |
|---|---|
| Vercel → Cloud Tasks | **Workload Identity Federation com o OIDC da Vercel**, sem chave de conta de serviço guardada. Se não for viável: chave numa variável (`GCP_SERVICE_ACCOUNT_JSON`) só no ambiente de produção. |
| Cloud Tasks → Cloud Run | **Token OIDC** da conta de serviço `export-invoker`. O serviço **não** aceita chamadas sem autenticação (`--no-allow-unauthenticated`). |
| Cloud Run → Supabase | `SUPABASE_SERVICE_ROLE_KEY` no **Secret Manager**, montado como variável. Só chama as RPCs da seção 3.2. |
| Cloud Run / Vercel → R2 | Chaves S3 do R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`), com **permissão só no bucket de exportação**. |

### 6.4 Cache de samples e IRs

- **Disco:** o do Cloud Run é efêmero e em memória [ESTIMATIVA]. O cache fica **na memória do
  processo**, um `Map` por caminho, enquanto a instância vive.
- **Quanto custa baixar de novo:**
  - um sample tem ~70 KB [MEDIDO: 71.310 bytes];
  - uma IR tem ≤ 250 ms × 48 kHz × 16 bits ≈ 24 KB [CÓDIGO, conta];
  - uma bateria com 5 peças × até 12 camadas ≈ até 4 MB por partida a frio [ESTIMATIVA], hoje
    bem menos (6 samples na biblioteca [MEDIDO]);
  - tempo: a etapa de assets levou ~0,0–0,1 s [MEDIDO, com cache em disco];
  - **conclusão:** o custo é desprezível.
- **Saída do Supabase Storage:** o plano grátis tem uma cota mensal de saída de dados
  [ESTIMATIVA: 5 GB, confirmar]; 1.000 partidas a frio × 4 MB ≈ 4 GB no pior caso [ESTIMATIVA].
  Se apertar, espelhar `drum-samples` no R2, onde a saída é grátis [página oficial do R2].

### 6.5 Codificação e remux

- **WAV:** `exportAudio(…, "wav")` do app, com o mesmo dither aleatório [MEDIDO na Etapa 3:
  roda em Node sem mudanças].
- **MP3/M4A:** o `ffmpeg-encode.ts` da Etapa 3, promovido a módulo do serviço: libmp3lame
  320 kbps e AAC 192 kbps com `+faststart`, iguais ao `QUALITY_HIGH` do app [CÓDIGO/MEDIDO].
- **Remux** (vídeo só trocando o áudio): `ffmpeg -i video -i audio_tratado.m4a -map 0:v:0 -map
  1:a:0 -c:v copy -c:a copy`, com `-itsoffset audio_start_s` para respeitar o atraso inicial. O
  contêiner de saída é o do original (mp4/webm, como o `exportVideo`). Para isso o servidor
  precisa do **vídeo inteiro** (seção 11, item 4).

### 6.6 Logs de custo sem conteúdo

- **Uma linha JSON por job** no `stdout`:
  `{job_id, status, error_code, duracao_s, canais, taxa, alvo, cpu_ms, rss_mb, wall_ms,
  etapas_ms, dsp_version}`.
  - **Nunca entram:** o JSON do job, o nome do arquivo, o slug do preset do usuário, o
    `idempotency_ref` (que contém o slug), mensagens do FFmpeg cruas (podem citar metadados do
    arquivo, como título ou artista) ou URLs assinadas.
  - **Erros:** o FFmpeg roda com `-loglevel error`; o texto vai para um classificador que devolve
    um `error_code` fechado. O texto em si **não é registrado**.
  - **Teste:** um teste no estilo do `privacy.test.ts` da Etapa 2, que procura chamadas de log no
    código do serviço.
  - O mesmo número vai para `export_jobs` (colunas de custo), para o painel do admin.

---

## 7. Entrega e limpeza

- **Download:**
  - `GET /api/export/jobs/:id/download` na Vercel confere a sessão, o `user_id`, `status = done`
    e `credit_state = charged`;
  - devolve uma URL de **GET pré-assinada de 60 s** [ESTIMATIVA], com
    `response-content-disposition` montado no cliente a partir do nome local do arquivo (o nome
    não vai ao servidor);
  - o compartilhamento no celular baixa o blob por essa URL e segue como hoje.
- **Limpeza:**
  - **regra de ciclo de vida do bucket R2** apagando `exports/` com **1 dia** [ESTIMATIVA:
    disponível no R2, confirmar];
  - cron diário no banco: `expired`, `job = null` e liberação de reservas presas.
- **Se o usuário voltar depois de 24 h:**
  - o job aparece como `expired` e a saída não existe mais;
  - ao exportar de novo o **mesmo** resultado (mesmo `p_ref`), o painel envia o arquivo de novo,
    o servidor encontra o débito antigo e **processa sem cobrar**;
  - sem o arquivo original no aparelho, não há como refazer, e a tela avisa;
  - isso é coerente com `docs/armazenamento.md`: "Um novo download do mesmo resultado é gerado de
    novo e não cobra outro crédito" [CÓDIGO/DOC].

---

## 8. Custo e limites de abuso

### 8.1 Custo por exportação [ESTIMATIVA]

Base:
- Cloud Run, cobrança por requisição, faixa 1 [preço de busca, confirmar]: **US$ 0,000024/vCPU-s**
  e **US$ 0,0000025/GiB-s**, com **180.000 vCPU-s e 360.000 GiB-s grátis por mês**.
- Tempo total do job = 1,5 × o tempo de DSP medido (decodificação, download, gravação e upload)
  [ESTIMATIVA]; 4 GiB alocados.

| Exportação | DSP medido [MEDIDO] | Tempo do job [ESTIMATIVA] | US$ | R$ |
|---|---|---|---|---|
| Voz, 3 min estéreo | 10,1 s | ~15 s | 0,00036 + 0,00015 = **0,00051** | **~0,003** |
| Bateria, 3 min estéreo | 11,7 s | ~18 s | **0,00061** | **~0,003** |
| Guitarra, 10 min estéreo | 73,0 s | ~110 s | **0,0037** | **~0,02** |
| Voz + ruído, 10 min estéreo (pior caso) | 108,9 s | ~165 s | **0,0056** | **~0,03** |

- **R2:** ~2 operações classe A e ~2 classe B por job; armazenamento de poucos MB por menos de
  24 h. Isso está dentro da cota grátis (10 GB-mês, 1 milhão de classe A e 10 milhões de classe B
  [página oficial]) até centenas de milhares de jobs por mês [ESTIMATIVA].
- **Cloud Tasks e Supabase:** dentro das cotas grátis nesse volume [ESTIMATIVA].
- **Cota grátis:** com 4 GiB, **o limite que estoura primeiro é o de memória (GiB-s), não o de
  CPU**:

| Mix | Por mês, dentro da cota [ESTIMATIVA] |
|---|---|
| Voz de 3 min | 360.000 ÷ 60 ≈ **6.000** exportações |
| Pior caso (10 min com ruído) | ≈ **545** exportações |

- **Para ficar em R$ 0:** reduzir a memória para 2 GiB **com limite de 10 min no servidor**
  (pico medido de 1,67 GB, margem apertada) dobra a cota. Os jobs mais longos vão para o aparelho
  (seção 11, item 7).
- **Para R$ 100/mês ≈ US$ 18** [ESTIMATIVA], além da cota: ~3.200 exportações de pior caso ou
  ~35.000 de voz de 3 min [ESTIMATIVA].

### 8.2 Limites e o que acontece ao atingi-los

| Limite | Valor proposto [ESTIMATIVA] | Ao atingir |
|---|---|---|
| Por usuário | 10 jobs/hora, 40/dia, 1 job ativo por vez (2 para o admin) | `RATE_LIMITED`: o painel diz "muitas exportações seguidas, tente em alguns minutos" e oferece processar no aparelho. |
| Global por dia | **orçamento de CPU, não de jobs**: 6.000 vCPU-s/dia (`system_settings.export_server_daily_cpu_s`) = a cota grátis mensal ÷ 30, mais um teto de 300 jobs/dia | `CAPACITY`: o painel processa **no aparelho**, sem o usuário perceber falha. |
| Global simultâneo | `max-instances = 2` + `maxConcurrentDispatches = 2` no Cloud Tasks | Os jobs esperam na fila (`queued`) e o progresso mostra "na fila". |
| Duração | 15 min (ou 10, se usar 2 GiB) | Recusa na criação; o aparelho processa. |
| Tamanho | trilha ≤ 40 MB; vídeo ≤ 600 MB | Recusa no PUT (a URL pré-assinada leva o tamanho) e de novo no servidor. |
| **Interruptor geral** | `system_settings.export_server_enabled` | Desliga o servidor na hora; tudo volta para o aparelho. |

**Alertas de orçamento no GCP:** R$ 10, R$ 50 e R$ 100. Esses alertas **só avisam, não desligam
nada** [ESTIMATIVA]. A proteção real é a combinação de teto diário, `max-instances` e
interruptor. Opcional (fatia 7b): ligar o alerta de 100% a uma função que vira o interruptor.

**Teto do pior caso, saturado o mês inteiro** [ESTIMATIVA]:
2 instâncias × 2,6 milhões de s × (0,000024 + 4 × 0,0000025) ≈ **US$ 180/mês ≈ R$ 990**. Por isso
o **teto diário** é obrigatório, e por orçamento de CPU:
- **Contar jobs não basta:** 500 jobs/dia de pior caso dariam ≈ 500 × 0,0056 × 30 ≈ US$ 84/mês
  ≈ **R$ 460**, acima do seu teto.
- **6.000 vCPU-s/dia** mantêm a CPU dentro da cota grátis (180.000/mês). Com 2 GiB por instância
  (seção 11, item 7), a memória também fica dentro (12.000 GiB-s/dia ≈ 360.000/mês) → **R$ 0**
  [ESTIMATIVA].
- **Para usar até R$ 100/mês ≈ US$ 18:** subir o teto para ~10.000 vCPU-s/dia [ESTIMATIVA]
  depois de ver os custos reais da fatia 7.
- O serviço soma o `cpu_ms` de cada job no dia, e a criação recusa (`CAPACITY`) quando o total
  passa do teto.

---

## 9. Segurança

| Ataque | Defesa |
|---|---|
| **Job malicioso** (cadeia absurda, ref forjado, assets apontando para outro lugar) | Schema estrito (seção 4) na Vercel **e** no serviço. O serviço relê o job do banco. Assets resolvidos pelo banco, só do bucket público. Ref recalculado e ancorado ao conteúdo (seção 3.4). |
| **Arquivo malicioso para o FFmpeg** | FFmpeg de versão fixa, atualizado a cada CVE. `-protocol_whitelist pipe,file`, entrada pelo stdin, sem `concat`/`hls`/playlists (`-f` só do formato que o ffprobe detectou numa lista permitida). `-threads 1`; timeout por processo; processo filho com limite de memória. Container não-root, só leitura, **sem permissão de rede além do R2 e do Supabase** (controle de saída da VPC, opcional). |
| **DoS por jobs gigantes** | Tamanho limitado na URL pré-assinada; duração medida antes de decodificar tudo (ffprobe), com recusa acima de 15 min; teto por usuário e global; `max-instances`; a reserva de crédito exige saldo para criar. |
| **DoS por muitos jobs pequenos** | Limite por usuário/hora; 1 job ativo por usuário; Cloud Tasks com fila de despacho limitada. |
| **Enumeração de download** | Bucket R2 **privado**; chaves UUID; URL só emitida depois de conferir dono, `done` e `charged`; validade de 60 s; o `job_id` sozinho não dá acesso (RLS + checagem na rota). |
| **Chamada direta ao Cloud Run** | `--no-allow-unauthenticated`; só o OIDC do Cloud Tasks. |
| **Vazamento por logs** | Seção 6.6: nenhum conteúdo de job, legenda, nome de arquivo, slug ou URL. Teste estático no CI. Nada disso em `reportError`/`track` (regra da Etapa 2). |
| **Uso de `p_ref` pago para exportar outra coisa** | Ancoragem do `content_sha256` (seção 3.4). |
| **Retentativa que debita duas vezes** | O débito é idempotente pela chave do ledger [CÓDIGO]; commit e `done` na mesma transação. |

Confirmo, como regra do plano: **nenhum conteúdo de job, legenda ou nome de arquivo vai para
logs** (Cloud Run, Vercel, Supabase), e há um teste para garantir isso (fatia 3).

---

## 10. Implementação em fatias

A ordem ajustada em relação à sua sugestão é **banco e crédito antes da fila**. A fila só faz
sentido escrevendo status e reservando crédito, e testar crédito sem fila é mais simples.

| # | Fatia | Local? | Aceite | Reversão |
|---|---|---|---|---|
| 1 | **Schema estrito do servidor** (`serverExportJobSchema` + recálculo do ref) em `packages/contracts` | **100% local** | Testes de jobs válidos e inválidos (cada regra da seção 4); jobs reais do app (Etapas 2 e 3) passam | Apagar o arquivo; nada usa ainda. |
| 2 | **Decodificação com FFmpeg + paridade com o Chrome** (seção 5) | **100% local** (FFmpeg + Chrome já presentes) | Tabela de paridade; WAV/FLAC bit a bit; AAC/MP3 dentro do critério; atraso 0 | Módulo isolado. **Se falhar, paro e pergunto antes da fatia 3.** |
| 3 | **Serviço local em Docker, de ponta a ponta, sem nuvem**: `/run` lendo de um MinIO local (no lugar do R2), banco simulado por um adaptador, assets do bucket público | Local, **precisa de Docker funcionando** (hoje o comando `docker` não está disponível nesta máquina [MEDIDO]) | Job da Etapa 3 → arquivo idêntico ao do `run-export-job` (sha256_f32 igual); limites recusam; teste de logs sem conteúdo | Não toca o app. |
| 4 | **Banco e crédito**: migração `export_jobs` + RPCs + RLS + testes SQL (corridas, idempotência, invariante) | Local com Supabase CLI (precisa de Docker) **ou** num projeto/branch Supabase de teste | Testes de todas as linhas da tabela 3.3; `spend_export_credit` atual inalterado | Migração de reversão (drop das tabelas, funções e tipos novos); nada existente muda. |
| 5 | **R2 + URLs pré-assinadas** (PUT com tamanho, GET de 60 s, regra de 1 dia) | Precisa de **conta Cloudflare** (R2) | PUT/GET funcionam; URL vencida falha; objeto some em 24 h | Desligar as rotas; esvaziar o bucket. |
| 6 | **Fila e progresso**: rotas da Vercel + Cloud Tasks + Realtime | Precisa de **conta Google Cloud** | Job de ponta a ponta com progresso na tela; retentativa após matar a instância; teto de concorrência | Interruptor desligado. |
| 7 | **Deploy no Cloud Run** (imagem, Secret Manager, OIDC, região, limites, alertas de orçamento) | GCP | `/run` só com OIDC; 10 jobs reais; custo por job registrado e próximo da seção 8; alertas configurados | `gcloud run services delete` ou `max-instances 0`; interruptor. |
| 8 | **Feature flag no cliente**, primeiro **só na sua conta**; fallback para o aparelho | App (Vercel) | Roteiro de fumaça (`docs/roteiro-fumaca-exportacao.md`) passando pelo servidor; mesmo `p_ref`; saldo correto; fallback quando o servidor recusa | Flag desligada = app exatamente como hoje. |
| 9 | **Remux de vídeo** (só trocar o áudio) | Local + GCP | Duração, resolução e sincronia iguais ao `exportVideo` do app (roteiro de fumaça, item b) | Flag só para remux. |

**O que dá para fazer e testar 100% local, antes de qualquer conta:** as fatias 1 e 2 já (sem
Docker), e as fatias 3 e 4 com Docker funcionando nesta máquina.

**Contas e configurações que dependem de você:**
- **Cloudflare:** R2 e um bucket privado `mixpro-exports` (fatia 5).
- **Google Cloud:** projeto com faturamento (exige cartão, mesmo na cota grátis), Cloud Run,
  Cloud Tasks, Artifact Registry, Secret Manager e alertas de orçamento (fatias 6 e 7).
- **Vercel:** variáveis novas `R2_*`, `GCP_*`, `EXPORT_SERVICE_URL` e `EXPORT_TASKS_QUEUE`; e
  confiança OIDC com o GCP (fatia 6).

---

## 11. Decisões tomadas (aprovação de 2026-10-03)

| # | Decisão |
|---|---|
| 1 | **Ancorar o `p_ref` ao conteúdo: sim**, mas ao **fingerprint do áudio decodificado no servidor** (`signalFingerprint`), não aos bytes enviados: a trilha extraída pode variar entre navegadores. Em `REF_MISMATCH` o painel **oferece processar no aparelho**, sem mensagem técnica. |
| 2 | **Aparelho como alternativa: sim**, com revisão marcada (risco conhecido abaixo). |
| 3 | **Enviar só a trilha de áudio: sim.** |
| 4 | **Remux no aparelho:** o servidor devolve só o áudio em AAC e o vídeo nunca sai do celular. |
| 5 | **Sem música de fundo na v1.** |
| 6 | **`us-central1`**; **confirmar os preços na página oficial do Cloud Run antes da fatia 7.** |
| 7 | **2 GiB e 10 min** no começo; com falta de memória no teste real, subir para 3 GiB ou limitar a 8 min. |
| 8 | **Débito na entrega, com reserva ao criar.** |
| 9 | **Paridade de referência: Chrome no computador.** |
| 10 | **Workload Identity Federation**; se der trabalho demais, chave só em produção, com rotação. |
| 11 | **Sem Docker nesta máquina.** Fatia 3: serviço com tsx + FFmpeg portátil e armazenamento em pasta local (no lugar do MinIO); o `Dockerfile` é construído e testado no GitHub Actions (Ubuntu). Fatia 4: um **segundo projeto Supabase gratuito, só de teste**, com arquivo de variáveis separado (nunca as chaves de produção). Se o `supabase db push` exigir Docker, você aplica pelo editor SQL. |
| 12 | **Limites como propostos** (R$ 0), com ajuste depois. |
| 13 | **Apagar o JSON do job no `done`.** |
| 14 | **Tabelas legadas como estão.** |

**Ordem de execução:**
- fatias 1 e 2 primeiro;
- antes da 2, perguntar quais arquivos da seção 5.3 já foram enviados;
- **nenhuma fatia a partir da 3 sem aprovação do resultado da 2**;
- branch `feat/export-server`, criada a partir de `feat/export-job`.

### Risco conhecido: cobrança contornável na exportação final no aparelho

- **O problema:**
  - enquanto a exportação final puder acontecer no aparelho, o arquivo é gerado **antes** do
    débito e o débito é pedido pelo próprio cliente (`spend_export_credit`);
  - quem usa o DevTools consegue gerar o arquivo e pular o débito, ou reaproveitar um `p_ref`
    já pago;
  - o servidor fecha essa brecha **só no caminho dele**.
- **Data de revisão: 2027-01-15** [ESTIMATIVA: ~3 meses depois da fatia 8]. Nessa data, decidir
  se a exportação **final** no aparelho é aposentada, mantendo no aparelho só a prévia e o que o
  servidor ainda não faz (render de vídeo até a Etapa 5).
- **Condições para aposentar:**
  - servidor estável por 30 dias, com taxa de falha < 1% [ESTIMATIVA];
  - custo dentro do orçamento;
  - paridade aprovada;
  - fallback do aparelho usado em < 5% dos jobs [ESTIMATIVA].

### Perguntas originais (com as recomendações que foram aprovadas)

| # | Pergunta | Minha recomendação |
|---|---|---|
| 1 | **Ancorar o `p_ref` ao conteúdo** (seção 3.4)? Fecha a brecha de repetir um ref pago com outro arquivo. Refs pagos no aparelho seriam ancorados no primeiro uso no servidor. | **Sim.** |
| 2 | **Manter o processamento no aparelho como alternativa?** | **Sim**, por pelo menos 3 meses e para sempre no render de vídeo, até a Etapa 5. |
| 3 | **O que enviar num job de áudio:** só a trilha de áudio (cópia sem recodificar, ~1 MB/min) ou o arquivo inteiro? | **Só a trilha.** Upload 10 a 50× menor em vídeo [ESTIMATIVA], mais barato e rápido no 4G. A cópia já existe no app. |
| 4 | **Remux no servidor ou no aparelho?** No servidor, exige enviar o **vídeo inteiro** (centenas de MB no celular). Alternativa: o servidor devolve só o áudio tratado em AAC e o **aparelho junta** com o vídeo original sem recodificar (o mediabunny já faz isso no `exportVideo`). | **No aparelho**, com o áudio vindo do servidor: muito menos upload, e o arquivo de vídeo nunca sai do celular. Se você preferir no servidor, o limite fica em 600 MB. |
| 5 | **Música de fundo na v1?** | **Não:** jobs com música vão para o aparelho. Entra numa fatia seguinte, com segundo upload. |
| 6 | **Região do Cloud Run:** `us-central1` (faixa 1, cota grátis) ou `southamerica-east1` (perto, provavelmente mais cara)? | **`us-central1`**, porque a latência não importa em job de lote. |
| 7 | **Memória e duração máxima no servidor:** 4 GiB e 15 min, ou 2 GiB e 10 min (dobra a cota grátis)? | **2 GiB e 10 min no começo** (cabe em R$ 0); acima de 10 min, aparelho. Rever com os custos reais da fatia 7. |
| 8 | **Quando debitar:** na entrega, com reserva ao criar (como você pediu), ou na criação? | **Na entrega, com reserva** (seção 3). |
| 9 | **Referência de paridade da decodificação:** o Chrome no computador (bit a bit/90 dB), aceitando que o Safari já difere hoje? | **Sim.** |
| 10 | **Autenticação Vercel → GCP:** Workload Identity Federation (sem chave) ou chave de conta de serviço numa variável? | **WIF.** Se der trabalho demais, chave só em produção, com rotação. |
| 11 | **Docker nesta máquina:** o Docker Desktop parece instalado, mas o comando `docker` não responde. Você pode deixá-lo funcionando, ou prefere que eu use um projeto Supabase de teste na fatia 4? | **Docker funcionando** (fatias 3 e 4 100% locais). |
| 12 | **Limites:** 10 jobs/hora e 40/dia por usuário; global de 6.000 vCPU-s/dia (cota grátis) e 300 jobs/dia; 2 em paralelo. | Começar assim (R$ 0) e ajustar pelo painel. |
| 13 | **JSON do job:** apagar no `done` (só ficam as medidas) ou guardar 24 h para depuração? | **Apagar no `done`.** |
| 14 | **Tabelas legadas** (`processing_jobs` etc.): deixar como estão agora e decidir a remoção depois? | **Deixar.** |

---

## Referências de preço

- Cloudflare R2: <https://developers.cloudflare.com/r2/pricing/> (página oficial, consultada em
  2026-10-03).
- Cloud Run: busca em 2026-10-03; a página oficial <https://cloud.google.com/run/pricing> não
  carregou pela ferramenta. **Os números do Cloud Run precisam ser confirmados.**

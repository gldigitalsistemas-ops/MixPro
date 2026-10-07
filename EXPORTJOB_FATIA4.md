# ExportJob: fatia 4 (banco e crédito)

Data: 2026-10-07. Branch `feat/export-server`.

**Nada foi aplicado** em nenhum projeto Supabase, nem no de teste nem no de produção. Nenhuma chave
de produção foi usada ou lida.

## 1. Resumo

**Banco.**
- **Migração nova:** `supabase/migrations/20261007000001_export_jobs.sql`. Ela cria:
  - as tabelas `export_jobs`, `export_ref_anchors` (âncora do p_ref) e `export_job_status`
    (espelho para o Realtime);
  - a view `my_export_jobs`;
  - 9 RPCs que só a service role chama.
- **Nada existente foi alterado:** nem `spend_export_credit`, nem `grant_credits`, nem as tabelas
  existentes, nem o app web.
- **Reversão:** `supabase/rollback/20261007000001_export_jobs_down.sql`. Fica fora de `migrations/`
  de propósito, para um `db push` não aplicar a reversão em seguida.

**Serviço.**
- O `SupabaseJobStore` (`apps/export-service/src/adapters/supabase-jobs.ts`) implementa a mesma
  interface `JobStore` da fatia 3.
- O pipeline só ganhou três coisas:
  - a telemetria da entrada no `release`;
  - a remoção da saída quando o commit é recusado;
  - os 4 códigos novos: `REF_MISMATCH`, `INSUFFICIENT_CREDITS`, `RATE_LIMITED` e `CAPACITY`.

**Testes.**
- A lógica SQL foi validada num Postgres local em memória (PGlite): **15/15** [MEDIDO].
- Os testes REST contra o projeto de teste estão escritos (11 casos, de (a) a (k)), mas **ainda não
  rodaram**: o projeto de teste e o `.env.export-test` não existem.

## 2. Avaliação: Realtime com lista de colunas

**Não usei.** A publicação com lista de colunas existe no Postgres 15. Para o cliente recebê-la no
Supabase, porém, seriam necessárias duas coisas:
- supabase-js ≥ 2.109;
- `SELECT` do `authenticated` nas colunas da tabela-base, porque o Realtime confere a RLS da tabela
  com o papel do cliente.

A segunda reabre a tabela ao cliente, que é justamente o que se queria evitar. E uma view não pode
ser assinada no Realtime.

**Solução adotada:** a tabela `export_job_status`, um espelho atualizado por gatilho.
- Colunas: só `job_id`, `user_id`, `status`, `progress`, `credit_state`, `error_code` e
  `updated_at`.
- RLS "dono lê", nenhuma escrita do cliente, publicada no `supabase_realtime`.
- Para a lista completa, o cliente lê a view `my_export_jobs`.

Confiança: o desenho do espelho está no código [CÓDIGO]. A avaliação da lista de colunas no
Realtime do Supabase não foi testada contra o Realtime real [ESTIMATIVA]; dá para conferir na
fatia 6.

## 3. Decisões no SQL

1. **`job_text` é TEXT, não `jsonb`.** O `jsonb` reordena as chaves, e o p_ref é recalculado sobre o
   JSON cru.
2. **Âncora do p_ref.**
   - É o `content_fingerprint`: 8 hex do `signalFingerprint` do **áudio decodificado** no servidor.
   - Fica em `export_ref_anchors`, com chave `(user_id, idempotency_ref)`.
   - É conferida e gravada **dentro do `commit_export_credit`**, na mesma transação do débito.
   - Se a âncora for diferente: `failed` + `REF_MISMATCH`, a reserva é liberada, ninguém é cobrado e
     o serviço apaga a saída.
   - Um ref pago no aparelho, sem âncora, é ancorado no primeiro commit no servidor.
3. **Débito com a chave exata do app.**
   - Chamada: `grant_credits(..., 'export:' || uid || ':' || p_ref)`.
   - Lock: o mesmo `pg_advisory_xact_lock(hashtext('credits:' || uid))`, em todas as RPCs que mexem
     com crédito.
4. **Reserva.**
   - É um job em `queued`/`running` com `credit_state = 'reserved'`.
   - Disponível = `credit_balance` − reservas ativas.
   - Não existe linha no ledger para a reserva: o ledger só recebe o débito real.
5. **Ordem do `create_export_job`:**
   1. Job ativo com o mesmo ref → `existing`.
   2. `done` com saída válida → `done`.
   3. Interruptor desligado → `CAPACITY`.
   4. Limites do usuário (1 ativo, 10/h, 40/dia) → `RATE_LIMITED`.
   5. Tetos globais do dia (6.000 s de CPU, 300 jobs, no horário de Brasília) → `CAPACITY`.
   6. Já pago → `charged`; saldo disponível ≥ 1 → `reserved`; senão, `INSUFFICIENT_CREDITS`.
6. **Os tetos globais são aproximados.** Usuários diferentes não compartilham o lock, então dois
   jobs no limite podem passar juntos (no máximo a concorrência do Cloud Tasks, 2).
7. **Erros.**
   - Saem como exceção com o código fechado na mensagem.
   - O `SupabaseJobStore` aceita só os códigos da lista; qualquer outra coisa vira `INTERNAL`.
8. **Permissões.** Todas as funções novas têm `revoke execute` de `public`, `anon` e `authenticated`
   e `grant` só para `service_role`.

## 4. Tabela de estados verificada

Os testes da última coluna existem em dois lugares:
- no PGlite (`scratchpad/pg-logic.mjs`, sobre as 27 migrações);
- no REST (`apps/export-service/test/supabase.test.ts`, que ainda não rodou).

| Situação | Estado resultante | Teste |
|---|---|---|
| Criar com saldo | `queued` / `reserved` (o saldo não muda) | (a) |
| Mesmo p_ref enquanto ativo (2 chamadas) | **o mesmo** `job_id`; uma reserva | (a) |
| p_ref já pago no aparelho | `queued` / `charged`; o commit não debita | (b) |
| p_ref pago no servidor, saída válida | `outcome = done`, o mesmo job, sem processar nem cobrar | (b) |
| p_ref pago no servidor, saída expirada | job novo `charged` | (g) |
| `queued` → start | `running`, `attempts + 1` | (a)–(k) |
| `running` recente → start | `busy` | (i) |
| `running` parado → start | retomado (`attempts = 2`) | (i) |
| Falha antes do débito (`release`) | `failed` / `released`; JSON apagado; telemetria gravada | (c) |
| Commit OK | `done` / `charged`; 1 transação no ledger; JSON apagado; medidas, custo e diffs gravados | (d) |
| Commit repetido (no REST, também em paralelo) | continua `done`; **1** transação | (d) |
| Sem saldo ao criar | `INSUFFICIENT_CREDITS`; nenhum job | (e) |
| Saldo gasto no aparelho entre reservar e debitar | `failed` / `released` + `INSUFFICIENT_CREDITS`; a saída não é entregue | (f) |
| Mesmo p_ref com outro áudio | `failed` + `REF_MISMATCH`; sem cobrança | (g) |
| Ref pago no aparelho, 1º uso no servidor | âncora gravada com o fingerprint do servidor | (g) |
| 2º job ativo; 10 por hora; 40 por dia | `RATE_LIMITED` | (h) |
| Teto diário de CPU ou de jobs; interruptor desligado | `CAPACITY` | (h), interruptor |
| `running` parado na limpeza | `failed` / `released` + `TIMEOUT` | (i) |
| `queued` antigo na limpeza | `failed` / `released` + `TIMEOUT` | (i), só no PGlite |
| `expires_at` vencido | `expired`; reserva liberada; JSON apagado | (i), só no PGlite |
| Invariante: `charged` ⇔ transação no ledger; nenhum `done` sem `charged`; nenhuma reserva em job encerrado | 0 / 0 / 0 | (j) |
| Cliente anon/authenticated | não chama as RPCs, não escreve, não lê `export_jobs` nem `export_ref_anchors`. O dono vê só a view (sem `job_text`, `input_key`, `output_key` e `user_id`) e o espelho; outro usuário não vê nada | (k) |
| `refund_export` | só admin, uma vez (chave `refund:<job_id>`) | PGlite; no REST, só a recusa de quem não é admin |

## 5. Resultados dos testes

### 5.1 PGlite: Postgres 17 em WASM, local, em memória, sem Docker [MEDIDO]

**Ambiente.** Nenhum projeto na nuvem: nem o de teste, nem o de produção.
- Shim do Supabase: `supabase/tests/00_supabase_shim.sql`, mais os esquemas `storage` e `cron`
  mínimos e a publicação `supabase_realtime`.
- O PGlite não tem `pg_cron`, então a linha que o cria é removida só ali.

**Resultados.**
- As 27 migrações aplicaram em ≈ 2,3 s: 42 tabelas e views públicas. A reversão volta a 38, o número
  de antes da migração.
- Lógica: **15/15 ok** (interruptor; (a)–(k); telemetria e espelho; refund só para admin).
- Testes dos testes, com mutações propositais:
  - `MUTATE=grant`, que dá execute ao `authenticated`: o caso (k) falhou, como devia.
  - `MUTATE=chave`, que troca a chave do débito: o caso (b) falhou, como devia.

**Limite.** O PGlite tem **uma conexão só**. As corridas com duas conexões ((a), (d) e (f) em
paralelo) só são exercitadas no teste REST, em que cada chamada HTTP usa uma conexão do pool do
PostgREST.

### 5.2 Suíte do repositório [MEDIDO]

| Conjunto | Resultado |
|---|---|
| `apps/web` (`lib/**/*.test.ts`) | 161: 160 ok, 1 pulado (mídia pessoal), 0 falhas |
| `packages/contracts` | 9/9 |
| `apps/export-service` | 18: 7 ok (serviço, com FFmpeg), **11 pulados** (Supabase, sem `.env.export-test`), 0 falhas |
| Typecheck de `apps/web` e `apps/export-service` | sem erros |

### 5.3 Testes contra o projeto de TESTE

**Ainda não rodaram**: o projeto e o `.env.export-test` não existem. No CI eles são pulados, sem
falhar.

**O que fazem.**
- Criam usuários descartáveis (`export-test-<uuid>@example.test`) e ajustam o saldo de cada um com
  `grant_credits`.
- Fazem login por senha para ter o JWT do cliente.
- Simulam o gasto no aparelho com `spend_export_credit`.
- Ajustam `system_settings` e **restauram** os valores no fim.
- Apagam os usuários no fim.

**Trava contra produção.** Se `EXPORT_TEST_PROD_REF` estiver no arquivo e a URL o contiver, os
testes param na hora.

## 6. O que depende de você, nesta ordem

1. **Criar um projeto Supabase gratuito só de teste**, se possível na mesma região do de produção.
2. **Aplicar as migrações no projeto de teste pelo editor SQL** (não precisa de Docker).
   - O projeto começa vazio, então cole **todos** os arquivos de `supabase/migrations/`, um por vez,
     em ordem de nome. O último é `20261007000001_export_jobs.sql`.
   - Se alguma migração antiga der erro de `pg_cron`, ative a extensão em
     Database → Extensions e cole de novo.
3. **Criar `.env.export-test` na raiz do repositório.** O `.gitignore` já ignora `.env.*`.
   ```
   EXPORT_TEST_SUPABASE_URL=https://<ref-do-projeto-de-teste>.supabase.co
   EXPORT_TEST_SUPABASE_ANON_KEY=<anon do projeto de teste>
   EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role do projeto de teste>
   EXPORT_TEST_PROD_REF=<ref do projeto de PRODUÇÃO, só o identificador, como trava>
   ```
4. **Rodar os testes.** Eles ligam o `export_server_enabled` no projeto de teste e o restauram no
   fim.
   ```
   cd apps/export-service
   ../../packages/contracts/node_modules/.bin/tsx --test test/supabase.test.ts
   ```
   Depois, me mande o resultado ou peça para eu rodar.
5. **Produção: nada agora.** A migração só vai para produção depois das fatias 5 (R2) e 6 (fila) e
   da sua aprovação, com `export_server_enabled = false` (o padrão da migração).

## 7. Plano de reversão

**No projeto de teste (ou, no futuro, em produção):** colar
`supabase/rollback/20261007000001_export_jobs_down.sql` no editor SQL. O script:
- tira `export_job_status` da publicação;
- apaga as 9 RPCs e as 4 funções auxiliares, o gatilho, a view, as 3 tabelas e os 2 tipos;
- remove as 6 chaves `export_*` de `system_settings`.

**O que a reversão não toca:** `credit_transactions`, `grant_credits`, `spend_export_credit` e o
app. Os débitos já feitos pelo servidor continuam no ledger como débitos normais do app, com a mesma
chave.

**Validação:** no PGlite, a reversão volta de 42 para 38 tabelas e views públicas [MEDIDO].

**Sem reverter nada:** desligar o `export_server_enabled` faz a criação recusar na hora
(`CAPACITY`), e o app continua processando no aparelho.

**No código:** sem `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, o serviço volta ao
`LocalJobStore` da fatia 3. Os commits desta fatia podem ser desfeitos com `git revert`.

## 8. Commits (sem push)

- `a5bb223` feat(db): export_jobs e RPCs de crédito com reserva
- `58c3192` feat(export-service): códigos de crédito e telemetria de entrada no release
- `81a23ae` feat(export-service): SupabaseJobStore sobre as RPCs
- `c35dd49` test(export-service): casos (a)–(k) contra o projeto de teste
- `1ce06c9` docs: plano, seção 2.4
- este relatório

## Anexo A: SQL final (`supabase/migrations/20261007000001_export_jobs.sql`)

```sql
-- =============================================================================
-- Etapa 4, fatia 4: jobs de exportação no servidor + crédito com reserva.
--
-- TUDO NOVO: nenhuma tabela, função ou política existente é alterada (spend_export_credit,
-- grant_credits e credit_transactions continuam como estão). Reversão em
-- supabase/rollback/20261007000001_export_jobs_down.sql (fora desta pasta de propósito, para nunca
-- ser aplicada por engano junto com as migrações).
--
-- Regras (ETAPA4_PLANO.md, seção 3):
--   * reservar ao criar, debitar ao entregar, liberar ao falhar;
--   * o débito usa EXATAMENTE a chave do app: 'export:' || uid || ':' || p_ref (pagar no aparelho
--     e no servidor é a mesma coisa; nunca cobra duas vezes);
--   * tudo que mexe em crédito pega o MESMO lock por usuário do grant_credits;
--   * as RPCs são só para o servidor (service_role); o cliente só LÊ, por uma view sem as colunas
--     sensíveis e por uma tabela de status (Realtime).
-- =============================================================================

create type public.export_status as enum ('queued', 'running', 'done', 'failed', 'expired');
create type public.export_credit_state as enum ('none', 'reserved', 'charged', 'released');

create table public.export_jobs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  status               public.export_status not null default 'queued',
  progress             smallint not null default 0 check (progress between 0 and 100),
  -- 'video' = vídeo só trocando o áudio: o servidor devolve o áudio e o aparelho junta (remux)
  kind                 text not null check (kind in ('audio', 'video')),
  target               text not null check (target in ('wav', 'mp3', 'm4a', 'video')),
  idempotency_ref      text not null check (idempotency_ref ~ '^[a-zA-Z0-9:_-]{8,128}$'),
  credit_state         public.export_credit_state not null default 'none',
  credit_tx_id         uuid references public.credit_transactions (id) on delete set null,
  refunded_at          timestamptz,
  -- o ExportJob como o cliente enviou, em TEXTO: jsonb reordenaria as chaves, e a ordem entra no
  -- p_ref recalculado pelo servidor. Apagado no done, na falha e na expiração.
  job_text             text check (octet_length(job_text) <= 65536),
  -- arquivos no armazenamento (R2): só chaves aleatórias, nunca o nome do arquivo
  input_key            text unique check (input_key ~ '^in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  output_key           text unique check (output_key ~ '^out/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|mp3|m4a)$'),
  output_bytes         bigint,
  -- signalFingerprint do áudio decodificado no servidor (âncora do p_ref)
  content_fingerprint  text check (content_fingerprint ~ '^[0-9a-f]{8}$'),
  -- medidas do resultado
  duration_s           numeric(10, 3),
  samples              bigint,
  channels             smallint,
  sample_rate          integer,
  lufs                 numeric(7, 3),
  peak                 numeric(9, 6),
  sha256_f32           text check (sha256_f32 ~ '^[0-9a-f]{64}$'),
  -- custo (nunca conteúdo)
  cpu_ms               integer,
  peak_rss_mb          integer,
  wall_ms              integer,
  etapas_ms            jsonb,
  -- telemetria de divergência: medido no servidor − declarado pelo aparelho (seção 5.5 do plano)
  diff_samples         bigint,
  diff_duration_ms     integer,
  diff_audio_start_ms  numeric(10, 3),
  -- só a categoria, derivada do user-agent na rota da Vercel (o user-agent em si não é gravado)
  client_platform      text check (client_platform ~ '^(ios|android|desktop|outro)/(safari|chrome|firefox|outro)$'),
  -- código fechado (ex.: DURATION_MISMATCH), nunca texto livre
  error_code           text check (error_code ~ '^[A-Z_]{3,40}$'),
  attempts             smallint not null default 0,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  expires_at           timestamptz not null default now() + interval '24 hours'
);

-- um job ativo por resultado: dois cliques simultâneos caem no mesmo job (a RPC também confere,
-- dentro do lock; o índice é a última barreira)
create unique index export_jobs_active_ref on public.export_jobs (user_id, idempotency_ref)
  where status in ('queued', 'running');
create index export_jobs_user_recent on public.export_jobs (user_id, created_at desc);
create index export_jobs_expiry on public.export_jobs (expires_at) where status <> 'expired';
create index export_jobs_running on public.export_jobs (started_at) where status = 'running';
create index export_jobs_finished on public.export_jobs (finished_at) where finished_at is not null;

-- Âncora do p_ref: o primeiro uso de um p_ref no servidor grava o fingerprint do ÁUDIO
-- DECODIFICADO. Outro conteúdo com o mesmo p_ref é recusado (REF_MISMATCH).
create table public.export_ref_anchors (
  user_id              uuid not null references public.profiles (id) on delete cascade,
  idempotency_ref      text not null check (idempotency_ref ~ '^[a-zA-Z0-9:_-]{8,128}$'),
  content_fingerprint  text not null check (content_fingerprint ~ '^[0-9a-f]{8}$'),
  created_at           timestamptz not null default now(),
  primary key (user_id, idempotency_ref)
);

-- Status para o Realtime (só o que o aparelho precisa, sem nada sensível). Mantida por gatilho.
create table public.export_job_status (
  job_id       uuid primary key references public.export_jobs (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       public.export_status not null,
  progress     smallint not null,
  credit_state public.export_credit_state not null,
  error_code   text,
  updated_at   timestamptz not null default now()
);
create index export_job_status_user on public.export_job_status (user_id);

create or replace function public.export_job_status_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.export_job_status (job_id, user_id, status, progress, credit_state, error_code, updated_at)
  values (new.id, new.user_id, new.status, new.progress, new.credit_state, new.error_code, now())
  on conflict (job_id) do update set
    status = excluded.status, progress = excluded.progress, credit_state = excluded.credit_state,
    error_code = excluded.error_code, updated_at = now();
  return null;
end $$;

create trigger export_jobs_status_sync
  after insert or update of status, progress, credit_state, error_code on public.export_jobs
  for each row execute function public.export_job_status_sync();

-- -----------------------------------------------------------------------------
-- Acesso: o cliente NÃO escreve nada e NÃO lê export_jobs diretamente.
-- -----------------------------------------------------------------------------
alter table public.export_jobs enable row level security;
alter table public.export_ref_anchors enable row level security;
alter table public.export_job_status enable row level security;

revoke all on table public.export_jobs, public.export_ref_anchors, public.export_job_status from anon, authenticated;

-- status: o dono lê as próprias linhas (é o que o Realtime entrega)
create policy "export_job_status: dono lê" on public.export_job_status
  for select to authenticated using (user_id = auth.uid());
grant select on table public.export_job_status to authenticated;

-- view para o dono listar os próprios jobs, SEM job_text, input_key, output_key, credit_tx_id,
-- fingerprint e sha. Roda com os privilégios do dono da view (o filtro por auth.uid() está nela).
create view public.my_export_jobs with (security_barrier = true) as
  select id, status, progress, kind, target, credit_state, error_code,
         duration_s, lufs, peak, output_bytes,
         created_at, finished_at, expires_at
  from public.export_jobs
  where user_id = auth.uid();
revoke all on table public.my_export_jobs from anon, authenticated;
grant select on table public.my_export_jobs to authenticated;

-- Realtime: só a tabela de status entra na publicação
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.export_job_status;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Configurações (limites e interruptor). O servidor nasce DESLIGADO.
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public) values
  ('export_server_enabled', 'false', 'Exportação no servidor ligada (interruptor geral). Desligada: o app processa no aparelho.', false),
  ('export_user_active', '1', 'Jobs de exportação ativos (na fila ou rodando) por usuário.', false),
  ('export_user_per_hour', '10', 'Jobs de exportação por usuário por hora.', false),
  ('export_user_per_day', '40', 'Jobs de exportação por usuário por dia.', false),
  ('export_server_daily_cpu_s', '6000', 'Teto diário (horário de Brasília) de CPU do servidor de exportação, em segundos.', false),
  ('export_server_daily_jobs', '300', 'Teto diário (horário de Brasília) de jobs de exportação.', false)
on conflict (key) do nothing;

create or replace function public.export_setting_bool(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::boolean from public.system_settings where key = p_key
$$;

/** Início do dia de hoje no horário de Brasília (para os tetos diários). */
create or replace function public.export_day_start()
returns timestamptz language sql stable as $$
  select (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo'
$$;

-- -----------------------------------------------------------------------------
-- RPCs (só service_role). Erros saem como exceção com um CÓDIGO FECHADO na mensagem.
-- -----------------------------------------------------------------------------

/**
 * Cria o job e RESERVA 1 crédito (ou marca como já pago). Ordem:
 *  1. o mesmo resultado já em andamento → devolve o mesmo job (sem nova reserva);
 *  2. o mesmo resultado pronto e ainda disponível → devolve esse job;
 *  3. interruptor, limites do usuário e tetos do dia → CAPACITY / RATE_LIMITED;
 *  4. p_ref já pago (no aparelho ou no servidor) → 'charged', sem cobrar de novo;
 *     senão, disponível = saldo − reservas ativas ≥ 1 → 'reserved'; senão INSUFFICIENT_CREDITS.
 */
create or replace function public.create_export_job(
  p_user uuid, p_ref text, p_target text, p_job text, p_input_key text, p_platform text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.export_jobs;
  v_paid public.credit_transactions;
  v_available integer;
  v_day timestamptz := public.export_day_start();
begin
  if p_user is null or p_ref is null or p_ref !~ '^[a-zA-Z0-9:_-]{8,128}$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_target is null or p_target not in ('wav', 'mp3', 'm4a', 'video') then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_job is null or octet_length(p_job) > 65536 then
    raise exception 'TOO_LARGE' using errcode = '22023';
  end if;
  begin
    perform p_job::jsonb;
  exception when others then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end;
  if p_input_key is null or p_input_key !~ '^in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform !~ '^(ios|android|desktop|outro)/(safari|chrome|firefox|outro)$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;

  -- o mesmo lock do grant_credits: reservar, debitar e o saldo nunca se cruzam
  perform pg_advisory_xact_lock(hashtext('credits:' || p_user::text));

  select * into v_job from public.export_jobs
   where user_id = p_user and idempotency_ref = p_ref and status in ('queued', 'running') limit 1;
  if found then
    return jsonb_build_object('job_id', v_job.id, 'outcome', 'existing', 'status', v_job.status, 'credit_state', v_job.credit_state);
  end if;

  select * into v_job from public.export_jobs
   where user_id = p_user and idempotency_ref = p_ref and status = 'done' and output_key is not null and expires_at > now()
   order by finished_at desc limit 1;
  if found then
    return jsonb_build_object('job_id', v_job.id, 'outcome', 'done', 'status', v_job.status, 'credit_state', v_job.credit_state);
  end if;

  if not coalesce(public.export_setting_bool('export_server_enabled'), false) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;
  if (select count(*) from public.export_jobs where user_id = p_user and status in ('queued', 'running'))
       >= coalesce(public.setting_int('export_user_active'), 1)
     or (select count(*) from public.export_jobs where user_id = p_user and created_at > now() - interval '1 hour')
       >= coalesce(public.setting_int('export_user_per_hour'), 10)
     or (select count(*) from public.export_jobs where user_id = p_user and created_at > now() - interval '1 day')
       >= coalesce(public.setting_int('export_user_per_day'), 40) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  -- tetos globais do dia (aproximados: usuários diferentes não compartilham o lock)
  if (select coalesce(sum(cpu_ms), 0) from public.export_jobs where finished_at >= v_day)
       >= coalesce(public.setting_int('export_server_daily_cpu_s'), 6000)::bigint * 1000
     or (select count(*) from public.export_jobs where created_at >= v_day)
       >= coalesce(public.setting_int('export_server_daily_jobs'), 300) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;

  select * into v_paid from public.credit_transactions
   where idempotency_key = 'export:' || p_user::text || ':' || p_ref;
  if found then
    insert into public.export_jobs (user_id, kind, target, idempotency_ref, credit_state, credit_tx_id, job_text, input_key, client_platform)
    values (p_user, case p_target when 'video' then 'video' else 'audio' end, p_target, p_ref, 'charged', v_paid.id, p_job, p_input_key, p_platform)
    returning * into v_job;
  else
    v_available := public.credit_balance(p_user, 'download')
      - (select count(*) from public.export_jobs where user_id = p_user and credit_state = 'reserved' and status in ('queued', 'running'))::integer;
    if v_available < 1 then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;
    insert into public.export_jobs (user_id, kind, target, idempotency_ref, credit_state, job_text, input_key, client_platform)
    values (p_user, case p_target when 'video' then 'video' else 'audio' end, p_target, p_ref, 'reserved', p_job, p_input_key, p_platform)
    returning * into v_job;
  end if;
  return jsonb_build_object('job_id', v_job.id, 'outcome', 'created', 'status', v_job.status, 'credit_state', v_job.credit_state);
end $$;

/** Linha completa do job para o serviço (inclui job_text e input_key; só service_role chama). */
create or replace function public.get_export_job(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(j) from public.export_jobs j where j.id = p_job_id
$$;

/** queued → running (attempts + 1). Um running mais velho que p_stale_seconds pode ser retomado. */
create or replace function public.start_export_job(p_job_id uuid, p_stale_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.export_jobs;
begin
  select * into v from public.export_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if v.status = 'done' then
    return jsonb_build_object('outcome', 'done', 'job', to_jsonb(v));
  end if;
  if v.status in ('failed', 'expired') then
    return jsonb_build_object('outcome', 'failed', 'job', to_jsonb(v));
  end if;
  if v.status = 'running' and v.started_at > now() - make_interval(secs => p_stale_seconds) then
    return jsonb_build_object('outcome', 'busy', 'job', to_jsonb(v));
  end if;
  update public.export_jobs set status = 'running', attempts = attempts + 1, started_at = now()
   where id = p_job_id returning * into v;
  return jsonb_build_object('outcome', 'started', 'job', to_jsonb(v));
end $$;

/** Progresso do job (só aumenta, só enquanto roda). */
create or replace function public.report_export_progress(p_job_id uuid, p_pct integer)
returns void language sql security definer set search_path = public as $$
  update public.export_jobs set progress = greatest(progress, least(100, greatest(0, p_pct)))
   where id = p_job_id and status = 'running' and greatest(progress, least(100, greatest(0, p_pct))) <> progress
$$;

/** Diferenças medido − declarado (telemetria), a partir do job declarado e do que o servidor observou. */
create or replace function public.export_job_diffs(p_job_text text, p_observed jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_src jsonb;
  v_sr numeric;
begin
  if p_job_text is null or p_observed is null then
    return '{}'::jsonb;
  end if;
  v_src := p_job_text::jsonb -> 'source';
  v_sr := coalesce((p_observed ->> 'input_sample_rate')::numeric, (v_src ->> 'sample_rate')::numeric);
  return jsonb_strip_nulls(jsonb_build_object(
    'diff_samples', (p_observed ->> 'input_samples')::bigint - round((v_src ->> 'duration_s')::numeric * v_sr)::bigint,
    'diff_duration_ms', round(((p_observed ->> 'input_duration_s')::numeric - (v_src ->> 'duration_s')::numeric) * 1000)::integer,
    'diff_audio_start_ms', round(((p_observed ->> 'input_audio_start_s')::numeric - (v_src ->> 'audio_start_s')::numeric) * 1000, 3)
  ));
exception when others then
  return '{}'::jsonb;
end $$;

/**
 * Entrega: confere a âncora do p_ref, DEBITA (mesma chave do app) e marca done — tudo numa
 * transação só. Idempotente: num job já done não faz nada. Sem saldo (gastou em outro lugar
 * entre reservar e entregar) → failed + INSUFFICIENT_CREDITS. Outro conteúdo com o mesmo p_ref
 * → failed + REF_MISMATCH. Nos dois casos o serviço não entrega a saída.
 */
create or replace function public.commit_export_credit(p_job_id uuid, p_output_key text, p_measures jsonb, p_cost jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.export_jobs;
  v_fp text := p_measures ->> 'content_fingerprint';
  v_anchor text;
  v_tx public.credit_transactions;
  v_tx_id uuid;
  v_diffs jsonb;
begin
  select * into v from public.export_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = 'done' then
    return jsonb_build_object('status', 'done', 'idempotent', true);
  end if;
  if v.status <> 'running' then
    raise exception 'NOT_RUNNING' using errcode = 'P0001';
  end if;
  if p_output_key is null or p_output_key !~ '^out/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|mp3|m4a)$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if v_fp is null or v_fp !~ '^[0-9a-f]{8}$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v.user_id::text));
  v_diffs := public.export_job_diffs(v.job_text, p_measures);

  -- âncora: outro conteúdo com o mesmo p_ref não usa o crédito já pago
  select content_fingerprint into v_anchor from public.export_ref_anchors
   where user_id = v.user_id and idempotency_ref = v.idempotency_ref;
  if found and v_anchor <> v_fp then
    update public.export_jobs set
      status = 'failed', error_code = 'REF_MISMATCH', job_text = null, finished_at = now(),
      credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end,
      content_fingerprint = v_fp,
      cpu_ms = (p_cost ->> 'cpu_ms')::integer, peak_rss_mb = (p_cost ->> 'rss_mb')::integer, wall_ms = (p_cost ->> 'wall_ms')::integer,
      etapas_ms = p_cost -> 'etapas_ms',
      diff_samples = (v_diffs ->> 'diff_samples')::bigint, diff_duration_ms = (v_diffs ->> 'diff_duration_ms')::integer,
      diff_audio_start_ms = (v_diffs ->> 'diff_audio_start_ms')::numeric
     where id = p_job_id;
    return jsonb_build_object('status', 'failed', 'error_code', 'REF_MISMATCH');
  end if;

  if v.credit_state = 'reserved' then
    begin
      v_tx := public.grant_credits(
        v.user_id, 'download', 'DOWNLOAD', -1,
        case v.target when 'video' then 'Vídeo exportado' else 'Áudio exportado' end,
        'export', v.idempotency_ref, 'export:' || v.user_id::text || ':' || v.idempotency_ref
      );
      v_tx_id := v_tx.id;
    exception when others then
      if sqlerrm = 'INSUFFICIENT_CREDITS' then
        update public.export_jobs set
          status = 'failed', error_code = 'INSUFFICIENT_CREDITS', credit_state = 'released', job_text = null, finished_at = now(),
          content_fingerprint = v_fp,
          cpu_ms = (p_cost ->> 'cpu_ms')::integer, peak_rss_mb = (p_cost ->> 'rss_mb')::integer, wall_ms = (p_cost ->> 'wall_ms')::integer,
          etapas_ms = p_cost -> 'etapas_ms'
         where id = p_job_id;
        return jsonb_build_object('status', 'failed', 'error_code', 'INSUFFICIENT_CREDITS');
      end if;
      raise;
    end;
  elsif v.credit_state = 'charged' then
    v_tx_id := v.credit_tx_id;
  else
    raise exception 'BAD_CREDIT_STATE' using errcode = 'P0001';
  end if;

  insert into public.export_ref_anchors (user_id, idempotency_ref, content_fingerprint)
  values (v.user_id, v.idempotency_ref, v_fp)
  on conflict (user_id, idempotency_ref) do nothing;

  update public.export_jobs set
    status = 'done', progress = 100, credit_state = 'charged', credit_tx_id = coalesce(v_tx_id, credit_tx_id),
    output_key = p_output_key, output_bytes = (p_measures ->> 'output_bytes')::bigint,
    content_fingerprint = v_fp,
    duration_s = (p_measures ->> 'duration_s')::numeric, samples = (p_measures ->> 'samples')::bigint,
    channels = (p_measures ->> 'channels')::smallint, sample_rate = (p_measures ->> 'sample_rate')::integer,
    lufs = (p_measures ->> 'lufs')::numeric, peak = (p_measures ->> 'peak')::numeric, sha256_f32 = p_measures ->> 'sha256_f32',
    cpu_ms = (p_cost ->> 'cpu_ms')::integer, peak_rss_mb = (p_cost ->> 'rss_mb')::integer, wall_ms = (p_cost ->> 'wall_ms')::integer,
    etapas_ms = p_cost -> 'etapas_ms',
    diff_samples = (v_diffs ->> 'diff_samples')::bigint, diff_duration_ms = (v_diffs ->> 'diff_duration_ms')::integer,
    diff_audio_start_ms = (v_diffs ->> 'diff_audio_start_ms')::numeric,
    -- decisão 13 do plano: o JSON do job (com o CTA) é apagado no done
    job_text = null, finished_at = now()
   where id = p_job_id;
  return jsonb_build_object('status', 'done');
end $$;

/** Falha: queued/running → failed; reserva liberada; JSON apagado. Nunca mexe num done. */
create or replace function public.release_export_credit(p_job_id uuid, p_code text, p_cost jsonb default null, p_observed jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.export_jobs;
  v_diffs jsonb;
begin
  if p_code is null or p_code !~ '^[A-Z_]{3,40}$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  select * into v from public.export_jobs where id = p_job_id for update;
  if not found then
    return null;
  end if;
  if v.status = 'done' then
    return jsonb_build_object('status', 'done');
  end if;
  if v.status in ('failed', 'expired') then
    return jsonb_build_object('status', v.status, 'error_code', v.error_code);
  end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || v.user_id::text));
  v_diffs := public.export_job_diffs(v.job_text, p_observed);
  update public.export_jobs set
    status = 'failed', error_code = p_code, job_text = null, finished_at = now(),
    credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end,
    cpu_ms = coalesce((p_cost ->> 'cpu_ms')::integer, cpu_ms), peak_rss_mb = coalesce((p_cost ->> 'rss_mb')::integer, peak_rss_mb),
    wall_ms = coalesce((p_cost ->> 'wall_ms')::integer, wall_ms), etapas_ms = coalesce(p_cost -> 'etapas_ms', etapas_ms),
    diff_samples = (v_diffs ->> 'diff_samples')::bigint, diff_duration_ms = (v_diffs ->> 'diff_duration_ms')::integer,
    diff_audio_start_ms = (v_diffs ->> 'diff_audio_start_ms')::numeric
   where id = p_job_id;
  return jsonb_build_object('status', 'failed', 'error_code', p_code);
end $$;

/** Falha passageira: running → queued para o Cloud Tasks tentar de novo. */
create or replace function public.requeue_export_job(p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.export_jobs set status = 'queued' where id = p_job_id and status = 'running'
$$;

/**
 * Estorno manual (só admin): devolve 1 crédito de um job cobrado cuja saída se perdeu.
 * Idempotente pela chave 'refund:' || job_id. p_admin é o usuário admin que pediu (a rota confere a
 * sessão; aqui confere o papel).
 */
create or replace function public.refund_export(p_job_id uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.export_jobs;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v from public.export_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.credit_state <> 'charged' then
    raise exception 'NOT_CHARGED' using errcode = 'P0001';
  end if;
  perform public.grant_credits(
    v.user_id, 'download', 'REFUND', 1, 'Estorno de exportação', 'export_refund', v.id::text,
    'refund:' || v.id::text, p_admin
  );
  update public.export_jobs set refunded_at = coalesce(refunded_at, now()) where id = p_job_id;
  return jsonb_build_object('status', 'refunded');
end $$;

/**
 * Limpeza (agendada: cron da Vercel ou pg_cron, a cada 15 min):
 *  - running parado há mais que p_stale_seconds → failed TIMEOUT, reserva liberada;
 *  - queued há mais que p_stale_seconds × 2 → failed TIMEOUT, reserva liberada;
 *  - expirado (expires_at) → expired, JSON apagado, reserva liberada; a saída some pela regra do R2.
 */
create or replace function public.cleanup_export_jobs(p_stale_seconds integer default 1800)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_stuck integer;
  v_queued integer;
  v_expired integer;
begin
  update public.export_jobs set status = 'failed', error_code = 'TIMEOUT', job_text = null, finished_at = now(),
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status = 'running' and started_at < now() - make_interval(secs => p_stale_seconds);
  get diagnostics v_stuck = row_count;

  update public.export_jobs set status = 'failed', error_code = 'TIMEOUT', job_text = null, finished_at = now(),
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status = 'queued' and created_at < now() - make_interval(secs => p_stale_seconds * 2);
  get diagnostics v_queued = row_count;

  update public.export_jobs set status = 'expired', job_text = null,
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status <> 'expired' and expires_at < now();
  get diagnostics v_expired = row_count;

  return jsonb_build_object('parados', v_stuck, 'fila_antiga', v_queued, 'expirados', v_expired);
end $$;

/** Diagnóstico da invariante: 'charged' ⇔ existe a transação de débito com a chave do app. */
create or replace function public.export_jobs_invariant_violations()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- cobrado sem a transação no ledger
    'charged_sem_transacao', (select count(*) from public.export_jobs j
       where j.credit_state = 'charged'
         and not exists (select 1 from public.credit_transactions t
                          where t.idempotency_key = 'export:' || j.user_id::text || ':' || j.idempotency_ref)),
    -- entregue sem estar cobrado
    'done_sem_charged', (select count(*) from public.export_jobs j where j.status = 'done' and j.credit_state <> 'charged'),
    -- reserva presa num job que já terminou
    'reserva_em_job_encerrado', (select count(*) from public.export_jobs j
       where j.credit_state = 'reserved' and j.status in ('done', 'failed', 'expired'))
  )
$$;

-- -----------------------------------------------------------------------------
-- Execução: só service_role. Nada para anon/authenticated (nem PUBLIC, que é o padrão do Postgres).
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_export_job(uuid, text, text, text, text, text)',
    'public.get_export_job(uuid)',
    'public.start_export_job(uuid, integer)',
    'public.report_export_progress(uuid, integer)',
    'public.commit_export_credit(uuid, text, jsonb, jsonb)',
    'public.release_export_credit(uuid, text, jsonb, jsonb)',
    'public.requeue_export_job(uuid)',
    'public.refund_export(uuid, uuid)',
    'public.cleanup_export_jobs(integer)',
    'public.export_jobs_invariant_violations()',
    'public.export_job_diffs(text, jsonb)',
    'public.export_setting_bool(text)',
    'public.export_day_start()',
    'public.export_job_status_sync()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
```

## Anexo B: reversão (`supabase/rollback/20261007000001_export_jobs_down.sql`)

```sql
-- =============================================================================
-- REVERSÃO de supabase/migrations/20261007000001_export_jobs.sql
--
-- Fica fora de supabase/migrations de propósito: "supabase db push" aplicaria tudo o que estiver
-- naquela pasta, inclusive uma reversão. Aplique à mão, no editor SQL, só quando quiser desfazer.
--
-- Remove APENAS o que a migração criou. Não toca em credit_transactions: débitos feitos pelo
-- servidor ficam no ledger (com a mesma chave do app), como qualquer download pago.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'export_job_status') then
    alter publication supabase_realtime drop table public.export_job_status;
  end if;
end $$;

drop function if exists public.create_export_job(uuid, text, text, text, text, text);
drop function if exists public.get_export_job(uuid);
drop function if exists public.start_export_job(uuid, integer);
drop function if exists public.report_export_progress(uuid, integer);
drop function if exists public.commit_export_credit(uuid, text, jsonb, jsonb);
drop function if exists public.release_export_credit(uuid, text, jsonb, jsonb);
drop function if exists public.requeue_export_job(uuid);
drop function if exists public.refund_export(uuid, uuid);
drop function if exists public.cleanup_export_jobs(integer);
drop function if exists public.export_jobs_invariant_violations();
drop function if exists public.export_job_diffs(text, jsonb);
drop function if exists public.export_setting_bool(text);
drop function if exists public.export_day_start();

drop view if exists public.my_export_jobs;
drop trigger if exists export_jobs_status_sync on public.export_jobs;
drop table if exists public.export_job_status;
drop table if exists public.export_ref_anchors;
drop table if exists public.export_jobs;
drop function if exists public.export_job_status_sync();
drop type if exists public.export_credit_state;
drop type if exists public.export_status;

delete from public.system_settings where key in (
  'export_server_enabled', 'export_user_active', 'export_user_per_hour', 'export_user_per_day',
  'export_server_daily_cpu_s', 'export_server_daily_jobs'
);
```

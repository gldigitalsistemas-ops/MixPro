-- =============================================================================
-- Ferramentas no servidor (Voz + Playback, Tom e andamento, Masterização por referência, Modo álbum,
-- Separação de faixas e Conversão de formato) + Plano Pro + preços por recurso.
--
-- Mesmo modelo de crédito da exportação: RESERVA ao criar, DÉBITO na entrega (na mesma transação que
-- marca o job como pronto), LIBERA ao falhar ou cancelar. O cliente não lê nem escreve a tabela: só a
-- visão my_tool_jobs, sem as chaves dos arquivos. Idempotente (pode ser rodada mais de uma vez).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preços (créditos por recurso) e plano Pro: editáveis no Admin → Configurações
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public) values
  ('tool_credit_costs',
   '{"pitch_tempo": 2, "voice_playback": 3, "reference_master": 3, "album_track": 2, "stems": 4, "stems_extra_6min": 1, "convert": 0, "report": 1}',
   'Créditos por recurso das ferramentas (album_track = por faixa; stems = até 6 min, mais stems_extra_6min a cada 6 min).', true),
  ('tool_user_active', '2', 'Ferramentas em andamento ao mesmo tempo, por usuário.', false),
  ('tool_user_per_day', '30', 'Ferramentas por usuário por dia (horário de Brasília).', false),
  ('tool_server_daily_jobs', '300', 'Teto diário de jobs de ferramentas (todos os usuários).', false),
  ('pro_retention_days', '30', 'Dias que os arquivos ficam no Cofre do Plano Pro.', false)
on conflict (key) do nothing;

-- acrescenta o Plano Pro à lista de planos (sem duplicar se a migração rodar de novo)
update public.system_settings
   set value = value || '[{"id": "pro", "name": "Plano Pro", "credits": 250, "price": 89.90,
                            "perks": ["Cofre de 30 dias para baixar de novo", "WAV 24 bits e FLAC", "Relatório técnico grátis", "Prioridade na fila"]}]'::jsonb
 where key = 'subscription_plans'
   and jsonb_typeof(value) = 'array'
   and not exists (select 1 from jsonb_array_elements(value) e where e ->> 'id' = 'pro');

/** Conta com Plano Pro ativo (cobrança aprovada nos últimos 35 dias). */
create or replace function public.is_pro(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
     where s.user_id = p_user and s.plan_id = 'pro' and s.status = 'authorized'
       and s.last_payment_at > now() - interval '35 days'
  )
$$;

/** Para a interface: a própria conta é Pro? */
create or replace function public.my_is_pro()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_pro(auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- Jobs de ferramentas
-- -----------------------------------------------------------------------------
create table if not exists public.tool_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  tool          text not null check (tool in ('pitch_tempo', 'voice_playback', 'reference_master', 'album', 'stems', 'convert')),
  status        public.export_status not null default 'queued',
  progress      smallint not null default 0 check (progress between 0 and 100),
  -- parâmetros do recurso (validados na rota e de novo no serviço); nunca texto livre do usuário
  params        jsonb not null default '{}'::jsonb check (octet_length(params::text) <= 16384),
  -- arquivos enviados: só chaves aleatórias in/<uuid>
  inputs        text[] not null check (cardinality(inputs) between 1 and 12),
  -- resultados: [{key, name, bytes}] (a chave nunca vai para o cliente)
  outputs       jsonb,
  credits       smallint not null default 0 check (credits between 0 and 60),
  credit_state  public.export_credit_state not null default 'none',
  credit_tx_id  uuid references public.credit_transactions (id) on delete set null,
  measures      jsonb,
  error_code    text check (error_code ~ '^[A-Z_]{3,40}$'),
  cpu_ms        integer,
  peak_rss_mb   integer,
  wall_ms       integer,
  attempts      smallint not null default 0,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  expires_at    timestamptz not null default now() + interval '24 hours'
);
create index if not exists tool_jobs_user_recent on public.tool_jobs (user_id, created_at desc);
create index if not exists tool_jobs_expiry on public.tool_jobs (expires_at) where status <> 'expired';
create index if not exists tool_jobs_running on public.tool_jobs (started_at) where status = 'running';

alter table public.tool_jobs enable row level security;
revoke all on table public.tool_jobs from anon, authenticated;

-- o dono lista os próprios jobs sem as chaves dos arquivos
drop view if exists public.my_tool_jobs;
create view public.my_tool_jobs with (security_barrier = true) as
  select id, tool, status, progress, credits, credit_state, error_code, measures,
         coalesce((select jsonb_agg(o - 'key') from jsonb_array_elements(outputs) o), '[]'::jsonb) as outputs,
         created_at, finished_at, expires_at
    from public.tool_jobs
   where user_id = auth.uid();
revoke all on table public.my_tool_jobs from anon, authenticated;
grant select on table public.my_tool_jobs to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs (só service_role). Erros saem como exceção com um CÓDIGO FECHADO na mensagem.
-- -----------------------------------------------------------------------------

/**
 * Cria o job e reserva os créditos. Ordem: interruptor/liberação → limites do usuário → teto do dia →
 * regra do VS grátis (1 separação antes da primeira compra) → saldo disponível (saldo − reservas ativas
 * de exportações e de ferramentas) ≥ créditos.
 */
create or replace function public.create_tool_job(
  p_user uuid, p_tool text, p_params jsonb, p_inputs text[], p_credits integer, p_retention_days integer default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.tool_jobs;
  v_available integer;
  v_key text;
  v_day timestamptz := public.export_day_start();
begin
  if p_user is null or p_tool is null or p_tool not in ('pitch_tempo', 'voice_playback', 'reference_master', 'album', 'stems', 'convert') then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or octet_length(p_params::text) > 16384 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_inputs is null or cardinality(p_inputs) not between 1 and 12 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  foreach v_key in array p_inputs loop
    if v_key !~ '^in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVALID_JOB' using errcode = '22023';
    end if;
  end loop;
  if p_credits is null or p_credits not between 0 and 60 or p_retention_days not in (1, 30) then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || p_user::text));

  if not public.export_server_allowed(p_user) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;
  if (select count(*) from public.tool_jobs where user_id = p_user and status in ('queued', 'running'))
       >= coalesce(public.setting_int('tool_user_active'), 2)
     or (select count(*) from public.tool_jobs where user_id = p_user and created_at >= v_day)
       >= coalesce(public.setting_int('tool_user_per_day'), 30) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.tool_jobs where created_at >= v_day) >= coalesce(public.setting_int('tool_server_daily_jobs'), 300) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;

  -- separação de faixas: 1 grátis; depois, só para quem já comprou créditos ou assinou
  if p_tool = 'stems'
     and not exists (select 1 from public.credit_transactions where user_id = p_user and type = 'PURCHASE')
     and exists (select 1 from public.tool_jobs where user_id = p_user and tool = 'stems' and status in ('queued', 'running', 'done')) then
    raise exception 'NEEDS_PURCHASE' using errcode = 'P0001';
  end if;

  if p_credits > 0 then
    v_available := public.credit_balance(p_user, 'download')
      - (select count(*) from public.export_jobs where user_id = p_user and credit_state = 'reserved' and status in ('queued', 'running'))::integer
      - coalesce((select sum(credits) from public.tool_jobs where user_id = p_user and credit_state = 'reserved' and status in ('queued', 'running')), 0)::integer;
    if v_available < p_credits then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;
  end if;

  insert into public.tool_jobs (user_id, tool, params, inputs, credits, credit_state, expires_at)
  values (p_user, p_tool, p_params, p_inputs, p_credits, case when p_credits > 0 then 'reserved'::public.export_credit_state else 'none'::public.export_credit_state end,
          now() + make_interval(days => p_retention_days))
  returning * into v_job;
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'credit_state', v_job.credit_state, 'credits', v_job.credits);
end $$;

create or replace function public.get_tool_job(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(j) from public.tool_jobs j where j.id = p_job_id
$$;

create or replace function public.start_tool_job(p_job_id uuid, p_stale_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.tool_jobs;
begin
  select * into v from public.tool_jobs where id = p_job_id for update;
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
  update public.tool_jobs set status = 'running', attempts = attempts + 1, started_at = now()
   where id = p_job_id returning * into v;
  return jsonb_build_object('outcome', 'started', 'job', to_jsonb(v));
end $$;

create or replace function public.report_tool_progress(p_job_id uuid, p_pct integer)
returns void language sql security definer set search_path = public as $$
  update public.tool_jobs set progress = greatest(progress, least(100, greatest(0, p_pct)))
   where id = p_job_id and status = 'running'
$$;

/** Entrega: DEBITA os créditos (chave tool:<id>) e marca done na mesma transação. Idempotente. */
create or replace function public.commit_tool_job(p_job_id uuid, p_outputs jsonb, p_measures jsonb, p_cost jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.tool_jobs;
  v_tx public.credit_transactions;
  v_tx_id uuid;
  o jsonb;
begin
  select * into v from public.tool_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = 'done' then
    return jsonb_build_object('status', 'done', 'idempotent', true);
  end if;
  if v.status in ('failed', 'expired') then
    return jsonb_build_object('status', 'failed', 'error_code', coalesce(v.error_code, 'TIMEOUT'));
  end if;
  if v.status <> 'running' then
    raise exception 'NOT_RUNNING' using errcode = 'P0001';
  end if;
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) not between 1 and 20 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_outputs) loop
    if (o ->> 'key') !~ '^(out|cofre)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,2}\.(wav|mp3|m4a|flac|zip)$'
       or coalesce(o ->> 'name', '') !~ '^[A-Za-z0-9 ._()+-]{1,80}$' then
      raise exception 'INVALID_JOB' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('credits:' || v.user_id::text));
  if v.credit_state = 'reserved' and v.credits > 0 then
    begin
      v_tx := public.grant_credits(
        v.user_id, 'download', 'DOWNLOAD', -v.credits, 'Ferramenta: ' || v.tool, 'tool', v.id::text, 'tool:' || v.id::text
      );
      v_tx_id := v_tx.id;
    exception when others then
      if sqlerrm = 'INSUFFICIENT_CREDITS' then
        update public.tool_jobs set status = 'failed', error_code = 'INSUFFICIENT_CREDITS', credit_state = 'released', finished_at = now()
         where id = p_job_id;
        return jsonb_build_object('status', 'failed', 'error_code', 'INSUFFICIENT_CREDITS');
      end if;
      raise;
    end;
  end if;

  update public.tool_jobs set
    status = 'done', progress = 100, outputs = p_outputs, measures = p_measures,
    credit_state = case when credit_state = 'reserved' then 'charged'::public.export_credit_state else credit_state end,
    credit_tx_id = coalesce(v_tx_id, credit_tx_id),
    cpu_ms = (p_cost ->> 'cpu_ms')::integer, peak_rss_mb = (p_cost ->> 'rss_mb')::integer, wall_ms = (p_cost ->> 'wall_ms')::integer,
    finished_at = now()
   where id = p_job_id;
  return jsonb_build_object('status', 'done');
end $$;

create or replace function public.release_tool_job(p_job_id uuid, p_code text, p_cost jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.tool_jobs;
begin
  if p_code is null or p_code !~ '^[A-Z_]{3,40}$' then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  select * into v from public.tool_jobs where id = p_job_id for update;
  if not found or v.status in ('done', 'failed', 'expired') then
    return jsonb_build_object('status', coalesce(v.status::text, 'missing'));
  end if;
  update public.tool_jobs set
    status = 'failed', error_code = p_code, finished_at = now(),
    credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end,
    cpu_ms = coalesce((p_cost ->> 'cpu_ms')::integer, cpu_ms), peak_rss_mb = coalesce((p_cost ->> 'rss_mb')::integer, peak_rss_mb),
    wall_ms = coalesce((p_cost ->> 'wall_ms')::integer, wall_ms)
   where id = p_job_id;
  return jsonb_build_object('status', 'failed', 'error_code', p_code);
end $$;

create or replace function public.requeue_tool_job(p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.tool_jobs set status = 'queued' where id = p_job_id and status = 'running'
$$;

create or replace function public.cancel_tool_job(p_job_id uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.tool_jobs;
begin
  select * into v from public.tool_jobs where id = p_job_id for update;
  if not found or v.user_id is distinct from p_user then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status not in ('queued', 'running') then
    return jsonb_build_object('status', v.status, 'cancelled', false);
  end if;
  update public.tool_jobs set status = 'failed', error_code = 'CANCELLED', finished_at = now(),
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where id = p_job_id;
  return jsonb_build_object('status', 'failed', 'cancelled', true);
end $$;

/** Limpeza (pg_cron a cada 5 min): parados → TIMEOUT; fila sem envio há 15 min → TIMEOUT; vencidos → expired. */
create or replace function public.cleanup_tool_jobs(p_stale_seconds integer default 1800, p_queued_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a integer; b integer; c integer;
begin
  update public.tool_jobs set status = 'failed', error_code = 'TIMEOUT', finished_at = now(),
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status = 'running' and started_at < now() - make_interval(secs => p_stale_seconds);
  get diagnostics a = row_count;
  update public.tool_jobs set status = 'failed', error_code = 'TIMEOUT', finished_at = now(),
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status = 'queued'
     and ((started_at is null and created_at < now() - make_interval(secs => p_queued_seconds))
       or (started_at is not null and started_at < now() - make_interval(secs => p_stale_seconds)));
  get diagnostics b = row_count;
  update public.tool_jobs set status = 'expired', outputs = null,
         credit_state = case when credit_state = 'reserved' then 'released'::public.export_credit_state else credit_state end
   where status <> 'expired' and expires_at < now();
  get diagnostics c = row_count;
  return jsonb_build_object('parados', a, 'fila_antiga', b, 'expirados', c);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_tool_job(uuid, text, jsonb, text[], integer, integer)',
    'public.get_tool_job(uuid)',
    'public.start_tool_job(uuid, integer)',
    'public.report_tool_progress(uuid, integer)',
    'public.commit_tool_job(uuid, jsonb, jsonb, jsonb)',
    'public.release_tool_job(uuid, text, jsonb)',
    'public.requeue_tool_job(uuid)',
    'public.cancel_tool_job(uuid, uuid)',
    'public.cleanup_tool_jobs(integer, integer)',
    'public.is_pro(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.my_is_pro() from public, anon;
grant execute on function public.my_is_pro() to authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'mixpro-limpeza-ferramentas';
select cron.schedule('mixpro-limpeza-ferramentas', '*/5 * * * *', 'select public.cleanup_tool_jobs()');

-- eventos de uso das ferramentas, do relatório e da página de compartilhar (painel do admin)
create or replace function public.track_event(p_event text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('studio_open', 'file_loaded', 'captions_generated', 'export', 'share', 'checkout_start', 'tour_done',
                     'style_saved', 'preset_saved', 'preset_shared', 'shared_preset_opened', 'kit_unlocked', 'batch_export',
                     'vs_separated', 'vs_download', 'tool_done', 'report_pdf', 'share_page') then
    return;
  end if;
  if pg_column_size(p_props) > 2048 then
    p_props := '{}';
  end if;
  insert into public.analytics_events (user_id, event, props) values (auth.uid(), p_event, coalesce(p_props, '{}'));
end $$;
revoke execute on function public.track_event(text, jsonb) from public;
grant execute on function public.track_event(text, jsonb) to anon, authenticated;

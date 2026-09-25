-- =============================================================================
-- Mix Pro — Áudio: projetos, pistas, arquivos, presets versionados, fila de
-- processamento, workers, favoritos, snapshots e downloads.
-- =============================================================================

create type public.project_mode as enum ('single', 'stereo', 'multitrack');
create type public.audio_type   as enum ('vocal', 'drums', 'guitar', 'acoustic', 'piano', 'bass', 'mix', 'master', 'other');
create type public.file_kind    as enum ('source', 'proxy', 'segment', 'preview', 'render', 'mix', 'reference', 'order_file', 'delivery');
create type public.file_status  as enum ('uploading', 'uploaded', 'analyzing', 'ready', 'invalid', 'deleted');
create type public.job_type     as enum ('analyze', 'preview', 'render', 'mix_preview', 'mix_render');
create type public.job_status   as enum ('queued', 'processing', 'completed', 'failed', 'cancelled');

insert into public.system_settings (key, value, description, is_public) values
  ('dsp_engine_version', '"1"', 'Versão do motor DSP (entra na chave de cache; mudar invalida o cache)', false),
  ('export_formats', '["wav","mp3"]', 'Formatos de exportação disponíveis', true);

-- -----------------------------------------------------------------------------
-- Projetos e pistas
-- -----------------------------------------------------------------------------
create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 120),
  mode               public.project_mode not null default 'single',
  audio_type         public.audio_type not null default 'vocal',
  last_processed_at  timestamptz,
  last_accessed_at   timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index projects_user_idx on public.projects (user_id, updated_at desc) where deleted_at is null;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Categorias e presets (cadeias DSP versionadas)
-- -----------------------------------------------------------------------------
create table public.preset_categories (
  id           text primary key,
  group_id     text not null,           -- drums, bass, guitar, acoustic, vocal, piano, master
  name         text not null,
  audio_types  public.audio_type[] not null,
  icon         text,
  position     integer not null default 0
);

create table public.presets (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name                text not null,
  category_id         text not null references public.preset_categories (id),
  style               text,             -- punchy, warm, bright…
  description         text,
  tags                text[] not null default '{}',
  image_url           text,
  active              boolean not null default false,
  current_version_id  uuid,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);
create index presets_category_idx on public.presets (category_id, position) where archived_at is null;
create trigger presets_touch before update on public.presets
  for each row execute function public.touch_updated_at();

create table public.preset_versions (
  id                 uuid primary key default gen_random_uuid(),
  preset_id          uuid not null references public.presets (id) on delete restrict,
  version            integer not null,
  chain              jsonb not null default '{"schema_version":1,"chain":[]}',
  default_intensity  smallint not null default 50 check (default_intensity in (25, 50, 75, 100)),
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (preset_id, version)
);

alter table public.presets
  add constraint presets_current_version_fk
  foreign key (current_version_id) references public.preset_versions (id) on delete set null;

-- Versões são imutáveis: projetos antigos continuam reproduzíveis.
create or replace function public.preset_versions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'preset_versions são imutáveis; crie uma nova versão';
end $$;
create trigger preset_versions_no_update before update or delete on public.preset_versions
  for each row execute function public.preset_versions_immutable();

-- Cria nova versão e a torna atual (admin).
create or replace function public.publish_preset_version(
  p_preset uuid, p_chain jsonb, p_default_intensity integer default 50, p_notes text default null
)
returns public.preset_versions
language plpgsql security definer set search_path = public as $$
declare
  v public.preset_versions;
  next_version integer;
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_chain -> 'chain') <> 'array' then
    raise exception 'INVALID_CHAIN';
  end if;

  perform 1 from public.presets where id = p_preset for update;
  select coalesce(max(version), 0) + 1 into next_version from public.preset_versions where preset_id = p_preset;

  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes, created_by)
  values (p_preset, next_version, p_chain, p_default_intensity, p_notes, auth.uid())
  returning * into v;

  update public.presets set current_version_id = v.id where id = p_preset;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Arquivos de áudio (metadados; o binário fica no object storage S3/R2)
-- -----------------------------------------------------------------------------
create table public.audio_files (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  project_id        uuid references public.projects (id) on delete cascade,
  kind              public.file_kind not null,
  status            public.file_status not null default 'uploading',
  storage_key       text not null unique,
  original_name     text,
  ext               text,
  mime              text,
  size_bytes        bigint,
  sha256            text,
  duration_s        numeric(10, 3),
  sample_rate       integer,
  bit_depth         integer,
  channels          smallint,
  codec             text,
  peaks_key         text,              -- JSON de picos p/ waveform
  analysis          jsonb,             -- peak/rms/lufs/true_peak/clipping/silêncio
  warnings          text[] not null default '{}',
  error_message     text,
  derived_from      uuid references public.audio_files (id) on delete cascade,
  original_pair_id  uuid references public.audio_files (id) on delete set null, -- p/ A/B: trecho original equivalente
  cache_key         text,              -- chave determinística do processamento
  download_key      text,              -- chave de cobrança (não inclui versão do motor)
  last_accessed_at  timestamptz not null default now(),
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index audio_files_project_idx on public.audio_files (project_id, kind) where deleted_at is null;
create unique index audio_files_cache_key_uidx on public.audio_files (cache_key)
  where cache_key is not null and deleted_at is null and status <> 'invalid';
create index audio_files_expiry_idx on public.audio_files (expires_at) where deleted_at is null and expires_at is not null;

create table public.tracks (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 80),
  position            integer not null default 0,
  category_id         text references public.preset_categories (id),
  source_file_id      uuid references public.audio_files (id) on delete set null,
  preset_version_id   uuid references public.preset_versions (id) on delete set null,
  intensity           smallint not null default 50 check (intensity in (25, 50, 75, 100)),
  volume_db           numeric(5, 2) not null default 0 check (volume_db between -60 and 12),
  pan                 numeric(3, 2) not null default 0 check (pan between -1 and 1),
  muted               boolean not null default false,
  solo                boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index tracks_project_idx on public.tracks (project_id, position);
create trigger tracks_touch before update on public.tracks
  for each row execute function public.touch_updated_at();

-- Garante coerência de dono entre pista, projeto e arquivo.
create or replace function public.tracks_check_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects where id = new.project_id and user_id = new.user_id) then
    raise exception 'TRACK_PROJECT_MISMATCH';
  end if;
  if new.source_file_id is not null and not exists (
    select 1 from public.audio_files where id = new.source_file_id and user_id = new.user_id and kind = 'source'
  ) then
    raise exception 'TRACK_FILE_MISMATCH';
  end if;
  return new;
end $$;
create trigger tracks_ownership before insert or update on public.tracks
  for each row execute function public.tracks_check_ownership();

-- -----------------------------------------------------------------------------
-- Fila de processamento
-- -----------------------------------------------------------------------------
create table public.processing_jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  project_id         uuid references public.projects (id) on delete cascade,
  track_id           uuid references public.tracks (id) on delete set null,
  type               public.job_type not null,
  status             public.job_status not null default 'queued',
  priority           smallint not null default 5,      -- menor = mais urgente
  source_file_id     uuid references public.audio_files (id) on delete cascade,
  preset_version_id  uuid references public.preset_versions (id) on delete set null,
  intensity          smallint check (intensity in (25, 50, 75, 100)),
  params             jsonb not null default '{}',
  cache_key          text,
  cache_hit          boolean not null default false,
  progress           smallint not null default 0 check (progress between 0 and 100),
  stage              text,
  output_file_id     uuid references public.audio_files (id) on delete set null,
  error_code         text,
  error_message      text,
  attempts           smallint not null default 0,
  worker_id          text,
  duration_ms        integer,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  heartbeat_at       timestamptz,
  completed_at       timestamptz
);
create index processing_jobs_queue_idx on public.processing_jobs (priority, created_at) where status = 'queued';
create index processing_jobs_user_idx on public.processing_jobs (user_id, created_at desc);
create index processing_jobs_track_idx on public.processing_jobs (track_id, created_at desc);
create index processing_jobs_cache_idx on public.processing_jobs (cache_key) where status in ('queued', 'processing');

create table public.workers (
  id                 text primary key,
  hostname           text,
  version            text,
  capabilities       jsonb not null default '{}',
  started_at         timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Favoritos, snapshots, downloads
-- -----------------------------------------------------------------------------
create table public.favorites (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  preset_id   uuid not null references public.presets (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, preset_id)
);

create table public.mix_snapshots (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  state       jsonb not null,   -- { tracks: [{track_id, preset_version_id, intensity, volume_db, pan, muted, solo}] }
  created_at  timestamptz not null default now()
);
create index mix_snapshots_project_idx on public.mix_snapshots (project_id, created_at desc);

create table public.download_grants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  download_key    text not null,
  file_id         uuid references public.audio_files (id) on delete set null,
  credit_tx_id    uuid references public.credit_transactions (id) on delete set null,
  source          text not null default 'credit',  -- credit | professional_delivery
  created_at      timestamptz not null default now(),
  unique (user_id, download_key)
);

create table public.download_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  file_id     uuid references public.audio_files (id) on delete set null,
  grant_id    uuid references public.download_grants (id) on delete set null,
  charged     boolean not null,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Funções: status do processador
-- -----------------------------------------------------------------------------
create or replace function public.processor_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', exists (
      select 1 from public.workers
      where last_heartbeat_at > now() - make_interval(secs => coalesce(public.setting_int('worker_offline_after_s'), 60))
    ),
    'queued', (select count(*) from public.processing_jobs where status = 'queued'),
    'processing', (select count(*) from public.processing_jobs where status = 'processing')
  )
$$;

-- -----------------------------------------------------------------------------
-- Funções: enfileirar job (usuário) com cache e rate limit
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_track_job(
  p_track              uuid,
  p_type               public.job_type,
  p_preset_version     uuid,
  p_intensity          integer,
  p_params             jsonb default '{}'
)
returns public.processing_jobs
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid         uuid := auth.uid();
  t           public.tracks;
  src         public.audio_files;
  job         public.processing_jobs;
  cached      public.audio_files;
  engine      text := coalesce(public.get_setting('dsp_engine_version') #>> '{}', '1');
  seg_start   numeric := 0;
  seg_dur     numeric := 0;
  fmt         text := null;
  ckey        text;
  dkey        text;
  recent      integer;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if p_type not in ('preview', 'render') then
    raise exception 'INVALID_JOB_TYPE';
  end if;
  if p_intensity not in (25, 50, 75, 100) then
    raise exception 'INVALID_INTENSITY';
  end if;

  select * into t from public.tracks where id = p_track and user_id = uid;
  if not found then raise exception 'TRACK_NOT_FOUND'; end if;

  select * into src from public.audio_files where id = t.source_file_id and deleted_at is null;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if src.status <> 'ready' then raise exception 'SOURCE_NOT_READY'; end if;

  if p_preset_version is not null and not exists (
    select 1 from public.preset_versions pv join public.presets p on p.id = pv.preset_id
    where pv.id = p_preset_version and (p.active or public.is_admin())
  ) then
    raise exception 'PRESET_NOT_AVAILABLE';
  end if;

  if p_type = 'preview' then
    seg_dur   := least(coalesce(public.setting_int('preview_duration_s'), 30), src.duration_s);
    seg_start := greatest(0, least(coalesce((p_params ->> 'start_s')::numeric, 0), src.duration_s - seg_dur));
    seg_start := round(seg_start, 1);
  else
    fmt := coalesce(p_params ->> 'format', 'wav');
    if not (public.get_setting('export_formats') ? fmt) then
      raise exception 'INVALID_FORMAT';
    end if;
  end if;

  ckey := encode(extensions.digest(concat_ws('|',
    p_type, src.sha256, coalesce(p_preset_version::text, 'original'), p_intensity,
    seg_start, seg_dur, fmt, 'engine' || engine), 'sha256'), 'hex');
  dkey := case when p_type = 'render' then encode(extensions.digest(concat_ws('|',
    src.sha256, coalesce(p_preset_version::text, 'original'), p_intensity, fmt), 'sha256'), 'hex') end;

  perform pg_advisory_xact_lock(hashtext('job:' || ckey));

  -- 1) Cache: resultado idêntico já existe
  select * into cached from public.audio_files
   where cache_key = ckey and status = 'ready' and deleted_at is null and user_id = uid;
  if found then
    update public.audio_files set last_accessed_at = now() where id = cached.id;
    insert into public.processing_jobs
      (user_id, project_id, track_id, type, status, source_file_id, preset_version_id, intensity,
       params, cache_key, cache_hit, progress, stage, output_file_id, created_at, started_at, completed_at)
    values
      (uid, t.project_id, t.id, p_type, 'completed', src.id, p_preset_version, p_intensity,
       jsonb_build_object('start_s', seg_start, 'duration_s', seg_dur, 'format', fmt, 'download_key', dkey),
       ckey, true, 100, 'Pronto', cached.id, now(), now(), now())
    returning * into job;
    return job;
  end if;

  -- 2) Mesmo processamento já está na fila
  select * into job from public.processing_jobs
   where cache_key = ckey and status in ('queued', 'processing') and user_id = uid
   order by created_at desc limit 1;
  if found then
    return job;
  end if;

  -- 3) Rate limit
  select count(*) into recent from public.processing_jobs
   where user_id = uid and not cache_hit and created_at > now() - interval '1 hour';
  if recent >= coalesce(public.setting_int('rate_jobs_per_hour'), 120) then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.processing_jobs
    (user_id, project_id, track_id, type, priority, source_file_id, preset_version_id, intensity, params, cache_key, stage)
  values
    (uid, t.project_id, t.id, p_type, case when p_type = 'preview' then 3 else 5 end, src.id,
     p_preset_version, p_intensity,
     (p_params - 'start_s' - 'format') || jsonb_build_object('start_s', seg_start, 'duration_s', seg_dur, 'format', fmt, 'download_key', dkey),
     ckey, 'Na fila')
  returning * into job;

  update public.projects set last_accessed_at = now() where id = t.project_id;
  return job;
end $$;

-- -----------------------------------------------------------------------------
-- Funções: worker (somente service_role)
-- -----------------------------------------------------------------------------
create or replace function public.worker_heartbeat(p_worker text, p_hostname text, p_version text, p_capabilities jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.workers (id, hostname, version, capabilities, last_heartbeat_at)
  values (p_worker, p_hostname, p_version, coalesce(p_capabilities, '{}'), now())
  on conflict (id) do update
    set hostname = excluded.hostname, version = excluded.version,
        capabilities = excluded.capabilities, last_heartbeat_at = now()
$$;

create or replace function public.claim_job(p_worker text, p_types public.job_type[] default null)
returns setof public.processing_jobs
language plpgsql security definer set search_path = public as $$
begin
  -- Recupera jobs abandonados (worker caiu no meio)
  update public.processing_jobs
     set status = case when attempts >= 3 then 'failed'::public.job_status else 'queued'::public.job_status end,
         error_code = case when attempts >= 3 then 'WORKER_LOST' else error_code end,
         error_message = case when attempts >= 3 then 'Processamento interrompido repetidamente' else error_message end,
         worker_id = null, stage = 'Na fila'
   where status = 'processing' and heartbeat_at < now() - interval '3 minutes';

  return query
  update public.processing_jobs j
     set status = 'processing', worker_id = p_worker, started_at = now(), heartbeat_at = now(),
         attempts = j.attempts + 1, stage = 'Preparando áudio…', progress = 1
   where j.id = (
     select id from public.processing_jobs
      where status = 'queued' and (p_types is null or type = any (p_types))
      order by priority, created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end $$;

-- -----------------------------------------------------------------------------
-- Funções: download (consome 1 crédito, exceto re-download do mesmo resultado)
-- -----------------------------------------------------------------------------
create or replace function public.authorize_download(p_file uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  f     public.audio_files;
  g     public.download_grants;
  tx    public.credit_transactions;
  charged boolean := false;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select * into f from public.audio_files
   where id = p_file and user_id = uid and status = 'ready' and deleted_at is null;
  if not found then raise exception 'FILE_NOT_FOUND'; end if;
  if f.kind not in ('render', 'mix') or f.download_key is null then
    raise exception 'FILE_NOT_DOWNLOADABLE';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || uid::text));

  select * into g from public.download_grants where user_id = uid and download_key = f.download_key;
  if not found then
    tx := public.grant_credits(uid, 'download', 'DOWNLOAD', -1, 'Download de arquivo processado',
                               'audio_file', f.id::text, 'download:' || uid::text || ':' || f.download_key);
    insert into public.download_grants (user_id, download_key, file_id, credit_tx_id)
    values (uid, f.download_key, f.id, tx.id)
    returning * into g;
    charged := true;
  end if;

  insert into public.download_events (user_id, file_id, grant_id, charged) values (uid, f.id, g.id, charged);
  update public.audio_files set last_accessed_at = now() where id = f.id;

  return jsonb_build_object(
    'charged', charged,
    'storage_key', f.storage_key,
    'file_name', f.original_name,
    'balance', public.credit_balance(uid, 'download')
  );
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.projects           enable row level security;
alter table public.tracks             enable row level security;
alter table public.audio_files        enable row level security;
alter table public.preset_categories  enable row level security;
alter table public.presets            enable row level security;
alter table public.preset_versions    enable row level security;
alter table public.processing_jobs    enable row level security;
alter table public.workers            enable row level security;
alter table public.favorites          enable row level security;
alter table public.mix_snapshots      enable row level security;
alter table public.download_grants    enable row level security;
alter table public.download_events    enable row level security;

create policy "projects: dono" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "projects: admin lê" on public.projects
  for select using (public.is_admin());

create policy "tracks: dono" on public.tracks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Arquivos: leitura pelo dono; escrita só pelo backend (service_role).
create policy "audio_files: dono lê" on public.audio_files
  for select using (user_id = auth.uid() or public.is_admin());

create policy "categories: todos leem" on public.preset_categories for select using (true);
create policy "categories: admin escreve" on public.preset_categories
  for all using (public.is_admin()) with check (public.is_admin());

create policy "presets: ativos para todos" on public.presets
  for select using ((active and archived_at is null) or public.is_admin());
create policy "presets: admin escreve" on public.presets
  for all using (public.is_admin()) with check (public.is_admin());

create policy "preset_versions: autenticados leem" on public.preset_versions
  for select using (auth.uid() is not null);

create policy "jobs: dono lê" on public.processing_jobs
  for select using (user_id = auth.uid() or public.is_admin());
create policy "jobs: dono cancela" on public.processing_jobs
  for update using (user_id = auth.uid() and status = 'queued')
  with check (user_id = auth.uid() and status = 'cancelled');
revoke update on public.processing_jobs from authenticated, anon;
grant update (status) on public.processing_jobs to authenticated;

create policy "workers: admin lê" on public.workers for select using (public.is_admin());

create policy "favorites: dono" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "snapshots: dono" on public.mix_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "download_grants: dono lê" on public.download_grants
  for select using (user_id = auth.uid() or public.is_admin());
create policy "download_events: admin lê" on public.download_events
  for select using (public.is_admin());

-- Permissões de execução
revoke execute on function public.worker_heartbeat(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_job(text, public.job_type[]) from public, anon, authenticated;
revoke execute on function public.enqueue_track_job(uuid, public.job_type, uuid, integer, jsonb) from public, anon;
revoke execute on function public.authorize_download(uuid) from public, anon;
revoke execute on function public.publish_preset_version(uuid, jsonb, integer, text) from public, anon;
grant execute on function public.enqueue_track_job(uuid, public.job_type, uuid, integer, jsonb) to authenticated;
grant execute on function public.authorize_download(uuid) to authenticated;
grant execute on function public.publish_preset_version(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.processor_status() to anon, authenticated;

-- Realtime: o front acompanha o status dos jobs e arquivos (RLS respeitada).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.processing_jobs, public.audio_files;
  end if;
end $$;

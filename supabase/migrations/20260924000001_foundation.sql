-- =============================================================================
-- Mix Pro — Fundação: perfis, configurações, ledger de créditos, notificações,
-- analytics e logs administrativos.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');
create type public.credit_kind as enum ('download', 'ai');
create type public.credit_tx_type as enum (
  'FREE_SIGNUP', 'DOWNLOAD', 'REFERRAL_BONUS', 'PURCHASE',
  'ADMIN_ADJUSTMENT', 'REFUND', 'CAMPAIGN_BONUS'
);

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Configurações do sistema (nenhuma regra comercial hardcoded)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  is_public   boolean not null default false, -- legível por qualquer visitante
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.system_settings (key, value, description, is_public) values
  ('free_downloads',              '5',       'Downloads gratuitos concedidos no cadastro', true),
  ('download_price_brl',          '1.00',    'Preço de 1 download avulso (R$)', true),
  ('referral_reward_referrer',    '10',      'Downloads para quem indica (indicação validada)', true),
  ('referral_reward_referred',    '10',      'Downloads para quem foi indicado (indicação validada)', true),
  ('max_upload_mb',               '50',      'Tamanho máximo por arquivo (MB)', true),
  ('max_audio_duration_s',        '900',     'Duração máxima por arquivo (segundos)', true),
  ('preview_duration_s',          '30',      'Duração do trecho de preview (segundos)', true),
  ('allowed_formats',             '["wav","mp3","flac","aiff","aif"]', 'Extensões aceitas no upload', true),
  ('ai_enabled',                  'false',   'Liga/desliga o AI Audio Lab', true),
  ('max_tracks_per_project',      '16',      'Máximo de pistas por projeto', true),
  ('rate_jobs_per_hour',          '120',     'Máximo de jobs (previews/renders) por usuário por hora', false),
  ('rate_uploads_per_hour',       '60',      'Máximo de uploads por usuário por hora', false),
  ('retention_preview_days',      '7',       'Dias até apagar previews não acessados (regeneráveis)', false),
  ('retention_render_days',       '3',       'Dias até apagar renders finais (regeneráveis sem nova cobrança)', false),
  ('retention_source_inactive_days', '60',   'Dias sem acesso até apagar originais de projetos inativos', false),
  ('worker_offline_after_s',      '60',      'Sem heartbeat por N segundos = processador offline', false);

create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.system_settings where key = p_key
$$;

create or replace function public.setting_int(p_key text)
returns integer language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::numeric::integer from public.system_settings where key = p_key
$$;

-- -----------------------------------------------------------------------------
-- Perfis
-- -----------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text,
  avatar_url      text,
  role            public.user_role not null default 'user',
  referral_code   text not null unique,
  referred_by     uuid references public.profiles (id) on delete set null,
  onboarded_at    timestamptz,
  blocked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  )
$$;

-- Código de indicação curto, sem caracteres ambíguos (0/O, 1/I/L).
create or replace function public.generate_referral_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..7 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end $$;

-- -----------------------------------------------------------------------------
-- Ledger de créditos (nunca "downloads = downloads - 1")
-- -----------------------------------------------------------------------------
create table public.credit_transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             public.credit_kind not null default 'download',
  type             public.credit_tx_type not null,
  amount           integer not null check (amount <> 0),
  reason           text,
  reference_type   text,
  reference_id     text,
  idempotency_key  text unique,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index credit_transactions_user_idx on public.credit_transactions (user_id, kind, created_at desc);

-- Saldo derivado do ledger. security_invoker => RLS da tabela base se aplica.
create view public.credit_balances with (security_invoker = true) as
  select user_id, kind, coalesce(sum(amount), 0)::integer as balance
  from public.credit_transactions
  group by user_id, kind;

create or replace function public.credit_balance(p_user uuid, p_kind public.credit_kind)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
  from public.credit_transactions
  where user_id = p_user and kind = p_kind
$$;

-- Concede/debita créditos de forma idempotente. Uso exclusivo do backend.
create or replace function public.grant_credits(
  p_user            uuid,
  p_kind            public.credit_kind,
  p_type            public.credit_tx_type,
  p_amount          integer,
  p_reason          text,
  p_reference_type  text default null,
  p_reference_id    text default null,
  p_idempotency_key text default null,
  p_created_by      uuid default null
)
returns public.credit_transactions
language plpgsql security definer set search_path = public as $$
declare
  tx public.credit_transactions;
begin
  perform pg_advisory_xact_lock(hashtext('credits:' || p_user::text));

  if p_idempotency_key is not null then
    select * into tx from public.credit_transactions where idempotency_key = p_idempotency_key;
    if found then
      return tx;
    end if;
  end if;

  if p_amount < 0 and public.credit_balance(p_user, p_kind) + p_amount < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  insert into public.credit_transactions
    (user_id, kind, type, amount, reason, reference_type, reference_id, idempotency_key, created_by)
  values
    (p_user, p_kind, p_type, p_amount, p_reason, p_reference_type, p_reference_id, p_idempotency_key, p_created_by)
  returning * into tx;

  return tx;
end $$;

-- -----------------------------------------------------------------------------
-- Novo usuário: perfil + código de indicação + downloads grátis
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  free_count integer := coalesce(public.setting_int('free_downloads'), 0);
begin
  insert into public.profiles (id, display_name, avatar_url, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    public.generate_referral_code()
  );

  if free_count > 0 then
    perform public.grant_credits(
      new.id, 'download', 'FREE_SIGNUP', free_count,
      'Downloads gratuitos de boas-vindas', 'user', new.id::text, 'signup:' || new.id::text
    );
  end if;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Notificações internas
-- -----------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Analytics de produto
-- -----------------------------------------------------------------------------
create table public.analytics_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  event       text not null check (event ~ '^[a-z_]{2,64}$'),
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index analytics_events_event_idx on public.analytics_events (event, created_at desc);

-- -----------------------------------------------------------------------------
-- Logs administrativos
-- -----------------------------------------------------------------------------
create table public.admin_logs (
  id           bigint generated always as identity primary key,
  admin_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.system_settings     enable row level security;
alter table public.profiles            enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.notifications       enable row level security;
alter table public.analytics_events    enable row level security;
alter table public.admin_logs          enable row level security;

create policy "settings: públicas para todos" on public.system_settings
  for select using (is_public or public.is_admin());
create policy "settings: admin altera" on public.system_settings
  for update using (public.is_admin()) with check (public.is_admin());

create policy "profiles: ver o próprio" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles: editar o próprio" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: admin edita" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Usuário comum só pode alterar colunas inofensivas (nunca role/referral).
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_url, onboarded_at) on public.profiles to authenticated;

create policy "credits: ver os próprios" on public.credit_transactions
  for select using (user_id = auth.uid() or public.is_admin());

create policy "notifications: ver as próprias" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications: marcar lida" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

create policy "analytics: registrar os próprios" on public.analytics_events
  for insert with check (user_id = auth.uid());
create policy "analytics: admin lê" on public.analytics_events
  for select using (public.is_admin());

create policy "admin_logs: admin lê" on public.admin_logs
  for select using (public.is_admin());

-- Funções sensíveis: somente service_role (backend/worker).
revoke execute on function public.grant_credits(uuid, public.credit_kind, public.credit_tx_type, integer, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.credit_balance(uuid, public.credit_kind) from public, anon, authenticated;

-- Saldo do próprio usuário (sem permitir consultar o de terceiros).
create or replace function public.my_credit_balance(p_kind public.credit_kind default 'download')
returns integer
language sql stable security definer set search_path = public as $$
  select public.credit_balance(auth.uid(), p_kind)
$$;
revoke execute on function public.my_credit_balance(public.credit_kind) from public, anon;
grant execute on function public.my_credit_balance(public.credit_kind) to authenticated;

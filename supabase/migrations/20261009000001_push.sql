-- =============================================================================
-- Notificações diárias (Web Push com VAPID).
-- Inscrições do navegador (endpoint + chaves públicas do navegador). Só o servidor lê e escreve
-- (rotas da Vercel com service role); o cliente não acessa a tabela. Idempotente.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  -- dono, quando a pessoa estava logada ao ativar (null = visitante)
  user_id       uuid references public.profiles (id) on delete cascade,
  -- só serviços de push conhecidos (a rota também confere): evita que o servidor chame URLs arbitrárias
  endpoint      text not null unique check (
    endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/'
    and length(endpoint) <= 1000
  ),
  p256dh        text not null check (length(p256dh) between 40 and 200),
  auth          text not null check (length(auth) between 10 and 100),
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  failures      smallint not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

insert into public.system_settings (key, value, description, is_public) values
  ('push_daily_enabled', 'true', 'Envia a notificação diária de incentivo (Web Push). Desligado: o cron não envia nada.', false)
on conflict (key) do nothing;

-- =============================================================================
-- Mix Pro — Limpeza automática do registro de uso (analytics_events).
-- É a tabela que mais cresce (~20 eventos por usuário por mês). Todo dia, os eventos
-- com mais de 90 dias viram um resumo diário (analytics_daily: quantos eventos e
-- quantas pessoas por dia) e os detalhes são apagados. O painel do admin usa no
-- máximo 90 dias, então nada muda nele; o histórico continua no resumo.
-- Pode rodar mais de uma vez.
-- =============================================================================

create table if not exists public.analytics_daily (
  day     date not null,
  event   text not null,
  events  integer not null,
  users   integer not null,  -- pessoas logadas distintas (visitantes sem conta não entram)
  primary key (day, event)
);
alter table public.analytics_daily enable row level security;
drop policy if exists "analytics_daily: admin lê" on public.analytics_daily;
create policy "analytics_daily: admin lê" on public.analytics_daily
  for select using (public.is_admin());

create index if not exists analytics_events_created_idx on public.analytics_events (created_at);

-- Resume e apaga os eventos mais antigos que p_keep_days. Devolve quantos foram apagados.
create or replace function public.cleanup_analytics(p_keep_days integer default 90)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := date_trunc('day', now()) - make_interval(days => greatest(p_keep_days, 30));
  v_deleted integer;
begin
  insert into public.analytics_daily (day, event, events, users)
  select created_at::date, event, count(*), count(distinct user_id)
  from public.analytics_events
  where created_at < v_cutoff
  group by 1, 2
  on conflict (day, event) do update
    set events = public.analytics_daily.events + excluded.events,
        users  = greatest(public.analytics_daily.users, excluded.users);

  delete from public.analytics_events where created_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke execute on function public.cleanup_analytics(integer) from public, anon, authenticated;

-- Agenda diária às 03:15 (horário de Brasília = 06:15 UTC)
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'mixpro-limpeza-analytics';
select cron.schedule('mixpro-limpeza-analytics', '15 6 * * *', 'select public.cleanup_analytics(90)');

-- Primeira limpeza já agora (não faz nada se ainda não há eventos antigos)
select public.cleanup_analytics(90);

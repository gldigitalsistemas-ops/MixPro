-- =============================================================================
-- Mix Pro — página antes/depois compartilhável (24 h) e relatório técnico em PDF
-- -----------------------------------------------------------------------------
-- Tudo novo e idempotente: nenhuma tabela ou função existente muda de comportamento.
-- Os áudios ficam no R2 em out/share/<token>/ (a regra de 1 dia do prefixo out/ apaga sozinha).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Página antes/depois
-- -----------------------------------------------------------------------------
create table if not exists public.share_links (
  token        text primary key check (token ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default '' check (length(title) <= 80),
  preset       text not null default '' check (length(preset) <= 60),
  ext          text not null check (ext in ('m4a', 'wav')),
  lufs_before  real,
  lufs_after   real,
  views        integer not null default 0,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '24 hours'
);
create index if not exists share_links_user_idx on public.share_links (user_id, created_at desc);
alter table public.share_links enable row level security;
-- sem políticas: só o servidor (service role) lê e grava

insert into public.system_settings (key, value, description, is_public)
values ('share_links_per_day', '10'::jsonb, 'Páginas antes/depois que cada usuário pode criar por dia', false)
on conflict (key) do nothing;

/** Cria a página (até o limite diário). Devolve o token ou erro LIMIT. */
create or replace function public.create_share_link(p_user uuid, p_token text, p_title text, p_preset text, p_ext text, p_lufs_before real, p_lufs_after real)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_max integer := coalesce(public.setting_int('share_links_per_day'), 10);
  v_today integer;
begin
  perform pg_advisory_xact_lock(hashtext('share:' || p_user::text));
  select count(*) into v_today from public.share_links where user_id = p_user and created_at > now() - interval '24 hours';
  if v_today >= v_max then
    raise exception 'LIMIT' using errcode = 'P0001';
  end if;
  insert into public.share_links (token, user_id, title, preset, ext, lufs_before, lufs_after)
  values (p_token, p_user, left(coalesce(p_title, ''), 80), left(coalesce(p_preset, ''), 60), p_ext, p_lufs_before, p_lufs_after);
  return p_token;
end $$;

/** Lê a página pública (conta a visita) com o código de indicação de quem compartilhou. Expirada: nenhuma linha. */
drop function if exists public.open_share_link(text);
create or replace function public.open_share_link(p_token text)
returns table (token text, title text, preset text, ext text, lufs_before real, lufs_after real, expires_at timestamptz, referral_code text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with u as (
    update public.share_links s set views = s.views + 1
    where s.token = p_token and s.expires_at > now()
    returning s.token, s.title, s.preset, s.ext, s.lufs_before, s.lufs_after, s.expires_at, s.user_id
  )
  select u.token, u.title, u.preset, u.ext, u.lufs_before, u.lufs_after, u.expires_at, p.referral_code
  from u left join public.profiles p on p.id = u.user_id;
end $$;

revoke execute on function public.create_share_link(uuid, text, text, text, text, real, real) from public, anon, authenticated;
revoke execute on function public.open_share_link(text) from public, anon, authenticated;
grant execute on function public.create_share_link(uuid, text, text, text, text, real, real) to service_role;
grant execute on function public.open_share_link(text) to service_role;

-- limpeza diária das linhas vencidas (os arquivos já somem pelo ciclo de vida do R2)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mixpro-limpeza-share';
    perform cron.schedule('mixpro-limpeza-share', '35 4 * * *', $c$delete from public.share_links where expires_at < now() - interval '1 day'$c$);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Relatório técnico em PDF: 1 crédito (preço em tool_credit_costs.report); grátis no Plano Pro.
-- O mesmo `p_ref` nunca cobra duas vezes (baixar de novo o mesmo relatório é grátis).
-- -----------------------------------------------------------------------------
create or replace function public.spend_report_credit(p_ref text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cost integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_ref is null or p_ref !~ '^[a-zA-Z0-9:_-]{8,128}$' then
    raise exception 'INVALID_REF' using errcode = '22023';
  end if;
  if public.is_pro(v_uid) then
    return public.credit_balance(v_uid, 'download');
  end if;
  select case when (value ->> 'report') ~ '^[0-9]{1,2}$' then (value ->> 'report')::integer else 1 end
    into v_cost from public.system_settings where key = 'tool_credit_costs';
  v_cost := coalesce(v_cost, 1);
  if v_cost > 0 then
    perform public.grant_credits(
      v_uid, 'download', 'DOWNLOAD', -v_cost, 'Relatório técnico (PDF)', 'report', p_ref, 'report:' || v_uid::text || ':' || p_ref
    );
  end if;
  return public.credit_balance(v_uid, 'download');
end $$;
revoke execute on function public.spend_report_credit(text) from public, anon;
grant execute on function public.spend_report_credit(text) to authenticated;

-- =============================================================================
-- Mix Pro — plano concedido pelo admin (com data de fim), admin sempre no Plano Pro e
-- servidor liberado para todos os usuários.
-- -----------------------------------------------------------------------------
-- Idempotente. O plano concedido não mexe na assinatura do Mercado Pago: quando a data passa, a pessoa
-- volta sozinha ao plano que tinha (assinatura ou grátis) e o app a convida a assinar.
-- =============================================================================

create table if not exists public.plan_grants (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  plan_id     text not null check (plan_id in ('criador', 'pro')),
  expires_at  timestamptz not null,
  note        text not null default '' check (length(note) <= 200),
  granted_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- quando o convite para assinar (notificação) já foi enviado depois do fim
  ended_notified_at timestamptz
);
alter table public.plan_grants enable row level security;
drop policy if exists "plan_grants: ver o próprio" on public.plan_grants;
create policy "plan_grants: ver o próprio" on public.plan_grants
  for select using (user_id = auth.uid() or public.is_admin());

/** Plano em vigor: admin > concessão ativa > assinatura ativa > grátis. */
create or replace function public.current_plan(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin')
      then jsonb_build_object('plan', 'pro', 'source', 'admin', 'expires_at', null)
    when exists (select 1 from public.plan_grants g where g.user_id = p_user and g.expires_at > now())
      then (select jsonb_build_object('plan', g.plan_id, 'source', 'grant', 'expires_at', g.expires_at)
              from public.plan_grants g where g.user_id = p_user)
    when exists (select 1 from public.subscriptions s where s.user_id = p_user and s.status = 'authorized'
                   and s.last_payment_at > now() - interval '35 days')
      then (select jsonb_build_object('plan', s.plan_id, 'source', 'subscription', 'expires_at', null)
              from public.subscriptions s
             where s.user_id = p_user and s.status = 'authorized' and s.last_payment_at > now() - interval '35 days'
             order by (s.plan_id = 'pro') desc, s.last_payment_at desc limit 1)
    else jsonb_build_object('plan', 'free', 'source', 'free', 'expires_at', null)
  end
$$;

/** Plano Pro em vigor (admin, concessão ou assinatura). Substitui a versão que só olhava a assinatura. */
create or replace function public.is_pro(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.current_plan(p_user) ->> 'plan') = 'pro'
$$;

/**
 * Para a interface: o próprio plano e, se uma concessão terminou nos últimos 14 dias sem assinatura
 * depois, o convite para assinar (ended_plan / ended_at).
 */
create or replace function public.my_plan()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v jsonb;
  g public.plan_grants;
begin
  if v_uid is null then
    return null;
  end if;
  v := public.current_plan(v_uid);
  if v ->> 'source' = 'free' then
    select * into g from public.plan_grants where user_id = v_uid and expires_at <= now() and expires_at > now() - interval '14 days';
    if found then
      v := v || jsonb_build_object('ended_plan', g.plan_id, 'ended_at', g.expires_at);
    end if;
  end if;
  return v;
end $$;

/** Admin: concede um plano até uma data (p_plan null remove a concessão). */
create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_until timestamptz, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_plan is null then
    delete from public.plan_grants where user_id = p_user;
    return public.current_plan(p_user);
  end if;
  if p_plan not in ('criador', 'pro') or p_until is null or p_until <= now() or p_until > now() + interval '3 years' then
    raise exception 'INVALID' using errcode = '22023';
  end if;
  insert into public.plan_grants (user_id, plan_id, expires_at, note, granted_by)
  values (p_user, p_plan, p_until, left(coalesce(p_note, ''), 200), auth.uid())
  on conflict (user_id) do update
    set plan_id = excluded.plan_id, expires_at = excluded.expires_at, note = excluded.note,
        granted_by = excluded.granted_by, created_at = now(), ended_notified_at = null;
  return public.current_plan(p_user);
end $$;

revoke execute on function public.current_plan(uuid) from public, anon, authenticated;
grant execute on function public.current_plan(uuid) to service_role;
revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;
revoke execute on function public.admin_set_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Servidor liberado para todos (pedido do dono do app em 2026-10-09). Para voltar atrás:
--   update public.system_settings set value = 'false' where key = 'export_server_enabled';
-- -----------------------------------------------------------------------------
update public.system_settings set value = 'true'::jsonb where key = 'export_server_enabled';

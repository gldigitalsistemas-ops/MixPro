-- =============================================================================
-- Mix Pro — Plano mensal (Mercado Pago Assinaturas) e registro de uso
-- =============================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('subscription_plans',
   '[{"id":"criador","name":"Plano Criador","credits":100,"price":49.90}]',
   'Planos mensais: créditos por mês e preço (R$). Cobrança automática pelo Mercado Pago.', true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Assinaturas
-- -----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  plan_id            text not null,
  credits_per_cycle  integer not null check (credits_per_cycle > 0),
  amount_brl         numeric(10,2) not null check (amount_brl > 0),
  status             text not null default 'pending' check (status in ('pending', 'authorized', 'paused', 'cancelled')),
  mp_preapproval_id  text unique,
  last_payment_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, created_at desc);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy "subscriptions: ver as próprias" on public.subscriptions
  for select using (user_id = auth.uid() or public.is_admin());

-- Crédito de cada cobrança mensal aprovada (idempotente por cobrança; confere o valor)
create or replace function public.apply_subscription_payment(
  p_preapproval_id   text,
  p_auth_payment_id  text,
  p_amount_paid      numeric
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where mp_preapproval_id = p_preapproval_id;
  if not found then
    raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_amount_paid + 0.009 < v_sub.amount_brl then
    raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;

  perform public.grant_credits(
    v_sub.user_id, 'download', 'PURCHASE', v_sub.credits_per_cycle,
    'Plano mensal — ' || v_sub.credits_per_cycle || ' créditos', 'subscription', v_sub.id::text,
    'mp_auth_payment_' || p_auth_payment_id
  );
  update public.subscriptions
  set last_payment_at = now(), status = 'authorized'
  where id = v_sub.id;
end $$;

revoke execute on function public.apply_subscription_payment(text, text, numeric) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Registro de uso (anônimo ou logado): só eventos conhecidos e com tamanho limitado
-- -----------------------------------------------------------------------------
create or replace function public.track_event(p_event text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('studio_open', 'file_loaded', 'captions_generated', 'export', 'share', 'checkout_start', 'tour_done', 'style_saved') then
    return;
  end if;
  if pg_column_size(p_props) > 2048 then
    p_props := '{}';
  end if;
  insert into public.analytics_events (user_id, event, props) values (auth.uid(), p_event, coalesce(p_props, '{}'));
end $$;

revoke execute on function public.track_event(text, jsonb) from public;
grant execute on function public.track_event(text, jsonb) to anon, authenticated;

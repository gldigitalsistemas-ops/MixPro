-- =============================================================================
-- Mix Pro — Fase 6: Pagamentos (Mercado Pago PIX + cartão + créditos)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.payment_status as enum
  ('pending', 'approved', 'cancelled', 'failed', 'refunded');

-- -----------------------------------------------------------------------------
-- Pedidos de pagamento
-- -----------------------------------------------------------------------------
create table public.payment_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  status            public.payment_status not null default 'pending',
  pack_id           text not null,
  amount_brl        numeric(10,2) not null check (amount_brl > 0),
  credits_amount    integer not null check (credits_amount > 0),
  -- Mercado Pago
  mp_preference_id  text,
  mp_payment_id     text unique,         -- preenchido pelo webhook
  mp_external_ref   text not null unique default gen_random_uuid()::text,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index payment_orders_user_idx on public.payment_orders (user_id, created_at desc);

create trigger payment_orders_touch before update on public.payment_orders
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Log de eventos de webhook (deduplicação)
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id          text primary key,  -- 'mp_' + notification_id
  source      text not null default 'mercadopago',
  payload     jsonb not null,
  processed   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.payment_orders enable row level security;
create policy "users see own orders"
  on public.payment_orders for select
  using (user_id = auth.uid());

alter table public.webhook_events enable row level security;
-- service_role bypassa RLS; sem policy = sem acesso por usuários comuns

-- -----------------------------------------------------------------------------
-- Pacotes de créditos (admin pode alterar pelo painel de configurações)
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public)
values (
  'credit_packs',
  '[
    {"id":"pack5",  "label":"5 downloads",  "brl":4.90,  "credits":5,  "highlight":false},
    {"id":"pack15", "label":"15 downloads", "brl":12.90, "credits":15, "highlight":true, "badge":"Mais popular"},
    {"id":"pack30", "label":"30 downloads", "brl":22.90, "credits":30, "highlight":false}
  ]'::jsonb,
  'Pacotes de créditos disponíveis para compra (PIX e cartão)',
  true
);

-- -----------------------------------------------------------------------------
-- create_payment_order — cria pedido e devolve mp_external_ref para o backend
-- Chamada pelo usuário autenticado; o backend cria a preferência no MP
-- e atualiza mp_preference_id em seguida.
-- -----------------------------------------------------------------------------
create or replace function public.create_payment_order(
  p_pack_id      text,
  p_amount_brl   numeric,
  p_credits      integer
)
returns public.payment_orders
language plpgsql security definer set search_path = public as $$
declare
  v_order public.payment_orders;
begin
  insert into public.payment_orders (user_id, pack_id, amount_brl, credits_amount)
  values (auth.uid(), p_pack_id, p_amount_brl, p_credits)
  returning * into v_order;
  return v_order;
end $$;

-- -----------------------------------------------------------------------------
-- set_payment_preference — salva o id de preferência MP no pedido
-- Chamado pelo backend (service_role) logo após criar a preferência no MP.
-- -----------------------------------------------------------------------------
create or replace function public.set_payment_preference(
  p_order_id        uuid,
  p_preference_id   text
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payment_orders
  set mp_preference_id = p_preference_id
  where id = p_order_id;
end $$;

-- -----------------------------------------------------------------------------
-- approve_payment_order — aprovação atômica + ledger de créditos
-- Chamado pelo webhook handler (service_role). Idempotente.
-- -----------------------------------------------------------------------------
create or replace function public.approve_payment_order(
  p_external_ref    text,
  p_mp_payment_id   text,
  p_idempotency_key text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.payment_orders;
begin
  perform pg_advisory_xact_lock(hashtext('payment:' || p_external_ref));

  select * into v_order
  from public.payment_orders
  where mp_external_ref = p_external_ref;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_order.status = 'approved' then
    return;  -- já aprovado, idempotente
  end if;

  update public.payment_orders
  set status = 'approved', mp_payment_id = p_mp_payment_id, updated_at = now()
  where id = v_order.id;

  perform public.grant_credits(
    v_order.user_id,
    'download'::public.credit_kind,
    'PURCHASE'::public.credit_tx_type,
    v_order.credits_amount,
    'Compra — ' || v_order.pack_id,
    'payment_order',
    v_order.id::text,
    p_idempotency_key
  );
end $$;

-- -----------------------------------------------------------------------------
-- fail_payment_order — marca pedido como falho (webhook)
-- -----------------------------------------------------------------------------
create or replace function public.fail_payment_order(
  p_external_ref  text,
  p_mp_payment_id text,
  p_reason        text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payment_orders
  set status = 'failed',
      mp_payment_id  = p_mp_payment_id,
      failure_reason = p_reason,
      updated_at     = now()
  where mp_external_ref = p_external_ref
    and status = 'pending';
end $$;

-- -----------------------------------------------------------------------------
-- Admin: ver todos os pedidos
-- -----------------------------------------------------------------------------
create policy "admin sees all orders"
  on public.payment_orders for select
  using (public.is_admin());

-- Realtime: usuário pode ouvir atualizações dos próprios pedidos
alter publication supabase_realtime add table public.payment_orders;

-- =============================================================================
-- Mix Pro — Fase 7: Mixagem Profissional
-- Fluxo: usuário envia pedido + stems → admin mixa no PC → faz upload da entrega
-- Os stems chegam direto ao PC do admin via worker (pull do R2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.pro_order_status as enum (
  'pending_payment',   -- aguardando pagamento
  'paid',              -- pago, aguardando início
  'in_progress',       -- admin iniciou
  'waiting_revision',  -- entrega feita, aguardando cliente
  'revision_requested',-- cliente pediu revisão
  'delivered',         -- cliente aprovou
  'cancelled',         -- cancelado (reembolso manual se necessário)
  'refunded'           -- estornado
);

-- -----------------------------------------------------------------------------
-- Serviços de mixagem profissional (configuráveis pelo admin)
-- -----------------------------------------------------------------------------
create table public.pro_services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  price_brl    numeric(10,2) not null check (price_brl > 0),
  max_stems    integer not null default 32 check (max_stems > 0),
  delivery_days integer not null default 5 check (delivery_days > 0),
  max_revisions integer not null default 2 check (max_revisions >= 0),
  active       boolean not null default true,
  position     smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger pro_services_touch before update on public.pro_services
  for each row execute function public.touch_updated_at();

-- Serviço padrão
insert into public.pro_services (name, description, price_brl, max_stems, delivery_days, max_revisions, position)
values (
  'Mixagem Profissional',
  'Mixagem completa feita manualmente pelo nosso engenheiro. Envie até 32 faixas (stems) e receba o arquivo final mixado em até 5 dias úteis com 2 revisões inclusas.',
  149.90, 32, 5, 2, 0
);

-- -----------------------------------------------------------------------------
-- Pedidos de mixagem profissional
-- -----------------------------------------------------------------------------
create table public.pro_orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  service_id       uuid not null references public.pro_services (id),
  status           public.pro_order_status not null default 'pending_payment',

  -- Informações do projeto
  project_name     text not null,
  genre            text,
  bpm              integer,
  notes            text,                         -- orientações do cliente

  -- Pagamento (reutiliza payment_orders)
  payment_order_id uuid references public.payment_orders (id) on delete set null,

  -- Controle de entrega
  revisions_used   integer not null default 0,
  due_date         date,
  delivered_at     timestamptz,
  revision_notes   text,                         -- pedido de revisão mais recente

  -- Storage
  stems_prefix     text,   -- ex: "pro-orders/{id}/stems/"
  delivery_key     text,   -- chave do arquivo final entregue

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index pro_orders_user_idx   on public.pro_orders (user_id, created_at desc);
create index pro_orders_status_idx on public.pro_orders (status, created_at desc);

create trigger pro_orders_touch before update on public.pro_orders
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Stems (arquivos do cliente)
-- -----------------------------------------------------------------------------
create table public.pro_stems (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.pro_orders (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  storage_key  text not null,
  file_name    text not null,
  size_bytes   bigint not null,
  mime         text,
  status       text not null default 'uploading' check (status in ('uploading','ready','failed')),
  -- worker marca synced_at quando copia para o PC do admin
  synced_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index pro_stems_order_idx on public.pro_stems (order_id);

-- -----------------------------------------------------------------------------
-- Mensagens do pedido (chat cliente ↔ admin)
-- -----------------------------------------------------------------------------
create table public.pro_messages (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.pro_orders (id) on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  body         text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index pro_messages_order_idx on public.pro_messages (order_id, created_at);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.pro_services enable row level security;
create policy "services are public"
  on public.pro_services for select
  using (active = true);
create policy "admin manages services"
  on public.pro_services for all
  using (public.is_admin());

alter table public.pro_orders enable row level security;
create policy "users see own orders"
  on public.pro_orders for select
  using (user_id = auth.uid());
create policy "users insert own orders"
  on public.pro_orders for insert
  with check (user_id = auth.uid());
create policy "admin sees all orders"
  on public.pro_orders for all
  using (public.is_admin());

alter table public.pro_stems enable row level security;
create policy "users see own stems"
  on public.pro_stems for select
  using (user_id = auth.uid());
create policy "users insert own stems"
  on public.pro_stems for insert
  with check (user_id = auth.uid());
create policy "admin sees all stems"
  on public.pro_stems for all
  using (public.is_admin());

alter table public.pro_messages enable row level security;
create policy "participants see messages"
  on public.pro_messages for select
  using (
    sender_id = auth.uid()
    or exists (select 1 from public.pro_orders o where o.id = order_id and o.user_id = auth.uid())
    or public.is_admin()
  );
create policy "participants send messages"
  on public.pro_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      exists (select 1 from public.pro_orders o where o.id = order_id and o.user_id = auth.uid())
      or public.is_admin()
    )
  );

-- -----------------------------------------------------------------------------
-- Funções de negócio
-- -----------------------------------------------------------------------------

-- Marca stems como prontos após upload confirmado
create or replace function public.confirm_stem_upload(p_stem_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pro_stems
  set status = 'ready'
  where id = p_stem_id and user_id = auth.uid();
end $$;

-- Admin: muda estado do pedido
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status   public.pro_order_status,
  p_notes    text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.pro_orders
  set status        = p_status,
      revision_notes = coalesce(p_notes, revision_notes),
      delivered_at  = case when p_status = 'waiting_revision' then now() else delivered_at end,
      updated_at    = now()
  where id = p_order_id;
end $$;

-- Cliente solicita revisão
create or replace function public.request_revision(
  p_order_id uuid,
  p_notes    text
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_order public.pro_orders;
begin
  select * into v_order from public.pro_orders
  where id = p_order_id and user_id = auth.uid();

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status <> 'waiting_revision' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  -- Verifica limite de revisões
  declare svc public.pro_services;
  begin
    select * into svc from public.pro_services where id = v_order.service_id;
    if v_order.revisions_used >= svc.max_revisions then
      raise exception 'REVISIONS_EXHAUSTED' using errcode = 'P0001';
    end if;
  end;

  update public.pro_orders
  set status         = 'revision_requested',
      revisions_used = revisions_used + 1,
      revision_notes = p_notes,
      updated_at     = now()
  where id = p_order_id;
end $$;

-- Cliente aprova entrega
create or replace function public.approve_delivery(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pro_orders
  set status = 'delivered', updated_at = now()
  where id = p_order_id and user_id = auth.uid()
    and status in ('waiting_revision', 'revision_requested');
end $$;

-- Configurações adicionais para mixagem profissional
insert into public.system_settings (key, value, description, is_public)
values
  ('pro_mixing_enabled', 'true',  'Habilita o módulo de Mixagem Profissional', true),
  ('pro_stem_max_mb',    '200',   'Tamanho máximo de cada stem (MB)', true),
  ('pro_stem_formats',   '["wav","aiff","aif","flac"]', 'Formatos aceitos para stems', true);

-- Realtime: usuário acompanha pedido e mensagens em tempo real
alter publication supabase_realtime add table public.pro_orders;
alter publication supabase_realtime add table public.pro_messages;

-- =============================================================================
-- Mix Pro — Módulos premium (em desenvolvimento, abertos a todos):
--   VS Premium 7 faixas, Mix & Master IA, Produção da composição, Voz finalizada,
--   Pacote compositor e Engenheiro finaliza.
-- -----------------------------------------------------------------------------
-- • Preços em dois níveis (1ª experiência e profissional), editáveis em system_settings.premium_products.
-- • 1ª experiência: UMA vez por pessoa e por produto. Trava por conta, aparelho, CPF (hash) e
--   rede+aparelho (hash) — índices únicos fecham a corrida entre duas compras simultâneas.
-- • Projetos premium guardam as entradas no Cofre (cofre/proj/<id>/…, 30 dias) para revisões.
-- • Os jobs usam a esteira das ferramentas (tool_jobs) com créditos 0: o que libera é o pedido pago.
-- • Vitrine com consentimento (opt-in, revogável, curadoria do admin) e recompensa em créditos.
-- • Mapa de treino (só admin): músicas licenciadas para os treinos por gênero.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ajustes
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public) values
  ('premium_products', '{
     "credit_brl": 1.0,
     "pro_discount_pct": 20,
     "items": [
       {"id": "vs_premium", "name": "VS Premium 7 faixas", "intro_brl": 19.9, "price_brl": 39.9, "credits_ok": true, "max_minutes": 6, "long_max_minutes": 10, "long_multiplier": 1.5, "enabled": true},
       {"id": "mix_ia", "name": "Mix & Master IA", "intro_brl": 49.9, "price_brl": 249, "max_tracks": 24, "max_minutes": 6, "revision_days": 7, "enabled": true},
       {"id": "producao", "name": "Produção da composição", "intro_brl": 99.9, "price_brl": 597, "versions": 3, "max_minutes": 6, "enabled": true},
       {"id": "voz_final", "name": "Voz finalizada", "intro_brl": 49.9, "price_brl": 249, "max_minutes": 6, "revision_days": 7, "enabled": true},
       {"id": "pacote_compositor", "name": "Pacote compositor", "intro_brl": 129.9, "price_brl": 749, "max_minutes": 6, "enabled": true},
       {"id": "eng_finaliza", "name": "Engenheiro finaliza", "intro_brl": null, "price_brl": 197, "enabled": true}
     ]
   }'::jsonb, 'Produtos premium: preço de 1ª experiência (uma vez por pessoa), preço profissional, desconto do Plano Pro, valor do crédito e limites.', true),
  ('showcase_reward_credits', '10'::jsonb, 'Créditos de presente quando um trecho autorizado entra na vitrine (aprovado pelo admin).', true),
  ('premium_preview_per_day', '6'::jsonb, 'Prévias grátis (30 s) de produtos premium por pessoa por dia.', false),
  ('premium_dev_badge', 'true'::jsonb, 'Mostrar o selo "Em desenvolvimento" nos módulos premium.', true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Projetos premium
-- -----------------------------------------------------------------------------
create table if not exists public.premium_projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  product      text not null check (product in ('vs_premium', 'mix_ia', 'producao', 'voz_final')),
  title        text not null default '' check (length(title) <= 80),
  status       text not null default 'draft'
                 check (status in ('draft', 'uploaded', 'preview', 'preview_ready', 'awaiting_payment', 'paid', 'processing', 'delivered', 'failed', 'expired')),
  -- escolhas do usuário e análise (mixer, gênero, preset de master, tom/BPM…); nunca segredos
  params       jsonb not null default '{}'::jsonb check (octet_length(params::text) <= 65536),
  -- arquivos no Cofre: cofre/proj/<id>/<nn>
  inputs       text[] not null default '{}' check (cardinality(inputs) <= 40),
  input_meta   jsonb not null default '[]'::jsonb,
  -- minutos considerados no preço (a duração é conferida no serviço)
  minutes      numeric(5, 2) not null default 0 check (minutes between 0 and 20),
  order_id     uuid,
  preview_job  uuid references public.tool_jobs (id) on delete set null,
  final_job    uuid references public.tool_jobs (id) on delete set null,
  revisions    smallint not null default 0,
  parent_id    uuid references public.premium_projects (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);
create index if not exists premium_projects_user on public.premium_projects (user_id, created_at desc);
alter table public.premium_projects enable row level security;
revoke all on table public.premium_projects from anon, authenticated;
drop policy if exists "premium_projects: ver os próprios" on public.premium_projects;
create policy "premium_projects: ver os próprios" on public.premium_projects for select using (user_id = auth.uid() or public.is_admin());
grant select on table public.premium_projects to authenticated;

-- -----------------------------------------------------------------------------
-- Pedidos premium (pagos em reais pelo Mercado Pago ou em créditos)
-- -----------------------------------------------------------------------------
create table if not exists public.premium_orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  project_id       uuid references public.premium_projects (id) on delete set null,
  product          text not null check (product in ('vs_premium', 'mix_ia', 'producao', 'voz_final', 'pacote_compositor', 'eng_finaliza')),
  price_brl        numeric(10, 2) not null check (price_brl >= 0),
  list_price_brl   numeric(10, 2) not null check (list_price_brl >= 0),
  intro            boolean not null default false,
  pro_discount     boolean not null default false,
  method           text not null check (method in ('brl', 'credits')),
  credits          integer not null default 0 check (credits >= 0),
  status           text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled', 'refunded')),
  payment_order_id uuid references public.payment_orders (id) on delete set null,
  -- custo real (API externa + GPU + CPU) para o painel de margem
  cost_usd         numeric(10, 4) not null default 0,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);
create index if not exists premium_orders_user on public.premium_orders (user_id, created_at desc);
alter table public.premium_orders enable row level security;
revoke all on table public.premium_orders from anon, authenticated;
drop policy if exists "premium_orders: ver os próprios" on public.premium_orders;
create policy "premium_orders: ver os próprios" on public.premium_orders for select using (user_id = auth.uid() or public.is_admin());
grant select on table public.premium_orders to authenticated;

do $$ begin
  alter table public.premium_projects add constraint premium_projects_order_fk foreign key (order_id) references public.premium_orders (id) on delete set null;
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 1ª experiência: uma vez por pessoa (conta, aparelho, CPF, rede+aparelho)
-- -----------------------------------------------------------------------------
create table if not exists public.intro_claims (
  id           uuid primary key default gen_random_uuid(),
  product      text not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- hashes HMAC (nunca o valor): identificador do aparelho, CPF e rede+aparelho
  device_hash  text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  cpf_hash     text not null check (cpf_hash ~ '^[a-f0-9]{64}$'),
  net_hash     text check (net_hash ~ '^[a-f0-9]{64}$'),
  order_id     uuid references public.premium_orders (id) on delete cascade,
  status       text not null default 'reserved' check (status in ('reserved', 'used', 'released')),
  created_at   timestamptz not null default now()
);
create unique index if not exists intro_claims_user on public.intro_claims (product, user_id) where status <> 'released';
create unique index if not exists intro_claims_device on public.intro_claims (product, device_hash) where status <> 'released';
create unique index if not exists intro_claims_cpf on public.intro_claims (product, cpf_hash) where status <> 'released';
create index if not exists intro_claims_net on public.intro_claims (product, net_hash, created_at) where status <> 'released';
alter table public.intro_claims enable row level security;
revoke all on table public.intro_claims from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Vitrine (consentimento opt-in, revogável, curadoria)
-- -----------------------------------------------------------------------------
create table if not exists public.showcase_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.profiles (id) on delete cascade,   -- null = exemplo do admin
  project_id       uuid references public.premium_projects (id) on delete set null,
  product          text not null check (product in ('estudio', 'vs_premium', 'mix_ia', 'producao', 'voz_final')),
  genre            text not null default '' check (length(genre) <= 40),
  title            text not null default '' check (length(title) <= 80),
  artist_name      text check (length(artist_name) <= 60),
  anonymous        boolean not null default true,
  -- trechos de até 30 s em vitrine/<id>/antes.m4a e depois.m4a (prefixo sem limpeza automática)
  before_key       text check (before_key ~ '^vitrine/[0-9a-f-]{36}/(antes|depois)\.(m4a|mp3|wav)$'),
  after_key        text not null check (after_key ~ '^vitrine/[0-9a-f-]{36}/(antes|depois)\.(m4a|mp3|wav)$'),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  consent_version  text not null default 'v1',
  consent_at       timestamptz,
  reward_credits   integer not null default 0,
  rewarded_at      timestamptz,
  featured         boolean not null default false,
  position         integer not null default 0,
  plays            integer not null default 0,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  revoked_at       timestamptz
);
create index if not exists showcase_items_public on public.showcase_items (status, featured desc, position, created_at desc);
alter table public.showcase_items enable row level security;
revoke all on table public.showcase_items from anon, authenticated;
drop policy if exists "showcase: ver os próprios" on public.showcase_items;
create policy "showcase: ver os próprios" on public.showcase_items for select using (user_id = auth.uid() or public.is_admin());
grant select on table public.showcase_items to authenticated;

/** Admin aprova ou recusa um trecho. Aprovado com dono: credita a recompensa uma vez. */
create or replace function public.review_showcase_item(p_item uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.showcase_items;
  v_reward integer := coalesce(public.setting_int('showcase_reward_credits'), 10);
begin
  select * into v from public.showcase_items where id = p_item for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = 'revoked' then
    return jsonb_build_object('status', 'revoked');
  end if;
  update public.showcase_items set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now()
   where id = p_item;
  if p_approve and v.user_id is not null and v.rewarded_at is null and v_reward > 0 then
    perform public.grant_credits(
      v.user_id, 'download', 'ADMIN_ADJUSTMENT', v_reward, 'Presente: sua produção entrou na vitrine', 'showcase', v.id::text, 'showcase:' || v.id::text
    );
    update public.showcase_items set reward_credits = v_reward, rewarded_at = now() where id = p_item;
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end $$;

/** O dono retira a autorização a qualquer momento (o trecho sai do ar; o arquivo é apagado pelo servidor). */
create or replace function public.revoke_showcase_item(p_item uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_keys text;
begin
  update public.showcase_items set status = 'revoked', revoked_at = now()
   where id = p_item and user_id = p_user and status <> 'revoked'
  returning coalesce(before_key, '') || '|' || after_key into v_keys;
  if v_keys is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_keys;
end $$;

/** Vitrine pública: só aprovados; conta a reprodução por chamada separada. */
create or replace function public.count_showcase_play(p_item uuid)
returns void language sql security definer set search_path = public as $$
  update public.showcase_items set plays = plays + 1 where id = p_item and status = 'approved'
$$;

-- -----------------------------------------------------------------------------
-- Mapa de treino (só admin): músicas licenciadas para os treinos por gênero
-- -----------------------------------------------------------------------------
create table if not exists public.training_assets (
  id               uuid primary key default gen_random_uuid(),
  genre            text not null check (genre ~ '^[a-z0-9_-]{2,30}$'),
  title            text not null check (length(title) between 1 and 120),
  artist           text not null default '' check (length(artist) <= 120),
  source           text not null default 'proprio' check (source in ('proprio', 'parceiro')),
  rights_confirmed boolean not null default false,
  rights_note      text not null default '' check (length(rights_note) <= 500),
  bpm              numeric(5, 1),
  musical_key      text check (length(musical_key) <= 20),
  -- [{key, name, bytes, kind: 'mix'|'stem'|'guia'}] no R2 em treino/<id>/…
  files            jsonb not null default '[]'::jsonb,
  status           text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists training_assets_genre on public.training_assets (genre, status);
alter table public.training_assets enable row level security;
revoke all on table public.training_assets from anon, authenticated;
drop policy if exists "training: só admin" on public.training_assets;
create policy "training: só admin" on public.training_assets for select using (public.is_admin());
grant select on table public.training_assets to authenticated;

-- -----------------------------------------------------------------------------
-- Pedido premium (só service_role): preço calculado no servidor; 1ª experiência travada aqui
-- -----------------------------------------------------------------------------
create or replace function public.create_premium_order(
  p_user uuid, p_project uuid, p_product text, p_method text, p_price numeric, p_list_price numeric,
  p_credits integer, p_intro boolean, p_pro_discount boolean,
  p_device_hash text default null, p_cpf_hash text default null, p_net_hash text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.premium_orders;
  v_net_count integer;
begin
  if p_method not in ('brl', 'credits') or p_price < 0 or p_list_price < p_price or p_credits < 0 then
    raise exception 'INVALID' using errcode = '22023';
  end if;
  if p_project is not null and not exists (select 1 from public.premium_projects where id = p_project and user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('premium:' || p_user::text));

  -- projeto já pago (no mesmo produto): não cria outro pedido
  if p_project is not null and exists (select 1 from public.premium_orders where project_id = p_project and product = p_product and status = 'paid') then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;
  -- pedido pendente do mesmo projeto e produto: cancela o anterior (evita vários checkouts)
  if p_project is not null then
    update public.intro_claims set status = 'released'
     where status = 'reserved' and order_id in (select id from public.premium_orders where project_id = p_project and product = p_product and status = 'pending_payment');
    update public.premium_orders set status = 'cancelled' where project_id = p_project and product = p_product and status = 'pending_payment';
  end if;

  if p_intro then
    if p_device_hash is null or p_cpf_hash is null then
      raise exception 'INTRO_NEEDS_ID' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.intro_claims c
       where c.product = p_product and c.status <> 'released'
         and (c.user_id = p_user or c.device_hash = p_device_hash or c.cpf_hash = p_cpf_hash)
    ) then
      raise exception 'INTRO_USED' using errcode = 'P0001';
    end if;
    if p_net_hash is not null then
      select count(*) into v_net_count from public.intro_claims c
       where c.product = p_product and c.status <> 'released' and c.net_hash = p_net_hash and c.created_at > now() - interval '30 days';
      if v_net_count >= 1 then
        raise exception 'INTRO_USED' using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.premium_orders (user_id, project_id, product, price_brl, list_price_brl, intro, pro_discount, method, credits)
  values (p_user, p_project, p_product, p_price, p_list_price, p_intro, p_pro_discount, p_method, case when p_method = 'credits' then p_credits else 0 end)
  returning * into v;

  if p_intro then
    begin
      insert into public.intro_claims (product, user_id, device_hash, cpf_hash, net_hash, order_id)
      values (p_product, p_user, p_device_hash, p_cpf_hash, p_net_hash, v.id);
    exception when unique_violation then
      raise exception 'INTRO_USED' using errcode = 'P0001';
    end;
  end if;

  if p_method = 'credits' then
    perform public.grant_credits(
      p_user, 'download', 'DOWNLOAD', -p_credits, 'Premium: ' || p_product, 'premium_order', v.id::text, 'prem:' || v.id::text
    );
    perform public.mark_premium_order_paid(v.id, null);
    select * into v from public.premium_orders where id = v.id;
  end if;
  if p_project is not null and p_product <> 'eng_finaliza' then
    update public.premium_projects set order_id = v.id, updated_at = now(),
           status = case when v.status = 'paid' then 'paid' else 'awaiting_payment' end
     where id = p_project;
  end if;
  return to_jsonb(v);
end $$;

/**
 * Marca pago (Mercado Pago ou créditos). Idempotente; pagamento atrasado de pedido cancelado também vale.
 * "Engenheiro finaliza": abre um pedido na fila da Mixagem Profissional ligado ao projeto da IA.
 */
create or replace function public.mark_premium_order_paid(p_order uuid, p_payment_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.premium_orders;
  v_svc public.pro_services;
  v_title text;
begin
  update public.premium_orders set status = 'paid', paid_at = coalesce(paid_at, now()),
         payment_order_id = coalesce(p_payment_order, payment_order_id)
   where id = p_order and status in ('pending_payment', 'cancelled')
  returning * into v;
  update public.intro_claims set status = 'used' where order_id = p_order;
  if v.id is null then
    return;
  end if;
  if v.product = 'eng_finaliza' then
    select * into v_svc from public.pro_services where name = 'Engenheiro finaliza' order by created_at limit 1;
    select title into v_title from public.premium_projects where id = v.project_id;
    if v_svc.id is not null then
      insert into public.pro_orders (user_id, service_id, status, project_name, notes, files_url, payment_order_id, due_date)
      values (v.user_id, v_svc.id, 'paid', coalesce(nullif(v_title, ''), 'Mix & Master IA'),
              'Finalização da mixagem feita pela IA. Arquivos e decisões do motor no projeto.',
              '/premium/' || v.project_id::text, p_payment_order, (now() + make_interval(days => v_svc.delivery_days))::date);
    end if;
    return;
  end if;
  update public.premium_projects set status = 'paid', updated_at = now()
   where order_id = p_order and status in ('draft', 'uploaded', 'preview_ready', 'awaiting_payment', 'preview', 'failed');
end $$;

/** Pedidos em reais não pagos em 26 h: cancelados e a 1ª experiência volta a valer. */
create or replace function public.cancel_stale_premium_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with c as (
    update public.premium_orders set status = 'cancelled'
     where status = 'pending_payment' and method = 'brl' and created_at < now() - interval '26 hours'
    returning id
  )
  update public.intro_claims set status = 'released' where status = 'reserved' and order_id in (select id from c);
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Pagamentos: libera pedidos premium (pack_id "prem:<id>"); estorno marca reembolsado
-- -----------------------------------------------------------------------------
create or replace function public.approve_payment_order(
  p_external_ref    text,
  p_mp_payment_id   text,
  p_idempotency_key text,
  p_amount_paid     numeric
)
returns public.payment_orders
language plpgsql security definer set search_path = public as $$
declare
  v_order public.payment_orders;
begin
  perform pg_advisory_xact_lock(hashtext('payment:' || p_external_ref));

  select * into v_order from public.payment_orders where mp_external_ref = p_external_ref;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status = 'approved' then
    return v_order;
  end if;
  if p_amount_paid + 0.009 < v_order.amount_brl then
    raise exception 'AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;

  update public.payment_orders
  set status = 'approved', mp_payment_id = p_mp_payment_id, updated_at = now()
  where id = v_order.id
  returning * into v_order;

  if v_order.pack_id like 'pro:%' then
    update public.pro_orders
    set status = 'paid', payment_order_id = v_order.id, updated_at = now()
    where id = substring(v_order.pack_id from 5)::uuid and status = 'pending_payment';
  elsif v_order.pack_id like 'prem:%' then
    perform public.mark_premium_order_paid(substring(v_order.pack_id from 6)::uuid, v_order.id);
  else
    perform public.grant_credits(
      v_order.user_id, 'download', 'PURCHASE', v_order.credits_amount,
      'Compra de ' || v_order.credits_amount || ' créditos', 'payment_order', v_order.id::text, p_idempotency_key
    );
  end if;
  return v_order;
end $$;
revoke execute on function public.approve_payment_order(text, text, text, numeric) from public, anon, authenticated;

create or replace function public.reverse_payment_order(
  p_external_ref  text,
  p_mp_payment_id text,
  p_reason        text
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order   public.payment_orders;
  v_balance integer;
  v_take    integer;
begin
  perform pg_advisory_xact_lock(hashtext('payment:' || p_external_ref));
  select * into v_order from public.payment_orders where mp_external_ref = p_external_ref;
  if not found then return 'not_found'; end if;

  if v_order.status = 'pending' then
    update public.payment_orders
    set status = 'failed', mp_payment_id = coalesce(mp_payment_id, p_mp_payment_id), failure_reason = p_reason, updated_at = now()
    where id = v_order.id;
    return 'failed';
  end if;
  if v_order.status <> 'approved' then return 'unchanged'; end if;

  update public.payment_orders
  set status = 'refunded', failure_reason = p_reason, updated_at = now()
  where id = v_order.id;

  if v_order.pack_id like 'pro:%' then
    update public.pro_orders
    set status = 'refunded', updated_at = now()
    where id = substring(v_order.pack_id from 5)::uuid and status in ('paid', 'pending_payment');
  elsif v_order.pack_id like 'prem:%' then
    update public.premium_orders set status = 'refunded' where id = substring(v_order.pack_id from 6)::uuid;
  else
    v_balance := public.credit_balance(v_order.user_id, 'download');
    v_take := least(v_balance, v_order.credits_amount);
    if v_take > 0 then
      perform public.grant_credits(
        v_order.user_id, 'download', 'REFUND', -v_take,
        case when p_reason = 'charged_back' then 'Contestação no cartão' else 'Pagamento estornado' end
          || ' (' || v_order.credits_amount || ' créditos)',
        'payment_order', v_order.id::text, 'reverse:' || v_order.id::text
      );
    end if;
  end if;
  return 'refunded';
end $$;
revoke execute on function public.reverse_payment_order(text, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Esteira das ferramentas: novos recursos premium, entradas do Cofre do projeto, mais pistas
-- -----------------------------------------------------------------------------
alter table public.tool_jobs drop constraint if exists tool_jobs_tool_check;
alter table public.tool_jobs add constraint tool_jobs_tool_check
  check (tool in ('pitch_tempo', 'voice_playback', 'reference_master', 'album', 'stems', 'convert',
                  'stems_premium', 'mix_ia', 'compose', 'voice_final'));
alter table public.tool_jobs drop constraint if exists tool_jobs_inputs_check;
alter table public.tool_jobs add constraint tool_jobs_inputs_check check (cardinality(inputs) between 1 and 40);
alter table public.tool_jobs add column if not exists project_id uuid references public.premium_projects (id) on delete set null;

create or replace function public.create_tool_job(
  p_user uuid, p_tool text, p_params jsonb, p_inputs text[], p_credits integer, p_retention_days integer default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.tool_jobs;
  v_available integer;
  v_key text;
  v_day timestamptz := public.export_day_start();
  v_project uuid;
begin
  if p_user is null or p_tool is null or p_tool not in ('pitch_tempo', 'voice_playback', 'reference_master', 'album', 'stems', 'convert',
                                                         'stems_premium', 'mix_ia', 'compose', 'voice_final') then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or octet_length(p_params::text) > 16384 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_inputs is null or cardinality(p_inputs) not between 1 and 40 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  -- recursos premium: as entradas são do Cofre do próprio projeto
  if p_tool in ('stems_premium', 'mix_ia', 'compose', 'voice_final') then
    v_project := nullif(p_params ->> 'project_id', '')::uuid;
    if v_project is null or not exists (select 1 from public.premium_projects where id = v_project and user_id = p_user) then
      raise exception 'INVALID_JOB' using errcode = '22023';
    end if;
  end if;
  foreach v_key in array p_inputs loop
    if v_key !~ '^in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and not (v_project is not null and v_key ~ ('^cofre/proj/' || v_project::text || '/[0-9]{2}$')) then
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

  insert into public.tool_jobs (user_id, tool, params, inputs, credits, credit_state, expires_at, project_id)
  values (p_user, p_tool, p_params, p_inputs, p_credits, case when p_credits > 0 then 'reserved'::public.export_credit_state else 'none'::public.export_credit_state end,
          now() + make_interval(days => p_retention_days), v_project)
  returning * into v_job;
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'credit_state', v_job.credit_state, 'credits', v_job.credits);
end $$;

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
  if p_outputs is null or jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) not between 1 and 80 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_outputs) loop
    if (o ->> 'key') !~ '^(out|cofre)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,3}\.(wav|mp3|m4a|flac|zip|json|pdf)$'
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
  -- custo de API externa/GPU informado pelo serviço vai para o pedido (painel de margem)
  if v.project_id is not null and (p_cost ? 'api_usd') then
    update public.premium_orders set cost_usd = cost_usd + coalesce((p_cost ->> 'api_usd')::numeric, 0)
     where id = (select order_id from public.premium_projects where id = v.project_id);
  end if;
  return jsonb_build_object('status', 'done');
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_premium_order(uuid, uuid, text, text, numeric, numeric, integer, boolean, boolean, text, text, text)',
    'public.mark_premium_order_paid(uuid, uuid)',
    'public.cancel_stale_premium_orders()',
    'public.review_showcase_item(uuid, boolean)',
    'public.revoke_showcase_item(uuid, uuid)',
    'public.count_showcase_play(uuid)',
    'public.create_tool_job(uuid, text, jsonb, text[], integer, integer)',
    'public.commit_tool_job(uuid, jsonb, jsonb, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mixpro-premium-pedidos';
    perform cron.schedule('mixpro-premium-pedidos', '17 * * * *', $c$select public.cancel_stale_premium_orders()$c$);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Mixagem humana a preço de mercado (metade do valor médio de estúdio)
-- -----------------------------------------------------------------------------
update public.pro_services set price_brl = 397 where name = 'Mixagem Profissional' and price_brl = 149.90;
-- serviço interno (não aparece na lista da Mixagem Profissional): o engenheiro parte da mix da IA
insert into public.pro_services (name, description, price_brl, max_stems, delivery_days, max_revisions, active, position)
select 'Engenheiro finaliza', 'Um engenheiro de áudio revisa e finaliza a mixagem feita pela IA, com os ajustes que você pedir.', 197, 40, 3, 2, false, 99
 where not exists (select 1 from public.pro_services where name = 'Engenheiro finaliza');

-- -----------------------------------------------------------------------------
-- Presets de master novos (categoria Masterização)
-- -----------------------------------------------------------------------------
create or replace function pg_temp.seed_master(
  p_slug text, p_name text, p_style text, p_desc text, p_tags text[], p_pos int, p_chain jsonb
) returns void language plpgsql as $$
declare v_pid uuid; v_vid uuid;
begin
  if exists (select 1 from public.presets where slug = p_slug) then return; end if;
  insert into public.presets (slug, name, category_id, style, description, tags, active, position)
  values (p_slug, p_name, 'master-main', p_style, p_desc, p_tags, true, p_pos)
  returning id into v_pid;
  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
  values (v_pid, 1, p_chain, 75, 'Versão inicial')
  returning id into v_vid;
  update public.presets set current_version_id = v_vid where id = v_pid;
end $$;

select pg_temp.seed_master('master-pop-americano', 'Master Pop Americano', 'loud',
  'O som das rádios americanas: graves firmes e controlados, médios limpos, muito brilho e volume alto sem distorcer.',
  array['master','pop','americano','loud','streaming'], 6,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":25,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":70,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-1.5,"neutral":0},"q":0.9}},
    {"type":"eq_peak","params":{"frequency_hz":3500,"gain_db":{"value":1,"neutral":0},"q":1.2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":11000,"gain_db":{"value":2.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":15,"release_ms":120,"knee_db":8,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":1.5,"neutral":0},"mix":{"value":12,"neutral":0},"output_db":0}},
    {"type":"stereo_width","params":{"width":{"value":112,"neutral":100},"bass_mono_hz":120}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-9}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":25,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-worship', 'Master Worship', 'wide',
  'Para louvor e worship: amplo, atmosférico e emocionante. Pads e guitarras abertos, voz presente e dinâmica preservada para as subidas.',
  array['master','worship','louvor','gospel','amplo'], 7,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":25,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":350,"gain_db":{"value":-1.5,"neutral":0},"q":0.9}},
    {"type":"eq_peak","params":{"frequency_hz":2500,"gain_db":{"value":1,"neutral":0},"q":1.1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":1.8,"neutral":1},"attack_ms":30,"release_ms":250,"knee_db":10,"makeup_db":{"value":1.5,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":120,"neutral":100},"bass_mono_hz":120}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-11}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-gospel-br', 'Master Gospel BR', 'punchy',
  'Gospel brasileiro: voz na frente, graves cheios, médios quentes e volume competitivo para as plataformas.',
  array['master','gospel','louvor','brasil'], 8,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":25,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":70,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-1,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2200,"gain_db":{"value":1.5,"neutral":0},"q":1.2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-13,"neutral":0},"ratio":{"value":2.2,"neutral":1},"attack_ms":20,"release_ms":150,"knee_db":8,"makeup_db":{"value":2.5,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":110,"neutral":100},"bass_mono_hz":110}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-10}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-sertanejo', 'Master Sertanejo', 'bright',
  'Sertanejo atual: voz brilhante e na cara, violão definido, sanfona e graves encorpados, volume alto de rádio.',
  array['master','sertanejo','brasil','radio'], 9,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":25,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":75,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":280,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":1.5,"neutral":0},"q":1.2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":9000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":15,"release_ms":130,"knee_db":8,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":110,"neutral":100},"bass_mono_hz":110}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-9}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":30,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-pagode-samba', 'Master Pagode/Samba', 'warm',
  'Pagode e samba: percussão viva, cavaco e banjo definidos, graves quentes e balanço preservado.',
  array['master','pagode','samba','brasil'], 10,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":25,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":1.2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":320,"gain_db":{"value":-1,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":1.2,"neutral":0},"q":1.3}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":25,"release_ms":160,"knee_db":10,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":1.5,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-10}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-funk-br', 'Master Funk BR', 'sub-heavy',
  'Funk brasileiro: grave pesado e centralizado, batida na frente e volume máximo para o paredão e as redes.',
  array['master','funk','brasil','grave'], 11,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":22,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":55,"gain_db":{"value":2.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":220,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2800,"gain_db":{"value":1.5,"neutral":0},"q":1.3}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-15,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":90,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":108,"neutral":100},"bass_mono_hz":150}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-8}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":20,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-edm', 'Master EDM/Eletrônica', 'loud',
  'Eletrônica: sub-grave limpo e mono, kick marcante, agudos abertos e muito volume para a pista.',
  array['master','edm','eletronica','loud'], 12,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":22,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":60,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":12000,"gain_db":{"value":2.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":6,"makeup_db":{"value":3.5,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":118,"neutral":100},"bass_mono_hz":150}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-8}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":20,"lookahead_ms":5}}
  ]}'::jsonb);

select pg_temp.seed_master('master-lofi', 'Master Lo-fi', 'warm',
  'Lo-fi e chill: quente, aveludado e confortável, agudos suaves e dinâmica relaxada.',
  array['master','lofi','chill','quente'], 13,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":120,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":-2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":30,"release_ms":250,"knee_db":10,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":3,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":1,"neutral":0},"release_ms":80,"lookahead_ms":5}}
  ]}'::jsonb);

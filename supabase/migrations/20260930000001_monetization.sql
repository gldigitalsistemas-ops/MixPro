-- =============================================================================
-- Mix Pro — Monetização e ferramentas da conta
-- * 5 créditos grátis no cadastro (sem renovação mensal); R$ 1,00 por crédito.
-- * Compra em lotes pelo Mercado Pago (o usuário escolhe a quantidade).
-- * Indicação: +10 para quem indicou e +10 para o indicado quando o indicado
--   faz a PRIMEIRA COMPRA aprovada.
-- * Mixagem profissional paga pelo Mercado Pago; arquivos por link.
-- * Estilos salvos do usuário ("Meu estilo").
-- * Correções de segurança: funções de pagamento não podem ser chamadas por
--   usuários, e pedidos profissionais só são criados pelo servidor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configurações
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description, is_public) values
  ('free_downloads',          '5',                  'Créditos grátis concedidos no cadastro', true),
  ('monthly_free_credits',    '0',                  'Créditos grátis por mês (0 = sem renovação mensal)', true),
  ('download_price_brl',      '1.00',               'Preço de 1 crédito (R$)', true),
  ('credit_pack_sizes',       '[5, 10, 15, 30, 50, 100]', 'Quantidades sugeridas na tela de compra', true),
  ('credit_purchase_min',     '5',                  'Compra mínima de créditos', true),
  ('credit_purchase_max',     '500',                'Compra máxima de créditos por pedido', true),
  ('referral_reward_referrer','10',                 'Créditos para quem indicou (após a 1ª compra do indicado)', true),
  ('referral_reward_referred','10',                 'Créditos para o indicado (após a 1ª compra dele)', true)
on conflict (key) do update set value = excluded.value, description = excluded.description, is_public = excluded.is_public;

-- Quem se cadastrou enquanto o bônus estava zerado recebe os 5 créditos agora.
do $$
declare r record;
begin
  for r in
    select p.id from public.profiles p
    where not exists (
      select 1 from public.credit_transactions t where t.user_id = p.id and t.type = 'FREE_SIGNUP'
    )
  loop
    perform public.grant_credits(
      r.id, 'download', 'FREE_SIGNUP', 5, 'Boas-vindas ao Mix Pro — 5 créditos grátis',
      'signup', null, 'signup_' || r.id::text
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Indicação: qualifica na primeira compra aprovada do indicado
-- -----------------------------------------------------------------------------
create or replace function public.process_referral()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer   uuid;
  v_reward_ref integer := coalesce(public.setting_int('referral_reward_referrer'), 10);
  v_reward_new integer := coalesce(public.setting_int('referral_reward_referred'), 10);
  v_cap        integer := coalesce(public.setting_int('referral_max_per_month'), 30);
  v_this_month integer;
begin
  if new.type <> 'PURCHASE' or new.amount <= 0 then
    return new;
  end if;

  select p.referred_by into v_referrer from public.profiles p where p.id = new.user_id;
  if v_referrer is null or v_referrer = new.user_id then
    return new;
  end if;
  if exists (select 1 from public.qualified_referrals where referrer_id = v_referrer and referred_id = new.user_id) then
    return new;
  end if;

  select count(*) into v_this_month
  from public.qualified_referrals
  where referrer_id = v_referrer and qualified_at >= date_trunc('month', now());

  if v_this_month < v_cap then
    perform public.grant_credits(
      v_referrer, 'download', 'REFERRAL_BONUS', v_reward_ref,
      'Um amigo que você indicou fez a primeira compra', 'qualified_referral', new.user_id::text,
      'referral_referrer_' || v_referrer || '_' || new.user_id
    );
  end if;

  perform public.grant_credits(
    new.user_id, 'download', 'REFERRAL_BONUS', v_reward_new,
    'Bônus por entrar com convite', 'qualified_referral', v_referrer::text,
    'referral_referred_' || v_referrer || '_' || new.user_id
  );

  insert into public.qualified_referrals (referrer_id, referred_id)
  values (v_referrer, new.user_id)
  on conflict do nothing;

  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Pagamentos
-- SEGURANÇA: estas funções eram executáveis por qualquer usuário (padrão do
-- Postgres), o que permitia "aprovar" o próprio pedido sem pagar.
-- -----------------------------------------------------------------------------
revoke execute on function public.create_payment_order(text, numeric, integer) from public, anon, authenticated;
revoke execute on function public.set_payment_preference(uuid, text) from public, anon, authenticated;
revoke execute on function public.fail_payment_order(text, text, text) from public, anon, authenticated;
drop function if exists public.approve_payment_order(text, text, text);

-- Aprovação atômica e idempotente; confere o valor pago. Pedidos "pro:<id>"
-- liberam a mixagem profissional; os demais viram créditos.
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
  else
    perform public.grant_credits(
      v_order.user_id, 'download', 'PURCHASE', v_order.credits_amount,
      'Compra de ' || v_order.credits_amount || ' créditos', 'payment_order', v_order.id::text, p_idempotency_key
    );
  end if;
  return v_order;
end $$;

revoke execute on function public.approve_payment_order(text, text, text, numeric) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Mixagem profissional: arquivos por link; pedidos criados só pelo servidor
-- -----------------------------------------------------------------------------
alter table public.pro_orders add column if not exists files_url text;
alter table public.pro_orders add column if not exists delivery_url text;
alter table public.pro_orders add column if not exists admin_notes text;

-- SEGURANÇA: a policy permitia inserir pedidos já com status "paid".
drop policy if exists "users insert own orders" on public.pro_orders;
drop policy if exists "users insert own stems" on public.pro_stems;

-- Cliente pode trocar o link dos arquivos enquanto o pedido não começou
create or replace function public.update_pro_files(p_order_id uuid, p_files_url text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_files_url !~* '^https://' or length(p_files_url) > 500 then
    raise exception 'INVALID_URL' using errcode = '22023';
  end if;
  update public.pro_orders set files_url = p_files_url, updated_at = now()
  where id = p_order_id and user_id = auth.uid() and status in ('pending_payment', 'paid', 'revision_requested');
end $$;
revoke execute on function public.update_pro_files(uuid, text) from public, anon;
grant execute on function public.update_pro_files(uuid, text) to authenticated;

update public.pro_services
set description = 'Mixagem feita à mão por um engenheiro de áudio. Envie o link das faixas separadas (stems) e receba a música mixada, com 2 revisões inclusas.'
where name = 'Mixagem Profissional';

-- -----------------------------------------------------------------------------
-- "Meu estilo": combinações salvas (preset, ruído, legendas, formato…)
-- -----------------------------------------------------------------------------
create table if not exists public.user_styles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  settings    jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.user_styles enable row level security;
create policy "user_styles: dono" on public.user_styles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- SEGURANÇA: o cliente conseguia enviar mensagem marcada como "do engenheiro".
drop policy if exists "participants send messages" on public.pro_messages;
create policy "participants send messages"
  on public.pro_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      (is_admin = false and exists (select 1 from public.pro_orders o where o.id = order_id and o.user_id = auth.uid()))
      or public.is_admin()
    )
  );

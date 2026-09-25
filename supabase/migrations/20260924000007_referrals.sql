-- =============================================================================
-- Mix Pro — Fase 8: Sistema de Indicações
-- Fluxo: usuário compartilha /r/<code> → novo usuário se cadastra →
--        qualifica se fizer um download pago → +10 para cada lado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela de indicações qualificadas
-- Uma linha = uma indicação que converteu (qualificou).
-- Criada pela função process_referral(), nunca duplicada.
-- -----------------------------------------------------------------------------
create table public.qualified_referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references public.profiles (id) on delete cascade,
  referred_id     uuid not null references public.profiles (id) on delete cascade,
  -- Chave de idempotência para os dois créditos (um por usuário)
  referrer_tx_id  uuid references public.credit_transactions (id),
  referred_tx_id  uuid references public.credit_transactions (id),
  qualified_at    timestamptz not null default now(),
  unique (referrer_id, referred_id)  -- cada par só qualifica uma vez
);

-- -----------------------------------------------------------------------------
-- Função: processa a indicação quando o usuário faz o primeiro download pago.
-- Chamada pelo trigger de credit_transactions (tipo DOWNLOAD, amount < 0).
-- Idempotente: a UNIQUE constraint bloqueia duplicatas.
-- -----------------------------------------------------------------------------
create or replace function public.process_referral()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer   uuid;
  v_reward_ref integer;
  v_reward_new integer;
  v_ref_key    text;
  v_new_key    text;
begin
  -- Só processa o primeiro download real (tipo DOWNLOAD, amount negativo)
  if new.type <> 'DOWNLOAD' or new.amount >= 0 then
    return new;
  end if;

  -- Verifica se usuário foi indicado e se a indicação ainda não qualificou
  select p.referred_by into v_referrer
  from public.profiles p
  where p.id = new.user_id and p.referred_by is not null;

  if not found or v_referrer is null then
    return new;
  end if;

  -- Verifica se já qualificou antes
  if exists (select 1 from public.qualified_referrals where referrer_id = v_referrer and referred_id = new.user_id) then
    return new;
  end if;

  v_reward_ref := coalesce(public.setting_int('referral_reward_referrer'), 10);
  v_reward_new := coalesce(public.setting_int('referral_reward_referred'), 10);

  v_ref_key := 'referral_referrer_' || v_referrer || '_' || new.user_id;
  v_new_key := 'referral_referred_' || v_referrer || '_' || new.user_id;

  -- Concede créditos para quem indicou
  perform public.grant_credits(
    v_referrer, 'download', 'REFERRAL_BONUS', v_reward_ref,
    'Indicação convertida — ' || (select display_name from public.profiles where id = new.user_id),
    'qualified_referral', new.user_id::text, v_ref_key
  );

  -- Concede créditos para o indicado
  perform public.grant_credits(
    new.user_id, 'download', 'REFERRAL_BONUS', v_reward_new,
    'Bônus de indicação — bem-vindo ao Mix Pro!',
    'qualified_referral', v_referrer::text, v_new_key
  );

  -- Registra qualificação
  insert into public.qualified_referrals (referrer_id, referred_id)
  values (v_referrer, new.user_id)
  on conflict do nothing;

  return new;
end $$;

create trigger process_referral_on_download
  after insert on public.credit_transactions
  for each row execute function public.process_referral();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.qualified_referrals enable row level security;
create policy "users see own referrals"
  on public.qualified_referrals for select
  using (referrer_id = auth.uid() or referred_id = auth.uid());
create policy "admin sees all"
  on public.qualified_referrals for select
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Estatísticas de indicação do usuário autenticado
-- -----------------------------------------------------------------------------
create or replace function public.my_referral_stats()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', (select referral_code from public.profiles where id = auth.uid()),
    'total_referred', (select count(*) from public.profiles where referred_by = auth.uid()),
    'qualified', (select count(*) from public.qualified_referrals where referrer_id = auth.uid()),
    'credits_earned', coalesce((
      select sum(ct.amount)
      from public.credit_transactions ct
      where ct.user_id = auth.uid() and ct.type = 'REFERRAL_BONUS' and ct.amount > 0
    ), 0)
  )
$$;

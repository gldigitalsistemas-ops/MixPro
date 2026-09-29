-- =============================================================================
-- Mix Pro — App gratuito com processamento no aparelho do usuário.
-- * Ouvir e testar presets não exige conta; baixar exige login (e-mail).
-- * Créditos grátis renovados todo mês (saldo volta ao mínimo configurado).
-- * 1 crédito por exportação; baixar de novo o mesmo resultado não cobra.
-- * Indicação: +créditos para os dois lados quando o indicado exporta a 1ª vez,
--   com teto mensal por quem indica (evita abuso).
-- =============================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('monthly_free_credits',   '10', 'Créditos grátis por mês (o saldo é completado até este valor no início de cada mês)', true),
  ('referral_max_per_month', '30', 'Máximo de indicações premiadas por mês para quem indica', false)
on conflict (key) do update set value = excluded.value, description = excluded.description, is_public = excluded.is_public;

-- O crédito de boas-vindas passa a vir da renovação mensal.
update public.system_settings set value = '0' where key = 'free_downloads';

-- -----------------------------------------------------------------------------
-- Renovação mensal
-- -----------------------------------------------------------------------------
create table if not exists public.monthly_credit_claims (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  month       date not null,
  granted     integer not null default 0,
  claimed_at  timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.monthly_credit_claims enable row level security;
create policy "monthly_claims: ver os próprios" on public.monthly_credit_claims
  for select using (user_id = auth.uid() or public.is_admin());

create or replace function public.claim_monthly_credits()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_month   date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  v_allow   integer := coalesce(public.setting_int('monthly_free_credits'), 10);
  v_grant   integer := 0;
  v_label   text := to_char(v_month, 'YYYY-MM');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('monthly:' || v_uid::text));

  if not exists (select 1 from public.monthly_credit_claims where user_id = v_uid and month = v_month) then
    v_grant := greatest(0, v_allow - public.credit_balance(v_uid, 'download'));
    if v_grant > 0 then
      perform public.grant_credits(
        v_uid, 'download', 'CAMPAIGN_BONUS', v_grant,
        'Créditos grátis de ' || v_label, 'monthly', v_label, 'monthly:' || v_uid::text || ':' || v_label
      );
    end if;
    insert into public.monthly_credit_claims (user_id, month, granted) values (v_uid, v_month, v_grant);
  end if;

  return jsonb_build_object(
    'balance',           public.credit_balance(v_uid, 'download'),
    'monthly_allowance', v_allow,
    'granted',           v_grant,
    'renews_at',         (v_month + interval '1 month')::date,
    'referral_code',     (select referral_code from public.profiles where id = v_uid),
    'referral_reward',   coalesce(public.setting_int('referral_reward_referrer'), 10)
  );
end $$;

revoke execute on function public.claim_monthly_credits() from public, anon;
grant execute on function public.claim_monthly_credits() to authenticated;

-- -----------------------------------------------------------------------------
-- Débito por exportação (idempotente por p_ref: re-download do mesmo resultado é grátis)
-- -----------------------------------------------------------------------------
create or replace function public.spend_export_credit(p_ref text, p_kind text default 'video')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_ref is null or p_ref !~ '^[a-zA-Z0-9:_-]{8,128}$' or p_kind not in ('video', 'audio') then
    raise exception 'INVALID_REF' using errcode = '22023';
  end if;

  perform public.grant_credits(
    v_uid, 'download', 'DOWNLOAD', -1,
    case p_kind when 'video' then 'Vídeo exportado' else 'Áudio exportado' end,
    'export', p_ref, 'export:' || v_uid::text || ':' || p_ref
  );
  return public.credit_balance(v_uid, 'download');
end $$;

revoke execute on function public.spend_export_credit(text, text) from public, anon;
grant execute on function public.spend_export_credit(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Indicação com teto mensal para quem indica
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
  if new.type <> 'DOWNLOAD' or new.amount >= 0 then
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
      'Um amigo que você indicou usou o Mix Pro', 'qualified_referral', new.user_id::text,
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
-- Presets legíveis sem login (apenas a versão atual de presets ativos)
-- -----------------------------------------------------------------------------
drop policy if exists "preset_versions: autenticados leem" on public.preset_versions;
create policy "preset_versions: atual de presets ativos é pública" on public.preset_versions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.presets p
      where p.current_version_id = preset_versions.id and p.active and p.archived_at is null
    )
  );

-- -----------------------------------------------------------------------------
-- Sub Bass: o passa-baixas do seed (200 Hz) fica abaixo do mínimo do módulo (500 Hz).
-- Versões são imutáveis, então publicamos uma nova.
-- -----------------------------------------------------------------------------
do $$
declare
  v_pid   uuid;
  v_chain jsonb;
  v_vid   uuid;
begin
  select p.id, v.chain into v_pid, v_chain
  from public.presets p join public.preset_versions v on v.id = p.current_version_id
  where p.slug = 'bass-synth-sub';

  if v_chain is not null and (v_chain #>> '{chain,1,params,frequency_hz}')::numeric < 500 then
    insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
    select v_pid, max(version) + 1, jsonb_set(v_chain, '{chain,1,params,frequency_hz}', '500'), 75,
           'Passa-baixas ajustado para 500 Hz (mínimo do módulo)'
    from public.preset_versions where preset_id = v_pid
    returning id into v_vid;
    update public.presets set current_version_id = v_vid where id = v_pid;
  end if;
end $$;

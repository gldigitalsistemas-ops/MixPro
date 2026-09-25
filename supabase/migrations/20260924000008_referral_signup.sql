-- =============================================================================
-- Mix Pro — Fase 8b: Captura do código de indicação no cadastro
-- Atualiza handle_new_user() para ler referral_code de raw_user_meta_data
-- e popular o campo referred_by no perfil do novo usuário.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  free_count    integer := coalesce(public.setting_int('free_downloads'), 0);
  v_referrer_id uuid;
  v_ref_code    text;
begin
  -- Verifica se o usuário se cadastrou via link de indicação
  v_ref_code := new.raw_user_meta_data ->> 'referral_code';
  if v_ref_code is not null then
    select id into v_referrer_id
    from public.profiles
    where referral_code = v_ref_code;
  end if;

  insert into public.profiles (id, display_name, avatar_url, referral_code, referred_by)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    public.generate_referral_code(),
    v_referrer_id  -- null se não veio via indicação ou código inválido
  );

  if free_count > 0 then
    perform public.grant_credits(
      new.id, 'download', 'FREE_SIGNUP', free_count,
      'Boas-vindas ao Mix Pro — ' || free_count || ' downloads grátis',
      'signup', null, 'signup_' || new.id::text
    );
  end if;

  return new;
end $$;

-- Garante que a função só roda via trigger (service_role)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Estatísticas de indicação: apenas usuários autenticados
revoke execute on function public.my_referral_stats() from anon;
grant execute on function public.my_referral_stats() to authenticated;

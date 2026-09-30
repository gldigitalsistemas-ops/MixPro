-- =============================================================================
-- Mix Pro — Kits de bateria (grátis ou premium), microfones de sala, rimshot,
-- caixas gravadas (IR) para o amplificador e presets compartilhados por link.
-- Pode rodar mais de uma vez.
-- =============================================================================

-- Samples: nova peça "rimshot" (caixa com aro) e gravações dos microfones de sala
alter table public.drum_samples drop constraint if exists drum_samples_piece_check;
alter table public.drum_samples add constraint drum_samples_piece_check
  check (piece in ('kick', 'snare', 'tom', 'floor', 'rimshot'));
alter table public.drum_samples add column if not exists room_files text[] not null default '{}';
alter table public.drum_samples drop constraint if exists drum_samples_room_files_check;
alter table public.drum_samples add constraint drum_samples_room_files_check
  check (coalesce(array_length(room_files, 1), 0) <= 12);

-- -----------------------------------------------------------------------------
-- Kits: um conjunto de peças escolhido com um toque. price_credits > 0 = premium
-- (ouvir e testar é livre; para baixar com o kit, o usuário desbloqueia uma vez).
-- -----------------------------------------------------------------------------
create table if not exists public.drum_kits (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 60),
  description    text check (char_length(description) <= 160),
  styles         text[] not null default '{}',
  kick_id        uuid references public.drum_samples (id) on delete set null,
  snare_id       uuid references public.drum_samples (id) on delete set null,
  tom1_id        uuid references public.drum_samples (id) on delete set null,
  tom2_id        uuid references public.drum_samples (id) on delete set null,
  floor_id       uuid references public.drum_samples (id) on delete set null,
  rimshot_id     uuid references public.drum_samples (id) on delete set null,
  price_credits  integer not null default 0 check (price_credits between 0 and 200),
  active         boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.drum_kits enable row level security;
drop policy if exists "drum_kits: todos leem os ativos" on public.drum_kits;
create policy "drum_kits: todos leem os ativos" on public.drum_kits
  for select using (active or public.is_admin());
drop policy if exists "drum_kits: admin gerencia" on public.drum_kits;
create policy "drum_kits: admin gerencia" on public.drum_kits
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.kit_unlocks (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kit_id      uuid not null references public.drum_kits (id) on delete cascade,
  price       integer not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, kit_id)
);
alter table public.kit_unlocks enable row level security;
drop policy if exists "kit_unlocks: dono lê" on public.kit_unlocks;
create policy "kit_unlocks: dono lê" on public.kit_unlocks
  for select using (user_id = auth.uid() or public.is_admin());

alter type public.credit_tx_type add value if not exists 'UNLOCK';

-- Desbloqueia um kit premium com créditos (uma vez só; repetir não cobra de novo)
create or replace function public.unlock_drum_kit(p_kit uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_kit public.drum_kits;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_kit from public.drum_kits where id = p_kit and active;
  if not found then raise exception 'KIT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_kit.price_credits > 0 and not exists (select 1 from public.kit_unlocks where user_id = v_uid and kit_id = p_kit) then
    perform public.grant_credits(
      v_uid, 'download', 'UNLOCK', -v_kit.price_credits,
      'Kit de bateria: ' || v_kit.name, 'drum_kit', p_kit::text, 'unlock:' || v_uid::text || ':' || p_kit::text
    );
    insert into public.kit_unlocks (user_id, kit_id, price) values (v_uid, p_kit, v_kit.price_credits)
    on conflict do nothing;
  end if;
  return public.credit_balance(v_uid, 'download');
end $$;
revoke execute on function public.unlock_drum_kit(uuid) from public, anon;
grant execute on function public.unlock_drum_kit(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Caixas gravadas (IR) para o amplificador. Arquivos no mesmo Storage público
-- ("drum-samples", pasta ir/), enviados pelo admin.
-- -----------------------------------------------------------------------------
create table if not exists public.cab_irs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('guitar', 'bass')),
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (char_length(description) <= 160),
  file         text not null,
  active       boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.cab_irs enable row level security;
drop policy if exists "cab_irs: todos leem os ativos" on public.cab_irs;
create policy "cab_irs: todos leem os ativos" on public.cab_irs
  for select using (active or public.is_admin());
drop policy if exists "cab_irs: admin gerencia" on public.cab_irs;
create policy "cab_irs: admin gerencia" on public.cab_irs
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Preset compartilhado por link (/p/<código>): qualquer pessoa ouve e salva uma cópia.
-- -----------------------------------------------------------------------------
alter table public.user_presets add column if not exists share_code text unique
  check (share_code ~ '^[a-z0-9]{8}$');

create or replace function public.share_user_preset(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select share_code into v_code from public.user_presets where id = p_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_code is null then
    loop
      v_code := substr(md5(gen_random_uuid()::text), 1, 8);
      begin
        update public.user_presets set share_code = v_code where id = p_id;
        exit;
      exception when unique_violation then
        -- código repetido: tenta outro
      end;
    end loop;
  end if;
  return v_code;
end $$;
revoke execute on function public.share_user_preset(uuid) from public, anon;
grant execute on function public.share_user_preset(uuid) to authenticated;

-- Dados públicos do preset compartilhado (sem expor o dono além do código de indicação)
create or replace function public.get_shared_preset(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', up.name,
    'category_id', up.category_id,
    'chain', up.chain,
    'owner_name', coalesce(nullif(split_part(pr.display_name, ' ', 1), ''), 'Um músico'),
    'referral_code', pr.referral_code
  )
  from public.user_presets up
  join public.profiles pr on pr.id = up.user_id
  where up.share_code = lower(p_code)
$$;
revoke execute on function public.get_shared_preset(text) from public;
grant execute on function public.get_shared_preset(text) to anon, authenticated;

-- registro de uso: novos eventos
create or replace function public.track_event(p_event text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('studio_open', 'file_loaded', 'captions_generated', 'export', 'share', 'checkout_start', 'tour_done',
                     'style_saved', 'preset_saved', 'preset_shared', 'shared_preset_opened', 'kit_unlocked', 'batch_export') then
    return;
  end if;
  if pg_column_size(p_props) > 2048 then
    p_props := '{}';
  end if;
  insert into public.analytics_events (user_id, event, props) values (auth.uid(), p_event, coalesce(p_props, '{}'));
end $$;
revoke execute on function public.track_event(text, jsonb) from public;
grant execute on function public.track_event(text, jsonb) to anon, authenticated;

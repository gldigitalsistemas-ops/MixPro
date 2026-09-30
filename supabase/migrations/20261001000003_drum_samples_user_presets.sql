-- =============================================================================
-- Mix Pro — Biblioteca de samples de bateria (admin) e presets do usuário.
--  • drum_samples: cada item é um tambor (ex.: "Bumbo 22 Vintage") com 1 a 12 gravações
--    da mesma peça em forças diferentes (camadas). Arquivos no Storage público
--    "drum-samples" (só o admin envia; o app baixa e processa no aparelho do usuário).
--  • user_presets: presets personalizados salvos na conta do usuário.
-- Pode rodar mais de uma vez.
-- =============================================================================

create table if not exists public.drum_samples (
  id           uuid primary key default gen_random_uuid(),
  piece        text not null check (piece in ('kick', 'snare', 'tom', 'floor')),
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (char_length(description) <= 160),
  -- estilos em que este tambor é o padrão (worship, poprock, reggae, groove, soul, gospel, sertanejo)
  styles       text[] not null default '{}',
  files        text[] not null check (array_length(files, 1) between 1 and 12),
  active       boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists drum_samples_piece_idx on public.drum_samples (piece, position);

alter table public.drum_samples enable row level security;
drop policy if exists "drum_samples: todos leem os ativos" on public.drum_samples;
create policy "drum_samples: todos leem os ativos" on public.drum_samples
  for select using (active or public.is_admin());
drop policy if exists "drum_samples: admin gerencia" on public.drum_samples;
create policy "drum_samples: admin gerencia" on public.drum_samples
  for all using (public.is_admin()) with check (public.is_admin());

-- Storage público (leitura pela URL); envio, troca e exclusão só pelo admin
insert into storage.buckets (id, name, public, file_size_limit)
values ('drum-samples', 'drum-samples', true, 20971520)
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;

drop policy if exists "drum-samples: admin envia" on storage.objects;
create policy "drum-samples: admin envia" on storage.objects
  for insert to authenticated with check (bucket_id = 'drum-samples' and public.is_admin());
drop policy if exists "drum-samples: admin altera" on storage.objects;
create policy "drum-samples: admin altera" on storage.objects
  for update to authenticated using (bucket_id = 'drum-samples' and public.is_admin());
drop policy if exists "drum-samples: admin apaga" on storage.objects;
create policy "drum-samples: admin apaga" on storage.objects
  for delete to authenticated using (bucket_id = 'drum-samples' and public.is_admin());
drop policy if exists "drum-samples: admin lista" on storage.objects;
create policy "drum-samples: admin lista" on storage.objects
  for select to authenticated using (bucket_id = 'drum-samples' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Presets do usuário
-- -----------------------------------------------------------------------------
create table if not exists public.user_presets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 40),
  category_id        text not null references public.preset_categories (id),
  base_preset_id     uuid references public.presets (id) on delete set null,
  chain              jsonb not null check (pg_column_size(chain) < 16000),
  default_intensity  smallint not null default 100 check (default_intensity in (25, 50, 75, 100)),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists user_presets_user_idx on public.user_presets (user_id, created_at);
drop trigger if exists user_presets_touch on public.user_presets;
create trigger user_presets_touch before update on public.user_presets
  for each row execute function public.touch_updated_at();

alter table public.user_presets enable row level security;
drop policy if exists "user_presets: dono" on public.user_presets;
create policy "user_presets: dono" on public.user_presets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "user_presets: admin lê" on public.user_presets;
create policy "user_presets: admin lê" on public.user_presets
  for select using (public.is_admin());

-- no máximo 50 presets por pessoa
create or replace function public.user_presets_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.user_presets where user_id = new.user_id) >= 50 then
    raise exception 'LIMITE_PRESETS' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists user_presets_limit on public.user_presets;
create trigger user_presets_limit before insert on public.user_presets
  for each row execute function public.user_presets_limit();

-- registro de uso: presets personalizados salvos
create or replace function public.track_event(p_event text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('studio_open', 'file_loaded', 'captions_generated', 'export', 'share', 'checkout_start', 'tour_done', 'style_saved', 'preset_saved') then
    return;
  end if;
  if pg_column_size(p_props) > 2048 then
    p_props := '{}';
  end if;
  insert into public.analytics_events (user_id, event, props) values (auth.uid(), p_event, coalesce(p_props, '{}'));
end $$;
revoke execute on function public.track_event(text, jsonb) from public;
grant execute on function public.track_event(text, jsonb) to anon, authenticated;

-- =============================================================================
-- Mix Pro — Criar VS: registra no painel quando alguém separa uma música e baixa as pistas.
-- (A cobrança usa a função de crédito que já existe: 1 crédito por música, referência "vs_…".)
-- Pode rodar mais de uma vez.
-- =============================================================================

create or replace function public.track_event(p_event text, p_props jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('studio_open', 'file_loaded', 'captions_generated', 'export', 'share', 'checkout_start', 'tour_done',
                     'style_saved', 'preset_saved', 'preset_shared', 'shared_preset_opened', 'kit_unlocked', 'batch_export',
                     'vs_separated', 'vs_download') then
    return;
  end if;
  if pg_column_size(p_props) > 2048 then
    p_props := '{}';
  end if;
  insert into public.analytics_events (user_id, event, props) values (auth.uid(), p_event, coalesce(p_props, '{}'));
end $$;
revoke execute on function public.track_event(text, jsonb) from public;
grant execute on function public.track_event(text, jsonb) to anon, authenticated;

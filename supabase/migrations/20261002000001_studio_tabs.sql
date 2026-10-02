-- =============================================================================
-- Mix Pro — Ordem das abas de "Escolha o som" no estúdio.
-- Voz · Instrumentos · Amplificadores · Música pronta (o admin reorganiza em Presets → Ordem no app).
-- Pública: o app lê para montar as abas. Pode rodar mais de uma vez.
-- =============================================================================

insert into public.system_settings (key, value, description, is_public)
values (
  'studio_tabs',
  '["voz", "instrumentos", "amplificadores", "musica"]'::jsonb,
  'Ordem das abas de “Escolha o som” no estúdio.',
  true
)
on conflict (key) do update set is_public = true;

-- ⚠️ SOMENTE PARA TESTE/DESENVOLVIMENTO.
-- Cadeias de RASCUNHO para exercitar o motor de ponta a ponta. NÃO são
-- parâmetros recomendados de mixagem — o proprietário define os reais no admin.
do $$
declare
  p uuid;
  v uuid;
begin
  select id into p from public.presets where slug = 'vocal-presence';
  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
  values (p, 2, '{
    "schema_version": 1,
    "chain": [
      {"type": "highpass", "label": "Remove graves indesejados", "params": {"frequency_hz": 90, "slope_db_oct": "12"}},
      {"type": "eq_peak", "label": "Mais presença", "params": {"frequency_hz": 3500, "gain_db": {"value": 5, "neutral": 0}, "q": 1.0}},
      {"type": "compressor", "label": "Mais controle de dinâmica", "params": {"threshold_db": {"value": -24, "neutral": 0}, "ratio": {"value": 4, "neutral": 1}, "attack_ms": 8, "release_ms": 120, "knee_db": 6, "makeup_db": {"value": 4, "neutral": 0}}},
      {"type": "reverb", "label": "Ambiência leve", "params": {"room_size": 35, "damping": 60, "width": 100, "predelay_ms": 20, "mix": {"value": 12, "neutral": 0}}},
      {"type": "limiter", "label": "Evita picos", "params": {"ceiling_db": -1, "input_gain_db": 0, "release_ms": 60, "lookahead_ms": 5}}
    ]}'::jsonb, 50, 'RASCUNHO DE TESTE (e2e)')
  returning id into v;
  update public.presets set current_version_id = v, active = true where id = p;
end $$;

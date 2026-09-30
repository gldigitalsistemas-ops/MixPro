-- =============================================================================
-- Mix Pro — Bateria de Estúdio: bateria gravada no celular com som de estúdio.
-- O módulo drum_studio identifica bumbo, caixa, tons e surdo e reforça cada batida
-- com samples de bateria real (biblioteca do admin; o usuário escolhe cada peça).
-- Pratos e chimbal ficam como foram gravados. O reverb (Small/Médio/Large + quantidade)
-- é do próprio módulo; o resto da cadeia faz a mixagem característica de cada estilo.
--
-- Pode rodar mais de uma vez: cria o preset ou publica uma versão nova se a cadeia mudou.
-- =============================================================================

insert into public.preset_categories (id, group_id, name, audio_types, icon, position)
values ('drums-estudio', 'drums', 'Bateria de Estúdio', array['drums','mix']::public.audio_type[], 'drums', 0)
on conflict (id) do update set name = excluded.name, position = excluded.position;

create or replace function pg_temp.upsert_preset(
  p_slug text, p_name text, p_category text, p_style text, p_desc text, p_tags text[], p_pos int, p_chain jsonb, p_intensity int
) returns void language plpgsql as $$
declare v_pid uuid; v_vid uuid; v_cur jsonb; v_next int;
begin
  select p.id, v.chain into v_pid, v_cur
  from public.presets p left join public.preset_versions v on v.id = p.current_version_id
  where p.slug = p_slug;
  if v_pid is null then
    insert into public.presets (slug, name, category_id, style, description, tags, active, position)
    values (p_slug, p_name, p_category, p_style, p_desc, p_tags, true, p_pos)
    returning id into v_pid;
  else
    update public.presets set name = p_name, category_id = p_category, style = p_style, description = p_desc,
      tags = p_tags, position = p_pos, active = true, archived_at = null
    where id = v_pid;
    if v_cur = p_chain then return; end if;
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.preset_versions where preset_id = v_pid;
  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
  values (v_pid, v_next, p_chain, p_intensity, case when v_next = 1 then 'Versão inicial' else 'Samples reais, surdo e reverb Small/Médio/Large' end)
  returning id into v_vid;
  update public.presets set current_version_id = v_vid where id = v_pid;
end $$;

select pg_temp.upsert_preset('bateria-worship', 'Worship', 'drums-estudio', 'epic',
  'Bumbo profundo, caixa gorda e uma sala grande e aberta: o som de bateria dos louvores contemporâneos.',
  array['worship','louvor','bateria','igreja'], 1,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"worship","sample_mix":{"value":70,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":1,"snare":0,"toms":1,"floor":1,"reverb_size":"large","reverb":{"value":45,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":60,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":20,"release_ms":150,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-pop-rock', 'Pop Rock', 'drums-estudio', 'punchy',
  'Bumbo com ataque que corta a mix, caixa estalada e um toque de saturação de fita. Energia de banda.',
  array['pop rock','rock','bateria','banda'], 2,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"poprock","sample_mix":{"value":75,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":1,"snare":1,"toms":0,"floor":0,"reverb_size":"medium","reverb":{"value":25,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":500,"gain_db":{"value":-3,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":2,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":4,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":4,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-reggae', 'Reggae', 'drums-estudio', 'vintage',
  'Bumbo redondo e macio, caixa aguda e seca (quase um timbal) e um eco sutil. Balanço de reggae.',
  array['reggae','roots','bateria'], 3,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"reggae","sample_mix":{"value":70,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":0,"snare":1,"toms":0,"floor":0,"reverb_size":"small","reverb":{"value":12,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":1.5,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":25,"release_ms":200,"knee_db":8,"makeup_db":{"value":1.5,"neutral":0}}},
    {"type":"delay","params":{"time_ms":250,"feedback":25,"lowpass_hz":4000,"mix":{"value":6,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-groove', 'Groove / Funk', 'drums-estudio', 'punchy',
  'Seca, curta e com punch: bumbo rápido e caixa estalada que fazem o groove "empurrar". Para funk, black e pop.',
  array['groove','funk','black','bateria'], 4,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"groove","sample_mix":{"value":65,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":1,"snare":1.5,"toms":0,"floor":0,"reverb_size":"small","reverb":{"value":10,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":350,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":2,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":5,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":3,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-soul', 'Soul / R&B', 'drums-estudio', 'warm',
  'Som vintage e quente: bumbo sem clique, caixa grave e escura, saturação de fita e pratos suaves.',
  array['soul','r&b','vintage','bateria'], 5,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"soul","sample_mix":{"value":60,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":0,"snare":0,"toms":0,"floor":0,"reverb_size":"medium","reverb":{"value":20,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"lowpass","params":{"frequency_hz":11000,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":1.5,"neutral":0},"q":1}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":6,"neutral":0},"mix":{"value":35,"neutral":0},"output_db":0}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":15,"release_ms":150,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-gospel', 'Gospel', 'drums-estudio', 'powerful',
  'Energia alta: bumbo com punch, caixa aguda e estalada, compressão firme e brilho. Para gospel e louvor animado.',
  array['gospel','louvor','bateria'], 6,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"gospel","sample_mix":{"value":75,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":1,"snare":1.5,"toms":0,"floor":0,"reverb_size":"medium","reverb":{"value":25,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":450,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":9000,"gain_db":{"value":2.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":8,"release_ms":90,"knee_db":3,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":3,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-0.8,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('bateria-sertanejo', 'Sertanejo', 'drums-estudio', 'bright',
  'Bateria de pop sertanejo de estúdio: bumbo definido, caixa com corpo e uma sala curta e brilhante.',
  array['sertanejo','pop','bateria'], 7,
  '{"schema_version":1,"chain":[
    {"type":"drum_studio","params":{"kit":"sertanejo","sample_mix":{"value":70,"neutral":0},"kick_sample":"","snare_sample":"","tom1_sample":"","tom2_sample":"","floor_sample":"","kick":1,"snare":0.5,"toms":0,"floor":0,"reverb_size":"medium","reverb":{"value":20,"neutral":0}}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2.5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":3500,"gain_db":{"value":1.5,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-19,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":12,"release_ms":110,"knee_db":4,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

-- =============================================================================
-- Mix Pro — Presets para criadores de conteúdo (voz falada em vídeos)
-- Situações reais: celular, carro, quarto sem tratamento, live, ASMR, locução.
-- =============================================================================

insert into public.preset_categories (id, group_id, name, audio_types, icon, position)
values ('vocal-criador', 'vocal', 'Criadores de conteúdo', array['vocal']::public.audio_type[], 'video', 0)
on conflict (id) do update set name = excluded.name, position = excluded.position;

create or replace function pg_temp.seed_preset(
  p_slug text, p_name text, p_style text, p_desc text, p_tags text[], p_pos int, p_chain jsonb, p_intensity int
) returns void language plpgsql as $$
declare v_pid uuid; v_vid uuid;
begin
  if exists (select 1 from public.presets where slug = p_slug) then return; end if;
  insert into public.presets (slug, name, category_id, style, description, tags, active, position)
  values (p_slug, p_name, 'vocal-criador', p_style, p_desc, p_tags, true, p_pos)
  returning id into v_pid;
  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
  values (v_pid, 1, p_chain, p_intensity, 'Versão inicial')
  returning id into v_vid;
  update public.presets set current_version_id = v_vid where id = v_pid;
end $$;

select pg_temp.seed_preset('criador-youtuber', 'Voz de YouTuber', 'bright',
  'Voz presente, clara e animada, como nos grandes canais. Tira o som abafado, dá brilho e deixa o volume constante.',
  array['youtube','vlog','criador','voz'], 1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":90,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-50,"neutral":-90},"range_db":{"value":15,"neutral":0},"ratio":3,"attack_ms":1,"hold_ms":40,"release_ms":150}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-3,"neutral":0},"q":1.1}},
    {"type":"eq_peak","params":{"frequency_hz":3500,"gain_db":{"value":3,"neutral":0},"q":1.2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":6,"release_ms":90,"knee_db":5,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":3,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-celular', 'Voz Gravada no Celular', 'warm',
  'Corrige o som fino e metálico do microfone do celular: devolve o corpo da voz e suaviza a aspereza.',
  array['celular','smartphone','reels','tiktok'], 2,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"18"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":180,"gain_db":{"value":2.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":450,"gain_db":{"value":-3,"neutral":0},"q":1.3}},
    {"type":"eq_peak","params":{"frequency_hz":2600,"gain_db":{"value":-2.5,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":2,"neutral":0},"q":1.2}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":110,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-carro', 'Voz no Carro', 'clean',
  'Para vídeos gravados dentro do carro: tira o grave "embolado" da cabine e deixa a fala bem clara.',
  array['carro','cabine','vlog'], 3,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":120,"slope_db_oct":"24"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-5,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":550,"gain_db":{"value":-3,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":3,"neutral":0},"q":1.2}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":5,"release_ms":90,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-asmr', 'ASMR / Sussurro', 'intimate',
  'Realça os detalhes da voz baixinha e dos sons delicados, sem ficar agressivo. Ideal para ASMR e vídeos relaxantes.',
  array['asmr','sussurro','relaxante'], 4,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":150,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-32,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":250,"knee_db":10,"makeup_db":{"value":8,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":100,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-live', 'Live / Stream', 'punchy',
  'Voz firme e sempre no mesmo volume, mesmo quando você se afasta do microfone ou fala mais alto.',
  array['live','stream','gameplay'], 5,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-45,"neutral":-90},"range_db":{"value":20,"neutral":0},"ratio":4,"attack_ms":1,"hold_ms":30,"release_ms":120}},
    {"type":"eq_peak","params":{"frequency_hz":350,"gain_db":{"value":-2.5,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2.5,"neutral":0},"q":1.3}},
    {"type":"compressor","params":{"threshold_db":{"value":-26,"neutral":0},"ratio":{"value":5,"neutral":1},"attack_ms":3,"release_ms":70,"knee_db":4,"makeup_db":{"value":7,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-locutor', 'Locutor de Rádio', 'deep',
  'Voz grave, encorpada e "na cara", como locução de rádio e comerciais.',
  array['locução','rádio','comercial','narração'], 6,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":70,"slope_db_oct":"18"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":120,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":350,"gain_db":{"value":-3,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":2,"neutral":0},"q":1.2}},
    {"type":"compressor","params":{"threshold_db":{"value":-26,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":4,"release_ms":80,"knee_db":3,"makeup_db":{"value":8,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":5,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.seed_preset('criador-documentario', 'Narração de Documentário', 'natural',
  'Voz calma, natural e envolvente, com uma leve ambiência. Para narração, storytelling e vídeos explicativos.',
  array['narração','documentário','storytelling'], 7,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":70,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":200,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":9000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":12,"release_ms":180,"knee_db":8,"makeup_db":{"value":2.5,"neutral":0}}},
    {"type":"reverb","params":{"room_size":20,"damping":65,"width":70,"predelay_ms":15,"mix":{"value":7,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":80,"lookahead_ms":5}}
  ]}'::jsonb, 75);

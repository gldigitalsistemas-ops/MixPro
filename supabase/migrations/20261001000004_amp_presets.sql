-- =============================================================================
-- Mix Pro — Guitarra e baixo com amplificador.
-- Para instrumento ligado direto (interface, pedaleira em linha, cabo no celular):
-- o amplificador vem primeiro na cadeia, depois equalização, compressão e ambiência.
-- O usuário pode trocar o amplificador e mexer em tudo em "Personalizar".
-- Pode rodar mais de uma vez.
-- =============================================================================

insert into public.preset_categories (id, group_id, name, audio_types, icon, position) values
  ('guitar-amp', 'guitar', 'Guitarra com Amplificador', array['guitar']::public.audio_type[], 'guitar', 0),
  ('bass-amp',   'bass',   'Baixo com Amplificador',    array['bass']::public.audio_type[],   'bass',   0)
on conflict (id) do update set name = excluded.name, group_id = excluded.group_id, position = excluded.position;

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
  values (v_pid, v_next, p_chain, p_intensity, case when v_next = 1 then 'Versão inicial' else 'Atualização' end)
  returning id into v_vid;
  update public.presets set current_version_id = v_vid where id = v_pid;
end $$;

-- ------------------------------------------------------------------ guitarra
select pg_temp.upsert_preset('guitarra-amp-worship', 'Worship Ambiente', 'guitar-amp', 'wide',
  'Limpo com brilho, delay pontilhado e reverb grande: a guitarra ambiente dos louvores.',
  array['guitarra','worship','louvor','ambiente','delay'], 1,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"clean_us","gain":{"value":3.5,"neutral":0},"bass":4.5,"mid":5,"treble":6.5,"presence":6,"cabinet":"2x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":15,"release_ms":150,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"delay","params":{"time_ms":380,"feedback":35,"lowpass_hz":3500,"mix":{"value":16,"neutral":0}}},
    {"type":"reverb","params":{"room_size":85,"damping":40,"width":100,"predelay_ms":20,"mix":{"value":20,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-amp-funk', 'Funk Limpo', 'guitar-amp', 'clean',
  'Limpo, estalado e comprimido: palhetada de funk e black music que corta a mix.',
  array['guitarra','funk','black','limpo'], 2,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"jazz_clean","gain":{"value":4,"neutral":0},"bass":4,"mid":4.5,"treble":7,"presence":6.5,"cabinet":"2x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":110,"slope_db_oct":"12"}},
    {"type":"compressor","params":{"threshold_db":{"value":-24,"neutral":0},"ratio":{"value":5,"neutral":1},"attack_ms":3,"release_ms":80,"knee_db":3,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2,"neutral":0},"q":1}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-amp-blues', 'Crunch Blues', 'guitar-amp', 'warm',
  'Válvula quebrando de leve: responde à palhetada, limpa quando você toca leve.',
  array['guitarra','blues','crunch','valvula'], 3,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"crunch_uk","gain":{"value":5,"neutral":0},"bass":5,"mid":6,"treble":5.5,"presence":5,"cabinet":"2x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":90,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":20,"release_ms":150,"knee_db":6,"makeup_db":{"value":1.5,"neutral":0}}},
    {"type":"reverb","params":{"room_size":55,"damping":50,"width":100,"predelay_ms":12,"mix":{"value":12,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-amp-rock', 'Rock Clássico', 'guitar-amp', 'aggressive',
  'Drive encorpado de válvula em caixa 4x12, médios na cara: riffs e bases de rock.',
  array['guitarra','rock','drive','4x12'], 4,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"rock_classic","gain":{"value":6,"neutral":0},"bass":5,"mid":7,"treble":6,"presence":5.5,"cabinet":"4x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":90,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1800,"gain_db":{"value":1.5,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":15,"release_ms":120,"knee_db":4,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"reverb","params":{"room_size":40,"damping":55,"width":100,"predelay_ms":8,"mix":{"value":8,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-amp-metal', 'Metal Moderno', 'guitar-amp', 'heavy',
  'Hi-gain apertado com noise gate antes do amp: peso, definição e silêncio entre os riffs.',
  array['guitarra','metal','hi-gain','djent'], 5,
  '{"schema_version":1,"chain":[
    {"type":"gate","params":{"threshold_db":{"value":-55,"neutral":-90},"range_db":{"value":40,"neutral":0},"ratio":10,"attack_ms":0.5,"hold_ms":20,"release_ms":60}},
    {"type":"amp","params":{"model":"hi_gain","gain":{"value":7,"neutral":0},"bass":6,"mid":4,"treble":6,"presence":6,"cabinet":"4x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"18"}},
    {"type":"lowpass","params":{"frequency_hz":9500,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-3,"neutral":0},"q":1.2}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":3,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-amp-pop', 'Pop / Sertanejo', 'guitar-amp', 'bright',
  'Limpo quase quebrando, com compressão e um slapback curto: base de pop e sertanejo.',
  array['guitarra','pop','sertanejo','limpo'], 6,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"clean_us","gain":{"value":4.5,"neutral":0},"bass":5,"mid":5.5,"treble":6,"presence":5.5,"cabinet":"1x12","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"12"}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3.5,"neutral":1},"attack_ms":10,"release_ms":120,"knee_db":4,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"delay","params":{"time_ms":300,"feedback":20,"lowpass_hz":4000,"mix":{"value":8,"neutral":0}}},
    {"type":"reverb","params":{"room_size":60,"damping":50,"width":100,"predelay_ms":12,"mix":{"value":12,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

-- ------------------------------------------------------------------ baixo
select pg_temp.upsert_preset('baixo-amp-valvulado', 'Valvulado Vintage', 'bass-amp', 'warm',
  'Grave gordo e quente de amplificador valvulado em caixa 8x10, com compressão que segura as notas.',
  array['baixo','valvulado','vintage','rock'], 1,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"bass_vintage","gain":{"value":4,"neutral":0},"bass":6,"mid":5,"treble":4,"presence":4,"cabinet":"8x10b","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":20,"release_ms":150,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-amp-moderno', 'Moderno com Drive', 'bass-amp', 'aggressive',
  'Grave limpo e firme com drive só nos médios agudos: o som de baixo moderno de rock e gospel.',
  array['baixo','moderno','drive','gospel'], 2,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"bass_modern","gain":{"value":5,"neutral":0},"bass":6,"mid":4,"treble":6,"presence":6,"cabinet":"4x10b","blend":{"value":80,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":4,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-amp-slap', 'Slap / Funk', 'bass-amp', 'punchy',
  'Limpo e brilhante, médios cavados e compressão rápida: o estalo do slap aparece sem machucar.',
  array['baixo','slap','funk','groove'], 3,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"bass_clean","gain":{"value":3,"neutral":0},"bass":6,"mid":3.5,"treble":7,"presence":6.5,"cabinet":"4x10b","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":35,"slope_db_oct":"12"}},
    {"type":"compressor","params":{"threshold_db":{"value":-24,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":2,"release_ms":80,"knee_db":3,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-amp-worship', 'Worship / Pop', 'bass-amp', 'deep',
  'Redondo e profundo, sem agudo sobrando: sustenta a banda sem brigar com o bumbo e a voz.',
  array['baixo','worship','louvor','pop'], 4,
  '{"schema_version":1,"chain":[
    {"type":"amp","params":{"model":"bass_clean","gain":{"value":2,"neutral":0},"bass":6.5,"mid":5,"treble":4,"presence":4,"cabinet":"8x10b","blend":{"value":100,"neutral":0},"level_db":0}},
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"lowpass","params":{"frequency_hz":6000,"slope_db_oct":"12"}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":15,"release_ms":150,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}'::jsonb, 75);

-- =============================================================================
-- Mix Pro — Seed: categorias e presets de áudio profissionais
-- Baseado em padrões da indústria (SSL, API, Neve, UAD, iZotope Ozone).
-- =============================================================================

-- 1. Categorias
INSERT INTO public.preset_categories (id, group_id, name, audio_types, icon, position)
VALUES
  ('vocal-pop',        'vocal',   'Vocal Pop',          ARRAY['vocal']::public.audio_type[],                 'mic',     1),
  ('vocal-rock',       'vocal',   'Vocal Rock',         ARRAY['vocal']::public.audio_type[],                 'guitar',  2),
  ('vocal-rap',        'vocal',   'Vocal Rap/Hip-Hop',  ARRAY['vocal']::public.audio_type[],                 'mic-2',   3),
  ('vocal-gospel',     'vocal',   'Vocal Gospel',       ARRAY['vocal']::public.audio_type[],                 'music',   4),
  ('vocal-podcast',    'vocal',   'Podcast/Narração',   ARRAY['vocal']::public.audio_type[],                 'radio',   5),
  ('drums-acoustic',   'drums',   'Bateria Acústica',   ARRAY['drums']::public.audio_type[],                 'drums',   1),
  ('drums-electronic', 'drums',   'Bateria Eletrônica', ARRAY['drums']::public.audio_type[],                 'zap',     2),
  ('bass-electric',    'bass',    'Baixo Elétrico',     ARRAY['bass']::public.audio_type[],                  'bass',    1),
  ('bass-synth',       'bass',    'Baixo Sintetizador', ARRAY['bass']::public.audio_type[],                  'cpu',     2),
  ('guitar-electric',  'guitar',  'Guitarra Elétrica',  ARRAY['guitar']::public.audio_type[],                'guitar',  1),
  ('guitar-acoustic',  'acoustic','Violão/Acústico',    ARRAY['acoustic','guitar']::public.audio_type[],     'music',   1),
  ('piano-keys',       'piano',   'Piano/Teclado',      ARRAY['piano']::public.audio_type[],                 'piano',   1),
  ('master-main',      'master',  'Masterização',       ARRAY['mix','master']::public.audio_type[],          'sliders', 1);

-- =============================================================================
-- 2. Presets — VOCAL POP
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-pop-limpo','Vocal Pop Limpo','vocal-pop','clean','Cadeia clássica para vocal pop limpo. Gate, EQ suave com presence boost em 3 kHz, compressão transparente e limiter final.',ARRAY['pop','clean','transparente','natural'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"gate","params":{"threshold_db":{"value":-50,"neutral":-90},"range_db":{"value":30,"neutral":0},"ratio":4,"attack_ms":1,"hold_ms":20,"release_ms":100}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":200,"gain_db":{"value":-2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":120,"knee_db":6,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-pop-brilhante','Vocal Pop Brilhante','vocal-pop','bright','Vocal pop moderno com ar e brilho. Corte de lama em 250 Hz, presence boost agressivo em 3,5 kHz e shelf de ar em 12 kHz. Ideal para pop contemporâneo.',ARRAY['pop','bright','brilhante','moderno','ar'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"12"}},
    {"type":"gate","params":{"threshold_db":{"value":-48,"neutral":-90},"range_db":{"value":28,"neutral":0},"ratio":4,"attack_ms":1,"hold_ms":15,"release_ms":80}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-3,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":1200,"gain_db":{"value":-1.5,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":3500,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":12000,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":4,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":3,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-pop-intimo','Vocal Pop Íntimo','vocal-pop','warm','Vocal intimista e aconchegante. Compressão suave que preserva dinâmica, saturação de fita leve e reverb ambiente discreto. Perfeito para ballads e R&B.',ARRAY['pop','warm','intimo','ballad','rnb'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":300,"gain_db":{"value":-1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":600,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":1.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":15,"release_ms":200,"knee_db":8,"makeup_db":{"value":1.5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":2,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":25,"damping":60,"width":80,"predelay_ms":20,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":80,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-pop-trap-moderno','Vocal Pop Trap','vocal-pop','punchy','Vocal pop/trap moderno. Compressão agressiva com parallel saturation, ar extremo no topo e delay sutil para profundidade.',ARRAY['pop','trap','moderno','pesado','urbano'],true,4)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":120,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-45,"neutral":-90},"range_db":{"value":25,"neutral":0},"ratio":5,"attack_ms":1,"hold_ms":10,"release_ms":60}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":-2,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":14000,"gain_db":{"value":5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-24,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":3,"release_ms":60,"knee_db":3,"makeup_db":{"value":6,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":6,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"delay","params":{"time_ms":125,"feedback":20,"lowpass_hz":6000,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-pop-anthemic','Vocal Pop Anthêmico','vocal-pop','epic','Vocal épico para refrões anthemicos. Reverb generoso, delay espaçado e saturação que engrandece. Para hooks memoráveis.',ARRAY['pop','anthemic','refrão','epico','reverb'],true,5)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":4,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":65,"damping":40,"width":100,"predelay_ms":30,"mix":{"value":20,"neutral":0}}},
    {"type":"delay","params":{"time_ms":250,"feedback":30,"lowpass_hz":5000,"mix":{"value":15,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 3. Presets — VOCAL ROCK
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rock-gritante','Vocal Rock Gritante','vocal-rock','gritty','Vocal rock agressivo com saturação de válvula. Corte de lama, presence pronunciado em 3 kHz e compressão musculosa. Corta no mix.',ARRAY['rock','gritty','agressivo','guitarras','presence'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-48,"neutral":-90},"range_db":{"value":30,"neutral":0},"ratio":5,"attack_ms":1,"hold_ms":20,"release_ms":80}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":4,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":8,"neutral":0},"mix":{"value":35,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rock-classico','Vocal Rock Clássico','vocal-rock','warm','Vocal rock clássico dos anos 70-90. Corpo na região de graves, presence equilibrado, saturação de fita e reverb de sala.',ARRAY['rock','classico','vintage','warm','anos70'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":150,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":500,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2500,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":12,"release_ms":150,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":5,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":40,"damping":50,"width":80,"predelay_ms":15,"mix":{"value":12,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rock-metal','Vocal Metal/Screamo','vocal-rock','heavy','Vocal pesado para metal e screamo. HP alto, remoção total de lama, compressão extrema e saturação hard para distorção intencional.',ARRAY['metal','screamo','pesado','distortion','hard'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":150,"slope_db_oct":"18"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1500,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-25,"neutral":0},"ratio":{"value":8,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":2,"makeup_db":{"value":8,"neutral":0}}},
    {"type":"saturation","params":{"mode":"hard","drive_db":{"value":12,"neutral":0},"mix":{"value":40,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 4. Presets — VOCAL RAP/HIP-HOP
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rap-trap','Vocal Trap Moderno','vocal-rap','punchy','Vocal trap moderno: HP agressivo, remoção pesada de grave, compressão hard, saturação de válvula e delay em colcheia.',ARRAY['trap','rap','moderno','hip-hop','urbano'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":120,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-45,"neutral":-90},"range_db":{"value":25,"neutral":0},"ratio":5,"attack_ms":1,"hold_ms":10,"release_ms":60}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":600,"gain_db":{"value":-2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":12000,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-24,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":3,"release_ms":60,"knee_db":3,"makeup_db":{"value":7,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":4,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"delay","params":{"time_ms":125,"feedback":20,"lowpass_hz":8000,"mix":{"value":8,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":25,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rap-old-school','Vocal Hip-Hop Old School','vocal-rap','warm','Vocal hip-hop clássico anos 90. Calor analógico, compressão generosa, saturação de fita e reverb discreto de sala.',ARRAY['hip-hop','old-school','anos90','classico','warm'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":200,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":500,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":10,"release_ms":120,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":6,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":20,"damping":70,"width":60,"predelay_ms":10,"mix":{"value":8,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rap-drill','Vocal Drill/UK','vocal-rap','dark','Vocal para UK Drill e Chicago Drill. Tom escuro, HP alto, compressão musculosa com gate, delay em colcheia para energia.',ARRAY['drill','uk-drill','dark','chicago','urbano'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":140,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-45,"neutral":-90},"range_db":{"value":25,"neutral":0},"ratio":5,"attack_ms":1,"hold_ms":10,"release_ms":80}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":800,"gain_db":{"value":-2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":3500,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":5,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":4,"makeup_db":{"value":6,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":5,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"delay","params":{"time_ms":180,"feedback":30,"lowpass_hz":6000,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-rap-afrobeats','Vocal Afrobeats','vocal-rap','warm','Vocal para Afrobeats e Afro-pop. Tom caloroso, graves suaves, compressão gentil e reverb curto para groovear.',ARRAY['afrobeats','afro','groove','warm','dancehall'],true,4)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":250,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":600,"gain_db":{"value":-1.5,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2500,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":12,"release_ms":150,"knee_db":8,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":3,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":30,"damping":50,"width":70,"predelay_ms":15,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 5. Presets — VOCAL GOSPEL
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-gospel-power','Vocal Gospel Power','vocal-gospel','powerful','Vocal solista gospel com impacto e brilho. Corpo generoso nos graves médios, presence pronunciado, saturação de válvula e reverb de catedral.',ARRAY['gospel','power','solista','cathedral','spiritual'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":150,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1500,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":150,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":4,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":55,"damping":35,"width":100,"predelay_ms":25,"mix":{"value":18,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('vocal-gospel-coro','Coro Gospel','vocal-gospel','wide','Coro gospel com dimensão e espiritualidade. Largura estéreo ampliada, reverb longo e compressão suave para homogeneidade.',ARRAY['gospel','coro','coral','choir','wide','espiritual'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":15,"release_ms":200,"knee_db":8,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":140,"neutral":100},"bass_mono_hz":120}},
    {"type":"reverb","params":{"room_size":70,"damping":30,"width":100,"predelay_ms":20,"mix":{"value":25,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":80,"lookahead_ms":5}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 6. Presets — PODCAST/NARRAÇÃO
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('podcast-broadcast','Podcast Broadcast','vocal-podcast','clean','Voz de podcast com qualidade de rádio. Gate eficiente, corte de proximidade, compressão de broadcast e normalização LUFS para plataformas.',ARRAY['podcast','broadcast','radio','narração','voz'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"18"}},
    {"type":"gate","params":{"threshold_db":{"value":-45,"neutral":-90},"range_db":{"value":35,"neutral":0},"ratio":5,"attack_ms":1,"hold_ms":30,"release_ms":150}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-16}}
  ]}',75,'Versão inicial — target LUFS -16 dB (padrão Spotify Podcasts)') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('podcast-warmth','Podcast Aconchegante','vocal-podcast','warm','Voz quente e envolvente para storytelling e audiobooks. Graves suaves, compressão gentil, saturação leve e normalização de streaming.',ARRAY['podcast','warm','storytelling','audiobook','voz'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"gate","params":{"threshold_db":{"value":-50,"neutral":-90},"range_db":{"value":30,"neutral":0},"ratio":4,"attack_ms":2,"hold_ms":20,"release_ms":120}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":250,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-1.5,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":1.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":6000,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":2,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-16}}
  ]}',75,'Versão inicial — target LUFS -16 dB') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 7. Presets — BATERIA ACÚSTICA
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-acoustic-punch','Bateria Acústica Punch','drums-acoustic','punchy','Bateria acústica com punch e ataque. Realce de kick em 80 Hz, remoção de lama em 200 Hz, crack de caixa em 3 kHz.',ARRAY['drums','punch','kick','snare','rock'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":40,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":5,"release_ms":60,"knee_db":4,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-acoustic-rock','Bateria Rock','drums-acoustic','aggressive','Bateria de rock agressiva. Graves musculosos, total remoção de lama, saturação de fita para caráter analógico.',ARRAY['drums','rock','aggressive','snare','classic'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":50,"slope_db_oct":"18"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":100,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":8,"release_ms":80,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":4,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-acoustic-jazz','Bateria Jazz','drums-acoustic','natural','Bateria de jazz natural e dinâmica. Processamento mínimo, compressão suave tipo "bus glue", preservando transientes e dinâmica ao vivo.',ARRAY['drums','jazz','natural','dinamic','live'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":40,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":100,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":200,"knee_db":10,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"normalize","params":{"mode":"peak","target_db":-6}}
  ]}',50,'Versão inicial — processamento mínimo para som natural') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-acoustic-hiphop','Bateria Hip-Hop Sample','drums-acoustic','vintage','Bateria sampleada estilo hip-hop clássico. Compressão extrema tipo New York, saturação de vinil e vintage feel.',ARRAY['drums','hip-hop','sample','vintage','vinyl'],true,4)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":100,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":-2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":-2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-22,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":3,"makeup_db":{"value":7,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":8,"neutral":0},"mix":{"value":40,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 8. Presets — BATERIA ELETRÔNICA
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-electronic-edm','Bateria EDM','drums-electronic','massive','Kick de EDM com impacto massivo. Sub profundo, click de kick, remoção total de lama e hi-hats brilhantes.',ARRAY['edm','electronic','kick','drop','rave'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":60,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":120,"gain_db":{"value":2,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":3,"release_ms":50,"knee_db":3,"makeup_db":{"value":8,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":20,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-electronic-trap','Bateria Trap 808','drums-electronic','sub-heavy','Bateria trap com 808 dominante. Sub extremo, remoção de médios, hi-hats cristalinos e saturação de válvula leve.',ARRAY['trap','808','sub','electronic','hip-hop'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":50,"gain_db":{"value":5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":100,"gain_db":{"value":3,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":4,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":12000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":8,"neutral":1},"attack_ms":2,"release_ms":40,"knee_db":2,"makeup_db":{"value":9,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":3,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-0.3,"input_gain_db":{"value":0,"neutral":0},"release_ms":15,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('drums-electronic-house','Bateria House/Disco','drums-electronic','groovy','Bateria house com groove analógico. Tom quente, compressão musical e saturação de fita que evoca os clássicos do disco.',ARRAY['house','disco','groove','electronic','4x4'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":40,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":5,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 9. Presets — BAIXO ELÉTRICO
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-electric-funk','Baixo Funk/Slap','bass-electric','punchy','Baixo para funk e slap. Sub firme, nasal de pick realçado, ataque de slap em 2 kHz e compressão que controla os transientes.',ARRAY['bass','funk','slap','groove','punch'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":40,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":700,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":5000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":5,"release_ms":80,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-electric-rock','Baixo Rock','bass-electric','gritty','Baixo de rock com grit e definição. Punch nos graves, ataque de palheta realçado e saturação de válvula para cortar no mix.',ARRAY['bass','rock','gritty','pick','definition'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":50,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":100,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":4000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":5,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-electric-jazz','Baixo Jazz/Upright','bass-electric','warm','Baixo jazz com som redondo e quente. Redutor de graves médios, corte de ataque de corda agudo para emular upright bass.',ARRAY['bass','jazz','upright','warm','round'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":120,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-1,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":6000,"gain_db":{"value":-4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":15,"release_ms":200,"knee_db":10,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":2,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}}
  ]}',50,'Versão inicial — compressão leve para preservar dinâmica do jazz') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 10. Presets — BAIXO SINTETIZADOR
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-synth-sub','Sub Bass','bass-synth','deep','Sub bass profundo para música eletrônica. Preserva o fundamental, passa por soft clipper para controle e limita com cuidado.',ARRAY['bass','sub','electronic','deep','808'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"24"}},
    {"type":"lowpass","params":{"frequency_hz":200,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":60,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":80,"gain_db":{"value":2,"neutral":0},"q":2}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":3,"release_ms":50,"knee_db":3,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"soft_clip","params":{"ceiling_db":-0.3,"input_gain_db":{"value":0,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-0.5,"input_gain_db":{"value":0,"neutral":0},"release_ms":20,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-synth-wobble','Bass Wobble/Dubstep','bass-synth','aggressive','Wobble bass para dubstep e bass music. Caráter em 800 Hz realçado, saturação hard para grit e compressão agressiva.',ARRAY['bass','wobble','dubstep','aggressive','bass-music'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":800,"gain_db":{"value":4,"neutral":0},"q":2}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":5000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":5,"neutral":1},"attack_ms":5,"release_ms":60,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"hard","drive_db":{"value":6,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":25,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('bass-synth-analog','Baixo Analógico Moog','bass-synth','warm','Baixo analógico estilo Moog/ARP. Calor nos graves, corpo pronunciado, saturação de fita e compressão musical.',ARRAY['bass','analog','moog','warm','vintage'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":40,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":100,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":4,"neutral":0},"mix":{"value":25,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 11. Presets — GUITARRA ELÉTRICA
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-electric-rock','Guitarra Rock','guitar-electric','aggressive','Guitarra de rock clássica. Corte de lama, presence pronunciado e saturação de fita para caráter analógico.',ARRAY['guitar','rock','electric','aggressive','presence'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"18"}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":5,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-electric-blues','Guitarra Blues','guitar-electric','warm','Guitarra blues expressiva e dinâmica. Corpo nos graves-médios, presence equilibrado, saturação de válvula e reverb de sala.',ARRAY['guitar','blues','warm','expression','tube'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":150,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":500,"gain_db":{"value":-1.5,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":6000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":15,"release_ms":200,"knee_db":8,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tube","drive_db":{"value":6,"neutral":0},"mix":{"value":30,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":30,"damping":50,"width":70,"predelay_ms":10,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-electric-metal','Guitarra Metal','guitar-electric','heavy','Guitarra pesada para metal moderno. HP alto com LP para apertar frequências, remoção cirúrgica de lama e médios, compressão extrema.',ARRAY['guitar','metal','heavy','djent','modern'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":120,"slope_db_oct":"24"}},
    {"type":"lowpass","params":{"frequency_hz":8000,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":800,"gain_db":{"value":-3,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":4,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":5000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"compressor","params":{"threshold_db":{"value":-24,"neutral":0},"ratio":{"value":6,"neutral":1},"attack_ms":5,"release_ms":60,"knee_db":3,"makeup_db":{"value":8,"neutral":0}}},
    {"type":"saturation","params":{"mode":"hard","drive_db":{"value":10,"neutral":0},"mix":{"value":40,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":30,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-electric-clean','Guitarra Limpa','guitar-electric','clean','Guitarra elétrica limpa para funk, pop e jazz. Ataque de palheta cristalino, compressão gentil e brilho no topo.',ARRAY['guitar','clean','funk','pop','sparkle'],true,4)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":5,"release_ms":100,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 12. Presets — VIOLÃO/ACÚSTICO
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-acoustic-folk','Violão Folk/Pop','guitar-acoustic','natural','Violão acústico natural com corpo e brilho. Redução de encaixotamento, presence suave e ar no topo para som vivo.',ARRAY['acoustic','folk','pop','natural','ar'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":200,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":12,"release_ms":150,"knee_db":8,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"normalize","params":{"mode":"peak","target_db":-6}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-acoustic-fingerpicking','Violão Fingerpicking','guitar-acoustic','detailed','Fingerpicking detalhado e delicado. Compressão suave preservando dinâmica das notas, reverb curto de sala.',ARRAY['acoustic','fingerpicking','detailed','classical','intimate'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1000,"gain_db":{"value":-1,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":300,"knee_db":10,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"reverb","params":{"room_size":20,"damping":60,"width":70,"predelay_ms":10,"mix":{"value":8,"neutral":0}}}
  ]}',50,'Versão inicial — compressão leve') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('guitar-acoustic-strumming','Violão Strumming','guitar-acoustic','bright','Violão strumming brilhante para música ao vivo e gravações de pop. Corte firme de lama, ataque de palheta e ar.',ARRAY['acoustic','strumming','bright','live','pop'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":100,"slope_db_oct":"18"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-4,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1500,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":3,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":4,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-20,"neutral":0},"ratio":{"value":4,"neutral":1},"attack_ms":8,"release_ms":100,"knee_db":4,"makeup_db":{"value":5,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":3,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":40,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 13. Presets — PIANO/TECLADO
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('piano-classico','Piano Clássico','piano-keys','natural','Piano de concerto natural. Compressão mínima preservando dinâmica, reverb de sala de concerto e equalização sutil.',ARRAY['piano','classical','concert','natural','dynamic'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":30,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":150,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":400,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":1.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":400,"knee_db":10,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"reverb","params":{"room_size":40,"damping":50,"width":100,"predelay_ms":15,"mix":{"value":15,"neutral":0}}}
  ]}',50,'Versão inicial — compressão suave para preservar dinâmica clássica') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('piano-pop','Piano Pop/R&B','piano-keys','bright','Piano brilhante para pop e R&B. Corte de lama, presença no médio-agudo e reverb curto de sala de estúdio.',ARRAY['piano','pop','rnb','bright','studio'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":60,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-3,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1500,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_peak","params":{"frequency_hz":4000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-18,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":8,"release_ms":150,"knee_db":6,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"reverb","params":{"room_size":25,"damping":60,"width":80,"predelay_ms":10,"mix":{"value":10,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":50,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('piano-vintage','Piano Vintage/Rhodes','piano-keys','warm','Piano elétrico vintage estilo Rhodes/Wurlitzer. Graves quentes, saturação de fita e reverb de placa para tom nostálgico.',ARRAY['piano','vintage','rhodes','warm','electric'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":80,"slope_db_oct":"12"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":200,"gain_db":{"value":3,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":500,"gain_db":{"value":-2,"neutral":0},"q":1.2}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":2,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":6000,"gain_db":{"value":-2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-16,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":12,"release_ms":200,"knee_db":8,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":4,"neutral":0},"mix":{"value":20,"neutral":0},"output_db":0}},
    {"type":"reverb","params":{"room_size":30,"damping":60,"width":70,"predelay_ms":10,"mix":{"value":12,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":3}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

-- =============================================================================
-- 14. Presets — MASTERIZAÇÃO
-- =============================================================================

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('master-pop-moderno','Master Pop Moderno','master-main','loud','Masterização para pop e música eletrônica. Bus compression, shelf de sub, ar em 12 kHz, widening sutil e limiter LUFS-compliant.',ARRAY['master','pop','electronic','loud','streaming'],true,1)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":60,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":1,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":12000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":200,"knee_db":10,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":110,"neutral":100},"bass_mono_hz":80}},
    {"type":"limiter","params":{"ceiling_db":-0.3,"input_gain_db":{"value":2,"neutral":0},"release_ms":30,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}}
  ]}',75,'Versão inicial — target LUFS -14 dB (Spotify/Apple Music)') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('master-rock','Master Rock','master-main','punchy','Masterização para rock. Graves musculosos, compressão com caráter, saturação analógica sutil e limiter que mantém presença.',ARRAY['master','rock','punchy','analog','guitars'],true,2)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":80,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":250,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":3000,"gain_db":{"value":1.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":1.5,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-10,"neutral":0},"ratio":{"value":2.5,"neutral":1},"attack_ms":15,"release_ms":150,"knee_db":8,"makeup_db":{"value":3,"neutral":0}}},
    {"type":"saturation","params":{"mode":"tape","drive_db":{"value":2,"neutral":0},"mix":{"value":15,"neutral":0},"output_db":0}},
    {"type":"limiter","params":{"ceiling_db":-0.3,"input_gain_db":{"value":3,"neutral":0},"release_ms":30,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}}
  ]}',75,'Versão inicial') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('master-jazz-acoustico','Master Jazz/Acústico','master-main','transparent','Masterização transparente para música acústica e jazz. Processamento mínimo, compressão quase invisível. Preserva toda a dinâmica.',ARRAY['master','jazz','acoustic','transparent','dynamic'],true,3)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-1,"neutral":0},"q":1}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":8000,"gain_db":{"value":1,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-8,"neutral":0},"ratio":{"value":1.5,"neutral":1},"attack_ms":30,"release_ms":400,"knee_db":12,"makeup_db":{"value":1,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}}
  ]}',50,'Versão inicial — processamento mínimo para transparência') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('master-hip-hop','Master Hip-Hop/Trap','master-main','sub-heavy','Masterização hip-hop com graves dominantes. Sub-bass em mono, compressão pesada, graves realçados e baixa latência no limiter.',ARRAY['master','hip-hop','trap','sub','bass-heavy'],true,4)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"24"}},
    {"type":"eq_shelf","params":{"position":"low","frequency_hz":50,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"eq_peak","params":{"frequency_hz":200,"gain_db":{"value":-2,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":2000,"gain_db":{"value":1.5,"neutral":0},"q":1.5}},
    {"type":"eq_shelf","params":{"position":"high","frequency_hz":10000,"gain_db":{"value":2,"neutral":0},"q":0.707}},
    {"type":"compressor","params":{"threshold_db":{"value":-14,"neutral":0},"ratio":{"value":3,"neutral":1},"attack_ms":10,"release_ms":100,"knee_db":6,"makeup_db":{"value":4,"neutral":0}}},
    {"type":"stereo_width","params":{"width":{"value":115,"neutral":100},"bass_mono_hz":80}},
    {"type":"limiter","params":{"ceiling_db":-0.1,"input_gain_db":{"value":3,"neutral":0},"release_ms":20,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}}
  ]}',75,'Versão inicial — bass_mono_hz=80Hz para compatibilidade mono') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

DO $$ DECLARE v_pid uuid; v_vid uuid; BEGIN
  INSERT INTO public.presets (slug,name,category_id,style,description,tags,active,position)
  VALUES ('master-broadcast','Master Broadcast/Streaming','master-main','balanced','Masterização para broadcast e plataformas de streaming. Normalização LUFS -14 dB conforme padrão Spotify/Apple Music/YouTube.',ARRAY['master','broadcast','streaming','lufs','balanced'],true,5)
  RETURNING id INTO v_pid;
  INSERT INTO public.preset_versions (preset_id,version,chain,default_intensity,notes) VALUES (v_pid,1,
  '{"schema_version":1,"chain":[
    {"type":"highpass","params":{"frequency_hz":20,"slope_db_oct":"12"}},
    {"type":"eq_peak","params":{"frequency_hz":300,"gain_db":{"value":-1.5,"neutral":0},"q":1}},
    {"type":"eq_peak","params":{"frequency_hz":1500,"gain_db":{"value":1,"neutral":0},"q":1.5}},
    {"type":"compressor","params":{"threshold_db":{"value":-12,"neutral":0},"ratio":{"value":2,"neutral":1},"attack_ms":20,"release_ms":200,"knee_db":10,"makeup_db":{"value":2,"neutral":0}}},
    {"type":"limiter","params":{"ceiling_db":-1,"input_gain_db":{"value":0,"neutral":0},"release_ms":60,"lookahead_ms":5}},
    {"type":"normalize","params":{"mode":"lufs","target_db":-14}}
  ]}',75,'Versão inicial — LUFS -14 dB padrão streaming') RETURNING id INTO v_vid;
  UPDATE public.presets SET current_version_id=v_vid WHERE id=v_pid;
END $$;

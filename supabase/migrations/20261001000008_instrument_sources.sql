-- =============================================================================
-- Mix Pro — Instrumentos por forma de gravar.
--  1. Violão, guitarra, baixo e teclado separados em "no celular/microfone" e "plugado (cabo)":
--     cada forma de gravar tem problemas diferentes (celular: grave embolado, baixo sem grave,
--     chiado; plugado: som de captador, sem sala). O ajuste automático escolhe a categoria e o
--     usuário confirma o instrumento e a forma de gravar com um toque.
--  2. Os presets plugados de guitarra e baixo passam a usar as caixas do Mix Pro (IRs geradas
--     no app, sem download e sem licença de terceiros).
-- Pode rodar mais de uma vez.
-- =============================================================================

insert into public.preset_categories (id, group_id, name, audio_types, icon, position) values
  ('violao-celular', 'acoustic', 'Violão no celular/microfone', array['acoustic']::public.audio_type[], 'music', 0),
  ('violao-plugado', 'acoustic', 'Violão plugado (cabo)', array['acoustic']::public.audio_type[], 'music', 1),
  ('guitar-mic', 'guitar', 'Guitarra: amp no celular/microfone', array['guitar']::public.audio_type[], 'guitar', 1),
  ('bass-mic', 'bass', 'Baixo no celular/microfone', array['bass']::public.audio_type[], 'bass', 1),
  ('teclado-celular', 'piano', 'Teclado/piano no celular/microfone', array['piano']::public.audio_type[], 'piano', 0),
  ('teclado-plugado', 'piano', 'Teclado plugado (cabo)', array['piano']::public.audio_type[], 'piano', 1)
on conflict (id) do update set name = excluded.name, group_id = excluded.group_id, position = excluded.position;

update public.preset_categories set name = 'Guitarra plugada (amp + caixa)', position = 0 where id = 'guitar-amp';
update public.preset_categories set name = 'Guitarra Elétrica', position = 2 where id = 'guitar-electric';
update public.preset_categories set name = 'Baixo plugado (amp + caixa)', position = 0 where id = 'bass-amp';
update public.preset_categories set name = 'Baixo Elétrico', position = 2 where id = 'bass-electric';
update public.preset_categories set name = 'Violão/Acústico', position = 2 where id = 'guitar-acoustic';
update public.preset_categories set name = 'Piano/Teclado', position = 2 where id = 'piano-keys';

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

-- troca a caixa do amplificador de um preset existente (nova versão só se mudar)
create or replace function pg_temp.set_amp_ir(p_slug text, p_ir text) returns void language plpgsql as $$
declare v_pid uuid; v_cur jsonb; v_int int; v_new jsonb; v_next int; v_vid uuid;
begin
  select p.id, v.chain, v.default_intensity into v_pid, v_cur, v_int
  from public.presets p join public.preset_versions v on v.id = p.current_version_id
  where p.slug = p_slug;
  if v_pid is null then return; end if;
  select jsonb_set(v_cur, '{chain}', jsonb_agg(
           case when m->>'type' = 'amp' then jsonb_set(m, '{params,ir}', to_jsonb(p_ir)) else m end order by i))
  into v_new
  from jsonb_array_elements(v_cur->'chain') with ordinality as t(m, i);
  if v_new is null or v_new = v_cur then return; end if;
  select coalesce(max(version), 0) + 1 into v_next from public.preset_versions where preset_id = v_pid;
  insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
  values (v_pid, v_next, v_new, v_int, 'Caixa do Mix Pro')
  returning id into v_vid;
  update public.presets set current_version_id = v_vid where id = v_pid;
end $$;

select pg_temp.upsert_preset('violao-cel-natural', 'Violão Natural', 'violao-celular', 'natural',
  'Tira o som de celular (grave embolado e caixa de papelão) e devolve corpo, brilho de corda e uma sala bonita.',
  array['violao', 'acustico', 'celular', 'natural'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 80, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 200, "gain_db": {"value": -3, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 800, "gain_db": {"value": -2, "neutral": 0}, "q": 1.2}}, {"type": "eq_peak", "params": {"frequency_hz": 3000, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 10000, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 2.5, "neutral": 1}, "attack_ms": 15, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 50, "damping": 50, "width": 100, "predelay_ms": 10, "mix": {"value": 14, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('violao-cel-voz', 'Voz e Violão Brilhante', 'violao-celular', 'bright',
  'Violão aberto e brilhante, que acompanha a voz sem embolar: pop, sertanejo e louvor.',
  array['violao', 'pop', 'sertanejo', 'brilho'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 100, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 250, "gain_db": {"value": -3.5, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 4500, "gain_db": {"value": 2, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 12000, "gain_db": {"value": 4, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 10, "release_ms": 120, "knee_db": 4, "makeup_db": {"value": 3, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 62, "damping": 45, "width": 100, "predelay_ms": 14, "mix": {"value": 16, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 50, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('violao-cel-dedilhado', 'Dedilhado Encorpado', 'violao-celular', 'warm',
  'Quente e encorpado, respeitando a dinâmica do dedilhado. Fica intimista e cheio.',
  array['violao', 'dedilhado', 'fingerstyle', 'quente'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 70, "slope_db_oct": "12"}}, {"type": "eq_shelf", "params": {"position": "low", "frequency_hz": 150, "gain_db": {"value": 2, "neutral": 0}, "q": 0.7}}, {"type": "eq_peak", "params": {"frequency_hz": 350, "gain_db": {"value": -2, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 2500, "gain_db": {"value": 1, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 10000, "gain_db": {"value": 2, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 2, "neutral": 1}, "attack_ms": 25, "release_ms": 200, "knee_db": 8, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "saturation", "params": {"mode": "tape", "drive_db": {"value": 3, "neutral": 0}, "mix": {"value": 40, "neutral": 0}, "output_db": 0}}, {"type": "reverb", "params": {"room_size": 72, "damping": 55, "width": 100, "predelay_ms": 18, "mix": {"value": 18, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('violao-plug-natural', 'Plugado Natural', 'violao-plugado', 'natural',
  'Tira o som de plástico do captador e devolve o corpo e o ar de um violão gravado com microfone.',
  array['violao', 'plugado', 'captador', 'natural'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 70, "slope_db_oct": "12"}}, {"type": "eq_shelf", "params": {"position": "low", "frequency_hz": 120, "gain_db": {"value": 2, "neutral": 0}, "q": 0.7}}, {"type": "eq_peak", "params": {"frequency_hz": 220, "gain_db": {"value": -2, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 1200, "gain_db": {"value": -4, "neutral": 0}, "q": 1.4}}, {"type": "eq_peak", "params": {"frequency_hz": 3500, "gain_db": {"value": -2, "neutral": 0}, "q": 2}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 9000, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 12, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "saturation", "params": {"mode": "tape", "drive_db": {"value": 2, "neutral": 0}, "mix": {"value": 30, "neutral": 0}, "output_db": 0}}, {"type": "reverb", "params": {"room_size": 35, "damping": 55, "width": 100, "predelay_ms": 6, "mix": {"value": 12, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('violao-plug-palco', 'Plugado Palco / Louvor', 'violao-plugado', 'wide',
  'Captador corrigido com ambiência grande e um eco suave: violão de culto e de show.',
  array['violao', 'plugado', 'louvor', 'worship', 'palco'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 80, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 220, "gain_db": {"value": -2.5, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 1200, "gain_db": {"value": -4, "neutral": 0}, "q": 1.4}}, {"type": "eq_peak", "params": {"frequency_hz": 3500, "gain_db": {"value": -2, "neutral": 0}, "q": 2}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 10000, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 10, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 3, "neutral": 0}}}, {"type": "delay", "params": {"time_ms": 360, "feedback": 25, "lowpass_hz": 4000, "mix": {"value": 8, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 82, "damping": 40, "width": 100, "predelay_ms": 20, "mix": {"value": 22, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('violao-plug-pop', 'Plugado Pop Brilhante', 'violao-plugado', 'bright',
  'Captador sem o som anasalado, brilho de estúdio e compressão firme: o violão de base do pop.',
  array['violao', 'plugado', 'pop', 'brilho'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 90, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 250, "gain_db": {"value": -3, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 1100, "gain_db": {"value": -3.5, "neutral": 0}, "q": 1.4}}, {"type": "eq_peak", "params": {"frequency_hz": 5000, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 12000, "gain_db": {"value": 4, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -24, "neutral": 0}, "ratio": {"value": 4, "neutral": 1}, "attack_ms": 8, "release_ms": 120, "knee_db": 4, "makeup_db": {"value": 4, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 55, "damping": 50, "width": 100, "predelay_ms": 10, "mix": {"value": 12, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 50, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-mic-limpa', 'Limpa (amp gravado)', 'guitar-mic', 'clean',
  'Para o amplificador gravado no celular: tira o grave da sala e o chiado do celular e deixa o limpo cristalino.',
  array['guitarra', 'limpa', 'celular', 'amp'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 90, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 220, "gain_db": {"value": -2.5, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 3600, "gain_db": {"value": -2, "neutral": 0}, "q": 2}}, {"type": "eq_peak", "params": {"frequency_hz": 2200, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1}}, {"type": "lowpass", "params": {"frequency_hz": 9000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 12, "release_ms": 120, "knee_db": 6, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 55, "damping": 50, "width": 100, "predelay_ms": 12, "mix": {"value": 14, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-mic-drive', 'Drive / Rock (amp gravado)', 'guitar-mic', 'aggressive',
  'Drive gravado no celular com médios na cara e sem a aspereza do microfone do telefone.',
  array['guitarra', 'drive', 'rock', 'celular'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 100, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 300, "gain_db": {"value": -3, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 1500, "gain_db": {"value": 2, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 3800, "gain_db": {"value": -2.5, "neutral": 0}, "q": 2}}, {"type": "lowpass", "params": {"frequency_hz": 8000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -18, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 15, "release_ms": 120, "knee_db": 4, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 40, "damping": 55, "width": 100, "predelay_ms": 8, "mix": {"value": 9, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 50, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('guitarra-mic-ambiente', 'Ambiente / Worship (amp gravado)', 'guitar-mic', 'wide',
  'Eco pontilhado e ambiência grande sobre o seu amplificador: guitarra de louvor e ambient.',
  array['guitarra', 'worship', 'ambiente', 'celular'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 100, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 250, "gain_db": {"value": -2.5, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 3600, "gain_db": {"value": -2, "neutral": 0}, "q": 2}}, {"type": "lowpass", "params": {"frequency_hz": 9000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 15, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "delay", "params": {"time_ms": 380, "feedback": 35, "lowpass_hz": 3500, "mix": {"value": 16, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 85, "damping": 40, "width": 100, "predelay_ms": 20, "mix": {"value": 22, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-cel-encorpado', 'Grave Restaurado', 'bass-mic', 'deep',
  'O celular não grava o grave do baixo: recriamos a nota grave que faltou e damos corpo para soar em fone e caixa.',
  array['baixo', 'celular', 'grave', 'encorpado'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 35, "slope_db_oct": "12"}}, {"type": "octaver", "params": {"octave": {"value": 22, "neutral": 0}, "dry": 100, "tone_hz": 120}}, {"type": "eq_shelf", "params": {"position": "low", "frequency_hz": 100, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "eq_peak", "params": {"frequency_hz": 300, "gain_db": {"value": -2.5, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 900, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1}}, {"type": "lowpass", "params": {"frequency_hz": 7000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 4, "neutral": 1}, "attack_ms": 15, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 3, "neutral": 0}}}, {"type": "saturation", "params": {"mode": "tube", "drive_db": {"value": 4, "neutral": 0}, "mix": {"value": 35, "neutral": 0}, "output_db": 0}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-cel-definido', 'Definido (slap e palheta)', 'bass-mic', 'punchy',
  'Grave de volta e o ataque das cordas na frente: slap, palhetada e groove aparecendo no celular de quem ouve.',
  array['baixo', 'celular', 'slap', 'definido'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 40, "slope_db_oct": "12"}}, {"type": "octaver", "params": {"octave": {"value": 12, "neutral": 0}, "dry": 100, "tone_hz": 120}}, {"type": "eq_shelf", "params": {"position": "low", "frequency_hz": 90, "gain_db": {"value": 2, "neutral": 0}, "q": 0.7}}, {"type": "eq_peak", "params": {"frequency_hz": 350, "gain_db": {"value": -3, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 1500, "gain_db": {"value": 2, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 3000, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1.2}}, {"type": "lowpass", "params": {"frequency_hz": 8000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -24, "neutral": 0}, "ratio": {"value": 5, "neutral": 1}, "attack_ms": 4, "release_ms": 90, "knee_db": 4, "makeup_db": {"value": 4, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 40, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('baixo-cel-redondo', 'Redondo (worship/MPB)', 'bass-mic', 'warm',
  'Grave cheio e macio, sem estalo de corda: sustenta a música sem brigar com a voz.',
  array['baixo', 'celular', 'redondo', 'worship', 'mpb'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 35, "slope_db_oct": "12"}}, {"type": "octaver", "params": {"octave": {"value": 25, "neutral": 0}, "dry": 100, "tone_hz": 110}}, {"type": "eq_shelf", "params": {"position": "low", "frequency_hz": 90, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "eq_peak", "params": {"frequency_hz": 700, "gain_db": {"value": -2, "neutral": 0}, "q": 1}}, {"type": "lowpass", "params": {"frequency_hz": 4000, "slope_db_oct": "12"}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 4, "neutral": 1}, "attack_ms": 20, "release_ms": 180, "knee_db": 6, "makeup_db": {"value": 3, "neutral": 0}}}, {"type": "saturation", "params": {"mode": "tape", "drive_db": {"value": 3, "neutral": 0}, "mix": {"value": 30, "neutral": 0}, "output_db": 0}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-cel-natural', 'Piano Natural', 'teclado-celular', 'natural',
  'Tira o embolado e o som de caixinha do celular e coloca o piano numa sala de verdade.',
  array['piano', 'teclado', 'celular', 'natural'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 50, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 250, "gain_db": {"value": -3, "neutral": 0}, "q": 0.9}}, {"type": "eq_peak", "params": {"frequency_hz": 1000, "gain_db": {"value": -1, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 4000, "gain_db": {"value": 1.5, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 10000, "gain_db": {"value": 2.5, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 2, "neutral": 1}, "attack_ms": 20, "release_ms": 200, "knee_db": 8, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 70, "damping": 50, "width": 100, "predelay_ms": 15, "mix": {"value": 18, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-cel-worship', 'Teclado Pop / Louvor', 'teclado-celular', 'bright',
  'Brilho, compressão e ambiência grande: teclado de banda e de culto que preenche a música.',
  array['teclado', 'louvor', 'worship', 'pop', 'celular'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 60, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 300, "gain_db": {"value": -3, "neutral": 0}, "q": 1}}, {"type": "eq_peak", "params": {"frequency_hz": 3000, "gain_db": {"value": 2, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 11000, "gain_db": {"value": 3, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 3, "neutral": 1}, "attack_ms": 12, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 3, "neutral": 0}}}, {"type": "delay", "params": {"time_ms": 420, "feedback": 25, "lowpass_hz": 3500, "mix": {"value": 8, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 85, "damping": 40, "width": 100, "predelay_ms": 22, "mix": {"value": 24, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-cel-intimista', 'Piano Intimista', 'teclado-celular', 'warm',
  'Quente e próximo, com um toque de fita: piano e voz, baladas e momentos calmos.',
  array['piano', 'intimista', 'quente', 'balada'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 45, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 300, "gain_db": {"value": -2, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 8000, "gain_db": {"value": -1, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 2, "neutral": 1}, "attack_ms": 25, "release_ms": 220, "knee_db": 8, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "saturation", "params": {"mode": "tape", "drive_db": {"value": 4, "neutral": 0}, "mix": {"value": 45, "neutral": 0}, "output_db": 0}}, {"type": "reverb", "params": {"room_size": 55, "damping": 60, "width": 100, "predelay_ms": 12, "mix": {"value": 15, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-plug-estudio', 'Estúdio Limpo', 'teclado-plugado', 'clean',
  'Polimento de estúdio para o som que já sai limpo do teclado: equilíbrio, estéreo largo e uma sala discreta.',
  array['teclado', 'plugado', 'estudio', 'limpo'], 1,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 30, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 300, "gain_db": {"value": -1.5, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 10000, "gain_db": {"value": 1.5, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 2, "neutral": 1}, "attack_ms": 20, "release_ms": 200, "knee_db": 8, "makeup_db": {"value": 1.5, "neutral": 0}}}, {"type": "stereo_width", "params": {"width": {"value": 120, "neutral": 100}, "bass_mono_hz": 120}}, {"type": "reverb", "params": {"room_size": 55, "damping": 50, "width": 100, "predelay_ms": 10, "mix": {"value": 12, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-plug-pad', 'Pad / Worship', 'teclado-plugado', 'wide',
  'Pad imenso e envolvente: estéreo aberto, eco suave e reverb de catedral.',
  array['teclado', 'pad', 'worship', 'louvor', 'ambiente'], 2,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 40, "slope_db_oct": "12"}}, {"type": "eq_peak", "params": {"frequency_hz": 400, "gain_db": {"value": -2, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 9000, "gain_db": {"value": 2, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -22, "neutral": 0}, "ratio": {"value": 2.5, "neutral": 1}, "attack_ms": 30, "release_ms": 250, "knee_db": 8, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "stereo_width", "params": {"width": {"value": 140, "neutral": 100}, "bass_mono_hz": 150}}, {"type": "delay", "params": {"time_ms": 450, "feedback": 30, "lowpass_hz": 3000, "mix": {"value": 10, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 92, "damping": 35, "width": 100, "predelay_ms": 25, "mix": {"value": 30, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.upsert_preset('teclado-plug-rhodes', 'Piano Elétrico Quente', 'teclado-plugado', 'vintage',
  'Válvula, chorus leve e sala: o piano elétrico vintage do soul, R&B e MPB.',
  array['teclado', 'rhodes', 'piano eletrico', 'soul', 'rnb'], 3,
  '{"schema_version": 1, "chain": [{"type": "highpass", "params": {"frequency_hz": 40, "slope_db_oct": "12"}}, {"type": "saturation", "params": {"mode": "tube", "drive_db": {"value": 6, "neutral": 0}, "mix": {"value": 50, "neutral": 0}, "output_db": 0}}, {"type": "chorus", "params": {"rate_hz": 0.6, "depth": 30, "mix": {"value": 25, "neutral": 0}}}, {"type": "eq_peak", "params": {"frequency_hz": 250, "gain_db": {"value": -1.5, "neutral": 0}, "q": 1}}, {"type": "eq_shelf", "params": {"position": "high", "frequency_hz": 9000, "gain_db": {"value": 1, "neutral": 0}, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": {"value": -20, "neutral": 0}, "ratio": {"value": 2.5, "neutral": 1}, "attack_ms": 15, "release_ms": 150, "knee_db": 6, "makeup_db": {"value": 2, "neutral": 0}}}, {"type": "reverb", "params": {"room_size": 60, "damping": 55, "width": 100, "predelay_ms": 12, "mix": {"value": 14, "neutral": 0}}}, {"type": "limiter", "params": {"ceiling_db": -1, "input_gain_db": {"value": 0, "neutral": 0}, "release_ms": 60, "lookahead_ms": 5}}]}'::jsonb, 75);

select pg_temp.set_amp_ir('guitarra-amp-worship', 'mp:g-2x12-alnico');
select pg_temp.set_amp_ir('guitarra-amp-funk', 'mp:g-1x12-aberta');
select pg_temp.set_amp_ir('guitarra-amp-blues', 'mp:g-4x12-greenback');
select pg_temp.set_amp_ir('guitarra-amp-rock', 'mp:g-4x12-greenback');
select pg_temp.set_amp_ir('guitarra-amp-metal', 'mp:g-4x12-v30');
select pg_temp.set_amp_ir('guitarra-amp-pop', 'mp:g-1x12-vintage');
select pg_temp.set_amp_ir('baixo-amp-valvulado', 'mp:b-8x10');
select pg_temp.set_amp_ir('baixo-amp-moderno', 'mp:b-4x10-tweeter');
select pg_temp.set_amp_ir('baixo-amp-slap', 'mp:b-4x10-tweeter');
select pg_temp.set_amp_ir('baixo-amp-worship', 'mp:b-1x15');

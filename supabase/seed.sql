-- Seed estrutural: categorias e presets SEM parâmetros de mixagem.
-- Os presets nascem inativos com cadeia vazia; o proprietário define os parâmetros no painel admin.

insert into public.preset_categories (id, group_id, name, audio_types, icon, position) values
  ('kick', 'drums', 'Kick', array['drums']::public.audio_type[], 'drum', 0),
  ('snare', 'drums', 'Caixa', array['drums']::public.audio_type[], 'drum', 1),
  ('hihat', 'drums', 'Hi-Hat', array['drums']::public.audio_type[], 'drum', 2),
  ('toms', 'drums', 'Tons', array['drums']::public.audio_type[], 'drum', 3),
  ('overheads', 'drums', 'Overheads', array['drums']::public.audio_type[], 'drum', 4),
  ('room', 'drums', 'Room', array['drums']::public.audio_type[], 'drum', 5),
  ('drum_bus', 'drums', 'Bateria (estéreo)', array['drums']::public.audio_type[], 'drum', 6),
  ('bass', 'bass', 'Baixo', array['bass']::public.audio_type[], 'bass', 7),
  ('guitar', 'guitar', 'Guitarra', array['guitar']::public.audio_type[], 'guitar', 8),
  ('acoustic', 'acoustic', 'Violão', array['acoustic']::public.audio_type[], 'guitar', 9),
  ('vocal', 'vocal', 'Voz', array['vocal']::public.audio_type[], 'mic', 10),
  ('piano', 'piano', 'Piano / Teclado', array['piano']::public.audio_type[], 'piano', 11),
  ('master', 'master', 'Master', array['master','mix']::public.audio_type[], 'sparkles', 12),
  ('social', 'master', 'Redes sociais', array['master','mix','vocal']::public.audio_type[], 'share', 13)
on conflict (id) do nothing;

insert into public.presets (slug, name, category_id, style, description, tags, active, position) values
  ('kick-deep', 'Kick Deep', 'kick', 'deep', 'Grave mais presente.', array['deep'], false, 0),
  ('kick-punch', 'Kick Punch', 'kick', 'punchy', 'Mais ataque e definição.', array['punchy'], false, 1),
  ('kick-attack', 'Kick Attack', 'kick', 'bright', 'Mais ataque e clareza.', array['bright'], false, 2),
  ('kick-modern', 'Kick Modern', 'kick', 'modern', 'Som moderno e controlado.', array['modern'], false, 3),
  ('kick-heavy', 'Kick Heavy', 'kick', 'heavy', 'Mais impacto e densidade.', array['heavy'], false, 4),
  ('kick-natural', 'Kick Natural', 'kick', 'natural', 'Som fiel à gravação.', array['natural'], false, 5),
  ('kick-vintage', 'Kick Vintage', 'kick', 'vintage', 'Timbre quente e arredondado.', array['vintage'], false, 6),
  ('snare-crack', 'Snare Crack', 'snare', 'bright', 'Estalo e presença.', array['bright'], false, 0),
  ('snare-fat', 'Snare Fat', 'snare', 'deep', 'Corpo e peso.', array['deep'], false, 1),
  ('snare-bright', 'Snare Bright', 'snare', 'bright', 'Mais brilho.', array['bright'], false, 2),
  ('snare-warm', 'Snare Warm', 'snare', 'warm', 'Timbre quente.', array['warm'], false, 3),
  ('snare-tight', 'Snare Tight', 'snare', 'punchy', 'Curta e controlada.', array['punchy'], false, 4),
  ('snare-modern', 'Snare Modern', 'snare', 'modern', 'Som moderno.', array['modern'], false, 5),
  ('snare-aggressive', 'Snare Aggressive', 'snare', 'aggressive', 'Agressiva e à frente.', array['aggressive'], false, 6),
  ('hat-bright', 'Hat Bright', 'hihat', 'bright', 'Brilho e definição.', array['bright'], false, 0),
  ('hat-clean', 'Hat Clean', 'hihat', 'clean', 'Limpo e equilibrado.', array['clean'], false, 1),
  ('hat-soft', 'Hat Soft', 'hihat', 'warm', 'Suave, sem agressividade.', array['warm'], false, 2),
  ('hat-aggressive', 'Hat Aggressive', 'hihat', 'aggressive', 'Mais presença e ataque.', array['aggressive'], false, 3),
  ('tom-punch', 'Tom Punch', 'toms', 'punchy', 'Ataque e definição.', array['punchy'], false, 0),
  ('tom-deep', 'Tom Deep', 'toms', 'deep', 'Grave e profundidade.', array['deep'], false, 1),
  ('tom-natural', 'Tom Natural', 'toms', 'natural', 'Fiel à gravação.', array['natural'], false, 2),
  ('tom-modern', 'Tom Modern', 'toms', 'modern', 'Controlado e moderno.', array['modern'], false, 3),
  ('oh-natural', 'OH Natural', 'overheads', 'natural', 'Imagem natural da bateria.', array['natural'], false, 0),
  ('oh-bright', 'OH Bright', 'overheads', 'bright', 'Pratos mais brilhantes.', array['bright'], false, 1),
  ('oh-wide', 'OH Wide', 'overheads', 'wide', 'Imagem estéreo mais aberta.', array['wide'], false, 2),
  ('oh-dark', 'OH Dark', 'overheads', 'warm', 'Mais escuro e suave.', array['warm'], false, 3),
  ('oh-vintage', 'OH Vintage', 'overheads', 'vintage', 'Timbre clássico.', array['vintage'], false, 4),
  ('room-big', 'Room Big', 'room', 'wide', 'Ambiência grande.', array['wide'], false, 0),
  ('room-tight', 'Room Tight', 'room', 'punchy', 'Ambiência curta.', array['punchy'], false, 1),
  ('room-punch', 'Room Punch', 'room', 'punchy', 'Ambiência com impacto.', array['punchy'], false, 2),
  ('room-natural', 'Room Natural', 'room', 'natural', 'Ambiência natural.', array['natural'], false, 3),
  ('room-aggressive', 'Room Aggressive', 'room', 'aggressive', 'Ambiência comprimida e agressiva.', array['aggressive'], false, 4),
  ('bass-deep', 'Bass Deep', 'bass', 'deep', 'Grave profundo.', array['deep'], false, 0),
  ('bass-punch', 'Bass Punch', 'bass', 'punchy', 'Ataque e definição.', array['punchy'], false, 1),
  ('bass-clean', 'Bass Clean', 'bass', 'clean', 'Limpo e equilibrado.', array['clean'], false, 2),
  ('bass-warm', 'Bass Warm', 'bass', 'warm', 'Quente e encorpado.', array['warm'], false, 3),
  ('bass-modern', 'Bass Modern', 'bass', 'modern', 'Moderno e controlado.', array['modern'], false, 4),
  ('bass-aggressive', 'Bass Aggressive', 'bass', 'aggressive', 'Mais drive e presença.', array['aggressive'], false, 5),
  ('bass-vintage', 'Bass Vintage', 'bass', 'vintage', 'Timbre clássico.', array['vintage'], false, 6),
  ('guitar-clean', 'Guitar Clean', 'guitar', 'clean', 'Limpa e clara.', array['clean'], false, 0),
  ('guitar-bright', 'Guitar Bright', 'guitar', 'bright', 'Mais brilho.', array['bright'], false, 1),
  ('guitar-warm', 'Guitar Warm', 'guitar', 'warm', 'Quente e encorpada.', array['warm'], false, 2),
  ('guitar-crunch', 'Guitar Crunch', 'guitar', 'aggressive', 'Crunch com textura.', array['aggressive'], false, 3),
  ('guitar-heavy', 'Guitar Heavy', 'guitar', 'heavy', 'Pesada e densa.', array['heavy'], false, 4),
  ('guitar-wide', 'Guitar Wide', 'guitar', 'wide', 'Mais aberta no estéreo.', array['wide'], false, 5),
  ('guitar-modern', 'Guitar Modern', 'guitar', 'modern', 'Moderna e controlada.', array['modern'], false, 6),
  ('acoustic-natural', 'Acoustic Natural', 'acoustic', 'natural', 'Natural e fiel.', array['natural'], false, 0),
  ('acoustic-bright', 'Acoustic Bright', 'acoustic', 'bright', 'Cordas mais brilhantes.', array['bright'], false, 1),
  ('acoustic-warm', 'Acoustic Warm', 'acoustic', 'warm', 'Quente e encorpado.', array['warm'], false, 2),
  ('acoustic-presence', 'Acoustic Presence', 'acoustic', 'bright', 'Mais à frente.', array['bright'], false, 3),
  ('acoustic-wide', 'Acoustic Wide', 'acoustic', 'wide', 'Mais aberto.', array['wide'], false, 4),
  ('vocal-clean', 'Vocal Clean', 'vocal', 'clean', 'Limpa e equilibrada.', array['clean'], false, 0),
  ('vocal-warm', 'Vocal Warm', 'vocal', 'warm', 'Mais quente e próxima.', array['warm'], false, 1),
  ('vocal-bright', 'Vocal Bright', 'vocal', 'bright', 'Mais brilho e clareza.', array['bright'], false, 2),
  ('vocal-presence', 'Vocal Presence', 'vocal', 'bright', 'Mais presença e definição.', array['bright'], false, 3),
  ('vocal-modern', 'Vocal Modern', 'vocal', 'modern', 'Moderna e controlada.', array['modern'], false, 4),
  ('vocal-radio', 'Vocal Radio', 'vocal', 'radio', 'Estilo rádio.', array['radio'], false, 5),
  ('vocal-intimate', 'Vocal Intimate', 'vocal', 'intimate', 'Íntima e suave.', array['intimate'], false, 6),
  ('vocal-aggressive', 'Vocal Aggressive', 'vocal', 'aggressive', 'Agressiva e à frente.', array['aggressive'], false, 7),
  ('master-clean', 'Master Clean', 'master', 'clean', 'Transparente e equilibrado.', array['clean'], false, 0),
  ('master-punch', 'Master Punch', 'master', 'punchy', 'Mais impacto.', array['punchy'], false, 1),
  ('master-loud', 'Master Loud', 'master', 'heavy', 'Mais volume percebido.', array['heavy'], false, 2),
  ('master-warm', 'Master Warm', 'master', 'warm', 'Mais quente.', array['warm'], false, 3),
  ('master-modern', 'Master Modern', 'master', 'modern', 'Moderno e brilhante.', array['modern'], false, 4),
  ('master-streaming', 'Master Streaming', 'master', 'clean', 'Perfil para streaming.', array['clean'], false, 5),
  ('master-dynamic', 'Master Dynamic', 'master', 'natural', 'Preserva a dinâmica.', array['natural'], false, 6),
  ('instagram', 'Instagram', 'social', 'modern', 'Perfil de processamento para Reels.', array['modern'], false, 0),
  ('tiktok', 'TikTok', 'social', 'modern', 'Perfil de processamento para TikTok.', array['modern'], false, 1),
  ('youtube', 'YouTube', 'social', 'clean', 'Perfil de processamento para YouTube.', array['clean'], false, 2),
  ('spotify-streaming', 'Spotify / Streaming', 'social', 'clean', 'Perfil de processamento para streaming.', array['clean'], false, 3)
on conflict (slug) do nothing;

-- Versão 1 (cadeia vazia) para cada preset sem versão.
insert into public.preset_versions (preset_id, version, chain, default_intensity, notes)
select p.id, 1, '{"schema_version":1,"chain":[]}'::jsonb, 50, 'Estrutura inicial — parâmetros a definir'
from public.presets p
where not exists (select 1 from public.preset_versions v where v.preset_id = p.id);

update public.presets p set current_version_id = v.id
from public.preset_versions v
where v.preset_id = p.id and v.version = 1 and p.current_version_id is null;

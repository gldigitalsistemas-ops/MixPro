-- =============================================================================
-- Mix Pro — Fase 11: AI Audio Lab
-- Separação de stems, redução de ruído e masterização por IA.
-- Usa a mesma tabela processing_jobs com novos tipos de job.
-- =============================================================================

-- Novos tipos de job para processamento por IA
alter type public.job_type add value if not exists 'ai_stem_separate';
alter type public.job_type add value if not exists 'ai_denoise';

-- Configurações do AI Lab
insert into public.system_settings (key, value, description, is_public) values
  ('ai_lab_enabled',         'false',  'Habilita o AI Audio Lab para todos os usuários', true),
  ('ai_lab_stem_enabled',    'false',  'Habilita separação de stems', true),
  ('ai_lab_denoise_enabled', 'false',  'Habilita redução de ruído IA', true),
  ('ai_lab_stem_credits',    '3',      'Créditos consumidos por separação de stems', false),
  ('ai_lab_denoise_credits', '1',      'Créditos consumidos por redução de ruído', false),
  -- URL do serviço de IA (vazio = usar demucs local se disponível)
  ('ai_lab_service_url',     '""',     'URL do serviço externo de IA (ex: http://demucs:8000)', false),
  ('ai_lab_stem_model',      '"htdemucs"', 'Modelo de separação de stems (htdemucs, mdx, mdx_q)', false)
on conflict (key) do nothing;

-- Tabela de outputs do AI Lab (um por stem gerado)
create table public.ai_stem_outputs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.processing_jobs (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  stem_type   text not null,  -- vocals, drums, bass, other, guitar, piano
  storage_key text,
  file_name   text not null,
  size_bytes  bigint,
  created_at  timestamptz not null default now()
);
create index ai_stem_outputs_job_idx on public.ai_stem_outputs (job_id);
create index ai_stem_outputs_user_idx on public.ai_stem_outputs (user_id, created_at desc);

alter table public.ai_stem_outputs enable row level security;
create policy "ai_stem_outputs: dono"
  on public.ai_stem_outputs for select
  using (user_id = auth.uid());
create policy "ai_stem_outputs: admin"
  on public.ai_stem_outputs for all
  using (public.is_admin());

-- Função para enfileirar job de IA (chamada pela API)
create or replace function public.enqueue_ai_job(
  p_user            uuid,
  p_type            public.job_type,
  p_source_file     uuid,
  p_params          jsonb default '{}'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_job_id uuid;
  v_credits integer;
  v_key    text;
begin
  if p_type = 'ai_stem_separate' then
    v_credits := coalesce(public.setting_int('ai_lab_stem_credits'), 3);
    v_key := 'ai_lab_stem_credits';
  elsif p_type = 'ai_denoise' then
    v_credits := coalesce(public.setting_int('ai_lab_denoise_credits'), 1);
    v_key := 'ai_lab_denoise_credits';
  else
    raise exception 'Tipo de job IA desconhecido: %', p_type;
  end if;

  -- Desconta créditos (lança exceção se saldo insuficiente)
  perform public.grant_credits(
    p_user, 'download', 'AI_LAB', -v_credits,
    'AI Lab — ' || p_type::text,
    'ai_job', null, null
  );

  -- Cria o job
  insert into public.processing_jobs (user_id, type, source_file_id, params, priority, stage)
  values (p_user, p_type, p_source_file, p_params, 4, 'Na fila')
  returning id into v_job_id;

  return v_job_id;
end $$;

revoke execute on function public.enqueue_ai_job(uuid, public.job_type, uuid, jsonb) from public, anon;
grant execute on function public.enqueue_ai_job(uuid, public.job_type, uuid, jsonb) to authenticated;

-- Realtime: acompanhar progresso dos jobs de IA
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_stem_outputs;
  end if;
end $$;

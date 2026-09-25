-- =============================================================================
-- Mix Pro — Administração: exclusão segura de presets, ajustes de crédito e
-- métricas para o painel.
-- =============================================================================

-- Versões continuam imutáveis; exclusão só quando nunca foram usadas.
create or replace function public.preset_versions_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.processing_jobs where preset_version_id = old.id)
       or exists (select 1 from public.tracks where preset_version_id = old.id) then
      raise exception 'PRESET_VERSION_IN_USE';
    end if;
    return old;
  end if;
  raise exception 'preset_versions são imutáveis; crie uma nova versão';
end $$;

-- Exclui um preset nunca utilizado; se já foi usado, arquiva (mantém reprodutibilidade).
create or replace function public.admin_delete_preset(p_preset uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  used boolean;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select exists (
    select 1 from public.preset_versions v
    where v.preset_id = p_preset and (
      exists (select 1 from public.processing_jobs j where j.preset_version_id = v.id) or
      exists (select 1 from public.tracks t where t.preset_version_id = v.id))
  ) into used;

  if used then
    update public.presets set archived_at = now(), active = false where id = p_preset;
    insert into public.admin_logs (admin_id, action, target_type, target_id) values (auth.uid(), 'preset_archived', 'preset', p_preset::text);
    return 'archived';
  end if;

  update public.presets set current_version_id = null where id = p_preset;
  delete from public.favorites where preset_id = p_preset;
  delete from public.preset_versions where preset_id = p_preset;
  delete from public.presets where id = p_preset;
  insert into public.admin_logs (admin_id, action, target_type, target_id) values (auth.uid(), 'preset_deleted', 'preset', p_preset::text);
  return 'deleted';
end $$;
revoke execute on function public.admin_delete_preset(uuid) from public, anon;
grant execute on function public.admin_delete_preset(uuid) to authenticated;

-- Ajuste manual de créditos pelo admin (sempre auditado).
create or replace function public.admin_adjust_credits(p_user uuid, p_amount integer, p_reason text)
returns public.credit_transactions
language plpgsql security definer set search_path = public as $$
declare
  tx public.credit_transactions;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  tx := public.grant_credits(p_user, 'download', 'ADMIN_ADJUSTMENT', p_amount, p_reason, 'admin', auth.uid()::text, null, auth.uid());
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'credits_adjusted', 'user', p_user::text, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return tx;
end $$;
revoke execute on function public.admin_adjust_credits(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;

-- Métricas agregadas do painel.
create or replace function public.admin_metrics(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
  result jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_new', (select count(*) from public.profiles where created_at >= since),
    'users_active', (select count(distinct user_id) from public.processing_jobs where created_at >= since),
    'projects', (select count(*) from public.projects where deleted_at is null),
    'uploads', (select count(*) from public.audio_files where kind = 'source' and created_at >= since),
    'jobs', (select count(*) from public.processing_jobs where created_at >= since),
    'jobs_failed', (select count(*) from public.processing_jobs where status = 'failed' and created_at >= since),
    'jobs_queued', (select count(*) from public.processing_jobs where status = 'queued'),
    'cache_hits', (select count(*) from public.processing_jobs where cache_hit and created_at >= since),
    'avg_processing_ms', (select round(avg(duration_ms)) from public.processing_jobs where status = 'completed' and not cache_hit and created_at >= since),
    'downloads_total', (select count(*) from public.download_events where created_at >= since),
    'downloads_charged', (select count(*) from public.download_events where charged and created_at >= since),
    'credits_granted', (select coalesce(sum(amount), 0) from public.credit_transactions where amount > 0 and created_at >= since),
    'storage_bytes', (select coalesce(sum(size_bytes), 0) from public.audio_files where deleted_at is null),
    'top_previewed', (
      select coalesce(jsonb_agg(t), '[]') from (
        select p.name, count(*) as n from public.processing_jobs j
        join public.preset_versions v on v.id = j.preset_version_id join public.presets p on p.id = v.preset_id
        where j.type = 'preview' and j.created_at >= since group by p.name order by n desc limit 8) t),
    'top_downloaded', (
      select coalesce(jsonb_agg(t), '[]') from (
        select p.name, count(*) as n from public.processing_jobs j
        join public.preset_versions v on v.id = j.preset_version_id join public.presets p on p.id = v.preset_id
        where j.type = 'render' and j.status = 'completed' and j.created_at >= since group by p.name order by n desc limit 8) t)
  ) into result;
  return result;
end $$;
revoke execute on function public.admin_metrics(integer) from public, anon;
grant execute on function public.admin_metrics(integer) to authenticated;

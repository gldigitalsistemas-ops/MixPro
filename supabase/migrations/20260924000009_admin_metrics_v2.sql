-- =============================================================================
-- Mix Pro — Fase 9: admin_metrics v2
-- Adiciona métricas de pagamentos, pedidos pro e indicações.
-- =============================================================================

create or replace function public.admin_metrics(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  since  timestamptz := now() - make_interval(days => p_days);
  result jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select jsonb_build_object(
    -- Usuários
    'users_total',        (select count(*) from public.profiles),
    'users_new',          (select count(*) from public.profiles where created_at >= since),
    'users_active',       (select count(distinct user_id) from public.processing_jobs where created_at >= since),
    -- Projetos & jobs
    'projects',           (select count(*) from public.projects where deleted_at is null),
    'uploads',            (select count(*) from public.audio_files where kind = 'source' and created_at >= since),
    'jobs',               (select count(*) from public.processing_jobs where created_at >= since),
    'jobs_failed',        (select count(*) from public.processing_jobs where status = 'failed' and created_at >= since),
    'jobs_queued',        (select count(*) from public.processing_jobs where status = 'queued'),
    'cache_hits',         (select count(*) from public.processing_jobs where cache_hit and created_at >= since),
    'avg_processing_ms',  (select round(avg(duration_ms)) from public.processing_jobs where status = 'completed' and not cache_hit and created_at >= since),
    -- Downloads
    'downloads_total',    (select count(*) from public.download_events where created_at >= since),
    'downloads_charged',  (select count(*) from public.download_events where charged and created_at >= since),
    'credits_granted',    (select coalesce(sum(amount), 0) from public.credit_transactions where amount > 0 and created_at >= since),
    -- Storage
    'storage_bytes',      (select coalesce(sum(size_bytes), 0) from public.audio_files where deleted_at is null),
    -- Pagamentos (Fase 6)
    'payments_approved',  (select count(*) from public.payment_orders where status = 'approved' and updated_at >= since),
    'revenue_brl',        (select coalesce(sum(amount_brl), 0)::numeric(10,2) from public.payment_orders where status = 'approved' and updated_at >= since),
    -- Pedidos Mix Profissional (Fase 7)
    'pro_orders_total',   (select count(*) from public.pro_orders where created_at >= since),
    'pro_orders_active',  (select count(*) from public.pro_orders where status not in ('delivered','cancelled','refunded')),
    -- Indicações (Fase 8)
    'referrals_new',      (select count(*) from public.qualified_referrals where qualified_at >= since),
    'referrals_total',    (select count(*) from public.qualified_referrals),
    -- Tops
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

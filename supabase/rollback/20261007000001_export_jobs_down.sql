-- =============================================================================
-- REVERSÃO de supabase/migrations/20261007000001_export_jobs.sql
--
-- Fica fora de supabase/migrations de propósito: "supabase db push" aplicaria tudo o que estiver
-- naquela pasta, inclusive uma reversão. Aplique à mão, no editor SQL, só quando quiser desfazer.
--
-- Remove APENAS o que a migração criou. Não toca em credit_transactions: débitos feitos pelo
-- servidor ficam no ledger (com a mesma chave do app), como qualquer download pago.
-- =============================================================================

-- desagenda a limpeza antes de apagar a função que ela chama (o pg_cron fica: outras limpezas usam)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mixpro-limpeza-exportacao';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'export_job_status') then
    alter publication supabase_realtime drop table public.export_job_status;
  end if;
end $$;

drop function if exists public.create_export_job(uuid, text, text, text, text, text);
drop function if exists public.get_export_job(uuid);
drop function if exists public.export_server_allowed(uuid);
drop function if exists public.start_export_job(uuid, integer);
drop function if exists public.report_export_progress(uuid, integer);
drop function if exists public.commit_export_credit(uuid, text, jsonb, jsonb);
drop function if exists public.release_export_credit(uuid, text, jsonb, jsonb);
drop function if exists public.requeue_export_job(uuid);
drop function if exists public.refund_export(uuid, uuid);
drop function if exists public.cancel_export_job(uuid, uuid);
drop function if exists public.cleanup_export_jobs(integer, integer);
drop function if exists public.export_jobs_invariant_violations();
drop function if exists public.export_job_diffs(text, jsonb);
drop function if exists public.export_setting_bool(text);
drop function if exists public.export_day_start();

drop view if exists public.my_export_jobs;
drop trigger if exists export_jobs_status_sync on public.export_jobs;
drop table if exists public.export_job_status;
drop table if exists public.export_ref_anchors;
drop table if exists public.export_jobs;
drop function if exists public.export_job_status_sync();
drop type if exists public.export_credit_state;
drop type if exists public.export_status;

delete from public.system_settings where key in (
  'export_server_enabled', 'export_server_users', 'export_user_active', 'export_user_per_hour', 'export_user_per_day',
  'export_server_daily_cpu_s', 'export_server_daily_jobs'
);

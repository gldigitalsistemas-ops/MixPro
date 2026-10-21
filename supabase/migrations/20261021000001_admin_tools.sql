-- =============================================================================
-- Mix Pro — o admin usa a separação de faixas do VS (e as demais ferramentas) sem barreiras de compra.
-- -----------------------------------------------------------------------------
-- O admin já tinha saldo ilimitado e débitos ignorados (20261013000001_admin_free), mas a regra
-- "quem nunca comprou só separa 1 música no servidor" (NEEDS_PURCHASE) e o limite diário de trabalhos
-- ainda o bloqueavam. Aqui create_tool_job passa a isentar o admin dessas duas regras. Idempotente.
-- =============================================================================

create or replace function public.create_tool_job(
  p_user uuid, p_tool text, p_params jsonb, p_inputs text[], p_credits integer, p_retention_days integer default 1
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job public.tool_jobs;
  v_available integer;
  v_key text;
  v_day timestamptz := public.export_day_start();
  v_project uuid;
begin
  if p_user is null or p_tool is null or p_tool not in ('pitch_tempo', 'voice_playback', 'reference_master', 'album', 'stems', 'convert',
                                                         'stems_premium', 'mix_ia', 'compose', 'voice_final') then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or octet_length(p_params::text) > 16384 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  if p_inputs is null or cardinality(p_inputs) not between 1 and 40 then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;
  -- recursos premium: as entradas são do Cofre do próprio projeto
  if p_tool in ('stems_premium', 'mix_ia', 'compose', 'voice_final') then
    v_project := nullif(p_params ->> 'project_id', '')::uuid;
    if v_project is null or not exists (select 1 from public.premium_projects where id = v_project and user_id = p_user) then
      raise exception 'INVALID_JOB' using errcode = '22023';
    end if;
  end if;
  foreach v_key in array p_inputs loop
    if v_key !~ '^in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and not (v_project is not null and v_key ~ ('^cofre/proj/' || v_project::text || '/[0-9]{2}$')) then
      raise exception 'INVALID_JOB' using errcode = '22023';
    end if;
  end loop;
  if p_credits is null or p_credits not between 0 and 60 or p_retention_days not in (1, 30) then
    raise exception 'INVALID_JOB' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || p_user::text));

  if not public.export_server_allowed(p_user) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;
  -- admin (equipe): sem o limite diário; o limite de trabalhos ao mesmo tempo continua (protege o servidor)
  if (select count(*) from public.tool_jobs where user_id = p_user and status in ('queued', 'running'))
       >= coalesce(public.setting_int('tool_user_active'), 2)
     or (not public.is_staff(p_user)
         and (select count(*) from public.tool_jobs where user_id = p_user and created_at >= v_day)
           >= coalesce(public.setting_int('tool_user_per_day'), 30)) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.tool_jobs where created_at >= v_day) >= coalesce(public.setting_int('tool_server_daily_jobs'), 300) then
    raise exception 'CAPACITY' using errcode = 'P0001';
  end if;

  -- "1 separação grátis para quem nunca comprou" não vale para o admin (ele usa tudo de graça)
  if p_tool = 'stems'
     and not public.is_staff(p_user)
     and not exists (select 1 from public.credit_transactions where user_id = p_user and type = 'PURCHASE')
     and exists (select 1 from public.tool_jobs where user_id = p_user and tool = 'stems' and status in ('queued', 'running', 'done')) then
    raise exception 'NEEDS_PURCHASE' using errcode = 'P0001';
  end if;

  if p_credits > 0 then
    v_available := public.credit_balance(p_user, 'download')
      - (select count(*) from public.export_jobs where user_id = p_user and credit_state = 'reserved' and status in ('queued', 'running'))::integer
      - coalesce((select sum(credits) from public.tool_jobs where user_id = p_user and credit_state = 'reserved' and status in ('queued', 'running')), 0)::integer;
    if v_available < p_credits then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;
  end if;

  insert into public.tool_jobs (user_id, tool, params, inputs, credits, credit_state, expires_at, project_id)
  values (p_user, p_tool, p_params, p_inputs, p_credits, case when p_credits > 0 then 'reserved'::public.export_credit_state else 'none'::public.export_credit_state end,
          now() + make_interval(days => p_retention_days), v_project)
  returning * into v_job;
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'credit_state', v_job.credit_state, 'credits', v_job.credits);
end $$;



-- O admin também conta como Plano Pro (Cofre de 30 dias, WAV 24 bits e FLAC, prioridade na fila).
create or replace function public.is_pro(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff(p_user) or (public.current_plan(p_user) ->> 'plan') = 'pro'
$$;

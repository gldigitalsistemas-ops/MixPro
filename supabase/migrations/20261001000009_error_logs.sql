-- =============================================================================
-- Mix Pro — Registro de erros do app (aba "Logs" do admin).
-- Todo erro no aparelho de qualquer usuário (logado ou não, inclusive o admin) é gravado com
-- navegador, sistema, etapa, contexto do arquivo e a causa provável. Também registra quando o
-- navegador fecha a página no meio de uma tarefa (falta de memória no celular), detectado na
-- volta do usuário.
--  - Gravação só pela função log_app_error (tamanhos limitados e no máximo 40 registros por
--    aparelho por hora, para ninguém lotar a tabela).
--  - Só o admin lê, marca como resolvido e apaga.
--  - Registros com mais de 60 dias são apagados todo dia.
-- Pode rodar mais de uma vez.
-- =============================================================================

create table if not exists public.app_errors (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid references auth.users (id) on delete set null,
  client_id    text not null check (char_length(client_id) between 8 and 64),
  -- erro: falhou e o usuário viu; queda: o navegador fechou a página; aviso: falha esperada (arquivo, rede)
  severity     text not null check (severity in ('erro', 'queda', 'aviso')),
  area         text not null check (char_length(area) <= 40),
  fingerprint  text not null check (char_length(fingerprint) <= 64),
  message      text not null check (char_length(message) <= 500),
  cause        text check (char_length(cause) <= 300),
  stack        text check (char_length(stack) <= 4000),
  browser      text check (char_length(browser) <= 60),
  os           text check (char_length(os) <= 60),
  device       text check (char_length(device) <= 60),
  build        text check (char_length(build) <= 20),
  route        text check (char_length(route) <= 120),
  context      jsonb not null default '{}',
  resolved_at  timestamptz
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_fingerprint_idx on public.app_errors (fingerprint, created_at desc);
create index if not exists app_errors_client_idx on public.app_errors (client_id, created_at desc);

alter table public.app_errors enable row level security;
drop policy if exists "app_errors: admin lê" on public.app_errors;
create policy "app_errors: admin lê" on public.app_errors for select using (public.is_admin());
drop policy if exists "app_errors: admin altera" on public.app_errors;
create policy "app_errors: admin altera" on public.app_errors for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "app_errors: admin apaga" on public.app_errors;
create policy "app_errors: admin apaga" on public.app_errors for delete using (public.is_admin());

create or replace function public.log_app_error(
  p_client_id   text,
  p_severity    text,
  p_area        text,
  p_fingerprint text,
  p_message     text,
  p_cause       text,
  p_stack       text,
  p_browser     text,
  p_os          text,
  p_device      text,
  p_build       text,
  p_route       text,
  p_context     jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_client_id is null or char_length(p_client_id) not between 8 and 64 then return; end if;
  if p_severity not in ('erro', 'queda', 'aviso') then return; end if;
  -- limite por aparelho: um erro em laço não lota a tabela
  if (select count(*) from public.app_errors where client_id = p_client_id and created_at > now() - interval '1 hour') >= 40 then
    return;
  end if;
  if p_context is null or pg_column_size(p_context) > 4096 then p_context := '{}'; end if;
  insert into public.app_errors (user_id, client_id, severity, area, fingerprint, message, cause, stack, browser, os, device, build, route, context)
  values (
    auth.uid(), p_client_id, p_severity,
    left(coalesce(p_area, 'app'), 40), left(coalesce(p_fingerprint, 'sem'), 64), left(coalesce(p_message, '(sem mensagem)'), 500),
    left(p_cause, 300), left(p_stack, 4000), left(p_browser, 60), left(p_os, 60), left(p_device, 60), left(p_build, 20), left(p_route, 120),
    p_context
  );
end $$;
revoke execute on function public.log_app_error(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.log_app_error(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- limpeza diária: guarda 60 dias
create or replace function public.cleanup_app_errors(p_days int default 60)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.app_errors where created_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.cleanup_app_errors(int) from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'mixpro-limpeza-erros';
select cron.schedule('mixpro-limpeza-erros', '30 6 * * *', 'select public.cleanup_app_errors(60)');

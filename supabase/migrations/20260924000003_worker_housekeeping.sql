-- =============================================================================
-- Mix Pro — Coordenação entre workers para tarefas de manutenção
-- (limpeza de arquivos regeneráveis, uploads abandonados, projetos excluídos).
-- =============================================================================

create table public.worker_locks (
  name        text primary key,
  holder      text,
  locked_until timestamptz not null default 'epoch'
);
alter table public.worker_locks enable row level security;

-- Retorna true para exatamente um worker por janela de `p_interval_s`.
create or replace function public.try_worker_lock(p_name text, p_worker text, p_interval_s integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  got boolean;
begin
  insert into public.worker_locks (name) values (p_name) on conflict (name) do nothing;
  update public.worker_locks
     set holder = p_worker, locked_until = now() + make_interval(secs => p_interval_s)
   where name = p_name and locked_until < now()
  returning true into got;
  return coalesce(got, false);
end $$;
revoke execute on function public.try_worker_lock(text, text, integer) from public, anon, authenticated;

-- Exclusão de projeto pelo usuário: marca e o worker apaga os arquivos depois.
create or replace function public.delete_project(p_project uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.projects set deleted_at = now()
   where id = p_project and user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  update public.processing_jobs set status = 'cancelled'
   where project_id = p_project and status = 'queued';
end $$;
revoke execute on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;

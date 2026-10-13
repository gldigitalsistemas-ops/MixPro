-- =============================================================================
-- Mix Pro — o admin usa todos os recursos sem pagar.
-- -----------------------------------------------------------------------------
-- • Saldo do admin conta como ilimitado (nenhuma checagem de saldo o bloqueia).
-- • Débitos do admin não são gravados (exportações, ferramentas, kits, relatório, VS…).
-- • Pedidos premium do admin saem pagos na hora (a rota envia como "créditos" e o débito é ignorado).
-- Créditos recebidos (compras, presentes) continuam registrados normalmente. Idempotente.
-- =============================================================================

/** Conta da equipe (admin): usa tudo de graça. */
create or replace function public.is_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'admin')
$$;

create or replace function public.credit_balance(p_user uuid, p_kind public.credit_kind)
returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_staff(p_user) then 999999
              else (select coalesce(sum(amount), 0)::integer from public.credit_transactions where user_id = p_user and kind = p_kind)
         end
$$;

create or replace function public.grant_credits(
  p_user            uuid,
  p_kind            public.credit_kind,
  p_type            public.credit_tx_type,
  p_amount          integer,
  p_reason          text,
  p_reference_type  text default null,
  p_reference_id    text default null,
  p_idempotency_key text default null,
  p_created_by      uuid default null
)
returns public.credit_transactions
language plpgsql security definer set search_path = public as $$
declare
  tx public.credit_transactions;
begin
  perform pg_advisory_xact_lock(hashtext('credits:' || p_user::text));

  if p_idempotency_key is not null then
    select * into tx from public.credit_transactions where idempotency_key = p_idempotency_key;
    if found then
      return tx;
    end if;
  end if;

  -- admin: nenhum débito é gravado (tudo grátis); o que ele recebe continua registrado
  if p_amount < 0 and public.is_staff(p_user) then
    return tx;
  end if;

  if p_amount < 0 and public.credit_balance(p_user, p_kind) + p_amount < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  insert into public.credit_transactions
    (user_id, kind, type, amount, reason, reference_type, reference_id, idempotency_key, created_by)
  values
    (p_user, p_kind, p_type, p_amount, p_reason, p_reference_type, p_reference_id, p_idempotency_key, p_created_by)
  returning * into tx;

  return tx;
end $$;

revoke execute on function public.is_staff(uuid) from public, anon, authenticated;
grant execute on function public.is_staff(uuid) to service_role;
revoke execute on function public.grant_credits(uuid, public.credit_kind, public.credit_tx_type, integer, text, text, text, text, uuid) from public, anon, authenticated;

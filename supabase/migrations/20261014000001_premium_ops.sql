-- =============================================================================
-- Mix Pro — operação da Produção: recibo por e-mail (uma vez), estorno e "refazer" pelo Admin.
-- Só service_role chama estas funções. Idempotente.
-- =============================================================================
alter table public.premium_orders add column if not exists receipt_sent_at timestamptz;
alter table public.premium_orders add column if not exists refunded_at timestamptz;
alter table public.premium_orders add column if not exists refund_note text check (length(refund_note) <= 300);

/** Reserva o envio do recibo (true só para quem conseguiu: evita e-mail duplicado em webhooks repetidos). */
create or replace function public.claim_premium_receipt(p_order uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.premium_orders set receipt_sent_at = now() where id = p_order and status = 'paid' and receipt_sent_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.release_premium_receipt(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update public.premium_orders set receipt_sent_at = null where id = p_order
$$;

/**
 * Estorno de um pedido premium (a devolução do dinheiro no Mercado Pago é feita pela rota antes de chamar isto).
 * Pago em créditos: devolve os créditos. Corta o acesso aos arquivos (expiram agora) e encerra o projeto.
 */
create or replace function public.refund_premium_order(p_order uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.premium_orders;
  v_final uuid;
begin
  select * into v from public.premium_orders where id = p_order for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status = 'refunded' then
    return jsonb_build_object('status', 'refunded', 'idempotent', true);
  end if;
  if v.status <> 'paid' then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;
  update public.premium_orders set status = 'refunded', refunded_at = now(), refund_note = left(coalesce(p_note, ''), 300) where id = p_order;
  if v.method = 'credits' and v.credits > 0 and not public.is_staff(v.user_id) then
    perform public.grant_credits(v.user_id, 'download', 'REFUND', v.credits, 'Estorno: ' || v.product, 'premium_order', v.id::text, 'prem_refund:' || v.id::text);
  end if;
  if v.product = 'eng_finaliza' then
    update public.pro_orders set status = 'refunded', updated_at = now() where payment_order_id = v.payment_order_id and v.payment_order_id is not null;
  else
    select final_job into v_final from public.premium_projects where order_id = p_order;
    if v_final is not null then
      update public.tool_jobs set expires_at = now() where id = v_final;
    end if;
    update public.premium_projects set status = 'expired', updated_at = now() where order_id = p_order;
  end if;
  if v.payment_order_id is not null then
    update public.payment_orders set status = 'refunded', updated_at = now() where id = v.payment_order_id and status = 'approved';
  end if;
  return jsonb_build_object('status', 'refunded', 'product', v.product, 'user_id', v.user_id, 'project_id', v.project_id);
end $$;

/** "Refazer" sem cobrar de novo: o projeto pago volta a ter o trabalho completo pendente (a rota enfileira). */
create or replace function public.redo_premium_project(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.premium_projects;
begin
  select * into p from public.premium_projects where id = p_project for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p.order_id is null or not exists (select 1 from public.premium_orders where id = p.order_id and status = 'paid') then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;
  update public.premium_projects set final_job = null, status = 'paid', updated_at = now(), expires_at = greatest(expires_at, now() + interval '30 days') where id = p_project;
  return jsonb_build_object('user_id', p.user_id, 'project_id', p.id, 'product', p.product);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_premium_receipt(uuid)',
    'public.release_premium_receipt(uuid)',
    'public.refund_premium_order(uuid, text)',
    'public.redo_premium_project(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

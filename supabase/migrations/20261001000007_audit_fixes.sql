-- =============================================================================
-- Mix Pro — Correções da auditoria.
--  1. Estorno e contestação (chargeback) depois de aprovado: o pedido vira "refunded",
--     os créditos comprados ainda não usados são retirados e a mixagem profissional
--     que ainda não começou é marcada como estornada. Antes, os créditos ficavam.
--  2. get_setting não precisa estar aberta para visitantes.
--  3. Dados da empresa (obrigatórios na venda online — Decreto 7.962/2013), editáveis
--     no admin e exibidos no rodapé e nos termos.
-- Pode rodar mais de uma vez.
-- =============================================================================

create or replace function public.reverse_payment_order(
  p_external_ref  text,
  p_mp_payment_id text,
  p_reason        text
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_order   public.payment_orders;
  v_balance integer;
  v_take    integer;
begin
  perform pg_advisory_xact_lock(hashtext('payment:' || p_external_ref));
  select * into v_order from public.payment_orders where mp_external_ref = p_external_ref;
  if not found then return 'not_found'; end if;

  -- ainda não aprovado: só marca como falho (fluxo antigo)
  if v_order.status = 'pending' then
    update public.payment_orders
    set status = 'failed', mp_payment_id = coalesce(mp_payment_id, p_mp_payment_id), failure_reason = p_reason, updated_at = now()
    where id = v_order.id;
    return 'failed';
  end if;
  if v_order.status <> 'approved' then return 'unchanged'; end if;

  update public.payment_orders
  set status = 'refunded', failure_reason = p_reason, updated_at = now()
  where id = v_order.id;

  if v_order.pack_id like 'pro:%' then
    update public.pro_orders
    set status = 'refunded', updated_at = now()
    where id = substring(v_order.pack_id from 5)::uuid and status in ('paid', 'pending_payment');
  else
    -- retira o que ainda está no saldo (o que já virou download não tem como voltar)
    v_balance := public.credit_balance(v_order.user_id, 'download');
    v_take := least(v_balance, v_order.credits_amount);
    if v_take > 0 then
      perform public.grant_credits(
        v_order.user_id, 'download', 'REFUND', -v_take,
        case when p_reason = 'charged_back' then 'Contestação no cartão' else 'Pagamento estornado' end
          || ' (' || v_order.credits_amount || ' créditos)',
        'payment_order', v_order.id::text, 'reverse:' || v_order.id::text
      );
    end if;
  end if;
  return 'refunded';
end $$;
revoke execute on function public.reverse_payment_order(text, text, text) from public, anon, authenticated;

-- visitantes sem login não leem configurações internas (usuários logados continuam, por segurança
-- das funções que as usam)
revoke execute on function public.get_setting(text) from public, anon;
revoke execute on function public.setting_int(text) from public, anon;
grant execute on function public.get_setting(text) to authenticated;
grant execute on function public.setting_int(text) to authenticated;

insert into public.system_settings (key, value, description, is_public)
values (
  'empresa',
  '{"nome": "", "documento": "", "endereco": "", "email": "", "whatsapp": ""}'::jsonb,
  'Dados de quem vende (nome ou razão social, CPF/CNPJ, endereço, e-mail e WhatsApp de atendimento). Aparecem no rodapé e nos termos — obrigatórios para vender online.',
  true
)
on conflict (key) do nothing;

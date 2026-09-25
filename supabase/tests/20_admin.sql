-- Administração: métricas, ajuste de créditos, exclusão/arquivamento de presets.
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    perform public.admin_metrics(30);
    raise exception 'FALHA: usuário comum leu métricas';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare m jsonb; r text; before int;
begin
  m := public.admin_metrics(30);
  assert (m ->> 'users_total')::int = 2, 'métricas: ' || m::text;

  before := (select sum(amount)::int from public.credit_transactions where user_id = '11111111-1111-1111-1111-111111111111');
  perform public.admin_adjust_credits('11111111-1111-1111-1111-111111111111', 3, 'Cortesia');
  assert (select sum(amount)::int from public.credit_transactions where user_id = '11111111-1111-1111-1111-111111111111') = before + 3, 'ajuste de crédito';
  assert exists (select 1 from public.admin_logs where action = 'credits_adjusted'), 'log de ajuste';

  -- preset usado em jobs → arquiva
  r := public.admin_delete_preset((select id from public.presets where slug = 'vocal-warm'));
  assert r = 'archived', 'preset usado deveria ser arquivado: ' || r;
  -- preset nunca usado → exclui
  r := public.admin_delete_preset((select id from public.presets where slug = 'kick-deep'));
  assert r = 'deleted', 'preset sem uso deveria ser excluído: ' || r;
  assert not exists (select 1 from public.presets where slug = 'kick-deep'), 'preset não excluído';

  -- publicar nova versão
  perform public.publish_preset_version((select id from public.presets where slug = 'kick-punch'),
    '{"schema_version":1,"chain":[{"type":"gain","params":{"gain_db":1}}]}'::jsonb, 50, 'teste');
  assert (select v.version from public.presets p join public.preset_versions v on v.id = p.current_version_id where p.slug = 'kick-punch') = 2,
    'nova versão não publicada';
end $$;
commit;

select 'admin: todos os asserts passaram' as resultado;

-- Fluxo central: cadastro → créditos → projeto → arquivo → preview/cache → render → download.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bia@example.com');

-- 1. Cadastro gera perfil, código e 5 downloads
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'perfis não criados';
  assert public.credit_balance('11111111-1111-1111-1111-111111111111', 'download') = 5, 'saldo inicial != 5';
  assert (select length(referral_code) from public.profiles limit 1) = 7, 'código de indicação inválido';
end $$;

update public.presets set active = true where slug = 'vocal-warm';

insert into public.projects (id, user_id, name, audio_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Minha voz', 'vocal');
insert into public.audio_files (id, user_id, project_id, kind, status, storage_key, sha256, duration_s)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'source', 'ready', 'k/src1', 'abc123', 120);

-- ===== Sessão da Ana =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.tracks (id, project_id, user_id, name, source_file_id, category_id)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Voz', 'bbbbbbbb-0000-0000-0000-000000000001', 'vocal');

do $$
declare j public.processing_jobs; j2 public.processing_jobs; pv uuid;
begin
  select current_version_id into pv from public.presets where slug = 'vocal-warm';
  j := public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'preview', pv, 75, '{"start_s": 100}');
  assert j.status = 'queued', 'job não enfileirado';
  assert (j.params ->> 'start_s')::numeric = 90, 'trecho não limitado ao fim do áudio: ' || (j.params ->> 'start_s');
  j2 := public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'preview', pv, 75, '{"start_s": 100}');
  assert j2.id = j.id, 'job duplicado não deduplicado';
  assert public.my_credit_balance() = 5, 'my_credit_balance';
end $$;

do $$ begin
  begin
    insert into public.credit_transactions (user_id, type, amount) values (auth.uid(), 'PURCHASE', 100);
    raise exception 'FALHA: inseriu crédito';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
end $$;
commit;

-- ===== Sessão da Bia: isolamento =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.projects) = 0, 'Bia vê projeto da Ana';
  assert (select count(*) from public.audio_files) = 0, 'Bia vê arquivo da Ana';
  assert (select count(*) from public.processing_jobs) = 0, 'Bia vê jobs da Ana';
  assert (select count(*) from public.credit_transactions) = 1, 'Bia vê ledger alheio';
  begin
    perform public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'preview', null, 50, '{}');
    raise exception 'FALHA: Bia enfileirou job na pista da Ana';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
    assert sqlerrm = 'TRACK_NOT_FOUND', sqlerrm;
  end;
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'FALHA: virou admin';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ===== Worker =====
begin;
set local role service_role;
do $$
declare j public.processing_jobs; none public.processing_jobs;
begin
  perform public.worker_heartbeat('pc-1', 'meu-pc', '0.1.0', '{}');
  assert (public.processor_status() ->> 'online')::boolean, 'worker não online';
  select * into j from public.claim_job('pc-1', array['preview']::public.job_type[]);
  assert j.status = 'processing' and j.worker_id = 'pc-1', 'claim falhou';
  select * into none from public.claim_job('pc-2');
  assert none.id is null, 'job pego duas vezes';
  insert into public.audio_files (id, user_id, project_id, kind, status, storage_key, cache_key)
  values ('bbbbbbbb-0000-0000-0000-000000000002', j.user_id, j.project_id, 'preview', 'ready', 'k/prev1', j.cache_key);
  update public.processing_jobs set status = 'completed', output_file_id = 'bbbbbbbb-0000-0000-0000-000000000002', progress = 100
  where id = j.id;
end $$;
commit;

-- ===== Ana: cache hit + render =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare j public.processing_jobs; r public.processing_jobs; pv uuid;
begin
  select current_version_id into pv from public.presets where slug = 'vocal-warm';
  j := public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'preview', pv, 75, '{"start_s": 95}');
  assert j.cache_hit and j.status = 'completed', 'cache não reutilizado';
  assert j.output_file_id = 'bbbbbbbb-0000-0000-0000-000000000002', 'output errado';

  r := public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'render', pv, 75, '{"format": "wav"}');
  assert r.status = 'queued' and r.params ->> 'download_key' is not null, 'render não enfileirado';

  begin
    perform public.enqueue_track_job('cccccccc-0000-0000-0000-000000000001', 'render', pv, 75, '{"format": "exe"}');
    raise exception 'FALHA: formato inválido aceito';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
end $$;
commit;

begin;
set local role service_role;
insert into public.audio_files (id, user_id, project_id, kind, status, storage_key, cache_key, download_key, original_name)
select 'bbbbbbbb-0000-0000-0000-000000000003', user_id, project_id, 'render', 'ready', 'k/render1', cache_key, params ->> 'download_key', 'voz.wav'
from public.processing_jobs where type = 'render';
commit;

-- ===== Download: cobra 1x, re-download grátis =====
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare res jsonb;
begin
  res := public.authorize_download('bbbbbbbb-0000-0000-0000-000000000003');
  assert (res ->> 'charged')::boolean and (res ->> 'balance')::int = 4, 'primeiro download: ' || res::text;
  res := public.authorize_download('bbbbbbbb-0000-0000-0000-000000000003');
  assert not (res ->> 'charged')::boolean and (res ->> 'balance')::int = 4, 're-download cobrou: ' || res::text;
  begin
    perform public.authorize_download('bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'FALHA: preview baixável';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
    assert sqlerrm = 'FILE_NOT_DOWNLOADABLE', sqlerrm;
  end;
end $$;
commit;

-- ===== Sem saldo: bloqueia =====
begin;
set local role service_role;
select public.grant_credits('11111111-1111-1111-1111-111111111111', 'download', 'ADMIN_ADJUSTMENT', -4, 'zerar p/ teste');
insert into public.audio_files (id, user_id, project_id, kind, status, storage_key, download_key)
values ('bbbbbbbb-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'render', 'ready', 'k/render2', 'outra-chave');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    perform public.authorize_download('bbbbbbbb-0000-0000-0000-000000000004');
    raise exception 'FALHA: baixou sem crédito';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
    assert sqlerrm = 'INSUFFICIENT_CREDITS', sqlerrm;
  end;
end $$;
commit;

-- ===== Versões de preset são imutáveis =====
do $$ begin
  begin
    update public.preset_versions set notes = 'x';
    raise exception 'FALHA: versão alterada';
  exception when others then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
end $$;

select 'core_flow: todos os asserts passaram' as resultado;

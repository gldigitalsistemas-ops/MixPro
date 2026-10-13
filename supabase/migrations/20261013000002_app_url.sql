-- Endereço público do site: o serviço de processamento usa para avisar "ficou pronto" (notificação no celular).
-- Troque o valor se o domínio mudar. Idempotente.
insert into public.system_settings (key, value, description, is_public)
values ('app_url', '"https://mix-pro-20.vercel.app"'::jsonb, 'Endereço público do site (usado nos avisos de "ficou pronto").', true)
on conflict (key) do nothing;

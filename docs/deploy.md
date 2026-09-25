# Colocando no ar (custo zero)

## 1. Supabase (banco + login)

1. Crie um projeto em https://supabase.com (plano Free, região São Paulo).
2. **SQL Editor**: execute, em ordem, os arquivos de `supabase/migrations/` e depois `supabase/seed.sql`.
   - Com o CLI: `npx supabase link --project-ref <ref>` e depois `npx supabase db push`.
3. **Authentication → URL Configuration**:
   - Site URL: `https://seu-dominio.com`
   - Redirect URLs: `https://seu-dominio.com/auth/callback`
4. **Authentication → Email**: mantenha "Confirm email" ativado. Para produção, configure SMTP próprio (Resend tem plano grátis). O SMTP padrão do Supabase envia poucos e-mails por hora.
5. **Database → Replication** (opcional): ative o Realtime em `processing_jobs`. Sem isso, o app usa polling e funciona igual.
6. Torne-se admin: crie sua conta pelo app e rode no SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'SEU-EMAIL');
   ```

## 2. Cloudflare R2 (áudios)

1. Cloudflare → R2 → Create bucket `mixpro-audio` (localização automática).
2. **Settings → CORS policy** do bucket:
   ```json
   [{
     "AllowedOrigins": ["https://seu-dominio.com", "http://localhost:3000"],
     "AllowedMethods": ["GET", "PUT", "HEAD"],
     "AllowedHeaders": ["content-type", "content-length"],
     "MaxAgeSeconds": 3600
   }]
   ```
3. **Manage R2 API Tokens** → Create token com permissão *Object Read & Write* só nesse bucket. Anote Access Key, Secret e o endpoint `https://<account_id>.r2.cloudflarestorage.com`.
4. O bucket continua **privado**. Todo acesso é por URL assinada de curta duração.

> O R2 pede um cartão cadastrado para ativar, mas não cobra nada dentro do plano grátis (10 GB/mês, 1 milhão de escritas e 10 milhões de leituras).

## 3. Vercel (app)

1. Importe o repositório. **Root Directory**: `apps/web`.
2. Variáveis de ambiente: as de `apps/web/.env.example`.
3. Deploy. Depois adicione o domínio e atualize `NEXT_PUBLIC_APP_URL` e as URLs do Supabase.

## 4. Worker

Veja [worker.md](worker.md). O mesmo `.env` do worker serve para o PC e para a VPS.

## Checklist antes de abrir ao público

- [ ] Parâmetros reais nos presets (Admin → Presets) e presets ativados
- [ ] Textos de Termos e Privacidade revisados por um profissional (LGPD)
- [ ] SMTP próprio configurado no Supabase
- [ ] CORS do R2 só com o domínio de produção
- [ ] Backups do banco (Supabase Pro faz diariamente; no Free, exporte periodicamente)

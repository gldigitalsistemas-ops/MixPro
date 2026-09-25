# Mix Pro

Estúdio online de experimentação de sonoridades: o usuário envia o áudio, testa presets profissionais, compara A/B e baixa o resultado.

> Você cria o som. Nós ajudamos a encontrar a sonoridade.

## Estrutura

```
apps/web        Next.js 16 (App Router) + Tailwind 4 — app, landing, admin, API
apps/worker     Worker Python de áudio (DSP determinístico, Docker)
packages/contracts  Contrato da cadeia DSP (zod → JSON Schema p/ o worker)
supabase/       Migrações SQL (tabelas, RLS, funções), seed e testes SQL
infra/e2e       Stack local mínima (Postgres+GoTrue+PostgREST+MinIO) p/ teste ponta a ponta
docs/           Arquitetura, worker, deploy, armazenamento
```

## Arquitetura

```
Navegador ──► Next.js (Vercel) ──► Supabase: Auth · Postgres (RLS) · fila de jobs
    │                                          ▲
    └── upload/download direto ──► R2 (S3) ◄───┴── Worker (seu PC → VPS → N workers)
        por URL assinada
```

- **Processamento assíncrono.** Nenhuma requisição fica aberta esperando o áudio. O worker puxa jobs (`queued → processing → completed/failed`).
- **Créditos por ledger.** O saldo é a soma de transações. O débito é atômico no banco (`authorize_download`).
- **Presets versionados e imutáveis.** Projetos antigos continuam reproduzíveis.
- **Nada de regra comercial no código.** Tudo fica em `system_settings` (Admin → Configurações).

## Rodando localmente

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # preencha
pnpm dev                                       # http://localhost:3000
```

Worker: veja [docs/worker.md](docs/worker.md). Deploy: [docs/deploy.md](docs/deploy.md).

## Testes

| O quê | Comando |
|---|---|
| Banco (RLS, créditos, fila, admin) | `sh supabase/tests/run.sh` |
| Motor DSP e E/S de áudio | `docker build --target test apps/worker` |
| Contrato da cadeia | `pnpm --filter @mixpro/contracts test` |
| Tipos e lint do app | `pnpm --filter @mixpro/web typecheck && pnpm lint` |
| Ponta a ponta (stack real local) | `sh infra/e2e/up.sh`, `pnpm build && pnpm start` e `node apps/web/scripts/e2e.mjs` |

## Status das fases

| Fase | Status |
|---|---|
| 1. Fundação (auth, banco, dashboard, projetos) | ✅ |
| 2. Motor de áudio (upload, fila, worker, waveform, player) | ✅ |
| 3. Presets (browser, preview, A/B, intensidade, favoritos, admin) | ✅ |
| 4. Download + créditos (5 grátis, ledger, bloqueio sem saldo) | ✅ |
| 5. Multitrack e estéreo L/R | ⏳ estrutura pronta no banco |
| 6. Pagamentos (Mercado Pago, PIX/cartão, webhook) | ⏳ |
| 7. Mixagem profissional (pedidos, arquivos no PC do admin) | ⏳ |
| 8. Indicação (+10/+10) | ⏳ |
| 9–11. Admin completo, viral/PWA, AI Audio Lab | ⏳ parcial |

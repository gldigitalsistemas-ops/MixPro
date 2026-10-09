# Mix Pro

Estúdio online de tratamento, mixagem e masterização de áudio: o usuário grava, o Mix Pro transforma. Envia o áudio (ou o vídeo, só para não precisar extrair o som), vê o diagnóstico, compara A/B e baixa o resultado profissional.

> O usuário grava. O Mix Pro transforma o áudio.

## Estrutura

```
apps/web             Next.js 16 (App Router) + Tailwind 4: app, landing, admin, rotas /api
apps/export-service  Serviço de exportação (Node 22 + FFmpeg) que roda o mesmo DSP no servidor
apps/worker          Worker Python da arquitetura antiga (legado; não usado na exportação)
packages/contracts   Contratos (zod): cadeia DSP, ExportJob, destinos de volume
supabase/            Migrações SQL (tabelas, RLS, RPCs), reversões, seed e testes SQL
infra/gcp            Roteiro de implantação no Google Cloud (Cloud Shell)
docs/                Arquitetura, motor de áudio, serviço, jobs, implantação
```

## Arquitetura

O processamento padrão roda **no aparelho** (motor DSP em TypeScript num Web Worker). Contas liberadas processam **no servidor**: o navegador envia só a trilha de áudio ao R2, o Cloud Tasks aciona o Cloud Run, e o resultado volta por URL assinada; em vídeo, o áudio novo é encaixado no vídeo original **sem recodificar a imagem**. Qualquer recusa ou falha do servidor cai no aparelho.

Leia: [Arquitetura](docs/ARCHITECTURE.md) · [Motor de áudio](docs/AUDIO_ENGINE.md) · [Serviço](docs/WORKER.md) · [Jobs](docs/PROCESSING_JOBS.md) · [Implantação](docs/DEPLOYMENT.md).

## Rodando localmente

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # preencha o Supabase (o resto é opcional)
pnpm dev                                       # http://localhost:3000
```

## Testes

Os testes usam `node:test` com `tsx`. No Windows, rode o `tsx` direto (os scripts `pnpm test` usam caminhos que o `cmd` não entende):

| O quê | Comando |
|---|---|
| Motor, exportação, diagnóstico, rotas (app) | `node packages/contracts/node_modules/tsx/dist/cli.mjs --test apps/web/lib/**/*.test.ts` |
| Contratos | `cd packages/contracts && node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts` |
| Serviço, banco e nuvem de teste | `cd apps/export-service && node ../../packages/contracts/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 test/*.test.ts` |
| Tipos e lint do app | `cd apps/web && npx tsc --noEmit -p . && npx eslint` |
| Banco (RLS, créditos, admin) | `sh supabase/tests/run.sh` |

Os testes que usam FFmpeg precisam de `FFMPEG_PATH` e `FFPROBE_PATH` (sem eles são pulados). Os de banco e de nuvem precisam de `.env.export-test` (projeto Supabase **de teste**) e das chaves `R2_*`; sem eles são pulados. Nunca use as chaves de produção em teste.

## Status

| Parte | Situação |
|---|---|
| Estúdio: análise automática, presets, A/B, intensidade, destinos de volume, diagnóstico | pronto |
| Exportação no servidor (R2, fila, Cloud Run, créditos, cancelamento, histórico) | código e testes prontos; banco e R2 testados com nuvem de teste; **falta implantar no Google Cloud e liberar por conta** |
| Vídeo: só trocar o áudio sem recodificar a imagem | pronto (no aparelho, com o áudio do servidor ou local) |
| VS (separar stems) | no navegador; versão no servidor com GPU só planejada ([jobs](docs/PROCESSING_JOBS.md#vs-preparação)) |
| Remoção do código de edição de vídeo, legendas e capas | planejada para depois da fusão na `main` |

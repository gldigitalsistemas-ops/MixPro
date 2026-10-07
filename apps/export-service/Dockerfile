# Serviço de exportação de áudio (Etapa 4, fatia 3).
# Construído e testado no GitHub Actions (.github/workflows/test.yml). NÃO é construído na máquina
# de desenvolvimento.
#
#   docker build -f apps/export-service/Dockerfile -t mixpro-export .     (contexto: raiz do repositório)
#   docker run --rm mixpro-export node selftest.mjs                        (autoteste, sem rede)
#   docker run -p 8080:8080 mixpro-export                                  (serviço)

# ---------------------------------------------------------------- 1. empacotamento (esbuild)
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# só o que o empacotamento precisa (app web e contracts, que trazem mediabunny, zod, RNNoise e o
# esbuild do tsx); sem scripts de instalação (nada nativo é necessário para empacotar)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @mixpro/web --filter @mixpro/contracts
RUN node apps/export-service/scripts/build.mjs

# ---------------------------------------------------------------- 2. execução
FROM node:22-bookworm-slim
# FFmpeg do Debian bookworm, travado na série 5.1 (o Debian estável só recebe correções de
# segurança nela). Para fixar a versão exata, passe a string que o CI imprime, ex.:
#   --build-arg FFMPEG_VERSION=7:5.1.7-0+deb12u1
ARG FFMPEG_VERSION=7:5.1.*
RUN apt-get update \
 && apt-get install -y --no-install-recommends "ffmpeg=${FFMPEG_VERSION}" \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version | head -1 \
 && ffmpeg -version | head -1 | grep -q "ffmpeg version 5\.1"

WORKDIR /app
COPY --from=build /repo/apps/export-service/dist/server.mjs /repo/apps/export-service/dist/selftest.mjs ./
# só o que o autoteste usa: cadeias de presets, referência do app e AAC/MP3 sintéticos (nada pessoal)
COPY --from=build /repo/apps/web/lib/export/fixtures/chains.json /repo/apps/web/lib/export/fixtures/decode-reference.json ./fixtures/
COPY --from=build /repo/apps/web/lib/export/fixtures/decode ./fixtures/decode

ENV NODE_ENV=production \
    PORT=8080 \
    FIXTURES_DIR=/app/fixtures \
    STORAGE_DIR=/tmp/armazenamento \
    JOBS_FILE=/tmp/jobs.json
# usuário sem privilégios (já existe na imagem do Node); só /tmp é gravável na prática
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]

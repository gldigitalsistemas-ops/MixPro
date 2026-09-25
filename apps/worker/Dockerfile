# Mix Pro — worker de áudio. Mesma imagem no PC local (Docker Desktop) e na VPS Linux.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    NUMBA_CACHE_DIR=/var/cache/numba WORKER_WORK_DIR=/var/lib/mixpro
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Dependências numa camada própria (só reinstala quando o pyproject muda)
COPY pyproject.toml ./
RUN mkdir mixpro_worker && touch mixpro_worker/__init__.py  && pip install . && pip uninstall -y mixpro-worker && rm -rf mixpro_worker build *.egg-info
COPY mixpro_worker ./mixpro_worker
RUN pip install --no-deps .

# ---- testes: docker build --target test .
FROM base AS test
RUN pip install ".[dev]"
COPY tests ./tests
RUN mkdir -p /var/cache/numba && python -m pytest -q

# ---- produção
FROM base AS runtime
RUN useradd --create-home --uid 10001 mixpro \
 && mkdir -p /var/cache/numba /var/lib/mixpro \
 && chown -R mixpro /var/cache/numba /var/lib/mixpro
USER mixpro
VOLUME ["/var/lib/mixpro"]
CMD ["python", "-m", "mixpro_worker"]

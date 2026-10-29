# syntax=docker/dockerfile:1

# Build-time limits for small machines. CI can raise BUILD_JOBS; a dev build
# can set WITH_LLAMA=0 to skip the llama.cpp compile and test only Ollama.
ARG BUILD_JOBS=2
ARG WITH_LLAMA=1

# ---- Frontend: build the dashboard static assets -------------------------
FROM node:25-bookworm AS web
WORKDIR /web
# Mantem o build do Vite dentro dos 1 GiB, como os alvos do Makefile.
ENV NODE_OPTIONS=--max-old-space-size=1024 \
    UV_THREADPOOL_SIZE=2
RUN npm install -g pnpm@12.6.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# O worker do navegador importa o nucleo puro de analise do app (mesmo
# contrato, sem copia). No repositorio ele esta em mobile/src/core; este COPY
# reproduz o caminho relativo esperado pelo Vite dentro da imagem.
COPY mobile/src/core /mobile/src/core
RUN pnpm build

# ---- Backend: build the Go binary with the dashboard embedded ------------
FROM golang:1.27-bookworm AS gobuild
WORKDIR /src
# Mesmos tetos da suite local: a build nao pode estourar a VPS pequena.
ENV GOMAXPROCS=2 \
    GOGC=50 \
    GOMEMLIMIT=768MiB \
    GOFLAGS=-p=1
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./internal/webui/dist
ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false \
    -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${DATE}" \
    -o /out/diary ./cmd/diary

# ---- whisper.cpp: build whisper-cli from source, pinned by tag -----------
FROM debian:bookworm-slim AS whisper
ARG WHISPER_REPO=https://github.com/ggml-org/whisper.cpp
ARG WHISPER_REF=v1.9.5
ARG BUILD_JOBS=2
# Ordena as etapas pesadas: o frontend termina antes de o whisper compilar,
# para web e C++ nao disputarem a RAM ao mesmo tempo no BuildKit.
COPY --from=web /web/dist /tmp/web-dist
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git cmake build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_REF}" "${WHISPER_REPO}" /whisper
WORKDIR /whisper
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release -j"${BUILD_JOBS}" --target whisper-cli

# ---- llama.cpp: build llama-server for the embedded local analysis --------
# The binary is optional at runtime: a build without it still serves the
# dashboard and returns "local_unavailable" for the embedded provider.
# WITH_LLAMA=0 produces a disabled stub so dev images stay small and fast; the
# dashboard detects it by running "llama-server --version".
FROM debian:bookworm-slim AS llama
ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_REF=v0.8.0
ARG BUILD_JOBS=2
ARG WITH_LLAMA=1
# Whisper compila antes; assim whisper.cpp e llama.cpp nao rodam juntos.
COPY --from=whisper /whisper/build/bin/whisper-cli /tmp/whisper-cli
RUN if [ "$WITH_LLAMA" = "1" ]; then \
        apt-get update && apt-get install -y --no-install-recommends \
            ca-certificates git cmake build-essential \
        && rm -rf /var/lib/apt/lists/*; \
    fi
RUN if [ "$WITH_LLAMA" = "1" ]; then \
        git clone --depth 1 --branch "${LLAMA_REF}" "${LLAMA_REPO}" /llama; \
    else \
        mkdir -p /llama; \
    fi
WORKDIR /llama
RUN mkdir -p build/bin && \
    if [ "$WITH_LLAMA" = "1" ]; then \
        cmake -B build -DCMAKE_BUILD_TYPE=Release \
            -DBUILD_SHARED_LIBS=OFF \
            -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_APP=OFF \
            -DLLAMA_BUILD_TOOLS=ON -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF \
        && cmake --build build --config Release -j"${BUILD_JOBS}" --target llama-server; \
    else \
        printf '#!/bin/sh\necho "llama.cpp embutido nao foi compilado nesta imagem (WITH_LLAMA=0)" >&2\nexit 1\n' \
            > build/bin/llama-server; \
        chmod +x build/bin/llama-server; \
    fi

# ---- Litestream: optional continuous replication -------------------------
FROM debian:bookworm-slim AS litestream
ARG LITESTREAM_VERSION=0.5.17
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/litestream.tar.gz \
    "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz" \
    && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz litestream

# ---- Dev: Go toolchain with air for hot reload ---------------------------
FROM golang:1.27-bookworm AS dev
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN go install github.com/air-verse/air@v1.62.0
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=llama /llama/build/bin/llama-server /usr/local/bin/llama-server
COPY go.mod go.sum ./
RUN go mod download
COPY . .
EXPOSE 8080
CMD ["air", "-c", ".air.toml"]

# ---- Runtime: lean base image (default target) ---------------------------
FROM debian:bookworm-slim AS final
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=llama /llama/build/bin/llama-server /usr/local/bin/llama-server
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=gobuild /out/diary /usr/local/bin/diary
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DIARY_HTTP_ADDR=:8080 \
    DIARY_DB_PATH=/data/diary.db \
    DIARY_DATA_DIR=/data \
    DIARY_MODELS_DIR=/models \
    DIARY_WHISPER_BIN=whisper-cli \
    DIARY_WHISPER_MODEL=/models/ggml-small-q5_1.bin \
    DIARY_LLAMA_SERVER_BIN=llama-server

VOLUME ["/data", "/models"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

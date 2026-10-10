# syntax=docker/dockerfile:1

# ---- Frontend: build the dashboard static assets -------------------------
FROM node:22-bookworm AS web
WORKDIR /web
RUN npm install -g pnpm@12.6.0
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- Backend: build the Go binary with the dashboard embedded ------------
FROM golang:1.27-bookworm AS gobuild
WORKDIR /src
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
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git cmake build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_REF}" "${WHISPER_REPO}" /whisper
WORKDIR /whisper
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release -j"$(nproc)" --target whisper-cli

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
COPY go.mod go.sum ./
RUN go mod download
COPY . .
EXPOSE 8080
CMD ["air", "-c", ".air.toml"]

# ---- Runtime: lean base image (default target) ---------------------------
FROM debian:bookworm-slim AS final
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=gobuild /out/diary /usr/local/bin/diary
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DIARY_HTTP_ADDR=:8080 \
    DIARY_DB_PATH=/data/diary.db \
    DIARY_DATA_DIR=/data \
    DIARY_MODELS_DIR=/models \
    DIARY_WHISPER_BIN=whisper-cli \
    DIARY_WHISPER_MODEL=/models/ggml-small-q5_1.bin

VOLUME ["/data", "/models"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

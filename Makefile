SHELL := /bin/bash

GO ?= go
PNPM ?= pnpm
COMPOSE ?= docker compose

# Tetos de memoria para desenvolvimento (VPS pequena; ver AGENTS.md).
# Velocidade importa menos que estabilidade: prefira testes lentos a OOM.
GOMAXPROCS ?= 2
GOGC ?= 50
GOMEMLIMIT ?= 768MiB
GOFLAGS ?= -p=1
NODE_MAX_OLD_SPACE ?= 1024
export GOMAXPROCS GOGC GOMEMLIMIT GOFLAGS
DEV_FILE ?= deploy/compose.dev.yml
IMAGE ?= diary:dev
VERSION ?= dev
# Build da imagem em VPS pequena: menos jobs e um teto por container de build.
# CI pode subir BUILD_JOBS; `make dev` compila sem llama.cpp por padrao.
BUILD_JOBS ?= 2
DEV_WITH_LLAMA ?= 0
PROD_WITH_LLAMA ?= 1
BUILD_MEMORY ?= 3g
DOCKER_BUILD_FLAGS ?= --resource memory=$(BUILD_MEMORY)
MODELS_DIR ?= models
MODELS ?= small-q5_1 medium-q5_0
MODELS_BASE_URL ?= https://huggingface.co/ggerganov/whisper.cpp/resolve/main
OLLAMA_MODEL ?= qwen2.5:0.5b
WEB_PORT ?= 5173
API_PORT ?= 8080
# Porta HTTPS do tailscale serve para o dyarium. NUNCA use a 443: ela e do
# Traefik. O dashboard e a API ficam no mesmo endereco; o proxy do dashboard
# encaminha /api/v1 para o servidor.
TAILSCALE_WEB_PORT ?= 8445

COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(DATE)

.PHONY: help dev dev-llama dev-opencode down build test test-go test-web lint lint-go lint-web fmt dedupe bench-transcricao models tailscale tailscale-off clean mobile-dev mobile-test mobile-lint ai

help: ## Lista os alvos disponiveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

dev: ## Sobe os containers de desenvolvimento com recarga automatica (sem llama.cpp)
	WITH_LLAMA=$(DEV_WITH_LLAMA) BUILD_JOBS=$(BUILD_JOBS) DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) build --memory $(BUILD_MEMORY)
	WITH_LLAMA=$(DEV_WITH_LLAMA) BUILD_JOBS=$(BUILD_JOBS) DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) up

dev-llama: ## Sobe o dev com llama.cpp embutido (build pesado; usa BUILD_JOBS)
	WITH_LLAMA=1 BUILD_JOBS=$(BUILD_JOBS) DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) build --memory $(BUILD_MEMORY)
	WITH_LLAMA=1 BUILD_JOBS=$(BUILD_JOBS) DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) up

dev-opencode: ## Dev na rede do host (permite usar o opencode local na analise)
	WITH_LLAMA=$(DEV_WITH_LLAMA) BUILD_JOBS=$(BUILD_JOBS) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) -f deploy/compose.dev.hostnet.yml build --memory $(BUILD_MEMORY)
	WITH_LLAMA=$(DEV_WITH_LLAMA) BUILD_JOBS=$(BUILD_JOBS) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) -f deploy/compose.dev.hostnet.yml up

down: ## Derruba os containers de desenvolvimento
	DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) down

build: ## Gera a imagem de producao (tag local diary:dev)
	docker build $(DOCKER_BUILD_FLAGS) -f deploy/Dockerfile -t $(IMAGE) \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		--build-arg DATE=$(DATE) \
		--build-arg BUILD_JOBS=$(BUILD_JOBS) \
		--build-arg WITH_LLAMA=$(PROD_WITH_LLAMA) \
		.

test: test-go test-web ## Roda os testes do Go e do frontend

test-go:
	$(GO) test -p 1 -parallel 2 ./...

test-web:
	NODE_OPTIONS="--max-old-space-size=$(NODE_MAX_OLD_SPACE)" $(PNPM) -C web test

lint: lint-go lint-web ## Roda go vet, gofmt e o lint do frontend

lint-go:
	$(GO) vet ./...
	@test -z "$$(gofmt -l .)" || { echo "gofmt encontrou arquivos nao formatados"; exit 1; }

lint-web:
	NODE_OPTIONS="--max-old-space-size=$(NODE_MAX_OLD_SPACE)" $(PNPM) -C web lint

fmt: ## Formata o codigo Go
	gofmt -w .

dedupe: ## Mescla as notas duplicadas do mesmo audio (DRY=1 simula)
	$(GO) run ./cmd/diary dedupe $(if $(DRY),--dry-run,)

mobile-dev: ## Sobe o app Expo apontando para a tailnet (abre no celular)
	bash scripts/mobile-dev.sh

mobile-test: ## Roda os testes do app (Jest no nucleo; Maestro quando disponivel)
	NODE_OPTIONS="--max-old-space-size=$(NODE_MAX_OLD_SPACE)" $(PNPM) -C mobile test

mobile-lint: ## Roda o lint do app
	NODE_OPTIONS="--max-old-space-size=$(NODE_MAX_OLD_SPACE)" $(PNPM) -C mobile lint

bench-transcricao: ## Roda o benchmark de transcricao e imprime o pico de memoria
	bash scripts/bench-transcricao.sh

models: ## Baixa os modelos ggml para MODELS_DIR
	@mkdir -p $(MODELS_DIR)
	@for m in $(MODELS); do \
		file=$(MODELS_DIR)/ggml-$$m.bin; \
		if [ -f "$$file" ]; then echo "ja existe: $$file"; continue; fi; \
		echo "baixando $$file"; \
		curl -fL --retry 3 -o "$$file" "$(MODELS_BASE_URL)/ggml-$$m.bin"; \
	done

tailscale: ## Expoe dashboard e API no mesmo endereco da tailnet via HTTPS
	tailscale serve --bg --https=$(TAILSCALE_WEB_PORT) http://127.0.0.1:$(WEB_PORT)
	@tailscale serve status || true

tailscale-off: ## Remove so a exposicao do dyarium na tailnet (preserva os outros servicos)
	tailscale serve --https=$(TAILSCALE_WEB_PORT) off || true

ai: ## Baixa o modelo padrao do Ollama (o servico sobe com `make dev`)
	DIARY_API_PORT=$(API_PORT) DIARY_WEB_PORT=$(WEB_PORT) $(COMPOSE) -f $(DEV_FILE) up -d ollama
	$(COMPOSE) -f $(DEV_FILE) exec -T ollama ollama pull $(OLLAMA_MODEL)

clean: ## Remove artefatos locais
	rm -rf web/dist bin tmp

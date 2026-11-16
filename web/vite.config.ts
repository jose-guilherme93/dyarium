import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Os arquivos do ONNX Runtime ficam em public/ort para o build. No dev o Vite
 * se recusa a importar arquivos de public/, e o runtime faz `import()` do glue
 * .mjs. Este middleware serve o diretorio do pacote com o MIME correto.
 */
const ORT_ASSETS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

/**
 * O Worker recusa asset acima de 25 MiB. O wasm do ONNX (variante asyncify,
 * 25,6 MiB) entra no bundle pelo worker de inferencia, que no site hospedado
 * esta desligado — a transcricao vai pelo provedor do usuario. O arquivo fica
 * de fora do pacote: nenhuma rota do site o carrega.
 */
function dropOversizedAssets(): Plugin {
  return {
    name: "drop-oversized-assets",
    generateBundle(_options, bundle) {
      const limite = 25 * 1024 * 1024;
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type !== "asset") continue;
        const tamanho =
          typeof item.source === "string" ? Buffer.byteLength(item.source) : item.source.byteLength;
        if (tamanho > limite) {
          this.warn(`asset acima do limite do Cloudflare removido: ${name} (${Math.round(tamanho / 1048576)} MiB)`);
          delete bundle[name];
        }
      }
    },
  };
}

function ortRuntimeAssets(): Plugin {
  const dir = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist", import.meta.url));
  return {
    name: "ort-runtime-assets",
    // No build, os arquivos vao direto para dist/ort. Sem public/ort, o dev no
    // host e o container nao disputam arquivos gerados com donos diferentes.
    generateBundle() {
      // Os arquivos do ORT passam de 25 MiB e o Cloudflare recusa asset desse
      // tamanho. Eles so servem ao /lab (worker de inferencia), que roda no
      // servidor Go. No build hospedado (padrao) ficam de fora; para o build
      // self-hosted, defina VITE_ORT=1.
      if (process.env.VITE_ORT !== "1") return;
      for (const name of ORT_ASSETS) {
        this.emitFile({
          type: "asset",
          fileName: `ort/${name}`,
          source: readFileSync(join(dir, name)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use("/ort", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!/^[a-z0-9.-]+\.(mjs|wasm)$/i.test(name)) {
          next();
          return;
        }
        const file = join(dir, name);
        if (!existsSync(file)) {
          next();
          return;
        }
        res.setHeader(
          "Content-Type",
          extname(name) === ".wasm" ? "application/wasm" : "text/javascript",
        );
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// The dev server proxies API and health calls to the Go backend so the SPA and
// the API share an origin while developing.
export default defineConfig({
  plugins: [react(), dropOversizedAssets(), ortRuntimeAssets()],
  // O worker importa o nucleo puro de `mobile/src/core`. Sem um tsconfig fixo,
  // o Vite leria `mobile/tsconfig.json`, que estende `expo/tsconfig.base` e nao
  // existe no job do web (que instala so as dependencias do web).
  tsconfig: "./tsconfig.json",
  // O nucleo (`mobile/src/core`) usa `@/` para si mesmo. O alias vale aqui
  // tambem, entao `repo`, `schema` e `port` entram sem reescrever import.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../mobile/src", import.meta.url)),
    },
  },
  define: {
    // `__DEV__` e global no React Native; o nucleo puro o usa num log.
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    // O worker importa mobile/src/core, que fica um nivel acima da raiz do
    // Vite. Sem isto o servidor de desenvolvimento recusa o arquivo.
    fs: { allow: [".."] },
    // O laboratorio (/lab) precisa de isolamento para SharedArrayBuffer. Em
    // producao o servidor Go manda estes headers apenas nessa rota.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
      "/healthz": {
        target: process.env.VITE_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
      // O MCP usa SSE; o proxy repassa o stream para o backend Go. Sem isto o
      // comando gerado no painel aponta para o Vite e recebe 404.
      "/mcp": {
        target: process.env.VITE_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
      "/setup": {
        target: process.env.VITE_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  // O worker de inferencia e carregado sob demanda. Sem declarar as engines
  // aqui, o Vite descobre a dependencia no primeiro start e recarrega a pagina,
  // matando o download do modelo no meio.
  optimizeDeps: {
    include: ["@huggingface/transformers", "@wllama/wllama/esm/index.js"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // O worker do /lab carrega o onnxruntime, cujo wasm passa de 25 MiB — o
      // limite por arquivo do Cloudflare. No build hospedado o /lab nao existe
      // (nao ha servidor), entao o runtime fica de fora. O build self-hosted
      // usa VITE_ORT=1 e leva tudo.
      external: process.env.VITE_ORT === "1" ? [] : [/^onnxruntime-web/],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/vitest.setup.ts",
    css: false,
  },
});

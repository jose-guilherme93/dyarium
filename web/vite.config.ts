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

function ortRuntimeAssets(): Plugin {
  const dir = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist", import.meta.url));
  return {
    name: "ort-runtime-assets",
    // No build, os arquivos vao direto para dist/ort. Sem public/ort, o dev no
    // host e o container nao disputam arquivos gerados com donos diferentes.
    generateBundle() {
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
  plugins: [react(), ortRuntimeAssets()],
  // O worker importa o nucleo puro de `mobile/src/core`. Sem um tsconfig fixo,
  // o Vite leria `mobile/tsconfig.json`, que estende `expo/tsconfig.base` e nao
  // existe no job do web (que instala so as dependencias do web).
  tsconfig: "./tsconfig.json",
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
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/vitest.setup.ts",
    css: false,
  },
});

/** wa-sqlite nao publica tipos para o modulo wasm nem para os VFS de exemplo. */

declare module "wa-sqlite/dist/wa-sqlite.mjs" {
  const factory: (options?: {
    locateFile?: (file: string) => string;
  }) => Promise<Parameters<typeof import("wa-sqlite").Factory>[0]>;
  export default factory;
}

declare module "wa-sqlite/src/examples/AccessHandlePoolVFS.js" {
  export class AccessHandlePoolVFS {
    constructor(directoryPath: string);
    readonly isReady: Promise<void>;
  }
}

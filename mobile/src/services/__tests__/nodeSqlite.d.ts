/**
 * Tipos minimos de `node:sqlite` para o teste de migracao. O projeto nao
 * depende de @types/node; o teste roda no Node do Jest e usa o banco em memoria
 * apenas para aplicar as migracoes reais do app.
 */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown;
    };
  }
}

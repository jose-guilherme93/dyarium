import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportJobState } from "./importJob";
import type { ImportResult } from "./import";
import type { Diagnosis } from "./diagnose";

// Nada aqui toca a rede nem o banco: a tarefa e o que se quer provar, entao o
// diagnostico, a fonte HTTP e a importacao em si sao dublados.
const mocks = vi.hoisted(() => ({
  importEntries: vi.fn(),
  serverSource: vi.fn(() => ({ fonte: true })),
  diagnoseSource: vi.fn(async (): Promise<Diagnosis> => ({ ok: true })),
  flushVaultSync: vi.fn(async () => null),
}));

vi.mock("./import", () => ({ importEntries: mocks.importEntries }));
vi.mock("./serverSource", () => ({ serverSource: mocks.serverSource }));
vi.mock("./diagnose", () => ({ diagnoseSource: mocks.diagnoseSource }));
vi.mock("./folderSync", () => ({ flushVaultSync: mocks.flushVaultSync }));

const RESULTADO: ImportResult = {
  created: 400,
  updated: 19,
  trashed: 0,
  failed: 0,
  total: 419,
  notebooks: 0,
  covers: 0,
  coversFailed: 0,
  audios: 12,
  audiosFailed: 0,
  transcripts: 0,
  transcriptsFailed: 0,
  analyses: 0,
  analysesFailed: 0,
};

let job: typeof import("./importJob");

/** Cada teste recebe um modulo limpo: o estado da tarefa vive no modulo. */
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mocks.importEntries.mockReset();
  mocks.serverSource.mockReset().mockReturnValue({ fonte: true });
  mocks.diagnoseSource.mockReset().mockResolvedValue({ ok: true });
  mocks.flushVaultSync.mockReset().mockResolvedValue(null);
  job = await import("./importJob");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Deixa as promessas pendentes da tarefa correrem sem depender de tempo. */
async function assentar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function ouvir(): { estados: ImportJobState[]; fim: Promise<ImportJobState> } {
  const estados: ImportJobState[] = [];
  let termina!: (estado: ImportJobState) => void;
  const fim = new Promise<ImportJobState>((resolve) => {
    termina = resolve;
  });
  job.subscribeImportJob(() => {
    const estado = job.importJobState();
    estados.push(estado);
    if (estado.status === "done" || estado.status === "error") termina(estado);
  });
  return { estados, fim };
}

describe("importJob", () => {
  it("entrega a tarefa e volta na hora, avisando o progresso aos ouvintes", async () => {
    let libera!: () => void;
    const espera = new Promise<void>((resolve) => {
      libera = resolve;
    });
    mocks.importEntries.mockImplementation(async (_fonte, onProgress) => {
      onProgress({ done: 213, total: 419 });
      await espera;
      return RESULTADO;
    });

    const { estados, fim } = ouvir();
    const retorno = job.startServerImport("https://exemplo.invalido", "token-secreto");
    // O dialogo nao recebe promessa nenhuma: ele fecha e a tarefa continua.
    expect(retorno).toBeUndefined();

    await assentar();
    expect(mocks.serverSource).toHaveBeenCalledWith("https://exemplo.invalido", "token-secreto");
    expect(mocks.importEntries).toHaveBeenCalledTimes(1);
    expect(job.importJobState()).toEqual({ status: "running", done: 213, total: 419 });
    expect(estados).toContainEqual({ status: "running", done: 213, total: 419 });

    libera();
    const final = await fim;
    expect(final).toEqual({ status: "done", result: RESULTADO });
  });

  it("uma tarefa por vez: pedir de novo durante a importacao nao inicia outra", async () => {
    mocks.importEntries.mockImplementation(() => new Promise(() => undefined));

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await assentar();
    job.startServerImport("https://outro.invalido", "outro-token");
    await assentar();

    expect(mocks.importEntries).toHaveBeenCalledTimes(1);
    expect(mocks.serverSource).toHaveBeenCalledTimes(1);
    expect(job.importJobState().status).toBe("running");
  });

  it("guarda o resultado quando termina", async () => {
    mocks.importEntries.mockResolvedValue(RESULTADO);
    const { fim } = ouvir();

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await fim;

    expect(job.importJobState()).toEqual({ status: "done", result: RESULTADO });
  });

  it("erro vira uma mensagem sem token e sem endereco", async () => {
    mocks.importEntries.mockRejectedValue(
      new Error("falha ao ler https://exemplo.invalido com o token token-secreto"),
    );
    const { fim } = ouvir();

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    const final = await fim;

    expect(final.status).toBe("error");
    const estado = job.importJobState();
    expect(estado.status).toBe("error");
    const texto = JSON.stringify(estado);
    expect(texto).not.toContain("token-secreto");
    expect(texto).not.toContain("exemplo.invalido");
    // Continua legivel: o que nao pode aparecer e o segredo, nao a causa.
    expect(estado.status === "error" ? estado.message : "").toContain("falha ao ler");
  });

  it("diagnostico recusado vira a causa em uma linha, sem importar nada", async () => {
    mocks.diagnoseSource.mockResolvedValue({
      ok: false,
      reason: "cors",
      hint: "O servidor respondeu, mas nao autoriza esta pagina a ler a resposta.",
    });
    const { fim } = ouvir();

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await fim;

    expect(mocks.importEntries).not.toHaveBeenCalled();
    expect(job.importJobState()).toEqual({
      status: "error",
      message: "O servidor respondeu, mas nao autoriza esta pagina a ler a resposta.",
    });
  });

  it("agenda o flush do cofre uma vez, 5 s depois do fim", async () => {
    mocks.importEntries.mockResolvedValue(RESULTADO);
    const { fim } = ouvir();

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await fim;

    await vi.advanceTimersByTimeAsync(4999);
    expect(mocks.flushVaultSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.flushVaultSync).toHaveBeenCalledTimes(1);

    // Nada de repetir o sync a cada segundo: uma vez por tarefa.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.flushVaultSync).toHaveBeenCalledTimes(1);
  });

  it("progresso parado por 3 min vira erro com a nota onde parou", async () => {
    mocks.importEntries.mockImplementation(
      async (_fonte, onProgress) => {
        onProgress({ done: 413, total: 420 });
        return new Promise<ImportResult>(() => undefined);
      },
    );
    const { fim } = ouvir();

    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await assentar();
    expect(job.importJobState()).toEqual({ status: "running", done: 413, total: 420 });

    // Um segundo antes do prazo a tarefa continua: o vigia conta o silencio.
    await vi.advanceTimersByTimeAsync(179_999);
    expect(job.importJobState().status).toBe("running");

    await vi.advanceTimersByTimeAsync(1);
    expect(job.importJobState()).toEqual({
      status: "error",
      message: "a importacao parou na nota 413 de 420; o que entrou ficou salvo",
    });
    await fim;

    // O que entrou merece o sync, mesmo com a tarefa encerrada pelo vigia.
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.flushVaultSync).toHaveBeenCalledTimes(1);
    // E nao agenda de novo quando a requisicao abandonada responde tarde.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.flushVaultSync).toHaveBeenCalledTimes(1);
  });

  it("dismissImportJob encerra a tarefa presa e libera uma nova importacao", async () => {
    mocks.importEntries.mockImplementation(() => new Promise(() => undefined));
    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await assentar();
    expect(job.importJobState().status).toBe("running");

    // Sem esperar os 3 min: a pessoa fecha e a trava some.
    job.dismissImportJob();
    expect(job.importJobState()).toEqual({ status: "idle" });

    mocks.importEntries.mockResolvedValue(RESULTADO);
    const { fim } = ouvir();
    job.startServerImport("https://outro.invalido", "outro-token");
    await fim;

    expect(mocks.importEntries).toHaveBeenCalledTimes(2);
    expect(job.importJobState()).toEqual({ status: "done", result: RESULTADO });
  });

  it("o resultado some da faixa depois de 8 s; o erro fica ate fechar", async () => {
    mocks.importEntries.mockResolvedValue(RESULTADO);
    const primeiro = ouvir();
    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await primeiro.fim;

    expect(job.importJobState().status).toBe("done");
    await vi.advanceTimersByTimeAsync(8000);
    expect(job.importJobState()).toEqual({ status: "idle" });

    // Erro nao some sozinho: so a pessoa fecha, depois de ler a causa.
    mocks.importEntries.mockRejectedValue(new Error("500 falha"));
    const segundo = ouvir();
    job.startServerImport("https://exemplo.invalido", "token-secreto");
    await segundo.fim;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(job.importJobState().status).toBe("error");

    job.dismissImportJob();
    expect(job.importJobState()).toEqual({ status: "idle" });
  });
});

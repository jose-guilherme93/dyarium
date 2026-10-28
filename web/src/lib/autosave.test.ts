import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";

afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosave", () => {
  it("agrupa edicoes rapidas e grava so a ultima", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const autosave = createAutosave(save, 800);

    autosave.schedule("a");
    autosave.schedule("b");
    autosave.schedule("c");
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c");
  });

  it("flush grava imediatamente o pendente", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const autosave = createAutosave(save, 800);

    autosave.schedule("a");
    await autosave.flush();
    expect(save).toHaveBeenCalledWith("a");
  });

  it("serializa as gravacoes sem perder a ultima", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi.fn().mockImplementationOnce(() => inFlight).mockResolvedValue(undefined);
    const autosave = createAutosave(save, 800);

    autosave.schedule("a");
    const first = autosave.flush(); // comeca a gravar "a"
    autosave.schedule("b"); // chega enquanto "a" esta em voo
    const second = autosave.flush(); // deve gravar "b" depois de "a"

    await Promise.resolve(); // deixa a fila iniciar a primeira gravacao
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("a");

    release();
    await first;
    await second;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("b");
  });

  it("cancel descarta o pendente sem gravar", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const autosave = createAutosave(save, 800);

    autosave.schedule("a");
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

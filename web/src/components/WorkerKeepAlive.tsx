import { useEffect, useState } from "react";
import { getWorkerState, subscribeWorker } from "../lib/browserWorker";

/**
 * Efeitos de vida do worker enquanto ele esta ativo, independente da tela
 * aberta: aviso ao fechar a aba e pedido para a tela nao suspender o navegador.
 */
export function WorkerKeepAlive() {
  const [state, setState] = useState(getWorkerState());
  useEffect(() => subscribeWorker(setState), []);
  const running = state !== null && state.phase !== "idle" && state.phase !== "error";

  useEffect(() => {
    if (!running) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    const wake = (
      navigator as unknown as {
        wakeLock?: { request(type: string): Promise<{ release(): Promise<void> }> };
      }
    ).wakeLock;
    let lock: { release(): Promise<void> } | null = null;
    void wake
      ?.request("screen")
      .then((held) => {
        lock = held;
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      void lock?.release().catch(() => undefined);
    };
  }, [running]);

  return null;
}

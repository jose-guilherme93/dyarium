import { useEffect } from "react";
import { vaultStats } from "../local/vaultStats";
import { driveMarked } from "../local/driveMark";
import { pulseBoot } from "../lib/pulse";

/**
 * Componente sem UI: dispara o pulso de "boot" uma vez por montagem, quando
 * o navegador estiver ocioso. O numero de notas e bytes vem do cofre local.
 */
export function PulseBoot(): null {
  useEffect(() => {
    let cancelled = false;
    let handle = 0;

    const run = () => {
      void (async () => {
        try {
          const stats = await vaultStats();
          if (cancelled) return;
          pulseBoot({
            notes: stats.notes,
            bytes: stats.bytes,
            has_drive: driveMarked(),
          });
        } catch {
          if (cancelled) return;
          pulseBoot({ has_drive: driveMarked() });
        }
      })();
    };

    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      handle = ric(run);
      return () => {
        cancelled = true;
        const cic = (
          window as unknown as { cancelIdleCallback?: (h: number) => void }
        ).cancelIdleCallback;
        if (typeof cic === "function") cic(handle);
      };
    }

    handle = window.setTimeout(run, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  return null;
}

export default PulseBoot;

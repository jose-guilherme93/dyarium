/**
 * Interruptor "neste PC" ao lado do botao Analisar.
 *
 * Analisar e a unica acao: o interruptor so decide onde a nota e processada.
 * Ligado, ele mede a maquina e deixa os modelos prontos; nada entra na fila
 * sozinho. A nota que o usuario mandar analisar e a unica que este PC pega.
 * Desligado, a VPS volta a processar como sempre.
 */

import { useEffect, useRef, useState } from "react";
import {
  getWorkerState,
  handOffWorker,
  startWorker,
  subscribeWorker,
} from "../lib/browserWorker";
import { formatBytes, planDownloadBytes } from "../lib/browserModels";
import { browserCacheAvailable } from "../lib/browserCache";
import { multithreadAvailable, prepareWorkerSetup, type WorkerSetup } from "../lib/workerSetup";
import { useEscape } from "../lib/useEscape";
import { CpuIcon } from "./icons";
import { Spinner } from "./Status";

interface ProcessOnPcProps {
  hasAnalysis: boolean;
}

function isActive(phase: string | undefined): boolean {
  return phase === "preparing" || phase === "waiting" || phase === "working" || phase === "stopping";
}

export function ProcessOnPc({ hasAnalysis }: ProcessOnPcProps) {
  const [state, setState] = useState(getWorkerState());
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<WorkerSetup | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => subscribeWorker(setState), []);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const running = state !== null && isActive(state.phase);
  const preparing = state?.phase === "preparing";
  const singleThread = !multithreadAvailable();

  const toggle = async () => {
    if (starting) {
      // O interruptor tambem cancela o download em andamento.
      await cancelStart();
      return;
    }
    if (running) {
      // Desligar devolve a nota em andamento para a VPS na hora: a aba nao
      // fica presa esperando um modelo lento terminar.
      setStarting(true);
      await handOffWorker();
      setStarting(false);
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!setup) {
      try {
        setSetup(await prepareWorkerSetup());
      } catch {
        setError("Não foi possível ler o hardware deste navegador.");
      }
    }
  };

  const start = async () => {
    if (!setup) return;
    setStarting(true);
    setError("");
    try {
      await startWorker(setup.plan, setup.caps, setup.allowGpu, setup.threads, setup.device);
      const after = getWorkerState();
      if (!after || after.phase === "error" || after.phase === "idle") {
        throw new Error(after?.lastError || "não foi possível iniciar o processamento neste PC");
      }
      setOpen(false);
    } catch (reason) {
      // Parar durante o download encerra o worker de proposito: isso nao e uma
      // falha para mostrar.
      if (!getWorkerState()) {
        setOpen(false);
        return;
      }
      setError(reason instanceof Error ? reason.message : "falha ao iniciar o processamento");
    } finally {
      setStarting(false);
    }
  };

  const cancelStart = async () => {
    await handOffWorker();
    setStarting(false);
    setOpen(false);
  };

  const size = setup ? planDownloadBytes(setup.plan) : 0;

  return (
    <div className="process-pc">
      <button
        ref={trigger}
        type="button"
        role="switch"
        aria-checked={running}
        className={running ? "process-pc-switch process-pc-switch--on" : "process-pc-switch"}
        onClick={() => void toggle()}
        aria-label="Processar neste computador"
        title={running ? "Ligado neste computador" : "Processar neste computador"}
      >
        <span className="process-pc-track" aria-hidden>
          <span className="process-pc-knob" />
        </span>
        neste PC
        {(starting || preparing) && <Spinner />}
      </button>

      {open && (
        <div className="process-pc-panel" ref={panel} role="group" aria-label="Processamento neste computador">
          <div className="process-pc-head">
            <strong>Neste PC</strong>
            <span className="hint">{setup ? setup.plan.label : "medindo este computador…"}</span>
          </div>
          {setup ? (
            <>
              <p className="hint process-pc-models">
                {setup.plan.whisper.label} + {setup.plan.llm.label}
              </p>
              <p className="hint">
                {browserCacheAvailable()
                  ? `${formatBytes(size)} na primeira vez; depois fica no cache deste navegador.`
                  : `${formatBytes(size)} a cada início: sem HTTPS o navegador não guarda o modelo.`}
              </p>
              <p className="hint" title="Núcleos usados na análise. Sem HTTPS o llama.cpp fica em uma thread, então o valor não se aplica.">
                {singleThread ? "uma thread" : `${setup.threads} núcleos`}
              </p>
              <p className="hint" title="Este nome fica guardado na análise, para saber que ela rodou localmente neste aparelho.">
                {setup.device.name}
              </p>
              <p className="hint">Só a nota que você mandar analisar.</p>
              {hasAnalysis ? <p className="hint">A análise atual será substituída.</p> : null}
            </>
          ) : (
            <p className="hint">Lendo GPU, memória e o melhor perfil para esta máquina.</p>
          )}
          {starting && state?.engine && state.engine.stage !== "ready" && (
            <div className="process-pc-progress">
              <div
                className="analysis-meter"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.max(0, state.engine.progress) * 100)}
              >
                <span style={{ width: `${Math.round(Math.max(0, state.engine.progress) * 100)}%` }} />
              </div>
              <span className="hint">
                {state.engine.progress >= 0
                  ? `${Math.round(state.engine.progress * 100)}%`
                  : "preparando"}
              </span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="process-pc-actions">
            {starting ? (
              <button type="button" className="button button--ghost button--small" onClick={() => void cancelStart()}>
                Parar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void start()}
                  disabled={!setup}
                >
                  <CpuIcon size={14} />
                  Ligar
                </button>
                <button type="button" className="button button--ghost button--small" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProcessOnPc;

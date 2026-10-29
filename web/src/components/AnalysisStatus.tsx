/**
 * Estado real de uma analise em andamento.
 *
 * Quando a nota esta rodando neste PC, o servidor nao sabe em que bloco ela
 * esta: quem sabe e o worker da aba. Este bloco le esse estado e mostra numero,
 * medidor e tempo, em vez de um "Analisando..." que nunca muda. O botao
 * "no servidor" devolve o job e desliga o worker, para uma maquina lenta nao
 * segurar a nota.
 */

import { useEffect, useState } from "react";
import type { ProcessorJob } from "../lib/browserProcessor";
import { getWorkerState, handOffWorker, subscribeWorker } from "../lib/browserWorker";
import { Spinner } from "./Status";

interface AnalysisStatusProps {
  entryId: string;
  /** Progresso que o servidor publica para esta nota, quando ela roda la. */
  progress?: { stage: string; done: number; total: number };
  status?: string;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function jobLabel(job: ProcessorJob): string {
  switch (job.stage) {
    case "audio":
    case "decoding":
      return "lendo áudio";
    case "transcribing":
      return "transcrevendo";
    case "reading":
      return job.total > 0
        ? `lendo bloco ${Math.min(job.read + 1, job.total)} de ${job.total}`
        : "lendo";
    case "sentence":
      return "resumindo";
    case "analyzed":
      return "salvando";
    default:
      return "iniciando";
  }
}

function serverLabel(progress: AnalysisStatusProps["progress"], status?: string): string {
  if (progress?.stage === "analyzing") {
    return progress.total > 1
      ? `lendo bloco ${Math.min(progress.done + 1, progress.total)} de ${progress.total}`
      : "lendo";
  }
  if (progress?.stage === "summarizing") return "resumindo";
  if (status === "transcribing") return "transcrevendo";
  return "iniciando";
}

export function AnalysisStatus({ entryId, progress, status }: AnalysisStatusProps) {
  const [state, setState] = useState(getWorkerState());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeWorker(setState), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const job = state?.job && state.job.entryId === entryId ? state.job : null;
  // Nenhum progresso do servidor e um PC preferido na fila: a nota espera a
  // vez neste PC, nao na VPS.
  const waitingHere = !job && !progress && state?.queue?.preferred === true;
  const meters = job?.total ? job.read / job.total : progress?.total ? progress.done / progress.total : -1;
  const elapsed = job ? now - job.startedAt : 0;
  const label = job
    ? jobLabel(job)
    : waitingHere
      ? "na fila"
      : serverLabel(progress, status);

  return (
    <div className="analysis-loading">
      <div className="analysis-loading-head">
        <Spinner />
        <span>{label}</span>
        {job && <span className="muted analysis-elapsed">{clock(elapsed)}</span>}
      </div>
      {meters >= 0 && (
        <div
          className="analysis-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, Math.max(0, meters)) * 100)}
        >
          <span style={{ width: `${Math.round(Math.min(1, Math.max(0, meters)) * 100)}%` }} />
        </div>
      )}
      <div className="analysis-loading-foot">
        {job?.tokensPerSecond ? (
          <span className="hint">{job.tokensPerSecond.toFixed(1)} tok/s</span>
        ) : (
          <span className="hint">{job || waitingHere ? "neste PC" : "servidor"}</span>
        )}
        {job && (
          <button type="button" className="link-button" onClick={() => void handOffWorker()}>
            no servidor
          </button>
        )}
      </div>
    </div>
  );
}

export default AnalysisStatus;

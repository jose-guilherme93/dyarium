import type { EntryProgress } from "../types";

const LABELS: Record<string, string> = {
  received: "Recebido",
  validating: "Validando",
  stored: "Armazenado",
  queued: "Na fila",
  transcribing: "Transcrevendo",
  transcribed: "Transcrito",
  analyzing: "Analisando",
  enriched: "Enriquecido",
  ready: "Pronto",
  failed: "Falhou",
  deleted: "Removido",
};

export function statusLabel(status?: string): string {
  if (!status) {
    return "";
  }
  return LABELS[status] ?? status;
}

export function isBusy(status?: string): boolean {
  return status === "queued" || status === "transcribing" || status === "analyzing" || status === "received" || status === "validating";
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="ram-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="ram-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function stageText(progress?: EntryProgress): string {
  if (!progress) {
    return "";
  }
  if (progress.error) {
    return `Falha: ${progress.error}`;
  }
  switch (progress.status) {
    case "queued":
      return "Na fila para transcrever...";
    case "transcribing":
      return progress.total
        ? `Transcrevendo ${progress.done ?? 0} de ${progress.total} trechos`
        : "Transcrevendo...";
    case "analyzing":
      return "Analisando com a IA...";
    default:
      return statusLabel(progress.status);
  }
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

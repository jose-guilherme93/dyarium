/**
 * Lixeira: as notas apagadas, com o botao de restaurar.
 *
 * Apagar e logico: a nota fica aqui por uma janela de retencao (7 dias por
 * padrao) e so depois o job de limpeza remove o audio cifrado de vez. Por isso
 * este painel existe: sem ele, apagar uma nota e não ter como voltar — que era o
 * pior jeito de perder trabalho num diario.
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { formatDateTime } from "../lib/format";
import { ListSkeleton } from "./Skeleton";
import { Spinner } from "./Status";
import type { Entry } from "../types";
import { useToast } from "./Toasts";

/** Quantos dias a nota fica recuperavel, no texto de ajuda. */
const RETENTION_DAYS = 7;

interface TrashSectionProps {
  /** Muda quando algo fora daqui mexe nas notas (criar, apagar, restaurar). */
  refreshKey?: number;
}

export function TrashSection({ refreshKey = 0 }: TrashSectionProps) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listDeletedEntries();
      setEntries(result.entries ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar a lixeira");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load, refreshKey]);

  const restore = async (entry: Entry) => {
    setBusyId(entry.id);
    try {
      await api.restoreEntry(entry.id);
      notify(`"${titleOf(entry)}" voltou para a lista`, "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "falha ao restaurar", "error");
    } finally {
      setBusyId(null);
    }
  };

  // A contagem vem do servidor, e o painel so e carregado quando aberto: a
  // lixeira não e lugar de passagem.
  return (
    <div className="card">
      <div className="card-head">
        <h2>Lixeira</h2>
        <p className="hint">
          Nota apagada não some na hora: fica aqui por {RETENTION_DAYS} dias, com audio e texto intactos. Depois
          disso o servidor apaga de verdade.
        </p>
      </div>

      <div className="field-control">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Fechar lixeira" : "Abrir lixeira"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {open &&
        (loading ? (
          <ListSkeleton rows={3} compact />
        ) : entries.length === 0 ? (
          <p className="muted">Lixeira vazia.</p>
        ) : (
          <ul className="trash-list stagger-in">
            {entries.map((entry) => (
              <li key={entry.id} className="trash-item">
                <div className="trash-info">
                  <span className="trash-title">{titleOf(entry)}</span>
                  <span className="muted">
                    apagada em {formatDateTime(entry.deleted_at ?? entry.updated_at)}
                    {entry.duration_seconds > 0 ? ` · ${Math.round(entry.duration_seconds)}s` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  disabled={busyId === entry.id}
                  onClick={() => void restore(entry)}
                  aria-label={`Restaurar ${titleOf(entry)}`}
                >
                  {busyId === entry.id ? <Spinner /> : null}
                  {busyId === entry.id ? "Restaurando" : "Restaurar"}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** Titulo da nota apagada (ou o nome do arquivo, quando o titulo sumiu). */
function titleOf(entry: Entry): string {
  const raw = entry.title || entry.original_filename || "Nota";
  return raw.replace(/\s·\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}$/, "");
}

export default TrashSection;
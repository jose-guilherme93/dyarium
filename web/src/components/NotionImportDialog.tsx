import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { CloseIcon, CommentIcon, ImageIcon, ImportIcon, PlusIcon, WritingIcon } from "./icons";
import { formatDateTime } from "../lib/format";
import { useEscape } from "../lib/useEscape";
import type { Notebook } from "../types";
import {
  importNotionSource,
  inspectNotionSource,
  NotionImportError,
  readNotionSource,
  type NotionImportResult,
  type NotionInspection,
  type NotionInspectionPage,
  type NotionSource,
} from "../lib/notionImport";

interface NotionImportDialogProps {
  open: boolean;
  notebooks: Notebook[];
  /** Caderno do seletor da coluna; vira o destino inicial. */
  currentNotebookId: string;
  onClose: () => void;
  /** Chamado assim que a importacao termina (inclusive cancelada). */
  onFinished: (result: NotionImportResult) => void;
  onOpenEntry: (entryId: string) => void;
}

type Stage = "choose" | "review" | "running" | "done";

function isNotionNotebook(notebook: Notebook): boolean {
  return notebook.name.trim().toLowerCase() === "notion";
}

function importErrorMessage(error: unknown): string {
  if (error instanceof NotionImportError) return error.message;
  return "Não foi possível importar. Tente de novo.";
}

function statLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function FirstNotebookPreview({ page }: { page: NotionInspectionPage }) {
  const date = page.recordedAt ? formatDateTime(page.recordedAt) : "sem data";
  return (
    <section className="notion-preview" aria-label="Prévia da primeira nota">
      <div className="notion-preview-head">
        <span className="notion-preview-title">{page.title || "Sem título"}</span>
        <span className="muted">{date}</span>
      </div>
      <div className="notion-preview-body">
        {page.preview?.length ? (
          page.preview.map((block, index) =>
            block.kind === "image" ? (
              <div className="notion-preview-image" key={index}>
                <ImageIcon size={13} />
                <span>imagem</span>
              </div>
            ) : (
              <p key={index}>{block.text}</p>
            ),
          )
        ) : (
          <p className="muted">sem corpo</p>
        )}
      </div>
    </section>
  );
}

function Limitations({ inspection }: { inspection: NotionInspection }) {
  return (
    <details className="notion-limits">
      <summary>Limitações</summary>
      <ul>
        <li>Ícone e capa da página não são importados.</li>
        <li>Cores, colunas, synced blocks e sumário ficam de fora.</li>
        <li>Arquivos, PDFs, vídeo e áudio anexados não são importados.</li>
        <li>Imagens externas (http) não são baixadas.</li>
        <li>A data original aparece na nota; a data de importação fica em Detalhes.</li>
        {inspection.counts.datesWithoutYear > 0 && (
          <li>Datas sem ano usam o ano da exportação.</li>
        )}
        {inspection.skippedProperties.length > 0 && (
          <li>Propriedades fora: {inspection.skippedProperties.join(", ")}.</li>
        )}
      </ul>
    </details>
  );
}

export function NotionImportDialog({
  open,
  notebooks,
  currentNotebookId,
  onClose,
  onFinished,
  onOpenEntry,
}: NotionImportDialogProps) {
  const [stage, setStage] = useState<Stage>("choose");
  const [source, setSource] = useState<NotionSource | null>(null);
  const [inspection, setInspection] = useState<NotionInspection | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notebookChoice, setNotebookChoice] = useState("");
  const [dateProperty, setDateProperty] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [updateComments, setUpdateComments] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; title?: string } | null>(null);
  const [result, setResult] = useState<NotionImportResult | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef(false);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  useEscape(open && stage !== "running", onClose);

  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setSource(null);
    setInspection(null);
    setSourceLabel("");
    setBusy(false);
    setError("");
    setNotebookChoice("");
    setDateProperty("");
    setUpdateComments(true);
    setProgress(null);
    setResult(null);
    setCancelling(false);
    cancelRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || stage !== "choose") return;
    const input = folderRef.current;
    if (input) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
  }, [open, stage]);

  if (!open) return null;

  const notionNotebook = notebooks.find(isNotionNotebook);
  const importable = inspection?.counts.importable ?? 0;
  const dateOptions = inspection?.dateOptions ?? [];
  const selectedDate = dateOptions.find((option) => option.name === dateProperty) ?? dateOptions[0];
  const previewPage = inspection?.importable.find((page) => page.preview) ?? inspection?.importable[0];
  const normalizedYear = Number.isFinite(year) && year > 1900 && year < 2200 ? Math.round(year) : (source?.fallbackYear ?? new Date().getFullYear());

  const load = async (input: { zip?: File; files?: FileList | File[] }) => {
    setBusy(true);
    setError("");
    try {
      const nextSource = await readNotionSource(input);
      const nextInspection = await inspectNotionSource(nextSource);
      setSource(nextSource);
      setInspection(nextInspection);
      setSourceLabel(input.zip?.name || nextSource.rootName || "Pasta");
      setYear(nextSource.fallbackYear);
      const fallbackNotebook =
        notebooks.find((notebook) => notebook.id === currentNotebookId)?.id ??
        notebooks.find((notebook) => notebook.is_default)?.id ??
        notebooks[0]?.id ??
        "";
      setNotebookChoice(fallbackNotebook);
      setDateProperty(nextInspection.importable[0]?.dateProperty ?? nextInspection.dateOptions[0]?.name ?? "");
      setStage("review");
    } catch (err) {
      setError(importErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onZip = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void load({ zip: file });
  };

  const onFolder = (event: ChangeEvent<HTMLInputElement>) => {
    // Copia antes de limpar o input: zerar o value esvazia a FileList em alguns
    // navegadores, e o import precisa dos arquivos.
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (files.length > 0) void load({ files });
  };

  const pickNotion = () => {
    setNotebookChoice(notionNotebook ? notionNotebook.id : "__notion__");
  };

  const start = async () => {
    if (!source || !inspection || importable === 0) return;
    setError("");
    setCancelling(false);
    cancelRef.current = false;
    setProgress({ done: 0, total: importable });
    setStage("running");
    try {
      const imported = await importNotionSource(source, inspection, {
        fallbackYear: normalizedYear,
        dateProperty: dateProperty || undefined,
        updateExistingComments: updateComments,
        notebook:
          notebookChoice === "__notion__"
            ? { kind: "notion" }
            : { kind: "existing", id: notebookChoice },
        onProgress: (next) => setProgress({ done: next.done, total: next.total, title: next.title }),
        isCancelled: () => cancelRef.current,
      });
      setResult(imported);
      setStage("done");
      onFinished(imported);
    } catch (err) {
      setError(importErrorMessage(err));
      setStage("review");
    }
  };

  const reset = () => {
    setStage("choose");
    setSource(null);
    setInspection(null);
    setSourceLabel("");
    setError("");
    setProgress(null);
    setResult(null);
    setCancelling(false);
    cancelRef.current = false;
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={stage === "running" ? undefined : onClose}
    >
      <div
        className="modal-card notion-import"
        role="dialog"
        aria-modal="true"
        aria-label="Importar do Notion"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="notion-head">
          <h2 className="modal-title">Importar do Notion</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={stage === "running"}
            aria-label="Fechar"
            title="Fechar"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {stage === "choose" && (
          <>
            <p className="notion-lead">Exportação HTML</p>
            <div className="notion-source-actions">
              <button
                type="button"
                className="button"
                onClick={() => zipRef.current?.click()}
                disabled={busy}
              >
                <ImportIcon size={15} />
                Escolher .zip
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => folderRef.current?.click()}
                disabled={busy}
              >
                Escolher pasta
              </button>
            </div>
            {busy && <p className="muted notion-status">Lendo exportação...</p>}
            {error && <p className="error notion-error">{error}</p>}
            <details className="notion-limits">
              <summary>Limitações</summary>
              <ul>
                <li>Ícone e capa da página não são importados.</li>
                <li>Cores, colunas, synced blocks e sumário ficam de fora.</li>
                <li>Arquivos, PDFs, vídeo e áudio anexados não são importados.</li>
                <li>Imagens externas (http) não são baixadas.</li>
                <li>A data original aparece na nota; a data de importação fica em Detalhes.</li>
              </ul>
            </details>
            <input
              ref={zipRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              aria-label="Escolher zip do Notion"
              onChange={onZip}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              hidden
              aria-label="Escolher pasta do Notion"
              onChange={onFolder}
            />
          </>
        )}

        {stage === "review" && inspection && (
          <>
            <div className="notion-source">
              <span className="notion-source-name">{sourceLabel || "Exportação"}</span>
              {inspection.counts.databaseIndexes > 0 && (
                <span className="muted">
                  {statLabel(inspection.counts.databaseIndexes, "lista ignorada", "listas ignoradas")}
                </span>
              )}
            </div>

            <div className="notion-stats" aria-label="Resumo da importação">
              <span>
                <WritingIcon size={13} />
                {statLabel(importable, "nota", "notas")}
              </span>
              <span>
                <ImageIcon size={13} />
                {statLabel(inspection.counts.images, "imagem", "imagens")}
              </span>
              {inspection.counts.comments > 0 && (
                <span>
                  <CommentIcon size={13} />
                  {statLabel(inspection.counts.comments, "comentário", "comentários")}
                </span>
              )}
              {inspection.counts.withoutDate > 0 && (
                <span className="notion-warn">
                  {statLabel(inspection.counts.withoutDate, "sem data", "sem data")}
                </span>
              )}
            </div>

            <div className="notion-row">
              <label className="notion-field">
                <span>Caderno</span>
                <select
                  value={notebookChoice}
                  onChange={(event) => setNotebookChoice(event.target.value)}
                  disabled={notebooks.length === 0}
                >
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                  {!notionNotebook && <option value="__notion__">Notion (novo)</option>}
                </select>
              </label>
              <button type="button" className="button button--ghost notion-quick" onClick={pickNotion}>
                <PlusIcon size={14} />
                {notionNotebook ? "Usar caderno Notion" : "Criar caderno Notion"}
              </button>
            </div>

            {dateOptions.length > 0 ? (
              dateOptions.length === 1 ? (
                <div className="notion-field notion-field--static">
                  <span>Data original</span>
                  <span className="notion-value">{selectedDate?.name}</span>
                  <span className="muted notion-sample">{selectedDate?.raw}</span>
                </div>
              ) : (
                <label className="notion-field">
                  <span>Data original</span>
                  <select value={dateProperty} onChange={(event) => setDateProperty(event.target.value)}>
                    {dateOptions.map((option) => (
                      <option key={option.name} value={option.name}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <span className="muted notion-sample">{selectedDate?.raw}</span>
                </label>
              )
            ) : (
              <p className="notion-warn">Sem data original neste export.</p>
            )}

            {inspection.counts.comments > 0 && (
              <label className="notion-check">
                <input
                  type="checkbox"
                  checked={updateComments}
                  onChange={(event) => setUpdateComments(event.target.checked)}
                />
                <span>Comentários em notas existentes</span>
              </label>
            )}

            {inspection.counts.datesWithoutYear > 0 && (
              <label className="notion-field notion-year">
                <span>Ano das datas sem ano</span>
                <input
                  type="number"
                  min={1900}
                  max={2199}
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                />
              </label>
            )}

            {previewPage && <FirstNotebookPreview page={previewPage} />}

            <Limitations inspection={inspection} />
            {error && <p className="error notion-error">{error}</p>}
            {importable === 0 && <p className="notion-warn">Nenhuma nota encontrada.</p>}

            <div className="modal-actions">
              <button type="button" className="button button--ghost" onClick={reset}>
                Voltar
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void start()}
                disabled={importable === 0 || notebooks.length === 0}
              >
                Importar {statLabel(importable, "nota", "notas")}
              </button>
            </div>
          </>
        )}

        {stage === "running" && progress && (
          <>
            <div
              className="notion-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div className="notion-progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <div className="notion-progress-line">
              <span>
                {progress.done}/{progress.total}
              </span>
              <span className="muted">{progress.title || "Preparando o caderno"}</span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  cancelRef.current = true;
                  setCancelling(true);
                }}
                disabled={cancelling}
              >
                {cancelling ? "Cancelando..." : "Cancelar"}
              </button>
            </div>
          </>
        )}

        {stage === "done" && result && (
          <>
            <div className="notion-stats notion-stats--result" aria-label="Resultado da importação">
              <span>
                <WritingIcon size={13} />
                {statLabel(result.imported, "importada", "importadas")}
              </span>
              <span>{statLabel(result.existing, "já existia", "já existiam")}</span>
              {result.failed > 0 && <span className="notion-warn">{statLabel(result.failed, "falhou", "falharam")}</span>}
              <span>
                <ImageIcon size={13} />
                {statLabel(result.images, "imagem", "imagens")}
              </span>
              {result.comments > 0 && (
                <span>
                  <CommentIcon size={13} />
                  {statLabel(result.comments, "comentário", "comentários")}
                </span>
              )}
              {result.updated > 0 && <span>{statLabel(result.updated, "atualizada", "atualizadas")}</span>}
              {result.moved > 0 && <span>{statLabel(result.moved, "movida", "movidas")}</span>}
            </div>
            <p className="notion-notebook-line">
              {result.notebookName}
              {result.notebookCreated ? (result.notebookRemoved ? " (removido)" : " (criado)") : ""}
            </p>
            {result.cancelled && <p className="notion-warn">Cancelada antes do fim.</p>}
            {result.withoutDate > 0 && (
              <p className="notion-warn">{statLabel(result.withoutDate, "nota sem data", "notas sem data")}</p>
            )}
            {result.failures.length > 0 && (
              <details className="notion-report">
                <summary>Falhas ({result.failures.length})</summary>
                <ul>
                  {result.failures.map((failure, index) => (
                    <li key={`${failure.title}-${index}`}>
                      <span>{failure.title || "Sem título"}</span>
                      <span className="muted">{failure.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {result.warnings.length > 0 && (
              <details className="notion-report">
                <summary>Avisos ({result.warnings.length})</summary>
                <ul>
                  {result.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="modal-actions">
              <button type="button" className="button button--ghost" onClick={reset}>
                Importar outra
              </button>
              <button type="button" className="button button--ghost" onClick={onClose}>
                Fechar
              </button>
              {result.firstEntryId && (
                <button type="button" className="button" onClick={() => onOpenEntry(result.firstEntryId!)}>
                  Abrir a primeira nota
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default NotionImportDialog;

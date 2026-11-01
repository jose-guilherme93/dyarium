import { useEffect, useMemo, useState } from "react";
import { bookFileName, countLabel } from "../lib/books";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportBook,
  exportHtml,
  exportSummary,
  type BookExportInput,
  type ExportFormat,
  type ExportOptions,
  type ExportPreset,
  type ImageMode,
} from "../lib/bookExport";
import { useEscape } from "../lib/useEscape";

interface ExportDialogProps {
  open: boolean;
  input: BookExportInput | null;
  onClose: () => void;
}

function download(data: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function printHtml(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) return;
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  });
}

/** Dialogo de exportacao, com presets e o resumo do que vai sair. */
export function ExportDialog({ open, input, onClose }: ExportDialogProps) {
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscape(open, onClose);

  useEffect(() => {
    if (open) {
      setError("");
      setBusy(false);
      setOptions(DEFAULT_EXPORT_OPTIONS);
    }
  }, [open]);

  const effective = useMemo<BookExportInput | null>(() => {
    if (!input) return null;
    return {
      ...input,
      chapters: options.onlyDone
        ? input.chapters.filter(
            (chapter) => chapter.entry.chapter_kind === "part" || chapter.entry.chapter_status === "done",
          )
        : input.chapters,
    };
  }, [input, options.onlyDone]);

  const summary = useMemo(() => (effective ? exportSummary(effective) : null), [effective]);
  if (!open || !input) return null;

  const update = (patch: Partial<ExportOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));

  const run = async () => {
    if (!effective || !summary) return;
    setBusy(true);
    setError("");
    try {
      const withOptions = { ...effective, options };
      if (options.format === "pdf") {
        printHtml(exportHtml(withOptions).html);
        onClose();
        return;
      }
      const result = await exportBook(withOptions);
      const extension = options.format === "markdown" ? "md" : "docx";
      const type =
        options.format === "markdown"
          ? "text/markdown;charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      download(result.data, bookFileName(input.book.name, options.preset, extension), type);
      if (result.ignoredImages > 0) {
        setError(`${result.ignoredImages} imagens ignoradas`);
        return;
      }
      onClose();
    } catch {
      setError("Não foi possível exportar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Exportar o livro"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="modal-title">Exportar o livro</h3>
        {summary ? (
          <p className="export-hint">
            {countLabel(summary.chapters, "capítulo", "capítulos")} ·{" "}
            {countLabel(summary.words, "palavra", "palavras")} · ~
            {countLabel(summary.pages, "página", "páginas")}
            {summary.empty > 0
              ? ` · ${countLabel(summary.empty, "vazio ignorado", "vazios ignorados")}`
              : ""}
          </p>
        ) : null}

        <div className="export-presets">
          {(
            [
              {
                value: "manuscript" as ExportPreset,
                title: "Manuscrito",
                text: "Times New Roman 12 · espaço duplo · margens 2,5 cm · quebra por capítulo",
              },
              {
                value: "book" as ExportPreset,
                title: "Livro",
                text: "6 × 9 pol · serifada · justificado · títulos de capítulo",
              },
            ]
          ).map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={options.preset === preset.value ? "export-preset is-on" : "export-preset"}
              aria-pressed={options.preset === preset.value}
              onClick={() => update({ preset: preset.value })}
            >
              <b>{preset.title}</b>
              <span>{preset.text}</span>
            </button>
          ))}
        </div>

        <div className="export-formats" role="group" aria-label="Formato">
          {(
            [
              { value: "docx" as ExportFormat, label: "DOCX" },
              { value: "pdf" as ExportFormat, label: "PDF" },
              { value: "markdown" as ExportFormat, label: "Markdown" },
            ]
          ).map((format) => (
            <button
              key={format.value}
              type="button"
              className={options.format === format.value ? "export-format is-on" : "export-format"}
              aria-pressed={options.format === format.value}
              onClick={() => update({ format: format.value })}
            >
              {format.label}
            </button>
          ))}
        </div>

        <div className="export-options">
          <label className="export-option">
            <input
              type="checkbox"
              className="export-switch"
              aria-label="Página de título"
              checked={options.includeTitlePage}
              onChange={(event) => update({ includeTitlePage: event.target.checked })}
            />
            <span>Página de título</span>
          </label>
          <label className="export-option">
            <input
              type="checkbox"
              className="export-switch"
              aria-label="Sumário"
              checked={options.includeToc}
              onChange={(event) => update({ includeToc: event.target.checked })}
            />
            <span>Sumário</span>
          </label>
          <label className="export-option">
            <input
              type="checkbox"
              className="export-switch"
              aria-label="Quebra por capítulo"
              checked={options.pageBreak}
              onChange={(event) => update({ pageBreak: event.target.checked })}
            />
            <span>Quebra por capítulo</span>
          </label>
          <label className="export-option">
            <input
              type="checkbox"
              className="export-switch"
              aria-label="Só finalizados"
              checked={options.onlyDone}
              onChange={(event) => update({ onlyDone: event.target.checked })}
            />
            <span>Só finalizados</span>
          </label>
        </div>

        <div className="export-images">
          <span className="group-label">Imagens</span>
          {(
            [
              { value: "bw" as ImageMode, label: "Preto e branco" },
              { value: "color" as ImageMode, label: "Cor original" },
            ]
          ).map((image) => (
            <button
              key={image.value}
              type="button"
              className={options.images === image.value ? "export-format is-on" : "export-format"}
              aria-pressed={options.images === image.value}
              onClick={() => update({ images: image.value })}
            >
              {image.label}
            </button>
          ))}
        </div>

        <div className="export-summary-row">
          <span>Inclui partes e matérias pré/pós-textuais</span>
          <span>{summary ? `~${countLabel(summary.pages, "página", "páginas")}` : ""}</span>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="button button--primary" onClick={() => void run()} disabled={busy}>
            Exportar .{options.format === "markdown" ? "md" : options.format}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { exportHtml, markdownToHtml, type BookExportInput } from "../lib/bookExport";
import { bookBodyFont, bookPage } from "../lib/books";
import { useEscape } from "../lib/useEscape";
import { printHtmlDocument } from "../lib/print";

interface ReadingViewProps {
  open: boolean;
  input: BookExportInput | null;
  onClose: () => void;
}

function printBook(input: BookExportInput) {
  printHtmlDocument(exportHtml(input).html);
}

/** Previa de leitura em pagina, com o mesmo conteudo da impressao. */
export function ReadingView({ open, input, onClose }: ReadingViewProps) {
  const [page, setPage] = useState(0);
  useEscape(open, onClose);

  useEffect(() => {
    if (open) setPage(0);
  }, [open]);

  const sections = useMemo(() => {
    if (!input) return [];
    const usable = input.chapters.filter(
      (chapter) => chapter.entry.chapter_kind === "part" || chapter.words > 0,
    );
    const parts: Array<{
      kind: "cover" | "title" | "toc" | "part" | "chapter";
      title: string;
      html?: string;
    }> = [];
    if (input.coverDataUrl) {
      parts.push({ kind: "cover", title: "Capa" });
    }
    if (input.options.includeTitlePage) {
      parts.push({ kind: "title", title: input.book.name });
    }
    if (input.options.includeToc) {
      parts.push({ kind: "toc", title: "Sumário" });
    }
    for (const chapter of usable) {
      parts.push({
        kind: chapter.entry.chapter_kind === "part" ? "part" : "chapter",
        title: chapter.entry.title || "Sem título",
        html: markdownToHtml(chapter.markdown),
      });
    }
    return parts;
  }, [input]);

  if (!open || !input || sections.length === 0) return null;
  const current = sections[Math.max(0, Math.min(page, sections.length - 1))];
  const measure = bookPage(input.book);
  const readingFont = bookBodyFont(input.book);
  const chapterTotal = sections.filter((section) => section.kind === "chapter").length;
  const chapterIndex = sections
    .slice(0, Math.max(0, Math.min(page, sections.length - 1)) + 1)
    .filter((section) => section.kind === "chapter").length;
  const positionLabel =
    current.kind === "chapter"
      ? `Capítulo ${chapterIndex} de ${chapterTotal}`
      : current.kind === "part"
        ? "Parte"
        : current.kind === "title"
          ? "Título"
          : current.kind === "cover"
            ? "Capa"
            : "Sumário";
  const ratio = measure.widthMm / measure.heightMm;
  const stageStyle: CSSProperties = {
    width: `min(${measure.widthPx}px, calc((100vh - 132px) * ${ratio}), 94vw)`,
  };
  const pageStyle = {
    padding:
      current.kind === "cover"
        ? 0
        : `${Math.round(measure.marginPx * 0.75)}px ${measure.marginPx}px 24px`,
    aspectRatio: `${measure.widthMm} / ${measure.heightMm}`,
    maxHeight: "none",
    "--reading-body": `${measure.bodyPx}px`,
    "--reading-leading": String(measure.leading),
    "--reading-font": readingFont.css,
  } as CSSProperties;

  return (
    <div className="reading" role="dialog" aria-modal="true" aria-label="Prévia de leitura">
      <div className="reading-stage" style={stageStyle}>
        <div className="reader-bar">
          <span className="reading-pages">{positionLabel}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={page === 0}
          >
            ←
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setPage((value) => Math.min(sections.length - 1, value + 1))}
            disabled={page >= sections.length - 1}
          >
            →
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => printBook(input)}
            title="O cabeçalho e o número de página dependem do diálogo do navegador."
          >
            Imprimir / PDF
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar prévia">
            ×
          </button>
        </div>

        <article className={"reading-page reading-page--" + current.kind} style={pageStyle}>
          {current.kind === "cover" && input.coverDataUrl ? (
            <div className="reading-cover">
              <img src={input.coverDataUrl} alt="" />
            </div>
          ) : null}
          {current.kind === "cover" ? null : current.kind === "title" ? (
            <div className="reading-title-page">
              <h1>{input.book.name}</h1>
              {input.book.subtitle ? <p className="reading-subtitle">{input.book.subtitle}</p> : null}
              {input.book.author ? <p className="reading-author">{input.book.author}</p> : null}
            </div>
          ) : current.kind === "toc" ? (
            <div className="reading-toc">
              <h2>Sumário</h2>
              {sections
                .filter((section) => section.kind === "part" || section.kind === "chapter")
                .map((section, index) => (
                  <p key={`${section.kind}-${index}`} className={`toc-${section.kind}`}>
                    {section.title}
                  </p>
                ))}
            </div>
          ) : (
            <div className="reading-content">
              <p className="reading-overline">
                {current.kind === "part" ? "Parte" : "Capítulo"}
              </p>
              <h2>{current.title}</h2>
              <div
                className="reading-body"
                // markdownToHtml escapa o texto antes de montar as tags.
                dangerouslySetInnerHTML={{ __html: current.html ?? "" }}
              />
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

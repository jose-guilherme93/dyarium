import { useEffect, useRef, useState } from "react";

interface CoverEditorProps {
  /** Proporcao da pagina do livro (largura / altura). */
  aspect: number;
  /** Capa atual no servidor, quando existe. */
  initialUrl?: string;
  /** Recorta, codifica em JPEG e entrega o blob para o upload. */
  onSave: (image: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
}

const FRAME_WIDTH = 180;
const OUTPUT_WIDTH = 1000;

/**
 * Encaixe da foto de capa. O quadro tem a proporcao da folha; a imagem pode ser
 * arrastada e ampliada, e o canvas salva exatamente o que esta dentro do quadro.
 */
export function CoverEditor({ aspect, initialUrl, onSave, onRemove }: CoverEditorProps) {
  const [source, setSource] = useState<string | null>(initialUrl ?? null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const frameHeight = Math.round(FRAME_WIDTH / aspect);

  useEffect(() => {
    setSource(initialUrl ?? null);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [initialUrl]);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  /** Escala base para a foto cobrir o quadro. */
  const baseScale = natural
    ? Math.max(FRAME_WIDTH / natural.width, frameHeight / natural.height)
    : 1;
  const scaledWidth = natural ? natural.width * baseScale * zoom : 0;
  const scaledHeight = natural ? natural.height * baseScale * zoom : 0;

  const clamp = (value: { x: number; y: number }, w = scaledWidth, h = scaledHeight) => {
    const baseX = (FRAME_WIDTH - w) / 2;
    const baseY = (frameHeight - h) / 2;
    return {
      x: Math.min(0 - baseX, Math.max(FRAME_WIDTH - w - baseX, value.x)),
      y: Math.min(0 - baseY, Math.max(frameHeight - h - baseY, value.y)),
    };
  };

  const left = (FRAME_WIDTH - scaledWidth) / 2 + offset.x;
  const top = (frameHeight - scaledHeight) / 2 + offset.y;

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setSource(url);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNote("");
  };

  const save = async () => {
    if (!image.current || !natural || busy) return;
    setBusy(true);
    setNote("");
    try {
      const outputHeight = Math.round(OUTPUT_WIDTH / aspect);
      const scale = OUTPUT_WIDTH / FRAME_WIDTH;
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_WIDTH;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, OUTPUT_WIDTH, outputHeight);
      context.drawImage(
        image.current,
        left * scale,
        top * scale,
        scaledWidth * scale,
        scaledHeight * scale,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.86),
      );
      if (!blob) throw new Error("imagem");
      await onSave(blob);
      setNote("Capa salva");
    } catch {
      setNote("Não foi possível salvar a capa.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setNote("");
    try {
      await onRemove();
      setSource(null);
      setNatural(null);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setNote("Capa removida");
    } catch {
      setNote("Não foi possível remover a capa.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cover-editor">
      <div className="cover-editor-main">
        <div
          ref={frame}
          className="cover-crop-frame"
          style={{ width: FRAME_WIDTH, height: frameHeight }}
          onPointerDown={(event) => {
            if (!natural) return;
            frame.current?.setPointerCapture(event.pointerId);
            setDragging({ x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y });
          }}
          onPointerMove={(event) => {
            if (!dragging) return;
            setOffset(clamp({
              x: dragging.ox + event.clientX - dragging.x,
              y: dragging.oy + event.clientY - dragging.y,
            }));
          }}
          onPointerUp={(event) => {
            frame.current?.releasePointerCapture(event.pointerId);
            setDragging(null);
          }}
        >
          {source ? (
            <img
              ref={image}
              src={source}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const element = event.currentTarget;
                setNatural({ width: element.naturalWidth, height: element.naturalHeight });
                setOffset({ x: 0, y: 0 });
              }}
              style={{
                width: natural ? `${scaledWidth}px` : "100%",
                height: natural ? `${scaledHeight}px` : "100%",
                left: natural ? `${left}px` : 0,
                top: natural ? `${top}px` : 0,
              }}
            />
          ) : (
            <span className="cover-crop-empty">Sem foto</span>
          )}
        </div>

        <div className="cover-editor-controls">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => fileInput.current?.click()}
          >
            {source ? "Trocar foto" : "Escolher foto"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={pick}
          />
          {source ? (
            <>
              <label className="cover-zoom">
                <span>Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  aria-label="Zoom da capa"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setZoom(next);
                    setOffset((current) => {
                      if (!natural) return current;
                      const base = Math.max(FRAME_WIDTH / natural.width, frameHeight / natural.height);
                      return clamp(current, natural.width * base * next, natural.height * base * next);
                    });
                  }}
                />
              </label>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void save()}
                disabled={busy || !natural}
              >
                {busy ? "Salvando..." : "Salvar capa"}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void remove()}
                disabled={busy}
              >
                Remover
              </button>
            </>
          ) : null}
        </div>
      </div>
      {note ? <p className="cover-editor-note">{note}</p> : null}
    </div>
  );
}

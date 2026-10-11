import { useCallback, useEffect, useRef, useState } from "react";
import { api, attachmentUrl, uploadAttachment } from "../api";
import type { Attachment } from "../types";
import { ImageIcon, TrashIcon } from "./icons";

interface ImageGalleryProps {
  entryId: string;
}

// ImageGallery shows and manages the images attached to a note.
export function ImageGallery({ entryId }: ImageGalleryProps) {
  const [images, setImages] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listAttachments(entryId);
      setImages(result.attachments ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao carregar imagens");
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        await uploadAttachment(entryId, file);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao enviar a imagem");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteAttachment(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao remover");
    }
  };

  return (
    <div className="gallery">
      <div className="gallery-grid">
        {images.map((image) => (
          <figure key={image.id} className="gallery-item">
            <button type="button" className="gallery-thumb" onClick={() => setLightbox(attachmentUrl(image.id))}>
              <img src={attachmentUrl(image.id)} alt="Imagem da nota" loading="lazy" />
            </button>
            <button
              type="button"
              className="gallery-remove"
              onClick={() => void remove(image.id)}
              aria-label="Remover imagem"
            >
              <TrashIcon size={14} />
            </button>
          </figure>
        ))}
        <button type="button" className="gallery-add" onClick={() => inputRef.current?.click()} disabled={busy}>
          <ImageIcon size={20} />
          <span>{busy ? "Enviando..." : "Adicionar imagem"}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Imagem ampliada" />
        </div>
      )}
    </div>
  );
}

export default ImageGallery;

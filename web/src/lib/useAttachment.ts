/**
 * Endereco do anexo pronto para o `src`.
 *
 * No cofre local a URL do blob nasce de forma assincrona; sem assinar a chegada
 * dela o elemento fica com `src` vazio para sempre depois de recarregar a
 * pagina. O hook repinta quando o byte termina de carregar e, quando o byte
 * nao esta no IndexedDB, pede o anexo ao cofre do Drive (um arquivo por vez).
 */

import { useEffect, useSyncExternalStore } from "react";

import { attachmentUrl } from "../api";
import { attachmentUrlsVersion, subscribeAttachmentUrls } from "../local/attachments";
import {
  attachmentFetchState,
  attachmentFetchVersion,
  ensureAttachment,
  retryAttachment,
  subscribeAttachmentFetch,
  type AttachmentFetchStatus,
} from "../local/attachmentFetch";

export function useAttachmentUrl(id: string | null | undefined): string {
  useSyncExternalStore(subscribeAttachmentUrls, attachmentUrlsVersion, attachmentUrlsVersion);
  const url = id ? attachmentUrl(id) : "";
  // URL vazia = byte ainda nao esta aqui. O cofre traz so este anexo, e a
  // assinatura do store repinta quando ele chega (ou falha, uma vez).
  useEffect(() => {
    if (!id || url) return;
    void ensureAttachment(id);
  }, [id, url]);
  return url;
}

export interface AttachmentView {
  url: string;
  status: AttachmentFetchStatus;
  /** Motivo em uma linha quando `status` e "error"; vazio fora dele. */
  reason: string;
  /** Nova tentativa do anexo isolado. */
  retry: () => void;
}

/** URL e estado do byte: e o que o player e a imagem precisam desenhar. */
export function useAttachment(id: string | null | undefined): AttachmentView {
  const url = useAttachmentUrl(id);
  useSyncExternalStore(subscribeAttachmentFetch, attachmentFetchVersion, attachmentFetchVersion);
  const estado = id ? attachmentFetchState(id) : { status: "idle" as const, reason: "" };
  return {
    url,
    ...estado,
    retry: () => {
      if (id) void retryAttachment(id);
    },
  };
}

/** So o estado da busca, para quem ja tem a URL por outro caminho (imagem). */
export function useAttachmentFetch(id: string | null | undefined): {
  status: AttachmentFetchStatus;
  reason: string;
  retry: () => void;
} {
  useSyncExternalStore(subscribeAttachmentFetch, attachmentFetchVersion, attachmentFetchVersion);
  const estado = id ? attachmentFetchState(id) : { status: "idle" as const, reason: "" };
  return {
    ...estado,
    retry: () => {
      if (id) void retryAttachment(id);
    },
  };
}

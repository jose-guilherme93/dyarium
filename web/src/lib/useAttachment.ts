/**
 * Endereco do anexo pronto para o `src`.
 *
 * No cofre local a URL do blob nasce de forma assincrona; sem assinar a chegada
 * dela o elemento fica com `src` vazio para sempre depois de recarregar a
 * pagina. O hook repinta quando o byte termina de carregar.
 */

import { useSyncExternalStore } from "react";

import { attachmentUrl } from "../api";
import { attachmentUrlsVersion, subscribeAttachmentUrls } from "../local/attachments";

export function useAttachmentUrl(id: string | null | undefined): string {
  useSyncExternalStore(subscribeAttachmentUrls, attachmentUrlsVersion, attachmentUrlsVersion);
  return id ? attachmentUrl(id) : "";
}

/**
 * Endereco da capa do livro pronto para o `src`.
 *
 * A URL de um blob nasce de forma assincrona no cofre local, mas o desenho nao
 * pode esperar. O hook assina a chegada da imagem: a primeira pintura vem sem
 * `src` e a segunda ja mostra a capa.
 */

import { useSyncExternalStore } from "react";

import { coverUrl } from "../api";
import { coverUrlsVersion, subscribeCoverUrls } from "../local/covers";

export function useCoverUrl(bookId: string | null, version?: string | null): string {
  useSyncExternalStore(subscribeCoverUrls, coverUrlsVersion, coverUrlsVersion);
  return bookId ? coverUrl(bookId, version) : "";
}

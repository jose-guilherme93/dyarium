/**
 * Pilha de audios da nota, lida do servidor.
 *
 * Uma nota pode ter mais de um audio (cada um com a sua transcricao), empilhado
 * no topo. Quem grava varios audios e o dashboard; o app **le** a pilha e mostra,
 * para que os audios de la nao fiquem invisiveis aqui.
 *
 * Abertura de nota nunca espera a rede: a ultima pilha lida fica no SQLite e e
 * usada como estado inicial. O refresh roda em segundo plano e so substitui o
 * que esta na tela quando (e se) o servidor responder.
 *
 * O app le a pilha; nao a escreve. Multiplas gravacoes numa nota so no celular
 * estao fora do escopo.
 */

import { useCallback, useEffect, useState } from 'react';

import { DyariumApi, type FetchLike, type ServerAudio } from '@/core/api';

import { saveServerAudios } from '@/services/db';
import { loadServerConfig } from '@/services/secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface AudioStack {
  /** Audios do servidor, do mais antigo para o mais novo. */
  audios: ServerAudio[];
  /** Le a pilha de novo (ao voltar para a tela da nota). */
  refresh: () => Promise<void>;
}

/** Le a pilha de audios de uma entrada. Vazio quando nao ha servidor ou audio. */
export function useAudioStack(entryId: string | undefined, cached: ServerAudio[] = []): AudioStack {
  const [audios, setAudios] = useState<ServerAudio[]>(cached);

  const refresh = useCallback(async () => {
    try {
      // O primeiro `await` vem antes de qualquer mudanca de estado: assim o
      // efeito que dispara a leitura nao vira uma cascata de render.
      const config = entryId ? await loadServerConfig() : null;
      if (!config || !entryId) {
        return;
      }
      const api = new DyariumApi(config, doFetch);
      const list = await api.listAudios(entryId);
      setAudios(list);
      // Guarda para a proxima abertura: a nota aparece completa na hora.
      await saveServerAudios(entryId, list).catch(() => undefined);
    } catch {
      // Sem rede ou sem servidor: mantem a pilha cacheada (se houver). A nota
      // segue utilizavel, que e o que importa para escrever.
    }
  }, [entryId]);

  useEffect(() => {
    // Com cache, a nota ja abriu completa: revalida so depois que a tela
    // assentou. Sem cache, busca agora (senao a pilha nunca aparece).
    if (cached.length > 0) {
      const timer = setTimeout(() => {
        void refresh();
      }, 2500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return undefined;
  }, [cached.length, refresh]);

  return { audios, refresh };
}

/** Duracao de um audio da pilha, em ms (0 quando o servidor nao sabe). */
export function audioDurationMs(audio: ServerAudio): number {
  return Math.max(0, Math.round(audio.duration_seconds * 1000));
}

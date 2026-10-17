/**
 * Pilha de audios da nota, lida do servidor.
 *
 * Uma nota pode ter mais de um audio (cada um com a sua transcricao), empilhado
 * no topo. Quem grava varios audios e o dashboard; o app **le** a pilha e mostra,
 * para que os audios de la nao fiquem invisiveis aqui.
 *
 * O app le a pilha; nao a escreve. Multiplas gravacoes numa nota so no celular
 * estao fora do escopo.
 */

import { useCallback, useEffect, useState } from 'react';

import { DyariumApi, type FetchLike, type ServerAudio } from '@/core/api';

import { loadServerConfig } from '@/services/secure';

const doFetch = globalThis.fetch as unknown as FetchLike;

export interface AudioStack {
  /** Audios do servidor, do mais antigo para o mais novo. */
  audios: ServerAudio[];
  /** Le a pilha de novo (ao voltar para a tela da nota). */
  refresh: () => Promise<void>;
}

/** Le a pilha de audios de uma entrada. Vazio quando nao ha servidor ou audio. */
export function useAudioStack(entryId: string | undefined): AudioStack {
  const [audios, setAudios] = useState<ServerAudio[]>([]);

  const refresh = useCallback(async () => {
    try {
      // O primeiro `await` vem antes de qualquer mudanca de estado: assim o
      // efeito que dispara a leitura nao vira uma cascata de render.
      const config = entryId ? await loadServerConfig() : null;
      if (!config || !entryId) {
        setAudios([]);
        return;
      }
      const api = new DyariumApi(config, doFetch);
      setAudios(await api.listAudios(entryId));
    } catch {
      // Sem rede ou sem servidor: a pilha simplesmente nao aparece. A nota segue
      // com o audio local, que e o que importa para escrever.
      setAudios([]);
    }
  }, [entryId]);

  useEffect(() => {
    // A pilha e lida uma vez por entrada, quando a nota abre. Nao ha estado
    // externo para assinar aqui (o servidor nao empurra audios), entao a leitura
    // acontece no efeito e o estado so muda quando a promessa resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { audios, refresh };
}

/** Duracao de um audio da pilha, em ms (0 quando o servidor nao sabe). */
export function audioDurationMs(audio: ServerAudio): number {
  return Math.max(0, Math.round(audio.duration_seconds * 1000));
}
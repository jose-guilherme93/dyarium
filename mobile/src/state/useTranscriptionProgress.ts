import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  isTranscribing,
  subscribeTranscriptionProgress,
  subscribeTranscriptionRunning,
  transcriptionProgress,
} from '@/services/localTranscription';

/** Progresso (0..100) da transcricao local de uma gravacao. */
export function useTranscriptionProgress(id: string | undefined, enabled = true): number {
  const [percent, setPercent] = useState(() => (id && enabled ? transcriptionProgress(id) : 0));

  useEffect(() => {
    if (!id || !enabled) return undefined;
    return subscribeTranscriptionProgress(id, setPercent);
  }, [id, enabled]);

  return enabled ? percent : 0;
}

/** A transcricao local desta gravacao esta rodando? (o card mostra parar). */
export function useTranscriptionRunning(id: string | undefined, enabled = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) =>
      id && enabled ? subscribeTranscriptionRunning(id, onChange) : () => undefined,
    [id, enabled],
  );
  const snapshot = useCallback(
    () => Boolean(id && enabled && isTranscribing(id)),
    [id, enabled],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

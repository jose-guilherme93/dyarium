import { useEffect, useState } from 'react';

import {
  subscribeTranscriptionProgress,
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

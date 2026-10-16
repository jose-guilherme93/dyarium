import { useEffect, useState } from 'react';

import {
  subscribeTranscriptionProgress,
  transcriptionProgress,
} from '@/services/localTranscription';

/** Progresso (0..100) da transcricao local de uma gravacao. */
export function useTranscriptionProgress(id: string | undefined): number {
  const [percent, setPercent] = useState(() => (id ? transcriptionProgress(id) : 0));

  useEffect(() => {
    if (!id) return undefined;
    return subscribeTranscriptionProgress(id, setPercent);
  }, [id]);

  return percent;
}

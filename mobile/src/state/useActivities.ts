import { useSyncExternalStore } from 'react';

import { getActivitiesSnapshot, subscribeActivities } from '@/services/activity';

/** Lista reativa das atividades pesadas em andamento e das recentes. */
export function useActivities() {
  return useSyncExternalStore(
    subscribeActivities,
    getActivitiesSnapshot,
    getActivitiesSnapshot,
  );
}

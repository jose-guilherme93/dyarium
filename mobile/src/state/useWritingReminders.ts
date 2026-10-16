/**
 * Agendamento dos lembretes de escrita a partir das metricas: sequencia em
 * risco e meta semanal atrasada. Reavalia ao abrir/voltar ao app e de tempo em
 * tempo; como o texto e salvo sem mexer na lista, o intervalo cobre esse caso.
 * Tambem comemora marcos (palavras e sequencia), uma vez cada.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import {
  analyzeWriting,
  wordMilestone,
  writingHistory,
  writingReminder,
} from '@/core/writing';
import { notify, syncWritingReminder } from '@/services/notifications';

import { useLibrary } from './LibraryContext';
import { useSettings } from './SettingsContext';

/** Reavalia de tempo em tempo (pega virada do dia e texto salvo so no banco). */
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

export function useWritingReminders(): void {
  const { recordings } = useLibrary();
  const {
    weeklyWordGoal,
    writingReminders,
    reminderHour,
    celebratedWords,
    celebratedStreak,
    setCelebratedWords,
    setCelebratedStreak,
  } = useSettings();

  // Espelho sempre atual, para o intervalo nao ler valores velhos.
  const stateRef = useRef({
    recordings,
    weeklyWordGoal,
    writingReminders,
    reminderHour,
    celebratedWords,
    celebratedStreak,
  });
  useEffect(() => {
    stateRef.current = {
      recordings,
      weeklyWordGoal,
      writingReminders,
      reminderHour,
      celebratedWords,
      celebratedStreak,
    };
  }, [
    recordings,
    weeklyWordGoal,
    writingReminders,
    reminderHour,
    celebratedWords,
    celebratedStreak,
  ]);

  const sync = useCallback(async () => {
    const state = stateRef.current;
    if (!state.writingReminders) {
      await syncWritingReminder(null, state.reminderHour);
      return;
    }
    const now = new Date();
    const metrics = analyzeWriting(state.recordings, now);
    if (metrics.notes === 0) {
      await syncWritingReminder(null, state.reminderHour);
      return;
    }

    const milestone = wordMilestone(metrics.words, state.celebratedWords);
    if (milestone) {
      void notify(
        'Marco de escrita',
        `Você passou de ${milestone.toLocaleString('pt-BR')} palavras escritas.`,
      );
      void setCelebratedWords(milestone);
    }
    if (metrics.longestStreak > state.celebratedStreak && metrics.longestStreak >= 2) {
      void notify('Novo recorde', `${metrics.longestStreak} dias seguidos escrevendo.`);
      void setCelebratedStreak(metrics.longestStreak);
    }

    const weekly = writingHistory(state.recordings, now).weekly;
    const weeklyWords = weekly[weekly.length - 1]?.words ?? 0;
    await syncWritingReminder(
      writingReminder({ metrics, weeklyWords, goal: state.weeklyWordGoal, now }),
      state.reminderHour,
    );
  }, [setCelebratedStreak, setCelebratedWords]);

  useEffect(() => {
    void sync();
    const interval = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void sync();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [sync, recordings.length]);
}

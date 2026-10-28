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
  warmWritingFacts,
  wordMilestone,
  writingHistory,
  writingReminder,
} from '@/core/writing';
import { notify, syncWritingReminder } from '@/services/notifications';
import { noteIsOpen } from '@/services/noteVisibility';

import { useLibrary } from './LibraryContext';
import { useSettings } from './SettingsContext';

/** Reavalia de tempo em tempo (pega virada do dia e texto salvo so no banco). */
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Espera a tela assentar antes de analisar a biblioteca (nunca no toque). */
const FIRST_SYNC_DELAY_MS = 8_000;

/**
 * `enabled` fica falso enquanto o microfone abre ou grava: analisar a
 * biblioteca inteira no mesmo instante atrasava o inicio da gravacao.
 */
export function useWritingReminders(enabled = true): void {
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
    if (!enabled || noteIsOpen()) return;
    const state = stateRef.current;
    if (!state.writingReminders) {
      await syncWritingReminder(null, state.reminderHour);
      return;
    }
    const now = new Date();
    // Analisa em blocos: a biblioteca inteira de uma vez segurava o toque na
    // home por alguns segundos logo depois de abrir o app. O cache fica quente
    // para o Painel tambem.
    await warmWritingFacts(state.recordings).catch(() => undefined);
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
  }, [enabled, setCelebratedStreak, setCelebratedWords]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void sync(), FIRST_SYNC_DELAY_MS);
    const interval = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void sync();
    });
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      subscription.remove();
    };
  }, [sync, recordings.length, enabled]);
}

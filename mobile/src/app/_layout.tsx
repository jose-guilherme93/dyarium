import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startPerfReport, useRenderCount } from '@/dev/perf';
import { registerUploadTask } from '@/services/background';
import { configureNotifications } from '@/services/notifications';
import { LibraryProvider } from '@/state/LibraryContext';
import { PlaybackProvider } from '@/state/PlaybackContext';
import { RecordingProvider } from '@/state/RecordingContext';
import { SettingsProvider, useSettings } from '@/state/SettingsContext';
import { useMetricsSync } from '@/state/useMetricsSync';
import { useWritingReminders } from '@/state/useWritingReminders';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Segura a primeira tela ate as preferencias (tipografia, servidor) estarem
 * carregadas. Sem isso a nota abria com a fonte padrao e trocava depois, o que
 * parecia "recarregar a fonte" a cada abertura.
 */
function Ready({ children }: { children: ReactNode }) {
  const { ready } = useSettings();
  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);
  if (!ready) return null;
  return <>{children}</>;
}

/** Agenda os lembretes de escrita (precisa dos providers de biblioteca/config). */
function Reminders() {
  useWritingReminders();
  return null;
}

/** Mantem as metricas de escrita prontas e sincronizadas com o servidor. */
function Metrics() {
  useMetricsSync();
  return null;
}

export default function RootLayout() {
  useRenderCount('RootLayout');
  useEffect(() => {
    // Configura a sessao de audio cedo para o player nao falhar no Android.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    configureNotifications();
    startPerfReport();
    void registerUploadTask();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <Ready>
            <LibraryProvider>
              <PlaybackProvider>
                <RecordingProvider>
                  <Reminders />
                  <Metrics />
                  <StatusBar style="light" />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.bg },
                      freezeOnBlur: true,
                    }}
                  >
                    {/* Desliza pro lado (como antes), mas na variante rapida do Android
                        (`ios_from_right` = 150 ms); o `slide_from_*` e fixo em 300 ms. */}
                    <Stack.Screen name="note/[id]" options={{ animation: 'ios_from_right' }} />
                    <Stack.Screen name="transcript/[id]" options={{ animation: 'ios_from_right' }} />
                    <Stack.Screen name="record" options={{ animation: 'slide_from_bottom' }} />
                  </Stack>
                </RecordingProvider>
              </PlaybackProvider>
            </LibraryProvider>
          </Ready>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

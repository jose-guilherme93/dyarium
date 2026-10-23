import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startPerfReport, useRenderCount } from '@/dev/perf';
import { stopForegroundTask } from '../../modules/foreground-task';
import { registerUploadTask } from '@/services/background';
import { configureNotifications } from '@/services/notifications';
import { LibraryProvider } from '@/state/LibraryContext';
import { PlaybackProvider } from '@/state/PlaybackContext';
import { RecordingProvider, useRecording } from '@/state/RecordingContext';
import { SettingsProvider } from '@/state/SettingsContext';
import { useWritingReminders } from '@/state/useWritingReminders';
import { colors } from '@/theme/tokens';

// Fundo da janela nativa: durante as transicoes e antes do primeiro frame nao
// pode aparecer o branco padrao do sistema. O `backgroundColor` do app.json
// cobre o build; aqui ele tambem vale para o runtime.
void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Agenda os lembretes de escrita (precisa dos providers de biblioteca/config). */
function Reminders() {
  // Deter o microfone tem prioridade: analisar a biblioteca inteira durante o
  // prepare/gravacao era o que travava a tela de gravacao.
  const { active, starting } = useRecording();
  useWritingReminders(!active && !starting);
  return null;
}

export default function RootLayout() {
  useRenderCount('RootLayout');
  useEffect(() => {
    // A tela nao espera o cofre (SecureStore): as preferencias chegam em
    // segundo plano e a interface continua util com os padroes enquanto isso.
    void SplashScreen.hideAsync().catch(() => undefined);
    // Configura a sessao de audio cedo para o player nao falhar no Android.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    configureNotifications();
    startPerfReport();
    void registerUploadTask();
    // Se o processo anterior morreu no meio de uma transcricao, a notificacao
    // em primeiro plano fica presa para sempre. No boot nao ha transcricao
    // rodando: limpar aqui evita o aviso fantasma de "Transcrevendo nota".
    stopForegroundTask();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlaybackProvider>
              <RecordingProvider>
                <Reminders />
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.bg },
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
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

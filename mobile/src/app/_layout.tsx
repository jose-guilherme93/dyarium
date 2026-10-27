import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startPerfReport, useRenderCount } from '@/dev/perf';
import { stopForegroundTask } from '../../modules/foreground-task';
import { loadStoredActivities } from '@/services/activity';
import { registerUploadTask } from '@/services/background';
import { configureNotifications } from '@/services/notifications';
import { LibraryProvider } from '@/state/LibraryContext';
import { PlaybackProvider } from '@/state/PlaybackContext';
import { RecordingProvider, useRecording } from '@/state/RecordingContext';
import { SettingsProvider } from '@/state/SettingsContext';
import { useWritingReminders } from '@/state/useWritingReminders';
import { useTheme, ThemeProvider } from '@/theme/ThemeContext';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Inter e a familia do app inteiro. Os arquivos ficam no bundle: carregar da
 * rede deixaria o primeiro frame com a fonte do sistema e trocaria o texto
 * depois. A splash so sai quando as fontes estao prontas (ou falharam, para
 * nao prender o app num build sem o arquivo).
 */
const FONT_SOURCES = {
  Inter_300Light: require('../../assets/fonts/Inter-Light.ttf'),
  Inter_400Regular: require('../../assets/fonts/Inter-Regular.ttf'),
  Inter_400Regular_Italic: require('../../assets/fonts/Inter-Italic.ttf'),
  Inter_500Medium: require('../../assets/fonts/Inter-Medium.ttf'),
  Inter_600SemiBold: require('../../assets/fonts/Inter-SemiBold.ttf'),
  Inter_700Bold: require('../../assets/fonts/Inter-Bold.ttf'),
  Inter_800ExtraBold: require('../../assets/fonts/Inter-ExtraBold.ttf'),
} as const;

/** Agenda os lembretes de escrita (precisa dos providers de biblioteca/config). */
function Reminders() {
  // Deter o microfone tem prioridade: analisar a biblioteca inteira durante o
  // prepare/gravacao era o que travava a tela de gravacao.
  const { active, starting } = useRecording();
  useWritingReminders(!active && !starting);
  return null;
}

/**
 * Arvore que depende do tema. Fica dentro de `ThemeProvider` para o fundo da
 * janela, a barra de status e as telas acompanharem a troca.
 */
function ThemedRoot() {
  useRenderCount('ThemedRoot');
  const { colors, name } = useTheme();

  useEffect(() => {
    // Fundo da janela nativa: durante as transicoes e antes do primeiro frame
    // nao pode aparecer o branco padrao do sistema.
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
  }, [colors.bg]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <LibraryProvider>
        <PlaybackProvider>
          <RecordingProvider>
            <Reminders />
            <StatusBar style={name === 'light' ? 'dark' : 'light'} />
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
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  useRenderCount('RootLayout');
  const [fontsLoaded, fontError] = useFonts(FONT_SOURCES);
  useEffect(() => {
    if (fontError) {
      console.warn('[dyarium] falha ao carregar a fonte do app');
    }
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontError, fontsLoaded]);
  useEffect(() => {
    // A tela nao espera o cofre (SecureStore): as preferencias chegam em
    // segundo plano e a interface continua util com os padroes enquanto isso.
    // Configura a sessao de audio cedo para o player nao falhar no Android.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    configureNotifications();
    startPerfReport();
    void registerUploadTask();
    // Historico do centro de atividade: o que rodou antes continua la, e o que
    // morreu no meio aparece como interrompido.
    void loadStoredActivities();
    // Se o processo anterior morreu no meio de uma transcricao, a notificacao
    // em primeiro plano fica presa para sempre. No boot nao ha transcricao
    // rodando: limpar aqui evita o aviso fantasma de "Transcrevendo nota".
    stopForegroundTask();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <ThemedRoot />
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

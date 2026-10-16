import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerUploadTask } from '@/services/background';
import { configureNotifications } from '@/services/notifications';
import { LibraryProvider } from '@/state/LibraryContext';
import { PlaybackProvider } from '@/state/PlaybackContext';
import { RecordingProvider } from '@/state/RecordingContext';
import { SettingsProvider } from '@/state/SettingsContext';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  useEffect(() => {
    // Configura a sessao de audio cedo para o player nao falhar no Android.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    configureNotifications();
    void registerUploadTask();
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlaybackProvider>
              <RecordingProvider>
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
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

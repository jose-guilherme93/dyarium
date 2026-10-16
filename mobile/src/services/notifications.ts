/** Permissoes e avisos locais. Sem conteudo sensivel nas notificacoes. */

import * as Notifications from 'expo-notifications';

/**
 * Faz a notificacao aparecer tambem com o app em primeiro plano (sem isto o
 * expo-notifications nao mostra em primeiro plano). Sem som nem badge.
 */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // notificacao e best-effort
  }
}

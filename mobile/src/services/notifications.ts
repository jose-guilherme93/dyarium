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

const WRITING_PREFIX = 'writing-';

async function cancelWritingReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if (item.identifier?.startsWith(WRITING_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * (Re)agenda o lembrete de escrita para a proxima `hour`:00 (hoje, se ainda nao
 * passou; senao amanha). Com `reminder` null, so cancela os lembretes.
 */
export async function syncWritingReminder(
  reminder: { title: string; body: string } | null,
  hour: number,
): Promise<void> {
  await cancelWritingReminders();
  if (!reminder) return;
  if (!(await ensureNotificationPermission())) return;

  const when = new Date();
  when.setHours(hour, 0, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `${WRITING_PREFIX}${when.getTime()}`,
      content: { title: reminder.title, body: reminder.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
  } catch {
    // agendamento e best-effort
  }
}

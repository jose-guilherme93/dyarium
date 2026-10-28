/** Permissoes e avisos locais. Sem conteudo sensivel nas notificacoes. */

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

/**
 * Dois canais, escolhidos para sempre (a importancia do canal e imutavel depois
 * de criada): "Atividade" e mudo e serve ao progresso; "Concluido" e o unico que
 * toca. Separar os dois evita que cada janela de revisao apite no ouvido.
 */
const ACTIVITY_CHANNEL = 'activity';
const DONE_CHANNEL = 'done';
/** Um identificador so: a notificacao de progresso se atualiza no lugar. */
const ACTIVITY_ID = 'activity';
const ACTIVITY_DONE_ID = 'activity-done';

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
  if (Platform.OS !== 'android') return;
  void (async () => {
    try {
      await Notifications.setNotificationChannelAsync(ACTIVITY_CHANNEL, {
        name: 'Atividade',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        vibrationPattern: null,
        showBadge: false,
      });
      await Notifications.setNotificationChannelAsync(DONE_CHANNEL, {
        name: 'Concluído',
        importance: Notifications.AndroidImportance.DEFAULT,
        showBadge: false,
      });
    } catch {
      // canal e best-effort: sem ele a notificacao cai no canal padrao
    }
  })();
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Permissao ja concedida, sem abrir dialogo. O inicio da gravacao nao pode
 * esperar a resposta do usuario: sem a permissao ele grava em primeiro plano.
 */
export async function notificationPermissionGranted(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    return current.granted;
  } catch {
    return false;
  }
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        ...(Platform.OS === 'android' ? { channelId: DONE_CHANNEL } : {}),
      },
      trigger: null,
    });
  } catch {
    // notificacao e best-effort
  }
}

/**
 * Fim de trabalho: so aparece quando o app nao esta na frente. Com a tela
 * aberta, quem conta o resultado e a propria tela.
 */
export async function notifyIfHidden(title: string, body: string): Promise<void> {
  if (AppState.currentState === 'active') return;
  await notify(title, body);
}

/** Etapa do trabalho que a notificacao mostra. */
export type TaskStage = 'importing' | 'transcribing' | 'reviewing' | 'analyzing';

const STAGE_LABEL: Record<TaskStage, string> = {
  importing: 'importando',
  transcribing: 'transcrevendo',
  reviewing: 'revisando',
  analyzing: 'analisando',
};

export interface ActivityMessage {
  stage: TaskStage;
  noteTitle: string;
  /** Posicao no lote ou trecho alcancado. */
  index?: number;
  /** Tamanho do lote ou total de trechos. */
  total?: number;
  /** Porcentagem, quando existe uma (transcricao). */
  percent?: number;
}

/**
 * Texto da notificacao de atividade: duas linhas curtas, com o numero na frente
 * e o nome da nota atras. Sem frase — e a mesma regra da interface.
 */
export function activityMessage(input: ActivityMessage): { title: string; body: string } {
  const counter =
    input.index !== undefined && input.total !== undefined && input.total > 0
      ? `${input.index} de ${input.total} · `
      : '';
  const title = `${counter}${STAGE_LABEL[input.stage]}`;
  const percent =
    input.percent !== undefined && input.percent > 0 ? ` · ${Math.round(input.percent)}%` : '';
  const body = `${input.noteTitle.trim() || 'Nota'}${percent}`;
  return { title, body };
}

/**
 * Progresso de um trabalho que demora. Atualiza a mesma notificacao em vez de
 * empilhar uma por janela. Com o app aberto a tela ja mostra o progresso, entao
 * a notificacao de sistema fica muda.
 */
export async function notifyActivity(input: ActivityMessage): Promise<void> {
  if (AppState.currentState === 'active') return;
  try {
    const { title, body } = activityMessage(input);
    await Notifications.scheduleNotificationAsync({
      identifier: ACTIVITY_ID,
      content: {
        title,
        body,
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ACTIVITY_CHANNEL } : {}),
      },
      trigger: null,
    });
  } catch {
    // notificacao e best-effort
  }
}

/** Resumo do fim do lote: "8 de 8 concluídos", com a falha quando houver. */
export function doneMessage(done: number, total: number, failed: number): { title: string; body: string } {
  const title = `${done} de ${total} concluídos`;
  const body = failed > 0 ? `${failed} com erro` : 'Pronto';
  return { title, body };
}

export async function notifyActivityDone(done: number, total: number, failed: number): Promise<void> {
  try {
    const { title, body } = doneMessage(done, total, failed);
    await Notifications.dismissNotificationAsync(ACTIVITY_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: ACTIVITY_DONE_ID,
      content: {
        title,
        body,
        ...(Platform.OS === 'android' ? { channelId: DONE_CHANNEL } : {}),
      },
      trigger: null,
    });
  } catch {
    // notificacao e best-effort
  }
}

/**
 * Falha que precisa de acao: fica na tela por nota, porque o usuario tem que
 * tocar nela. Nunca leva o texto do audio, so o nome da nota.
 */
export async function notifyTaskFailed(noteTitle: string, reason: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `failed-${noteTitle}`,
      content: {
        title: noteTitle.trim() || 'Nota',
        body: reason,
        ...(Platform.OS === 'android' ? { channelId: DONE_CHANNEL } : {}),
      },
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

/**
 * Diagnostico anonimo do app.
 *
 * O Expo Insights ja esta no projeto e manda so o evento de abertura, agregado
 * e sem identidade; ele nao tem como ser desligado no aparelho. Para o que o
 * app precisa consertar em producao — erro com pilha, versao, modelo e sistema
 * — o Sentry e o caminho, e ele respeita a opcao "Enviar diagnostico".
 *
 * Nada de identidade: sem usuario, sem e-mail, sem token, sem conteudo de nota.
 * Sem DSN configurada, o SDK nao inicia e nada sai do aparelho.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

import { getAppFlag, setAppFlag } from './db';

const FLAG = 'diagnostics.enabled';

let enabled = true;
let started = false;

function dsn(): string {
  const inline = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
  if (inline) return inline;
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const value = extra?.sentryDsn;
  return typeof value === 'string' ? value.trim() : '';
}

/** Ha projeto Sentry configurado neste build? */
export function diagnosticsConfigured(): boolean {
  return dsn().length > 0;
}

/** Le a opcao salva, sem iniciar nada. */
export async function readDiagnosticsEnabled(): Promise<boolean> {
  const stored = await getAppFlag(FLAG).catch(() => null);
  enabled = stored !== '0';
  return enabled;
}

/** A opcao do usuario; aplicada no inicio do app e no toggle das opcoes. */
export async function initDiagnostics(): Promise<void> {
  await readDiagnosticsEnabled();
  const projectDsn = dsn();
  if (!enabled || !projectDsn || started) return;

  Sentry.init({
    dsn: projectDsn,
    // Erro de desenvolvimento nao se mistura com o de producao no painel.
    environment: __DEV__ ? 'development' : 'production',
    // Performance: amostra total em dev, parcial em producao.
    tracesSampleRate: __DEV__ ? 1 : 0.1,
    // Log tecnico do proprio SDK (nunca conteudo de nota).
    enableLogs: true,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    enableAutoSessionTracking: true,
    enableNativeCrashHandling: true,
    debug: false,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      if (!enabled) return null;
      // O evento nao carrega quem e o dono. request pode ter URL de anexo;
      // o detalhe util (stack, versao, aparelho) fica.
      if (event.user) delete event.user;
      if (event.request) delete event.request;
      return event;
    },
  });
  started = true;
  Sentry.logger.info('diagnostico iniciado', {
    version: Constants.expoConfig?.version ?? '',
  });
}

/** Liga/desliga o envio. Desligar fecha o cliente desta execucao. */
export async function setDiagnosticsEnabled(next: boolean): Promise<void> {
  enabled = next;
  await setAppFlag(FLAG, next ? '1' : '0');
  if (!next) {
    started = false;
    await Sentry.close().catch(() => undefined);
    return;
  }
  if (!started) await initDiagnostics();
}

export function diagnosticsEnabled(): boolean {
  return enabled;
}

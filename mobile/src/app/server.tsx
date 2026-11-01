import { Ionicons } from '@expo/vector-icons';
import { back } from '@/services/appNavigation';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import type { ServerConfig } from '@/core/types';
import { discoverServer } from '@/services/discovery';
import type { StoredServer } from '@/services/secure';
import { countSyncedNotes } from '@/services/sync/state';
import { reconcileAllServers } from '@/services/sync/engine';
import { useLibrary } from '@/state/LibraryContext';
import { useSettings, type ConnectionResult } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export default function ServerScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { config, servers, ready, save, removeServer, disconnect } = useSettings();

  return (
    <Screen>
      <View style={styles.header}>
        <Press onPress={() => back()} style={styles.back} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Press>
        <Text style={styles.title}>Servidor</Text>
        <View style={styles.back} />
      </View>
      {ready ? (
        <ServerForm
          config={config}
          servers={servers}
          save={save}
          removeServer={removeServer}
          disconnect={disconnect}
        />
      ) : null}
    </Screen>
  );
}

interface ServerFormProps {
  config: ServerConfig | null;
  servers: StoredServer[];
  save(baseUrl: string, token: string): Promise<ConnectionResult>;
  removeServer(id: string): Promise<void>;
  disconnect(): Promise<void>;
}

function ServerForm({ config, servers, save, removeServer, disconnect }: ServerFormProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();
  const { recordings } = useLibrary();

  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [token, setToken] = useState(config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const total = recordings.filter((r) => !r.deletedAt && r.status === 'completed').length;

  useEffect(() => {
    let alive = true;
    const load = () => {
      void Promise.all(
        servers.map(async (server) => {
          const count = await countSyncedNotes(server.baseUrl).catch(() => 0);
          return [server.baseUrl, count] as const;
        }),
      ).then((entries) => {
        if (alive) setCounts(Object.fromEntries(entries));
      });
    };
    load();
    // A primeira copia de um acervo grande demora; o numero precisa andar
    // enquanto a tela esta aberta.
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [servers, total]);

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    setDiscovery(null);
    const found = await discoverServer();
    setDiscovering(false);
    if (found) {
      setBaseUrl(found);
      setDiscovery(`Servidor encontrado em ${found}`);
    } else {
      setDiscovery('Não encontrei o servidor automaticamente. Informe a URL abaixo.');
    }
  }, []);

  useEffect(() => {
    if (baseUrl) return undefined;
    const timer = setTimeout(() => void runDiscovery(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    const result = await save(baseUrl, token);
    setBusy(false);
    if (result.ok) {
      setMessage({ kind: 'ok', text: `Conectado. Versao ${result.version ?? 'desconhecida'}.` });
    } else {
      setMessage({ kind: 'error', text: result.error ?? 'Falha ao conectar.' });
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setBaseUrl('');
    setToken('');
    setMessage(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Aponte para o seu servidor dyarium. O token fica guardado no cofre seguro do aparelho.
        </Text>

        <Button
          label="Procurar servidor automaticamente"
          variant="secondary"
          onPress={runDiscovery}
          loading={discovering}
        />
        {discovery ? <Text style={styles.discovery}>{discovery}</Text> : null}

        <Card style={styles.form}>
          <Field
            label="URL do servidor"
            placeholder="http://100.x.y.z:8080"
            value={baseUrl}
            onChangeText={setBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="Token"
            placeholder="cole o DIARY_TOKEN"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Button label="Testar e salvar" onPress={handleSave} loading={busy} />
          {message ? (
            <View
              style={[
                styles.message,
                {
                  backgroundColor: message.kind === 'ok' ? colors.successSoft : colors.dangerSoft,
                  borderColor: message.kind === 'ok' ? colors.success : colors.danger,
                },
              ]}
            >
              <Ionicons
                name={message.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={message.kind === 'ok' ? colors.success : colors.danger}
              />
              <Text
                style={[
                  styles.messageText,
                  { color: message.kind === 'ok' ? colors.success : colors.danger },
                ]}
              >
                {message.text}
              </Text>
            </View>
          ) : null}
        </Card>

        {servers.length > 0 ? (
          <Card style={styles.form}>
            <Text style={styles.sectionLabel}>Ambientes</Text>
            {servers.map((server) => {
              const count = counts[server.baseUrl] ?? 0;
              const complete = total > 0 && count >= total;
              return (
                <View key={server.id || server.baseUrl} style={styles.serverRow}>
                  <Ionicons
                    name={complete ? 'checkmark-circle' : 'sync-outline'}
                    size={18}
                    color={complete ? colors.success : colors.textSecondary}
                  />
                  <View style={styles.serverText}>
                    <Text style={styles.serverName} numberOfLines={1}>
                      {serverHost(server.baseUrl)}
                    </Text>
                    <Text style={styles.serverMeta} numberOfLines={1}>
                      {count}/{total} notas
                    </Text>
                  </View>
                  <Press
                    onPress={() => void removeServer(server.id || server.baseUrl)}
                    accessibilityLabel="Remover servidor"
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
                  </Press>
                </View>
              );
            })}
            <Button
              label="Sincronizar agora"
              variant="secondary"
              onPress={() => {
                void reconcileAllServers().catch(() => undefined);
              }}
            />
          </Card>
        ) : null}

        <Card style={styles.tip}>
          <Ionicons name="information-circle-outline" size={20} color={colors.info} />
          <Text style={styles.tipText}>
            Na mesma rede ou na tailnet, use o IP do servidor. Com Tailscale ativo no celular, o
            endereco 100.x.y.z funciona de qualquer lugar.
          </Text>
        </Card>

        {config ? (
          <Button label="Desconectar" variant="danger" onPress={handleDisconnect} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function serverHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//i, '');
  }
}

const baseStyles = defineStyles({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: baseColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.xl, gap: spacing.lg },
  lead: { color: baseColors.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
  discovery: { color: baseColors.textSecondary, fontSize: fontSize.sm },
  form: { gap: spacing.lg },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  messageText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600' },
  sectionLabel: { color: baseColors.textSecondary, fontSize: fontSize.xs, fontWeight: '700' },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  serverText: { flex: 1, gap: 2 },
  serverName: { color: baseColors.text, fontSize: fontSize.md, fontWeight: '600' },
  serverMeta: { color: baseColors.textSecondary, fontSize: fontSize.xs },
  tip: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  tipText: { flex: 1, color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
});

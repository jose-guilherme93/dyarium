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
import { useSettings, type ConnectionResult } from '@/state/SettingsContext';
import { baseColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { defineStyles } from '@/theme/themedStyles';

export default function ServerScreen() {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const { config, ready, save, disconnect } = useSettings();

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
        <ServerForm config={config} save={save} disconnect={disconnect} />
      ) : null}
    </Screen>
  );
}

interface ServerFormProps {
  config: ServerConfig | null;
  save(baseUrl: string, token: string): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
}

function ServerForm({ config, save, disconnect }: ServerFormProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = useTheme();

  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [token, setToken] = useState(config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<string | null>(null);

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
  tip: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  tipText: { flex: 1, color: baseColors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
});

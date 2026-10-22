import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveWaveform } from '@/components/LiveWaveform';
import { formatDuration } from '@/core/format';
import type { Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { deleteRecordingRow } from '@/services/db';
import { clearPendingInsert, takePendingInsert } from '@/services/noteInsert';
import { audioFileName, deleteSessionFiles, moveAudio, sessionDirUri } from '@/services/files';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording, useRecordingLive } from '@/state/RecordingContext';
import { colors, fontSize, spacing } from '@/theme/tokens';

/**
 * Tela de gravacao em tela cheia, com a waveform animada pelo microfone.
 * Ao parar: se veio da nota (`noteId`), o audio e anexado a ela; se veio da
 * home, vira uma nota nova. Em ambos os casos, volta para a nota.
 */
export default function RecordScreen() {
  const { noteId, from } = useLocalSearchParams<{
    noteId?: string;
    from?: string;
  }>();
  const { attachAudio, enqueue, refresh, submitNote } = useLibrary();
  const { active, error, busy, paused, pause, unpause, start, stop } = useRecording();
  // Tempo e nivel mudam varias vezes por segundo e vivem em outro contexto:
  // a home nao re-renderiza junto enquanto a gravacao esta aberta.
  const { elapsedMs, level } = useRecordingLive();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const startedRef = useRef(false);
  useRenderCount('Record');

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const finish = useCallback(async () => {
    setFinishError(null);
    const finished = await stop({ enqueue: false });
    if (!finished) {
      // Nada foi capturado: o erro do contexto ja esta na tela. Sair calado
      // deixava a impressao de que a nota tinha sido criada.
      return;
    }
    if (noteId) {
      // Se a nota sumiu no meio do caminho, o audio nao pode ser perdido: o
      // anexo falha e a gravacao vira uma nota propria logo abaixo.
      const movedPath = await moveAudio(finished.id, noteId, audioFileName(finished.id)).catch(
        (error) => {
          console.warn('[dyarium] falha ao mover o audio da gravacao', String(error));
          return null;
        },
      );
      const attached: Recording = {
        ...finished,
        dir: movedPath ? sessionDirUri(noteId) : finished.dir,
        filePath: movedPath ?? finished.filePath,
      };
      // A posicao vem guardada pela tela da nota: o no de texto e o offset
      // do cursor, para o audio entrar no lugar certo.
      const position = takePendingInsert(noteId);
      const kept = await attachAudio(noteId, attached, position).catch((error) => {
        console.warn('[dyarium] falha ao anexar o audio na nota', String(error));
        return false;
      });
      if (kept) {
        await deleteRecordingRow(finished.id);
        // A nota nasceu como rascunho (ou ja existia): garante que ela saia do
        // status invisivel `draft` mesmo se a tela da nota nao abrir agora.
        await submitNote(noteId);
        await refresh();
        // Se a gravacao veio da propria nota, voltar evita duas telas da mesma
        // nota. Se veio da home, abre a nota para o audio nao ficar escondido
        // atras de um rascunho sem caderno visivel.
        if (from === 'note' && router.canGoBack()) router.back();
        else router.replace({ pathname: '/note/[id]', params: { id: noteId } });
        return;
      }
      console.warn('[dyarium] nota de destino sumiu; guardando a gravacao como nota');
      await enqueue(attached);
      router.replace({ pathname: '/note/[id]', params: { id: finished.id } });
      return;
    }
    await enqueue(finished);
    router.replace({ pathname: '/note/[id]', params: { id: finished.id } });
  }, [stop, noteId, from, attachAudio, enqueue, refresh, submitNote]);

  const handleStop = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      await finish();
    } catch {
      // Nada de conteudo do audio no aviso: so o suficiente para o usuario
      // saber que a gravacao continua guardada e pode ser recuperada.
      setFinishError('Não foi possível guardar esta gravação. Tente de novo.');
    } finally {
      setFinishing(false);
    }
  }, [finishing, finish]);

  // A tela pode sair pelo botao do sistema, sem passar pelo "X": a posicao
  // guardada pela nota precisa ser descartada em qualquer saida, senao a
  // proxima gravacao herda a posicao velha.
  useEffect(
    () => () => {
      if (noteId) clearPendingInsert(noteId);
    },
    [noteId],
  );

  const handleDiscard = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const finished = await stop({ enqueue: false });
      if (finished) {
        deleteSessionFiles(finished.id);
        await deleteRecordingRow(finished.id);
        await refresh();
      }
    } finally {
      setFinishing(false);
      // A gravacao foi cancelada: a posicao guardada pela tela da nota nao
      // vale mais, e a proxima gravacao nao pode herdar a antiga.
      if (noteId) clearPendingInsert(noteId);
      router.back();
    }
  }, [finishing, noteId, stop, refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => void handleDiscard()} accessibilityLabel="Cancelar" hitSlop={12}>
          <Ionicons name="close" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.label}>{noteId ? 'Gravando na nota' : 'Nova gravação'}</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.center}>
        <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
        <LiveWaveform active={Boolean(active)} paused={paused} level={level} height={120} color={colors.accent} />
        <Text style={styles.hint}>
          {paused
            ? 'Pausado'
            : active
              ? 'Gravando com a tela bloqueada'
              : busy
                ? 'Preparando...'
                : '...'}
        </Text>
        {finishError ?? error ? <Text style={styles.error}>{finishError ?? error}</Text> : null}
      </View>

      <View style={styles.bottom}>
        <View style={styles.controls}>
          <Pressable
            style={[styles.pause, !active && styles.stopDisabled]}
            onPress={() => (paused ? unpause() : pause())}
            disabled={!active || finishing}
            accessibilityLabel={paused ? 'Retomar gravação' : 'Pausar gravação'}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={26} color={colors.text} />
          </Pressable>
          <Pressable
            style={[styles.stop, finishing && styles.stopDisabled]}
            onPress={() => void handleStop()}
            disabled={finishing || !active}
            accessibilityLabel="Parar gravação"
          >
            <Ionicons name="stop" size={30} color="#FFFFFF" />
          </Pressable>
        </View>
        <Text style={styles.bottomHint}>Pausar · Parar</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
  },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  spacer: { width: 26 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  timer: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  hint: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  bottom: { alignItems: 'center', gap: spacing.lg, paddingBottom: spacing.xxxl },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxl },
  pause: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopDisabled: { opacity: 0.5 },
  bottomHint: { color: colors.textTertiary, fontSize: fontSize.xs },
});

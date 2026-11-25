import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { back, replace } from '@/services/appNavigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Press } from '@/components/Press';

import { LiveWaveform } from '@/components/LiveWaveform';
import { RecordClock } from '@/components/RecordClock';
import { formatDuration } from '@/core/format';
import type { Recording } from '@/core/types';
import { useRenderCount } from '@/dev/perf';
import { deleteRecordingRow } from '@/services/db';
import { clearPendingInsert, takePendingInsert } from '@/services/noteInsert';
import { audioFileName, deleteSessionFiles, moveAudio, sessionDirUri } from '@/services/files';
import { useLibrary } from '@/state/LibraryContext';
import { useRecording, useRecordingLive } from '@/state/RecordingContext';
import {
  designIcon,
  designSpace,
  designState,
  designType,
} from '@/theme/design';

import { Icon } from '@/ui/icons';
import { useDesign } from '@/ui/useDesign';

/**
 * Tela de gravacao em tela cheia, com a waveform animada pelo microfone.
 * Ao parar: se veio da nota (`noteId`), o audio e anexado a ela; se veio da
 * home, vira uma nota nova. Em ambos os casos, volta para a nota.
 *
 * A tela mostra, como antes: fechar, rotulo, hora e data de agora, onda ao
 * vivo, relogio decorrido, dica de estado, erro, pausar/retomar, parar e a
 * dica "pausar · parar". So a forma mudou para os tokens do sistema.
 */
export default function RecordScreen() {
  const colors = useDesign();

  const { noteId, from } = useLocalSearchParams<{
    noteId?: string;
    from?: string;
  }>();
  const { attachAudio, enqueue, refresh, submitNote } = useLibrary();
  const { active, error, busy, starting, paused, pause, unpause, start, stop, readMetering } =
    useRecording();
  // O nivel do microfone e lido pela propria onda, sem passar por estado. O
  // tempo fica no componente `RecordTimer`: se ele ficasse aqui, a tela (e a
  // onda dentro dela) re-renderizaria duas vezes por segundo so para trocar o
  // relogio, e cada render custava quadros.

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
      // Navega assim que a gravacao parou: anexar e atualizar a biblioteca
      // rodam em segundo plano e nao travam o toque em "Parar".
      if (from === 'note') back();
      else replace({ pathname: '/note/[id]', params: { id: noteId } });

      void (async () => {
        try {
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
            return;
          }
          console.warn('[dyarium] nota de destino sumiu; guardando a gravacao como nota');
          setFinishError('A nota ficou sem áudio.');
          await enqueue(attached);
          replace({ pathname: '/note/[id]', params: { id: finished.id } });
        } catch (error) {
          console.warn('[dyarium] falha ao finalizar a gravacao em segundo plano', String(error));
          setFinishError('A nota ficou sem áudio.');
        }
      })();
      return;
    }
    replace({ pathname: '/note/[id]', params: { id: finished.id } });
    void enqueue(finished).catch((error) => {
      console.warn('[dyarium] falha ao guardar a gravacao', String(error));
      setFinishError('Não foi possível guardar esta gravação. Tente de novo.');
    });
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
      back();
    }
  }, [finishing, noteId, stop, refresh]);

  const hint = paused
    ? 'Pausado'
    : active
      ? 'Gravando com a tela bloqueada'
      : starting || busy
        ? 'Preparando...'
        : '...';

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <Press
          onPress={() => void handleDiscard()}
          accessibilityLabel="Cancelar"
          hitSlop={12}
          style={styles.close}
        >
          <Icon name="close" size={designIcon.lg} color={colors.textMuted} />
        </Press>
        <Text style={[styles.label, { color: colors.textMuted }]}>
          {noteId ? 'Gravando na nota' : 'Nova gravação'}
        </Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.center}>
        <RecordClock />
        <LiveWaveform
          active={Boolean(active)}
          paused={paused}
          sampleMetering={readMetering}
          // 40% mais alta que as 100 dp originais: a diferenca entre silencio
          // (traco minimo) e fala fica visivel sem esforco.
          height={140}
          color={colors.primary}
        />
        <RecordTimer />
        <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text>
        {finishError ?? error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{finishError ?? error}</Text>
        ) : null}
      </View>

      <View style={styles.bottom}>
        <View style={styles.controls}>
          <Press
            style={[
              styles.pause,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
              (!active || finishing) && { opacity: designState.disabled },
            ]}
            onPress={() => (paused ? unpause() : pause())}
            disabled={!active || finishing}
            accessibilityLabel={paused ? 'Retomar gravação' : 'Pausar gravação'}
          >
            <Icon
              name={paused ? 'play' : 'pause'}
              size={20}
              color={active ? colors.text : colors.textMuted}
            />
          </Press>
          <Press
            style={[
              styles.stop,
              { backgroundColor: colors.danger, borderColor: colors.danger },
              finishing && { opacity: designState.disabled },
            ]}
            onPress={() => void handleStop()}
            disabled={finishing || !active}
            accessibilityLabel="Parar gravação"
          >
            <Icon name="stop" size={22} color={colors.surface} />
          </Press>
        </View>
        <Text style={[styles.bottomHint, { color: colors.textMuted }]}>Pausar · Parar</Text>
      </View>
    </View>
  );
}

/**
 * Relogio da gravacao. Consome o tempo ao vivo isolado: a tela de gravacao e a
 * onda nao re-renderizam a cada meio segundo por causa do relogio.
 */
function RecordTimer() {
  const colors = useDesign();
  const { elapsedMs } = useRecordingLive();
  return (
    <Text
      testID="record-timer"
      style={[styles.timer, { color: colors.text }]}
    >
      {formatDuration(elapsedMs)}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpace.s16,
    paddingTop: designSpace.s16,
    paddingBottom: designSpace.s8,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -designSpace.s12,
  },
  label: {
    fontSize: designType.label.size,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  spacer: { width: 44 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designSpace.s12,
    paddingHorizontal: designSpace.s16,
  },
  timer: {
    fontSize: designType.display.size,
    fontWeight: '600',
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    fontSize: designType.mono.size,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  error: {
    fontSize: designType.body.size,
    fontWeight: '500',
    lineHeight: designType.body.size * designType.body.lineHeight,
    textAlign: 'center',
  },
  bottom: {
    alignItems: 'center',
    gap: designSpace.s12,
    paddingBottom: designSpace.s24,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: designSpace.s24 },
  pause: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomHint: {
    fontSize: designType.label.size,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

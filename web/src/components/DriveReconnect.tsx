import { useEffect, useRef, useState, useSyncExternalStore } from "react";
// A linha e a mesma peca das Configuracoes; a folha vem junto para o desenho do
// `.cfg-item`/`.cfg-mark`/`.cfg-btn` nao depender de a tela de Configuracoes
// estar no bundle.
import "../views/settings.css";
import { describeDriveError } from "./FirstRun";
import { VaultBoot } from "./VaultBoot";
import { formatBytes } from "../lib/format";
import type { StepProgress } from "../local/backup";
import {
  driveConfigured,
  driveSessionState,
  onDriveSessionChange,
} from "../local/driveSession";
import { connectAccount } from "../local/accountConnect";
import type { VaultStage, VaultSummary } from "../local/vaultCloud";
import { flushVaultSync } from "../local/folderSync";
import {
  clearVaultActivityError,
  subscribeVaultActivity,
  vaultActivity,
} from "../local/vaultActivity";
import {
  DRIVE_MARK_KEY,
  driveMarked,
  rememberDriveVault,
  clearDriveMark,
  cachedSummary,
} from "../local/driveMark";

// Re-exporta para manter imports/testes antigos funcionando.
export {
  DRIVE_MARK_KEY,
  driveMarked,
  rememberDriveVault,
  clearDriveMark,
  cachedSummary,
};

/** "12,4 MB · 400 notas"; sem tamanho ainda, so a contagem. */
export function tamanho(resumo: VaultSummary | null): string {
  if (!resumo) return "sessão vencida";
  const notas =
    resumo.notes === 1 ? "1 nota" : `${resumo.notes.toLocaleString("pt-BR")} notas`;
  if (resumo.bytes <= 0) return notas;
  return `${formatBytes(resumo.bytes)} · ${notas}`;
}

/**
 * A linha de reconectar o Drive, acima da area das notas.
 *
 * O produto promete que, olhando as notas com o Drive conectado, elas estao no
 * Drive. A sessao do Google dura cerca de uma hora e morre no reload; quando
 * isso acontece, esta linha avisa na area principal — com o mesmo desenho do
 * `.cfg-item` das Configuracoes, sem card nem paragrafo — e reconecta dali.
 *
 * Com sessao viva ela nao aparece: nada de enfeite permanente. Durante o
 * trabalho ela continua ali, com o numero do cofre, e o `VaultBoot` conta a
 * etapa logo abaixo. Se falhar, a causa volta em uma linha, como no primeiro
 * acesso.
 */
export function DriveReconnect() {
  const [marked, setMarked] = useState(driveMarked);
  /**
   * Ha sessao do Google usavel agora. `connectDrive` avisa os ouvintes, entao
   * este estado acompanha tanto o login daqui quanto o que acontecer em outra
   * tela; o sucesso da abertura tambem fecha a linha na hora.
   */
  const [fresh, setFresh] = useState(() => driveSessionState() === "connected");
  const [summary, setSummary] = useState<VaultSummary | null>(cachedSummary);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<VaultStage>("conectando");
  const [progress, setProgress] = useState<StepProgress | undefined>();
  const [error, setError] = useState("");
  const alive = useRef(true);
  /**
   * O cofre continua trabalhando depois de o app aparecer (sync e capas). E o
   * mesmo sinal discreto, sem overlay: a linha ja esta a vista.
   */
  const atividade = useSyncExternalStore(
    subscribeVaultActivity,
    vaultActivity,
    vaultActivity,
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A sessao vive fora do React: ouvir mantem a linha em dia quando o token
  // vence no meio do uso.
  useEffect(
    () => onDriveSessionChange(() => setFresh(driveSessionState() === "connected")),
    [],
  );

  if (!marked || !driveConfigured()) return null;
  // Sessao viva e sync em dia nao precisam de linha. Erro e trabalho em curso
  // ainda precisam: sao o unico sinal depois que a tela ja abriu.
  if (!working && !error && !atividade.running && !atividade.error && fresh) return null;

  const reconectar = async () => {
    setError("");
    setWorking(true);
    setStage("conectando");
    setProgress(undefined);
    try {
      // Um unico caminho: login, abertura com uniao e marca do Drive. O login
      // pede o caminho rapido: metadado agora, sync e capas em segundo plano.
      const aberto = await connectAccount({
        attachments: "skip",
        sync: "background",
        onStage: (proxima) => {
          setStage(proxima);
          setProgress(undefined);
        },
        onProgress: (contagem) => setProgress(contagem),
      });
      setMarked(true);
      setSummary(aberto.summary);
      // O que ficou pendente local (nota criada antes da reconexao) sobe agora,
      // sem esperar os dois minutos do proximo silencio.
      await flushVaultSync();
      if (!alive.current) return;
      setFresh(true);
      setWorking(false);
    } catch (causa) {
      // O motivo tecnico fica no console; na tela vai a causa em uma linha.
      console.error("[drive] falha ao reconectar", causa);
      if (!alive.current) return;
      setError(describeDriveError(causa));
      setWorking(false);
    }
  };

  /** Segunda tentativa do trabalho que falhou depois da abertura. */
  const repetir = async () => {
    setError("");
    try {
      await flushVaultSync();
      clearVaultActivityError();
    } catch {
      // A linha continua com o motivo; o `folderSync` agenda a proxima.
    }
  };

  const causa = error || atividade.error;

  return (
    <section className="drive-reconnect" aria-label="Google Drive">
      <div className="cfg-item">
        <span className="cfg-mark" data-state="warn" aria-hidden="true" />
        <span className="cfg-grow">Google Drive</span>
        <span className="cfg-meta drive-reconnect-num">{tamanho(summary)}</span>
        {!working && (!fresh || causa) && (
          <button
            type="button"
            className="cfg-btn cfg-btn--quiet"
            onClick={() => void (fresh && causa ? repetir() : reconectar())}
          >
            {fresh && causa ? "tentar" : "conectar"}
          </button>
        )}
      </div>
      {working ? (
        <div className="drive-reconnect-boot">
          <VaultBoot stage={stage} progress={progress} />
        </div>
      ) : atividade.running ? (
        <div className="drive-reconnect-boot">
          {/* Sinal discreto: sem "Carregando…", sem cobrir a tela. */}
          <VaultBoot quiet stage={atividade.stage} progress={atividade.progress ?? undefined} />
        </div>
      ) : null}
      {!working && causa && (
        <p className="drive-reconnect-error" role="alert">
          {causa}
        </p>
      )}
    </section>
  );
}

export default DriveReconnect;

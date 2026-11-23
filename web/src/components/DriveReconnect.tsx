import { useEffect, useRef, useState } from "react";
// A linha e a mesma peca das Configuracoes; a folha vem junto para o desenho do
// `.cfg-item`/`.cfg-mark`/`.cfg-btn` nao depender de a tela de Configuracoes
// estar no bundle.
import "../views/settings.css";
import { describeDriveError } from "./FirstRun";
import { VaultBoot } from "./VaultBoot";
import { formatBytes } from "../lib/format";
import type { StepProgress } from "../local/backup";
import {
  connectDrive,
  driveConfigured,
  driveSessionState,
  driveVaultRoot,
  onDriveSessionChange,
} from "../local/driveSession";
import { openDriveVault, type VaultStage, type VaultSummary } from "../local/vaultCloud";
import { flushVaultSync } from "../local/folderSync";

/**
 * Marca local de que este navegador tem cofre no Drive. Nao e segredo: diz so
 * que o cofre mora no Drive, para a linha de reconectar saber que ha o que
 * reconectar quando a sessao do Google (que vive so na memoria) se perde.
 */
export const DRIVE_MARK_KEY = "dyarium.drive";

const DRIVE_SUMMARY_KEY = "dyarium.drive.summary";

export function driveMarked(): boolean {
  try {
    return localStorage.getItem(DRIVE_MARK_KEY) === "1";
  } catch {
    return false;
  }
}

/** O ultimo tamanho conhecido do cofre; serve ao numero da linha sem sessao. */
export function rememberDriveVault(summary?: VaultSummary): void {
  try {
    localStorage.setItem(DRIVE_MARK_KEY, "1");
    if (summary) localStorage.setItem(DRIVE_SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // Sem localStorage a linha nao aparece na proxima abertura; o cofre em si
    // continua no Drive e a sessao viva nao depende disto.
  }
}

function cachedSummary(): VaultSummary | null {
  try {
    const bruto = localStorage.getItem(DRIVE_SUMMARY_KEY);
    if (!bruto) return null;
    const guardado = JSON.parse(bruto) as VaultSummary;
    if (
      typeof guardado?.notes !== "number" ||
      typeof guardado?.bytes !== "number" ||
      !Number.isFinite(guardado.notes) ||
      !Number.isFinite(guardado.bytes)
    ) {
      return null;
    }
    return guardado;
  } catch {
    return null;
  }
}

/** "12,4 MB · 400 notas"; sem tamanho ainda, so a contagem. */
function tamanho(resumo: VaultSummary | null): string {
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
  // Sessao viva e sync em dia nao precisam de linha. Erro ainda precisa: e o
  // unico jeito de a pessoa saber o que consertar depois de tentar.
  if (!working && !error && fresh) return null;

  const reconectar = async () => {
    setError("");
    setWorking(true);
    setStage("conectando");
    setProgress(undefined);
    try {
      await connectDrive();
      // O login deu certo: este navegador agora tem cofre no Drive. A marca
      // vale mesmo que a abertura falhe; a linha volta para tentar de novo.
      rememberDriveVault();
      setMarked(true);
      const root = await driveVaultRoot();
      const aberto = await openDriveVault(root, {
        onStage: (proxima) => {
          setStage(proxima);
          setProgress(undefined);
        },
        onProgress: (contagem) => setProgress(contagem),
      });
      rememberDriveVault(aberto.summary);
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

  return (
    <section className="drive-reconnect" aria-label="Google Drive">
      <div className="cfg-item">
        <span className="cfg-mark" data-state="warn" aria-hidden="true" />
        <span className="cfg-grow">Google Drive</span>
        <span className="cfg-meta drive-reconnect-num">{tamanho(summary)}</span>
        {!working && (
          <button
            type="button"
            className="cfg-btn cfg-btn--quiet"
            onClick={() => void reconectar()}
          >
            conectar
          </button>
        )}
      </div>
      {working && (
        <div className="drive-reconnect-boot">
          <VaultBoot stage={stage} progress={progress} />
        </div>
      )}
      {!working && error && (
        <p className="drive-reconnect-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default DriveReconnect;

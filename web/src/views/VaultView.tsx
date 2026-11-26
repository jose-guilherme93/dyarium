import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import "./vault.css";
import "./settings.css";
import { describeDriveError } from "../components/FirstRun";
import { VaultBoot } from "../components/VaultBoot";
import { VaultBackup } from "../components/VaultBackup";
import { Icon } from "../ui";
import { formatBytes, formatRelativeTime } from "../lib/format";
import type { StepProgress } from "../local/backup";
import {
  driveConfigured,
  driveSessionState,
  onDriveSessionChange,
  driveProfile,
} from "../local/driveSession";
import { connectAccount } from "../local/accountConnect";
import { accountInitials } from "../components/AccountGate";
import { signOutAccount } from "../local/driveSession";
import { isVaultDirty } from "../local/folderSync";
import { syncVaultToDrive } from "../local/vaultCloud";
import type { VaultStage } from "../local/vaultCloud";
import { lastSyncSummary, flushVaultSync } from "../local/folderSync";
import {
  clearVaultActivityError,
  subscribeVaultActivity,
  vaultActivity,
} from "../local/vaultActivity";
import { rememberDriveVault, driveMarked } from "../local/driveMark";
import { rememberFolder } from "../local/folder";
import { vaultStats, type LocalVaultStats } from "../local/vaultStats";

export function VaultView({
  onBack,
  onScopeDenied,
  onConnected,
}: {
  onBack: () => void;
  onScopeDenied?: () => void;
  onConnected?: () => void;
}) {
  const [fresh, setFresh] = useState(() => driveSessionState() === "connected");
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<VaultStage>("conectando");
  const [progress, setProgress] = useState<StepProgress | undefined>();
  const [error, setError] = useState("");
  const alive = useRef(true);
  const atividade = useSyncExternalStore(
    subscribeVaultActivity,
    vaultActivity,
    vaultActivity,
  );
  const [stats, setStats] = useState<LocalVaultStats | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(() => driveProfile()?.email ?? null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const logoutCardRef = useRef<HTMLDivElement>(null);
  const logoutTriggerRef = useRef<HTMLButtonElement>(null);
  const [rememberedFolder, setRememberedFolder] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(
    () => onDriveSessionChange(() => {
      setFresh(driveSessionState() === "connected");
      const p = driveProfile();
      setProfileEmail(p?.email ?? null);
    }),
    [],
  );

  useEffect(() => {
    void vaultStats().then(setStats).catch(() => setStats(null));
    void rememberFolder()
      .then((folder) => setRememberedFolder(folder ? folder.name : null))
      .catch(() => setRememberedFolder(null));
  }, []);

  const configured = driveConfigured();

  const conectar = async () => {
    setError("");
    setWorking(true);
    setStage("conectando");
    setProgress(undefined);
    try {
      const aberto = await connectAccount({
        attachments: "skip",
        sync: "background",
        onStage: (proxima) => {
          setStage(proxima);
          setProgress(undefined);
        },
        onProgress: (contagem) => setProgress(contagem),
      });
      rememberDriveVault(aberto.summary);
      await flushVaultSync();
      clearVaultActivityError();
      onConnected?.();
      if (!alive.current) return;
      setFresh(true);
      setWorking(false);
      void vaultStats().then(setStats);
    } catch (causa) {
      console.error("[drive] falha ao conectar", causa);
      if (!alive.current) return;
      const texto = causa instanceof Error ? causa.message : "";
      if (/drive_nao_autorizado/i.test(texto)) {
        onScopeDenied?.();
      } else {
        setError(describeDriveError(causa));
      }
      setWorking(false);
    }
  };

  const sincronizar = async () => {
    setError("");
    setWorking(true);
    setStage("sincronizando");
    setProgress(undefined);
    try {
      await syncVaultToDrive();
      clearVaultActivityError();
      onConnected?.();
      if (!alive.current) return;
      void vaultStats().then(setStats);
      setWorking(false);
    } catch (causa) {
      console.error("[drive] falha ao sincronizar", causa);
      if (!alive.current) return;
      setError(describeDriveError(causa));
      setWorking(false);
    }
  };

  const repetir = async () => {
    setError("");
    try {
      await flushVaultSync();
      clearVaultActivityError();
    } catch {
      // A linha continua com o motivo; o folderSync agenda a proxima.
    }
  };


  const driveStateWord = !configured
    ? "sem Google"
    : working || atividade.running
      ? "sincronizando"
      : fresh
        ? "conectado"
        : "sessão vencida";

  const driveMarkState = !configured
    ? "off"
    : fresh
      ? "on"
      : "warn";

  useEffect(() => {
    if (!logoutConfirm) return;
    const card = logoutCardRef.current;
    const first = card?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLogoutConfirm(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      logoutTriggerRef.current?.focus();
    };
  }, [logoutConfirm]);

  const causa = error || atividade.error;

  const pastaLabel = driveMarked() ? "Dyarium/" : rememberedFolder ?? "—";

  const contaLabel = !configured
    ? null
    : fresh
      ? profileEmail ?? "—"
      : "—";

  const enviadoLabel = formatRelativeTime(lastSyncSummary()?.at) || "—";

  const audioLine = stats
    ? `${stats.audioNotes} ${stats.audioNotes === 1 ? "áudio" : "áudios"} · ${formatAudioDuration(stats.audioSeconds)}`
    : "—";

  return (
    <section className="vault-page">
      <div className="vault-column">
        <header className="vault-head">
          <button type="button" className="cfg-back" onClick={onBack} aria-label="Voltar">
            <Icon name="back" size={14} />
          </button>
          <h1 className="vault-title">Google Drive</h1>
          <span className="vault-state">
            <span className="cfg-mark" data-state={driveMarkState} aria-hidden="true" />
            <span className="vault-state-word">{driveStateWord}</span>
          </span>
        </header>

        <div className="vault-identity">
          <span className="vault-identity-avatar">{accountInitials(driveProfile()) || "—"}</span>
          <div className="vault-identity-text">
            <span className="vault-identity-name">{driveProfile()?.name ?? "Sem conta"}</span>
            <span className="vault-identity-mail">{profileEmail ?? "—"}</span>
          </div>
        </div>
        <div className="vault-numbers">
          <div className="vault-number">
            <span className="vault-number-value">{stats?.notes ?? 0}</span>
            <span className="vault-number-legend">Notas</span>
          </div>
          <div className="vault-number">
            <span className="vault-number-value">{stats?.attachments ?? 0}</span>
            <span className="vault-number-legend">Anexos</span>
          </div>
          <div className="vault-number">
            <span className="vault-number-value">{formatBytes(stats?.bytes ?? 0)}</span>
            <span className="vault-number-legend">Tamanho</span>
          </div>
        </div>

        <p className="vault-audio">{audioLine}</p>

        {(working || atividade.running) && (
          <div className="vault-progress">
            <VaultBoot
              stage={working ? stage : atividade.stage}
              progress={working ? progress : atividade.progress ?? undefined}
              quiet={!working || stage === "sincronizando"}
            />
          </div>
        )}

        {!working && causa && (
          <div className="vault-error-row">
            <p className="vault-error" role="alert">{causa}</p>
            {fresh && (
              <button type="button" className="cfg-btn cfg-btn--quiet" onClick={() => void repetir()}>
                tentar
              </button>
            )}
          </div>
        )}

        <div className="vault-block">
          <p className="vault-block-label">Cofre</p>
          {!configured && (
            <div className="vault-line">
              <span className="vault-line-label vault-line-muted">Google não configurado</span>
            </div>
          )}
          {configured && (
            <>
              <div className="vault-line">
                <span className="vault-line-label vault-line-muted">Conta</span>
                <span className="vault-line-value">{contaLabel}</span>
                {!fresh && (
                  <button type="button" className="cfg-btn cfg-btn--solid" onClick={() => void conectar()}>
                    entrar com Google
                  </button>
                )}
              </div>
              <div className="vault-line">
                <span className="vault-line-label vault-line-muted">Pasta</span>
                <span className="vault-line-value">{pastaLabel}</span>
              </div>
              <div className="vault-line">
                <span className="vault-line-label vault-line-muted">Enviado</span>
                <span className="vault-line-value">{enviadoLabel}</span>
                <button
                  type="button"
                  className="cfg-btn cfg-btn--quiet"
                  disabled={working || !fresh}
                  onClick={() => void sincronizar()}
                >
                  sincronizar
                </button>
              </div>
            </>
          )}
        </div>

        <div className="vault-block">
          <p className="vault-block-label">Backup</p>
          <VaultBackup />
        </div>

        {fresh && (
          <div className="vault-footer">
            <button ref={logoutTriggerRef} type="button" className="cfg-btn cfg-btn--quiet" onClick={() => setLogoutConfirm(true)}>
              Deslogar
            </button>
          </div>
        )}
        {logoutConfirm && (
          <div className="vault-logout-confirm" role="dialog" aria-modal="true">
            <div ref={logoutCardRef} className="vault-logout-card" tabIndex={-1}>
              <div className="vault-logout-id">
                <span className="vault-logout-name">{driveProfile()?.name ?? profileEmail ?? "—"}</span>
                <span className="vault-logout-mail">{profileEmail ?? "—"}</span>
              </div>
              {isVaultDirty() && (
                <p className="vault-logout-pending">
                  <Icon name="cloud-off" size={14} className="note-row-sync--off" /> sem envio
                </p>
              )}
              <div className="vault-logout-actions">
                <button type="button" className="cfg-btn cfg-btn--quiet" onClick={() => setLogoutConfirm(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="cfg-btn cfg-btn--solid"
                  onClick={() => {
                    setLogoutConfirm(false);
                    void signOutAccount().then(() => {
                      window.location.reload();
                    });
                  }}
                >
                  Deslogar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatAudioDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export default VaultView;

import { useEffect, useRef, useState } from "react";

import "../views/settings.css";
import {
  ensureVaultCode,
  setVaultCode as adoptVaultCode,
  vaultKeyFromCode,
} from "../local/vault";
import {
  applySnapshot,
  buildNotesSnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  vaultIdFromCode,
} from "../local/backup";
import { downloadBytes, packVault, unpackVault } from "../local/bundle";
import {
  pickFolder,
  readVaultFromFolder,
  rememberFolder,
  supportsFolder,
  writeVaultToFolder,
  type FolderLike,
} from "../local/folder";

export function VaultBackup() {
  const [vaultCode, setVaultCode] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  const [folder, setFolder] = useState<FolderLike | null>(null);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void ensureVaultCode()
      .then(setVaultCode)
      .catch(() => undefined);
    void rememberFolder()
      .then(setFolder)
      .catch(() => undefined);
  }, []);

  const codigoDoCofre = async (): Promise<string> => {
    const codigo = vaultCode || (await ensureVaultCode());
    if (!codigo || codigo !== vaultCode) setVaultCode(codigo);
    return codigo;
  };

  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const backupToFolder = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const codigo = await codigoDoCofre();
      const alvo = folder ?? (await pickFolder());
      setFolder(alvo);
      const chave = await vaultKeyFromCode(codigo);
      const vaultId = await vaultIdFromCode(codigo);
      const notas = await buildNotesSnapshot(vaultId);
      const estado = await buildSnapshot(vaultId);
      await writeVaultToFolder(
        alvo,
        codigo,
        await sealSnapshot(notas, chave),
        await sealSnapshot(estado, chave),
      );
      setBackupStatus(`pasta "${alvo.name}" · ${notas.notes.length} notas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromFolder = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const alvo = folder ?? (await pickFolder());
      setFolder(alvo);
      const { code, sealed, state } = await readVaultFromFolder(alvo);
      setVaultCode(await adoptVaultCode(code));
      const chave = await vaultKeyFromCode(code);
      const retrato = await openSnapshot(state ?? sealed, chave);
      const resumo = await applySnapshot(retrato);
      setBackupStatus(`${resumo.created} novas · ${resumo.updated} atualizadas · ${resumo.skipped} mantidas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadBackup = async () => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const codigo = await codigoDoCofre();
      const vaultId = await vaultIdFromCode(codigo);
      const chave = await vaultKeyFromCode(codigo);
      const notas = await buildNotesSnapshot(vaultId);
      const estado = await buildSnapshot(vaultId);
      downloadBytes(
        `dyarium-${vaultId}.zip`,
        packVault(codigo, await sealSnapshot(notas, chave), await sealSnapshot(estado, chave)),
      );
      setBackupStatus(`${notas.notes.length} notas · arquivo baixado`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromFile = async (file: File) => {
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const { code, sealed, state } = await unpackVault(new Uint8Array(await file.arrayBuffer()));
      setVaultCode(await adoptVaultCode(code));
      const chave = await vaultKeyFromCode(code);
      const retrato = await openSnapshot(state ?? sealed, chave);
      const resumo = await applySnapshot(retrato);
      setBackupStatus(`${resumo.created} novas · ${resumo.updated} atualizadas · ${resumo.skipped} mantidas`);
    } catch (error) {
      setBackupStatus(describe(error));
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <>
      <div className="cfg-item">
        <span className="cfg-mark" data-state={folder ? "on" : "off"} />
        <span className="cfg-grow">Pasta</span>
        <span className="cfg-meta">{folder ? folder.name : "não escolhida"}</span>
        <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !supportsFolder()} onClick={() => void backupToFolder()}>
          enviar
        </button>
        <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy || !supportsFolder()} onClick={() => void restoreFromFolder()}>
          restaurar
        </button>
      </div>
      <div className="cfg-item">
        <span className="cfg-mark" />
        <span className="cfg-grow">Arquivo .zip</span>
        <span className="cfg-meta">manual</span>
        <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy} onClick={() => void downloadBackup()}>
          baixar
        </button>
        <button type="button" className="cfg-btn cfg-btn--quiet" disabled={backupBusy} onClick={() => backupFileRef.current?.click()}>
          restaurar
        </button>
        <input
          ref={backupFileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void restoreFromFile(file);
          }}
        />
      </div>
      {backupStatus && <p className="cfg-meta" style={{ marginTop: 8 }}>{backupStatus}</p>}
    </>
  );
}

export default VaultBackup;

/**
 * Entrada unica na conta: login, abertura do cofre e marca do Drive.
 *
 * A abertura restaura o que esta no Drive sem passar por cima do local mais
 * novo e, em seguida, o sync sobe a uniao dos dois. Primeira tela, linha de
 * reconectar, menu da conta e Configuracoes chamam este mesmo caminho; nenhum
 * deles repete a ordem das operacoes.
 *
 * Mora fora do `vaultCloud` para o teste poder dublar `openDriveVault` e o
 * login separadamente, sem que a chamada interna ignore o duble.
 */

import { rememberDriveVault } from "./driveMark";
import { connectDrive, driveVaultRoot } from "./driveSession";
import { openDriveVault, type OpenDriveVaultResult, type VaultOptions } from "./vaultCloud";

export async function connectAccount(options: VaultOptions = {}): Promise<OpenDriveVaultResult> {
  await connectDrive();
  const root = await driveVaultRoot();
  // Caminho rapido por padrao: metadado e lista agora, sync e anexos depois.
  // Quem precisa do cofre inteiro (restauracao manual) passa `attachments` e
  // `sync` explicitos.
  const aberto = await openDriveVault(root, {
    attachments: "skip",
    sync: "background",
    ...options,
  });
  rememberDriveVault(aberto.summary);
  return aberto;
}

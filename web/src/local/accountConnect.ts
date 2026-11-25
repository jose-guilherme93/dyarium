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
  const aberto = await openDriveVault(root, options);
  rememberDriveVault(aberto.summary);
  return aberto;
}

/**
 * Portas de plataforma do nucleo.
 *
 * O repositorio (`./repo`) e puro, mas precisa de tres coisas que so o ambiente
 * sabe fazer: abrir o banco, abrir a conexao de leitura da interface e dizer
 * quem e este aparelho. Cada cliente liga as suas aqui na inicializacao — o app
 * ao expo-sqlite, o navegador ao wa-sqlite, o teste ao node:sqlite.
 *
 * Sem porta ligada, `getDb` falha alto: banco nao aberto nunca vira leitura
 * silenciosa de zero linhas.
 */

import type { SchemaDb } from './schema';

/** Banco com transacao, como o repositorio usa. */
export interface Database extends SchemaDb {
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  withExclusiveTransactionAsync(task: (txn: Database) => Promise<void>): Promise<void>;
}

/** Identidade do aparelho: id opaco e nome curto. */
export interface DeviceIdentity {
  id: string;
  name: string;
}

/** Marca uma atividade em andamento como interrompida, sem depender do servico. */
export type ActivityCancel = (key: string, reason: string) => void;

type Opener = () => Promise<Database>;
type IdentityReader = () => Promise<DeviceIdentity>;

let primary: Opener | null = null;
let reader: Opener | null = null;
let identity: IdentityReader | null = null;
let activityCancel: ActivityCancel = () => undefined;

/** Liga a conexao principal e, se houver, a conexao de leitura da interface. */
export function registerDatabase(open: Opener, openForUi?: Opener): void {
  primary = open;
  reader = openForUi ?? open;
}

/** Liga a leitura de identidade do aparelho. */
export function registerDeviceIdentity(read: IdentityReader): void {
  identity = read;
}

function opener(slot: Opener | null, what: string): Opener {
  if (!slot) throw new Error(`nucleo sem ${what}: registerDatabase nao foi chamado`);
  return slot;
}

/** Conexao principal. Abre sob demanda, como o driver de cada plataforma quer. */
export async function getDb(): Promise<Database> {
  return opener(primary, 'banco')();
}

/** Conexao dedicada a leitura de interface (nao espera o lock da escrita). */
export async function getDbForUI(): Promise<Database> {
  return opener(reader, 'banco de leitura')();
}

/** Identidade deste aparelho, para carimbar versoes e origem. */
export async function currentDeviceIdentity(): Promise<DeviceIdentity> {
  if (!identity) throw new Error('nucleo sem identidade: registerDeviceIdentity nao foi chamado');
  return identity();
}

/** Liga o cancelamento de atividade (o servico de atividade fica no app). */
export function registerActivityCancel(fn: ActivityCancel): void {
  activityCancel = fn;
}

/** Interrompe uma atividade em andamento. Sem ligacao, nao faz nada. */
export function cancelActivity(key: string, reason: string): void {
  activityCancel(key, reason);
}

/**
 * Cofre: a chave que cifra o backup e o codigo de recuperacao que a reconstroi.
 *
 * O codigo nao e senha: e a propria semente, escrita em 26 caracteres base32
 * (Crockford, sem I, L, O e U). 24 caracteres carregam 120 bits e 2 sao
 * checksum, entao um erro de digitacao e recusado antes de tentar decifrar
 * qualquer coisa. Nao existe KDF de senha aqui de proposito: a semente ja e
 * aleatoria, e passar uma senha por Argon2 so acrescentaria cerimonia.
 *
 * A chave fica derivada (HKDF) e nao exportavel. O que o navegador guarda e o
 * codigo, porque ele precisa ser mostrado de novo na tela de conta.
 */

import { storeGet, storeSet } from "../lib/idb";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DATA_CHARS = 24;
const CHECK_CHARS = 2;
const CODE_CHARS = DATA_CHARS + CHECK_CHARS;
const SALT = "dyarium.vault.v1";
const INFO = "aes-256-gcm";

const VAULT_STORE = "vault";
const VAULT_KEY = "codigo";

/** Bits aleatorios que viram codigo: 120 bits em 24 caracteres. */
const DATA_BYTES = 15;

const encoder = new TextEncoder();

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Uint8Array<ArrayBuffer> | null {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** Remove separadores e troca os caracteres ambiguos que o Crockford aceita. */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

async function checksum(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const bits = ((digest[0] << 8) | digest[1]) & 0x3ff;
  return ALPHABET[bits >> 5] + ALPHABET[bits & 31];
}

/** Gera um codigo novo. Nao grava nada; quem chama decide onde guardar. */
export async function newRecoveryCode(): Promise<string> {
  const data = crypto.getRandomValues(new Uint8Array(DATA_BYTES));
  const body = base32Encode(data).slice(0, DATA_CHARS);
  return body + (await checksum(data));
}

/** Forma de leitura: grupos de 4 separados por hifen. */
export function formatRecoveryCode(code: string): string {
  const limpo = normalizeRecoveryCode(code);
  return (limpo.match(/.{1,4}/g) ?? []).join("-");
}

/** Valida tamanho, alfabeto e checksum, na ordem em que o usuario erra. */
export async function isValidRecoveryCode(code: string): Promise<boolean> {
  const limpo = normalizeRecoveryCode(code);
  if (limpo.length !== CODE_CHARS) return false;
  const data = base32Decode(limpo.slice(0, DATA_CHARS));
  if (!data || data.length !== DATA_BYTES) return false;
  return limpo.slice(DATA_CHARS) === (await checksum(data));
}

/** Deriva a chave AES-GCM do cofre a partir do codigo. */
export async function vaultKeyFromCode(code: string): Promise<CryptoKey> {
  const limpo = normalizeRecoveryCode(code);
  if (!(await isValidRecoveryCode(limpo))) {
    throw new Error("codigo de recuperacao invalido");
  }
  const data = base32Decode(limpo.slice(0, DATA_CHARS));
  if (!data) throw new Error("codigo de recuperacao invalido");
  const material = await crypto.subtle.importKey("raw", data, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(SALT), info: encoder.encode(INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Codigo deste cofre: le o guardado ou cria e guarda no IndexedDB.
 *
 * Guardar o codigo no mesmo navegador e coerente com o desenho: o banco local
 * ja e legivel por quem tem a maquina. O codigo existe para levar a chave a
 * outro aparelho, nao para esconder o diario de quem esta neste.
 */
export async function ensureVaultCode(): Promise<string> {
  const guardado = await storeGet<string>(VAULT_STORE, VAULT_KEY);
  if (guardado && (await isValidRecoveryCode(guardado))) return normalizeRecoveryCode(guardado);
  const novo = await newRecoveryCode();
  await storeSet(VAULT_STORE, VAULT_KEY, novo);
  return novo;
}

/**
 * Adota um codigo que veio de fora (login no Drive de outro aparelho).
 *
 * E o caminho do "login desbloqueia o cofre": a chave guardada na pasta do
 * usuario substitui a que este navegador criou ao abrir.
 */
export async function setVaultCode(code: string): Promise<string> {
  const limpo = normalizeRecoveryCode(code);
  if (!(await isValidRecoveryCode(limpo))) throw new Error("codigo de recuperacao invalido");
  await storeSet(VAULT_STORE, VAULT_KEY, limpo);
  return limpo;
}

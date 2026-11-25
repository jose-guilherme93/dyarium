/**
 * Cofre: o codigo de recuperacao e a chave que cifra os arquivos.
 *
 * O formato e o mesmo do web (`web/src/local/vault.ts`): 24 caracteres de
 * dados em base32 Crockford (120 bits) e 2 de checksum, uma chave AES-256
 * derivada por HKDF-SHA256 com salt/info fixos e envelopes `iv||ciphertext`
 * (AES-256-GCM). O app nao tem WebCrypto, entao a criptografia vem de
 * `@noble/hashes` e `@noble/ciphers`; o teste de interoperabilidade prova que
 * os dois lados produzem os mesmos bytes.
 *
 * Puro de proposito: nada de expo, arquivo ou rede. O gerador aleatorio entra
 * por parametro e o servico passa o `expo-crypto`.
 */

import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DATA_CHARS = 24;
const CHECK_CHARS = 2;
const CODE_CHARS = DATA_CHARS + CHECK_CHARS;
const DATA_BYTES = 15;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT = 'dyarium.vault.v1';
const INFO = 'aes-256-gcm';

const encoder = new TextEncoder();

export type RandomBytes = (length: number) => Uint8Array;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
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

function base32Decode(text: string): Uint8Array | null {
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
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

function checksum(data: Uint8Array): string {
  const digest = sha256(data);
  const bits = ((digest[0] << 8) | digest[1]) & 0x3ff;
  return ALPHABET[bits >> 5] + ALPHABET[bits & 31];
}

function codeData(code: string): Uint8Array {
  const clean = normalizeRecoveryCode(code);
  if (clean.length !== CODE_CHARS) throw new VaultError('codigo de recuperacao invalido');
  const data = base32Decode(clean.slice(0, DATA_CHARS));
  if (!data || data.length !== DATA_BYTES) {
    throw new VaultError('codigo de recuperacao invalido');
  }
  if (clean.slice(DATA_CHARS) !== checksum(data)) {
    throw new VaultError('codigo de recuperacao invalido');
  }
  return data;
}

/** Gera um codigo novo. Nao grava nada; quem chama decide onde guardar. */
export function newRecoveryCode(random: RandomBytes): string {
  const data = random(DATA_BYTES);
  if (data.length !== DATA_BYTES) throw new VaultError('gerador aleatorio invalido');
  return base32Encode(data).slice(0, DATA_CHARS) + checksum(data);
}

/** Forma de leitura: grupos de 4 separados por hifen. */
export function formatRecoveryCode(code: string): string {
  const clean = normalizeRecoveryCode(code);
  return (clean.match(/.{1,4}/g) ?? []).join('-');
}

/** Valida tamanho, alfabeto e checksum, na ordem em que o usuario erra. */
export function isValidRecoveryCode(code: string): boolean {
  try {
    codeData(code);
    return true;
  } catch {
    return false;
  }
}

/** Deriva a chave AES-GCM do cofre a partir do codigo. */
export function deriveVaultKey(code: string): Uint8Array {
  const data = codeData(code);
  return hkdf(sha256, data, encoder.encode(SALT), encoder.encode(INFO), KEY_BYTES);
}

/** Nome opaco e estavel da pasta no Drive, derivado do codigo. */
export function vaultIdFromCode(code: string): string {
  const digest = sha256(encoder.encode(`dyarium.vault.id:${normalizeRecoveryCode(code)}`));
  return [...digest.slice(0, 5)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Envelope `iv || ciphertext` com IV aleatorio novo; nonce nunca se repete. */
export function sealBytes(plain: Uint8Array, key: Uint8Array, random: RandomBytes): Uint8Array {
  if (key.length !== KEY_BYTES) throw new VaultError('chave do cofre invalida');
  const iv = random(IV_BYTES);
  if (iv.length !== IV_BYTES) throw new VaultError('gerador aleatorio invalido');
  const cipher = gcm(key, iv).encrypt(plain);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return out;
}

/** Abre um envelope do cofre. Qualquer divergencia vira erro generico. */
export function openBytes(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new VaultError('chave do cofre invalida');
  if (sealed.length <= IV_BYTES) throw new VaultError('arquivo do cofre vazio ou truncado');
  try {
    return gcm(key, sealed.slice(0, IV_BYTES)).decrypt(sealed.slice(IV_BYTES));
  } catch {
    throw new VaultError('nao foi possivel abrir o arquivo do cofre');
  }
}

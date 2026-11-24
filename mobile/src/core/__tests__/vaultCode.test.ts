/**
 * O `crypto` do Node 24 ja e o WebCrypto; usar o global evita depender dos
 * tipos de Node no tsconfig do app.
 */
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

import {
  deriveVaultKey,
  formatRecoveryCode,
  isValidRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  openBytes,
  sealBytes,
  vaultIdFromCode,
} from '../vaultCode';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Codigo fixo: 15 bytes 0..14, com o checksum calculado pela propria lib. */
const FIXED_RANDOM = Uint8Array.from({ length: 15 }, (_, index) => index + 1);

function deterministicCode(): string {
  return newRecoveryCode(() => FIXED_RANDOM);
}

/** Referencia: mesma derivacao feita pelo WebCrypto, como o web faz. */
async function webKey(code: string): Promise<CryptoKey> {
  const material = await webcrypto.subtle.importKey(
    'raw',
    decodeData(code) as unknown as BufferSource,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return webcrypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('dyarium.vault.v1'),
      info: encoder.encode('aes-256-gcm'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function webDeriveBits(code: string): Promise<Uint8Array> {
  const material = await webcrypto.subtle.importKey(
    'raw',
    decodeData(code) as unknown as BufferSource,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('dyarium.vault.v1'),
      info: encoder.encode('aes-256-gcm'),
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function decodeData(code: string): Uint8Array {
  // A propria lib valida; aqui so precisamos dos 24 caracteres de dados.
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalizeRecoveryCode(code).slice(0, 24)) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('codigo invalido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

describe('codigo do cofre', () => {
  it('gera 26 caracteres e aceita o proprio checksum', () => {
    const code = deterministicCode();
    expect(code).toHaveLength(26);
    expect(isValidRecoveryCode(code)).toBe(true);
  });

  it('recusa um caractere trocado e um tamanho errado', () => {
    const code = deterministicCode();
    const changed = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    expect(isValidRecoveryCode(changed)).toBe(false);
    expect(isValidRecoveryCode(code.slice(0, 25))).toBe(false);
    expect(isValidRecoveryCode('I'.repeat(26))).toBe(false);
  });

  it('normaliza separadores e letras ambiguas', () => {
    const code = deterministicCode();
    const messy = formatRecoveryCode(code).toLowerCase().replace(/0/g, 'o');
    expect(normalizeRecoveryCode(messy)).toBe(code);
    expect(isValidRecoveryCode(messy)).toBe(true);
  });

  it('deriva exatamente a mesma chave do WebCrypto', async () => {
    const code = deterministicCode();
    const ours = deriveVaultKey(code);
    const reference = await webDeriveBits(code);
    expect(hex(ours)).toBe(hex(reference));
  });

  it('abre o que o WebCrypto selou e o WebCrypto abre o que selamos', async () => {
    const code = deterministicCode();
    const key = deriveVaultKey(code);
    const text = 'nota de teste com acento: coração';

    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const reference = new Uint8Array(
      await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, await webKey(code), encoder.encode(text)),
    );
    const sealedByWeb = new Uint8Array(iv.length + reference.length);
    sealedByWeb.set(iv);
    sealedByWeb.set(reference, iv.length);
    expect(decoder.decode(openBytes(sealedByWeb, key))).toBe(text);

    const sealedByApp = sealBytes(encoder.encode(text), key, () => new Uint8Array(12).fill(9));
    const opened = new Uint8Array(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealedByApp.slice(0, 12) },
        await webKey(code),
        sealedByApp.slice(12),
      ),
    );
    expect(decoder.decode(opened)).toBe(text);
  });

  it('recusa ciphertext adulterado, truncado e chave errada', () => {
    const key = deriveVaultKey(deterministicCode());
    const sealed = sealBytes(encoder.encode('conteudo'), key, () => new Uint8Array(12).fill(3));

    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => openBytes(tampered, key)).toThrow();
    expect(() => openBytes(sealed.slice(0, 12), key)).toThrow();
    expect(() => openBytes(sealed, deriveVaultKey(newRecoveryCode(() => new Uint8Array(15).fill(8))))).toThrow();
  });

  it('nunca reutiliza o IV quando o gerador e aleatorio', () => {
    const key = deriveVaultKey(deterministicCode());
    let calls = 0;
    const random = (size: number): Uint8Array => {
      calls += 1;
      return new Uint8Array(size).fill(calls);
    };
    const first = sealBytes(encoder.encode('a'), key, random);
    const second = sealBytes(encoder.encode('a'), key, random);
    expect(calls).toBe(2);
    expect(hex(first.slice(0, 12))).not.toBe(hex(second.slice(0, 12)));
  });

  it('o vault id muda com o codigo e nao expoe a chave', () => {
    const a = vaultIdFromCode(deterministicCode());
    const b = vaultIdFromCode(newRecoveryCode(() => new Uint8Array(15).fill(7)));
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(deterministicCode().slice(0, 4));
  });
});

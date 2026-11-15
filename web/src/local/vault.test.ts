import { describe, expect, it } from "vitest";

import {
  formatRecoveryCode,
  isValidRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  setVaultCode,
  vaultKeyFromCode,
} from "./vault";

const encoder = new TextEncoder();

async function roundTrip(code: string, texto: string): Promise<string> {
  const chave = await vaultKeyFromCode(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, encoder.encode(texto));
  const aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, chave, cifrado);
  return new TextDecoder().decode(aberto);
}

describe("codigo de recuperacao", () => {
  it("nasce valido e com 26 caracteres", async () => {
    const codigo = await newRecoveryCode();
    expect(codigo).toHaveLength(26);
    expect(await isValidRecoveryCode(codigo)).toBe(true);
  });

  it("dois codigos nunca sao iguais", async () => {
    const a = await newRecoveryCode();
    const b = await newRecoveryCode();
    expect(a).not.toBe(b);
  });

  it("recusa um caractere trocado (checksum pega o erro)", async () => {
    const codigo = await newRecoveryCode();
    const trocado = (codigo[0] === "A" ? "B" : "A") + codigo.slice(1);
    expect(await isValidRecoveryCode(trocado)).toBe(false);
  });

  it("recusa tamanho errado e letra fora do alfabeto", async () => {
    expect(await isValidRecoveryCode("ABC")).toBe(false);
    expect(await isValidRecoveryCode("I".repeat(26))).toBe(false);
  });

  it("aceita o codigo escrito com hifen, minusculo e O por zero", async () => {
    const codigo = await newRecoveryCode();
    const messy = formatRecoveryCode(codigo).toLowerCase().replace(/0/g, "o");
    expect(normalizeRecoveryCode(messy)).toBe(codigo);
    expect(await isValidRecoveryCode(messy)).toBe(true);
  });

  it("a mesma frase gera sempre a mesma chave", async () => {
    const codigo = await newRecoveryCode();
    expect(await roundTrip(codigo, "texto do diario")).toBe("texto do diario");
    expect(await roundTrip(codigo, "outro texto")).toBe("outro texto");
  });

  it("codigo diferente nao abre o que o outro cifrou", async () => {
    const a = await newRecoveryCode();
    const b = await newRecoveryCode();
    const chaveA = await vaultKeyFromCode(a);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chaveA, encoder.encode("segredo"));
    const chaveB = await vaultKeyFromCode(b);
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, chaveB, cifrado)).rejects.toThrow();
  });

  it("recusa adotar um codigo invalido", async () => {
    await expect(setVaultCode("nada")).rejects.toThrow(/invalido/);
  });

  it("nao deriva chave de codigo invalido", async () => {
    await expect(vaultKeyFromCode("AAAA")).rejects.toThrow(/invalido/);
  });
});

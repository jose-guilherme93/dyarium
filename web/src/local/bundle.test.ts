import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { packVault, unpackVault } from "./bundle";
import { newRecoveryCode } from "./vault";

describe("backup num arquivo unico", () => {
  it("empacota e desempacota o codigo e o envelope", async () => {
    const code = await newRecoveryCode();
    const sealed = new Uint8Array([4, 5, 6, 7]);
    const pacote = packVault(code, sealed);
    expect(pacote.length).toBeGreaterThan(sealed.length);

    const aberto = await unpackVault(pacote);
    expect(aberto.code).toBe(code);
    expect(Array.from(aberto.sealed)).toEqual([4, 5, 6, 7]);
    expect(aberto.state).toBeUndefined();
  });

  it("zip com state.enc devolve o estado ao lado do v1", async () => {
    const code = await newRecoveryCode();
    const pacote = packVault(code, new Uint8Array([1, 2]), new Uint8Array([7, 8, 9]));

    const aberto = await unpackVault(pacote);
    expect(aberto.code).toBe(code);
    expect(Array.from(aberto.sealed)).toEqual([1, 2]);
    expect(Array.from(aberto.state ?? [])).toEqual([7, 8, 9]);
  });

  it("zip antigo sem state.enc continua abrindo", async () => {
    const code = await newRecoveryCode();
    const antigo = zipSync({
      "key.txt": strToU8(code),
      "backup.enc": new Uint8Array([3, 4]),
    });

    const aberto = await unpackVault(antigo);
    expect(aberto.code).toBe(code);
    expect(Array.from(aberto.sealed)).toEqual([3, 4]);
    expect(aberto.state).toBeUndefined();
  });

  it("recusa arquivo que nao e zip", async () => {
    await expect(unpackVault(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/invalido/);
  });

  it("recusa pacote sem os dois arquivos", async () => {
    const soChave = zipSync({ "key.txt": strToU8(await newRecoveryCode()) });
    await expect(unpackVault(soChave)).rejects.toThrow(/incompleto/);
  });

  it("recusa pacote com codigo invalido", async () => {
    const pacote = zipSync({ "key.txt": strToU8("nao-e-codigo"), "backup.enc": new Uint8Array([1]) });
    await expect(unpackVault(pacote)).rejects.toThrow(/invalido/);
  });
});

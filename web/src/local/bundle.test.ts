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

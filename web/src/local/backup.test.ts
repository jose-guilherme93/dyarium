import { beforeEach, describe, expect, it } from "vitest";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import {
  applySnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  snapshotNotes,
  vaultIdFromCode,
} from "./backup";
import * as local from "./notes";
import { newRecoveryCode, vaultKeyFromCode } from "./vault";

beforeEach(async () => {
  await registerNodeDatabase();
});

describe("backup do cofre", () => {
  it("o id do cofre vem do codigo e nao revela a chave", async () => {
    const codigo = await newRecoveryCode();
    const id = await vaultIdFromCode(codigo);
    expect(id).toMatch(/^[0-9a-f]{10}$/);
    expect(id).not.toContain(codigo.slice(0, 4));
    expect(await vaultIdFromCode(codigo)).toBe(id);
    expect(await vaultIdFromCode(await newRecoveryCode())).not.toBe(id);
  });

  it("o retrato leva titulo, data, caderno, tag e corpo", async () => {
    const nota = await local.createEntry({ title: "Da serra" });
    await local.saveNote(nota.id, "primeira linha");
    await local.setEntryTags(nota.id, ["viagem"]);

    const retrato = await buildSnapshot("abc123");
    expect(retrato.version).toBe(1);
    expect(retrato.vaultId).toBe("abc123");
    expect(retrato.notes).toHaveLength(1);
    expect(retrato.notes[0]).toMatchObject({
      id: nota.id,
      title: "Da serra",
      tags: ["viagem"],
      text: "primeira linha",
    });
  });

  it("cifra e abre com a mesma chave", async () => {
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);
    const retrato = {
      version: 1 as const,
      vaultId: "abc123",
      createdAt: "2026-11-15T10:00:00Z",
      notes: snapshotNotes(await local.listEntries().then(() => [])),
    };
    const selado = await sealSnapshot(retrato, chave);
    expect(new TextDecoder().decode(selado)).not.toContain("abc123");
    expect(await openSnapshot(selado, await vaultKeyFromCode(codigo))).toEqual(retrato);
  });

  it("chave errada nao abre o backup", async () => {
    const chave = await vaultKeyFromCode(await newRecoveryCode());
    const selado = await sealSnapshot(
      { version: 1, vaultId: "v", createdAt: "x", notes: [] },
      chave,
    );
    const outra = await vaultKeyFromCode(await newRecoveryCode());
    await expect(openSnapshot(selado, outra)).rejects.toThrow();
  });

  it("restaura as notas do retrato no cofre vazio", async () => {
    const resultado = await applySnapshot({
      version: 1,
      vaultId: "v",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [
        {
          id: "n1",
          title: "Voltou",
          recordedAt: "2026-01-02T10:00:00Z",
          updatedAt: "2026-01-02T10:00:00Z",
          tags: ["volta"],
          text: "corpo restaurado",
        },
      ],
    });

    expect(resultado).toEqual({ created: 1, updated: 0, skipped: 0 });
    const nota = await local.getEntry("n1");
    expect(nota?.title).toBe("Voltou");
    expect((await local.listNotes("n1"))[0].content_markdown).toBe("corpo restaurado");
  });

  it("retrato mais antigo nao passa por cima da nota local mais nova", async () => {
    const nota = await local.createEntry({ title: "Local, mais nova" });
    await local.saveNote(nota.id, "texto daqui");

    const resultado = await applySnapshot({
      version: 1,
      vaultId: "v",
      createdAt: "2025-01-01T00:00:00Z",
      notes: [
        {
          id: nota.id,
          title: "Antiga",
          recordedAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          text: "texto velho",
        },
      ],
    });

    expect(resultado).toMatchObject({ updated: 0, skipped: 1 });
    expect((await local.getEntry(nota.id))?.title).toBe("Local, mais nova");
  });

  it("backup truncado falha com mensagem clara", async () => {
    const chave = await vaultKeyFromCode(await newRecoveryCode());
    await expect(openSnapshot(new Uint8Array(4), chave)).rejects.toThrow(/truncado/);
  });
});

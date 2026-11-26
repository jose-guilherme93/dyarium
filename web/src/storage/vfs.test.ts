import { describe, expect, it, vi } from "vitest";

import { comReserva, SQLITE_IDB_NAME } from "./vfs";

describe("escolha do VFS do SQLite", () => {
  it("nao compartilha o IndexedDB com o cache do app", () => {
    // O cache usa `dyarium`; dividir faz o open falhar com VersionError.
    expect(SQLITE_IDB_NAME).not.toBe("dyarium");
  });

  it("usa a via principal quando ela abre", async () => {
    const principal = vi.fn(async () => "opfs");
    const reserva = vi.fn(async () => "idb");

    await expect(comReserva(principal, reserva)).resolves.toBe("opfs");
    expect(reserva).not.toHaveBeenCalled();
  });

  it("cai na reserva quando a via principal falha na abertura", async () => {
    const principal = vi.fn(async () => {
      throw new Error("sqlite3_open_v2");
    });
    const reserva = vi.fn(async () => "idb");

    await expect(comReserva(principal, reserva)).resolves.toBe("idb");
  });

  it("propaga o erro da reserva quando as duas falham", async () => {
    await expect(
      comReserva(
        async () => {
          throw new Error("opfs");
        },
        async () => {
          throw new Error("idb");
        },
      ),
    ).rejects.toThrow("idb");
  });
});

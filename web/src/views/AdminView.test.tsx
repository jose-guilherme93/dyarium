import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AdminView } from "./AdminView";

const STATS = {
  generated_at: "2026-11-25T15:00:00.000Z",
  days: [
    { day: "2026-11-24", active: 5, logins: 3, new_accounts: 1 },
    { day: "2026-11-25", active: 12, logins: 9, new_accounts: 2 },
  ],
  today: { active: 12, logins: 9, new_accounts: 2 },
  totals: { accounts: 31, installs: 42, vaults: 25, notes: 12345, bytes: 987654321 },
  accounts: [
    {
      email: "a@b.com",
      first_day: "2026-11-01",
      last_day: "2026-11-25",
      installs: 2,
      notes: 400,
      bytes: 13000000,
      version: "0.2.0",
      platform: "web",
    },
  ],
  versions: [{ version: "0.2.0", installs: 30 }],
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(String(url), init);
    return {
      ok: (result as { ok?: boolean }).ok ?? true,
      status: (result as { status?: number }).status ?? 200,
      statusText: (result as { statusText?: string }).statusText ?? "",
      json: async () => (result as { body?: unknown }).body ?? result,
      text: async () => JSON.stringify((result as { body?: unknown }).body ?? result),
    };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminView", () => {
  it("sem chave mostra o portao e nao chama fetch", async () => {
    const spy = mockFetch(() => ({ ok: true, status: 200, body: STATS }));
    render(<AdminView />);
    expect(screen.getByLabelText("Chave")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    // aguarda um tick para garantir que nao houve fetch
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });

  it("com chave em sessionStorage carrega stats e renderiza numeros, tabela e versoes", async () => {
    sessionStorage.setItem("dyarium.admin", "segredo");
    mockFetch((url, init) => {
      expect(url).toContain("/admin-api/stats");
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer segredo");
      return { ok: true, status: 200, body: STATS };
    });
    render(<AdminView />);
    await waitFor(() => expect(screen.getByText("31")).toBeInTheDocument());
    // hoje numeros
    expect(screen.getByText("12")).toBeInTheDocument();
    // tabela
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    // versao
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    // datas e tamanho formatados
    expect(screen.getByText("01/11/26")).toBeInTheDocument();
    expect(screen.getByText("25/11/26")).toBeInTheDocument();
    expect(screen.getByText("12 MB")).toBeInTheDocument();
  });

  it("401 limpa a chave e volta ao portao com Chave invalida.", async () => {
    sessionStorage.setItem("dyarium.admin", "errada");
    mockFetch(() => ({ ok: false, status: 401, body: { error: "unauthorized" } }));
    render(<AdminView />);
    await waitFor(() => expect(screen.getByText("Chave invalida.")).toBeInTheDocument());
    expect(sessionStorage.getItem("dyarium.admin")).toBeNull();
    expect(screen.getByLabelText("Chave")).toBeInTheDocument();
  });

  it("remover com confirm true faz DELETE urlencoded e tira a linha", async () => {
    sessionStorage.setItem("dyarium.admin", "segredo");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let removido = false;
    mockFetch((url, init) => {
      if (String(url).includes("/admin-api/account")) {
        expect(init?.method).toBe("DELETE");
        expect(String(url)).toContain("email=a%40b.com");
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer segredo");
        removido = true;
        return { ok: true, status: 200, body: { removed: true } };
      }
      // O painel recarrega depois de remover: o servidor ja nao devolve a conta.
      return {
        ok: true,
        status: 200,
        body: removido
          ? { ...STATS, accounts: [], totals: { ...STATS.totals, accounts: 30 } }
          : STATS,
      };
    });
    render(<AdminView />);
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "remover" }));
    await waitFor(() => expect(screen.queryByText("a@b.com")).not.toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it("vazio mostra Sem dados ainda.", async () => {
    sessionStorage.setItem("dyarium.admin", "segredo");
    const empty = {
      ...STATS,
      today: { active: 0, logins: 0, new_accounts: 0 },
      totals: { accounts: 0, installs: 0, vaults: 0, notes: 0, bytes: 0 },
      accounts: [],
      versions: [],
      days: STATS.days.map((d) => ({ ...d, active: 0, logins: 0, new_accounts: 0 })),
    };
    mockFetch(() => ({ ok: true, status: 200, body: empty }));
    render(<AdminView />);
    await waitFor(() => expect(screen.getByText("Sem dados ainda.")).toBeInTheDocument());
  });
});

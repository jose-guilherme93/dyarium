import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../local/folderSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/folderSync")>();
  return { ...actual, flushVaultSync: vi.fn(async () => null), lastSyncSummary: vi.fn(() => null) };
});

vi.mock("../local/driveSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/driveSession")>();
  return {
    ...actual,
    connectDrive: vi.fn(async () => undefined),
    signOutAccount: vi.fn(),
    driveSessionState: vi.fn(() => "connected" as const),
  };
});

vi.mock("./DriveReconnect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./DriveReconnect")>();
  return {
    ...actual,
    cachedSummary: vi.fn(() => ({ notes: 400, attachments: 1, bytes: 13_000_000 })),
  };
});

import { AccountSheet } from "./AccountSheet";
import { connectDrive, driveSessionState, signOutAccount } from "../local/driveSession";
import { flushVaultSync, lastSyncSummary } from "../local/folderSync";

const PERFIL = { name: "Ada Lovelace", email: "ada@example.com", picture: "" };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(driveSessionState).mockReturnValue("connected");
  vi.mocked(lastSyncSummary).mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

function menu(extra: Partial<Parameters<typeof AccountSheet>[0]> = {}) {
  return render(<AccountSheet open onClose={() => undefined} profile={PERFIL} {...extra} />);
}

describe("AccountSheet (menu da conta)", () => {
  it("abre no gatilho, encostado no trilho e sem cobrir ele", () => {
    const gatilho = document.createElement("button");
    document.body.appendChild(gatilho);
    menu({ anchor: gatilho });
    const caixa = screen.getByRole("menu", { name: "Conta Google" });
    expect(caixa).toHaveStyle({ left: "34px", width: "238px" });
    expect(caixa).toHaveClass("account-menu");
    // O gatilho continua na tela: o menu abre acima dele, nao por cima.
    expect(gatilho.isConnected).toBe(true);
    gatilho.remove();
  });

  it("mostra nome, e-mail, Drive e o ultimo envio em tempo relativo", () => {
    vi.mocked(lastSyncSummary).mockReturnValue({
      written: 1,
      deleted: 0,
      unchanged: 0,
      at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    });
    menu({ profile: { ...PERFIL, picture: "https://exemplo/foto.png" } });
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText(/12 MB · 400 notas/)).toBeInTheDocument();
    expect(screen.getByText("há 4 min")).toBeInTheDocument();
    const foto = document.querySelector(".account-menu-photo") as HTMLImageElement;
    expect(foto.tagName).toBe("IMG");
    expect(foto.getAttribute("src")).toBe("https://exemplo/foto.png");
  });

  it("sem foto cai nas iniciais", () => {
    menu();
    expect(document.querySelector(".account-menu-photo--initials")?.textContent).toBe("AL");
  });

  it("conectado oferece Sincronizar e Sair", () => {
    menu();
    expect(document.querySelector(".account-state-mark--connected")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: /Sincronizar/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Sair$/ })).toBeInTheDocument();
  });

  it("sessao vencida troca Sincronizar por Conectar", async () => {
    vi.mocked(driveSessionState).mockReturnValue("expired");
    const onClose = vi.fn();
    menu({ onClose });
    fireEvent.click(screen.getByRole("menuitem", { name: /Conectar/ }));
    await waitFor(() => expect(connectDrive).toHaveBeenCalledTimes(1));
    expect(flushVaultSync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("sem conta mostra Sem conta, — notas e Conectar Google, sem Sair", () => {
    vi.mocked(driveSessionState).mockReturnValue("off");
    menu({ profile: null });
    expect(screen.getByText("Sem conta")).toBeInTheDocument();
    expect(screen.getByText("— notas")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Conectar Google/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Sair$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("foto e nome no Google")).not.toBeInTheDocument();
  });

  it("sincronizar grava o cofre, avisa a tela e fecha", async () => {
    const onSync = vi.fn();
    const onClose = vi.fn();
    menu({ onSync, onClose });
    fireEvent.click(screen.getByRole("menuitem", { name: /Sincronizar/ }));
    await waitFor(() => expect(flushVaultSync).toHaveBeenCalledTimes(1));
    expect(connectDrive).not.toHaveBeenCalled();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("sair encerra a conta e fecha", () => {
    const onClose = vi.fn();
    menu({ onClose });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Sair$/ }));
    expect(signOutAccount).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape fecha", () => {
    const onClose = vi.fn();
    menu({ onClose });
    fireEvent.keyDown(screen.getByRole("menu", { name: "Conta Google" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clique fora fecha; clique dentro nao", () => {
    const onClose = vi.fn();
    menu({ onClose });
    fireEvent.mouseDown(screen.getByRole("menu", { name: "Conta Google" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("o foco entra no menu e volta ao gatilho ao fechar", () => {
    const gatilho = document.createElement("button");
    document.body.appendChild(gatilho);
    gatilho.focus();
    const vista = menu({ anchor: gatilho });
    const caixa = screen.getByRole("menu", { name: "Conta Google" });
    expect(caixa.contains(document.activeElement)).toBe(true);
    vista.unmount();
    expect(document.activeElement).toBe(gatilho);
    gatilho.remove();
  });
});

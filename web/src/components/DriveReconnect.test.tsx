import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { DriveReconnect, DRIVE_MARK_KEY, rememberDriveVault } from "./DriveReconnect";
import { connectDrive, driveSessionState, driveVaultRoot } from "../local/driveSession";
import { openDriveVault } from "../local/vaultCloud";
import { flushVaultSync } from "../local/folderSync";
import {
  beginVaultActivity,
  endVaultActivity,
  resetVaultActivity,
  updateVaultActivity,
} from "../local/vaultActivity";

// A sessao do Google e a abertura do cofre nunca vao a rede: o teste dubla o
// login, a pasta e o `openDriveVault`. O resto do modulo fica como esta
// (`driveConfigured` continua lendo o client id ligado no beforeEach).
vi.mock("../local/driveSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/driveSession")>();
  return {
    ...actual,
    connectDrive: vi.fn(),
    driveVaultRoot: vi.fn(async () => undefined),
    driveSessionState: vi.fn(() => "off"),
  };
});

vi.mock("../local/vaultCloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/vaultCloud")>();
  return { ...actual, openDriveVault: vi.fn() };
});

vi.mock("../local/folderSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/folderSync")>();
  return { ...actual, flushVaultSync: vi.fn(async () => null) };
});

const RESUMO = { notes: 400, attachments: 218, bytes: 13_000_000 };

const aberto = {
  restored: {
    created: 400,
    updated: 0,
    skipped: 0,
    notebooks: { created: 0, updated: 0, skipped: 0 },
    analyses: 0,
    settings: false,
    attachments: { restored: 0, skipped: 0 },
    source: "backup" as const,
  },
  synced: null,
  summary: RESUMO,
  background: null,
};

beforeEach(() => {
  localStorage.clear();
  resetVaultActivity();
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-de-teste");
  vi.mocked(connectDrive).mockResolvedValue(undefined as never);
  vi.mocked(driveVaultRoot).mockResolvedValue(undefined as never);
  vi.mocked(driveSessionState).mockReturnValue("off");
  vi.mocked(openDriveVault).mockResolvedValue(aberto);
  vi.mocked(flushVaultSync).mockResolvedValue(null);
});

afterEach(() => {
  resetVaultActivity();
  vi.unstubAllEnvs();
  vi.mocked(connectDrive).mockReset();
  vi.mocked(driveVaultRoot).mockReset();
  vi.mocked(driveSessionState).mockReset();
  vi.mocked(openDriveVault).mockReset();
  vi.mocked(flushVaultSync).mockReset();
  vi.restoreAllMocks();
});

describe("DriveReconnect", () => {
  it("sem marca de Drive nao ocupa a tela", () => {
    const { container } = render(<DriveReconnect />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sem sessao mostra a linha com o numero e o botao conectar", () => {
    rememberDriveVault(RESUMO);
    render(<DriveReconnect />);

    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    // O numero que importa: tamanho e quantidade de notas do ultimo cofre.
    expect(screen.getByText("12 MB · 400 notas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "conectar" })).toBeInTheDocument();
  });

  it("sem numero guardado ainda diz por que a linha esta ali", () => {
    rememberDriveVault();
    render(<DriveReconnect />);

    expect(screen.getByText("sessão vencida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "conectar" })).toBeInTheDocument();
  });

  it("com sessao viva nao renderiza nada", () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");

    const { container } = render(<DriveReconnect />);
    expect(container).toBeEmptyDOMElement();
  });

  it("com sessao viva e o cofre trabalhando, a linha mostra a etapa sem botao", () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");
    const token = beginVaultActivity("sincronizando");

    render(<DriveReconnect />);

    // Sinal discreto do segundo plano: a mesma linha, sem tela de carregamento.
    expect(screen.getByText("gravando o que mudou")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "conectar" })).not.toBeInTheDocument();

    act(() => updateVaultActivity(token, { stage: "anexos", progress: { done: 2, total: 8 } }));
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/de 8 anexos/)).toBeInTheDocument();

    act(() => endVaultActivity(token));
    expect(screen.queryByText("gravando o que mudou")).not.toBeInTheDocument();
  });

  it("falha do segundo plano volta na linha com o motivo e um tentar", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");
    const token = beginVaultActivity("sincronizando");
    act(() => endVaultActivity(token, "não foi possível concluir o Drive"));

    render(<DriveReconnect />);

    expect(screen.getByRole("alert")).toHaveTextContent("não foi possível concluir o Drive");
    const tentar = screen.getByRole("button", { name: "tentar" });
    expect(screen.queryByRole("button", { name: "conectar" })).not.toBeInTheDocument();

    fireEvent.click(tentar);
    await waitFor(() => expect(flushVaultSync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("não foi possível concluir o Drive")).not.toBeInTheDocument(),
    );
  });

  it("clicar conecta, conta a etapa no VaultBoot e some ao terminar", async () => {
    rememberDriveVault(RESUMO);

    // Duas paradas para a tela ser lida no meio do caminho.
    let liberaLeitura!: () => void;
    const leitura = new Promise<void>((resolve) => {
      liberaLeitura = resolve;
    });
    let liberaContagem!: () => void;
    const contagem = new Promise<void>((resolve) => {
      liberaContagem = resolve;
    });

    vi.mocked(openDriveVault).mockImplementation(async (_root, options) => {
      options?.onStage?.("lendo");
      await leitura;
      options?.onStage?.("aplicando");
      options?.onProgress?.({ done: 338, total: 400 });
      await contagem;
      return aberto;
    });

    render(<DriveReconnect />);
    fireEvent.click(screen.getByRole("button", { name: "conectar" }));

    // O VaultBoot aprovado aparece durante o trabalho, com o numero do lado.
    expect(await screen.findByText("lendo o cofre")).toBeInTheDocument();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.getByText("12 MB · 400 notas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "conectar" })).not.toBeInTheDocument();
    expect(connectDrive).toHaveBeenCalledTimes(1);
    expect(driveVaultRoot).toHaveBeenCalledTimes(1);
    expect(openDriveVault).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        attachments: "skip",
        sync: "background",
        onStage: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );

    liberaLeitura();
    expect(await screen.findByText("338")).toBeInTheDocument();
    expect(screen.getByText(/de 400 notas/)).toBeInTheDocument();

    liberaContagem();
    // Terminou: a linha some e o pendente local sobe na hora.
    await waitFor(() => expect(screen.queryByText("Google Drive")).not.toBeInTheDocument());
    expect(flushVaultSync).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DRIVE_MARK_KEY)).toBe("1");
  });

  it("erro volta a linha com a causa em uma linha", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(openDriveVault).mockRejectedValue(new Error("Drive 403 sem permissao"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<DriveReconnect />);
    fireEvent.click(screen.getByRole("button", { name: "conectar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sem permissão no Drive. A Drive API pode estar desligada no projeto.",
    );
    // A linha volta pronta para tentar de novo, com o numero ainda na tela.
    expect(screen.getByRole("button", { name: "conectar" })).toBeInTheDocument();
    expect(screen.getByText("12 MB · 400 notas")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    expect(flushVaultSync).not.toHaveBeenCalled();

    log.mockRestore();
  });

  it("login recusado tambem volta em uma linha", async () => {
    rememberDriveVault();
    vi.mocked(connectDrive).mockRejectedValue(new Error("Drive 401 token expirado"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<DriveReconnect />);
    fireEvent.click(screen.getByRole("button", { name: "conectar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A sessão do Google venceu. Conecte de novo.",
    );
    expect(openDriveVault).not.toHaveBeenCalled();

    log.mockRestore();
  });
});

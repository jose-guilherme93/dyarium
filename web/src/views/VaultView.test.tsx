import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { VaultView } from "./VaultView";
import { connectAccount } from "../local/accountConnect";
import { syncVaultToDrive } from "../local/vaultCloud";
import { driveSessionState, driveProfile } from "../local/driveSession";
import { flushVaultSync, lastSyncSummary } from "../local/folderSync";
import {
  beginVaultActivity,
  endVaultActivity,
  resetVaultActivity,
  updateVaultActivity,
} from "../local/vaultActivity";
import { rememberDriveVault } from "../local/driveMark";

vi.mock("../local/driveSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/driveSession")>();
  return {
    ...actual,
    driveConfigured: vi.fn(() => true),
    driveSessionState: vi.fn(() => "off"),
    driveProfile: vi.fn(() => null),
    disconnectDrive: vi.fn(),
  };
});

vi.mock("../local/accountConnect", () => ({
  connectAccount: vi.fn(),
}));

vi.mock("../local/vaultCloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/vaultCloud")>();
  return { ...actual, syncVaultToDrive: vi.fn(async () => null) };
});

vi.mock("../local/folderSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/folderSync")>();
  return {
    ...actual,
    flushVaultSync: vi.fn(async () => null),
    lastSyncSummary: vi.fn(() => null),
  };
});

vi.mock("../local/vaultStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../local/vaultStats")>();
  return {
    ...actual,
    vaultStats: vi.fn(async () => ({
      notes: 400,
      audioNotes: 86,
      audioSeconds: 6 * 3600 + 24 * 60,
      attachments: 218,
      attachmentBytes: 13_000_000,
      covers: 3,
      coverBytes: 1000,
      bytes: 13_001_000,
    })),
  };
});

const RESUMO = { notes: 400, attachments: 218, bytes: 13_000_000 };

const aberto = {
  restored: null,
  synced: null,
  summary: RESUMO,
  background: null,
};

beforeEach(async () => {
  localStorage.clear();
  resetVaultActivity();
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-de-teste");
  const ds = await import("../local/driveSession");
  vi.mocked(ds.driveConfigured).mockReturnValue(true);
  vi.mocked(driveSessionState).mockReturnValue("off");
  vi.mocked(driveProfile).mockReturnValue(null);
  vi.mocked(connectAccount).mockResolvedValue(aberto as never);
  vi.mocked(syncVaultToDrive).mockResolvedValue(null as never);
  vi.mocked(flushVaultSync).mockResolvedValue(null as never);
  vi.mocked(lastSyncSummary).mockReturnValue(null);
});

afterEach(() => {
  resetVaultActivity();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("VaultView", () => {
  it("mostra os numeros do cofre", async () => {
    rememberDriveVault(RESUMO);
    render(<VaultView onBack={() => undefined} />);
    expect(await screen.findByText("400")).toBeInTheDocument();
    expect(screen.getByText("Notas")).toBeInTheDocument();
    expect(screen.getByText("Anexos")).toBeInTheDocument();
    expect(screen.getByText("Tamanho")).toBeInTheDocument();
    expect(screen.getByText(/86 áudios/)).toBeInTheDocument();
  });

  it("sem Google configurado mostra a linha e sem botao", async () => {
    const mod = await import("../local/driveSession");
    vi.mocked(mod.driveConfigured).mockReturnValue(false);
    render(<VaultView onBack={() => undefined} />);
    expect(await screen.findByText("Google não configurado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "entrar com Google" })).not.toBeInTheDocument();
  });

  it("sessao vencida mostra o botao e chama connectAccount", async () => {
    rememberDriveVault(RESUMO);
    render(<VaultView onBack={() => undefined} />);
    const botao = await screen.findByRole("button", { name: "entrar com Google" });
    fireEvent.click(botao);
    await waitFor(() => expect(connectAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(connectAccount).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: "skip", sync: "background" }),
    ));
  });

  it("sincronizar chama syncVaultToDrive", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");
    vi.mocked(driveProfile).mockReturnValue({ name: "Ada", email: "ada@example.com", picture: "" });
    render(<VaultView onBack={() => undefined} />);
    const botao = await screen.findByRole("button", { name: "sincronizar" });
    fireEvent.click(botao);
    await waitFor(() => expect(syncVaultToDrive).toHaveBeenCalledTimes(1));
  });

  it("desconectar chama disconnectDrive", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");
    vi.mocked(driveProfile).mockReturnValue({ name: "Ada", email: "ada@example.com", picture: "" });
    render(<VaultView onBack={() => undefined} />);
    const botao = await screen.findByRole("button", { name: "Deslogar" });
    fireEvent.click(botao);
    expect(await screen.findByText("Cancelar")).toBeInTheDocument();
  });

  it("atividade de sync mostra gravando o que mudou e o medidor", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(driveSessionState).mockReturnValue("connected");
    vi.mocked(driveProfile).mockReturnValue({ name: "Ada", email: "ada@example.com", picture: "" });
    const token = beginVaultActivity("sincronizando");
    render(<VaultView onBack={() => undefined} />);
    expect(screen.getByText("gravando o que mudou")).toBeInTheDocument();
    act(() => updateVaultActivity(token, { stage: "anexos", progress: { done: 2, total: 8 } }));
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/de 8 anexos/)).toBeInTheDocument();
    act(() => endVaultActivity(token));
  });

  it("erro de conexao volta em uma linha", async () => {
    rememberDriveVault(RESUMO);
    vi.mocked(connectAccount).mockRejectedValue(new Error("Drive 403 sem permissao"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<VaultView onBack={() => undefined} />);
    const botao = await screen.findByRole("button", { name: "entrar com Google" });
    fireEvent.click(botao);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sem permissão no Drive. A Drive API pode estar desligada no projeto.",
    );
    log.mockRestore();
  });

  it("login recusado tambem volta em uma linha", async () => {
    rememberDriveVault();
    vi.mocked(connectAccount).mockRejectedValue(new Error("Drive 401 token expirado"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<VaultView onBack={() => undefined} />);
    const botao = await screen.findByRole("button", { name: "entrar com Google" });
    fireEvent.click(botao);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A sessão do Google venceu. Conecte de novo.",
    );
    log.mockRestore();
  });

  it("progresso durante conexao mostra VaultBoot", async () => {
    rememberDriveVault(RESUMO);
    let libera!: () => void;
    const espera = new Promise<void>((resolve) => { libera = resolve; });
    vi.mocked(connectAccount).mockImplementation(async (options: Parameters<typeof connectAccount>[0]) => {
      options?.onStage?.("lendo");
      await espera;
      return aberto;
    });
    render(<VaultView onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "entrar com Google" }));
    expect(await screen.findByText("lendo o cofre")).toBeInTheDocument();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    libera();
    await waitFor(() => expect(screen.queryByText("lendo o cofre")).not.toBeInTheDocument());
  });
});

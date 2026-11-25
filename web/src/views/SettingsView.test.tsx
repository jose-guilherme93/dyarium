import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { api } from "../api";
import type { McpProject, Settings } from "../types";

vi.mock("../api", () => ({
  getToken: () => "token-de-teste",
  api: {
    getSettings: vi.fn(),
    putSettings: vi.fn(async () => ({ status: "ok" })),
    listModels: vi.fn(async () => ({ models: [] })),
    listAnalyzeModels: vi.fn(async () => ({ models: [] })),
    getLocalAnalysis: vi.fn(),
    setupLocalAnalysis: vi.fn(),
    downloadModel: vi.fn(async () => ({ status: "ok" })),
    mcpProjects: vi.fn(async () => ({ projects: [] })),
    listDeletedEntries: vi.fn(async () => ({ entries: [] })),
    restoreEntry: vi.fn(async () => ({})),
    listNotebooks: vi.fn(async () => ({ notebooks: [] })),
    listAllEntries: vi.fn(async () => ({ entries: [] })),
    listEntries: vi.fn(async () => ({ entries: [] })),
    patchEntry: vi.fn(async () => ({ status: "ok", versions: {} })),
    updateNotebook: vi.fn(async () => ({})),
  },
}));

const drive = vi.hoisted(() => ({
  configured: vi.fn(() => false),
  state: vi.fn(() => "off" as "off" | "connected" | "expired"),
  onChange: vi.fn((cb: () => void) => {
    void cb;
    return () => undefined;
  }),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(),
}));
const cloud = vi.hoisted(() => ({
  sync: vi.fn(async () => ({ written: 2, deleted: 0, unchanged: 1, at: new Date().toISOString() })),
  restore: vi.fn(async () => ({ created: 1, updated: 0, skipped: 0 })),
  exists: vi.fn(async () => true),
}));

vi.mock("../local/driveSession", () => ({
  driveConfigured: () => drive.configured(),
  driveSessionState: () => drive.state(),
  onDriveSessionChange: (cb: () => void) => drive.onChange(cb),
  connectDrive: () => drive.connect(),
  disconnectDrive: () => drive.disconnect(),
}));
vi.mock("../local/vaultCloud", () => ({
  syncVaultToDrive: () => cloud.sync(),
  restoreVaultFromDrive: () => cloud.restore(),
  driveVaultExists: () => cloud.exists(),
}));
vi.mock("../local/accountConnect", () => ({
  connectAccount: async () => ({
    restored: null,
    synced: null,
    summary: { notes: 0, attachments: 0, bytes: 0 },
  }),
}));

const baseSettings: Settings = {
  owner_name: "joseti",
  all_notes_mine: true,
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "models/ggml-small-q5_1.bin",
  whisper_language: "pt",
  transcribe_provider: "whisper",
  deepgram_model: "nova-2",
  deepgram_api_key_set: false,
  analyze_enabled: true,
  analyze_provider: "openai",
  analyze_local_runtime: "",
  analyze_base_url: "https://opencode.ai/inference/go/openai/v1",
  analyze_model: "longcat-2.5-free",
  analyze_api_key_set: true,
  analyze_concurrency: 0,
  analysis_themes: "trabalho, saúde",
  review_enabled: true,
  literal_transcript: true,
  mcp_paused: false,
  mcp_idle_hours: 12,
  mcp_history_sessions: 3,
  mcp_include_commits: true,
  mcp_include_links: true,
  mcp_store_full_path: false,
  mcp_machine_alias: "",
};

const project: McpProject = {
  id: "entry-1",
  title: "dyarium",
  path: "projetos/dyarium",
  sessions: 12,
  last_session_at: new Date().toISOString(),
  state: "open",
  summary_detail: "concise",
  archived: false,
};

const whisperModels = [
  { name: "ggml-small-q5_1.bin", filename: "ggml-small-q5_1.bin", size_mb: 182, path: "models/ggml-small-q5_1.bin", downloaded: true, local_bytes: 1 },
  { name: "ggml-medium-q5_0.bin", filename: "ggml-medium-q5_0.bin", size_mb: 515, path: "models/ggml-medium-q5_0.bin", downloaded: true, local_bytes: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  drive.configured.mockReturnValue(false);
  drive.state.mockReturnValue("off");
  vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
  vi.mocked(api.listModels).mockResolvedValue({ models: whisperModels });
  vi.mocked(api.listAnalyzeModels).mockResolvedValue({ models: ["longcat-2.5-free", "glm-5.3"] });
  vi.mocked(api.mcpProjects).mockResolvedValue({ projects: [project] });
  vi.mocked(api.listNotebooks).mockResolvedValue({ notebooks: [] });
  vi.mocked(api.getLocalAnalysis).mockResolvedValue(undefined as never);
});

async function renderSettings() {
  render(<SettingsView />);
  await screen.findByRole("tab", { name: "Análise" }, { timeout: 10000 });
}

describe("SettingsView navegação", () => {
  it("abre em Análise e marca uma única aba ativa", async () => {
    await renderSettings();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Transcrição",
      "Análise",
      "Projetos",
      "Autor",
      "Cofre",
      "Lixeira",
    ]);
    expect(screen.getByRole("tab", { name: "Análise" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Transcrição" })).toHaveAttribute("aria-selected", "false");
  });

  it("troca o conteúdo sem acordeão nem segunda navegação", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Transcrição" }));

    expect(await screen.findByRole("radiogroup", { name: "Modelo de transcrição" })).toBeTruthy();
    expect(document.querySelector(".section-row, .settings-nav")).toBeNull();
  });
});

describe("SettingsView provedor e modelos", () => {
  it("lista os provedores com estado da chave e salva o escolhido", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Provedor" }));
    const list = await screen.findByRole("listbox", { name: "Provedor" });
    const groq = within(list).getByRole("option", { name: /Groq/ });
    expect(groq).toHaveAttribute("aria-selected", "false");
    expect(within(list).getByRole("option", { name: /OpenCode Go/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(groq);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_provider: "openai",
          analyze_base_url: "https://api.groq.com/openai/v1",
        }),
      ),
    );
  });

  it("escolher modelo salva analyze_model", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "atualizar" }));
    fireEvent.click(await screen.findByRole("radio", { name: "glm-5.3" }));

    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ analyze_model: "glm-5.3" })));
  });

  it("escolher modelo do Whisper salva whisper_model", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Transcrição" }));
    fireEvent.click(await screen.findByRole("radio", { name: "medium" }));

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ whisper_model: "models/ggml-medium-q5_0.bin" })),
    );
  });

  it("filtra modelos pelo nome", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "atualizar" }));
    await screen.findByRole("radio", { name: "glm-5.3" });
    fireEvent.change(screen.getByLabelText("Filtrar modelos"), { target: { value: "glm" } });

    expect(screen.queryByRole("radio", { name: "longcat-2.5-free" })).toBeNull();
    expect(screen.getByRole("radio", { name: "glm-5.3" })).toBeTruthy();
  });
});

describe("SettingsView projetos do MCP", () => {
  it("lista projeto com sessões, última e estado", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Projetos" }));

    const row = await screen.findByText("dyarium");
    const projectRow = row.closest(".cfg-project");
    expect(projectRow).toBeTruthy();
    expect(within(projectRow as HTMLElement).getByText("projetos/dyarium")).toBeTruthy();
    expect(within(projectRow as HTMLElement).getByText("12")).toBeTruthy();
    expect(within(projectRow as HTMLElement).getByLabelText("sessão aberta")).toBeTruthy();
  });

  it("troca o detalhe do resumo por projeto", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Projetos" }));
    const group = await screen.findByRole("group", { name: "Resumo de dyarium" });

    fireEvent.click(within(group).getByRole("button", { name: "Completo" }));

    await waitFor(() => expect(api.patchEntry).toHaveBeenCalledWith("entry-1", { summary_detail: "full" }));
  });

  it("pausar o MCP salva mcp_paused", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Projetos" }));

    fireEvent.click(await screen.findByRole("switch", { name: "Pausar MCP" }));

    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith({ mcp_paused: true }));
  });

  it("mantém a explicação atrás do botão de ajuda", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Projetos" }));
    await screen.findByText("dyarium");

    // Nenhuma explicação fica aberta por padrao.
    const details = [...document.querySelectorAll<HTMLDetailsElement>("details.cfg-why")];
    expect(details.length).toBeGreaterThan(0);
    const pause = details.find((item) => item.textContent?.includes("Pausado, o endpoint"));
    expect(pause).toBeTruthy();
    expect(pause!.open).toBe(false);

    fireEvent.click(pause!.querySelector("summary") as HTMLElement);
    expect(pause!.open).toBe(true);
  });
});

describe("SettingsView cofre no Drive", () => {
  async function abrirCofre() {
    await renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Cofre" }));
    const linha = (await screen.findByText("Google Drive")).closest(".cfg-item") as HTMLElement;
    return linha;
  }

  it("sem VITE_GOOGLE_CLIENT_ID o botao do Drive fica desabilitado", async () => {
    drive.configured.mockReturnValue(false);
    const linha = await abrirCofre();

    expect(within(linha).getByText("sem client id")).toBeTruthy();
    expect(within(linha).getByRole("button", { name: "conectar" })).toBeDisabled();
    expect(within(linha).getByRole("button", { name: "salvar" })).toBeDisabled();
    expect(within(linha).getByRole("button", { name: "restaurar" })).toBeDisabled();
  });

  it("com sessao conectada, salvar envia o cofre ao Drive", async () => {
    drive.configured.mockReturnValue(true);
    drive.state.mockReturnValue("connected");
    const linha = await abrirCofre();

    expect(within(linha).getByText("conectado")).toBeTruthy();
    const salvar = within(linha).getByRole("button", { name: "salvar" });
    expect(salvar).not.toBeDisabled();
    fireEvent.click(salvar);

    await waitFor(() => expect(cloud.sync).toHaveBeenCalledTimes(1));
  });
});

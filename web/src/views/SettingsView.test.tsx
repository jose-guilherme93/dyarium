import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { api } from "../api";
import type { Settings } from "../types";

// `getToken` vazio desliga o EventSource do painel nos testes.
vi.mock("../api", () => ({
  getToken: () => "",
  api: {
    getSettings: vi.fn(),
    listModels: vi.fn(async () => ({ models: [] })),
    getLocalAnalysis: vi.fn(),
    setupLocalAnalysis: vi.fn(),
    putSettings: vi.fn(async () => ({ status: "ok" })),
    listDeletedEntries: vi.fn(async () => ({ entries: [] })),
    restoreEntry: vi.fn(async () => ({})),
  },
}));

const settings: Settings = {
  owner_name: "",
  all_notes_mine: true,
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "models/ggml-small-q5_1.bin",
  whisper_language: "",
  transcribe_provider: "whisper",
  deepgram_model: "nova-2",
  deepgram_api_key_set: false,
  analyze_enabled: true,
  analyze_provider: "openai",
  analyze_local_runtime: "ollama",
  analyze_base_url: "http://ollama:11434/v1",
  analyze_model: "qwen2.5:0.5b",
  analyze_api_key_set: false,
  analysis_themes: "",
  review_enabled: false,
  literal_transcript: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSettings).mockResolvedValue(settings);
  vi.mocked(api.getLocalAnalysis).mockResolvedValue({
    runtime: "ollama",
    available: true,
    base_url: "http://ollama:11434/v1",
    models: ["qwen2.5:0.5b"],
    model: "qwen2.5:0.5b",
  });
  vi.mocked(api.setupLocalAnalysis).mockResolvedValue({
    runtime: "ollama",
    status: "ready",
    model: "qwen2.5:0.5b",
    base_url: "http://ollama:11434/v1",
    installed: true,
  });
});

describe("SettingsView análise local", () => {
  it("mostra o estado do Ollama e configura em um clique", async () => {
    render(<SettingsView />);

    expect(await screen.findByText(/Ollama no ar em http:\/\/ollama:11434\/v1/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Usar análise local" });
    fireEvent.click(button);

    await waitFor(() => expect(api.setupLocalAnalysis).toHaveBeenCalledWith("ollama", "qwen2.5:0.5b"));
    expect(api.putSettings).not.toHaveBeenCalled();
  });

  it("avisa quando o Ollama não esta no ar", async () => {
    vi.mocked(api.getLocalAnalysis).mockResolvedValue({
      runtime: "ollama",
      available: false,
      base_url: "http://ollama:11434/v1",
      models: [],
      model: "qwen2.5:0.5b",
    });

    render(<SettingsView />);

    expect(await screen.findByText(/Ollama não encontrado em http:\/\/ollama:11434\/v1/)).toBeTruthy();
  });

  it("esquece o runtime local ao escolher um provedor externo", async () => {
    render(<SettingsView />);

    const select = await screen.findByLabelText("Provedor da análise");
    fireEvent.change(select, { target: { value: "deepseek" } });

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_local_runtime: "",
          analyze_base_url: "https://api.deepseek.com/v1",
        }),
      ),
    );
  });

  it("oferece o llama.cpp embutido e configura em um clique", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...settings,
      analyze_local_runtime: "embedded",
      analyze_base_url: "http://127.0.0.1:11435/v1",
      analyze_model: "qwen2.5-0.5b-instruct-q4_k_m",
    });
    vi.mocked(api.getLocalAnalysis).mockImplementation(async (runtime) => {
      if (runtime === "embedded") {
        return {
          runtime: "embedded",
          available: true,
          base_url: "http://127.0.0.1:11435/v1",
          models: ["qwen2.5-0.5b-instruct-q4_k_m"],
          model: "qwen2.5-0.5b-instruct-q4_k_m",
          downloaded: true,
          running: false,
          size_mb: 469,
        };
      }
      return {
        runtime: "ollama",
        available: false,
        base_url: "http://ollama:11434/v1",
        models: [],
        model: "qwen2.5:0.5b",
      };
    });

    render(<SettingsView />);

    expect(await screen.findByText("llama.cpp pronto; carrega na primeira análise.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar análise local" }));

    await waitFor(() =>
      expect(api.setupLocalAnalysis).toHaveBeenCalledWith("embedded", "qwen2.5-0.5b-instruct-q4_k_m"),
    );
  });

  it("liga a revisao da transcricao e mostra a opcao literal", async () => {
    let reviewEnabled = false;
    vi.mocked(api.getSettings).mockImplementation(async () => ({
      ...settings,
      review_enabled: reviewEnabled,
    }));
    vi.mocked(api.putSettings).mockImplementation(async () => {
      reviewEnabled = true;
      return { status: "ok" };
    });

    render(<SettingsView />);

    const toggle = await screen.findByLabelText("Revisar a transcrição com IA");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({ review_enabled: true }),
      ),
    );
    // A sub-opcao so aparece quando a revisao esta ligada.
    expect(await screen.findByLabelText("Transcrição literal")).toBeTruthy();
  });

  it("oferece o OpenCode Zen com a base e o modelo certos", async () => {
    render(<SettingsView />);

    const select = await screen.findByLabelText("Provedor da análise");
    fireEvent.change(select, { target: { value: "opencodeZen" } });

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_provider: "openai",
          analyze_base_url: "https://opencode.ai/inference/openai/v1",
          // O padrao nao e modelo de raciocinio: responde direto.
          analyze_model: "glm-5.3-flash-free",
          analyze_enabled: true,
        }),
      ),
    );
  });
});

describe("SettingsView chaves de provedores", () => {
  it("mostra o atalho para criar a chave do OpenRouter", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...settings,
      analyze_provider: "openai",
      analyze_local_runtime: "",
      analyze_base_url: "https://openrouter.ai/api/v1",
      analyze_model: "google/gemini-2.5-flash",
    });

    render(<SettingsView />);

    const link = await screen.findByRole("link", { name: "Criar chave" });
    expect(link.getAttribute("href")).toBe("https://openrouter.ai/keys");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByPlaceholderText("sk-or-v1-...")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Modelos" }).getAttribute("href")).toBe(
      "https://openrouter.ai/models",
    );
  });

  it("escolhe o OpenRouter com base e modelo prontos", async () => {
    render(<SettingsView />);

    const select = await screen.findByLabelText("Provedor da análise");
    fireEvent.change(select, { target: { value: "openrouter" } });

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_provider: "openai",
          analyze_base_url: "https://openrouter.ai/api/v1",
          analyze_model: "google/gemini-2.5-flash",
          analyze_local_runtime: "",
          analyze_enabled: true,
        }),
      ),
    );
  });

  it("monta a chave da Deepgram com o modelo e o link", async () => {
    let current: Settings = { ...settings, transcribe_provider: "deepgram" };
    vi.mocked(api.getSettings).mockImplementation(async () => current);
    vi.mocked(api.putSettings).mockImplementation(async (patch) => {
      current = { ...current, ...(patch as unknown as Partial<Settings>) };
      return { status: "ok" };
    });

    render(<SettingsView />);

    const link = await screen.findByRole("link", { name: "Criar chave na Deepgram" });
    expect(link.getAttribute("href")).toBe("https://console.deepgram.com/");

    fireEvent.change(screen.getByLabelText("Modelo Deepgram"), { target: { value: "nova-3" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith({ deepgram_model: "nova-3" }));

    fireEvent.change(screen.getByLabelText("Chave da Deepgram"), { target: { value: "dg-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar chave da Deepgram" }));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith({ deepgram_api_key: "dg-key" }));
  });

  it("mostra a chave guardada como definida, sem revelar o valor", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...settings,
      analyze_provider: "openai",
      analyze_local_runtime: "",
      analyze_base_url: "https://openrouter.ai/api/v1",
      analyze_model: "google/gemini-2.5-flash",
      analyze_api_key_set: true,
    });

    render(<SettingsView />);

    expect(await screen.findByText("definida")).toBeTruthy();
    expect((screen.getByLabelText("Chave da API de análise") as HTMLInputElement).value).toBe("");
  });
});

describe("SettingsView autor", () => {
  it("salva o nome do dono ao sair do campo", async () => {
    render(<SettingsView />);

    const input = await screen.findByLabelText("Seu nome");
    fireEvent.change(input, { target: { value: "Ana" } });
    fireEvent.blur(input);

    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith({ owner_name: "Ana" }));
  });

  it("desliga o padrao de todas as notas serem do dono", async () => {
    render(<SettingsView />);

    const toggle = await screen.findByLabelText("Todas as notas são minhas");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ all_notes_mine: false }),
    );
  });
});

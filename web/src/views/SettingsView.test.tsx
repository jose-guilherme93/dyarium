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
  trim_silence: false,
  max_whisper_rss_mb: 0,
  whisper_model: "models/ggml-small-q5_1.bin",
  whisper_language: "",
  transcribe_provider: "whisper",
  deepgram_model: "nova-2",
  deepgram_api_key_set: false,
  analyze_enabled: true,
  analyze_provider: "openai",
  analyze_base_url: "http://ollama:11434/v1",
  analyze_model: "qwen2.5:0.5b",
  analyze_api_key_set: false,
  analysis_themes: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSettings).mockResolvedValue(settings);
  vi.mocked(api.getLocalAnalysis).mockResolvedValue({
    available: true,
    base_url: "http://ollama:11434/v1",
    models: ["qwen2.5:0.5b"],
    model: "qwen2.5:0.5b",
  });
  vi.mocked(api.setupLocalAnalysis).mockResolvedValue({
    status: "ready",
    model: "qwen2.5:0.5b",
    base_url: "http://ollama:11434/v1",
    installed: true,
  });
});

describe("SettingsView analise local", () => {
  it("mostra o estado do Ollama e configura em um clique", async () => {
    render(<SettingsView />);

    expect(await screen.findByText(/Ollama no ar em http:\/\/ollama:11434\/v1/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Instalar e usar o Ollama local" });
    fireEvent.click(button);

    await waitFor(() => expect(api.setupLocalAnalysis).toHaveBeenCalledWith("qwen2.5:0.5b"));
    expect(api.putSettings).not.toHaveBeenCalled();
  });

  it("avisa quando o Ollama nao esta no ar", async () => {
    vi.mocked(api.getLocalAnalysis).mockResolvedValue({
      available: false,
      base_url: "http://ollama:11434/v1",
      models: [],
      model: "qwen2.5:0.5b",
    });

    render(<SettingsView />);

    expect(await screen.findByText(/Ollama nao encontrado em http:\/\/ollama:11434\/v1/)).toBeTruthy();
  });

  it("oferece o OpenCode Zen com a base e o modelo certos", async () => {
    render(<SettingsView />);

    const select = await screen.findByLabelText("Provedor da analise");
    fireEvent.change(select, { target: { value: "opencodeZen" } });

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_provider: "openai",
          analyze_base_url: "https://opencode.ai/inference/openai/v1",
          analyze_model: "deepseek-v4.1-flash-free",
          analyze_enabled: true,
        }),
      ),
    );
  });
});

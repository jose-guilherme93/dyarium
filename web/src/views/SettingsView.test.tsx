import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { api } from "../api";
import type { Settings } from "../types";

vi.mock("../api", () => ({
  getToken: () => "",
  api: {
    getSettings: vi.fn(),
    listModels: vi.fn(async () => ({ models: [] })),
    listAnalyzeModels: vi.fn(async () => ({ models: [] })),
    getLocalAnalysis: vi.fn(),
    setupLocalAnalysis: vi.fn(),
    putSettings: vi.fn(async () => ({ status: "ok" })),
    listDeletedEntries: vi.fn(async () => ({ entries: [] })),
    restoreEntry: vi.fn(async () => ({})),
    listNotebooks: vi.fn(async () => ({ notebooks: [] })),
    listAllEntries: vi.fn(async () => ({ entries: [] })),
    listEntries: vi.fn(async () => ({ entries: [] })),
    patchEntry: vi.fn(async () => ({ status: "ok", versions: {} })),
    updateNotebook: vi.fn(async () => ({})),
  },
}));

const baseSettings: Settings = {
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
  vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
  vi.mocked(api.listAnalyzeModels).mockResolvedValue({ models: [] });
  vi.mocked(api.listNotebooks).mockResolvedValue({ notebooks: [] });
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

async function clickSidebar(label: string) {
  fireEvent.click(await screen.findByRole("link", { name: label }));
}

async function renderSettings() {
  render(<SettingsView />);
  await screen.findByRole("link", { name: "Transcrição" }, { timeout: 10000 });
}

describe("SettingsView sidebar", () => {
  it("abre na aba Analise por padrao", async () => {
    await renderSettings();

    const active = screen.getByRole("link", { name: "Análise" });
    expect(active).toHaveClass("settings-nav-item--on");
    expect(active).toHaveAttribute("aria-current", "page");
    // A secao aberta por padrao e Analise; Transcrição fica recolhida.
    expect(screen.getByRole("button", { name: "Análise" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Transcrição" })).toHaveAttribute("aria-expanded", "false");
  });

  it("abre a secao clicada no lugar e recolhe as outras", async () => {
    await renderSettings();

    // Antes: Analise aberta, Autor fechada.
    expect(screen.queryByLabelText("Seu nome")).toBeNull();

    clickSidebar("Autor");

    expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Autor" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Análise" })).toHaveAttribute("aria-expanded", "false");
  });

  it("muda para a aba Transcrição ao clicar", async () => {
    await renderSettings();

    clickSidebar("Transcrição");
    expect(await screen.findByText("Catálogo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Transcrição" })).toHaveClass("settings-nav-item--on");
  });

  it("tem exatamente cinco seções e nenhuma menção a privacidade", async () => {
    await renderSettings();

    const nav = screen.getByRole("navigation", { name: "Seções de configurações" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Transcrição",
      "Análise",
      "Projetos (MCP)",
      "Autor",
      "Dados e lixeira",
    ]);
    expect(screen.queryAllByRole("link", { name: /privacidade/i })).toHaveLength(0);
    expect(screen.queryByText(/privacidade/i)).toBeNull();
  });

  it("muda para a aba Autor", async () => {
    await renderSettings();

    clickSidebar("Autor");
    expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
  });

  it("muda para a aba Dados e lixeira", async () => {
    await renderSettings();

    clickSidebar("Dados e lixeira");
    expect(await screen.findByText(/Lixeira/)).toBeTruthy();
  });

  it("liga a aba ao conteúdo da seção aberta", async () => {
    await renderSettings();

    const toggle = screen.getByRole("button", { name: "Análise" });
    expect(toggle).toHaveAttribute("aria-controls", "settings-section-analise");
    expect(document.getElementById("settings-section-analise")).toBeTruthy();
  });

  it("resume as cinco seções e abre só a ativa", async () => {
    await renderSettings();

    for (const name of ["Transcrição", "Análise", "Projetos (MCP)", "Autor", "Dados e lixeira"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(document.querySelectorAll(".section-row")).toHaveLength(5);
    expect(document.querySelectorAll(".section-row--open")).toHaveLength(1);
    expect(document.querySelectorAll(".section-content")).toHaveLength(1);
    for (const id of ["transcricao", "analise", "projetos", "autor", "dados"]) {
      expect(document.getElementById(`settings-${id}`)).toBeTruthy();
    }
    // Nada do desenho antigo (barra lateral, painel, layout) sobrou no DOM.
    expect(document.querySelector(".side-item, .side-menu, .panel, .layout")).toBeNull();
  });
});

describe("SettingsView colunas da seção aberta", () => {
  const cloudSettings: Settings = {
    ...baseSettings,
    analyze_local_runtime: "",
    analyze_base_url: "https://api.deepseek.com/v1",
    analyze_model: "deepseek-chat",
    analyze_api_key_set: true,
  };

  it("põe provedores e modelos na principal e chave/revisão na secundária", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(cloudSettings);

    await renderSettings();

    const columns = document.querySelector(".settings-columns");
    expect(columns).toBeTruthy();
    const main = columns?.querySelector(".settings-main");
    const side = columns?.querySelector(".settings-side");
    expect(main?.textContent).toContain("Provedor");
    expect(main?.textContent).toContain("Modelo");
    expect(side?.querySelector('[aria-label="Chave da API de análise"]')).toBeTruthy();
    expect(side?.textContent).toContain("Revisar a transcrição com IA");
    expect(side?.textContent).toContain("Avançado");
  });

  it("põe os modelos do Whisper na principal e o provedor na secundária", async () => {
    await renderSettings();
    clickSidebar("Transcrição");
    await screen.findByText("Catálogo");

    const columns = document.querySelector(".settings-columns");
    const main = columns?.querySelector(".settings-main");
    const side = columns?.querySelector(".settings-side");
    expect(main?.querySelector(".rows")).toBeTruthy();
    expect(side?.textContent).toContain("Whisper local");
    expect(side?.textContent).toContain("Deepgram");
    expect(side?.querySelector('[aria-label="Idioma da transcrição"]')).toBeTruthy();
  });

  it("mantém Autor e lixeira em coluna única e estreita", async () => {
    await renderSettings();
    clickSidebar("Autor");
    await screen.findByLabelText("Seu nome");

    expect(document.querySelector(".settings-columns")).toBeNull();
    expect(document.querySelector(".settings-single")).toBeTruthy();
  });
});

function cssRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`regra ${selector} não encontrada`);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("SettingsView linha de modelo", () => {
  it("mantém nome, medidor, adequação e custo no mesmo grupo, sem espaçador", async () => {
    vi.mocked(api.listModels).mockResolvedValue({
      models: [
        {
          name: "ggml-small-q5_1.bin",
          filename: "ggml-small-q5_1.bin",
          size_mb: 75,
          path: "models/ggml-small-q5_1.bin",
          downloaded: false,
          local_bytes: 0,
        },
      ],
    });

    await renderSettings();
    clickSidebar("Transcrição");
    await screen.findByText("Catálogo");

    const row = document.querySelector(".settings-main .row");
    expect(row).toBeTruthy();
    const parts = Array.from(row!.children).map((child) => child.className);
    expect(parts.slice(0, 5)).toEqual(["radio", "mname", "meter", "qual", "chip"]);
    expect(parts[5]).toBe("button button--small button--ghost");

    // O nome nao cresce nem empurra o grupo: sem flex: 1 e sem space-between.
    expect(cssRule(".mname")).toContain("flex: 0 1 auto");
    expect(cssRule(".mname")).not.toMatch(/flex:\s*1\b/);
    expect(cssRule(".row")).not.toContain("space-between");
    expect(cssRule(".row")).not.toContain("margin-left: auto");
  });
});

describe("SettingsView largura", () => {
  it("limita a página a ~460px e empilha rótulo e controle à esquerda", () => {
    const page = cssRule(".settings-page");
    const maxWidth = page.match(/max-width:\s*(\d+)px/);
    expect(maxWidth).toBeTruthy();
    expect(Number(maxWidth![1])).toBeGreaterThanOrEqual(440);
    expect(Number(maxWidth![1])).toBeLessThanOrEqual(480);
    expect(page).not.toContain("margin-inline: auto");

    const field = cssRule(".settings-page .field");
    expect(field).not.toContain("160px 1fr");
    expect(field).not.toMatch(/grid-template-columns:\s*[^;]*\b(160px|200px)\b/);
    expect(field).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("mantém o rótulo antes do controle no campo", async () => {
    await renderSettings();

    const field = screen.getByText("Análise por IA", { selector: ".field-label" }).closest(".field");
    const parts = Array.from(field?.children ?? []).map((child) => child.className);
    expect(parts.slice(0, 2)).toEqual(["field-label", "field-control"]);
  });

  it("zera o topo do container para a barra colar no scrollport", () => {
    expect(cssRule(".page:has(.settings-page)")).toContain("padding-top: 0");
  });
});

describe("SettingsView links", () => {
  it("mantém os atalhos como links de texto, sem virar botão", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      transcribe_provider: "deepgram",
      deepgram_api_key_set: true,
      analyze_local_runtime: "",
      analyze_base_url: "https://opencode.ai/inference/go/openai/v1",
      analyze_model: "beam-free",
      analyze_api_key_set: true,
    });

    await renderSettings();

    for (const name of ["Criar chave", "Modelos"]) {
      const link = screen.getByRole("link", { name });
      expect(link.tagName).toBe("A");
      expect(link).toHaveClass("lnk");
    }

    clickSidebar("Transcrição");

    for (const name of ["Catálogo", "Criar chave na Deepgram"]) {
      const link = await screen.findByRole("link", { name });
      expect(link.tagName).toBe("A");
      expect(link).toHaveClass("lnk");
    }
  });
});

function sectionRow(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: ".section-label" }).closest(".section-row");
  if (!row) throw new Error(`linha da seção ${label} não encontrada`);
  return row as HTMLElement;
}

describe("SettingsView resumo das secoes", () => {
  it("mostra aviso de chave ausente na linha de Transcrição com Deepgram", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      transcribe_provider: "deepgram",
      deepgram_api_key_set: false,
    });

    await renderSettings();

    expect(sectionRow("Transcrição").querySelector(".state-pill--warn")?.textContent).toBe("chave ausente");
  });

  it("mostra desligada na linha de Análise quando analyze_enabled e falso", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      analyze_enabled: false,
    });

    await renderSettings();

    expect(sectionRow("Análise").querySelector(".state-pill")?.textContent).toBe("desligada");
  });

  it("não repete o nome da seção no resumo da lixeira", async () => {
    await renderSettings();

    const row = sectionRow("Dados e lixeira");
    expect(row.querySelector(".section-summary")?.textContent).toBe("notas excluídas");
    expect(row.querySelector(".state-pill")).toBeNull();
  });
});

describe("SettingsView interruptores", () => {
  it("dá nome acessível aos interruptores da análise", async () => {
    await renderSettings();

    expect(screen.getByRole("checkbox", { name: "Análise por IA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Revisar a transcrição com IA" })).not.toBeChecked();
    expect(screen.getByText("Análise por IA", { selector: ".field-label" })).toBeVisible();
    expect(screen.getByText("Revisar a transcrição com IA", { selector: ".field-label" })).toBeVisible();
  });

  it("dá nome acessível à transcrição literal quando a revisão está ligada", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      review_enabled: true,
      literal_transcript: true,
    });

    await renderSettings();

    expect(screen.getByRole("checkbox", { name: "Transcrição literal" })).toBeChecked();
    expect(screen.getByText("Transcrição literal", { selector: ".field-label" })).toBeVisible();
  });

  it("dá nome acessível ao corte de silêncio", async () => {
    await renderSettings();
    clickSidebar("Transcrição");

    expect(await screen.findByRole("checkbox", { name: "Corte de silêncio" })).toBeTruthy();
    expect(screen.getByText("Corte de silêncio", { selector: ".field-label" })).toBeVisible();
  });
});

describe("SettingsView analise local", () => {
  it("mostra o estado do Ollama e configura em um clique", async () => {
    await renderSettings();

    expect(await screen.findByText(/Ollama no ar em http:\/\/ollama:11434\/v1/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Usar análise local" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(api.setupLocalAnalysis).toHaveBeenCalledWith("ollama", "qwen2.5:0.5b"),
    );
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

    await renderSettings();

    expect(await screen.findByText(/Ollama não encontrado em http:\/\/ollama:11434\/v1/)).toBeTruthy();
  });

  it("esquece o runtime local ao escolher um provedor externo", async () => {
    await renderSettings();

    const card = await screen.findByRole("radio", { name: "DeepSeek" });
    fireEvent.click(card);

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
      ...baseSettings,
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

    await renderSettings();

    expect(await screen.findByText("llama.cpp pronto; carrega na primeira análise.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar análise local" }));

    await waitFor(() =>
      expect(api.setupLocalAnalysis).toHaveBeenCalledWith("embedded", "qwen2.5-0.5b-instruct-q4_k_m"),
    );
  });

  it("liga a revisao da transcricao e mostra a opcao literal", async () => {
    let reviewEnabled = false;
    vi.mocked(api.getSettings).mockImplementation(async () => ({
      ...baseSettings,
      review_enabled: reviewEnabled,
    }));
    vi.mocked(api.putSettings).mockImplementation(async () => {
      reviewEnabled = true;
      return { status: "ok" };
    });

    await renderSettings();

    const toggles = screen.getAllByRole("checkbox");
    const revisar = toggles.find((t) => (t.getAttribute("aria-label") || "").includes("Revisar")) ?? toggles[1];
    expect(revisar).toBeTruthy();
    fireEvent.click(revisar);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ review_enabled: true }),
    );
  });
});

describe("SettingsView provedores de analise", () => {
  it("oferece o OpenCode Zen com a base e o modelo certos", async () => {
    await renderSettings();

    const card = await screen.findByRole("radio", { name: "OpenCode Zen" });
    fireEvent.click(card);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          analyze_provider: "openai",
          analyze_base_url: "https://opencode.ai/inference/openai/v1",
          analyze_model: "glm-5.3-flash-free",
          analyze_enabled: true,
        }),
      ),
    );
  });

  it("escolhe o OpenRouter com base e modelo prontos", async () => {
    await renderSettings();

    const card = await screen.findByRole("radio", { name: "OpenRouter" });
    fireEvent.click(card);

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

  it("nao busca modelos automaticamente ao carregar", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(baseSettings);
    vi.mocked(api.listAnalyzeModels).mockResolvedValue({
      models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4"],
    });
    vi.mocked(api.putSettings).mockImplementation(async () => ({ status: "ok" }));

    await renderSettings();

    expect(api.listAnalyzeModels).not.toHaveBeenCalled();
  });
});

describe("SettingsView chave de análise", () => {
  const cloudSettings: Settings = {
    ...baseSettings,
    analyze_provider: "openai",
    analyze_local_runtime: "",
    analyze_base_url: "https://api.deepseek.com/v1",
    analyze_model: "deepseek-chat",
    analyze_api_key_set: false,
  };

  it("salva a chave e limpa o campo só quando o servidor confirma", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(cloudSettings);
    let resolvePut: (value: { status: string }) => void = () => {};
    vi.mocked(api.putSettings).mockImplementation(
      () => new Promise((resolve) => {
        resolvePut = resolve;
      }),
    );

    await renderSettings();

    const input = (await screen.findByLabelText("Chave da API de análise")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e testar" }));

    expect(api.putSettings).toHaveBeenCalledWith({ analyze_api_key: "sk-teste" });
    expect(input.value).toBe("sk-teste");

    resolvePut({ status: "ok" });

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("mantém a chave digitada quando o salvamento falha", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(cloudSettings);
    vi.mocked(api.putSettings).mockRejectedValueOnce(new Error("falha de rede"));

    await renderSettings();

    const input = (await screen.findByLabelText("Chave da API de análise")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e testar" }));

    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith({ analyze_api_key: "sk-teste" }));
    expect(input.value).toBe("sk-teste");
  });
});

describe("SettingsView modelos de transcrição", () => {
  it("escolhe o modelo Whisper por rádio e desabilita o que não foi baixado", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      whisper_model: "models/ggml-base.bin",
    });
    vi.mocked(api.listModels).mockResolvedValue({
      models: [
        {
          name: "ggml-small-q5_1.bin",
          filename: "ggml-small-q5_1.bin",
          size_mb: 75,
          path: "models/ggml-small-q5_1.bin",
          downloaded: true,
          local_bytes: 75 * 1048576,
        },
        {
          name: "ggml-medium-q5_0.bin",
          filename: "ggml-medium-q5_0.bin",
          size_mb: 300,
          path: "models/ggml-medium-q5_0.bin",
          downloaded: false,
          local_bytes: 0,
        },
      ],
    });

    await renderSettings();
    clickSidebar("Transcrição");

    const medium = await screen.findByRole("radio", { name: "medium" });
    expect((medium as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "small" }));

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ whisper_model: "models/ggml-small-q5_1.bin" }),
    );
  });

  it("escolhe o modelo da Deepgram", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      transcribe_provider: "deepgram",
      deepgram_model: "nova-3",
    });

    await renderSettings();
    clickSidebar("Transcrição");

    const select = await screen.findByLabelText("Modelo Deepgram");
    fireEvent.change(select, { target: { value: "nova-2" } });

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ deepgram_model: "nova-2" }),
    );
  });
});

function cssBlock(opener: string): string {
  const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`bloco ${opener} não encontrado`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`bloco ${opener} sem fechamento`);
}

describe("SettingsView colunas lado a lado", () => {
  it("dá a linha inteira à seção ativa e desce as recolhidas no desktop", () => {
    const base = cssRule(".settings-sections");
    expect(base).toContain("display: flex");
    expect(base).toContain("flex-direction: column");

    const desktop = cssBlock("@container settings (min-width: 900px)");
    // A linha ocupa a largura útil e a barra acompanha o mesmo limite.
    expect(desktop).toContain("flex-direction: row");
    expect(desktop).toContain("flex-wrap: wrap");
    expect(desktop).toContain("gap: 10px");
    expect(desktop).toMatch(/\.settings-page\s*{[^}]*max-width:\s*934px/);
    // A ativa ocupa 100% da linha; as recolhidas descem como cartas.
    expect(desktop).toMatch(/\.section-row\s*{[^}]*flex:\s*0 0 148px/);
    expect(desktop).toMatch(/\.section-row--open\s*{[^}]*flex:\s*1 0 100%/);
    expect(desktop).toMatch(/\.section-row--open\s*{[^}]*max-width:\s*none/);
    expect(desktop).toMatch(/\.section-row:not\(\.section-row--open\)\s*{[^}]*position:\s*static/);
  });

  it("põe a coluna ativa como a primeira da linha sem mexer na ordem do DOM", async () => {
    // Só o visual muda: order -1 na ativa, dentro do bloco de desktop.
    const desktop = cssBlock("@container settings (min-width: 900px)");
    expect(desktop).toMatch(/\.section-row--open\s*{[^}]*order:\s*-1/);

    await renderSettings();
    expect(document.querySelector(".section-row--open .section-label")?.textContent).toBe("Análise");

    fireEvent.click(screen.getByRole("button", { name: "Autor" }));
    await screen.findByLabelText("Seu nome");
    expect(document.querySelector(".section-row--open .section-label")?.textContent).toBe("Autor");

    // A ordem das seções no DOM continua a do menu, para o empilhado no
    // estreito seguir igual (Transcrição, Análise, Projetos, Autor, Dados).
    expect([...document.querySelectorAll(".section-row .section-label")].map((el) => el.textContent)).toEqual([
      "Transcrição",
      "Análise",
      "Projetos (MCP)",
      "Autor",
      "Dados e lixeira",
    ]);
  });

  it("promove a coluna clicada, recolhe a anterior e o menu acompanha", async () => {
    await renderSettings();

    const autor = screen.getByRole("button", { name: "Autor" });
    expect(autor).toHaveAttribute("aria-expanded", "false");
    expect(autor).toHaveAttribute("aria-controls", "settings-section-autor");

    fireEvent.click(autor);

    expect(await screen.findByLabelText("Seu nome")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Autor" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Análise" })).toHaveAttribute("aria-expanded", "false");

    const nav = screen.getByRole("navigation", { name: "Seções de configurações" });
    expect(within(nav).getByRole("link", { name: "Autor" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Análise" })).not.toHaveAttribute("aria-current");
  });

  it("mostra o estado real em cada coluna recolhida", async () => {
    await renderSettings();

    const transcribe = sectionRow("Transcrição");
    expect(transcribe.querySelector(".section-summary")?.textContent).toBe("Whisper · small");

    const autor = sectionRow("Autor");
    expect(autor.querySelector(".section-summary")?.textContent).toBe("sem nome");
    expect(autor.querySelector(".state-pill")?.textContent).toBe("minhas");

    const dados = sectionRow("Dados e lixeira");
    expect(dados.querySelector(".section-summary")?.textContent).toBe("notas excluídas");
    expect(dados.querySelector(".state-pill")).toBeNull();
  });

  it("mostra provedor e modelo da Análise recolhida, ou desligada", async () => {
    await renderSettings();
    clickSidebar("Autor");

    const analise = sectionRow("Análise");
    const text = analise.querySelector(".section-summary")?.textContent ?? "";
    expect(text).toContain("Ollama");
    expect(text).toContain("qwen2.5:0.5b");
    expect(analise.querySelector(".state-pill")).toBeNull();
  });

  it("marca a Análise recolhida como desligada quando analyze_enabled é falso", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...baseSettings,
      analyze_enabled: false,
    });

    await renderSettings();
    clickSidebar("Autor");

    expect(sectionRow("Análise").querySelector(".state-pill")?.textContent).toBe("desligada");
  });

  it("não põe campo, botão de ação ou texto explicativo nas colunas recolhidas", async () => {
    await renderSettings();

    for (const name of ["Transcrição", "Autor", "Dados e lixeira"]) {
      const row = sectionRow(name);
      expect(row.querySelector("input, select, textarea, .button")).toBeNull();
      expect(row.querySelector(".section-content")).toBeNull();
    }
  });
});

describe("SettingsView projetos MCP", () => {
  it("mostra a conexao, os projetos e salva o detalhe via patchEntry", async () => {
    vi.mocked(api.listNotebooks).mockResolvedValue({
      notebooks: [
        {
          id: "projetos-mcp",
          name: "Projetos",
          color: "",
          is_default: false,
          kind: "mcp",
          subtitle: "",
          author: "",
          synopsis: "",
          language: "",
          goal_words: 0,
          book_status: "drafting",
          chapter_count: 0,
          entry_count: 2,
          created_at: "2026-10-28T12:00:00Z",
          updated_at: "2026-10-28T12:00:00Z",
        },
      ],
    });
    vi.mocked(api.listAllEntries).mockResolvedValue({
      entries: [
        {
          id: "p1",
          title: "Projeto Um",
          status: "ready",
          source: "text",
          original_filename: "",
          content_type: "text/plain",
          size_bytes: 0,
          duration_seconds: 0,
          sha256: "",
          recorded_at: null,
          created_at: "2026-10-28T12:00:00Z",
          updated_at: "2026-10-28T12:00:00Z",
          summary_detail: "concise",
        },
        {
          id: "p2",
          title: "Projeto Dois",
          status: "ready",
          source: "text",
          original_filename: "",
          content_type: "text/plain",
          size_bytes: 0,
          duration_seconds: 0,
          sha256: "",
          recorded_at: null,
          created_at: "2026-10-28T12:00:00Z",
          updated_at: "2026-10-28T12:00:00Z",
          summary_detail: "full",
        },
      ],
    });

    await renderSettings();
    clickSidebar("Projetos (MCP)");

    expect(await screen.findByText(/opencode mcp add dyarium/)).toBeTruthy();
    expect(screen.getAllByText(/SEU_TOKEN/)).toHaveLength(1);
    expect(screen.getByText(/Authorization=Bearer SEU_TOKEN/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arquivo" }));
    expect(await screen.findByText(/"oauth": false/)).toBeTruthy();
    expect(screen.getByText("Projeto Um")).toBeTruthy();
    expect(screen.getByText("Projeto Dois")).toBeTruthy();

    const concise = screen.getByRole("group", { name: "Resumo de Projeto Um" });
    expect(within(concise).getByRole("button", { name: "Enxuto" })).toHaveAttribute("aria-pressed", "true");
    expect(within(concise).getByRole("button", { name: "Completo" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(concise).getByRole("button", { name: "Completo" }));

    await waitFor(() =>
      expect(api.patchEntry).toHaveBeenCalledWith("p1", { summary_detail: "full" }),
    );
  });

  it("mostra a conexao e a linha vazia sem notebook MCP", async () => {
    vi.mocked(api.listNotebooks).mockResolvedValue({ notebooks: [] });
    vi.mocked(api.listAllEntries).mockResolvedValue({ entries: [] });

    await renderSettings();
    clickSidebar("Projetos (MCP)");

    expect((await screen.findAllByText(/SEU_TOKEN/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Nenhum projeto ainda\./)).toBeTruthy();
  });
});

describe("SettingsView autor", () => {
  it("salva o nome do dono ao sair do campo", async () => {
    await renderSettings();

    clickSidebar("Autor");

    const input = await screen.findByLabelText("Seu nome");
    fireEvent.change(input, { target: { value: "Ana" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ owner_name: "Ana" }),
    );
  });

  it("desliga o padrao de todas as notas serem do dono", async () => {
    await renderSettings();

    clickSidebar("Autor");

    const toggle = await screen.findByRole("checkbox", { name: "Todas as notas são minhas" });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.putSettings).toHaveBeenCalledWith({ all_notes_mine: false }),
    );
  });
});

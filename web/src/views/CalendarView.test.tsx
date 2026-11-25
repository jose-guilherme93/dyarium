import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalendarView } from "./CalendarView";
import { api } from "../api";
import type { Entry, Notebook } from "../types";

vi.mock("../api", () => ({
  api: {
    listEntriesCached: vi.fn(),
    listAllEntries: vi.fn(),
  },
}));

const NOTEBOOKS = [
  {
    id: "diario",
    name: "Diário",
    color: "#2c4a63",
  } as Notebook,
];

const now = new Date();
const TODAY_KEY = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

function localIso(year: number, month: number, day: number, hour = 9, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

function entry(
  id: string,
  title: string,
  recordedAt: string,
  extra: Partial<Entry> = {},
): Entry {
  return {
    id,
    title,
    status: "ready",
    source: "text",
    original_filename: "",
    content_type: "text/plain",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: recordedAt,
    created_at: recordedAt,
    updated_at: recordedAt,
    notebook_id: "diario",
    ...extra,
  } as Entry;
}

/** Dia do mes atual que nao e hoje, para escrever numa data diferente. */
function otherDay(): number {
  return now.getDate() === 1 ? 2 : 1;
}

function dayKeyOf(year: number, month: number, day: number): string {
  return [year, String(month + 1).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

function setup(entries: Entry[], overrides: Partial<Parameters<typeof CalendarView>[0]> = {}) {
  vi.mocked(api.listEntriesCached).mockResolvedValue({ entries });
  vi.mocked(api.listAllEntries).mockResolvedValue({ entries });
  const onOpenNote = vi.fn();
  const onCreateNote = vi.fn().mockResolvedValue(undefined);
  render(
    <CalendarView
      refreshKey={0}
      notebookId="diario"
      notebooks={NOTEBOOKS}
      onOpenNote={onOpenNote}
      onCreateNote={onCreateNote}
      {...overrides}
    />,
  );
  return { onOpenNote, onCreateNote };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calendario das notas", () => {
  it("agrupa pelo dia do evento, nao pela data de criacao", async () => {
    const criada = localIso(now.getFullYear(), now.getMonth() - 2, 3, 10, 0);
    setup([
      entry("a", "Retorno do exame", localIso(now.getFullYear(), now.getMonth(), now.getDate(), 8, 40), {
        created_at: criada,
      }),
      entry("b", "Nota de outro mes", localIso(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 0), {
        // Se a grade usasse created_at, esta nota cairia no dia de hoje.
        created_at: localIso(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0),
      }),
    ]);

    const cell = await waitFor(() => {
      const node = document.querySelector(`[data-day="${TODAY_KEY}"]`);
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(cell.textContent).toContain("Retorno do exame");
    expect(cell.textContent).not.toContain("Nota de outro mes");
    expect(cell.textContent).toContain("1");
  });

  it("abre a nota pela seta do painel do dia", async () => {
    const { onOpenNote } = setup([
      entry("a", "Retorno do exame", localIso(now.getFullYear(), now.getMonth(), now.getDate(), 8, 40)),
    ]);

    const abrir = await screen.findByRole("button", { name: "Abrir nota: Retorno do exame" });
    fireEvent.click(abrir);
    expect(onOpenNote).toHaveBeenCalledWith("a");
  });

  it("escreve no dia de hoje com a data de agora", async () => {
    const { onCreateNote } = setup([]);

    fireEvent.click(await screen.findByRole("button", { name: /escrever/i }));
    const campo = screen.getByLabelText("Escrever nota neste dia");
    fireEvent.change(campo, { target: { value: "Ideia de ensaio" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(onCreateNote).toHaveBeenCalledTimes(1));
    expect(onCreateNote).toHaveBeenCalledWith("Ideia de ensaio");
  });

  it("troca de mes levando o dia escolhido junto", async () => {
    setup([]);
    fireEvent.click(await screen.findByRole("button", { name: "Mês anterior" }));

    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate();
    const key = dayKeyOf(
      previous.getFullYear(),
      previous.getMonth(),
      Math.min(now.getDate(), last),
    );
    await waitFor(() => {
      expect(document.querySelector(`[data-day="${key}"]`)?.getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
  });

  it("nao oferece escrita em dia anterior a hoje", async () => {
    const { onCreateNote } = setup([]);
    const day = otherDay();
    const key = dayKeyOf(now.getFullYear(), now.getMonth(), day);

    const cell = await waitFor(() => {
      const node = document.querySelector(`[data-day="${key}"]`);
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    fireEvent.click(cell);

    expect(screen.queryByRole("button", { name: /escrever/i })).toBeNull();
    expect(screen.queryByLabelText("Escrever nota neste dia")).toBeNull();
    expect(onCreateNote).not.toHaveBeenCalled();
  });

  it("mostra o mesmo dia nos anos anteriores", async () => {
    const anoAnterior = now.getFullYear() - 1;
    setup([
      entry(
        "velha",
        "Nota do ano passado",
        localIso(anoAnterior, now.getMonth(), now.getDate(), 21, 10),
      ),
    ]);

    expect(await screen.findByText("outros anos")).toBeTruthy();
    expect(screen.getByText(String(anoAnterior))).toBeTruthy();
    expect(screen.getByText("Nota do ano passado")).toBeTruthy();
  });

  it("carrega o escopo do caderno escolhido", async () => {
    setup([]);
    await waitFor(() => expect(api.listAllEntries).toHaveBeenCalled());
    expect(vi.mocked(api.listAllEntries).mock.calls[0][0]).toMatchObject({
      notebook_id: "diario",
    });
  });
});

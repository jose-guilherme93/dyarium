import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationsMenu } from "./NotificationsMenu";
import { api } from "../api";
import type { Activity } from "../types";

vi.mock("../api", () => ({
  api: {
    listActivities: vi.fn(),
  },
}));

const SEEN_KEY = "dyarium.notifications.seenAt";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    entry_id: "e1",
    kind: "analysis",
    title: "Nota analisada",
    finished_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("NotificationsMenu", () => {
  it("conta o que terminou depois da ultima leitura e abre a nota ao clicar", async () => {
    const seen = Date.now() - 30 * 60 * 1000;
    localStorage.setItem(SEEN_KEY, String(seen));
    vi.mocked(api.listActivities).mockResolvedValue({
      activities: [
        activity({ id: "a1", entry_id: "e1", kind: "analysis", title: "Nota nova" }),
        activity({
          id: "a2",
          entry_id: "e2",
          kind: "transcription",
          title: "Nota antiga",
          finished_at: new Date(seen - 60_000).toISOString(),
        }),
      ],
    });
    const onOpen = vi.fn();

    render(<NotificationsMenu refreshKey={0} onOpen={onOpen} />);

    const bell = await screen.findByLabelText("Notificações, 1 não lida");
    fireEvent.click(bell);

    expect(screen.getByText("Nota nova")).toBeInTheDocument();
    expect(screen.getByText("Nota antiga")).toBeInTheDocument();
    expect(screen.getByText("Análise", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Transcrição", { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Nota nova"));

    expect(onOpen).toHaveBeenCalledWith("e1");
    expect(Number(localStorage.getItem(SEEN_KEY))).toBeGreaterThan(seen);
  });

  it("na primeira visita nao transforma o historico inteiro em nao lido", async () => {
    vi.mocked(api.listActivities).mockResolvedValue({
      activities: [
        activity({
          id: "a1",
          title: "Transcrição pronta",
          finished_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
      ],
    });

    render(<NotificationsMenu refreshKey={0} onOpen={() => {}} />);

    const bell = await screen.findByLabelText("Notificações");
    fireEvent.click(bell);
    expect(screen.getByText("Transcrição pronta")).toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).not.toBeNull();
  });

  it("mostra o vazio quando nunca terminou nada", async () => {
    vi.mocked(api.listActivities).mockResolvedValue({ activities: [] });

    render(<NotificationsMenu refreshKey={0} onOpen={() => {}} />);

    fireEvent.click(await screen.findByLabelText("Notificações"));
    expect(screen.getByText("Nenhum processo concluído.")).toBeInTheDocument();
  });
});

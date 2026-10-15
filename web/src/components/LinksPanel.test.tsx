import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  listLinks: vi.fn(),
  listEntries: vi.fn(),
  createLink: vi.fn(),
  deleteLink: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    listLinks: mocks.listLinks,
    listEntries: mocks.listEntries,
    createLink: mocks.createLink,
    deleteLink: mocks.deleteLink,
  },
}));

import { LinksPanel } from "./LinksPanel";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLinks.mockResolvedValue({
    links: [
      {
        id: "l1",
        from_entry_id: "e1",
        to_entry_id: "e2",
        url: "",
        label: "continuacao",
        title: "Outra nota",
        created_at: "2026-10-10T21:05:00Z",
      },
    ],
  });
  mocks.listEntries.mockResolvedValue({ entries: [{ id: "e1" }, { id: "e2" }] });
  mocks.createLink.mockResolvedValue({ id: "l2" });
  mocks.deleteLink.mockResolvedValue(undefined);
});

describe("LinksPanel", () => {
  it("abre a nota vinculada ao clicar no link interno", async () => {
    const onOpenEntry = vi.fn();
    render(<LinksPanel entryId="e1" onOpenEntry={onOpenEntry} />);
    const target = await screen.findByRole("button", { name: "continuacao" });
    fireEvent.click(target);
    expect(onOpenEntry).toHaveBeenCalledWith("e2");
  });

  it("vincula outra nota a partir do seletor", async () => {
    render(<LinksPanel entryId="e1" onOpenEntry={() => {}} />);
    const select = await screen.findByLabelText("Vincular a uma nota");
    fireEvent.change(select, { target: { value: "e2" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));
    await waitFor(() => expect(mocks.createLink).toHaveBeenCalledWith("e1", { to_entry_id: "e2", label: undefined }));
  });
});

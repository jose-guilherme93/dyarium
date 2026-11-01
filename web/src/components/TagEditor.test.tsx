import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TagEditor } from "./TagEditor";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    listEntryTags: vi.fn(async () => ({ tags: [] })),
    listTags: vi.fn(async () => ({ tags: [] })),
    setEntryTags: vi.fn(async () => ({ status: "ok" })),
  },
}));

describe("TagEditor", () => {
  it("serializa duas edicoes rapidas e grava a lista mais recente", async () => {
    let release!: () => void;
    vi.mocked(api.setEntryTags).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: "ok" });
        }),
    );

    render(<TagEditor entryId="e1" onChanged={() => undefined} />);
    const input = await screen.findByLabelText("Adicionar tag");

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.setEntryTags).toHaveBeenCalledTimes(1));
    expect(api.setEntryTags).toHaveBeenLastCalledWith("e1", ["a"]);

    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // A segunda lista espera a primeira gravacao terminar, em vez de correr
    // junto e poder ser sobrescrita pela resposta mais lenta.
    expect(api.setEntryTags).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(api.setEntryTags).toHaveBeenCalledTimes(2));
    expect(api.setEntryTags).toHaveBeenLastCalledWith("e1", ["a", "b"]);
  });
});

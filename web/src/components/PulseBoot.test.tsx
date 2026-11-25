import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PulseBoot } from "./PulseBoot";

vi.mock("../local/vaultStats", () => ({
  vaultStats: vi.fn().mockResolvedValue({ notes: 7, bytes: 100 }),
}));
vi.mock("../local/driveMark", () => ({
  driveMarked: vi.fn(() => true),
}));
vi.mock("../lib/pulse", () => ({
  pulseBoot: vi.fn(),
}));

describe("PulseBoot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chama pulseBoot com os numeros de vaultStats e has_drive", async () => {
    const { pulseBoot } = await import("../lib/pulse");
    vi.useFakeTimers();
    render(<PulseBoot />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pulseBoot).toHaveBeenCalledWith({ notes: 7, bytes: 100, has_drive: true });
  });
});

import { describe, expect, it } from "vitest";

// Importing the module builds the BlockNote schema (custom image block); a
// broken schema would throw here.
describe("NotesEditor module", () => {
  it("constroi o schema do corpo da nota", async () => {
    const mod = await import("./NotesEditor");
    expect(mod.NotesEditor).toBeTruthy();
  });
});